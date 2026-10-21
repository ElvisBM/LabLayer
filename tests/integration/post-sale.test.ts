import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../../server';
import { catalogData, printRecipe } from '../fixtures/catalog';
import { productQuote } from '../fixtures/quotes';
import { CONTENTION_TIMEOUT_MS } from '../contention-timeout';
import { targetId } from '../../server/quotes';
import { localDay } from '../../shared/finance/model';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'post-sale-test'),
  db = getFirestore(firebase);
let app: Awaited<ReturnType<typeof createApp>>, rules: RulesTestEnvironment;
const get = async (p: string) => (await db.doc(`tenants/a/${p}`).get()).data()!;
const set = (p: string, data: any) => db.doc(`tenants/a/${p}`).set(data);
const size = async (p: string) => (await db.collection(`tenants/a/${p}`).get()).size;
const post = (
  type: string,
  payload: any,
  expectedVersion = 0,
  requestId: string = crypto.randomUUID(),
  uid = 'a',
  tenant = 'a',
) =>
  request(app)
    .post(`/api/tenants/${tenant}/finance/commands`)
    .set('Authorization', `Bearer ${uid}`)
    .send({ type, payload, expectedVersion, requestId });
const stock = (
  type: string,
  payload: any,
  expectedVersion = 0,
  requestId: string = crypto.randomUUID(),
) =>
  request(app)
    .post('/api/tenants/a/inventory/commands')
    .set('Authorization', 'Bearer a')
    .send({ type, payload, expectedVersion, requestId });
const quote = (
  type: string,
  payload: any,
  expectedRevision = 0,
  requestId: string = crypto.randomUUID(),
) =>
  request(app)
    .post('/api/tenants/a/quotes/q/commands')
    .set('Authorization', 'Bearer a')
    .send({ type, payload, expectedRevision, requestId });
const report = () =>
  request(app)
    .get(`/api/tenants/a/finance/report?month=${localDay(new Date().toISOString()).slice(0, 7)}`)
    .set('Authorization', 'Bearer a');
const receipt = (amountCents = 5100, feeCents = 200, source = 'PIX parcela 1') => ({
  orderId: 'q',
  amountCents,
  feeCents,
  source,
  reason: 'Extrato conferido',
  effectiveAt: new Date().toISOString(),
});
const bill = (patch = {}) => ({
  description: 'Energia',
  category: 'energy',
  amountCents: 1000,
  dueDate: '2099-01-01',
  purchaseId: '',
  source: 'Fatura energia',
  reason: 'Documento conferido',
  ...patch,
});
const payment = (payableId: string, amountCents = 1000, source = 'Banco pagamento 1') => ({
  payableId,
  amountCents,
  source,
  effectiveAt: new Date().toISOString(),
  reason: 'Débito confirmado',
});
const close = () => ({
  orderId: 'q',
  actualExtraCents: 200,
  source: 'Frete confirmado e taxas conferidas',
  confirmed: true,
  reason: 'Pedido conferido',
});
const target = targetId('q', 'line'),
  p = { kind: 'product', id: 'p', variationId: 'blue' },
  f = { kind: 'filament', id: 'filament', variationId: '' },
  s = { kind: 'supply', id: 'supply', variationId: '' };
const plan = (requestId = 'plan', reprintOf = '') =>
  stock(
    'plan',
    {
      orderId: target,
      productId: 'p',
      variationId: 'blue',
      recipeVersion: 'v1',
      runs: 1,
      reprintOf,
      reason: 'Fabricação da falta',
    },
    0,
    requestId,
  );
const completion = (planId = 'plan', changes = {}) => ({
  planId,
  runs: 1,
  goodUnits: 9,
  rejectedUnits: 1,
  durationSeconds: 7000,
  actual: [
    { item: f, quantity: '450' },
    { item: s, quantity: '18' },
  ],
  conversion: { energy: '1', labor: '2', machine: '1', other: '0', source: 'Consumo medido' },
  reason: 'Conferência real',
  ...changes,
});
async function deliver() {
  await plan().expect(200);
  await stock('complete', completion(), 1, 'run').expect(200);
  await stock(
    'reserve-order',
    { orderId: target, item: p, quantity: '5', reason: 'Separação' },
    0,
    'reserve',
  ).expect(200);
  await stock(
    'ship',
    { reservationId: 'reserve', quantity: '5', reason: 'Entregue' },
    1,
    'shipment',
  ).expect(200);
}
beforeAll(async () => {
  rules = await initializeTestEnvironment({
    projectId: 'demo-lablayer-test',
    firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') },
  });
  app = await createApp({
    database: db,
    env: {},
    verifyIdToken: async (token) => {
      if (token === 'invalid') throw new Error();
      return { uid: token } as any;
    },
  });
});
beforeEach(async () => {
  await rules.clearFirestore();
  await db.doc('tenants/a').set({ ownerUid: 'a', status: 'active' });
  await db.doc('tenants/b').set({ ownerUid: 'b', status: 'active' });
  await db.doc('users/member').set({ tenantId: 'a', tenantRole: 'member' });
  await db.doc('users/admin').set({ tenantId: 'a', tenantRole: 'admin' });
  await set('filaments/filament', { material: 'PLA', color: 'Azul' });
  await set('supplies/supply', { name: 'Caixa', unit: 'un' });
  await set('printers/printer', {
    name: 'Máquina',
    status: 'operacional',
    acquisitionCost: 1000,
    lifespanHours: 1000,
    powerConsumption: 0.1,
  });
  await set('catalogItems/p', { ...catalogData(), revision: 1, recipeHeads: { blue: 'v1' } });
  await set('catalogItems/p/recipes/v1', {
    recipe: printRecipe(),
    variationId: 'blue',
    productId: 'p',
    version: 1,
  });
  await stock('freeze', { reason: 'Corte', backupReference: 'Backup conferido' }).expect(200);
  for (const [item, quantity, value] of [
    [f, '10000', '100'],
    [s, '100', '50'],
    [p, '0', '0'],
  ] as const)
    await stock('open', { item, quantity, value, source: 'Contagem', reason: 'Abertura' }).expect(
      200,
    );
  await stock('activate', { reason: 'Conferido', confirmed: true }, 1).expect(200);
  await quote('save-draft', { data: productQuote(), reason: 'Solicitado' }).expect(200);
  const preview = await request(app)
    .post('/api/tenants/a/quotes/q/preview')
    .set('Authorization', 'Bearer a')
    .send({ expectedRevision: 1 })
    .expect(200);
  expect(preview.body.price.priceCents).toBe(5100);
  await quote(
    'issue',
    {
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      previewFingerprint: preview.body.fingerprint,
    },
    1,
    'version',
  ).expect(200);
  await quote(
    'approve',
    { versionId: 'version', reportedBy: 'Cliente', channel: 'Telefone', evidence: 'Protocolo 1' },
    2,
  ).expect(200);
});
afterAll(async () => {
  await rules.cleanup();
  await db.terminate();
  await deleteApp(firebase);
});

const amendment = (creditCents = 2040, quantity = 2, source = 'Acordo 1') => ({
  orderId: 'q',
  creditCents,
  waivers: [{ targetId: target, quantity }],
  source,
  reason: 'Cliente devolveu duas peças',
  reportedBy: 'Cliente por protocolo registrado',
});
const returned = (quantity = '2', disposition = 'restock') => ({
  shipmentId: 'shipment',
  quantity,
  disposition,
  reason: 'Recebido e inspecionado',
  physicalConfirmed: true,
});
it('devolução parcial, crédito e reembolso conservam estoque, custo, preço original e caixa', async () => {
  await deliver();
  await post('receive', receipt(), 0, 'receipt').expect(200);
  await post('close-order', close(), 1, 'closed').expect(200);
  await stock('return', returned(), 2).expect(409);
  await post('reopen-order', { orderId: 'q', reason: 'Devolução' }, 2).expect(200);
  await stock('return', returned(), 2, 'returned').expect(200);
  await stock('return', returned(), 2, 'returned').expect(200);
  expect((await get('stockBalances/product~p~blue')).quantity).toBe('6');
  expect((await get('stockBalances/filament~filament~')).quantity).toBe('9550');
  await post('amend-order', amendment(), 3, 'agreement').expect(200);
  const r = (await report().expect(200)).body;
  expect(r.consistent).toBe(true);
  expect(r.orders[0]).toMatchObject({
    priceCents: 5100,
    effectivePriceCents: 3060,
    refundDueCents: 2040,
    receivableCents: 0,
    fullyShipped: true,
    recoveredCost: '3.888888888889',
  });
  expect(r.approvedRevenueCents).toBe(5100);
  expect(r.creditCents).toBe(2040);
  await post('close-order', close(), 4).expect(409);
  await post('refund', receipt(2040, 0, 'Reembolso acordo'), 4).expect(200);
  await post('close-order', close(), 5).expect(200);
  const final = (await report().expect(200)).body;
  expect(final.consistent).toBe(true);
  expect(final.orders[0].actualCost).toBe('7.833333333333');
  expect(final.orders[0].actualProfit).toBe('20.766666666667');
  expect(final.cash.netCents).toBe(2860);
  expect(final.orders[0].closures).toHaveLength(2);
});
it('descarte não recupera custo e a troca reabre entrega sem criar recebimento', async () => {
  await deliver();
  await stock('return', returned('2', 'scrap'), 2).expect(200);
  expect((await get('stockBalances/product~p~blue')).quantity).toBe('4');
  await stock(
    'reserve-order',
    { orderId: target, item: p, quantity: '2', reason: 'Reposição' },
    3,
    'replacement',
  ).expect(200);
  await stock('ship', { reservationId: 'replacement', quantity: '2', reason: 'Troca' }, 1).expect(
    200,
  );
  const r = (await report().expect(200)).body;
  expect(r.consistent).toBe(true);
  expect(r.orders[0].fullyShipped).toBe(true);
  expect(r.orders[0].recoveredCost).toBe('0');
  expect(Number(r.orders[0].shipmentCost)).toBeCloseTo(13.611111111111, 10);
  expect(r.cash.netCents).toBe(0);
});
it(
  'devoluções concorrentes não excedem origem e retornos fracionados recuperam todo o custo',
  async () => {
    await deliver();
    const both = await Promise.all([
      stock('return', returned('3'), 2),
      stock('return', returned('3'), 2),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    await stock('return', returned('3'), 3).expect(422);
    await stock('return', returned('2'), 3).expect(200);
    const r = (await report().expect(200)).body;
    expect(r.consistent).toBe(true);
    expect(r.orders[0].recoveredCost).toBe('9.722222222222');
    expect((await get('stockBalances/product~p~blue')).value).toBe('17.5');
  },
  CONTENTION_TIMEOUT_MS,
);
it('revisão após produção preserva consumo, encerra escopo dispensado e permite pedido substituto', async () => {
  await plan().expect(200);
  await post('amend-order', amendment(5100, 5)).expect(409);
  await stock('complete', completion(), 1).expect(200);
  await post('amend-order', amendment(5100, 5), 0, 'agreement').expect(200);
  await post('receive', receipt(1, 0)).expect(409);
  await post('close-order', { ...close(), actualExtraCents: 0 }, 1).expect(200);
  const r = (await report().expect(200)).body;
  expect(r.consistent).toBe(true);
  expect(r.orders[0].actualCost).toBe('0'); // unshipped good production remains inventory
  expect((await get('stockBalances/product~p~blue')).quantity).toBe('9');
  await request(app)
    .post('/api/tenants/a/quotes/revised/commands')
    .set('Authorization', 'Bearer a')
    .send({
      type: 'save-draft',
      requestId: 'revised-draft',
      expectedRevision: 0,
      payload: { data: { ...productQuote(), replacesOrderId: 'q' }, reason: 'Novo escopo' },
    })
    .expect(200);
});
it('acordos são versionados, corrigíveis, auditados e não duplicam por retry', async () => {
  await post('amend-order', amendment(), 0, 'agreement').expect(200);
  await post('amend-order', amendment(), 0, 'agreement').expect(200);
  expect(await size('orderAmendments')).toBe(1);
  await post('amend-order', amendment(0, 0, 'Correção aceita'), 1).expect(200);
  const r = (await report().expect(200)).body;
  expect(r.consistent).toBe(true);
  expect(r.creditCents).toBe(0);
  expect(r.orders[0].effectivePriceCents).toBe(5100);
  expect(r.orders[0].amendments).toHaveLength(2);
});
it('não dispensa entrega já realizada; exige evidência, permissão e empresa correta', async () => {
  await deliver();
  await post('amend-order', amendment()).expect(422);
  await post('amend-order', amendment(5101, 0)).expect(422);
  await post('amend-order', { ...amendment(100, 0), reportedBy: '' }).expect(422);
  await post('amend-order', amendment(100, 0), 0, 'x', 'member').expect(403);
  await post('amend-order', amendment(100, 0), 0, 'x', 'b').expect(403);
  await stock('return', { ...returned(), physicalConfirmed: false }, 2).expect(422);
  for (const c of ['stockReturns', 'orderAmendments']) {
    const client = rules.authenticatedContext('a').firestore();
    await assertFails(setDoc(doc(client, `tenants/a/${c}/forged`), { value: 1 }));
  }
});
it('falha de auditoria não aplica crédito; projeção adulterada é detectada', async () => {
  await set('auditLogs/finance-fail', { existing: true });
  await post('amend-order', amendment(), 0, 'fail').expect(503);
  expect(await size('orderAmendments')).toBe(0);
  expect((await get('salesOrders/q')).creditCents).toBeUndefined();
  await post('amend-order', amendment(), 0, 'valid').expect(200);
  await db.doc('tenants/a/orderTargets/' + target).update({ waivedQuantity: 1 });
  const r = (await report().expect(200)).body;
  expect(r.consistent).toBe(false);
  expect(r.discrepancies.join(' ')).toContain('dispensa');
});
