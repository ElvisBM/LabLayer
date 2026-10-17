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
import { customQuote, productQuote } from '../fixtures/quotes';
import { CONTENTION_TIMEOUT_MS } from '../contention-timeout';
import { targetId } from '../../server/quotes';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'quotes-test'),
  db = getFirestore(firebase);
let app: Awaited<ReturnType<typeof createApp>>, rules: RulesTestEnvironment;
const get = async (p: string) => (await db.doc(`tenants/a/${p}`).get()).data();
const set = (p: string, d: any) => db.doc(`tenants/a/${p}`).set(d);
const size = async (p: string) => (await db.collection(`tenants/a/${p}`).get()).size;
const post = (
  type: string,
  payload: any,
  expectedRevision = 0,
  requestId: string = crypto.randomUUID(),
  uid = 'a',
  quoteId = 'q',
  tenant = 'a',
) =>
  request(app)
    .post(`/api/tenants/${tenant}/quotes/${quoteId}/commands`)
    .set('Authorization', `Bearer ${uid}`)
    .send({ requestId, type, payload, expectedRevision });
const preview = (revision = 1, q = 'q') =>
  request(app)
    .post(`/api/tenants/a/quotes/${q}/preview`)
    .set('Authorization', 'Bearer a')
    .send({ expectedRevision: revision });
const stock = (
  type: string,
  payload: any,
  expectedVersion = 0,
  requestId: string = crypto.randomUUID(),
) =>
  request(app)
    .post('/api/tenants/a/inventory/commands')
    .set('Authorization', 'Bearer a')
    .send({ requestId, type, payload, expectedVersion });
const approval = (versionId: string) => ({
  versionId,
  reportedBy: 'Cliente por telefone',
  channel: 'Telefone',
  evidence: 'Protocolo 123, confirmado pelo atendente',
});
const p = { kind: 'product', id: 'p', variationId: 'blue' },
  f = { kind: 'filament', id: 'filament', variationId: '' },
  s = { kind: 'supply', id: 'supply', variationId: '' };
const target = targetId('q', 'line');
async function issue(data = customQuote(), q = 'q') {
  await post(
    'save-draft',
    { data, reason: 'Solicitação inicial' },
    0,
    crypto.randomUUID(),
    'a',
    q,
  ).expect(200);
  const c = (await preview(1, q).expect(200)).body;
  const r = await post(
    'issue',
    { expiresAt: new Date(Date.now() + 86400000).toISOString(), previewFingerprint: c.fingerprint },
    1,
    crypto.randomUUID(),
    'a',
    q,
  ).expect(200);
  return { version: r.body.versionId, calculation: c };
}
async function approve(data = productQuote()) {
  const issued = await issue(data);
  await post('approve', approval(issued.version), 2).expect(200);
  return issued;
}
const plan = (requestId: string = crypto.randomUUID()) =>
  stock(
    'plan',
    {
      orderId: target,
      productId: 'p',
      variationId: 'blue',
      recipeVersion: 'v1',
      runs: 1,
      reprintOf: '',
      reason: 'Falta conferida',
    },
    0,
    requestId,
  );
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
  await set('inventoryControl/state', { phase: 'active', version: 2 });
  for (const [item, quantity, value, unit] of [
    [f, '10000', '100', 'mg'],
    [s, '100', '50', 'un'],
    [p, '20', '40', 'un'],
  ] as const)
    await set(`stockBalances/${item.kind}~${item.id}~${item.variationId}`, {
      item,
      quantity,
      reserved: '0',
      value,
      unit,
      label: item.id,
      version: 1,
    });
});
afterAll(async () => {
  await rules.cleanup();
  await db.terminate();
  await deleteApp(firebase);
});

it('solicitação avulsa vira proposta sem criar catálogo, reserva, venda ou recebimento', async () => {
  const { calculation, version } = await issue();
  expect(calculation.cost).toBe('35');
  expect(calculation.price.priceCents).toBe(5358);
  expect(await size('catalogItems')).toBe(1);
  for (const path of [
    'stockEvents',
    'stockReservations',
    'salesOrders',
    'orderTargets',
    'orders',
    'transactions',
  ])
    expect(await size(path)).toBe(0);
  expect((await get(`quotes/q/versions/${version}`))?.actorUid).toBe('a');
  expect(await size('quoteEvents')).toBe(2);
});
it('custo ausente é pendência explícita e não impede salvar o rascunho', async () => {
  const q = customQuote();
  q.lines[0].customUnitCost = '';
  await post('save-draft', { data: q, reason: 'Aguardando medição' }).expect(200);
  expect((await preview().expect(422)).body.error).toContain('Custo unitário');
  expect(await size('quotes/q/versions')).toBe(0);
});
it('prévia desatualizada impede emissão; versão emitida não muda com tarifas ou estoque', async () => {
  await post('save-draft', { data: productQuote(), reason: 'Nova' }).expect(200);
  const old = (await preview().expect(200)).body;
  await db.doc('tenants/a/printers/printer').update({ powerConsumption: 0.2 });
  const payload = {
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    previewFingerprint: old.fingerprint,
  };
  await post('issue', payload, 1).expect(409);
  const current = (await preview().expect(200)).body;
  const r = await post('issue', { ...payload, previewFingerprint: current.fingerprint }, 1).expect(
    200,
  );
  const before = await get(`quotes/q/versions/${r.body.versionId}`);
  await db.doc('tenants/a/stockBalances/filament~filament~').update({ value: '200', version: 2 });
  await db.doc('tenants/a/printers/printer').update({ powerConsumption: 0.9 });
  expect(await get(`quotes/q/versions/${r.body.versionId}`)).toEqual(before);
  await post('approve', approval(r.body.versionId), 2).expect(200);
  expect((await get('salesOrders/q'))?.priceCents).toBe(current.price.priceCents);
});
it('aprovação exige operador autorizado e evidencia externa; pagamento fica separado', async () => {
  const { version } = await issue();
  await post('approve', approval(version), 2, crypto.randomUUID(), 'member').expect(403);
  await post('approve', { ...approval(version), evidence: '' }, 2).expect(422);
  await post('approve', { ...approval(version), recordedAt: '2000-01-01' }, 2).expect(422);
  await post('approve', approval(version), 2, crypto.randomUUID(), 'admin').expect(200);
  const o = await get('salesOrders/q');
  expect(o?.approval).toMatchObject({ kind: 'operator-reported', actorUid: 'admin' });
  expect(o?.paymentStatus).toBe('unrecorded');
  expect(Date.now() - Date.parse(o!.approval.recordedAt)).toBeLessThan(10000);
  expect((await get(`orderTargets/${target}`))?.item).toBeNull();
  for (const path of ['transactions', 'orders', 'stockEvents', 'stockPlans'])
    expect(await size(path)).toBe(0);
});
it(
  'aprovação concorrente e repetição com nova chave criam exatamente um pedido',
  async () => {
    const { version } = await issue(productQuote());
    const responses = await Promise.all([
      post('approve', approval(version), 2),
      post('approve', approval(version), 2),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses.every((r) => r.body.orderId === 'q')).toBe(true);
    await post('approve', approval(version), 2).expect(200);
    expect(await size('salesOrders')).toBe(1);
    expect(await size('orderTargets')).toBe(1);
    expect(
      (await db.collection('tenants/a/quoteEvents').where('type', '==', 'approve').get()).size,
    ).toBe(1);
    expect(await size('stockReservations')).toBe(0);
  },
  CONTENTION_TIMEOUT_MS,
);
it('mesma chave recupera resultado; mudança de conteúdo ou autor não reutiliza recibo', async () => {
  const payload = { data: customQuote(), reason: 'Nova' };
  const first = await post('save-draft', payload, 0, 'retry').expect(200);
  expect((await post('save-draft', payload, 0, 'retry').expect(200)).body).toEqual(first.body);
  await post('save-draft', { ...payload, reason: 'Outro' }, 0, 'retry').expect(409);
  await post('save-draft', payload, 0, 'retry', 'member').expect(409);
});
it('pedido com itens mistos conserva total e separa atendimento sem recadastrar avulso', async () => {
  const data = productQuote();
  data.lines.push({ ...customQuote().lines[0], id: 'custom-line' });
  const issued = await issue(data);
  await post('approve', approval(issued.version), 2).expect(200);
  const order = await get('salesOrders/q');
  expect(order?.targetIds).toHaveLength(2);
  expect(
    issued.calculation.allocations.reduce((sum: number, a: any) => sum + a.totalCents, 0),
  ).toBe(order?.priceCents);
  expect((await get(`orderTargets/${targetId('q', 'custom-line')}`))?.status).toBe('needs-recipe');
  expect((await get(`orderTargets/${target}`))?.item).toEqual(p);
  await post('save-draft', { data, reason: 'Tentativa de alterar aceito' }, 3).expect(409);
  const revised = customQuote();
  revised.replacesOrderId = 'q';
  await post(
    'save-draft',
    { data: revised, reason: 'Revisar ativo' },
    0,
    crypto.randomUUID(),
    'a',
    'revision',
  ).expect(409);
  expect(await size('catalogItems')).toBe(1);
});
it('revisão substitui a versão anterior sem alterá-la nem aceitar aprovação antiga', async () => {
  const { version } = await issue();
  const old = await get(`quotes/q/versions/${version}`);
  const data = customQuote();
  data.lines[0].quantity = 4;
  await post('save-draft', { data, reason: 'Cliente mudou quantidade' }, 2).expect(200);
  await post('approve', approval(version), 3).expect(409);
  const c = (await preview(3).expect(200)).body;
  const next = await post(
    'issue',
    { expiresAt: new Date(Date.now() + 86400000).toISOString(), previewFingerprint: c.fingerprint },
    3,
  ).expect(200);
  await post('approve', approval(version), 4).expect(409);
  await post('approve', approval(next.body.versionId), 4).expect(200);
  expect(await get(`quotes/q/versions/${version}`)).toEqual(old);
  expect(await size('quotes/q/versions')).toBe(2);
  expect((await get(`orderTargets/${target}`))?.quantity).toBe(4);
});
it('validade é decidida no servidor e proposta expirada exige revisão', async () => {
  const { version } = await issue();
  await post('expire', { versionId: version, reason: 'Teste' }, 2).expect(409);
  await db
    .doc(`tenants/a/quotes/q/versions/${version}`)
    .update({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  await post('approve', approval(version), 2).expect(409);
  await post('expire', { versionId: version, reason: 'Prazo encerrado' }, 2).expect(200);
  expect((await get('quotes/q'))?.status).toBe('expired');
});
it('recusa/cancelamento exigem motivo e não criam pedido; aprovado não pode ser editado', async () => {
  const { version } = await issue();
  await post('decline', { versionId: version, reason: '' }, 2).expect(422);
  await post('decline', { versionId: version, reason: 'Cliente desistiu' }, 2).expect(200);
  await post('approve', approval(version), 3).expect(409);
  await post('cancel', { reason: 'Encerrado' }, 3).expect(200);
  await post('save-draft', { data: customQuote(), reason: 'Editar cancelado' }, 4).expect(409);
  expect(await size('salesOrders')).toBe(0);
});
it('aprovação requer E3 ativo, sem criar reservas quando faltam materiais', async () => {
  const { version } = await issue(productQuote());
  await set('inventoryControl/state', { phase: 'frozen', version: 1 });
  await post('approve', approval(version), 2).expect(409);
  await set('inventoryControl/state', { phase: 'active', version: 2 });
  await db.doc('tenants/a/stockBalances/filament~filament~').update({ quantity: '0', value: '0' });
  await post('approve', approval(version), 2).expect(200);
  await plan().expect(422);
  expect(await size('stockPlans')).toBe(0);
  expect(await size('stockReservations')).toBe(0);
});
it('peça avulsa exige vínculo explícito antes da reserva, preservando preço aceito', async () => {
  const issued = await approve(customQuote());
  await stock('reserve-order', {
    orderId: target,
    item: p,
    quantity: '1',
    reason: 'Conferido',
  }).expect(409);
  const payload = {
    targetId: target,
    productId: 'p',
    variationId: 'blue',
    recipeVersion: 'v1',
    reason: 'Ficha medida para a peça',
  };
  await post('bind-custom', payload, 3, crypto.randomUUID(), 'member').expect(403);
  await post('bind-custom', payload, 3).expect(200);
  await post('bind-custom', payload, 4).expect(409);
  expect((await get('salesOrders/q'))?.priceCents).toBe(issued.calculation.price.priceCents);
  await stock('reserve-order', {
    orderId: target,
    item: p,
    quantity: '3',
    reason: 'Conferido',
  }).expect(200);
});
it('reserva/expedição usam produto e quantidade do pedido canônico e não duplicam baixa', async () => {
  await approve();
  await set('catalogItems/other', { ...catalogData(), recipeHeads: { blue: 'v1' } });
  await stock('reserve-order', {
    orderId: target,
    item: { ...p, id: 'other' },
    quantity: '1',
    reason: 'Erro',
  }).expect(422);
  await stock('reserve-order', {
    orderId: target,
    item: p,
    quantity: '6',
    reason: 'Excesso',
  }).expect(422);
  await stock(
    'reserve-order',
    { orderId: target, item: p, quantity: '5', reason: 'Conferido' },
    0,
    'reserve',
  ).expect(200);
  const ship = { reservationId: 'reserve', quantity: '2', reason: 'Entrega parcial' };
  await stock('ship', ship, 1, 'shipment').expect(200);
  await stock('ship', ship, 1, 'shipment').expect(200);
  expect((await get(`stockFulfillments/${target}`))?.shipped).toBe('2');
  expect((await get('stockBalances/product~p~blue'))?.quantity).toBe('18');
  expect(await size('stockShipments')).toBe(1);
  expect(await size('transactions')).toBe(0);
  await post('cancel-order', { reason: 'Cancelar' }, 3).expect(409);
});
it(
  'plano vinculado fixa a ficha aceita e bloqueia fabricação duplicada ou já coberta',
  async () => {
    await approve();
    await stock('plan', {
      orderId: target,
      productId: 'p',
      variationId: 'blue',
      recipeVersion: 'wrong',
      runs: 1,
      reprintOf: '',
      reason: 'Erro',
    }).expect(422);
    const responses = await Promise.all([plan('first'), plan('second')]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await size('stockPlans')).toBe(1);
    const good = responses.find((r) => r.status === 200)!;
    expect((await get(`stockPlans/${good.body.planId}`))?.orderId).toBe(target);
    await post('cancel-order', { reason: 'Cancelar' }, 3).expect(409);
  },
  CONTENTION_TIMEOUT_MS,
);
it('cancelamento libera somente planos/reservas sem consumo antes de permitir revisão comercial', async () => {
  await approve();
  await plan('plan').expect(200);
  await stock('cancel', { reservationId: 'plan', reason: 'Revisão comercial' }, 1).expect(200);
  await stock(
    'reserve-order',
    { orderId: target, item: p, quantity: '2', reason: 'Separado' },
    0,
    'reserve',
  ).expect(200);
  await post('cancel-order', { reason: 'Revisão' }, 3).expect(409);
  await stock('cancel', { reservationId: 'reserve', reason: 'Revisão comercial' }, 1).expect(200);
  await post('cancel-order', { reason: 'Mudança solicitada pelo cliente' }, 3).expect(200);
  await plan().expect(409);
  await stock(
    'reserve-order',
    { orderId: target, item: p, quantity: '1', reason: 'Cancelado' },
    2,
  ).expect(409);
  const q = customQuote();
  q.replacesOrderId = 'q';
  await post(
    'save-draft',
    { data: q, reason: 'Novo escopo' },
    0,
    crypto.randomUUID(),
    'a',
    'revision',
  ).expect(200);
  expect((await get('quotes/q'))?.status).toBe('approved');
  expect((await get('salesOrders/q'))?.status).toBe('cancelled');
});
it('jornada fabrica falta, reserva, expede e reconcilia sem gerar recebimento', async () => {
  // Rebuild fixture balances through the actual E3 opening commands so ledger reconciliation is meaningful.
  await db.doc('tenants/a/inventoryControl/state').delete();
  for (const item of [p, f, s])
    await db.doc(`tenants/a/stockBalances/${item.kind}~${item.id}~${item.variationId}`).delete();
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
  await approve();
  await plan('plan').expect(200);
  await stock(
    'complete',
    {
      planId: 'plan',
      runs: 1,
      goodUnits: 9,
      rejectedUnits: 1,
      durationSeconds: 7000,
      actual: [
        { item: f, quantity: '450' },
        { item: s, quantity: '18' },
      ],
      conversion: { energy: '1', labor: '2', machine: '1', other: '0', source: 'Medido' },
      reason: 'Executado',
    },
    1,
    'run',
  ).expect(200);
  expect((await get('stockRuns/run'))?.orderId).toBe(target);
  await post('cancel-order', { reason: 'Cancelar consumo' }, 3).expect(409);
  await stock(
    'reserve-order',
    { orderId: target, item: p, quantity: '5', reason: 'Separado' },
    0,
    'reserve',
  ).expect(200);
  await stock('ship', { reservationId: 'reserve', quantity: '5', reason: 'Entregue' }, 1).expect(
    200,
  );
  expect((await get('stockBalances/product~p~blue'))?.quantity).toBe('4');
  const r = await request(app)
    .get('/api/tenants/a/inventory/reconcile')
    .set('Authorization', 'Bearer a')
    .expect(200);
  expect(r.body.discrepancies).toEqual([]);
  expect(r.body.consistent).toBe(true);
  expect((await get('salesOrders/q'))?.paymentStatus).toBe('unrecorded');
  expect(await size('transactions')).toBe(0);
});
it('isolamento entre empresas, sessão inválida e campos forjados são recusados', async () => {
  const payload = { data: customQuote(), reason: 'Nova' };
  await post('save-draft', payload, 0, crypto.randomUUID(), 'b').expect(403);
  await post('save-draft', payload, 0, crypto.randomUUID(), 'invalid').expect(401);
  await post('save-draft', { ...payload, actorUid: 'a' }).expect(422);
  await post('save-draft', { ...payload, data: { ...customQuote(), priceCents: 1 } }).expect(422);
  expect(await size('quotes')).toBe(0);
});
it('rules permitem leitura da empresa e bloqueiam toda escrita direta comercial', async () => {
  const { version } = await approve();
  const own = rules.authenticatedContext('a').firestore(),
    other = rules.authenticatedContext('b').firestore();
  for (const path of [
    'quotes/q',
    `quotes/q/versions/${version}`,
    'salesOrders/q',
    `orderTargets/${target}`,
  ]) {
    await assertSucceeds(getDoc(doc(own, `tenants/a/${path}`)));
    await assertFails(getDoc(doc(other, `tenants/a/${path}`)));
    await assertFails(updateDoc(doc(own, `tenants/a/${path}`), { priceCents: 1 }));
    await assertFails(deleteDoc(doc(own, `tenants/a/${path}`)));
  }
  await assertFails(setDoc(doc(own, 'tenants/a/quoteEvents/forged'), { actorUid: 'a' }));
  await assertFails(getDoc(doc(own, 'tenants/a/quoteCommands/secret')));
  await assertFails(setDoc(doc(own, 'tenants/a/salesOrders/forged'), { status: 'active' }));
});
it('falha na auditoria aborta proposta, evento e recibo na mesma transação', async () => {
  const original = db.runTransaction.bind(db);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const spy = vi.spyOn(db, 'runTransaction').mockImplementation(((run: any) =>
    original(async (tx) => {
      const create = tx.create.bind(tx);
      tx.create = ((ref: any, value: any) => {
        if (ref.path.includes('/auditLogs/')) throw new Error('Audit unavailable');
        return create(ref, value);
      }) as any;
      return run(tx);
    })) as any);
  try {
    await post('save-draft', { data: customQuote(), reason: 'Nova' }, 0, 'failed').expect(503);
  } finally {
    spy.mockRestore();
    log.mockRestore();
  }
  expect(await get('quotes/q')).toBeUndefined();
  expect(await size('quoteEvents')).toBe(0);
  expect(await size('quoteCommands')).toBe(0);
});
