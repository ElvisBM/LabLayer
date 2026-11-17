import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerMarketplaceOAuthRoutes } from '../../server/marketplace-oauth';
import { sealMarketplaceSecret } from '../../server/marketplace-security';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'listing-action-tests');
const db = getFirestore(firebase), key = randomBytes(32), remote = vi.fn<typeof fetch>();
const app = express(); app.use(express.json());
registerMarketplaceOAuthRoutes(app, db, async token => { if (token === 'invalid') throw Error(); return { uid: token } as any; }, key, remote);
const base = '/api/tenants/a/marketplace-listings', path = base + '/MLB1';
const respond = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
let item: any, automation = 404, automationBody: any;
const get = (actor = 'owner') => request(app).get(path).set('Authorization', `Bearer ${actor}`);
const post = (body: any, actor = 'owner') => request(app).post(path + '/actions').set('Authorization', `Bearer ${actor}`).send(body);
async function intent(action = 'unpublish', changes?: any) {
  const r = await get().expect(200); return { action, revision: r.body.revision, requestId: randomUUID(), ...(changes ? { changes } : {}) };
}
const writes = () => remote.mock.calls.filter(([, init]) => init?.method === 'PUT');
beforeEach(async () => {
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents', { method: 'DELETE' });
  await db.doc('tenants/a').set({ ownerUid: 'owner', status: 'active' });
  await db.doc('users/member').set({ tenantId: 'a', tenantRole: 'member' });
  await db.doc('users/admin').set({ tenantId: 'a', tenantRole: 'admin' });
  await db.doc('tenants/a/members/admin').set({ active: true, role: 'admin' });
  await db.doc('privateMarketplaceCredentials/a').set({ clientId: '1234', revision: 2, secret: sealMarketplaceSecret(key, 'a', 'test-client-secret') });
  await db.doc('privateMarketplaceConnections/a').set({ status: 'connected', userId: '123', nickname: 'LOJA', clientId: '1234', credentialRevision: 2, connectedAt: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString(), tokens: sealMarketplaceSecret(key, 'a:oauth', JSON.stringify({ accessToken: 'test-access', refreshToken: 'test-refresh' })) });
  item = { id: 'MLB1', seller_id: 123, title: 'Peça original', status: 'active', price: 29.9, currency_id: 'BRL', available_quantity: 7, sold_quantity: 0, permalink: 'https://produto.mercadolivre.com.br/MLB1' }; automation = 404; automationBody = {};
  remote.mockReset().mockImplementation(async (url, init) => {
    if (String(url).includes('/pricing-automation/')) return respond(automationBody, automation);
    if (String(url).includes('/items/search')) return respond({ results: ['MLB1'], paging: { total: 1 } });
    if (init?.method === 'PUT') Object.assign(item, JSON.parse(init.body as string));
    return respond(item);
  });
});
afterAll(async () => { await db.terminate(); await deleteApp(firebase); });
it('somente administradores ativos podem abrir e alterar anúncio', async () => {
  await request(app).get(path).expect(401); await get('invalid').expect(401); await get('member').expect(403);
  await post({}).expect(400); await post({}, 'member').expect(403);
  await db.doc('tenants/a/members/admin').update({ active: false }); await get('admin').expect(403);
  expect(writes()).toHaveLength(0);
});
it('pausa e reativa com confirmação remota, auditoria e idempotência sem estoque local', async () => {
  const body = await intent(); const r = await post(body).expect(200);
  expect(r.body).toMatchObject({ confirmed: true, listing: { status: 'paused' } });
  expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ status: 'paused' });
  await post(body).expect(200); expect(writes()).toHaveLength(1);
  await post({ ...body, action: 'publish' }).expect(409);
  await post(await intent('publish')).expect(200); expect(item.status).toBe('active');
  const audits = (await db.collection('tenants/a/auditLogs').get()).docs.map(d => d.data());
  expect(audits.map(a => a.operation)).toEqual(expect.arrayContaining(['marketplace.listing.unpublish','marketplace.listing.publish']));
  expect((await db.collection('tenants/a/inventoryMovements').get()).size).toBe(0);
  expect(JSON.stringify(audits)).not.toContain('test-access');
});
it('edita somente os campos enviados e invalida o cache da lista', async () => {
  const list = () => request(app).get(base).set('Authorization','Bearer owner');
  expect((await list()).body.listings[0].price).toBe(29.9);
  const r = await post(await intent('edit', { title: 'Novo título', price: 34.5 })).expect(200);
  expect(r.body.listing).toMatchObject({ title: 'Novo título', price: 34.5, quantity: 7, status: 'active' });
  expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ title: 'Novo título', price: 34.5 });
  expect((await list()).body.listings[0].price).toBe(34.5);
});
it('bloqueia anúncio de outro vendedor e revisão antiga', async () => {
  const body = await intent(); item.price = 31; await post(body).expect(409);
  item.seller_id = 999; await get().expect(403); await post(body).expect(403); expect(writes()).toHaveLength(0);
});
it('revalida permissão após consultas remotas e antes de escrever', async () => {
  const body = await intent(); const original = remote.getMockImplementation()!;
  remote.mockImplementation(async (url, init) => {
    if (String(url).includes('/items/MLB1')) await db.doc('tenants/a').update({ status: 'inactive' });
    return original(url, init);
  });
  await post(body).expect(403); expect(writes()).toHaveLength(0);
});
it('bloqueia publicação sem estoque, encerrada e despublicação fora de ativo', async () => {
  for (const patch of [{ status: 'closed' }, { status: 'paused', available_quantity: 0 }, { status: 'paused', available_quantity: 2, sub_status: ['out_of_stock'] }]) {
    Object.assign(item, patch); await post(await intent('publish')).expect(409);
  }
  await post(await intent('unpublish')).expect(409); expect(writes()).toHaveLength(0);
});
it('respeita vendas, catálogo e UP para título, variações e descontos para preço', async () => {
  for (const patch of [{ sold_quantity: 1 }, { sold_quantity: 0, user_product_id: 'MLBU1' }, { user_product_id: null, catalog_listing: true }]) {
    Object.assign(item, patch); expect((await get()).body.capabilities.title).toBe(false);
    await post(await intent('edit', { title: 'Outro' })).expect(409);
  }
  item.variations = [{ id: 1, price: 29.9 }]; await post(await intent('edit', { price: 30 })).expect(409);
  item.variations = []; item.original_price = 50; await post(await intent('edit', { price: 30 })).expect(409); expect(writes()).toHaveLength(0);
});
it('automação ativa/pausada ou consulta indisponível bloqueia preço', async () => {
  for (const status of ['ACTIVE','PAUSED']) {
    automation = 200; automationBody = { status }; expect((await get()).body.capabilities.price).toBe(false);
    await post(await intent('edit', { price: 30 })).expect(409);
  }
  automation = 503; await post(await intent('edit', { price: 30 })).expect(409); expect(writes()).toHaveLength(0);
});
it('valida preço, título e whitelist sem aceitar quantidade ou status pelo editor', async () => {
  for (const changes of [{ price: -1 }, { price: 0 }, { price: 1.001 }, { price: '34' }, { title: '' }, { title: 'a'.repeat(61) }, { available_quantity: 1 }, { status: 'closed' }])
    await post(await intent('edit', changes)).expect(400);
  await post({ ...await intent(), changes: { price: 5 } }).expect(400); expect(writes()).toHaveLength(0);
});
it('resultado incerto não é sucesso e não reenvia automaticamente', async () => {
  const body = await intent(), original = remote.getMockImplementation()!;
  remote.mockImplementation(async (url, init) => { if (init?.method === 'PUT') { item.status = 'paused'; throw Error('timeout-secret-body'); } return original(url, init); });
  const r = await post(body).expect(502); expect(JSON.stringify(r.body)).not.toContain('timeout-secret-body');
  await post(body).expect(409); expect(writes()).toHaveLength(1);
  const op = (await db.collection('privateMarketplaceActions').get()).docs[0].data(); expect(op.status).toBe('uncertain');
});
it('HTTP 200 sem alteração efetiva não confirma sucesso', async () => {
  const body = await intent(), original = remote.getMockImplementation()!;
  remote.mockImplementation(async (url, init) => init?.method === 'PUT' ? respond({ warnings: [{ code: 'not_modifiable' }] }) : original(url, init));
  await post(body).expect(502); expect((await db.collection('privateMarketplaceActions').get()).docs[0].data().status).toBe('uncertain');
});
it('rejeição 400 não vaza dados nem altera o anúncio', async () => {
  const body = await intent(), original = remote.getMockImplementation()!;
  remote.mockImplementation(async (url, init) => init?.method === 'PUT' ? respond({ message: 'provider-secret' },400) : original(url, init));
  const r = await post(body).expect(502); expect(JSON.stringify(r.body)).not.toContain('provider-secret'); expect(item.status).toBe('active');
  expect((await db.collection('privateMarketplaceActions').get()).docs[0].data().status).toBe('rejected');
});
it('duplo clique concorrente envia apenas um PUT', async () => {
  const body = await intent();
  const results = await Promise.all([post(body), post(body)]); expect(results.some(r => r.status === 200)).toBe(true);
  expect(writes()).toHaveLength(1);
});
