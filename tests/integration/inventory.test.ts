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
import { writeAdminDocument } from '../../server/admin-writes';
import { catalogData, printRecipe } from '../fixtures/catalog';
import { CONTENTION_TIMEOUT_MS } from '../contention-timeout';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'inventory-test'),
  db = getFirestore(firebase);
let app: Awaited<ReturnType<typeof createApp>>, rules: RulesTestEnvironment;
const f = { kind: 'filament', id: 'filament', variationId: '' };
const s = { kind: 'supply', id: 'supply', variationId: '' };
const p = { kind: 'product', id: 'p', variationId: 'blue' };
const key = (i: any) => `${i.kind}~${i.id}~${i.variationId}`;
const post = (
  type: string,
  payload: any,
  expectedVersion = 0,
  requestId: string = crypto.randomUUID(),
  uid = 'a',
  tenant = 'a',
) =>
  request(app)
    .post(`/api/tenants/${tenant}/inventory/commands`)
    .set('Authorization', `Bearer ${uid}`)
    .send({ requestId, type, expectedVersion, payload });
const get = async (path: string) => (await db.doc(`tenants/a/${path}`).get()).data()!;
const balance = (i = f) => get(`stockBalances/${key(i)}`);
const report = () =>
  request(app).get('/api/tenants/a/inventory/reconcile').set('Authorization', 'Bearer a');
const movement = (i: any, quantity: string, value: string, source = 'Documento') => ({
  item: i,
  quantity,
  value,
  reason: 'Conferência física',
  source,
});
const freeze = () =>
  post('freeze', { reason: 'Corte conferido', backupReference: 'backup-validado-01' });
async function activate(productQty = '0') {
  await freeze().expect(200);
  await post('open', movement(f, '10000', '100')).expect(200);
  await post('open', movement(s, '100', '50')).expect(200);
  await post('open', movement(p, productQty, productQty === '0' ? '0' : '20')).expect(200);
  await post('activate', { reason: 'Abertura conferida', confirmed: true }, 1).expect(200);
}
const plan = (runs = 1, requestId: string = crypto.randomUUID()) =>
  post(
    'plan',
    {
      productId: 'p',
      variationId: 'blue',
      recipeVersion: 'v1',
      runs,
      reason: 'Produção',
      reprintOf: '',
    },
    0,
    requestId,
  );
const extra = { energy: '1', labor: '2', machine: '1', other: '0', source: 'Custos conferidos' };
const completion = (planId: string, overrides = {}) => ({
  planId,
  runs: 1,
  goodUnits: 9,
  rejectedUnits: 1,
  durationSeconds: 7000,
  actual: [
    { item: f, quantity: '450' },
    { item: s, quantity: '18' },
  ],
  conversion: extra,
  reason: 'Execução medida',
  ...overrides,
});
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
  await db
    .doc('tenants/a/filaments/filament')
    .set({ material: 'PLA', color: 'Azul', stockKg: 2, pricePerKg: 100 });
  await db
    .doc('tenants/a/supplies/supply')
    .set({ name: 'Caixa', quantity: 100, unit: 'un', costPerUnit: 1 });
  await db
    .doc('tenants/a/printers/printer')
    .set({ name: 'Máquina', status: 'operacional', usedHours: 40 });
  await db
    .doc('tenants/a/catalogItems/p')
    .set({ ...catalogData(), revision: 1, recipeHeads: { blue: 'v1' } });
  await db
    .doc('tenants/a/catalogItems/p/recipes/v1')
    .set({ recipe: printRecipe(), variationId: 'blue', productId: 'p', version: 1 });
  await db.doc('tenants/a/orders/order').set({
    quantity: 5,
    productName: 'Peça antiga',
    status: 'pendente',
    soldPrice: 100,
    realCost: 20,
  });
});
afterAll(async () => {
  await rules.cleanup();
  await db.terminate();
  await deleteApp(firebase);
});
it('abertura exige congelamento, todos os itens e conferência explícita; não infere saldo legado', async () => {
  await post('open', movement(f, '10000', '100')).expect(422);
  await freeze().expect(200);
  await post('open', movement(f, '10000', '100')).expect(200);
  await post('activate', { reason: 'X', confirmed: true }, 1).expect(422);
  expect((await report()).body.issues).toHaveLength(2);
  expect((await get('filaments/filament')).stockKg).toBe(2);
  await post('open', movement(f, '9000', '90'), 1).expect(409);
  await post('adjust', movement(f, '9000', '90'), 1).expect(200);
  expect((await balance()).quantity).toBe('9000');
});
it('classificação legada pendente impede ativação mesmo com abertura', async () => {
  await db.doc('tenants/a/products/legacy').set({ name: 'Sem revisão', variations: [] });
  await freeze();
  await post('open', movement(f, '0', '0'));
  await post('open', movement(s, '0', '0'));
  await post('open', movement(p, '0', '0'));
  const response = await post('activate', { confirmed: true, reason: 'Conferência' }, 1).expect(
    422,
  );
  expect(response.body.error).toContain('Classificação');
  expect((await get('inventoryControl/state')).phase).toBe('frozen');
});
it('compra atualiza média móvel e documento não pode entrar duas vezes mesmo com outra chave', async () => {
  await activate();
  const payload = movement(f, '10000', '300', 'NF123-linha1');
  await post('purchase', payload, 1, 'purchase').expect(200);
  expect(await balance()).toMatchObject({
    quantity: '20000',
    value: '400',
    reserved: '0',
    version: 2,
  });
  expect((await post('purchase', payload, 1, 'purchase')).body.repeated).toBe(true);
  await post('purchase', payload, 2, 'purchase-2').expect(409);
  await post('purchase', { ...payload, value: '301' }, 1, 'purchase').expect(409);
  expect((await report()).body.consistent).toBe(true);
});
it(
  'duas reservas concorrentes do último saldo não excedem disponível',
  { timeout: CONTENTION_TIMEOUT_MS },
  async () => {
    await activate();
    await post('adjust', movement(f, '400', '4'), 1).expect(200);
    const responses = await Promise.all([plan(1, 'plan-a'), plan(1, 'plan-b')]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 422]);
    expect((await balance()).reserved).toBe('400');
    expect((await db.collection('tenants/a/stockPlans').get()).size).toBe(1);
  },
);
it(
  'conclusão concorrente repetida grava consumo, saída, horas e auditoria uma única vez',
  { timeout: CONTENTION_TIMEOUT_MS },
  async () => {
    await activate();
    await plan(1, 'plan');
    const responses = await Promise.all([
      post('complete', completion('plan'), 1, 'run'),
      post('complete', completion('plan'), 1, 'run'),
    ]);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(responses.filter((r) => r.body.repeated)).toHaveLength(1);
    expect(await balance()).toMatchObject({ quantity: '9550', reserved: '0', value: '95.5' });
    expect(await balance(p)).toMatchObject({ quantity: '9', value: '17.5' });
    expect(await get('stockPrinterUsage/printer')).toMatchObject({ seconds: 7000 });
    expect(await get('stockRuns/run')).toMatchObject({
      goodUnits: 9,
      rejectedUnits: 1,
      totalCost: '17.5',
      lossCost: '0',
    });
    expect((await db.collection('tenants/a/stockRuns').get()).size).toBe(1);
    expect((await report()).body.consistent).toBe(true);
  },
);
it('execução parcial libera apenas a parcela correspondente; cancelar restante não devolve consumo', async () => {
  await activate();
  await plan(2, 'plan');
  expect((await balance()).reserved).toBe('800');
  await post('complete', completion('plan'), 1, 'run').expect(200);
  expect(await balance()).toMatchObject({ quantity: '9550', reserved: '400' });
  await post('cancel', { reservationId: 'plan', reason: 'Parar restante' }, 2).expect(200);
  expect(await balance()).toMatchObject({ quantity: '9550', reserved: '0' });
  expect((await balance(p)).quantity).toBe('9');
});
it('consumo real adicional exige disponibilidade sem tomar a reserva de outro plano', async () => {
  await activate();
  await post('adjust', movement(f, '800', '8'), 1);
  await plan(1, 'one');
  await plan(1, 'two');
  await post('complete', completion('one'), 1, 'run').expect(422);
  expect(await balance()).toMatchObject({ quantity: '800', reserved: '800' });
  expect((await get('stockPlans/one')).status).toBe('active');
  expect((await db.doc('tenants/a/stockRuns/run').get()).exists).toBe(false);
});
it('falha total registra perda e nenhuma saída; reimpressão é um plano explícito', async () => {
  await activate();
  await plan(1, 'plan');
  await post(
    'complete',
    completion('plan', { goodUnits: 0, rejectedUnits: 10 }),
    1,
    'failed',
  ).expect(200);
  expect((await balance(p)).quantity).toBe('0');
  expect(await get('stockRuns/failed')).toMatchObject({ lossCost: '17.5', unitCost: null });
  await post(
    'plan',
    {
      productId: 'p',
      variationId: 'blue',
      recipeVersion: 'v1',
      runs: 1,
      reprintOf: 'failed',
      reason: 'Reimpressão da falha',
    },
    0,
    'reprint',
  ).expect(200);
  expect((await balance()).reserved).toBe('400');
});
it('montagem consome componentes inteiros pela ficha e não soma componentes como acabados', async () => {
  await activate();
  for (const [name, q] of [
    ['base', '10'],
    ['top', '6'],
  ]) {
    await db.doc(`tenants/a/catalogItems/${name}`).set({ ...catalogData(), revision: 1 });
    await db
      .doc(`tenants/a/catalogItems/${name}/recipes/v1`)
      .set({ recipe: printRecipe(), variationId: 'blue' });
    await post('open', movement({ ...p, id: name }, q, q), 0).expect(200);
  }
  const recipe = {
    ...printRecipe(),
    kind: 'assembly',
    goodUnits: 1,
    durationSeconds: 0,
    printerId: '',
    materials: [],
    supplies: [],
    components: ['base', 'top'].map((id) => ({
      productId: id,
      variationId: 'blue',
      recipeVersion: 'v1',
      quantity: 1,
    })),
  };
  await db.doc('tenants/a/catalogItems/p/recipes/v1').set({ recipe, variationId: 'blue' });
  await plan(7, 'excess').expect(422);
  await plan(6, 'assembly').expect(200);
  await post(
    'complete',
    completion('assembly', {
      runs: 6,
      goodUnits: 6,
      rejectedUnits: 0,
      durationSeconds: 60,
      actual: ['base', 'top'].map((id) => ({ item: { ...p, id }, quantity: '6' })),
      conversion: { ...extra, energy: '0', labor: '0', machine: '0' },
    }),
    1,
  ).expect(200);
  expect((await balance(p)).quantity).toBe('6');
  expect((await balance({ ...p, id: 'base' })).quantity).toBe('4');
  expect((await balance({ ...p, id: 'top' })).quantity).toBe('0');
});
it('reserva de pedido e expedição parcial independem de pagamento e preservam histórico comercial', async () => {
  await activate('10');
  const original = await get('orders/order');
  await post(
    'reserve-order',
    { orderId: 'order', item: p, quantity: '5', reason: 'Vínculo conferido' },
    0,
    'reserve',
  ).expect(200);
  await post(
    'ship',
    { reservationId: 'reserve', quantity: '2', reason: 'Entrega parcial' },
    1,
    'ship',
  ).expect(200);
  expect(await balance(p)).toMatchObject({ quantity: '8', reserved: '3', value: '16' });
  expect((await get('stockShipments/ship')).cost).toBe('4');
  expect(await get('orders/order')).toEqual(original);
  await post('cancel', { reservationId: 'reserve', reason: 'Cancelar restante' }, 2).expect(200);
  expect(await balance(p)).toMatchObject({ quantity: '8', reserved: '0' });
  await post(
    'reserve-order',
    { orderId: 'order', item: p, quantity: '4', reason: 'Excedente' },
    3,
  ).expect(422);
  expect((await report()).body.consistent).toBe(true);
});
it(
  'dois pedidos concorrentes não reservam as mesmas unidades',
  { timeout: CONTENTION_TIMEOUT_MS },
  async () => {
    await activate('5');
    await db.doc('tenants/a/orders/order2').set({ quantity: 5 });
    const responses = await Promise.all(
      ['order', 'order2'].map((orderId, i) =>
        post(
          'reserve-order',
          { orderId, item: p, quantity: '5', reason: 'Conferido' },
          0,
          `reserve${i}`,
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 422]);
    expect((await balance(p)).reserved).toBe('5');
  },
);
it('ajuste não invade reservas e estorno é compensatório, sem apagar o movimento', async () => {
  await activate();
  await post('purchase', movement(f, '1000', '10', 'NF'), 1, 'buy').expect(200);
  await post(
    'reverse',
    { eventId: 'buy', reason: 'Recebimento indevido conferido', physicalConfirmed: true },
    2,
    'undo',
  ).expect(200);
  expect(await balance()).toMatchObject({ quantity: '10000', value: '100' });
  expect((await get('stockEvents/buy')).type).toBe('purchase');
  await post('reverse', { eventId: 'buy', reason: 'Duplicado', physicalConfirmed: true }, 3).expect(
    409,
  );
  await plan(1, 'plan');
  await post('adjust', movement(f, '399', '3.99'), 4).expect(422);
  expect((await report()).body.consistent).toBe(true);
});
it('conciliação detecta projeção adulterada e reserva órfã de saldo sem tentar corrigir', async () => {
  await activate();
  await plan(1, 'plan');
  await db.doc(`tenants/a/stockBalances/${key(f)}`).update({ quantity: '9999' });
  const first = await report();
  expect(first.body.consistent).toBe(false);
  expect(first.body.discrepancies.join()).toContain('projeção');
  await db.doc('tenants/a/stockReservations/plan').delete();
  expect((await report()).body.discrepancies.join()).toContain('reserva');
  expect((await balance()).quantity).toBe('9999');
});
it('falha na auditoria aborta saldo, recibo e evento na mesma transação', async () => {
  await activate();
  const original = db.doc.bind(db);
  const spy = vi.spyOn(db, 'doc').mockImplementation((path: string) => {
    if (path.includes('/auditLogs/stock-failure')) throw new Error('audit failure');
    return original(path);
  });
  try {
    await post('purchase', movement(f, '1', '1', 'NF'), 1, 'failure').expect(503);
  } finally {
    spy.mockRestore();
  }
  expect((await balance()).quantity).toBe('10000');
  for (const c of ['stockEvents', 'inventoryCommands'])
    expect((await db.doc(`tenants/a/${c}/failure`).get()).exists).toBe(false);
});
it('autorização impede empresa estrangeira, ator forjado e abertura por membro', async () => {
  await post('freeze', { reason: 'X', backupReference: 'X' }, 0, 'x', 'invalid').expect(401);
  await post('freeze', { reason: 'X', backupReference: 'X' }, 0, 'x', 'b').expect(403);
  await post('freeze', { reason: 'X', backupReference: 'X' }, 0, 'x', 'member').expect(403);
  await post('freeze', { reason: 'X', backupReference: 'X', actorUid: 'a' }).expect(422);
  await db.doc('tenants/a').update({ status: 'inactive' });
  await freeze().expect(403);
});
it('rules bloqueiam escritores antigos e coleções novas após congelamento, incluindo navegador antigo', async () => {
  const client = rules.authenticatedContext('a').firestore();
  await db.doc('tenants/a/supplies/supply').update({ createdAt: '2026-01-01' });
  await db.doc('tenants/a/products/old').set({ name: 'Peça', status: 'ativo', stock: 1 });
  await db
    .doc('tenants/a/productionOrders/old')
    .set({ productName: 'Peça', status: 'fila', createdAt: '2026-01-01' });
  await assertSucceeds(updateDoc(doc(client, 'tenants/a/filaments/filament'), { stockKg: 1 }));
  await assertSucceeds(updateDoc(doc(client, 'tenants/a/supplies/supply'), { quantity: 99 }));
  await assertSucceeds(updateDoc(doc(client, 'tenants/a/products/old'), { stock: 2 }));
  await assertSucceeds(
    updateDoc(doc(client, 'tenants/a/productionOrders/old'), { status: 'produzindo' }),
  );
  await freeze().expect(409);
  await assertSucceeds(
    updateDoc(doc(client, 'tenants/a/productionOrders/old'), { status: 'fila' }),
  );
  await freeze().expect(200);
  await assertFails(updateDoc(doc(client, 'tenants/a/filaments/filament'), { stockKg: 1 }));
  await assertFails(updateDoc(doc(client, 'tenants/a/supplies/supply'), { quantity: 99 }));
  await assertFails(updateDoc(doc(client, 'tenants/a/products/old'), { stock: 2 }));
  await assertFails(
    updateDoc(doc(client, 'tenants/a/productionOrders/old'), { status: 'produzindo' }),
  );
  for (const path of ['filaments/filament', 'supplies/supply', 'orders/order']) {
    await assertFails(updateDoc(doc(client, `tenants/a/${path}`), { stockKg: 99 }));
    await assertFails(deleteDoc(doc(client, `tenants/a/${path}`)));
  }
  for (const c of [
    'stockBalances',
    'stockEvents',
    'stockReservations',
    'stockPlans',
    'stockRuns',
    'stockShipments',
    'inventoryControl',
    'inventoryCommands',
  ])
    await assertFails(setDoc(doc(client, `tenants/a/${c}/fake`), { quantity: '1000' }));
  await assertSucceeds(getDoc(doc(client, 'tenants/a/inventoryControl/state')));
  await assertFails(
    getDoc(doc(rules.authenticatedContext('b').firestore(), 'tenants/a/inventoryControl/state')),
  );
  await expect(
    writeAdminDocument(db, {
      tenantId: 'a',
      collection: 'customRequests',
      id: 'x',
      mode: 'create',
      actor: 'external',
      keyId: 'key',
      payload: { title: 'X' },
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it('conciliação detecta reserva sem plano e horas divergentes das execuções', async () => {
  await activate();
  await plan(2, 'plan');
  await post('complete', completion('plan'), 1, 'run').expect(200);
  await db.doc('tenants/a/stockPlans/plan').delete();
  await db.doc('tenants/a/stockPrinterUsage/printer').update({ seconds: 7001 });
  const r = await report();
  expect(r.body.consistent).toBe(false);
  expect(r.body.discrepancies.join()).toContain('reserva sem plano');
  expect(r.body.discrepancies.join()).toContain('horas');
});
it('versão obsoleta não sobrescreve contagem e outra chave não conclui duas vezes', async () => {
  await activate();
  await post('adjust', movement(f, '9999', '100'), 1, 'adjust').expect(200);
  await post('adjust', movement(f, '8888', '100'), 1).expect(409);
  await plan(1, 'plan');
  await post('complete', completion('plan'), 1, 'run').expect(200);
  await post('complete', completion('plan'), 1, 'other').expect(409);
  expect((await balance(p)).quantity).toBe('9');
});
it('membro pode operar estoque ativo, mas não ajustar saldo nem estornar compra', async () => {
  await activate();
  await post('purchase', movement(f, '1000', '10', 'NF'), 1, 'buy', 'member').expect(200);
  await post('adjust', movement(f, '1', '1'), 2, 'adjust', 'member').expect(403);
  await post(
    'reverse',
    { eventId: 'buy', reason: 'X', physicalConfirmed: true },
    2,
    'reverse',
    'member',
  ).expect(403);
  expect((await get('stockEvents/buy')).actorUid).toBe('member');
});
it('motor antigo não salva novas sugestões após o corte de estoque', async () => {
  await freeze();
  await request(app)
    .post('/api/tenants/a/products/legacy/pricing-snapshots')
    .set('Authorization', 'Bearer a')
    .send({
      requestId: 'new-price',
      variationId: 'blue',
      channelId: 'channel',
      targetType: 'margin',
      targetValue: 20,
    })
    .expect(409);
});
it('revisão de ficha não altera plano fixado; arquivar não devolve material', async () => {
  await activate();
  await plan(1, 'plan');
  await db
    .doc('tenants/a/catalogItems/p')
    .update({ name: 'Renomeado', status: 'archived', recipeHeads: { blue: 'v2' } });
  await db
    .doc('tenants/a/catalogItems/p/recipes/v2')
    .set({ recipe: { ...printRecipe(), goodUnits: 100 }, variationId: 'blue' });
  await plan(1).expect(422);
  expect((await balance()).quantity).toBe('10000');
  await post('complete', completion('plan'), 1).expect(200);
  expect((await balance(p)).quantity).toBe('9');
});
it('cadastro novo de material começa com abertura zero auditada e não aceita estoque no corpo', async () => {
  await activate();
  await post('create-material', { kind: 'supply', id: 'new', name: 'Cola', unit: 'ml' }).expect(
    200,
  );
  expect(await balance({ kind: 'supply', id: 'new', variationId: '' })).toMatchObject({
    quantity: '0',
    value: '0',
  });
  await post('create-material', {
    kind: 'supply',
    id: 'bad',
    name: 'Cola',
    unit: 'ml',
    quantity: 100,
  }).expect(422);
});
it('campos e unidades inválidos não deixam saldo parcial', async () => {
  await activate();
  await post('purchase', movement(f, '0.5', '1'), 1).expect(422);
  await plan(1, 'plan');
  await post('complete', completion('plan', { goodUnits: 11, rejectedUnits: 0 }), 1).expect(422);
  await post('complete', completion('plan', { actual: [{ item: f, quantity: '400' }] }), 1).expect(
    422,
  );
  await post('complete', completion('plan', { conversion: { energy: '1' } }), 1).expect(422);
  expect((await balance()).quantity).toBe('10000');
  expect((await balance()).reserved).toBe('400');
});
