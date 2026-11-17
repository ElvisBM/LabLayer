import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerMarketplaceOAuthRoutes } from '../../server/marketplace-oauth';
import { sealMarketplaceSecret, openMarketplaceSecret } from '../../server/marketplace-security';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'listing-tests');
const db = getFirestore(firebase), key = randomBytes(32), remote = vi.fn<typeof fetch>();
const app = express(); app.use(express.json());
registerMarketplaceOAuthRoutes(app, db, async token => { if (token === 'invalid') throw Error(); return { uid: token } as any; }, key, remote);
const path = '/api/tenants/a/marketplace-listings';
const get = (actor = 'member', suffix = '') => request(app).get(path + suffix).set('Authorization', `Bearer ${actor}`);
const respond = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
const item = (id = 'MLB1') => ({ id, seller_id: 123, title: 'Peça personalizada', status: 'active', price: 29.9, currency_id: 'BRL', available_quantity: 7, permalink: 'https://produto.mercadolivre.com.br/MLB1', secure_thumbnail: 'https://http2.mlstatic.com/photo.jpg', private_field: 'omit' });
beforeEach(async () => {
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents', { method: 'DELETE' });
  await db.doc('tenants/a').set({ ownerUid: 'owner', status: 'active' });
  await db.doc('users/member').set({ tenantId: 'a', tenantRole: 'member' });
  await db.doc('tenants/a/members/member').set({ active: true, role: 'member' });
  await db.doc('privateMarketplaceCredentials/a').set({ clientId: '1234', revision: 2, secret: sealMarketplaceSecret(key, 'a', 'test-client-secret') });
  await db.doc('privateMarketplaceConnections/a').set({ status: 'connected', userId: '123', nickname: 'LOJA', clientId: '1234', credentialRevision: 2, connectedAt: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString(), tokens: sealMarketplaceSecret(key, 'a:oauth', JSON.stringify({ accessToken: 'test-access', refreshToken: 'test-refresh' })) });
  remote.mockReset().mockImplementation(async url => String(url).includes('/items/search') ? respond({ results: ['MLB1'], paging: { total: 1 } }) : respond(item()));
});
afterAll(async () => { await db.terminate(); await deleteApp(firebase); });
it('exige sessão, empresa ativa e associação; membro não pode configurar OAuth', async () => {
  await request(app).get(path).expect(401);
  await get('invalid').expect(401); await get('outsider').expect(403);
  await request(app).post('/api/tenants/a/integrations/mercadolivre/check').set('Authorization', 'Bearer member').expect(403);
  await db.doc('tenants/a/members/member').update({ active: false }); await get().expect(403);
  await db.doc('tenants/a').update({ status: 'inactive' }); await get('owner').expect(403);
  expect(remote).not.toHaveBeenCalled();
});
it('retorna dados reais sanitizados e só usa GET; cache pode ser atualizado', async () => {
  const result = await get().expect(200);
  expect(result.body).toMatchObject({ total: 1, complete: true, seller: 'LOJA', listings: [{ id: 'MLB1', platform: 'mercadolivre', quantity: 7, price: 29.9 }] });
  expect(result.headers['cache-control']).toBe('no-store');
  for (const secret of ['test-access', 'test-refresh', 'test-client-secret', 'private_field']) expect(JSON.stringify(result.body)).not.toContain(secret);
  for (const [url, init] of remote.mock.calls) { expect(String(url)).toMatch(/^https:\/\/api.mercadolibre.com\//); expect(init?.method ?? 'GET').toBe('GET'); }
  await get().expect(200); expect(remote).toHaveBeenCalledTimes(2);
  await get('member', '?refresh=1').expect(200); expect(remote).toHaveBeenCalledTimes(4);
  expect((await db.collection('tenants/a/channelListings').get()).size).toBe(0);
});
it('cache não ignora revogação ou troca de credencial', async () => {
  await get().expect(200);
  await db.doc('tenants/a/members/member').update({ active: false }); await get().expect(403);
  await db.doc('privateMarketplaceCredentials/a').update({ revision: 3 }); await get('owner').expect(409);
  expect(remote).toHaveBeenCalledTimes(2);
});
it('revogação durante consulta impede resposta com anúncios', async () => {
  remote.mockImplementation(async url => {
    if (String(url).includes('/items/search')) return respond({ results: ['MLB1'], paging: { total: 1 } });
    await db.doc('tenants/a/members/member').update({ active: false }); return respond(item());
  });
  const r = await get().expect(403); expect(r.body.listings).toBeUndefined();
});
it('pagina os IDs, elimina duplicatas e mantém encerrados por último', async () => {
  remote.mockImplementation(async url => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/search')) return respond(u.searchParams.get('offset') === '0' ? { results: ['MLB1','MLB2'], paging: { total: 3 } } : { results: ['MLB3'], paging: { total: 3 } });
    const id = u.pathname.split('/').pop(); return respond({ ...item(id), status: id === 'MLB1' ? 'closed' : id === 'MLB2' ? 'paused' : 'active' });
  });
  const r = await get().expect(200); expect(r.body.complete).toBe(true);
  expect(r.body.listings.map((i: any) => i.status)).toEqual(['active', 'paused', 'closed']);
  expect(remote.mock.calls.some(([url]) => String(url).includes('offset=2'))).toBe(true);
});
it('resposta incompleta fica explícita, sem inventar anúncios', async () => {
  remote.mockImplementation(async url => String(url).includes('/search') ? respond({ results: String(url).endsWith('offset=0') ? ['MLB1'] : [], paging: { total: 1001 } }) : respond(item()));
  const r = await get().expect(200); expect(r.body).toMatchObject({ total: 1001, complete: false }); expect(r.body.listings).toHaveLength(1);
});
it('falha do provedor e vendedor divergente não viram sucesso vazio nem vazam resposta', async () => {
  remote.mockResolvedValue(respond({ error: 'sensitive-provider-body' }, 429));
  const fail = await get().expect(502); expect(JSON.stringify(fail.body)).not.toContain('sensitive-provider-body');
  remote.mockImplementation(async url => String(url).includes('/search') ? respond({ results: ['MLB1'], paging: { total: 1 } }) : respond({ ...item(), seller_id: 999 }));
  await get().expect(502);
});
it('ausência de conexão é explícita e não chama API', async () => {
  await db.doc('privateMarketplaceConnections/a').delete(); await get().expect(409); expect(remote).not.toHaveBeenCalled();
});
it('renova token expirado na leitura e persiste criptografado antes de listar', async () => {
  await db.doc('privateMarketplaceConnections/a').update({ expiresAt: new Date(0).toISOString() });
  remote.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/oauth/token')) return respond({ access_token: 'new-access', refresh_token: 'new-refresh', user_id: 123, token_type: 'bearer', expires_in: 3600 });
    expect(init?.headers).toEqual({ Authorization: 'Bearer new-access' });
    return String(url).includes('/search') ? respond({ results: ['MLB1'], paging: { total: 1 } }) : respond(item());
  });
  await get().expect(200);
  const connection = (await db.doc('privateMarketplaceConnections/a').get()).data()!;
  expect(JSON.parse(openMarketplaceSecret(key, 'a:oauth', connection.tokens)).refreshToken).toBe('new-refresh');
  expect(connection.refreshLease).toBeNull();
});
