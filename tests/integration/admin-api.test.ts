import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../server';
import { writeAdminDocument } from '../../server/admin-writes';

const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'api-test');
const db = getFirestore(firebase);
let app: Awaited<ReturnType<typeof createApp>>;
let rules: RulesTestEnvironment;
const tokenHash = (x: string) => createHash('sha256').update(x).digest('hex');
const url = (collection = 'customRequests', id = '') => `/api/admin/tenants/a/${collection}${id ? `/${id}` : ''}`;
const api = () => request(app);
const authenticate = (test: request.Test, token = 'scoped') => test.set('Authorization', `Bearer ${token}`);
beforeAll(async () => {
  rules = await initializeTestEnvironment({ projectId: 'demo-lablayer-test', firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') } });
  app = await createApp({ database: db, env: {
    ADMIN_API_TOKEN: 'technical', WHATSAPP_INGEST_TOKEN: 'whatsapp', WHATSAPP_TENANT_ID: 'a',
    LABLAYER_API_KEYS_JSON: JSON.stringify([
      { id: 'key-a', actor: 'integration-a', tenantId: 'a', tokenHash: tokenHash('scoped'), scopes: ['customRequests:write', 'suppliers:write', 'marketplaces:write'] },
      { id: 'reader', actor: 'reader', tenantId: 'a', tokenHash: tokenHash('read-only') },
    ]),
  } });
});
beforeEach(async () => {
  await rules.clearFirestore();
  for (const id of ['a', 'b']) await db.doc(`tenants/${id}`).set({ ownerUid: id, companyName: id, plan: 'free', status: 'active', createdAt: '2026-01-01' });
  await db.doc('tenants/a/filaments/f').set({ material: 'PLA', color: 'Azul', pricePerKg: 100, stockKg: 1 });
});
afterAll(async () => { await rules.cleanup(); await db.terminate(); await deleteApp(firebase); });

describe('E0.3/E0.4 API real com Firestore local', () => {
  it('PATCH conserva título, preços, quantidade, materiais e criação; ator vem da chave', async () => {
    const created = await authenticate(api().post(url())).send({ id: 'r', name: 'Peça', observation: 'Texto', requestedQuantity: 10,
      quotedPrice: 123.45, filaments: [{ id: 'line', filamentId: 'f', filamentName: 'PLA', weightGrams: 10 }] }).expect(201);
    const updated = await authenticate(api().patch(url('customRequests', 'r'))).set('x-lablayer-admin-actor', 'forged')
      .send({ status: 'orcado' }).expect(200);
    expect(updated.body.item).toEqual({ ...created.body.item, status: 'orcado', updatedAt: updated.body.item.updatedAt });
    expect(updated.body.item).not.toHaveProperty('observation');
    expect(updated.body.item).not.toHaveProperty('name');
    const logs = (await db.collection('tenants/a/auditLogs').get()).docs.map(x => x.data());
    expect(logs).toHaveLength(2);
    expect(logs.every(x => x.actor === 'integration-a' && x.keyId === 'key-a')).toBe(true);
    await assertSucceeds(updateDoc(doc(rules.authenticatedContext('a').firestore(), 'tenants/a/customRequests/r'), { description: 'Editável na UI' }));
  });
  it('POST concorrente com mesmo ID cria uma vez, audita uma vez e retorna conflito', async () => {
    const results = await Promise.all([1, 2].map(() => authenticate(api().post(url())).send({ id: 'same', title: 'Original' })));
    expect(results.map(x => x.status).sort()).toEqual([201, 409]);
    expect((await db.collection('tenants/a/customRequests').get()).size).toBe(1);
    expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(1);
    await authenticate(api().post(url())).send({ id: 'same', title: 'Sobrescrita' }).expect(409);
    expect((await db.doc('tenants/a/customRequests/same').get()).data()?.title).toBe('Original');
  });
  it('PATCH concorrente em campos distintos conserva ambos', async () => {
    await authenticate(api().post(url())).send({ id: 'r', title: 'Original' }).expect(201);
    const responses = await Promise.all([
      authenticate(api().patch(url('customRequests', 'r'))).send({ description: 'Nova descrição' }),
      authenticate(api().patch(url('customRequests', 'r'))).send({ quotedPrice: 20 }),
    ]);
    expect(responses.every(x => x.status === 200)).toBe(true);
    expect((await db.doc('tenants/a/customRequests/r').get()).data()).toMatchObject({ description: 'Nova descrição', quotedPrice: 20 });
  });
  it('validação falha sem gravar nem auditar', async () => {
    await authenticate(api().post(url())).send({ id: 'r', title: 'Peça', requestedQuantity: -1 }).expect(400);
    await authenticate(api().post(url())).send({ id: 'r', title: 'Peça', printerId: 'foreign' }).expect(400);
    await db.doc('tenants/b/printers/foreign').set({ name: 'Outra empresa' });
    await authenticate(api().post(url())).send({ id: 'r', title: 'Peça', printerId: 'foreign' }).expect(400);
    expect((await db.collection('tenants/a/customRequests').get()).empty).toBe(true);
    expect((await db.collection('tenants/a/auditLogs').get()).empty).toBe(true);
  });
  it('falha ao preparar auditoria aborta também a escrita do documento', async () => {
    await expect(writeAdminDocument(db, { tenantId: 'a', collection: 'customRequests', id: 'r', payload: { title: 'Peça' },
      mode: 'create', actor: undefined as any, keyId: 'broken-audit' })).rejects.toThrow();
    expect((await db.doc('tenants/a/customRequests/r').get()).exists).toBe(false);
    expect((await db.collection('tenants/a/auditLogs').get()).empty).toBe(true);
  });
  it('não altera createdAt em PATCH/PUT', async () => {
    await authenticate(api().post(url())).send({ id: 'r', title: 'Original' }).expect(201);
    await authenticate(api().patch(url('customRequests', 'r'))).send({ createdAt: 'outra data' }).expect(400);
    await authenticate(api().put(url('customRequests', 'r'))).send({ title: 'Outro', createdAt: 'outra data' }).expect(400);
  });
  it('nega chave de outra empresa, ausência de escopo, caminho embutido e exclusão', async () => {
    await authenticate(api().post('/api/admin/tenants/b/customRequests')).send({ title: 'x' }).expect(403);
    await authenticate(api().post(url()), 'read-only').send({ title: 'x' }).expect(403);
    await authenticate(api().post(url())).send({ id: 'a/b/c', title: 'x' }).expect(400);
    await authenticate(api().delete(url('customRequests', 'r'))).expect(403);
    await api().post(url()).send({ title: 'x' }).expect(401);
  });
  it.each(['products', 'filaments', 'supplies', 'productionOrders', 'orders', 'inventoryMovements', 'transactions'])('bloqueia escrita genérica em %s até os comandos de domínio', async collection => {
    await authenticate(api().post(url(collection)), 'technical').send({ name: 'x' }).expect(403);
  });
  it.each(['suppliers', 'marketplaces'])('documento de %s criado por API continua editável pelo cliente', async collection => {
    await authenticate(api().post(url(collection))).send({ id: 'entry', name: 'Nome' }).expect(201);
    await assertSucceeds(updateDoc(doc(rules.authenticatedContext('a').firestore(), `tenants/a/${collection}/entry`), { name: 'Editado' }));
  });
  it('exportação fornece cursores e permite recuperar além de 500 sem duplicação', async () => {
    for (let offset = 0; offset < 505; offset += 200) {
      const batch = db.batch();
      for (let i = offset; i < Math.min(offset + 200, 505); i++) batch.set(db.doc(`tenants/a/suppliers/s${String(i).padStart(4, '0')}`), { name: `Fornecedor ${i}` });
      await batch.commit();
    }
    const first = await authenticate(api().get('/api/admin/tenants/a/export').query({ collections: 'suppliers', limit: 500 })).expect(200);
    expect(first.body.collections.suppliers).toHaveLength(500);
    expect(first.body.hasMore).toBe(true);
    const last = await authenticate(api().get('/api/admin/tenants/a/export').query({ collections: 'suppliers', limit: 500, cursors: JSON.stringify(first.body.nextCursors) })).expect(200);
    expect(last.body.collections.suppliers).toHaveLength(5);
    expect(last.body.hasMore).toBe(false);
    expect(new Set([...first.body.collections.suppliers, ...last.body.collections.suppliers].map((x: any) => x.id)).size).toBe(505);
  });
});

describe('E0.4 entradas externas', () => {
  const endpoint = '/api/public/tenants/a/custom-requests/whatsapp';
  it('WhatsApp exige credencial, empresa vinculada e ID estável', async () => {
    await api().post(endpoint).send({ eventId: 'm1', title: 'Peça' }).expect(401);
    await api().post(endpoint.replace('/a/', '/b/')).set('x-lablayer-webhook-token', 'whatsapp').send({ eventId: 'm1', title: 'Peça' }).expect(401);
    await api().post(endpoint).set('x-lablayer-webhook-token', 'whatsapp').send({ title: 'Peça' }).expect(400);
    const unconfigured = await createApp({ database: db, env: {} });
    await request(unconfigured).post(endpoint).send({ eventId: 'm1', title: 'Peça' }).expect(503);
  });
  it('mensagem repetida é idempotente e conteúdo conflitante é rejeitado', async () => {
    const send = () => api().post(endpoint).set('x-lablayer-webhook-token', 'whatsapp').send({ eventId: 'message1', title: 'Peça' });
    const results = await Promise.all([send(), send()]);
    expect(results.every(x => [200, 201].includes(x.status))).toBe(true);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect((await db.collection('tenants/a/customRequests').get()).size).toBe(1);
    expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(1);
    expect((await db.collection('tenants/a/webhookReceipts').get()).size).toBe(1);
    await send().expect(200);
    await api().post(endpoint).set('x-lablayer-webhook-token', 'whatsapp').send({ eventId: 'message1', title: 'Outra peça' }).expect(409);
  });
  it('mensagem não aprova nem confirma pagamento', async () => {
    await api().post(endpoint).set('x-lablayer-webhook-token', 'whatsapp').send({ eventId: 'm1', status: 'finalizado' }).expect(400);
    await api().post(endpoint).set('x-lablayer-webhook-token', 'whatsapp').send({ eventId: 'm1', paidAt: '2026-01-01' }).expect(400);
  });
  it.each(['/api/integrations/woocommerce/sync-product', '/api/webhooks/woocommerce/orders/create', '/api/webhooks/shopify/orders/create'])('conector incompleto %s não aceita operação', async endpoint => {
    await api().post(endpoint).send({ id: 1 }).expect(501);
    expect((await db.collection('integrations_woo_orders').get()).empty).toBe(true);
  });
});
