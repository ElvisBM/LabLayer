import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerMarketplaceOAuthRoutes } from '../../server/marketplace-oauth';
import { sealMarketplaceSecret } from '../../server/marketplace-security';
import { registerMercadoLivreMcp, hashMcpKey } from '../../server/mcp-mercadolivre';
import { registerMcpOAuth } from '../../server/mcp-oauth';

const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'mcp-oauth-tests');
const db = getFirestore(firebase), key = randomBytes(32), remote = vi.fn<typeof fetch>();
const app = express(); app.use(express.json());
const loadToken = registerMarketplaceOAuthRoutes(app, db, async () => { throw Error(); }, key, remote);
const oauth = registerMcpOAuth(app, db, 'https://app.example.com');
registerMercadoLivreMcp(app, db, loadToken, { claims: async () => ({}), fetcher: remote, oauth });
const mcpKey = 'll_mcp_' + 'k'.repeat(43), redirect = 'https://claude.ai/api/mcp/auth_callback';
const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
const respond = (body: any, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(async () => {
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents', { method: 'DELETE' });
  await db.doc('tenants/a').set({ ownerUid: 'owner', status: 'active' });
  await db.doc('privateMarketplaceCredentials/a').set({ clientId: '1234', revision: 2, secret: sealMarketplaceSecret(key, 'a', 'test-client-secret') });
  await db.doc('privateMarketplaceConnections/a').set({ status: 'connected', userId: '123', nickname: 'LOJA', clientId: '1234', credentialRevision: 2, connectedAt: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), tokens: sealMarketplaceSecret(key, 'a:oauth', JSON.stringify({ accessToken: 'test-access', refreshToken: 'test-refresh' })) });
  await db.doc(`privateMcpKeys/${hashMcpKey(mcpKey)}`).set({ id: 'cccccccccccc', tenantId: 'a', createdBy: 'owner', scopes: ['mercadolivre:read'], active: true });
  remote.mockReset().mockImplementation(async () => respond({ id: 123, nickname: 'LOJA' }));
});
afterAll(async () => { await db.terminate(); await deleteApp(firebase); });

async function register() {
  const r = await request(app).post('/api/oauth/register').send({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }).expect(201);
  return r.body.client_id as string;
}
const params = (clientId: string) => ({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge,
  code_challenge_method: 'S256', state: 'xyz', resource: 'https://app.example.com/api/mcp' });

it('anuncia metadados e pede autenticação com resource_metadata', async () => {
  const r = await request(app).post('/api/mcp').send({}).expect(401);
  expect(r.headers['www-authenticate']).toContain('resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp"');
  const pr = await request(app).get('/.well-known/oauth-protected-resource/api/mcp').expect(200);
  expect(pr.body).toMatchObject({ resource: 'https://app.example.com/api/mcp', authorization_servers: ['https://app.example.com/'] });
  const as = await request(app).get('/.well-known/oauth-authorization-server').expect(200);
  expect(as.body).toMatchObject({ authorization_endpoint: 'https://app.example.com/api/oauth/authorize', registration_endpoint: 'https://app.example.com/api/oauth/register' });
});

it('fluxo completo: registro, consentimento com chave, troca de código, uso, refresh e revogação da chave', async () => {
  const clientId = await register();
  const form = await request(app).get('/api/oauth/authorize').query(params(clientId)).expect(200);
  expect(form.text).toContain('Claude'); expect(form.headers['x-frame-options']).toBe('DENY');
  const bad = await request(app).post('/api/oauth/authorize').type('form').send({ ...params(clientId), mcp_key: 'll_mcp_' + 'z'.repeat(43) }).expect(401);
  expect(bad.text).toContain('Chave inválida');
  const ok = await request(app).post('/api/oauth/authorize').type('form').send({ ...params(clientId), mcp_key: mcpKey }).expect(302);
  const location = new URL(ok.headers.location);
  expect(location.origin + location.pathname).toBe(redirect); expect(location.searchParams.get('state')).toBe('xyz');
  const code = location.searchParams.get('code')!;
  await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: 'wrong'.repeat(10), redirect_uri: redirect }).expect(400);
  const tok = await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect }).expect(200);
  expect(tok.body).toMatchObject({ token_type: 'bearer', expires_in: 3600 });
  // code is single-use
  await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect }).expect(400);
  const call = (bearer: string) => request(app).post('/api/mcp').set('Authorization', `Bearer ${bearer}`).set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ml_conta', arguments: {} } });
  const result = await call(tok.body.access_token).expect(200);
  expect(JSON.parse(result.body.result.content[0].text)).toMatchObject({ apelido: 'LOJA' });
  const refreshed = await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tok.body.refresh_token }).expect(200);
  await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tok.body.refresh_token }).expect(400);
  await call(refreshed.body.access_token).expect(200);
  await db.doc(`privateMcpKeys/${hashMcpKey(mcpKey)}`).update({ active: false });
  await call(refreshed.body.access_token).expect(401);
  await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshed.body.refresh_token }).expect(400);
  const audits = (await db.collection('tenants/a/auditLogs').get()).docs.map(d => d.data().operation);
  expect(audits).toContain('marketplace.mcp.oauth.authorized');
});

it('recusa redirect não registrado e recurso de outro servidor', async () => {
  const clientId = await register();
  await request(app).get('/api/oauth/authorize').query({ ...params(clientId), redirect_uri: 'https://evil.example/cb' }).expect(400);
  const r = await request(app).post('/api/oauth/authorize').type('form').send({ ...params(clientId), resource: 'https://other.example/mcp', mcp_key: mcpKey });
  expect(r.status).toBe(302); expect(new URL(r.headers.location).searchParams.get('error')).toBe('invalid_target');
});
