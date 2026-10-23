import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerMarketplaceOAuthRoutes, ML_REDIRECT, connectionMetadata } from '../../server/marketplace-oauth';
import { sealMarketplaceSecret, openMarketplaceSecret } from '../../server/marketplace-security';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'marketplace-oauth-test');
const db = getFirestore(firebase), key = randomBytes(32);
const remote = vi.fn<typeof fetch>();
const verify = async (token: string) => { if (token === 'invalid') throw Error(); return { uid: token, superadmin: token === 'platform' } as any; };
const app = express(); app.use(express.json()); registerMarketplaceOAuthRoutes(app, db, verify, key, remote);
const base = '/api/tenants/a/integrations/mercadolivre';
const secret = 'only-test-client-secret';
const credentials = { clientId: '2379102902840747', revision: 2, secret: sealMarketplaceSecret(key, 'a', secret) };
const tokenBody = { access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', user_id: 12345678901, expires_in: 21600 };
const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const post = (path: string, actor = 'owner', body = { expectedRevision: 2 }) => request(app).post(base + path).set('Authorization', `Bearer ${actor}`).send(body);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function start(actor = 'owner') {
  const r = await post('/connect', actor).expect(200);
  const url = new URL(r.body.authorizationUrl), state = url.searchParams.get('state')!;
  return { state, url, cookie: r.headers['set-cookie'][0].split(';')[0], ref: db.doc(`privateMarketplaceOAuthStates/${digest(state)}`), response: r };
}
const callback = (flow: Awaited<ReturnType<typeof start>>, query = { code: 'test-code' }) =>
  request(app).get('/api/integrations/mercadolivre/callback').query({ state: flow.state, ...query }).set('Cookie', flow.cookie);
async function connect() { const flow = await start(); const r = await callback(flow).expect(303); expect(r.headers.location).toContain('mercadolivre=connected'); return flow; }
const readConnection = async () => (await db.doc('privateMarketplaceConnections/a').get()).data()!;
beforeEach(async () => {
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents', { method: 'DELETE' });
  await db.doc('tenants/a').set({ ownerUid: 'owner', status: 'active' });
  await db.doc('users/admin').set({ tenantId: 'a', tenantRole: 'admin' });
  await db.doc('users/member').set({ tenantId: 'a', tenantRole: 'member' });
  await db.doc('users/platform').set({ role: 'superadmin' });
  await db.doc('privateMarketplaceCredentials/a').set(credentials);
  remote.mockReset().mockImplementation(async url => String(url).endsWith('/oauth/token') ? respond(tokenBody) : respond({ id: tokenBody.user_id, nickname: 'MINHA_LOJA' }));
});
afterAll(async () => { await db.terminate(); await deleteApp(firebase); });

it('inicia apenas com administrador autenticado, empresa ativa e revisão atual', async () => {
  await request(app).post(base+'/connect').send({ expectedRevision: 2 }).expect(401);
  await post('/connect', 'invalid').expect(401);
  await post('/connect', 'member').expect(403);
  await post('/connect', 'owner', { expectedRevision: 1 }).expect(409);
  await post('/connect', 'owner', { expectedRevision: 2, redirect_uri: 'https://evil.example' } as any).expect(400);
  await db.doc('tenants/a').update({ status: 'inactive' }); await post('/connect').expect(403);
  expect(remote).not.toHaveBeenCalled();
});
it('state aleatório de uso único, cookie seguro e PKCE; não vaza segredo nem verifier', async () => {
  const f = await start(); const saved = (await f.ref.get()).data()!;
  expect(f.response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  expect(f.response.headers['set-cookie'][0]).toMatch(/Secure/);
  expect(f.response.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
  expect(f.url.origin).toBe('https://auth.mercadolivre.com.br');
  expect(f.url.searchParams.get('redirect_uri')).toBe(ML_REDIRECT);
  expect(f.url.searchParams.get('code_challenge_method')).toBe('S256');
  const verifier = openMarketplaceSecret(key, 'a:pkce', saved.verifier);
  expect(f.url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
  for (const value of [secret, verifier]) expect(JSON.stringify(f.response.body)).not.toContain(value);
  expect(JSON.stringify(saved)).not.toContain(verifier);
});
it('conclui troca, confere identidade da loja e salva tokens criptografados e auditoria', async () => {
  const f = await connect(), saved = await readConnection();
  expect(saved).toMatchObject({ status: 'connected', nickname: 'MINHA_LOJA', userId: '12345678901', credentialRevision: 2 });
  expect(JSON.parse(openMarketplaceSecret(key, 'a:oauth', saved.tokens))).toEqual({ accessToken: tokenBody.access_token, refreshToken: tokenBody.refresh_token });
  expect(() => openMarketplaceSecret(key, 'b:oauth', saved.tokens)).toThrow();
  const form = new URLSearchParams(remote.mock.calls[0][1]!.body as string);
  expect(form.get('client_secret')).toBe(secret); expect(form.get('redirect_uri')).toBe(ML_REDIRECT); expect(form.get('code_verifier')).toBeTruthy();
  expect(remote.mock.calls[1][1]!.headers).toEqual({ Authorization: `Bearer ${tokenBody.access_token}` });
  expect((await f.ref.get()).data()).toMatchObject({ status: 'complete', verifier: null });
  const audits = (await db.collection('tenants/a/auditLogs').get()).docs.map(d => d.data());
  expect(audits.map(a => a.operation)).toContain('marketplace.oauth.connected');
  for (const value of [secret, tokenBody.access_token, tokenBody.refresh_token, 'test-code']) {
    expect(JSON.stringify(saved)).not.toContain(value); expect(JSON.stringify(audits)).not.toContain(value);
    expect(JSON.stringify(connectionMetadata(credentials, saved))).not.toContain(value);
  }
});
it('callback sem state/cookie, cookie alheio, state alterado ou expirado não chama provedor', async () => {
  const f = await start();
  for (const r of [request(app).get('/api/integrations/mercadolivre/callback?code=test-code'),
    request(app).get('/api/integrations/mercadolivre/callback').query({ code: 'test-code', state: f.state }),
    callback({ ...f, cookie: '__Host-lablayer-ml-oauth='+'X'.repeat(43) }), callback({ ...f, state: 'A'.repeat(43) })]) {
    expect((await r.expect(303)).headers.location).toContain('invalid-state');
  }
  await f.ref.update({ expiresAt: Date.now()-1000 }); expect((await callback(f)).headers.location).toContain('invalid-state');
  expect(remote).not.toHaveBeenCalled();
});
it('cancela consentimento sem chamar APIs e consome state', async () => {
  const f = await start(); const r = await callback(f, { error: 'access_denied' } as any).expect(303);
  expect(r.headers.location).toContain('denied'); expect(remote).not.toHaveBeenCalled();
  expect((await f.ref.get()).data()?.status).toBe('failed');
});
it('não reusa callback nem permite tentativa antiga sobrescrever a conexão mais recente', async () => {
  const f = await connect(); const count = remote.mock.calls.length;
  expect((await callback(f)).headers.location).toContain('invalid-state'); expect(remote).toHaveBeenCalledTimes(count);
  const stale = await start(); await start(); expect((await callback(stale)).headers.location).toContain('invalid-state');
  expect(remote).toHaveBeenCalledTimes(count);
});
it('troca de credencial ou revogação de administrador durante consentimento impede conclusão', async () => {
  const f = await start('admin'); await db.doc('tenants/a/members/admin').set({ active: false, role: 'admin' });
  expect((await callback(f)).headers.location).toContain('invalid-state');
  const g = await start(); await db.doc('privateMarketplaceCredentials/a').update({ revision: 3 });
  expect((await callback(g)).headers.location).toContain('invalid-state'); expect(remote).not.toHaveBeenCalled();
});
it('revogação do privilégio de plataforma também é reconferida no callback', async () => {
  const f = await start('platform'); await db.doc('users/platform').update({ role: 'member' });
  expect((await callback(f)).headers.location).toContain('invalid-state'); expect(remote).not.toHaveBeenCalled();
});
it('troca de empresa do callback é ignorada; autorização não grava em outra empresa', async () => {
  const f = await start(); await callback(f, { code: 'test-code', tenantId: 'b' } as any).expect(303);
  expect((await db.doc('privateMarketplaceConnections/b').get()).exists).toBe(false);
  expect((await readConnection()).userId).toBe('12345678901');
});
it('resposta inválida, conta divergente e falha do provedor não anunciam conexão', async () => {
  for (const mode of ['tokens', 'user', 'error']) {
    const f = await start();
    remote.mockImplementation(async url => {
      if (mode === 'error') return respond({ error: 'invalid_client', error_description: secret }, 400);
      return String(url).endsWith('/oauth/token') ? respond(mode === 'tokens' ? { ...tokenBody, refresh_token: undefined } : tokenBody) : respond({ id: 999, nickname: 'OUTRA' });
    });
    const r = await callback(f).expect(303); expect(r.headers.location).not.toContain('=connected'); expect(r.text).not.toContain(secret);
    expect((await db.doc('privateMarketplaceConnections/a').get()).exists).toBe(false);
  }
});
it('mudança de credenciais durante chamada externa aborta commit', async () => {
  const f = await start();
  remote.mockImplementation(async url => {
    if (String(url).endsWith('/users/me')) { await db.doc('privateMarketplaceCredentials/a').update({ revision: 3 }); return respond({ id: tokenBody.user_id, nickname: 'LOJA' }); }
    return respond(tokenBody);
  });
  expect((await callback(f)).headers.location).toContain('invalid-state'); expect((await db.doc('privateMarketplaceConnections/a').get()).exists).toBe(false);
});
it('falha na auditoria impede sucesso parcial no callback', async () => {
  const f = await start(); const original = db.collection.bind(db);
  const spy = vi.spyOn(db, 'collection').mockImplementation(path => { if (path.endsWith('/auditLogs')) throw Error(); return original(path); });
  try { expect((await callback(f)).headers.location).toContain('unavailable'); } finally { spy.mockRestore(); }
  expect((await db.doc('privateMarketplaceConnections/a').get()).exists).toBe(false);
});
it('verifica token ainda válido sem renovação e devolve apenas metadados', async () => {
  await connect(); remote.mockClear(); const r = await post('/check').expect(200);
  expect(remote).toHaveBeenCalledTimes(1); expect(remote.mock.calls[0][0]).toContain('/users/me');
  expect(r.body.connection.status).toBe('connected'); expect(r.body).not.toHaveProperty('tokens');
  expect(JSON.stringify(r.body)).not.toContain(tokenBody.access_token);
});
it('renova acesso vencido, persiste refresh rotativo antes de conferir a loja', async () => {
  await connect(); await db.doc('privateMarketplaceConnections/a').update({ expiresAt: '2000-01-01T00:00:00.000Z' });
  remote.mockClear().mockImplementation(async url => String(url).endsWith('/oauth/token') ? respond({ ...tokenBody, access_token: 'next-access', refresh_token: 'next-refresh' }) : respond({ id: tokenBody.user_id, nickname: 'LOJA_ATUAL' }));
  await post('/check').expect(200);
  const form = new URLSearchParams(remote.mock.calls[0][1]!.body as string);
  expect(form.get('grant_type')).toBe('refresh_token'); expect(form.get('refresh_token')).toBe(tokenBody.refresh_token);
  const c = await readConnection(); expect(JSON.parse(openMarketplaceSecret(key, 'a:oauth', c.tokens)).refreshToken).toBe('next-refresh');
  expect(c.nickname).toBe('LOJA_ATUAL'); expect(c.refreshLease).toBeNull();
});
it('verificações concorrentes não usam refresh token duas vezes', async () => {
  await connect(); await db.doc('privateMarketplaceConnections/a').update({ expiresAt: '2000-01-01T00:00:00.000Z' });
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let started!: () => void; const startedGate = new Promise<void>(r => { started = r; });
  remote.mockClear().mockImplementation(async url => { if (String(url).endsWith('/oauth/token')) { started(); await gate; return respond(tokenBody); } return respond({ id: tokenBody.user_id, nickname: 'LOJA' }); });
  const first = post('/check').then(r => r); await startedGate;
  await post('/check').expect(409); release(); expect((await first).status).toBe(200);
  expect(remote.mock.calls.filter(c => String(c[0]).endsWith('/oauth/token'))).toHaveLength(1);
});
it('falha incerta na renovação exige reconectar e não reutiliza refresh', async () => {
  await connect(); await db.doc('privateMarketplaceConnections/a').update({ expiresAt: '2000-01-01T00:00:00.000Z' });
  remote.mockClear().mockRejectedValue(Error('network'));
  await post('/check').expect(502); expect((await readConnection()).status).toBe('reconnect-required');
  await post('/check').expect(409); expect(remote).toHaveBeenCalledTimes(1);
});
it('falha de consulta após renovar não perde novo refresh token', async () => {
  await connect(); await db.doc('privateMarketplaceConnections/a').update({ expiresAt: '2000-01-01T00:00:00.000Z' });
  remote.mockImplementation(async url => String(url).endsWith('/oauth/token') ? respond({ ...tokenBody, refresh_token: 'preserved-refresh' }) : respond({}, 503));
  await post('/check').expect(502);
  expect(JSON.parse(openMarketplaceSecret(key, 'a:oauth', (await readConnection()).tokens)).refreshToken).toBe('preserved-refresh');
});
it('não renova conexão com revisão de credencial antiga nem lease abandonado', async () => {
  await connect(); remote.mockClear(); await db.doc('privateMarketplaceCredentials/a').update({ revision: 3 });
  await post('/check').expect(409); expect(connectionMetadata({ ...credentials, revision: 3 }, await readConnection()).status).toBe('reconnect-required');
  await db.doc('privateMarketplaceCredentials/a').update({ revision: 2 });
  await db.doc('privateMarketplaceConnections/a').update({ refreshLease: 'old', refreshLeaseUntil: 1 });
  await post('/check').expect(409); expect(remote).not.toHaveBeenCalled();
});
