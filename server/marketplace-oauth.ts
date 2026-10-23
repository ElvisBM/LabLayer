import type { Express, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';
import { BusinessError, validId } from './session';
import { marketplaceAccess, marketplaceViewerAccess, openMarketplaceSecret, sealMarketplaceSecret } from './marketplace-security';

import { registerMarketplaceListingRoutes } from './marketplace-listings';

export const ML_REDIRECT = 'https://app.lablayer.com.br/api/integrations/mercadolivre/callback';
const RETURN_TO = '/?view=configuracoes&mercadolivre=';
const COOKIE = '__Host-lablayer-ml-oauth';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const nonce = () => randomBytes(32).toString('base64url');
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
const scalar = (value: unknown, max = 2048): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const userId = (value: unknown): string => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Invalid user id');
  const id = String(value);
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new Error('Invalid user id');
  return id;
};

export function connectionMetadata(credentials: any, connection: any) {
  if (!connection) return { status: 'not-connected' };
  const compatible = connection.clientId === credentials?.clientId && connection.credentialRevision === credentials?.revision;
  return {
    status: compatible ? connection.status : 'reconnect-required',
    userId: connection.userId, nickname: connection.nickname,
    connectedAt: connection.connectedAt, expiresAt: connection.expiresAt, checkedAt: connection.checkedAt || null,
  };
}

class ProviderError extends Error {
  constructor(public reason: string) { super('Mercado Livre indisponível'); }
}

export function registerMarketplaceOAuthRoutes(
  app: Express, db: Firestore | null, verify: (token: string) => Promise<DecodedIdToken>, key: Buffer | null,
  fetcher: typeof fetch = fetch,
) {
  const base = '/api/tenants/:tenantId/integrations/mercadolivre';
  async function identity(req: Request) {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new BusinessError(401, 'Autenticação necessária.');
    try {
      const actor = await verify(token);
      if (!validId(actor.uid)) throw Error();
      return actor;
    } catch { throw new BusinessError(401, 'Sessão inválida.'); }
  }
  function ready(tenant: unknown): asserts tenant is string {
    if (!validId(tenant)) throw new BusinessError(400, 'Empresa inválida.');
    if (!db || !key) throw new BusinessError(503, 'Armazenamento protegido indisponível.');
  }
  function fail(res: Response, error: unknown) {
    if (error instanceof BusinessError) return res.status(error.status).json({ error: error.message });
    return res.status(503).json({ error: 'Não foi possível confirmar a conexão. Recarregue e tente novamente.' });
  }
  async function provider(path: '/oauth/token' | '/users/me', init: RequestInit) {
    let response: globalThis.Response;
    try { response = await fetcher(`https://api.mercadolibre.com${path}`, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch { throw new ProviderError('unavailable'); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = ['invalid_client', 'invalid_grant', 'invalid_scope', 'unauthorized_client', 'unauthorized_application'].includes(body?.error)
        ? String(body.error) : response.status === 401 ? 'unauthorized' : 'unavailable';
      throw new ProviderError(reason);
    }
    return body;
  }
  function tokens(value: any) {
    if (!scalar(value?.access_token, 8192) || !scalar(value?.refresh_token, 8192) ||
      !Number.isSafeInteger(value?.expires_in) || value.expires_in <= 0 || value.expires_in > 604800 ||
      String(value?.token_type).toLowerCase() !== 'bearer') throw new ProviderError('invalid-response');
    return { accessToken: value.access_token, refreshToken: value.refresh_token, userId: userId(value.user_id),
      expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString() };
  }
  function exchange(form: Record<string, string>) {
    return provider('/oauth/token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  }
  function audit(tx: FirebaseFirestore.Transaction, tenant: string, actor: string, operation: string, sellerId?: string) {
    tx.create(db!.collection(`tenants/${tenant}/auditLogs`).doc(), {
      operation, provider: 'mercadolivre', actor, createdAt: new Date().toISOString(), ...(sellerId ? { sellerId } : {}),
    });
  }

  app.post(`${base}/connect`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const actor = await identity(req), tenant = req.params.tenantId; ready(tenant);
      if (!req.body || Object.keys(req.body).some(k => k !== 'expectedRevision') || !Number.isSafeInteger(req.body.expectedRevision))
        throw new BusinessError(400, 'Recarregue as credenciais antes de conectar.');
      const state = nonce(), browser = nonce(), verifier = nonce(), stateHash = hash(state);
      const clientId = await db!.runTransaction(async tx => {
        await marketplaceAccess(db!, tx, tenant, actor);
        const creds = (await tx.get(db!.doc(`privateMarketplaceCredentials/${tenant}`))).data();
        if (!creds?.secret) throw new BusinessError(409, 'Salve as credenciais antes de conectar.');
        if (creds.revision !== req.body.expectedRevision) throw new BusinessError(409, 'Credenciais alteradas. Recarregue antes de conectar.');
        openMarketplaceSecret(key!, tenant, creds.secret);
        tx.create(db!.doc(`privateMarketplaceOAuthStates/${stateHash}`), {
          tenant, uid: actor.uid, superadmin: actor.superadmin === true, clientId: creds.clientId, revision: creds.revision,
          browserHash: hash(browser), verifier: sealMarketplaceSecret(key!, `${tenant}:pkce`, verifier),
          status: 'pending', expiresAt: Date.now() + 600000, createdAt: new Date().toISOString(),
        });
        tx.set(db!.doc(`privateMarketplaceOAuthAttempts/${tenant}`), { stateHash });
        audit(tx, tenant, actor.uid, 'marketplace.oauth.started');
        return creds.clientId;
      });
      const url = new URL('https://auth.mercadolivre.com.br/authorization');
      url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: ML_REDIRECT, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      res.cookie(COOKIE, browser, { ...cookieOptions, maxAge: 600000 });
      return res.json({ authorizationUrl: url.toString() });
    } catch (error) { return fail(res, error); }
  });

  // The callback never accepts a tenant from the browser. State is single-use and browser-bound.
  app.get('/api/integrations/mercadolivre/callback', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    let claimed: any = null;
    let stateHash = '';
    const finish = async (result: string) => {
      // Consume and clear the verifier before returning to the UI, even on cancellation.
      if (claimed && db) await db.runTransaction(async tx => {
        const ref = db!.doc(`privateMarketplaceOAuthStates/${stateHash}`), current = (await tx.get(ref)).data();
        if (current?.status === 'processing') tx.update(ref, { status: 'failed', verifier: null });
      }).catch(() => {});
      res.clearCookie(COOKIE, cookieOptions);
      return res.redirect(303, RETURN_TO + encodeURIComponent(result));
    };
    try {
      if (!db || !key) return finish('unavailable');
      const state = req.query.state;
      const browser = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!scalar(state, 43) || !/^[\w-]{43}$/.test(state) || !browser || !/^[\w-]{43}$/.test(browser)) return finish('invalid-state');
      stateHash = hash(state);
      claimed = await db.runTransaction(async tx => {
        const ref = db!.doc(`privateMarketplaceOAuthStates/${stateHash}`);
        const attempt = (await tx.get(ref)).data();
        if (!attempt || attempt.status !== 'pending' || attempt.expiresAt < Date.now() || attempt.browserHash !== hash(browser))
          throw new BusinessError(400, 'Invalid state');
        const latest = (await tx.get(db!.doc(`privateMarketplaceOAuthAttempts/${attempt.tenant}`))).data();
        const creds = (await tx.get(db!.doc(`privateMarketplaceCredentials/${attempt.tenant}`))).data();
        await marketplaceAccess(db!, tx, attempt.tenant, { uid: attempt.uid, superadmin: attempt.superadmin }, true);
        if (latest?.stateHash !== stateHash || creds?.revision !== attempt.revision || creds?.clientId !== attempt.clientId)
          throw new BusinessError(409, 'Stale state');
        tx.update(ref, { status: 'processing' });
        return { ...attempt, secret: creds.secret };
      });
      if (req.query.error !== undefined) return finish('denied');
      if (!scalar(req.query.code)) throw new ProviderError('invalid-response');
      const token = tokens(await exchange({ grant_type: 'authorization_code', client_id: claimed.clientId,
        client_secret: openMarketplaceSecret(key, claimed.tenant, claimed.secret), code: req.query.code,
        redirect_uri: ML_REDIRECT, code_verifier: openMarketplaceSecret(key, `${claimed.tenant}:pkce`, claimed.verifier) }));
      const seller = await provider('/users/me', { headers: { Authorization: `Bearer ${token.accessToken}` } });
      if (userId(seller.id) !== token.userId || !scalar(seller.nickname, 160)) throw new ProviderError('invalid-response');
      await db.runTransaction(async tx => {
        const creds = (await tx.get(db!.doc(`privateMarketplaceCredentials/${claimed.tenant}`))).data();
        const latest = (await tx.get(db!.doc(`privateMarketplaceOAuthAttempts/${claimed.tenant}`))).data();
        await marketplaceAccess(db!, tx, claimed.tenant, { uid: claimed.uid, superadmin: claimed.superadmin }, true);
        if (creds?.revision !== claimed.revision || latest?.stateHash !== stateHash) throw new BusinessError(409, 'Stale authorization');
        const now = new Date().toISOString();
        tx.set(db!.doc(`privateMarketplaceConnections/${claimed.tenant}`), {
          status: 'connected', clientId: claimed.clientId, credentialRevision: claimed.revision,
          userId: token.userId, nickname: seller.nickname, expiresAt: token.expiresAt,
          tokens: sealMarketplaceSecret(key!, `${claimed.tenant}:oauth`, JSON.stringify({ accessToken: token.accessToken, refreshToken: token.refreshToken })),
          connectedAt: now, checkedAt: now, updatedAt: now, connectedBy: claimed.uid,
        });
        tx.update(db!.doc(`privateMarketplaceOAuthStates/${stateHash}`), { status: 'complete', verifier: null });
        audit(tx, claimed.tenant, claimed.uid, 'marketplace.oauth.connected', token.userId);
      });
      return finish('connected');
    } catch (error) {
      const reason = error instanceof ProviderError ? error.reason : error instanceof BusinessError ? 'invalid-state' : 'unavailable';
      return finish(reason);
    }
  });

  app.get('/api/integrations/mercadolivre/auth', (_req, res) => res.status(409).set('Cache-Control', 'no-store').json({ error: 'Use Conectar Mercado Livre nas Integrações da empresa.' }));

  async function connectionToken(tenant: string, actor: DecodedIdToken, viewer = false) {
    ready(tenant);
    let lease: string | undefined;
    const access = viewer ? marketplaceViewerAccess : marketplaceAccess;
    try {
      const context = await db!.runTransaction(async tx => {
        await access(db!, tx, tenant!, actor);
        const creds = (await tx.get(db!.doc(`privateMarketplaceCredentials/${tenant}`))).data();
        const ref = db!.doc(`privateMarketplaceConnections/${tenant}`), connection = (await tx.get(ref)).data();
        if (!connection || connectionMetadata(creds, connection).status !== 'connected') throw new BusinessError(409, 'Conecte novamente a conta do Mercado Livre.');
        if (connection.refreshLease) {
          // A refresh token is single-use. A crashed/uncertain refresh must never reuse it.
          if (connection.refreshLeaseUntil < Date.now()) throw new BusinessError(409, 'Renovação não confirmada. Conecte novamente a conta.');
          throw new BusinessError(409, 'A conexão está sendo verificada. Aguarde alguns segundos.');
        }
        const refresh = Date.parse(connection.expiresAt) <= Date.now();
        if (refresh) {
          lease = nonce();
          tx.update(ref, { refreshLease: lease, refreshLeaseUntil: Date.now() + 90000 });
        }
        return { creds: creds!, connection, refresh };
      });
      let storedTokens = JSON.parse(openMarketplaceSecret(key!, `${tenant}:oauth`, context.connection.tokens));
      if (context.refresh) {
        const renewed = tokens(await exchange({ grant_type: 'refresh_token', client_id: context.creds.clientId,
          client_secret: openMarketplaceSecret(key!, tenant, context.creds.secret), refresh_token: storedTokens.refreshToken }));
        if (renewed.userId !== context.connection.userId) throw new ProviderError('invalid-response');
        storedTokens = { accessToken: renewed.accessToken, refreshToken: renewed.refreshToken };
        // Persist rotated tokens before /users/me so a temporary profile failure cannot lose them.
        await db!.runTransaction(async tx => {
          const ref = db!.doc(`privateMarketplaceConnections/${tenant}`), current = (await tx.get(ref)).data();
          const creds = (await tx.get(db!.doc(`privateMarketplaceCredentials/${tenant}`))).data();
          await access(db!, tx, tenant!, actor);
          if (current?.refreshLease !== lease || creds?.revision !== context.creds.revision) throw new BusinessError(409, 'Conexão alterada. Recarregue.');
          tx.update(ref, { tokens: sealMarketplaceSecret(key!, `${tenant}:oauth`, JSON.stringify(storedTokens)), expiresAt: renewed.expiresAt,
            refreshLease: null, refreshLeaseUntil: null, updatedAt: new Date().toISOString() });
          audit(tx, tenant!, actor.uid, 'marketplace.oauth.refreshed', renewed.userId);
        });
        lease = undefined;
      }
      return { context, accessToken: storedTokens.accessToken as string };
    } catch (error) {
      if (tenant && lease && db) await db.runTransaction(async tx => {
        const ref = db!.doc(`privateMarketplaceConnections/${tenant}`), current = (await tx.get(ref)).data();
        if (current?.refreshLease === lease) tx.update(ref, { status: 'reconnect-required', refreshLease: null, refreshLeaseUntil: null });
      }).catch(() => {});
      throw error;
    }
  }
  registerMarketplaceListingRoutes(app, db, verify, connectionToken, fetcher);

  app.post(`${base}/check`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let tenant: string | undefined;
    try {
      const actor = await identity(req); const candidate = req.params.tenantId; ready(candidate); tenant = candidate;
      const { context, accessToken } = await connectionToken(tenant, actor);
      const seller = await provider('/users/me', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (userId(seller.id) !== context.connection.userId || !scalar(seller.nickname, 160)) throw new ProviderError('invalid-response');
      const result = await db!.runTransaction(async tx => {
        const ref = db!.doc(`privateMarketplaceConnections/${tenant}`), current = (await tx.get(ref)).data();
        const creds = (await tx.get(db!.doc(`privateMarketplaceCredentials/${tenant}`))).data();
        await marketplaceAccess(db!, tx, tenant!, actor);
        if (current?.connectedAt !== context.connection.connectedAt || current?.userId !== context.connection.userId || creds?.revision !== context.creds.revision)
          throw new BusinessError(409, 'Conexão alterada. Recarregue.');
        const checkedAt = new Date().toISOString();
        tx.update(ref, { nickname: seller.nickname, checkedAt });
        return connectionMetadata(creds, { ...current, nickname: seller.nickname, checkedAt });
      });
      return res.json({ connection: result });
    } catch (error) {
      if (error instanceof ProviderError) return res.status(502).json({ error: 'Mercado Livre não confirmou o acesso. Tente verificar novamente ou reconecte a conta.' });
      return fail(res, error);
    }
  });
}
