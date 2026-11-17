import type { Express, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';
import { BusinessError, validId } from './session';
import { marketplaceAccess, marketplaceViewerAccess } from './marketplace-security';
import { openTikTok, sealTikTok, TikTokClient, textValue } from './tiktok-client';
import { normalizeTikTokListing } from '../shared/marketplaces/tiktok';
import type { ListingResult } from '../shared/marketplaces/listings';

const COOKIE = '__Host-lablayer-tiktok-oauth';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const nonce = () => randomBytes(32).toString('base64url');
const base = '/api/tenants/:tenantId/integrations/tiktokshop';
function shape(body: any, keys: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k)))
    throw new BusinessError(400, 'Dados inválidos. Recarregue a configuração.');
}
export function tikTokMetadata(creds: any, c: any) {
  if (!c) return { status: 'not-connected', shops: [], connectionId: null, shop: null };
  const compatible = c.credentialRevision === creds?.revision && c.appKey === creds?.appKey;
  return { status: compatible ? c.status : 'reconnect-required', connectionId: c.connectionId,
    shops: compatible ? (c.shops || []).map(({ id, name, region }: any) => ({ id, name, region })) : [],
    shop: c.shop ? { id: c.shop.id, name: c.shop.name, region: c.shop.region } : null,
    expiresAt: c.expiresAt, checkedAt: c.checkedAt || null };
}
export function registerTikTokRoutes(app: Express, db: Firestore | null, verify: (token: string) => Promise<DecodedIdToken>, key: Buffer | null, fetcher: typeof fetch = fetch) {
  const credentialRef = (tenant: string) => db!.doc(`privateTikTokCredentials/${tenant}`);
  const connectionRef = (tenant: string) => db!.doc(`privateTikTokConnections/${tenant}`);
  const stateRef = (id: string) => db!.doc(`privateTikTokOAuthStates/${id}`);
  const latestRef = (tenant: string) => db!.doc(`privateTikTokOAuthAttempts/${tenant}`);
  const settings = (creds: any, c: any) => ({ appKey: creds?.appKey || '', serviceId: creds?.serviceId || '', hasSecret: !!creds?.secret,
    revision: creds?.revision || 0, storageReady: !!key, connection: tikTokMetadata(creds, c) });
  function audit(tx: Transaction, tenant: string, actor: string, operation: string, details: Record<string, unknown> = {}) {
    tx.create(db!.collection(`tenants/${tenant}/auditLogs`).doc(), { provider: 'tiktok', operation, actor, ...details, createdAt: new Date().toISOString() });
  }
  async function actor(req: Request) {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new BusinessError(401, 'Autenticação necessária.');
    try { const user = await verify(token); if (!validId(user.uid)) throw Error(); return user; }
    catch { throw new BusinessError(401, 'Sessão inválida.'); }
  }
  function ready(tenant: unknown): asserts tenant is string {
    if (!validId(tenant)) throw new BusinessError(400, 'Empresa inválida.');
    if (!db) throw new BusinessError(503, 'Banco indisponível.');
  }
  const protectedStorage = () => { if (!key) throw new BusinessError(503, 'Armazenamento protegido indisponível.'); };
  const client = (tenant: string, creds: any) => new TikTokClient(creds.appKey, openTikTok(key!, tenant + ':credentials', creds.secret), fetcher);
  const access = (tx: Transaction, tenant: string, user: DecodedIdToken, viewer = false) => viewer
    ? marketplaceViewerAccess(db!, tx, tenant, user) : marketplaceAccess(db!, tx, tenant, user, true);
  function handler(fn: (req: Request, res: Response, tenant: string, user: DecodedIdToken) => Promise<unknown>) {
    return async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      try { const user = await actor(req), tenant = req.params.tenantId; ready(tenant); await fn(req, res, tenant, user); }
      catch (e) { res.status(e instanceof BusinessError ? e.status : 503).json({ error: e instanceof BusinessError ? e.message : 'Não foi possível confirmar a operação. Recarregue a configuração antes de tentar novamente.' }); }
    };
  }
  app.get(base + '/credentials', handler(async (_req, res, tenant, user) => {
    res.json(await db!.runTransaction(async tx => { await access(tx, tenant, user); return settings((await tx.get(credentialRef(tenant))).data(), (await tx.get(connectionRef(tenant))).data()); }));
  }));
  app.post(base + '/credentials', handler(async (req, res, tenant, user) => {
    protectedStorage(); const b = req.body; shape(b, ['appKey', 'appSecret', 'serviceId', 'expectedRevision']);
    if (!textValue(b.appKey, 128) || !/^[a-zA-Z0-9_-]+$/.test(b.appKey) || !textValue(b.serviceId, 40) || !/^\d+$/.test(b.serviceId) ||
      typeof b.appSecret !== 'string' || (b.appSecret !== '' && !/^[\x21-\x7e]{16,512}$/.test(b.appSecret)) || !Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 0)
      throw new BusinessError(400, 'Confira App Key, App Secret e Service ID do aplicativo.');
    const result = await db!.runTransaction(async tx => {
      await access(tx, tenant, user);
      const previous = (await tx.get(credentialRef(tenant))).data(), connection = (await tx.get(connectionRef(tenant))).data();
      if ((previous?.revision || 0) !== b.expectedRevision) throw new BusinessError(409, 'Configuração alterada. Recarregue antes de salvar.');
      if (!b.appSecret && (!previous?.secret || previous.appKey !== b.appKey)) throw new BusinessError(400, 'Informe o App Secret deste aplicativo.');
      const next = { appKey: b.appKey, serviceId: b.serviceId, secret: b.appSecret ? sealTikTok(key!, tenant + ':credentials', b.appSecret) : previous!.secret,
        revision: b.expectedRevision + 1, updatedAt: Date.now(), updatedBy: user.uid };
      openTikTok(key!, tenant + ':credentials', next.secret);
      tx.set(credentialRef(tenant), next); audit(tx, tenant, user.uid, 'tiktok.credentials.saved', { revision: next.revision });
      return settings(next, connection);
    }); res.json(result);
  }));
  app.post(base + '/connect', handler(async (req, res, tenant, user) => {
    protectedStorage(); shape(req.body, ['expectedRevision']);
    if (!Number.isSafeInteger(req.body.expectedRevision)) throw new BusinessError(400, 'Recarregue as credenciais.');
    const state = nonce(), browser = nonce(), stateHash = hash(state);
    const serviceId = await db!.runTransaction(async tx => {
      await access(tx, tenant, user); const creds = (await tx.get(credentialRef(tenant))).data();
      if (!creds?.secret || creds.revision !== req.body.expectedRevision) throw new BusinessError(409, 'Salve e recarregue as credenciais antes de conectar.');
      openTikTok(key!, tenant + ':credentials', creds.secret);
      tx.create(stateRef(stateHash), { tenant, uid: user.uid, superadmin: user.superadmin === true, revision: creds.revision,
        browserHash: hash(browser), status: 'pending', expiresAt: Date.now() + 600000 });
      tx.set(latestRef(tenant), { stateHash }); audit(tx, tenant, user.uid, 'tiktok.oauth.started'); return creds.serviceId;
    });
    const url = new URL('https://services.tiktokshop.com/open/authorize');
    url.search = new URLSearchParams({ service_id: serviceId, state }).toString();
    res.cookie(COOKIE, browser, { ...cookieOptions, maxAge: 600000 }); res.json({ authorizationUrl: url.toString() });
  }));
  app.get('/api/integrations/tiktokshop/callback', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    let claimed: any, stateHash = '';
    async function finish(result: string) {
      if (claimed && db) await db.runTransaction(async tx => { const ref = stateRef(stateHash); if ((await tx.get(ref)).data()?.status === 'processing') tx.update(ref, { status: 'failed' }); }).catch(() => {});
      res.clearCookie(COOKIE, cookieOptions); return res.redirect(303, '/?view=configuracoes&tiktokshop=' + result);
    }
    try {
      if (!db || !key) return finish('unavailable');
      const s = req.query.state, browser = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
      if (!textValue(s, 43) || !/^[\w-]{43}$/.test(s) || !browser || !/^[\w-]{43}$/.test(browser)) return finish('invalid-state');
      stateHash = hash(s);
      claimed = await db.runTransaction(async tx => {
        const attempt = (await tx.get(stateRef(stateHash))).data();
        if (!attempt || attempt.status !== 'pending' || attempt.expiresAt < Date.now() || attempt.browserHash !== hash(browser)) throw new BusinessError(400, 'Invalid state');
        await access(tx, attempt.tenant, attempt as DecodedIdToken);
        const creds = (await tx.get(credentialRef(attempt.tenant))).data(), latest = (await tx.get(latestRef(attempt.tenant))).data();
        if (creds?.revision !== attempt.revision || latest?.stateHash !== stateHash) throw new BusinessError(409, 'Stale state');
        tx.update(stateRef(stateHash), { status: 'processing' }); return { ...attempt, creds };
      });
      if (req.query.error !== undefined) return finish('denied');
      if (!textValue(req.query.code, 2048)) return finish('unavailable');
      const api = client(claimed.tenant, claimed.creds), tokens = await api.token(req.query.code), shops = await api.shops(tokens.accessToken);
      const eligible = shops.filter((s: any) => s.region === 'BR');
      if (!eligible.length) return finish('no-br-shop');
      await db.runTransaction(async tx => {
        await access(tx, claimed.tenant, claimed);
        const creds = (await tx.get(credentialRef(claimed.tenant))).data(), latest = (await tx.get(latestRef(claimed.tenant))).data();
        if (creds?.revision !== claimed.revision || latest?.stateHash !== stateHash || claimed.expiresAt < Date.now()) throw new BusinessError(409, 'Stale state');
        tx.set(connectionRef(claimed.tenant), { status: 'select-shop', appKey: creds.appKey, credentialRevision: creds.revision,
          connectionId: nonce(), openId: tokens.openId, tokens: sealTikTok(key!, claimed.tenant + ':tokens', tokens),
          expiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt, scopes: tokens.scopes,
          shops: eligible, shop: null, connectedAt: Date.now(), connectedBy: claimed.uid });
        tx.update(stateRef(stateHash), { status: 'complete' }); audit(tx, claimed.tenant, claimed.uid, 'tiktok.oauth.authorized');
      }); return finish('select-shop');
    } catch (e) { return finish(e instanceof BusinessError && e.status < 500 ? 'invalid-state' : 'unavailable'); }
  });
  async function context(tenant: string, user: DecodedIdToken, viewer = false) {
    protectedStorage(); let lease: string | undefined;
    try {
      const ctx = await db!.runTransaction(async tx => {
        await access(tx, tenant, user, viewer);
        const creds = (await tx.get(credentialRef(tenant))).data(), c = (await tx.get(connectionRef(tenant))).data();
        if (!creds?.secret || !c || !['connected', 'select-shop'].includes(tikTokMetadata(creds, c).status)) throw new BusinessError(409, 'Autorize novamente o TikTok Shop nas configurações.');
        if (c.refreshLease) throw new BusinessError(409, c.refreshLeaseUntil < Date.now() ? 'Renovação não confirmada. Reconecte o TikTok Shop.' : 'Renovação em andamento. Aguarde alguns segundos.');
        if (c.refreshExpiresAt <= Date.now()) throw new BusinessError(409, 'Autorização expirada. Reconecte o TikTok Shop.');
        const refresh = !Number.isFinite(c.expiresAt) || c.expiresAt <= Date.now() + 60000;
        if (refresh) { lease = nonce(); tx.update(connectionRef(tenant), { refreshLease: lease, refreshLeaseUntil: Date.now() + 90000 }); }
        return { creds, c, refresh };
      });
      const api = client(tenant, ctx.creds); let tokens = openTikTok(key!, tenant + ':tokens', ctx.c.tokens);
      if (ctx.refresh) {
        const renewed = await api.token(tokens.refreshToken, true);
        if (renewed.openId !== ctx.c.openId) throw new BusinessError(502, 'A identidade retornada pelo TikTok Shop diverge da conexão. Reconecte.');
        await db!.runTransaction(async tx => {
          await access(tx, tenant, user, viewer);
          const c = (await tx.get(connectionRef(tenant))).data(), creds = (await tx.get(credentialRef(tenant))).data();
          if (c?.connectionId !== ctx.c.connectionId || c?.refreshLease !== lease || creds?.revision !== ctx.creds.revision) throw new BusinessError(409, 'Conexão alterada. Recarregue.');
          tx.update(connectionRef(tenant), { tokens: sealTikTok(key!, tenant + ':tokens', renewed), expiresAt: renewed.expiresAt,
            refreshExpiresAt: renewed.refreshExpiresAt, scopes: renewed.scopes, refreshLease: null, refreshLeaseUntil: null });
          audit(tx, tenant, user.uid, 'tiktok.oauth.refreshed');
        }); lease = undefined; tokens = renewed;
      }
      return { ...ctx, api, tokens };
    } catch (e) {
      if (lease) await db!.runTransaction(async tx => { const c = (await tx.get(connectionRef(tenant))).data(); if (c?.refreshLease === lease) tx.update(connectionRef(tenant), { status: 'reconnect-required', refreshLease: null }); }).catch(() => {});
      throw e;
    }
  }
  async function recheck(tx: Transaction, tenant: string, user: DecodedIdToken, ctx: Awaited<ReturnType<typeof context>>, viewer = false) {
    await access(tx, tenant, user, viewer);
    const c = (await tx.get(connectionRef(tenant))).data(), creds = (await tx.get(credentialRef(tenant))).data();
    if (c?.connectionId !== ctx.c.connectionId || creds?.revision !== ctx.creds.revision || c?.shop?.id !== ctx.c.shop?.id ||
      !['connected', 'select-shop'].includes(c?.status)) throw new BusinessError(409, 'Conexão alterada. Recarregue a lista.');
    return { c, creds };
  }
  for (const select of [false, true]) app.post(base + (select ? '/select-shop' : '/check'), handler(async (req, res, tenant, user) => {
    shape(req.body, select ? ['shopId', 'connectionId'] : []);
    const ctx = await context(tenant, user);
    if (select && (req.body.connectionId !== ctx.c.connectionId || !textValue(req.body.shopId, 40))) throw new BusinessError(409, 'Recarregue e selecione uma loja autorizada.');
    const shops = (await ctx.api.shops(ctx.tokens.accessToken)).filter((s: any) => s.region === 'BR');
    const shopId = select ? req.body.shopId : ctx.c.shop?.id;
    const shop = shops.find((s: any) => s.id === shopId) || null;
    if (select && !shop) throw new BusinessError(400, 'Loja brasileira não autorizada para esta conexão.');
    const result = await db!.runTransaction(async tx => {
      const { c, creds } = await recheck(tx, tenant, user, ctx);
      const changes = { shops, shop, status: shop ? 'connected' : 'select-shop', checkedAt: Date.now() };
      tx.update(connectionRef(tenant), changes); audit(tx, tenant, user.uid, select ? 'tiktok.shop.selected' : 'tiktok.connection.checked', { shopId: shop?.id || null });
      return settings(creds, { ...c, ...changes });
    }); res.json(result);
  }));

  const cache = new Map<string, { expires: number; result: ListingResult }>();
  const pending = new Map<string, Promise<ListingResult>>();
  app.get(base + '/listings', handler(async (req, res, tenant, user) => {
    const status = await db!.runTransaction(async tx => { await access(tx, tenant, user, true); return tikTokMetadata((await tx.get(credentialRef(tenant))).data(), (await tx.get(connectionRef(tenant))).data()).status; });
    if (status !== 'connected') { res.json({ status, listings: [], total: null, complete: false }); return; }
    const ctx = await context(tenant, user, true);
    if (!ctx.c.shop?.cipher) throw new BusinessError(409, 'Selecione a loja nas configurações.');
    const cacheKey = [tenant, ctx.c.connectionId, ctx.creds.revision, ctx.c.shop.id].join(':');
    async function load(): Promise<ListingResult> {
      const rows = new Map<string, ReturnType<typeof normalizeTikTokListing>>();
      let page = '', total = 0, complete = false; const seen = new Set<string>(), deadline = Date.now() + 25000;
      for (let i = 0; i < 10; i++) {
        const data = await ctx.api.api('/product/202309/products/search', ctx.tokens.accessToken, { shop_cipher: ctx.c.shop.cipher, page_size: '100', ...(page ? { page_token: page } : {}) }, {});
        if (!Array.isArray(data.products) || data.products.length > 100 || !Number.isSafeInteger(data.total_count) || data.total_count < 0) throw new BusinessError(502, 'Resposta de anúncios inválida do TikTok Shop.');
        total = Math.max(total, data.total_count);
        for (const product of data.products) { const row = normalizeTikTokListing(product); rows.set(row.id, row); }
        if (data.next_page_token !== undefined && typeof data.next_page_token !== 'string') throw new BusinessError(502, 'Paginação inválida do TikTok Shop.');
        page = data.next_page_token || '';
        if (!page) { complete = rows.size === total; break; }
        if (seen.has(page) || page.length > 4096 || Date.now() > deadline) break;
        seen.add(page);
      }
      return { listings: [...rows.values()], total, complete, seller: ctx.c.shop.name, fetchedAt: new Date().toISOString(), canManage: false };
    }
    let result = req.query.refresh !== '1' && cache.get(cacheKey)?.expires! > Date.now() ? cache.get(cacheKey)!.result : undefined;
    if (!result) {
      if (!pending.has(cacheKey)) {
        if (pending.size >= 100) throw new BusinessError(429, 'Muitas consultas em andamento. Aguarde.');
        pending.set(cacheKey, load().finally(() => pending.delete(cacheKey)));
      }
      result = await pending.get(cacheKey)!;
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { expires: Date.now() + 60000, result });
    }
    await db!.runTransaction(tx => recheck(tx, tenant, user, ctx, true));
    res.json({ status: 'connected', ...result });
  }));
}
