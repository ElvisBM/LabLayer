import type { Express, Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { BusinessError, validId } from './session';
import { marketplaceAccess } from './marketplace-security';
import { normalizeMLListing } from '../shared/marketplaces/listings';
import type { TokenLoader } from './marketplace-listings';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revision = (item: any) => hash([item.id, item.last_updated, item.status, item.sub_status, item.title, item.price,
  item.available_quantity, item.sold_quantity, item.variations, item.user_product_id, item.catalog_listing, item.original_price]);
const errorText = 'Não foi possível confirmar a alteração. Reabra o anúncio para conferir o estado atual antes de tentar novamente.';
export function registerMarketplaceListingActions(app: Express, db: Firestore | null,
  verify: (token: string) => Promise<DecodedIdToken>, loadToken: TokenLoader, invalidate: () => void, fetcher: typeof fetch) {
  const base = '/api/tenants/:tenantId/marketplace-listings/:itemId';
  async function context(req: Request) {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new BusinessError(401, 'Autenticação necessária.');
    let actor: DecodedIdToken;
    try { actor = await verify(token); if (!validId(actor.uid)) throw Error(); }
    catch { throw new BusinessError(401, 'Sessão inválida.'); }
    const { tenantId: tenant, itemId: id } = req.params;
    if (!validId(tenant) || !/^MLB\d+$/.test(id)) throw new BusinessError(400, 'Anúncio inválido.');
    if (!db) throw new BusinessError(503, 'Serviço indisponível.');
    await db.runTransaction(tx => marketplaceAccess(db, tx, tenant, actor, true));
    const loaded = await loadToken(tenant, actor, false);
    async function access(tx: FirebaseFirestore.Transaction) {
      await marketplaceAccess(db!, tx, tenant, actor, true);
      const c = (await tx.get(db!.doc(`privateMarketplaceConnections/${tenant}`))).data();
      const creds = (await tx.get(db!.doc(`privateMarketplaceCredentials/${tenant}`))).data();
      if (c?.status !== 'connected' || c?.connectedAt !== loaded.context.connection.connectedAt || c?.userId !== loaded.context.connection.userId ||
        creds?.revision !== loaded.context.creds.revision || c?.credentialRevision !== creds?.revision)
        throw new BusinessError(409, 'Conexão alterada. Reabra o anúncio.');
    }
    async function remote(path: string, init: RequestInit = {}) {
      return fetcher(`https://api.mercadolibre.com${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${loaded.accessToken}`, 'Content-Type': 'application/json' } });
    }
    async function read() {
      const r = await remote(`/items/${id}?include_attributes=all`);
      if (!r.ok) throw new BusinessError(502, 'Não foi possível consultar o anúncio no Mercado Livre.');
      const item = await r.json();
      if (item.id !== id || String(item.seller_id) !== String(loaded.context.connection.userId)) throw new BusinessError(403, 'Anúncio não pertence à conta conectada.');
      return item;
    }
    async function capabilities(item: any) {
      const editable = ['active', 'paused'].includes(item.status);
      let priceReason = !editable ? 'Anúncio encerrado ou em análise.' : item.variations?.length ? 'Preço por variação: edite no Mercado Livre.' :
        item.original_price > item.price ? 'Anúncio com desconto: gerencie a promoção no Mercado Livre.' : '';
      if (!priceReason) {
        try {
          const r = await remote(`/pricing-automation/items/${id}/automation`);
          if (r.status !== 404) {
            const automation = r.ok ? await r.json() : null;
            priceReason = automation && ['ACTIVE', 'PAUSED'].includes(automation.status)
              ? 'Preço gerenciado por automatização do Mercado Livre.' : 'Não foi possível verificar a automatização de preço.';
          }
        } catch { priceReason = 'Não foi possível verificar a automatização de preço.'; }
      }
      const titleReason = !editable ? 'Anúncio encerrado ou em análise.' : item.user_product_id || item.catalog_listing
        ? 'Título gerenciado pelo produto ou catálogo do Mercado Livre.' : item.sold_quantity !== 0 ? 'Título bloqueado porque o anúncio já possui vendas.' : '';
      return { title: !titleReason, price: !priceReason, titleReason, priceReason,
        publish: item.status === 'paused' && item.available_quantity > 0 && !(item.sub_status || []).includes('out_of_stock'),
        unpublish: item.status === 'active' };
    }
    return { tenant, id, actor, access, remote, read, capabilities, sellerId: loaded.context.connection.userId };
  }
  const fail = (res: any, e: unknown) => res.status(e instanceof BusinessError ? e.status : 502).json({ error: e instanceof BusinessError ? e.message : errorText });
  app.get(base, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const c = await context(req), item = await c.read(), capabilities = await c.capabilities(item);
      await db!.runTransaction(c.access);
      return res.json({ listing: normalizeMLListing(item), revision: revision(item), capabilities });
    } catch (e) { return fail(res, e); }
  });
  app.post(`${base}/actions`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let operation: FirebaseFirestore.DocumentReference | undefined;
    let lock: FirebaseFirestore.DocumentReference | undefined;
    let sent = false;
    try {
      const c = await context(req);
      const body = req.body;
      if (!body || Object.keys(body).some(k => !['requestId','revision','action','changes'].includes(k)) ||
        !/^[\w-]{16,80}$/.test(body.requestId) || !/^[a-f0-9]{64}$/.test(body.revision) || !['publish','unpublish','edit'].includes(body.action))
        throw new BusinessError(400, 'Alteração inválida. Reabra o anúncio.');
      const intentHash = hash([c.actor.uid, c.sellerId, c.id, body.action, body.revision, body.changes ?? null]);
      const op = db!.doc(`privateMarketplaceActions/${hash([c.tenant, body.requestId])}`);
      const itemLock = db!.doc(`privateMarketplaceActionLocks/${hash([c.sellerId, c.id])}`);
      const previous = await db!.runTransaction(async tx => {
        await c.access(tx);
        return (await tx.get(op)).data();
      });
      if (previous) {
        if (previous.intentHash !== intentHash) throw new BusinessError(409, 'Identificador de alteração já utilizado. Reabra o anúncio.');
        if (previous.status === 'confirmed') return res.json({ confirmed: true, listing: previous.listing });
        throw new BusinessError(409, 'Esta alteração já foi enviada. Reabra o anúncio para conferir o resultado.');
      }
      const item = await c.read();
      if (revision(item) !== body.revision) throw new BusinessError(409, 'O anúncio mudou desde a abertura. Reabra para conferir os dados atuais.');
      const payload: Record<string, unknown> = {};
      if (body.action === 'edit') {
        const changes = body.changes;
        if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some(k => !['title','price'].includes(k)))
          throw new BusinessError(400, 'Informe apenas título ou preço.');
        const caps = await c.capabilities(item);
        if ('title' in changes) {
          if (!caps.title) throw new BusinessError(409, caps.titleReason);
          if (typeof changes.title !== 'string' || !changes.title.trim() || changes.title.trim().length > 60) throw new BusinessError(400, 'Título deve ter entre 1 e 60 caracteres.');
          payload.title = changes.title.trim();
        }
        if ('price' in changes) {
          if (!caps.price) throw new BusinessError(409, caps.priceReason);
          if (typeof changes.price !== 'number' || !Number.isFinite(changes.price) || changes.price <= 0 || changes.price > 99999999 || Math.abs(changes.price * 100 - Math.round(changes.price * 100)) > 0.000001)
            throw new BusinessError(400, 'Preço deve ser positivo, com até duas casas decimais.');
          payload.price = changes.price;
        }
      } else {
        if (body.changes !== undefined) throw new BusinessError(400, 'Mudança de status não pode alterar outros campos.');
        if (body.action === 'publish' && (item.status !== 'paused' || !(item.available_quantity > 0) || (item.sub_status || []).includes('out_of_stock')))
          throw new BusinessError(409, 'Só é possível publicar anúncios pausados com estoque disponível. Encerrados exigem republicação no Mercado Livre.');
        if (body.action === 'unpublish' && item.status !== 'active') throw new BusinessError(409, 'Só é possível despublicar anúncios ativos.');
        payload.status = body.action === 'publish' ? 'active' : 'paused';
      }
      const before = Object.fromEntries(Object.keys(payload).map(field => [field, item[field] ?? null]));
      // Persist intent before the external write. A timeout never triggers an automatic retry.
      await db!.runTransaction(async tx => {
        await c.access(tx);
        const prior = await tx.get(op), guard = (await tx.get(itemLock)).data();
        if (prior.exists) throw new BusinessError(409, 'Alteração já enviada. Reabra o anúncio.');
        if (guard?.until > Date.now()) throw new BusinessError(409, 'Há uma alteração em andamento neste anúncio. Aguarde.');
        tx.create(op, { intentHash, tenant: c.tenant, sellerId: c.sellerId, itemId: c.id, actor: c.actor.uid, action: body.action, before, payload, status: 'processing', createdAt: new Date().toISOString() });
        tx.set(itemLock, { request: op.id, until: Date.now() + 120000 });
      });
      operation = op; lock = itemLock;
      // Detect edits that happened while checking automation or acquiring the lock.
      if (revision(await c.read()) !== body.revision) throw new BusinessError(409, 'O anúncio mudou. Reabra para conferir os dados atuais.');
      await db!.runTransaction(c.access);
      invalidate(); sent = true;
      const response = await c.remote(`/items/${c.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      if (!response.ok) {
        const rejected = response.status >= 400 && response.status < 500;
        if (rejected) sent = false;
        throw new BusinessError(502, rejected ? 'O Mercado Livre recusou a alteração. Confira as restrições do anúncio na plataforma e reabra antes de tentar novamente.' : errorText);
      }
      const updated = await c.read();
      if (!Object.entries(payload).every(([k, v]) => updated[k] === v)) throw new BusinessError(502, errorText);
      const listing = normalizeMLListing(updated);
      await db!.runTransaction(async tx => {
        tx.update(op, { status: 'confirmed', listing, finishedAt: new Date().toISOString() });
        tx.delete(itemLock);
        tx.create(db!.collection(`tenants/${c.tenant}/auditLogs`).doc(), { operation: `marketplace.listing.${body.action}`, actor: c.actor.uid,
          provider: 'mercadolivre', itemId: c.id, requestId: body.requestId, before, changes: payload, createdAt: new Date().toISOString() });
      });
      operation = undefined; invalidate();
      await db!.runTransaction(c.access);
      return res.json({ confirmed: true, listing });
    } catch (e) {
      if (operation && db) {
        await db.runTransaction(async tx => {
          const guard = lock ? (await tx.get(lock)).data() : null;
          tx.update(operation!, { status: sent ? 'uncertain' : 'rejected', finishedAt: new Date().toISOString() });
          // Keep a short lock after an uncertain network result to prevent immediate repeat.
          if (!sent && lock && guard?.request === operation!.id) tx.delete(lock);
        }).catch(() => {});
        invalidate();
      }
      return fail(res, e);
    }
  });
}
