import express, { type Express, type Request, type Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { BusinessError, validId } from './session';
import { marketplaceAccess } from './marketplace-security';
import { storeListingPhoto } from './marketplace-draft-photos';
import type { AssetStore } from './assets';
import { normalizeDraft, publicationPayload } from '../shared/marketplaces/drafts';
import { safeListingUrl } from '../shared/marketplaces/listings';

/**
 * MCP tools to create Mercado Livre listings from photos: category prediction, category attributes,
 * a short-lived photo upload link (claude.ai cannot hand chat attachments to an MCP server) and
 * validate + publish. Publications are stored as drafts in `privateMarketplaceDrafts/{tenant}/items`
 * with the same shape as the Anúncios screen, so an ambiguous result can be finished there without
 * creating a second listing.
 */
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const now = () => new Date().toISOString();
const BATCH_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PHOTOS = 12;
const categoryId = z.string().regex(/^MLB\d{1,12}$/, 'Use o código da categoria, ex.: MLB1637.');
const loteId = z.string().regex(/^[a-f0-9]{16}$/, 'Lote inválido.');
const money = z.number().positive().max(99999999).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo duas casas decimais.');
const attr = z.object({ id: z.string().regex(/^[A-Z0-9_]{1,80}$/), valor: z.string().trim().min(1).max(500).optional(), valor_id: z.string().trim().min(1).max(100).optional() })
  .refine(a => a.valor !== undefined || a.valor_id !== undefined, 'Informe valor ou valor_id.');
const uncertain = 'Não foi possível confirmar a publicação. Confira o Mercado Livre (ou a tela Anúncios da LabLayer) antes de tentar de novo; nenhum outro anúncio será criado automaticamente.';

type Session = { accessToken: string; sellerId: string; stamp: string };
export type ListingToolHelpers = {
  ctx: { keyId: string; keyHash: string; tenant: string };
  db: Firestore;
  store: AssetStore | null;
  publicUrl: string;
  fetcher: typeof fetch;
  fail: (message: string) => never;
  session: (write: boolean) => Promise<Session>;
  ml: (s: Session, path: string, init?: RequestInit & { allow404?: boolean }) => Promise<any>;
  audit: (operation: string, details: Record<string, unknown>) => Promise<void>;
  tool: (name: string, description: string, shape: z.ZodRawShape, annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean },
    run: (args: any) => Promise<unknown>) => void;
};

/** Mercado Livre validation causes as short readable lines (errors first). */
export function describeCauses(body: any) {
  const clean = (v: unknown, max = 240) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const causes: any[] = Array.isArray(body?.cause) ? body.cause.filter((c: unknown) => c && typeof c === 'object') : [];
  const freight = (c: any) => c.code === 'item.shipping.mandatory_free_shipping' ||
    ((c.references || []).includes?.('shipping.free_shipping') && /mandatory free shipping/i.test(String(c.message || '')));
  const line = (c: any) => [clean(String(c.code ?? ''), 100), clean(c.message)].filter(Boolean).join(': ');
  const errors = causes.filter(c => !freight(c) && c.type !== 'warning').map(line).filter(Boolean).slice(0, 8);
  const warnings = causes.filter(c => c.type === 'warning' && !freight(c)).map(line).filter(Boolean).slice(0, 5);
  if (!errors.length && !causes.length && body && (body.message || body.error)) errors.push([clean(body.error, 100), clean(body.message)].filter(Boolean).join(': '));
  return { errors, warnings, freeShippingRequired: causes.some(freight) };
}

export function registerListingTools(h: ListingToolHelpers) {
  const { ctx, db, fail, session, ml, audit, tool } = h;
  const read = { readOnlyHint: true };
  const raw = (s: Session, path: string, init: RequestInit = {}) => h.fetcher(`https://api.mercadolibre.com${path}`, { ...init, redirect: 'error',
    signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${s.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' } })
    .catch(() => fail('Mercado Livre não respondeu. Tente novamente.'));

  tool('ml_buscar_categoria', 'Sugere categorias do Mercado Livre para um produto a partir de um texto curto (ex.: "vaso decorativo impresso 3D").', {
    texto: z.string().trim().min(3).max(120),
  }, read, async ({ texto }) => {
    const s = await session(false);
    const found = await ml(s, `/sites/MLB/domain_discovery/search?${new URLSearchParams({ q: texto, limit: '5' })}`);
    const ids = [...new Set((Array.isArray(found) ? found : []).map((r: any) => String(r?.category_id ?? '')).filter(id => /^MLB\d+$/.test(id)))].slice(0, 3);
    const out = [];
    for (const id of ids) {
      const c = await ml(s, `/categories/${id}`, { allow404: true });
      if (!c) continue;
      const hit = found.find((r: any) => r.category_id === id);
      out.push({ categoria: id, caminho: (c.path_from_root || []).map((p: any) => p.name).join(' > '), dominio: hit?.domain_name ?? null,
        permite_anuncio: c.settings?.listing_allowed === true && !(c.children_categories || []).length,
        atributos_sugeridos: (hit?.attributes || []).slice(0, 5).map((a: any) => ({ id: a.id, valor: a.value_name, valor_id: a.value_id ?? undefined })) });
    }
    return { categorias: out };
  });

  tool('ml_atributos_categoria', 'Ficha técnica de uma categoria: atributos obrigatórios com valores aceitos e a lista dos demais. Use "ids" para detalhar outros atributos.', {
    categoria: categoryId, condicao: z.enum(['new', 'used']).default('new'),
    ids: z.array(z.string().regex(/^[A-Z0-9_]{1,80}$/)).max(20).optional().describe('Detalhar estes atributos (além dos obrigatórios).'),
  }, read, async ({ categoria, condicao, ids }) => {
    const s = await session(false);
    const [cat, list] = [await ml(s, `/categories/${categoria}`), await ml(s, `/categories/${categoria}/attributes`)];
    if (!Array.isArray(list)) fail('O Mercado Livre retornou os atributos em formato inválido.');
    const usable = list.filter((a: any) => a && typeof a.id === 'string' && !a.tags?.read_only && !a.tags?.fixed && !a.tags?.hidden);
    const required = (a: any) => a.tags?.required === true || (condicao === 'new' && a.tags?.new_required === true) || a.tags?.catalog_required === true;
    const detail = (a: any) => ({ id: a.id, nome: a.name, tipo: a.value_type,
      ...(a.tags?.conditional_required ? { condicional: true } : {}), ...(a.tags?.multivalued ? { multivalor: true } : {}),
      ...(Array.isArray(a.values) && a.values.length ? { valores: a.values.slice(0, 30).map((v: any) => `${v.id}=${v.name}`), ...(a.values.length > 30 ? { mais_valores: a.values.length - 30 } : {}) } : {}),
      ...(Array.isArray(a.allowed_units) && a.allowed_units.length ? { unidades: a.allowed_units.slice(0, 8).map((u: any) => u.name || u.id) } : {}),
      ...(a.value_max_length ? { max: a.value_max_length } : {}), ...(a.hint ? { dica: String(a.hint).slice(0, 160) } : {}) });
    const wanted = new Set(ids || []);
    return {
      categoria: { id: cat.id, caminho: (cat.path_from_root || []).map((p: any) => p.name).join(' > '), permite_anuncio: cat.settings?.listing_allowed === true,
        max_fotos: cat.settings?.max_pictures_per_item ?? null, max_titulo: cat.settings?.max_title_length ?? null },
      obrigatorios: usable.filter((a: any) => required(a) || a.tags?.conditional_required).map(detail),
      ...(wanted.size ? { detalhados: usable.filter((a: any) => wanted.has(a.id)).map(detail) } : {}),
      outros: usable.filter((a: any) => !required(a) && !a.tags?.conditional_required && !wanted.has(a.id)).slice(0, 60).map((a: any) => `${a.id} (${a.name})`),
      dica: 'Envie valor_id quando houver lista de valores; para números com unidade use "10 cm".',
    };
  });

  tool('ml_link_fotos', 'Cria um link (válido por 2 h) para enviar até 12 fotos de um produto pelo celular ou computador. Devolve o lote para usar em ml_ver_fotos e ml_publicar_anuncio.', {},
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false }, async () => {
      await session(true);
      if (!h.store) fail('Armazenamento de fotos indisponível no servidor.');
      const lote = randomBytes(8).toString('hex'), secret = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + BATCH_TTL_MS).toISOString();
      await db.doc(`privateMcpPhotoBatches/${lote}`).create({ tenantId: ctx.tenant, keyId: ctx.keyId, keyHash: ctx.keyHash, secretHash: sha(secret), photos: [], createdAt: now(), expiresAt });
      const link = `${h.publicUrl}/api/mcp/fotos/${lote}.${secret}`;
      return { lote, link, expira_em: expiresAt, envio_direto: `POST ${link} com o arquivo no corpo e Content-Type image/jpeg, image/png ou image/webp`,
        instrucao: 'Passe o link ao usuário. Depois chame ml_ver_fotos com o lote.' };
    });

  tool('ml_ver_fotos', 'Mostra as fotos enviadas em um lote (miniaturas) e seus ids, na ordem de envio.', {
    lote: loteId, miniaturas: z.boolean().default(true).describe('Incluir miniaturas pequenas para você ver as fotos.'),
  }, read, async ({ lote, miniaturas }) => {
    await session(false);
    const batch = (await db.doc(`privateMcpPhotoBatches/${lote}`).get()).data();
    if (!batch || batch.tenantId !== ctx.tenant) fail('Lote não encontrado.');
    const photos = [];
    for (const id of batch!.photos as string[]) {
      const p = (await db.doc(`privateMarketplaceDraftPhotos/${id}`).get()).data();
      if (p?.active && p.tenantId === ctx.tenant) photos.push(p);
    }
    const summary = { lote, total: photos.length, expira_em: batch!.expiresAt,
      fotos: photos.map(p => ({ foto_id: p.id, largura: p.width, altura: p.height, ...(Math.min(p.width, p.height) < 500 ? { aviso: 'menor que 500 px' } : {}) })) };
    if (!miniaturas || !photos.length || !h.store) return summary;
    const images = [];
    for (const p of photos) {
      try {
        const thumb = await sharp(await h.store.get(p.path)).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 65 }).toBuffer();
        images.push({ type: 'image' as const, data: thumb.toString('base64'), mimeType: 'image/jpeg' });
      } catch { /* the id list is still useful without a thumbnail */ }
    }
    return { __content: [{ type: 'text' as const, text: JSON.stringify(summary) }, ...images] };
  });

  tool('ml_publicar_anuncio', 'CRIA E PUBLICA um anúncio real no Mercado Livre (valida antes; com apenas_validar=true só confere e mostra a tarifa). '
    + 'Fotos: lote de ml_link_fotos e/ou ids/URLs HTTPS públicas. Repetir a mesma chamada não cria anúncio duplicado.', {
    titulo: z.string().trim().min(1).max(60), categoria: categoryId, preco: money.describe('Preço em BRL.'),
    estoque: z.number().int().min(1).max(99999), descricao: z.string().trim().min(1).max(5000).describe('Texto simples, sem HTML.'),
    lote: loteId.optional(), fotos: z.array(z.string().trim().min(1).max(2000)).max(MAX_PHOTOS).optional().describe('foto_id do lote ou URL HTTPS pública, na ordem desejada.'),
    atributos: z.array(attr).max(100).default([]), termos_venda: z.array(attr).max(10).default([]).describe('Ex.: WARRANTY_TYPE, WARRANTY_TIME.'),
    condicao: z.enum(['new', 'used']).default('new'), tipo_anuncio: z.enum(['gold_special', 'gold_pro']).default('gold_special').describe('gold_special = Clássico, gold_pro = Premium.'),
    frete: z.object({ modo: z.enum(['me2', 'me1', 'custom', 'not_specified']).default('me2'), gratis: z.boolean().default(false), retirada: z.boolean().default(false) }).optional(),
    sku: z.string().trim().min(1).max(60).optional(), referencia: z.string().regex(/^[\w.-]{1,100}$/).optional().describe('Seu código interno; evita duplicar o anúncio.'),
    apenas_validar: z.boolean().default(false),
  }, { readOnlyHint: false, destructiveHint: true, idempotentHint: true }, async args => {
    const s = await session(true);
    // Photos: batch first (upload order), then explicit ids/URLs; ids must belong to this company.
    const ids: string[] = [];
    if (args.lote) {
      const batch = (await db.doc(`privateMcpPhotoBatches/${args.lote}`).get()).data();
      if (!batch || batch.tenantId !== ctx.tenant) fail('Lote não encontrado.');
      ids.push(...batch!.photos);
    }
    const pictures: string[] = [];
    for (const ref of [...ids, ...(args.fotos || [])]) {
      let url = ref;
      if (/^[a-f0-9]{64}$/.test(ref)) {
        const p = (await db.doc(`privateMarketplaceDraftPhotos/${ref}`).get()).data();
        if (!p?.active || p.tenantId !== ctx.tenant) fail(`Foto ${ref.slice(0, 8)}… não encontrada.`);
        url = `https://app.lablayer.com.br/api/listing-photos/${ref}.jpg`;
      }
      if (!pictures.includes(url)) pictures.push(url);
    }
    if (!pictures.length) fail('Envie ao menos uma foto (lote ou fotos).');
    if (pictures.length > MAX_PHOTOS) fail(`No máximo ${MAX_PHOTOS} fotos.`);
    const attributes = args.atributos.map((a: any) => ({ id: a.id, ...(a.valor_id ? { value_id: a.valor_id } : {}), ...(a.valor ? { value_name: a.valor } : {}) }));
    if (args.sku && !attributes.some((a: any) => a.id === 'SELLER_SKU')) attributes.push({ id: 'SELLER_SKU', value_name: args.sku });
    const frete = args.frete ?? { modo: 'me2', gratis: false, retirada: false };
    const base = { title: args.titulo, description: args.descricao, price: args.preco, quantity: args.estoque, pictures, categoryId: args.categoria,
      condition: args.condicao, listingTypeId: args.tipo_anuncio, saleTerms: args.termos_venda.map((a: any) => ({ id: a.id, ...(a.valor_id ? { value_id: a.valor_id } : {}), ...(a.valor ? { value_name: a.valor } : {}) })),
      attributes, shipping: { mode: frete.modo, local_pick_up: frete.retirada, free_shipping: frete.gratis } };
    const externalId = args.referencia ?? `mcp-${sha(JSON.stringify(base)).slice(0, 24)}`;
    let data: ReturnType<typeof normalizeDraft>, payload: ReturnType<typeof publicationPayload>;
    try { data = normalizeDraft({ externalId, ...base }); } catch (e) { fail((e as Error).message); }
    const ref = db.doc(`privateMarketplaceDrafts/${ctx.tenant}/items/${sha(externalId)}`);
    const existing = (await ref.get()).data();
    if (existing?.itemId || ['publishing', 'attention', 'published'].includes(existing?.status)) {
      if (existing!.status === 'published') return { publicado: true, ja_existia: true, anuncio: existing!.itemId, link: existing!.itemUrl ?? null, rascunho_id: ref.id };
      fail(`Este anúncio já foi enviado (status ${existing!.status}${existing!.itemId ? `, ${existing!.itemId}` : ''}). Confira na tela Anúncios da LabLayer antes de tentar de novo.`);
    }
    if (existing && !String(existing.createdBy || '').startsWith('mcp:')) fail('Esta referência já pertence a um rascunho criado na LabLayer. Use outra referência.');

    const me = await ml(s, '/users/me');
    if (String(me.id) !== s.sellerId) fail('A conta autenticada não corresponde à conexão salva. Reconecte em Configurações.');
    try { payload = publicationPayload(data!, (me.tags || []).includes('user_product_seller')); } catch (e) { fail((e as Error).message); }
    const prefs = await ml(s, `/users/${s.sellerId}/shipping_preferences`);
    if (Array.isArray(prefs?.modes) && !prefs.modes.includes(payload!.shipping.mode)) fail(`A conta não permite o frete ${payload!.shipping.mode}. Modos habilitados: ${prefs.modes.join(', ')}.`);
    const validation = await raw(s, '/items/validate', { method: 'POST', body: JSON.stringify(payload!) });
    const verdict = describeCauses(await validation.json().catch(() => null));
    if (verdict.errors.length || (!validation.ok && !verdict.freeShippingRequired && !verdict.warnings.length))
      return { valido: false, erros: verdict.errors.length ? verdict.errors : [`Mercado Livre respondeu ${validation.status}.`],
        dica: 'Corrija e chame de novo. Atributo faltando: use ml_atributos_categoria.' };
    const avisos = [...verdict.warnings];
    if (verdict.freeShippingRequired) {
      if (payload!.shipping.mode === 'me2') { payload!.shipping.free_shipping = true; data!.shipping.free_shipping = true; }
      avisos.push('Frete grátis obrigatório neste preço: o custo do envio sai do seu repasse.');
    }
    const prices = await ml(s, `/sites/MLB/listing_prices?${new URLSearchParams({ price: String(args.preco), category_id: args.categoria, listing_type_id: args.tipo_anuncio })}`, { allow404: true }).catch(() => null);
    const fee = Array.isArray(prices) ? prices.find((p: any) => p.listing_type_id === args.tipo_anuncio) : prices;
    const tarifa = typeof fee?.sale_fee_amount === 'number' ? fee.sale_fee_amount : null;
    if (args.apenas_validar) return { valido: true, tarifa_venda: tarifa, repasse_sem_frete: tarifa === null ? null : Math.round((args.preco - tarifa) * 100) / 100, fotos: pictures.length, avisos };

    // Persist the intent before POST /items: an ambiguous result must never create a second listing.
    const attempt = randomUUID(), at = now(), actor = `mcp:${ctx.keyId}`;
    const revision = (existing?.revision ?? 0) + 1;
    await db.runTransaction(async (tx: Transaction) => {
      const current = (await tx.get(ref)).data();
      if (current?.itemId || (current && current.status !== 'draft' && current.status !== 'approved') || (current?.leaseUntil ?? 0) > Date.now()) fail('Há uma publicação em andamento para este anúncio.');
      tx.set(ref, { data: data!, tenantId: ctx.tenant, status: 'publishing', revision, createdAt: current?.createdAt ?? at, updatedAt: at, createdBy: current?.createdBy ?? actor,
        approval: { revision, actor, at, connectionStamp: s.stamp, payload: payload! }, attempt, leaseUntil: Date.now() + 180000, message: 'Enviando ao Mercado Livre pelo MCP…' });
    });
    let itemId: string | undefined, sent = false;
    const settle = (patch: Record<string, unknown>) => db.runTransaction(async tx => {
      if ((await tx.get(ref)).data()?.attempt === attempt) tx.update(ref, { ...patch, leaseUntil: 0, updatedAt: now() });
    }).catch(() => {});
    try {
      sent = true;
      const created = await raw(s, '/items', { method: 'POST', body: JSON.stringify(payload!) });
      const body = await created.json().catch(() => null);
      if (!created.ok) {
        if (created.status >= 400 && created.status < 500 && ![408, 429].includes(created.status)) {
          sent = false;
          const reasons = describeCauses(body).errors;
          await settle({ status: 'draft', approval: null, message: reasons.join('; ').slice(0, 500) || `Recusado (${created.status}).` });
          await audit('listing.create', { draftId: ref.id, ok: false, status: created.status });
          return { publicado: false, erros: reasons.length ? reasons : [`Mercado Livre respondeu ${created.status}.`] };
        }
        fail(uncertain);
      }
      if (!/^MLB\d+$/.test(body?.id) || String(body.seller_id) !== s.sellerId) fail(uncertain);
      itemId = body.id as string;
      const link = safeListingUrl(body.permalink, 'mercadolivre.com.br');
      await db.runTransaction(async tx => { tx.update(ref, { itemId, itemUrl: link, remoteStatus: body.status || 'unknown', updatedAt: now() }); });
      const desc = await raw(s, `/items/${itemId}/description?api_version=2`, { method: 'POST', body: JSON.stringify({ plain_text: data!.description }) });
      const descOk = desc.ok;
      await settle({ status: descOk ? 'published' : 'attention', message: descOk ? 'Anúncio e descrição publicados pelo MCP.' : 'Anúncio criado; falta a descrição (use Concluir publicação).' });
      await audit('listing.create', { draftId: ref.id, itemId, ok: true, description: descOk, price: args.preco, quantity: args.estoque, categoryId: args.categoria });
      return { publicado: true, anuncio: itemId, link, status: body.status, tarifa_venda: tarifa, rascunho_id: ref.id,
        avisos: [...avisos, ...(descOk ? [] : [`Descrição não foi gravada; chame ml_alterar_descricao para ${itemId}.`])] };
    } catch (e) {
      await settle({ status: sent || itemId ? 'attention' : 'draft', ...(sent || itemId ? {} : { approval: null }), ...(itemId ? { itemId } : {}),
        message: itemId ? 'Anúncio criado. Use Concluir publicação para conferir.' : sent ? uncertain : 'Publicação não enviada.' });
      throw e;
    }
  });
}

/** Public upload page + endpoint for a photo batch created by ml_link_fotos. The URL secret is the only credential. */
export function registerMcpPhotoUpload(app: Express, db: Firestore | null, store: AssetStore | null,
  claims: (uid: string) => Promise<Record<string, unknown> | undefined>) {
  const path = '/api/mcp/fotos/:token';
  async function open(token: string) {
    const m = /^([a-f0-9]{16})\.([\w-]{43})$/.exec(token);
    if (!db || !m) throw new BusinessError(404, 'Link inválido.');
    const ref = db.doc(`privateMcpPhotoBatches/${m[1]}`), batch = (await ref.get()).data();
    const a = Buffer.from(sha(m[2])), b = Buffer.from(String(batch?.secretHash ?? ''));
    if (!batch || a.length !== b.length || !timingSafeEqual(a, b)) throw new BusinessError(404, 'Link inválido.');
    if (batch.expiresAt <= now()) throw new BusinessError(410, 'Link expirado. Peça um novo ao Claude.');
    return { ref, batch };
  }
  async function access(batch: any) {
    const key = (await db!.doc(`privateMcpKeys/${batch.keyHash}`).get()).data();
    if (!key?.active || (key.expiresAt && key.expiresAt <= now()) || !validId(key.createdBy) || !key.scopes?.includes('mercadolivre:write'))
      throw new BusinessError(403, 'Chave MCP revogada.');
    let c: Record<string, unknown> | undefined;
    try { c = await claims(key.createdBy); } catch { throw new BusinessError(403, 'Responsável pela chave não encontrado.'); }
    const actor = { uid: key.createdBy, superadmin: c?.superadmin === true } as unknown as DecodedIdToken;
    return { tenant: batch.tenantId as string, actor: `mcp:${batch.keyId}`,
      access: async (tx: Transaction) => {
        await marketplaceAccess(db!, tx, batch.tenantId, actor);
        const k = (await tx.get(db!.doc(`privateMcpKeys/${batch.keyHash}`))).data();
        if (!k?.active) throw new BusinessError(403, 'Chave MCP revogada.');
      } };
  }
  app.get(path, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    let state: { total: number } | { error: string };
    try { const { batch } = await open(req.params.token); state = { total: batch.photos.length }; }
    catch (e) { state = { error: e instanceof BusinessError ? e.message : 'Indisponível.' }; res.status(e instanceof BusinessError ? e.status : 503); }
    const nonce = randomBytes(16).toString('base64');
    res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src blob:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'`);
    res.type('html').send(uploadPage(nonce, state));
  });
  const parse = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 10 * 1024 * 1024, inflate: false });
  app.post(path, (req, res, next) => parse(req, res, (err?: any) => err
    ? res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'Foto acima de 10 MiB.' : 'Não foi possível ler a imagem.' })
    : next()), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { ref, batch } = await open(req.params.token);
      if (!store) throw new BusinessError(503, 'Armazenamento indisponível.');
      if (batch.photos.length >= MAX_PHOTOS) throw new BusinessError(409, `Limite de ${MAX_PHOTOS} fotos neste lote.`);
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!Buffer.isBuffer(req.body)) throw new BusinessError(415, 'Envie JPEG, PNG ou WebP no corpo da requisição.');
      const { photo } = await storeListingPhoto(db!, store, await access(batch), mime, req.body);
      const total = await db!.runTransaction(async tx => {
        const current = (await tx.get(ref)).data()!;
        if (current.photos.includes(photo.id)) return current.photos.length;
        if (current.photos.length >= MAX_PHOTOS) throw new BusinessError(409, `Limite de ${MAX_PHOTOS} fotos neste lote.`);
        tx.update(ref, { photos: FieldValue.arrayUnion(photo.id), updatedAt: now() });
        return current.photos.length + 1;
      });
      return res.status(201).json({ foto_id: photo.id, total });
    } catch (e) {
      return res.status(e instanceof BusinessError ? e.status : 503).json({ error: e instanceof BusinessError ? e.message : 'Não foi possível salvar a foto. Tente de novo.' });
    }
  });
}

function uploadPage(nonce: string, state: { total: number } | { error: string }) {
  const initial = JSON.stringify(state).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fotos do anúncio · LabLayer</title><style nonce="${nonce}">
body{font:16px system-ui,sans-serif;margin:0;padding:24px 16px;background:#f6f6f4;color:#1d1d1b}main{max-width:520px;margin:auto}
h1{font-size:20px;margin:0 0 8px}p{color:#555;margin:0 0 16px}label{display:block;padding:28px 16px;border:2px dashed #b9b9b3;border-radius:12px;text-align:center;background:#fff;cursor:pointer;font-weight:600}
input{display:none}#grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:16px}#grid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px}
#status{margin-top:16px;font-weight:600}.err{color:#b00020}
@media (prefers-color-scheme:dark){body{background:#151514;color:#eee}p{color:#aaa}label{background:#222;border-color:#555}}
</style></head><body><main><h1>Fotos do anúncio</h1><p>Envie até ${MAX_PHOTOS} fotos (a primeira vira a capa). Depois volte ao Claude e diga “pronto”.</p>
<label id="pick">Escolher ou tirar fotos<input id="file" type="file" accept="image/*" multiple></label><div id="grid"></div><div id="status"></div></main>
<script nonce="${nonce}">
const s=${initial},st=document.getElementById('status'),grid=document.getElementById('grid'),file=document.getElementById('file');
let total=s.total||0;const show=(t,e)=>{st.textContent=t;st.className=e?'err':''};
if(s.error){show(s.error,1);document.getElementById('pick').style.display='none'}else if(total)show(total+' foto(s) já enviada(s).');
async function jpeg(f){try{const b=await createImageBitmap(f,{imageOrientation:'from-image'});const k=Math.min(1,2560/Math.max(b.width,b.height));
const c=document.createElement('canvas');c.width=Math.round(b.width*k);c.height=Math.round(b.height*k);c.getContext('2d').drawImage(b,0,0,c.width,c.height);
return await new Promise(r=>c.toBlob(r,'image/jpeg',0.9))}catch(e){return ['image/jpeg','image/png','image/webp'].includes(f.type)?f:null}}
file.onchange=async()=>{for(const f of file.files){show('Enviando '+f.name+'…');const blob=await jpeg(f);if(!blob){show('Formato não suportado: '+f.name,1);continue}
const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':blob.type||'image/jpeg'},body:blob}).catch(()=>null);
const j=r?await r.json().catch(()=>({})):{error:'Sem conexão.'};if(!r||!r.ok){show(j.error||'Falhou.',1);continue}
total=j.total;const i=document.createElement('img');i.src=URL.createObjectURL(blob);grid.append(i);show(total+' foto(s) enviada(s). Pode voltar ao Claude.')}file.value=''};
</script></body></html>`;
}
