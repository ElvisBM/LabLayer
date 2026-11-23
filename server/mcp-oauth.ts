import type { Express, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidGrantError, InvalidTokenError, InvalidTargetError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { hashMcpKey, MCP_PATH } from './mcp-mercadolivre';

/**
 * OAuth 2.1 (PKCE + dynamic client registration) so claude.ai / Claude app can add the MCP as a custom connector.
 * The user authorizes by pasting an existing `ll_mcp_…` key on the consent page: OAuth tokens are bound to that
 * key's hash, so revoking/expiring the key immediately cuts every token derived from it.
 * Storage: privateMcpOAuthClients, privateMcpOAuthCodes, privateMcpOAuthTokens (hashed ids, no client grants).
 */
export const OAUTH_BASE = '/api/oauth';
const ACCESS_TTL = 3600, REFRESH_TTL = 30 * 86400, CODE_TTL = 300;
const token = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export type OAuthAccess = { keyHash: string; clientId: string; expiresAt: number };

export function registerMcpOAuth(app: Express, db: Firestore | null, publicUrl: string) {
  const issuer = new URL(publicUrl);
  const resource = new URL(MCP_PATH, issuer);
  const clients = () => db!.collection('privateMcpOAuthClients');
  const codes = () => db!.collection('privateMcpOAuthCodes');
  const tokens = () => db!.collection('privateMcpOAuthTokens');
  const nowSec = () => Math.floor(Date.now() / 1000);

  async function activeKey(keyHash: string) {
    const key = (await db!.doc(`privateMcpKeys/${keyHash}`).get()).data();
    return key && key.active === true && !(key.expiresAt && key.expiresAt <= new Date().toISOString()) ? key : null;
  }
  function checkResource(r?: URL) {
    if (r && r.href.replace(/\/$/, '') !== resource.href) throw new InvalidTargetError('Recurso inválido.');
  }
  async function issue(clientId: string, keyHash: string): Promise<OAuthTokens> {
    const access = token('ll_mcpat_'), refresh = token('ll_mcprt_'), batch = db!.batch(), created = new Date().toISOString();
    batch.create(tokens().doc(hashMcpKey(access)), { type: 'access', clientId, keyHash, expiresAt: nowSec() + ACCESS_TTL, createdAt: created });
    batch.create(tokens().doc(hashMcpKey(refresh)), { type: 'refresh', clientId, keyHash, expiresAt: nowSec() + REFRESH_TTL, createdAt: created });
    await batch.commit();
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: 'mercadolivre' };
  }

  function page(res: Response, client: OAuthClientInformationFull, params: AuthorizationParams, error = '') {
    const redirect = (() => { try { return new URL(params.redirectUri).host; } catch { return ''; } })();
    const hidden = { response_type: 'code', client_id: client.client_id, redirect_uri: params.redirectUri, code_challenge: params.codeChallenge,
      code_challenge_method: 'S256', state: params.state, scope: params.scopes?.join(' '), resource: params.resource?.href };
    res.status(error ? 401 : 200).set({ 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' })
      .send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar LabLayer</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f5f4;color:#1c1917;margin:0;padding:24px}main{max-width:440px;margin:40px auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px #0002}
h1{font-size:20px;margin:0 0 8px}p{line-height:1.5;color:#44403c}input{width:100%;box-sizing:border-box;padding:10px;font:14px monospace;border:1px solid #d6d3d1;border-radius:8px}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:#1c1917;color:#fff;font-size:15px;cursor:pointer}.err{color:#b91c1c}</style></head>
<body><main><h1>Conectar ao Mercado Livre da LabLayer</h1>
<p><b>${esc(client.client_name || 'Aplicativo')}</b> (${esc(redirect)}) quer usar as ferramentas MCP da LabLayer: consultar e alterar anúncios, vendas e perguntas da conta conectada.</p>
<p>Cole sua chave MCP (<code>ll_mcp_…</code>) para autorizar. A chave não é enviada ao aplicativo.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="${esc(OAUTH_BASE)}/authorize">${Object.entries(hidden).filter(([, v]) => v).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')}
<input name="mcp_key" type="password" autocomplete="off" placeholder="ll_mcp_..." required autofocus><button type="submit">Autorizar</button></form></main></body></html>`);
  }

  const provider: OAuthServerProvider = {
    clientsStore: {
      async getClient(id) {
        if (!/^[\w-]{8,128}$/.test(id)) return undefined;
        return (await clients().doc(id).get()).data() as OAuthClientInformationFull | undefined;
      },
      async registerClient(client) {
        const full = client as OAuthClientInformationFull;
        await clients().doc(full.client_id).create(JSON.parse(JSON.stringify(full)));
        return full;
      },
    },
    async authorize(client, params, res) {
      checkResource(params.resource);
      const submitted = res.req.method === 'POST' ? res.req.body?.mcp_key : undefined;
      if (typeof submitted !== 'string') return page(res, client, params);
      const key = /^ll_mcp_[\w-]{20,200}$/.test(submitted.trim()) ? await activeKey(hashMcpKey(submitted.trim())) : null;
      if (!key || !key.scopes?.includes('mercadolivre:read')) return page(res, client, params, 'Chave inválida, expirada ou revogada.');
      const code = token('');
      await codes().doc(hashMcpKey(code)).create({ clientId: client.client_id, keyHash: hashMcpKey(submitted.trim()), codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri, resource: params.resource?.href ?? null, expiresAt: nowSec() + CODE_TTL });
      await db!.collection(`tenants/${key.tenantId}/auditLogs`).add({ operation: 'marketplace.mcp.oauth.authorized', provider: 'mercadolivre',
        actor: `mcp:${key.id}`, clientId: client.client_id, clientName: String(client.client_name || '').slice(0, 100), createdAt: new Date().toISOString() });
      const target = new URL(params.redirectUri);
      target.searchParams.set('code', code);
      if (params.state) target.searchParams.set('state', params.state);
      res.redirect(302, target.href);
    },
    async challengeForAuthorizationCode(client, code) {
      const data = (await codes().doc(hashMcpKey(code)).get()).data();
      if (!data || data.clientId !== client.client_id || data.expiresAt < nowSec()) throw new InvalidGrantError('Código inválido ou expirado.');
      return data.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requested) {
      checkResource(requested);
      const ref = codes().doc(hashMcpKey(code));
      const data = await db!.runTransaction(async tx => {
        const d = (await tx.get(ref)).data();
        if (!d) throw new InvalidGrantError('Código inválido ou já utilizado.');
        tx.delete(ref); // single use
        return d;
      });
      if (data.clientId !== client.client_id || data.expiresAt < nowSec() || (redirectUri && redirectUri !== data.redirectUri))
        throw new InvalidGrantError('Código inválido ou expirado.');
      if (!(await activeKey(data.keyHash))) throw new InvalidGrantError('Chave MCP revogada.');
      return issue(client.client_id, data.keyHash);
    },
    async exchangeRefreshToken(client, refresh, _scopes, requested) {
      checkResource(requested);
      const ref = tokens().doc(hashMcpKey(refresh));
      const data = await db!.runTransaction(async tx => {
        const d = (await tx.get(ref)).data();
        if (!d || d.type !== 'refresh') throw new InvalidGrantError('Refresh token inválido.');
        tx.delete(ref); // rotation
        return d;
      });
      if (data.clientId !== client.client_id || data.expiresAt < nowSec()) throw new InvalidGrantError('Refresh token inválido ou expirado.');
      if (!(await activeKey(data.keyHash))) throw new InvalidGrantError('Chave MCP revogada.');
      return issue(client.client_id, data.keyHash);
    },
    async verifyAccessToken(access) {
      const found = await lookupAccessToken(access);
      if (!found) throw new InvalidTokenError('Token inválido.');
      return { token: access, clientId: found.clientId, scopes: ['mercadolivre'], expiresAt: found.expiresAt, resource };
    },
    async revokeToken(client, request) {
      const ref = tokens().doc(hashMcpKey(request.token));
      const d = (await ref.get()).data();
      if (d && d.clientId === client.client_id) await ref.delete();
    },
  };

  async function lookupAccessToken(access: string): Promise<OAuthAccess | null> {
    if (!db || !/^ll_mcpat_[\w-]{40,60}$/.test(access)) return null;
    const d = (await tokens().doc(hashMcpKey(access)).get()).data();
    return d && d.type === 'access' && d.expiresAt > nowSec() ? { keyHash: d.keyHash, clientId: d.clientId, expiresAt: d.expiresAt } : null;
  }

  // Shared office/VPN IPs are behind nginx; per-IP limits from express-rate-limit would see only the proxy.
  const rateLimit = { validate: false } as any;
  const ready = (_req: any, res: any, next: any) => db ? next() : res.status(503).json({ error: 'temporarily_unavailable' });
  app.use(`${OAUTH_BASE}/authorize`, ready, authorizationHandler({ provider, rateLimit }));
  app.use(`${OAUTH_BASE}/token`, ready, tokenHandler({ provider, rateLimit }));
  app.use(`${OAUTH_BASE}/register`, ready, clientRegistrationHandler({ clientsStore: provider.clientsStore, rateLimit, clientSecretExpirySeconds: 0 }));
  app.use(`${OAUTH_BASE}/revoke`, ready, revocationHandler({ provider, rateLimit }));
  const at = (path: string) => new URL(`${OAUTH_BASE}/${path}`, issuer).href;
  app.use(mcpAuthMetadataRouter({
    oauthMetadata: {
      issuer: issuer.href, authorization_endpoint: at('authorize'), token_endpoint: at('token'), registration_endpoint: at('register'),
      revocation_endpoint: at('revoke'), response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      revocation_endpoint_auth_methods_supported: ['client_secret_post'], scopes_supported: ['mercadolivre'],
    },
    resourceServerUrl: resource, scopesSupported: ['mercadolivre'], resourceName: 'LabLayer Mercado Livre',
  }));
  return { lookupAccessToken, resourceMetadataUrl: new URL(`/.well-known/oauth-protected-resource${MCP_PATH}`, issuer).href };
}
