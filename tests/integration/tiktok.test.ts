import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerTikTokRoutes } from '../../server/tiktok';
import { openTikTok } from '../../server/tiktok-client';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'tiktok-test'), db = getFirestore(firebase), key = randomBytes(32);
const remote = vi.fn<typeof fetch>();
const verify = async (token: string) => { if (token === 'invalid') throw Error(); return { uid: token, superadmin: token === 'platform' } as any; };
function appWith(k: Buffer | null = key) { const a = express(); a.use(express.json()); registerTikTokRoutes(a, db, verify, k, remote); return a; }
let app = appWith();
const base = '/api/tenants/a/integrations/tiktokshop', secret = 'test-only-tiktok-secret';
const body = { appKey: 'test-app', appSecret: secret, serviceId: '12345678901234567890', expectedRevision: 0 };
const shop = { id: '7000714532876273420', cipher: 'test-shop-cipher', name: 'Loja BR', region: 'BR' };
const token = () => ({ access_token: 'test-access', refresh_token: 'test-refresh', user_type: 0, open_id: 'seller', access_token_expire_in: Math.floor(Date.now()/1000)+3600, refresh_token_expire_in: Math.floor(Date.now()/1000)+86400 });
const respond = (data: any, code = 0, status = 200) => new Response(JSON.stringify({ code, data }), { status });
const get = (path: string, user = 'owner') => request(app).get(base+path).set('Authorization', `Bearer ${user}`);
const post = (path: string, data: any = {}, user = 'owner') => request(app).post(base+path).set('Authorization', `Bearer ${user}`).send(data);
const cRef = () => db.doc('privateTikTokConnections/a');
async function start() {
  const r = await post('/connect', { expectedRevision: 1 }).expect(200), url = new URL(r.body.authorizationUrl);
  return { state: url.searchParams.get('state')!, cookie: r.headers['set-cookie'][0].split(';')[0], url };
}
const callback = (f: Awaited<ReturnType<typeof start>>, extra = {}) => request(app).get('/api/integrations/tiktokshop/callback').query({ code: 'test-code', state: f.state, ...extra }).set('Cookie', f.cookie);
async function authorize(select = true) {
  await post('/credentials', body).expect(200); const flow = await start();
  expect((await callback(flow).expect(303)).headers.location).toContain('tiktokshop=select-shop');
  if (select) await post('/select-shop', { shopId: shop.id, connectionId: (await cRef().get()).data()!.connectionId }).expect(200);
  return flow;
}
beforeEach(async () => {
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents', { method: 'DELETE' });
  app = appWith();
  await db.doc('tenants/a').set({ ownerUid: 'owner', status: 'active' });
  await db.doc('users/admin').set({ tenantId: 'a', tenantRole: 'admin' });
  await db.doc('users/member').set({ tenantId: 'a', tenantRole: 'member' });
  await db.doc('users/platform').set({ role: 'superadmin' });
  remote.mockReset().mockImplementation(async raw => {
    const url = new URL(String(raw));
    if (url.hostname === 'auth.tiktok-shops.com') return respond(token());
    if (url.pathname.endsWith('/shops')) return respond({ shops: [shop] });
    if (url.pathname.endsWith('/search')) return respond({ products: [{ id: '1729592969712207008', title: 'Chaveiro', status: 'ACTIVATE', skus: [] }], total_count: 1, next_page_token: '' });
    throw Error('Unexpected endpoint');
  });
});
afterAll(async () => { await db.terminate(); await deleteApp(firebase); });
it('private credentials, revision CAS, secret preservation and audit', async () => {
  const r = await post('/credentials', body).expect(200); expect(r.body).toMatchObject({ hasSecret: true, revision: 1 });
  await post('/credentials', body).expect(409);
  await post('/credentials', { ...body, appSecret: '', expectedRevision: 1 }).expect(200);
  await post('/credentials', { ...body, appKey: 'other', appSecret: '', expectedRevision: 2 }).expect(400);
  const stored = (await db.doc('privateTikTokCredentials/a').get()).data()!;
  expect(openTikTok(key, 'a:credentials', stored.secret)).toBe(secret);
  const read = await get('/credentials').expect(200);
  const audits = (await db.collection('tenants/a/auditLogs').get()).docs.map(d => d.data());
  expect(JSON.stringify([read.body, r.body, stored, audits])).not.toContain(secret);
  expect(read.headers['cache-control']).toBe('no-store'); expect(read.body.secret).toBeUndefined();
});
it('requires admin, active tenant and live privilege; read listings allows active members', async () => {
  await request(app).get(base+'/credentials').expect(401);
  await get('/credentials', 'invalid').expect(401); await post('/credentials', body, 'member').expect(403);
  await post('/credentials', body, 'outsider').expect(403);
  await db.doc('users/platform').update({ role: 'member' }); await post('/credentials', body, 'platform').expect(403);
  await db.doc('tenants/a/members/admin').set({ active: false, role: 'admin' }); await post('/credentials', body, 'admin').expect(403);
  expect((await get('/listings', 'member').expect(200)).body).toMatchObject({ status: 'not-connected', total: null });
  await db.doc('tenants/a').update({ status: 'inactive' }); await get('/listings', 'owner').expect(403);
});
it('no key prevents writes and absent secret is never accepted', async () => {
  await post('/credentials', { ...body, appSecret: '' }).expect(400);
  await post('/credentials', { ...body, tenantId: 'b' }).expect(400);
  app = appWith(null); await post('/credentials', body).expect(503);
});
it('browser-bound single-use OAuth, fixed ROW service URL and explicit shop selection', async () => {
  const f = await authorize(false);
  expect(f.url.origin).toBe('https://services.tiktokshop.com'); expect(f.url.searchParams.get('service_id')).toBe(body.serviceId);
  expect((await cRef().get()).data()!.shop).toBeNull(); expect((await get('/listings', 'member')).body.status).toBe('select-shop');
  const count = remote.mock.calls.length; expect((await callback(f)).headers.location).toContain('invalid-state'); expect(remote).toHaveBeenCalledTimes(count);
  const settings = (await get('/credentials')).body;
  expect(JSON.stringify(settings)).not.toContain(shop.cipher); expect(JSON.stringify(settings)).not.toContain('test-access');
  await post('/select-shop', { shopId: shop.id, connectionId: 'stale' }).expect(409);
  await post('/select-shop', { shopId: '999', connectionId: settings.connection.connectionId }).expect(400);
  await post('/select-shop', { shopId: shop.id, connectionId: settings.connection.connectionId }).expect(200);
  expect((await get('/listings', 'member').expect(200)).body).toMatchObject({ status: 'connected', total: 1 });
});
it('missing cookie, expired, superseded or altered credential state cannot exchange token', async () => {
  await post('/credentials', body); const f = await start();
  expect((await callback({ ...f, cookie: '' })).headers.location).toContain('invalid-state');
  const ref = db.doc('privateTikTokOAuthStates/'+createHash('sha256').update(f.state).digest('hex')); await ref.update({ expiresAt: 1 });
  expect((await callback(f)).headers.location).toContain('invalid-state');
  const old = await start(); await start(); expect((await callback(old)).headers.location).toContain('invalid-state');
  const fresh = await start(); await post('/credentials', { ...body, expectedRevision: 1 });
  expect((await callback(fresh)).headers.location).toContain('invalid-state'); expect(remote).not.toHaveBeenCalled();
});
it('cancelled OAuth does not call provider and cannot be reused', async () => {
  await post('/credentials', body); const f = await start(); expect((await callback(f, { error: 'denied' })).headers.location).toContain('=denied');
  expect((await callback(f)).headers.location).toContain('invalid-state'); expect(remote).not.toHaveBeenCalled();
});
it('revoked admin during callback or credentials changed in flight cannot persist connection', async () => {
  for (const mode of ['revision', 'inactive']) {
    await db.doc('tenants/a').update({ status: 'active' });
    const revision = (await db.doc('privateTikTokCredentials/a').get()).data()?.revision || 0;
    await post('/credentials', { ...body, expectedRevision: revision });
    const r = await post('/connect', { expectedRevision: revision+1 }); const f = { state: new URL(r.body.authorizationUrl).searchParams.get('state')!, cookie: r.headers['set-cookie'][0].split(';')[0], url: new URL(r.body.authorizationUrl) };
    remote.mockImplementation(async raw => { if (String(raw).includes('/token/')) return respond(token());
      if (mode === 'revision') await db.doc('privateTikTokCredentials/a').update({ revision: revision+2 }); else await db.doc('tenants/a').update({ status: 'inactive' });
      return respond({ shops: [shop] }); });
    expect((await callback(f)).headers.location).toContain('invalid-state'); expect((await cRef().get()).exists).toBe(false);
  }
});
it('no Brazilian shop, creator token or provider error never reports successful authorization', async () => {
  await post('/credentials', body);
  for (const mode of ['foreign', 'creator', 'error']) {
    const f = await start(); remote.mockImplementation(async raw => String(raw).includes('/token/') ? respond({ ...token(), ...(mode === 'creator' ? { user_type: 1 } : {}) }, mode === 'error' ? 7 : 0) : respond({ shops: [{ ...shop, region: 'US' }] }));
    expect((await callback(f)).headers.location).not.toContain('=select-shop'); expect((await cRef().get()).exists).toBe(false);
  }
});
it('refresh rotates and persists tokens before a failed shop check', async () => {
  await authorize(); await cRef().update({ expiresAt: 1 });
  remote.mockImplementation(async raw => String(raw).includes('/token/refresh') ? respond({ ...token(), access_token: 'next-access', refresh_token: 'next-refresh' }) : respond({}, 7));
  await post('/check').expect(502);
  const c = (await cRef().get()).data()!; expect(openTikTok(key, 'a:tokens', c.tokens).refreshToken).toBe('next-refresh'); expect(c.refreshLease).toBeNull();
});
it('concurrent refresh is leased; uncertain failure requires reconnect without retry', async () => {
  await authorize(); await cRef().update({ expiresAt: 1 });
  let release!: () => void, began!: () => void; const gate = new Promise<void>(r => release = r), started = new Promise<void>(r => began = r);
  remote.mockReset().mockImplementation(async () => { began(); await gate; throw Error('network'); });
  const first = post('/check').then(r => r); await started;
  await post('/check').expect(409); release(); expect((await first).status).toBe(502);
  await post('/check').expect(409); expect(remote).toHaveBeenCalledTimes(1); expect((await cRef().get()).data()!.status).toBe('reconnect-required');
});
it('paginates, deduplicates and caches catalog; revoked membership cannot reuse cache', async () => {
  await authorize(); remote.mockClear().mockImplementation(async raw => {
    const url = new URL(String(raw)); expect(url.searchParams.get('shop_cipher')).toBe(shop.cipher);
    const second = url.searchParams.has('page_token');
    return respond({ products: [{ id: second ? '2' : '1', title: second ? 'B' : 'A', status: 'ACTIVATE' }], total_count: 2, next_page_token: second ? '' : 'page-two' });
  });
  const r = await get('/listings', 'member').expect(200); expect(r.body).toMatchObject({ total: 2, complete: true }); expect(r.body.listings).toHaveLength(2);
  await get('/listings', 'member').expect(200); expect(remote).toHaveBeenCalledTimes(2);
  await db.doc('tenants/a/members/member').set({ active: false, role: 'member' }); await get('/listings', 'member').expect(403);
});
it('partial pagination is explicit; malformed or failing provider never returns zero success', async () => {
  await authorize(); remote.mockImplementation(async () => respond({ products: [{ id: '1' }], total_count: 10, next_page_token: 'repeated' }));
  const r = await get('/listings').expect(200); expect(r.body).toMatchObject({ total: 10, complete: false });
  remote.mockResolvedValue(respond({ products: [{ id: 123 }], total_count: 1 })); await get('/listings?refresh=1').expect(503);
  remote.mockImplementation(async () => respond({}, 7)); await get('/listings?refresh=1').expect(502);
});
it('connection change during listing read cannot disclose stale shop results', async () => {
  await authorize(); remote.mockImplementation(async () => { await cRef().update({ connectionId: 'replacement' }); return respond({ products: [], total_count: 0 }); });
  await get('/listings').expect(409);
});
it('audit failure rolls back credential saving', async () => {
  const original = db.collection.bind(db), spy = vi.spyOn(db, 'collection').mockImplementation(p => { if (p.endsWith('/auditLogs')) throw Error(); return original(p); });
  try { await post('/credentials', body).expect(503); } finally { spy.mockRestore(); }
  expect((await db.doc('privateTikTokCredentials/a').get()).exists).toBe(false);
});
