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
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'finance-test'),
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

it('aprovação e conta prevista não geram caixa; custo realizado fica desconhecido até conferência', async () => {
  await post('create-payable', bill()).expect(200);
  const r = (await report().expect(200)).body;
  expect(r.approvedRevenueCents).toBe(5100);
  expect(r.receivableCents).toBe(5100);
  expect(r.cash.netCents).toBe(0);
  expect(r.payableCents).toBe(1000);
  expect(r.orders[0].actualCost).toBeNull();
  expect(r.orders[0].estimatedCost).toBe('32.2');
  expect(r.consistent).toBe(true);
});
it('recebimentos parciais e taxas retidas conciliam sem antecipar produção ou pagar por estimativa', async () => {
  await post('receive', receipt(2000, 100), 0, 'r1').expect(200);
  expect((await get('salesOrders/q')).paymentStatus).toBe('partial');
  await post('receive', receipt(3100, 100, 'PIX parcela 2'), 1, 'r2').expect(200);
  const r = (await report().expect(200)).body;
  expect(r.cash.netCents).toBe(4900);
  expect(r.receivableCents).toBe(0);
  expect(r.orders[0].paymentStatus).toBe('paid');
  expect(r.orders[0].actualFeesCents).toBe(200);
  expect(r.orders[0].estimatedFeesCents).toBe(860);
  expect(await size('stockRuns')).toBe(0);
  expect(await size('stockReservations')).toBe(0);
  await post('receive', receipt(1, 0, 'Excedente'), 2).expect(422);
});
it(
  'concorrência e repetição com mesma chave não recebem duas vezes',
  async () => {
    const payload = receipt(4000, 0),
      responses = await Promise.all([
        post('receive', payload, 0, 'same'),
        post('receive', payload, 0, 'same'),
      ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await size('financeEvents')).toBe(1);
    await post('receive', { ...payload, source: '  pix PARCELA   1  ' }, 1).expect(409);
    await post('receive', { ...payload, amountCents: 3000 }, 0, 'same').expect(409);
    expect((await get('financeAccounts/q')).receivedCents).toBe(4000);
  },
  CONTENTION_TIMEOUT_MS,
);
it(
  'duas parcelas concorrentes não ultrapassam saldo nem atualizam silenciosamente a versão',
  async () => {
    const results = await Promise.all([
      post('receive', receipt(4000, 0, 'A')),
      post('receive', receipt(4000, 0, 'B')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await size('financeEvents')).toBe(1);
  },
  CONTENTION_TIMEOUT_MS,
);
it('reembolso registra fluxo real e permite cancelar pedido sem reserva/consumo, mantendo taxa não devolvida', async () => {
  await post('receive', receipt(1000, 100)).expect(200);
  await quote('cancel-order', { reason: 'Desistência' }, 3).expect(409);
  await post('refund', receipt(1001, 0, 'Devolução'), 1).expect(422);
  await post('refund', receipt(1000, 0, 'Devolução'), 1).expect(200);
  await quote('cancel-order', { reason: 'Cliente reembolsado' }, 3).expect(200);
  const r = (await report().expect(200)).body;
  expect(r.cash.netCents).toBe(-100);
  expect(r.orders[0].paymentStatus).toBe('refunded');
  expect(r.receivableCents).toBe(0);
  expect(r.consistent).toBe(true);
  await post('receive', receipt(1, 0, 'Cancelado'), 2).expect(409);
});
it('estorno é evento compensatório único e respeita dependências de reembolso', async () => {
  await post('receive', receipt(1000, 100), 0, 'receipt').expect(200);
  await post('refund', receipt(500, 50, 'Devolução parcial'), 1, 'refund').expect(200);
  const reverse = (eventId: string, expected: number, key: string) =>
    post(
      'reverse',
      { eventId, effectiveAt: new Date().toISOString(), reason: 'Lançamento corrigido' },
      expected,
      key,
    );
  await reverse('receipt', 2, 'bad').expect(422);
  await reverse('refund', 2, 'undo-refund').expect(200);
  await reverse('receipt', 3, 'undo-receipt').expect(200);
  await reverse('receipt', 4, 'duplicate').expect(409);
  expect((await report().expect(200)).body.cash.netCents).toBe(0);
  expect((await get('salesOrders/q')).paymentStatus).toBe('unrecorded');
  expect(await size('financeEvents')).toBe(4);
});
it('contas têm pagamentos parciais, saldo e cancelamento condicionado a estornos', async () => {
  await post('create-payable', bill(), 0, 'bill').expect(200);
  await post('pay', payment('bill', 400), 1, 'pay').expect(200);
  await post('pay', payment('bill', 601, 'Excedente'), 2).expect(422);
  expect((await report().expect(200)).body.payableCents).toBe(600);
  await post('cancel-payable', { payableId: 'bill', reason: 'Corrigir' }, 2).expect(409);
  await post(
    'reverse',
    { eventId: 'pay', effectiveAt: new Date().toISOString(), reason: 'Estorno confirmado' },
    2,
  ).expect(200);
  await post('cancel-payable', { payableId: 'bill', reason: 'Cancelada' }, 3).expect(200);
  const r = (await report().expect(200)).body;
  expect(r.payableCents).toBe(0);
  expect(r.cash.netCents).toBe(0);
  expect(r.consistent).toBe(true);
});
it('compra de insumo usa evento original, nunca saldo restante, e vincula uma única conta', async () => {
  await stock(
    'purchase',
    { item: s, quantity: '10', value: '20', reason: 'Recebido', source: 'NF insumo 1' },
    1,
    'purchase',
  ).expect(200);
  const purchaseId = (await db.collection('tenants/a/stockPurchases').get()).docs[0].id;
  await post(
    'create-payable',
    bill({ category: 'material', amountCents: 1999, purchaseId }),
  ).expect(422);
  await post(
    'create-payable',
    bill({ category: 'material', amountCents: 2000, purchaseId }),
    0,
    'bill',
  ).expect(200);
  await post(
    'create-payable',
    bill({ category: 'material', amountCents: 2000, purchaseId, source: 'Outra fatura' }),
  ).expect(409);
  await plan().expect(200);
  await stock('complete', completion(), 1).expect(200);
  const r = (await report().expect(200)).body;
  expect(r.purchaseValue).toBe('20');
  expect(r.cash.netCents).toBe(0);
  expect(r.payableCents).toBe(2000);
  expect((await get('stockBalances/supply~supply~')).quantity).toBe('92');
  expect(r.consistent).toBe(true);
});
it('estorno físico da compra exige cancelar a obrigação financeira e seus pagamentos', async () => {
  await stock(
    'purchase',
    { item: s, quantity: '10', value: '20', reason: 'Recebido', source: 'NF1' },
    1,
    'purchase',
  ).expect(200);
  const purchaseId = (await db.collection('tenants/a/stockPurchases').get()).docs[0].id;
  await post(
    'create-payable',
    bill({ category: 'material', amountCents: 2000, purchaseId }),
    0,
    'bill',
  ).expect(200);
  await stock(
    'reverse',
    { eventId: 'purchase', reason: 'Devolução sem consumo', physicalConfirmed: true },
    2,
  ).expect(409);
  await post('cancel-payable', { payableId: 'bill', reason: 'Compra devolvida' }, 1).expect(200);
  await stock(
    'reverse',
    { eventId: 'purchase', reason: 'Devolução sem consumo', physicalConfirmed: true },
    2,
  ).expect(200);
  const r = (await report().expect(200)).body;
  expect(r.purchaseValue).toBe('20');
  expect(r.purchaseReversalValue).toBe('20');
  expect(r.consistent).toBe(true);
});
it('jornada completa fecha quantidade, material, custo, preço, taxas, recebimento e caixa', async () => {
  await deliver();
  await post('close-order', close()).expect(409);
  await post('receive', receipt(), 0, 'receipt').expect(200);
  await post('close-order', { ...close(), confirmed: false }, 1).expect(422);
  await post('close-order', close(), 1, 'close').expect(200);
  await post('create-payable', bill(), 0, 'energy').expect(200);
  await post('pay', payment('energy'), 1).expect(200);
  const r = (await report().expect(200)).body,
    o = r.orders[0];
  expect(r.consistent).toBe(true);
  expect(r.pending).toEqual([]);
  // E3 rounds the whole withdrawal (17.5 * 5 / 9) to 12 decimals, not a rounded unit cost.
  expect((await get('stockBalances/product~p~blue')).value).toBe('7.777777777778');
  expect(o).toMatchObject({
    priceCents: 5100,
    receivedCents: 5100,
    actualFeesCents: 200,
    estimatedFeesCents: 860,
    estimatedCost: '32.2',
    shipmentCost: '9.722222222222',
    actualCost: '11.722222222222',
    actualProfit: '37.277777777778',
    costVariance: '-20.477777777778',
  });
  expect(o.targets[0].fulfillment).toMatchObject({ shipped: '5', reserved: '0' });
  expect((await get('stockBalances/filament~filament~')).quantity).toBe('9550');
  expect((await get('stockBalances/product~p~blue')).quantity).toBe('4');
  expect(r.cash.netCents).toBe(3900);
  expect(r.confirmedOrderProfit).toBe('37.277777777778');
  expect(r.printers[0].secondsAfterCut).toBe(7000);
  await post('refund', receipt(100, 0, 'Após conferência'), 2).expect(409);
  await post('reopen-order', { orderId: 'q', reason: 'Conferir taxa adicional' }, 2).expect(200);
  expect((await report().expect(200)).body.orders[0].actualCost).toBeNull();
  expect(await size('orderClosures')).toBe(1);
});
it('falha total vinculada entra no realizado uma única vez e reimpressão usa nova reserva', async () => {
  await plan('failed-plan').expect(200);
  await stock(
    'complete',
    completion('failed-plan', { goodUnits: 0, rejectedUnits: 10 }),
    1,
    'failed-run',
  ).expect(200);
  await plan('retry-plan', 'failed-run').expect(200);
  await stock('complete', completion('retry-plan'), 1).expect(200);
  await stock(
    'reserve-order',
    { orderId: target, item: p, quantity: '5', reason: 'Separado' },
    0,
    'reserve',
  ).expect(200);
  await stock('ship', { reservationId: 'reserve', quantity: '5', reason: 'Entregue' }, 1).expect(
    200,
  );
  await post('receive', receipt()).expect(200);
  await post('close-order', close(), 1).expect(200);
  const r = (await report().expect(200)).body;
  expect(r.orders[0].lossCost).toBe('17.5');
  expect(r.orders[0].actualCost).toBe('29.222222222222');
  expect(r.consistent).toBe(true);
});
it('falta de material e impressora sem situação não criam fatos financeiros ou reserva fictícia', async () => {
  await db.doc('tenants/a/printers/printer').update({ status: 'desconhecida' });
  await plan().expect(422);
  expect(await size('stockPlans')).toBe(0);
  await db.doc('tenants/a/printers/printer').update({ status: 'operacional' });
  await stock(
    'adjust',
    { item: f, quantity: '0', value: '0', source: 'Contagem', reason: 'Material ausente' },
    1,
  ).expect(200);
  await plan().expect(422);
  const r = (await report().expect(200)).body;
  expect(r.cash.netCents).toBe(0);
  expect(r.consistent).toBe(true);
  expect(r.pending.length).toBeGreaterThan(0);
});
it('divergência é exibida, bloqueia fechamento e não é corrigida pelo relatório', async () => {
  await deliver();
  await post('receive', receipt()).expect(200);
  await db.doc('tenants/a/financeAccounts/q').update({ receivedCents: 5099 });
  const r = (await report().expect(200)).body;
  expect(r.consistent).toBe(false);
  expect(r.discrepancies.some((s: string) => s.includes('projeção'))).toBe(true);
  await post('close-order', close(), 1).expect(409);
  expect((await get('financeAccounts/q')).receivedCents).toBe(5099);
});
it('permissões e schemas impedem escrita por membro, outra empresa e identidade/data forjada', async () => {
  await post('receive', receipt(), 0, 'member', 'member').expect(403);
  await post('receive', receipt(), 0, 'other', 'b').expect(403);
  await post('receive', receipt(), 0, 'invalid', 'invalid').expect(401);
  await post('receive', { ...receipt(), actorUid: 'a' }).expect(422);
  await post('receive', { ...receipt(), effectiveAt: '2099-01-01T00:00:00Z' }).expect(422);
  await post('receive', receipt(), 0, 'admin', 'admin').expect(200);
  expect((await get('financeEvents/admin')).actorUid).toBe('admin');
  await request(app)
    .get(`/api/tenants/a/finance/report?month=2026-10`)
    .set('Authorization', 'Bearer member')
    .expect(200);
});
it('falha de auditoria aborta caixa, projeções, chave de documento e recibo', async () => {
  const original = db.doc.bind(db),
    log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const spy = vi.spyOn(db, 'doc').mockImplementation((path) => {
    if (path.includes('/auditLogs/finance-failure')) throw new Error('Audit failure');
    return original(path);
  });
  try {
    await post('receive', receipt(), 0, 'failure').expect(503);
  } finally {
    spy.mockRestore();
    log.mockRestore();
  }
  for (const c of ['financeEvents', 'financeAccounts', 'financeSources', 'financeCommands'])
    expect(await size(c)).toBe(0);
  expect((await get('salesOrders/q')).paymentStatus).toBe('unrecorded');
});
it('rules permitem leitura empresarial e negam mutação direta ou recibos privados', async () => {
  await post('receive', receipt(), 0, 'event').expect(200);
  await post('create-payable', bill(), 0, 'bill').expect(200);
  const own = rules.authenticatedContext('a').firestore(),
    other = rules.authenticatedContext('b').firestore();
  for (const path of [
    'financeAccounts/q',
    'financeEvents/event',
    'financeActions/event',
    'payables/bill',
  ]) {
    await assertSucceeds(getDoc(doc(own, `tenants/a/${path}`)));
    await assertFails(getDoc(doc(other, `tenants/a/${path}`)));
    await assertFails(updateDoc(doc(own, `tenants/a/${path}`), { paidCents: 1 }));
    await assertFails(deleteDoc(doc(own, `tenants/a/${path}`)));
  }
  await assertFails(getDoc(doc(own, 'tenants/a/financeCommands/event')));
  await assertFails(setDoc(doc(own, 'tenants/a/orderClosures/forged'), { actualCost: '0' }));
});
