import { afterAll, beforeAll, beforeEach, it, expect, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../../server';
import { customQuote } from '../fixtures/quotes';
import { fingerprint } from '../../server/quote-cost';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'assets-test'),
  db = getFirestore(firebase);
let app: Awaited<ReturnType<typeof createApp>>, rules: RulesTestEnvironment;
const objects = new Map<string, Buffer>();
const store = {
  put: vi.fn(async (path: string, b: Buffer) => {
    if (!objects.has(path)) objects.set(path, b);
  }),
  get: vi.fn(async (path: string) => objects.get(path)!),
};
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const upload = (bytes = png, name = 'peça.png', mime = 'image/png', uid = 'a', tenant = 'a') =>
  request(app)
    .post(`/api/tenants/${tenant}/assets/upload`)
    .set('Authorization', `Bearer ${uid}`)
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', encodeURIComponent(name))
    .set('X-File-Type', mime)
    .send(bytes);
const getAsset = (key: string, uid = 'a', tenant = 'a') =>
  request(app)
    .get(`/api/tenants/${tenant}/assets/${key}/download`)
    .set('Authorization', `Bearer ${uid}`);
beforeAll(async () => {
  rules = await initializeTestEnvironment({
    projectId: 'demo-lablayer-test',
    firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = await createApp({
    database: db,
    env: {},
    assetStore: store,
    verifyIdToken: async (token) => {
      if (token === 'invalid') throw new Error();
      return { uid: token } as any;
    },
  });
});
beforeEach(async () => {
  await rules.clearFirestore();
  objects.clear();
  store.put.mockClear();
  store.get.mockClear();
  await db.doc('tenants/a').set({ ownerUid: 'a', status: 'active' });
  await db.doc('tenants/b').set({ ownerUid: 'b', status: 'active' });
  await db.doc('users/member').set({ tenantId: 'a' });
});
afterAll(async () => {
  await rules.cleanup();
  await db.terminate();
  await deleteApp(firebase);
});
it('upload privado é recuperável, deduplicado por conteúdo/nome e não expõe bytes no Firestore', async () => {
  const first = (await upload().expect(200)).body;
  const again = (await upload().expect(200)).body;
  expect(again).toEqual(first);
  expect(objects.size).toBe(1);
  const metadata = (await db.doc(`tenants/a/assets/${first.id}`).get()).data()!;
  expect(metadata.size).toBe(png.length);
  expect(JSON.stringify(metadata)).not.toContain('base64');
  const download = await getAsset(first.id, 'member').expect(200);
  expect(download.body).toEqual(png);
  expect(download.headers['content-disposition']).toContain('attachment');
  expect(download.headers['cache-control']).toContain('no-store');
  expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(1);
});
it('identidade, empresa e rules protegem upload e download', async () => {
  await upload(png, 'x.png', 'image/png', 'invalid').expect(401);
  await upload(png, 'x.png', 'image/png', 'b').expect(403);
  expect(store.put).not.toHaveBeenCalled();
  const { id } = (await upload().expect(200)).body;
  await getAsset(id, 'b').expect(403);
  await getAsset(id, 'b', 'b').expect(404);
  for (const c of ['assets', 'assetMigrations'])
    await assertFails(
      setDoc(doc(rules.authenticatedContext('a').firestore(), `tenants/a/${c}/forged`), {
        path: 'elsewhere',
      }),
    );
});
it('rejeita disfarce de formato, nomes inseguros e arquivo acima do limite', async () => {
  await upload(Buffer.from('<script>bad</script>')).expect(422);
  await upload(png, '../a.png').expect(422);
  await upload(png, 'evil.svg', 'image/svg+xml').expect(422);
  await upload(Buffer.alloc(10 * 1024 * 1024 + 1)).expect(413);
  expect(store.put).not.toHaveBeenCalled();
});
it('falha no storage não publica metadata; falha na auditoria permite recuperar o mesmo objeto', async () => {
  store.put.mockRejectedValueOnce(new Error('offline'));
  await upload().expect(503);
  expect((await db.collection('tenants/a/assets').get()).empty).toBe(true);
  const first = (await upload().expect(200)).body;
  await db.doc(`tenants/a/assets/${first.id}`).delete(); // simulates metadata absent while object/audit exist
  await upload().expect(503);
  expect((await db.collection('tenants/a/assets').get()).empty).toBe(true);
  expect(objects.size).toBe(1);
  await db.doc(`tenants/a/auditLogs/asset-${first.id}`).delete();
  await upload().expect(200);
  expect(objects.size).toBe(1);
});
it('recusa arquivo corrompido mesmo quando sua metadata existe', async () => {
  const { id } = (await upload().expect(200)).body;
  objects.set(`tenants/a/managed-assets/${id}`, Buffer.from('changed'));
  await getAsset(id).expect(409);
});
it('migração exige dono, prévia estável e mantém documento original intacto', async () => {
  const source = {
    name: 'Produto antigo',
    imageUrl: `data:image/png;base64,${png.toString('base64')}`,
  };
  await db.doc('tenants/a/products/old').set(source);
  const endpoint = '/api/tenants/a/assets/legacy/products/old';
  await request(app).get(endpoint).set('Authorization', 'Bearer member').expect(403);
  const { files } = (await request(app).get(endpoint).set('Authorization', 'Bearer a').expect(200))
    .body;
  await request(app)
    .post(endpoint)
    .set('Authorization', 'Bearer a')
    .send({ field: 'imageUrl', sourceHash: 'stale' })
    .expect(409);
  const body = { field: files[0].field, sourceHash: files[0].sourceHash };
  const first = (
    await request(app).post(endpoint).set('Authorization', 'Bearer a').send(body).expect(200)
  ).body;
  const again = (
    await request(app).post(endpoint).set('Authorization', 'Bearer a').send(body).expect(200)
  ).body;
  expect(first.id).toBe(again.id);
  expect((await db.doc('tenants/a/products/old').get()).data()).toEqual(source);
  expect((await db.collection('tenants/a/assetMigrations').get()).size).toBe(1);
});
it('referência privada no orçamento exige arquivo pertencente à empresa', async () => {
  const data = customQuote();
  data.lines[0].referenceUrl = `asset:${'a'.repeat(64)}`;
  const save = () =>
    request(app)
      .post('/api/tenants/a/quotes/q/commands')
      .set('Authorization', 'Bearer a')
      .send({
        type: 'save-draft',
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        payload: { data, reason: 'Com arquivo' },
      });
  await save().expect(422);
  data.lines[0].referenceUrl = (await upload().expect(200)).body.reference;
  await save().expect(200);
  expect((await db.doc('tenants/a/quotes/q').get()).data()?.data.lines[0].referenceUrl).toBe(
    data.lines[0].referenceUrl,
  );
});
