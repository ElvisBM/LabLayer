import { CONTENTION_TIMEOUT_MS } from '../contention-timeout';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../../server';
import { catalogData, printRecipe, assemblyRecipe } from '../fixtures/catalog';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'catalog-test');
const db = getFirestore(firebase);
let app: Awaited<ReturnType<typeof createApp>>, rules: RulesTestEnvironment;
const url = (item = 'p') => `/api/tenants/a/catalog/${item}`;
const send = (path: string, body: any, uid = 'a') =>
  request(app).post(path).set('Authorization', `Bearer ${uid}`).send(body);
const metadata = (requestId = 'meta1', expectedRevision = 0, data = catalogData()) => ({
  requestId,
  expectedRevision,
  data,
  legacySource: null,
});
const recipe = (requestId = 'recipe1', expectedRecipeVersion: string | null = null) => ({
  requestId,
  expectedRevision: 1,
  variationId: 'blue',
  expectedRecipeVersion,
  recipe: printRecipe(),
});
const prepare = (item = 'p', requestId = `meta-${item}`) =>
  send(url(item), metadata(requestId)).expect(200);
const saveRecipe = (item = 'p', requestId = 'recipe1') =>
  send(`${url(item)}/recipes`, recipe(requestId)).expect(200);
const operationalCollections = [
  'products',
  'filaments',
  'supplies',
  'printers',
  'losses',
  'productionOrders',
  'orders',
  'customRequests',
  'inventoryMovements',
  'transactions',
];
const operationalState = async () =>
  Object.fromEntries(
    await Promise.all(
      operationalCollections.map(async (name) => [
        name,
        (await db.collection(`tenants/a/${name}`).get()).docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })),
      ]),
    ),
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
      if (token === 'invalid') throw new Error('invalid');
      return { uid: token } as any;
    },
  });
});
beforeEach(async () => {
  await rules.clearFirestore();
  await db.doc('tenants/a').set({ ownerUid: 'a', status: 'active' });
  await db.doc('tenants/b').set({ ownerUid: 'b', status: 'active' });
  await db.doc('tenants/a/filaments/filament').set({ stockKg: 2, pricePerKg: 100 });
  await db.doc('tenants/a/supplies/supply').set({ quantity: 30, unit: 'un', costPerUnit: 1 });
  await db
    .doc('tenants/a/printers/printer')
    .set({ name: 'Impressora', status: 'operacional', usedHours: 40 });
  await db
    .doc('tenants/a/products/legacy')
    .set({
      name: 'Peça antiga',
      productType: 'produto',
      status: 'ativo',
      stock: 16,
      variations: [
        {
          id: 'blue',
          quantityPerPrint: 10,
          printTimeHours: 2,
          materials: [{ filamentId: 'filament', weightGrams: 0.4, purgeGrams: 0.1 }],
        },
      ],
    });
  for (const name of ['losses', 'productionOrders', 'orders', 'inventoryMovements', 'transactions'])
    await db.doc(`tenants/a/${name}/existing`).set({ historical: true, cost: 123 });
  await db
    .doc('tenants/a/customRequests/request')
    .set({ title: 'Solicitação existente', quotedPrice: 100 });
});
afterAll(async () => {
  await rules.cleanup();
  await db.terminate();
  await deleteApp(firebase);
});
it('cadastro, receita, revisão, renomeação e arquivamento não alteram qualquer dado operacional', async () => {
  const before = await operationalState();
  await prepare();
  await saveRecipe();
  const newer = recipe('recipe2', 'recipe1');
  newer.recipe.materials[0].totalMg = 500;
  newer.recipe.materials[0].parts!.pieceMg = 350;
  await send(`${url()}/recipes`, newer).expect(200);
  await send(
    url(),
    metadata('meta2', 1, { ...catalogData(), name: 'Renomeado', status: 'archived' }),
  ).expect(200);
  expect(await operationalState()).toEqual(before);
  expect(
    (await db.doc('tenants/a/catalogItems/p/recipes/recipe1').get()).data()?.recipe.materials[0],
  ).toMatchObject({ totalMg: 400, parts: { pieceMg: 250, supportMg: 50, purgeMg: 100 } });
  expect((await db.doc('tenants/a/catalogItems/p/recipes/recipe2').get()).data()).toMatchObject({
    previousVersion: 'recipe1',
    version: 2,
    catalogRevision: 1,
  });
  expect((await db.doc('tenants/a/catalogItems/p/versions/1').get()).data()?.name).toBe('Peça');
  expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(4);
});
it(
  'comando repetido concorrente é atômico e retorna mesma revisão',
  { timeout: CONTENTION_TIMEOUT_MS },
  async () => {
    const results = await Promise.all([send(url(), metadata()), send(url(), metadata())]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.repeated).sort()).toEqual([false, true]);
    expect((await db.collection('tenants/a/catalogItems/p/versions').get()).size).toBe(1);
    expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(1);
    await send(url(), metadata('meta1', 0, { ...catalogData(), name: 'Outro' })).expect(409);
  },
);
it(
  'edição concorrente de cadastro não perde alteração do outro operador',
  { timeout: CONTENTION_TIMEOUT_MS },
  async () => {
    await prepare();
    const results = await Promise.all(
      ['A', 'B'].map((name) =>
        send(url(), metadata(`meta-${name}`, 1, { ...catalogData(), name })),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await db.collection('tenants/a/catalogItems/p/versions').get()).size).toBe(2);
    expect((await db.doc('tenants/a/catalogItems/p').get()).data()?.revision).toBe(2);
  },
);
it(
  'duas receitas concorrentes na mesma saída não sobrescrevem versão',
  { timeout: CONTENTION_TIMEOUT_MS },
  async () => {
    await prepare();
    const results = await Promise.all(
      ['a', 'b'].map((k) => send(`${url()}/recipes`, recipe(`recipe-${k}`))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!;
    await send(`${url()}/recipes`, recipe(winner.body.recipeVersion)).expect(200);
    expect((await db.collection('tenants/a/catalogItems/p/recipes').get()).size).toBe(1);
    expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(2);
  },
);
it('mudar cadastro durante edição da receita exige recarregar, sem gravação parcial', async () => {
  await prepare();
  await send(url(), metadata('meta2', 1, { ...catalogData(), name: 'Novo nome' })).expect(200);
  await send(`${url()}/recipes`, recipe()).expect(409);
});
it('ausência de referência, outra empresa, máquina indisponível e unidade divergente abortam sem efeitos', async () => {
  await prepare();
  const before = await operationalState();
  const input = recipe();
  input.recipe.supplies[0].unit = 'kg';
  await send(`${url()}/recipes`, input).expect(422);
  input.recipe = printRecipe();
  input.recipe.materials[0].filamentId = 'foreign';
  await db.doc('tenants/b/filaments/foreign').set({ stockKg: 999 });
  await send(`${url()}/recipes`, input).expect(422);
  expect(await operationalState()).toEqual(before);
  await db.doc('tenants/a/printers/printer').update({ status: 'manutenção' });
  await send(`${url()}/recipes`, recipe()).expect(422);
  expect((await db.collection('tenants/a/catalogItems/p/recipes').get()).empty).toBe(true);
  expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(1);
});
it('origem legada exige revisão atual e preservação de IDs, sem conversão automática', async () => {
  await send(url('legacy'), metadata()).expect(422);
  const report = await request(app)
    .get(`${url('legacy')}/legacy-review`)
    .set('Authorization', 'Bearer a')
    .expect(200);
  expect(report.body.review.candidates[0].materials[0]).toMatchObject({
    weightMg: 400,
    purgeMg: 100,
    supportMg: null,
  });
  const command = {
    ...metadata(),
    legacySource: {
      productId: 'legacy',
      updateTime: report.body.updateTime,
      reason: 'Produto de catálogo confirmado; receita será revisada.',
    },
  };
  const changedIds = {
    ...command,
    data: {
      ...catalogData(),
      variants: [{ id: 'different', name: 'Azul', sku: '', status: 'active' }],
    },
  };
  await send(url('legacy'), changedIds).expect(422);
  await send(url('legacy'), command).expect(200);
  expect(
    (await db.doc('tenants/a/catalogItems/legacy').get()).data()?.legacySource.review
      .requiresReview,
  ).toBe(true);
  expect((await db.collection('tenants/a/catalogItems/legacy/recipes').get()).empty).toBe(true);
  expect((await db.doc('tenants/a/products/legacy').get()).data()?.stock).toBe(16);
});
it('alteração da origem invalida revisão anterior com precisão de timestamp', async () => {
  const report = await request(app)
    .get(`${url('legacy')}/legacy-review`)
    .set('Authorization', 'Bearer a')
    .expect(200);
  await db.doc('tenants/a/products/legacy').update({ name: 'Outro' });
  await send(url('legacy'), {
    ...metadata(),
    legacySource: { productId: 'legacy', updateTime: report.body.updateTime, reason: 'Conferido' },
  }).expect(409);
  expect((await db.doc('tenants/a/catalogItems/legacy').get()).exists).toBe(false);
});
it('classificação de orçamento vincula solicitação existente, sem duplicar pedido nem saldo', async () => {
  const before = await operationalState();
  const data = {
    ...catalogData(),
    kind: 'request-reference' as const,
    requestId: 'request',
    variants: [],
  };
  await send(url(), metadata('meta1', 0, { ...data, requestId: 'missing' })).expect(422);
  await send(url(), metadata('meta1', 0, data)).expect(200);
  await send(`${url()}/recipes`, recipe()).expect(422);
  expect(await operationalState()).toEqual(before);
});
it('IDs não podem ser apagados/trocados e arquivamento bloqueia novas receitas', async () => {
  await prepare();
  await send(
    url(),
    metadata('meta2', 1, {
      ...catalogData(),
      variants: [{ id: 'new', name: 'Nova', sku: '', status: 'active' }],
    }),
  ).expect(422);
  await send(url(), metadata('meta2', 1, { ...catalogData(), status: 'archived' })).expect(200);
  await send(`${url()}/recipes`, { ...recipe(), expectedRevision: 2 }).expect(422);
});
it('BOM fixa IDs e versão do componente e não vira entrada de produto acabado', async () => {
  const before = await operationalState();
  for (const name of ['base', 'top', 'p']) await prepare(name);
  await saveRecipe('base', 'base-v1');
  await saveRecipe('top', 'top-v1');
  await send(`${url()}/recipes`, { ...recipe('assembly'), recipe: assemblyRecipe() }).expect(200);
  await send(
    url('base'),
    metadata('base-meta2', 1, { ...catalogData(), name: 'Base renomeada' }),
  ).expect(200);
  await send(`${url('base')}/recipes`, {
    ...recipe('base-v2', 'base-v1'),
    expectedRevision: 2,
  }).expect(200);
  const saved = (await db.doc('tenants/a/catalogItems/p/recipes/assembly').get()).data();
  expect(saved?.recipe.components[0]).toMatchObject({
    productId: 'base',
    variationId: 'blue',
    recipeVersion: 'base-v1',
    quantity: 1,
  });
  expect(await operationalState()).toEqual(before);
});
it('BOM recusa autorreferência, versão inexistente e montagem aninhada', async () => {
  for (const name of ['base', 'top', 'p', 'nested']) await prepare(name);
  await saveRecipe('base', 'base-v1');
  await saveRecipe('top', 'top-v1');
  const self = assemblyRecipe();
  self.components[0].productId = 'p';
  await send(`${url()}/recipes`, { ...recipe('self'), recipe: self }).expect(422);
  const missing = assemblyRecipe();
  missing.components[0].recipeVersion = 'nonexistent';
  await send(`${url()}/recipes`, { ...recipe('missing'), recipe: missing }).expect(422);
  await send(`${url()}/recipes`, { ...recipe('assembly'), recipe: assemblyRecipe() }).expect(200);
  const nested = assemblyRecipe();
  nested.components = [
    { productId: 'p', variationId: 'blue', recipeVersion: 'assembly', quantity: 1 },
  ];
  await send(`${url('nested')}/recipes`, { ...recipe('nested'), recipe: nested }).expect(422);
});
it('autorização e rules impedem tenant estrangeiro e falsificação de receita/histórico', async () => {
  await request(app).post(url()).send(metadata()).expect(401);
  await send(url(), metadata(), 'invalid').expect(401);
  await send(url(), metadata(), 'b').expect(403);
  await send(url(), { ...metadata(), actorUid: 'forged' }).expect(422);
  await prepare();
  await saveRecipe();
  const client = rules.authenticatedContext('a').firestore(),
    other = rules.authenticatedContext('b').firestore();
  await assertSucceeds(getDoc(doc(client, 'tenants/a/catalogItems/p/recipes/recipe1')));
  await assertFails(getDoc(doc(other, 'tenants/a/catalogItems/p')));
  await assertFails(updateDoc(doc(client, 'tenants/a/catalogItems/p'), { name: 'Forged' }));
  await assertFails(
    setDoc(doc(client, 'tenants/a/catalogItems/p/recipes/forged'), { recipe: printRecipe() }),
  );
  await assertFails(
    updateDoc(doc(client, 'tenants/a/catalogItems/p/recipes/recipe1'), { version: 99 }),
  );
  await assertFails(deleteDoc(doc(client, 'tenants/a/catalogItems/p')));
  await assertFails(deleteDoc(doc(client, 'tenants/a/catalogItems/p/versions/1')));
  await db.doc('tenants/a').update({ status: 'inactive' });
  await send(url(), metadata('new', 1)).expect(403);
  await assertFails(getDoc(doc(client, 'tenants/a/catalogItems/p')));
});

it('falha ao preparar auditoria aborta cadastro, versão e recibo juntos', async () => {
  const original = db.collection.bind(db);
  const spy = vi.spyOn(db, 'collection').mockImplementation((path) => {
    if (path.endsWith('/auditLogs')) throw new Error('Falha injetada na auditoria');
    return original(path);
  });
  try {
    await send(url(), metadata()).expect(503);
  } finally {
    spy.mockRestore();
  }
  expect((await db.doc('tenants/a/catalogItems/p').get()).exists).toBe(false);
  expect((await db.collection('tenants/a/catalogItems/p/versions').get()).empty).toBe(true);
  expect((await db.collection('tenants/a/catalogCommands').get()).empty).toBe(true);
});
it('ID de variação que coincide com propriedade JS não vira referência herdada', async () => {
  const data = catalogData();
  data.variants[0].id = 'constructor';
  await send(url(), metadata('meta', 0, data)).expect(200);
  await send(`${url()}/recipes`, { ...recipe(), variationId: 'constructor' }).expect(200);
  expect((await db.doc('tenants/a/catalogItems/p').get()).data()?.recipeHeads.constructor).toBe(
    'recipe1',
  );
});
