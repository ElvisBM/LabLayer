import type { Express, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { BusinessError, validId } from './session';
import { marketplaceViewerAccess } from './marketplace-security';
import type { TokenLoader } from './marketplace-listings';

/**
 * MCP (Model Context Protocol) server for the connected Mercado Livre account.
 *
 * Auth: `Authorization: Bearer ll_mcp_…`. Keys live in `privateMcpKeys/{sha256(key)}` (no client grants),
 * are created with `tools/mcp-key.ts`, belong to one company and act as the admin who created them.
 * Every call re-checks the key, the creator's company access and the Mercado Livre connection by reusing
 * the same token loader (refresh lease, encryption) as the web app. Write tools require the
 * `mercadolivre:write` scope and are audited in `tenants/{tenant}/auditLogs`.
 */
export const MCP_PATH = '/api/mcp';
export const MCP_SCOPES = ['mercadolivre:read', 'mercadolivre:write'] as const;
type Scope = typeof MCP_SCOPES[number];
type Claims = (uid: string) => Promise<Record<string, unknown> | undefined>;
type KeyContext = { keyId: string; tenant: string; uid: string; scopes: Scope[]; actor: DecodedIdToken };

export const hashMcpKey = (token: string) => createHash('sha256').update(token).digest('hex');
const ML = 'https://api.mercadolibre.com';
const now = () => new Date().toISOString();
const itemId = z.string().regex(/^MLB\d{1,15}$/, 'Use o código do anúncio, ex.: MLB1234567890.');
const numericId = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().positive()]).transform(String);
const money = z.number().positive().max(99999999).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo duas casas decimais.');

class ToolError extends Error {}

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

function mlMessage(body: any, status: number) {
  const parts = [body?.message, ...(Array.isArray(body?.cause) ? body.cause.map((c: any) => c?.message || c?.code) : [])]
    .filter(v => typeof v === 'string' && v.length).map((v: string) => v.slice(0, 300));
  return `Mercado Livre respondeu ${status}${parts.length ? `: ${parts.join(' | ')}` : '.'}`;
}

const pickItem = (item: any) => ({
  id: item.id, titulo: item.title, status: item.status, sub_status: item.sub_status, preco: item.price, preco_original: item.original_price ?? null,
  moeda: item.currency_id, estoque: item.available_quantity, vendidos: item.sold_quantity, tipo_anuncio: item.listing_type_id,
  categoria: item.category_id, condicao: item.condition, link: item.permalink, sku: item.seller_custom_field ?? null,
  catalogo: !!item.catalog_listing, user_product_id: item.user_product_id ?? null, saude: item.health ?? null,
  criado_em: item.date_created, atualizado_em: item.last_updated,
});

const pickOrder = (o: any) => ({
  id: o.id, status: o.status, criado_em: o.date_created, fechado_em: o.date_closed, total: o.total_amount, pago: o.paid_amount,
  moeda: o.currency_id, comprador: o.buyer ? { id: o.buyer.id, apelido: o.buyer.nickname } : null, pack_id: o.pack_id ?? null,
  envio_id: o.shipping?.id ?? null, tags: o.tags,
  itens: (o.order_items || []).map((i: any) => ({ anuncio: i.item?.id, titulo: i.item?.title, variacao_id: i.item?.variation_id ?? null,
    sku: i.item?.seller_sku ?? null, quantidade: i.quantity, preco_unitario: i.unit_price, tarifa_venda: i.sale_fee })),
  pagamentos: (o.payments || []).map((p: any) => ({ id: p.id, status: p.status, valor: p.transaction_amount, metodo: p.payment_method_id, parcelas: p.installments })),
});

export function registerMercadoLivreMcp(app: Express, db: Firestore | null, loadToken: TokenLoader,
  options: { claims: Claims; fetcher?: typeof fetch; rateLimitPerMinute?: number }) {
  const fetcher = options.fetcher ?? fetch;
  const limit = options.rateLimitPerMinute ?? 120;
  const usage = new Map<string, { windowStart: number; count: number }>();

  async function authenticate(req: Request): Promise<KeyContext> {
    if (!db) throw new BusinessError(503, 'Serviço indisponível.');
    const token = req.headers.authorization?.match(/^Bearer (ll_mcp_[\w-]{20,200})$/)?.[1];
    if (!token) throw new BusinessError(401, 'Chave MCP ausente ou inválida.');
    const ref = db.doc(`privateMcpKeys/${hashMcpKey(token)}`);
    const key = (await ref.get()).data();
    if (!key || key.active !== true || (key.expiresAt && key.expiresAt <= now())) throw new BusinessError(401, 'Chave MCP inválida, expirada ou revogada.');
    if (!validId(key.tenantId) || !validId(key.createdBy) || !Array.isArray(key.scopes) || !key.scopes.includes('mercadolivre:read'))
      throw new BusinessError(403, 'Chave MCP sem acesso ao Mercado Livre.');
    const window = usage.get(key.id) ?? { windowStart: Date.now(), count: 0 };
    if (Date.now() - window.windowStart > 60000) { window.windowStart = Date.now(); window.count = 0; }
    if (++window.count > limit) throw new BusinessError(429, 'Muitas chamadas. Aguarde um minuto.');
    usage.set(key.id, window);
    if (usage.size > 1000) usage.delete(usage.keys().next().value!);
    let claims: Record<string, unknown> | undefined;
    try { claims = await options.claims(key.createdBy); } catch { throw new BusinessError(401, 'Responsável pela chave não encontrado.'); }
    const actor = { uid: key.createdBy, superadmin: claims?.superadmin === true } as unknown as DecodedIdToken;
    // Fails fast (403) if the creator lost access to the company.
    await db.runTransaction(tx => marketplaceViewerAccess(db, tx, key.tenantId, actor));
    return { keyId: String(key.id), tenant: key.tenantId, uid: key.createdBy, scopes: key.scopes, actor };
  }

  function buildServer(ctx: KeyContext) {
    const server = new McpServer({ name: 'lablayer-mercadolivre', version: '1.0.0' }, {
      instructions: 'Ferramentas da LabLayer para a conta do Mercado Livre conectada à empresa. Ferramentas ml_alterar_*, ml_pausar/reativar, '
        + 'ml_responder_pergunta e ml_enviar_mensagem_venda alteram dados reais na loja: confirme com o usuário antes de usá-las. '
        + 'Valores em BRL. Aprovação e publicação de rascunhos continuam exigindo um administrador na LabLayer.',
    });

    async function session(write: boolean) {
      if (write && !ctx.scopes.includes('mercadolivre:write')) throw new ToolError('Esta chave MCP é somente leitura.');
      try {
        const loaded = await loadToken(ctx.tenant, ctx.actor, !write);
        const sellerId = String(loaded.context.connection.userId);
        if (!/^[1-9]\d{0,19}$/.test(sellerId)) throw new ToolError('Conexão do Mercado Livre inválida.');
        return { accessToken: loaded.accessToken, sellerId, nickname: String(loaded.context.connection.nickname || '') };
      } catch (e) {
        if (e instanceof BusinessError || e instanceof ToolError) throw new ToolError(e.message);
        throw new ToolError('Não foi possível obter acesso ao Mercado Livre. Verifique a conexão em Configurações > Integrações.');
      }
    }
    async function ml(s: { accessToken: string }, path: string, init: RequestInit & { allow404?: boolean } = {}) {
      let response: globalThis.Response;
      try {
        response = await fetcher(`${ML}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${s.accessToken}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as any) } });
      } catch { throw new ToolError('Mercado Livre não respondeu. Tente novamente.'); }
      const body = await response.json().catch(() => null);
      if (init.allow404 && response.status === 404) return null;
      if (!response.ok) throw new ToolError(mlMessage(body, response.status));
      return body;
    }
    async function ownItem(s: { accessToken: string; sellerId: string }, id: string) {
      const item = await ml(s, `/items/${id}?include_attributes=all`);
      if (item?.id !== id || String(item.seller_id) !== s.sellerId) throw new ToolError('Anúncio não pertence à conta conectada.');
      return item;
    }
    async function ownOrder(s: { accessToken: string; sellerId: string }, id: string) {
      const order = await ml(s, `/orders/${id}`);
      if (String(order?.id) !== id || String(order.seller?.id) !== s.sellerId) throw new ToolError('Venda não pertence à conta conectada.');
      return order;
    }
    async function audit(operation: string, details: Record<string, unknown>) {
      await db!.collection(`tenants/${ctx.tenant}/auditLogs`).add({
        operation: `marketplace.mcp.${operation}`, provider: 'mercadolivre', actor: `mcp:${ctx.keyId}`, onBehalfOf: ctx.uid, createdAt: now(), ...details,
      });
    }
    async function updateItem(id: string, operation: string, build: (item: any) => Record<string, unknown>, confirm: (item: any) => boolean) {
      const s = await session(true);
      const item = await ownItem(s, id);
      const payload = build(item);
      const before = Object.fromEntries(Object.keys(payload).map(k => [k, k === 'variations'
        ? (item.variations || []).map((v: any) => ({ id: v.id, price: v.price, available_quantity: v.available_quantity })) : item[k] ?? null]));
      await ml(s, `/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      const updated = await ownItem(s, id);
      const confirmed = confirm(updated);
      await audit(operation, { itemId: id, before, changes: payload, confirmed });
      return { confirmado: confirmed, anuncio: pickItem(updated),
        ...(updated.variations?.length ? { variacoes: updated.variations.map((v: any) => ({ id: v.id, preco: v.price, estoque: v.available_quantity })) } : {}),
        ...(confirmed ? {} : { aviso: 'O Mercado Livre aceitou a alteração, mas ela ainda não aparece no anúncio. Consulte novamente em instantes.' }) };
    }
    function tool<T extends z.ZodRawShape>(name: string, description: string, shape: T, annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean },
      run: (args: z.infer<z.ZodObject<T>>) => Promise<unknown>) {
      server.registerTool(name, { description, inputSchema: shape, annotations: { openWorldHint: true, ...annotations } }, (async (args: any) => {
        try { return text(await run(args)); }
        catch (e) {
          const message = e instanceof ToolError ? e.message : 'Falha inesperada. Nenhuma alteração adicional foi tentada.';
          if (!(e instanceof ToolError)) console.error('MCP Mercado Livre:', name, (e as Error)?.name);
          return { ...text(message), isError: true };
        }
      }) as any);
    }
    const read = { readOnlyHint: true };
    const write = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

    // ── Conta e configurações ────────────────────────────────────────────────
    tool('ml_conta', 'Dados da conta do Mercado Livre conectada: apelido, reputação, status de vendedor e permissões da chave MCP.', {}, read, async () => {
      const s = await session(false);
      const me = await ml(s, '/users/me');
      if (String(me.id) !== s.sellerId) throw new ToolError('A conta autenticada não corresponde à conexão salva. Reconecte em Configurações.');
      return { id: me.id, apelido: me.nickname, site: me.site_id, link: me.permalink, tipo: me.user_type, cadastro: me.registration_date,
        status: me.status, reputacao: me.seller_reputation, pontos: me.points, tags: me.tags, escopos_da_chave: ctx.scopes };
    });
    tool('ml_preferencias_envio', 'Preferências de envio da conta (modos Mercado Envios, logísticas habilitadas, retirada, frete grátis).', {}, read, async () => {
      const s = await session(false);
      return ml(s, `/users/${s.sellerId}/shipping_preferences`);
    });

    // ── Anúncios ────────────────────────────────────────────────────────────
    tool('ml_listar_anuncios', 'Lista anúncios da conta com preço, estoque e vendas. Filtra por status, texto ou SKU.', {
      status: z.enum(['active', 'paused', 'closed', 'under_review', 'inactive']).optional().describe('Status do anúncio.'),
      busca: z.string().trim().min(1).max(100).optional().describe('Texto no título.'),
      sku: z.string().trim().min(1).max(100).optional(),
      limite: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(950).default(0),
    }, read, async ({ status, busca, sku, limite, offset }) => {
      const s = await session(false);
      const q = new URLSearchParams({ limit: String(limite), offset: String(offset) });
      if (status) q.set('status', status); if (busca) q.set('q', busca); if (sku) q.set('seller_sku', sku);
      const page = await ml(s, `/users/${s.sellerId}/items/search?${q}`);
      const ids: string[] = (page.results || []).filter((id: unknown) => typeof id === 'string' && /^MLB\d+$/.test(id));
      const items: any[] = [];
      for (let i = 0; i < ids.length; i += 20) {
        const batch = await ml(s, `/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,seller_id,title,status,sub_status,price,original_price,currency_id,available_quantity,sold_quantity,listing_type_id,permalink,seller_custom_field,catalog_listing,last_updated,date_created,category_id,condition,health,user_product_id`);
        for (const entry of batch || []) if (entry?.code === 200 && String(entry.body?.seller_id) === s.sellerId) items.push(pickItem(entry.body));
      }
      return { total: page.paging?.total ?? items.length, offset, anuncios: items };
    });
    tool('ml_ver_anuncio', 'Detalhes completos de um anúncio: atributos, variações, fotos, frete, descrição e saúde.', { item_id: itemId }, read, async ({ item_id }) => {
      const s = await session(false);
      const item = await ownItem(s, item_id);
      const description = await ml(s, `/items/${item_id}/description`, { allow404: true });
      return { ...pickItem(item), descricao: description?.plain_text ?? '',
        fotos: (item.pictures || []).map((p: any) => p.secure_url || p.url),
        atributos: (item.attributes || []).map((a: any) => ({ id: a.id, nome: a.name, valor: a.value_name })),
        variacoes: (item.variations || []).map((v: any) => ({ id: v.id, preco: v.price, estoque: v.available_quantity, vendidos: v.sold_quantity,
          sku: v.seller_custom_field ?? null, combinacao: (v.attribute_combinations || []).map((a: any) => `${a.name}: ${a.value_name}`).join(', ') })),
        frete: item.shipping, termos_venda: item.sale_terms };
    });
    tool('ml_listar_rascunhos', 'Lista os rascunhos de anúncio salvos na LabLayer (aprovação e publicação continuam na tela Anúncios).', {
      status: z.enum(['draft', 'approved', 'publishing', 'published', 'attention']).optional(),
    }, read, async ({ status }) => {
      await session(false);
      let query = db!.collection(`privateMarketplaceDrafts/${ctx.tenant}/items`).limit(100);
      if (status) query = query.where('status', '==', status);
      const snap = await query.get();
      return snap.docs.map(d => { const v = d.data(); return { id: d.id, status: v.status, titulo: v.data?.title, preco: v.data?.price,
        quantidade: v.data?.quantity, categoria: v.data?.categoryId, anuncio: v.itemId ?? null, atualizado_em: v.updatedAt, mensagem: v.message ?? null }; });
    });

    tool('ml_alterar_preco', 'ALTERA o preço de um anúncio na loja real. Em anúncio com variações, informe variacao_id ou o preço vale para todas.', {
      item_id: itemId, preco: money.describe('Novo preço em BRL.'), variacao_id: numericId.optional(),
    }, write, ({ item_id, preco, variacao_id }) => updateItem(item_id, 'listing.price', item => {
      if (!['active', 'paused'].includes(item.status)) throw new ToolError('Só é possível alterar preço de anúncios ativos ou pausados.');
      if (item.original_price > item.price) throw new ToolError('Anúncio em promoção: altere o preço pela central de promoções do Mercado Livre.');
      if (!item.variations?.length) { if (variacao_id) throw new ToolError('Este anúncio não tem variações.'); return { price: preco }; }
      if (variacao_id && !item.variations.some((v: any) => String(v.id) === variacao_id)) throw new ToolError('Variação não encontrada neste anúncio.');
      return { variations: item.variations.map((v: any) => !variacao_id || String(v.id) === variacao_id ? { id: v.id, price: preco } : { id: v.id }) };
    }, updated => updated.variations?.length
      ? updated.variations.filter((v: any) => !variacao_id || String(v.id) === variacao_id).every((v: any) => v.price === preco)
      : updated.price === preco));

    tool('ml_alterar_estoque', 'ALTERA o estoque disponível de um anúncio na loja real. Em anúncio com variações, variacao_id é obrigatório.', {
      item_id: itemId, quantidade: z.number().int().min(0).max(99999), variacao_id: numericId.optional(),
    }, write, ({ item_id, quantidade, variacao_id }) => updateItem(item_id, 'listing.stock', item => {
      if (!['active', 'paused'].includes(item.status)) throw new ToolError('Só é possível alterar estoque de anúncios ativos ou pausados.');
      if (!item.variations?.length) { if (variacao_id) throw new ToolError('Este anúncio não tem variações.'); return { available_quantity: quantidade }; }
      if (!variacao_id) throw new ToolError(`Anúncio com variações: informe variacao_id (${item.variations.map((v: any) => v.id).join(', ')}).`);
      if (!item.variations.some((v: any) => String(v.id) === variacao_id)) throw new ToolError('Variação não encontrada neste anúncio.');
      return { variations: item.variations.map((v: any) => String(v.id) === variacao_id ? { id: v.id, available_quantity: quantidade } : { id: v.id }) };
    }, updated => variacao_id
      ? updated.variations?.find((v: any) => String(v.id) === variacao_id)?.available_quantity === quantidade
      : updated.available_quantity === quantidade));

    tool('ml_alterar_titulo', 'ALTERA o título de um anúncio (até 60 caracteres). O Mercado Livre bloqueia em anúncios com vendas ou de catálogo.', {
      item_id: itemId, titulo: z.string().trim().min(1).max(60),
    }, write, ({ item_id, titulo }) => updateItem(item_id, 'listing.title', item => {
      if (!['active', 'paused'].includes(item.status)) throw new ToolError('Só é possível alterar título de anúncios ativos ou pausados.');
      if (item.user_product_id || item.catalog_listing) throw new ToolError('Título gerenciado pelo produto/catálogo do Mercado Livre.');
      if (item.sold_quantity > 0) throw new ToolError('O Mercado Livre não permite mudar o título de anúncios que já têm vendas.');
      return { title: titulo };
    }, updated => updated.title === titulo));

    tool('ml_pausar_anuncio', 'PAUSA um anúncio ativo (deixa de aparecer para compradores).', { item_id: itemId }, write, ({ item_id }) =>
      updateItem(item_id, 'listing.pause', item => {
        if (item.status !== 'active') throw new ToolError(`Só é possível pausar anúncios ativos (status atual: ${item.status}).`);
        return { status: 'paused' };
      }, updated => updated.status === 'paused'));

    tool('ml_reativar_anuncio', 'REATIVA um anúncio pausado que tenha estoque.', { item_id: itemId }, write, ({ item_id }) =>
      updateItem(item_id, 'listing.activate', item => {
        if (item.status !== 'paused') throw new ToolError(`Só é possível reativar anúncios pausados (status atual: ${item.status}). Encerrados exigem republicação.`);
        if (!(item.available_quantity > 0) || (item.sub_status || []).includes('out_of_stock')) throw new ToolError('Anúncio sem estoque: ajuste o estoque antes de reativar.');
        return { status: 'active' };
      }, updated => updated.status === 'active'));

    tool('ml_alterar_descricao', 'SUBSTITUI a descrição (texto simples) de um anúncio.', {
      item_id: itemId, descricao: z.string().trim().min(1).max(50000),
    }, write, async ({ item_id, descricao }) => {
      const s = await session(true);
      await ownItem(s, item_id);
      const previous = await ml(s, `/items/${item_id}/description`, { allow404: true });
      await ml(s, `/items/${item_id}/description?api_version=2`, { method: previous ? 'PUT' : 'POST', body: JSON.stringify({ plain_text: descricao }) });
      const current = await ml(s, `/items/${item_id}/description`, { allow404: true });
      const confirmed = current?.plain_text?.trim() === descricao;
      await audit('listing.description', { itemId: item_id, beforeLength: previous?.plain_text?.length ?? 0, afterLength: descricao.length, confirmed });
      return { confirmado: confirmed, item_id };
    });

    // ── Vendas, perguntas e pós-venda ───────────────────────────────────────
    tool('ml_listar_vendas', 'Lista vendas (pedidos) da conta, mais recentes primeiro.', {
      status: z.enum(['paid', 'confirmed', 'payment_required', 'payment_in_process', 'partially_paid', 'cancelled', 'invalid']).optional(),
      desde: z.string().datetime({ offset: true }).optional().describe('ISO 8601, ex.: 2026-11-01T00:00:00-03:00'),
      ate: z.string().datetime({ offset: true }).optional(),
      limite: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(10000).default(0),
    }, read, async ({ status, desde, ate, limite, offset }) => {
      const s = await session(false);
      const q = new URLSearchParams({ seller: s.sellerId, sort: 'date_desc', limit: String(limite), offset: String(offset) });
      if (status) q.set('order.status', status);
      if (desde) q.set('order.date_created.from', desde);
      if (ate) q.set('order.date_created.to', ate);
      const page = await ml(s, `/orders/search?${q}`);
      return { total: page.paging?.total ?? 0, offset, vendas: (page.results || []).filter((o: any) => String(o.seller?.id) === s.sellerId).map(pickOrder) };
    });
    tool('ml_ver_venda', 'Detalhes de uma venda: itens, pagamentos e situação do envio.', { order_id: numericId }, read, async ({ order_id }) => {
      const s = await session(false);
      const order = await ownOrder(s, order_id);
      let envio = null;
      if (order.shipping?.id) {
        const sh = await ml(s, `/shipments/${order.shipping.id}`, { allow404: true, headers: { 'x-format-new': 'true' } });
        if (sh) envio = { id: sh.id, status: sh.status, substatus: sh.substatus, logistica: sh.logistic?.type ?? sh.logistic_type, rastreio: sh.tracking_number ?? null,
          metodo: sh.lead_time?.shipping_method?.name ?? null, prazo: sh.lead_time?.estimated_delivery_time?.date ?? null,
          destino: sh.destination?.shipping_address ? { cidade: sh.destination.shipping_address.city?.name, estado: sh.destination.shipping_address.state?.id } : null };
      }
      return { ...pickOrder(order), envio };
    });
    tool('ml_listar_perguntas', 'Lista perguntas de compradores nos anúncios (por padrão, as não respondidas).', {
      status: z.enum(['UNANSWERED', 'ANSWERED', 'TODAS']).default('UNANSWERED'), item_id: itemId.optional(),
      limite: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(1000).default(0),
    }, read, async ({ status, item_id, limite, offset }) => {
      const s = await session(false);
      const q = new URLSearchParams({ seller_id: s.sellerId, api_version: '4', sort_fields: 'date_created', sort_types: 'DESC', limit: String(limite), offset: String(offset) });
      if (status !== 'TODAS') q.set('status', status);
      if (item_id) q.set('item', item_id);
      const page = await ml(s, `/questions/search?${q}`);
      return { total: page.total ?? 0, perguntas: (page.questions || []).map((p: any) => ({ id: p.id, anuncio: p.item_id, status: p.status,
        pergunta: p.text, feita_em: p.date_created, resposta: p.answer?.text ?? null, comprador_id: p.from?.id ?? null })) };
    });
    tool('ml_responder_pergunta', 'RESPONDE publicamente a pergunta de um comprador (fica visível no anúncio; não dá para editar depois).', {
      question_id: numericId, resposta: z.string().trim().min(1).max(2000),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async ({ question_id, resposta }) => {
      const s = await session(true);
      const question = await ml(s, `/questions/${question_id}?api_version=4`);
      if (String(question?.seller_id) !== s.sellerId) throw new ToolError('Pergunta não pertence à conta conectada.');
      if (question.status !== 'UNANSWERED') throw new ToolError(`Pergunta não está pendente (status: ${question.status}).`);
      await ml(s, '/answers', { method: 'POST', body: JSON.stringify({ question_id: Number(question_id), text: resposta }) });
      await audit('question.answer', { questionId: question_id, itemId: question.item_id, length: resposta.length });
      return { respondida: true, question_id, anuncio: question.item_id };
    });
    tool('ml_mensagens_venda', 'Mensagens pós-venda de uma venda (conversa com o comprador).', { order_id: numericId }, read, async ({ order_id }) => {
      const s = await session(false);
      const order = await ownOrder(s, order_id);
      const pack = String(order.pack_id ?? order.id);
      const result = await ml(s, `/messages/packs/${pack}/sellers/${s.sellerId}?tag=post_sale&mark_as_read=false&limit=50`);
      return { pack_id: pack, mensagens: (result?.messages || []).map((m: any) => ({ id: m.id, de: String(m.from?.user_id) === s.sellerId ? 'vendedor' : 'comprador',
        texto: m.text, enviada_em: m.message_date?.created ?? m.date_created, anexos: (m.message_attachments || []).length })),
        restricoes: result?.conversation_status ?? null };
    });
    tool('ml_enviar_mensagem_venda', 'ENVIA mensagem pós-venda ao comprador de uma venda (até 350 caracteres).', {
      order_id: numericId, texto: z.string().trim().min(1).max(350),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, async ({ order_id, texto }) => {
      const s = await session(true);
      const order = await ownOrder(s, order_id);
      const pack = String(order.pack_id ?? order.id);
      if (!order.buyer?.id) throw new ToolError('Comprador não identificado nesta venda.');
      const sent = await ml(s, `/messages/packs/${pack}/sellers/${s.sellerId}?tag=post_sale`, { method: 'POST',
        body: JSON.stringify({ from: { user_id: s.sellerId }, to: { user_id: String(order.buyer.id) }, text: texto }) });
      await audit('order.message', { orderId: order_id, packId: pack, length: texto.length });
      return { enviada: true, pack_id: pack, mensagem_id: sent?.id ?? null };
    });
    tool('ml_reclamacoes', 'Lista reclamações (claims) de pós-venda da conta.', {
      status: z.enum(['opened', 'closed']).default('opened'), limite: z.number().int().min(1).max(50).default(20),
    }, read, async ({ status, limite }) => {
      const s = await session(false);
      const result = await ml(s, `/post-purchase/v1/claims/search?status=${status}&limit=${limite}&sort=last_updated:desc`);
      return { total: result?.paging?.total ?? 0, reclamacoes: (result?.data || []).map((c: any) => ({ id: c.id, tipo: c.type, etapa: c.stage, status: c.status,
        motivo: c.reason_id, recurso: c.resource, recurso_id: c.resource_id, criada_em: c.date_created, atualizada_em: c.last_updated })) };
    });
    return server;
  }

  const fail = (res: Response, e: unknown) => {
    const status = e instanceof BusinessError ? e.status : 503;
    if (status === 401) res.set('WWW-Authenticate', 'Bearer realm="lablayer-mcp"');
    return res.status(status).json({ jsonrpc: '2.0', error: { code: -32001, message: e instanceof BusinessError ? e.message : 'Serviço indisponível.' }, id: null });
  };
  app.post(MCP_PATH, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let ctx: KeyContext;
    try { ctx = await authenticate(req); } catch (e) { return fail(res, e); }
    const server = buildServer(ctx);
    // Stateless: one server/transport per request, no session ids to hijack.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno.' }, id: null });
    }
  });
  const notAllowed = (_req: Request, res: Response) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST.' }, id: null });
  app.get(MCP_PATH, notAllowed);
  app.delete(MCP_PATH, notAllowed);
}
