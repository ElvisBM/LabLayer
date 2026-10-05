import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../../server';
import { fixture } from '../fixtures/legacy-pricing';
import { calculateChannelPrice } from '../../src/utils/pricing';

const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'pricing-test');
const db = getFirestore(firebase);
let app: Awaited<ReturnType<typeof createApp>>, rules: RulesTestEnvironment;
const path = '/api/tenants/a/products/p/pricing-snapshots';
const command = { requestId: 'request1', variationId: 'v', channelId: 'c', targetType: 'margin', targetValue: 20, includeAffiliate: false };
const channel = { name: 'Direto', status: 'ativo', commissionPercent: 10, fixedFee: 2, averageShipping: 0, affiliateCommission: 5 };
const send = (body = command, uid = 'a') => request(app).post(path).set('Authorization', `Bearer ${uid}`).send(body);
beforeAll(async () => {
  rules = await initializeTestEnvironment({ projectId: 'demo-lablayer-test', firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') } });
  app = await createApp({ database: db, env: { ADMIN_API_TOKEN: 'technical' }, verifyIdToken: async token => {
    if (token === 'invalid') throw new Error('invalid');
    return { uid: token } as any;
  } });
});
beforeEach(async () => {
  await rules.clearFirestore(); const f = fixture();
  await db.doc('tenants/a').set({ ownerUid: 'a', status: 'active' });
  await db.doc('tenants/a/products/p').set({ name: 'Peça', status: 'ativo', variations: [{ id: 'v', ...f.variation }], fixedCost: f.fixedCost, supplyUsages: f.supplyUsages, wastes: f.wastes,
    pricingHistory: Array.from({ length: 50 }, (_, i) => ({ id: `old${i}`, suggestedPrice: i })) });
  await db.doc('tenants/a/filaments/f').set(f.filaments[0]);
  await db.doc('tenants/a/supplies/s').set(f.supplies![0]);
  await db.doc('tenants/a/printers/m').set(f.printers![0]);
  await db.doc('tenants/a/settings/pricing').set(f.pricingSettings);
  await db.doc('tenants/a/settings/printer').set({ energyPrice: f.energyPrice });
  await db.doc('tenants/a/marketplaces/c').set(channel);
});
afterAll(async () => { await rules.cleanup(); await db.terminate(); await deleteApp(firebase); });
it('API e consumidor compartilham custo decimal, insumos, perdas e sugestão', async () => {
  const response = await request(app).get('/api/admin/tenants/a/products/p').set('Authorization', 'Bearer technical').expect(200);
  expect(response.body.apiComputedPricing).toMatchObject({ pricingComplete: true, calculatedUnitCost: 5.628, calculatedSuggestedSalePrice: 12.39 });
  const saved = await send().expect(201);
  expect(saved.body.snapshot).toMatchObject({ cost: 5.628, suggestedPrice: calculateChannelPrice('5.628', channel, 'margin', 20).finalPrice,
    calculationVersion: 'legacy-compatible-v2', actorUid: 'a', pricingVersion: 'lablayer-price-v1', breakdown: { totalDecimal: '5.628' } });
  expect(saved.body.snapshot.inputs.supplyUsages).toHaveLength(1); expect(saved.body.snapshot.inputs.wastes).toHaveLength(1);
  expect((await db.doc('tenants/a/products/p').get()).data()?.pricingHistory).toHaveLength(50);
});
it('snapshot e auditoria são atômicos e idempotentes sob concorrência', async () => {
  const responses = await Promise.all([send(), send()]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
  expect((await db.collection('tenants/a/products/p/pricingSnapshots').get()).size).toBe(1);
  expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(1);
  await send({ ...command, targetValue: 30 }).expect(409);
  const first = responses[0].body.snapshot;
  await db.doc('tenants/a/filaments/f').update({ pricePerKg: 900 });
  expect((await send().expect(200)).body.snapshot).toEqual(first);
  const newer = (await send({ ...command, requestId: 'request2' }).expect(201)).body.snapshot;
  expect(newer.cost).toBeGreaterThan(first.cost);
  expect((await db.doc('tenants/a/products/p/pricingSnapshots/request1').get()).data()).toEqual(first);
});
it('recusa preço/custo/ator enviado pelo cliente, credenciais inválidas e outro tenant', async () => {
  await request(app).post(path).send(command).expect(401);
  await send(command, 'invalid').expect(401); await send(command, 'b').expect(403);
  await send({ ...command, cost: 0, actorUid: 'forged' } as any).expect(400);
  await send({ ...command, variationId: 'nope' }).expect(400);
  await send({ ...command, requestId: 'a/b' }).expect(400);
  expect((await db.collection('tenants/a/auditLogs').get()).empty).toBe(true);
});
it('ausência de insumo não vira custo zero e não permite snapshot', async () => {
  await db.doc('tenants/a/supplies/s').delete();
  await send().expect(422);
  const result = await request(app).get('/api/admin/tenants/a/products/p').set('Authorization', 'Bearer technical').expect(200);
  expect(result.body.apiComputedPricing).toMatchObject({ pricingComplete: false, calculatedUnitCost: null, calculatedSuggestedSalePrice: null });
  expect((await db.collection('tenants/a/products/p/pricingSnapshots').get()).empty).toBe(true);
});
it('meta inviável, produto arquivado e empresa inativa não geram gravação', async () => {
  await send({ ...command, targetValue: 90 }).expect(422);
  await db.doc('tenants/a/products/p').update({ status: 'inativo' }); await send().expect(409);
  await db.doc('tenants/a').update({ status: 'inactive' }); await send().expect(403);
  expect((await db.collection('tenants/a/auditLogs').get()).empty).toBe(true);
});
it('regras bloqueiam alteração de histórico, snapshot e ponteiro de cálculo pelo cliente', async () => {
  await send().expect(201);
  const client = rules.authenticatedContext('a').firestore();
  await assertFails(updateDoc(doc(client, 'tenants/a/products/p'), { latestSuggestedPrice: { suggestedPrice: 0 } }));
  await assertFails(updateDoc(doc(client, 'tenants/a/products/p/pricingSnapshots/request1'), { cost: 0 }));
  await assertFails(deleteDoc(doc(client, 'tenants/a/products/p/pricingSnapshots/request1')));
  await assertFails(setDoc(doc(client, 'tenants/a/products/p/pricingSnapshots/fake'), { calculationVersion: 'legacy-compatible-v2' }));
});
it('custo manual zero é explícito e não é preço de venda nem lucro automático', async () => {
  const client = rules.authenticatedContext('a').firestore();
  const sale = { orderNumber: 'O1', date: '2026-10-05', productName: 'Peça', channelName: 'Direto', status: 'pago', quantity: 1, soldPrice: 10, fees: 0, realCost: 0, realProfit: 10, createdAt: '2026-10-05' };
  await assertFails(setDoc(doc(client, 'tenants/a/orders/o'), sale));
  await setDoc(doc(client, 'tenants/a/orders/o'), { ...sale, costSource: 'manual-confirmed' });
});
