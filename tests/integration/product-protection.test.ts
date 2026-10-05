import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { archiveProduct } from '../../src/services/product-protection';

let rules: RulesTestEnvironment;
const app = initializeApp({ projectId: 'demo-lablayer-test' }, 'protection-test');
const db = getFirestore(app);
// doc() unwraps the emulator's compat client to the modular SDK used by the UI.
const clientFor = (uid: string) => doc(rules.authenticatedContext(uid).firestore(), 'tenants/a').firestore;
const oldHistory = Array.from({ length: 50 }, (_, id) => ({ id: `old-${id}`, suggestedPrice: 10 + id }));
const entry = { id: 'new-price', savedAt: '2026-10-05', variationId: 'v', variationLabel: 'Azul', channelId: 'c', channelName: 'Direto',
  targetType: 'margin', targetValue: 20, suggestedPrice: 20, cost: 10, profit: 10, margin: 50 };
beforeAll(async () => {
  rules = await initializeTestEnvironment({ projectId: 'demo-lablayer-test', firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await rules.clearFirestore();
  await db.doc('tenants/a').set({ ownerUid: 'a', companyName: 'A', status: 'active' });
  await db.doc('tenants/a/products/p').set({ name: 'Peça', status: 'ativo', pricingHistory: oldHistory,
    variations: [{ id: 'v', materials: [{ filamentId: 'f', weightGrams: 100 }] }] });
  await db.doc('tenants/a/filaments/f').set({ material: 'PLA', color: 'Azul', pricePerKg: 100, stockKg: 1 });
  await db.doc('tenants/a/printers/m').set({ name: 'Máquina', model: 'M', acquisitionCost: 2000, lifespanHours: 10000, maintenanceBudget: 0, powerConsumption: .1, usedHours: 10, createdAt: '2026-01-01' });
  await db.doc('tenants/a/losses/l').set({ cost: 2, productId: 'p' });
});
afterAll(async () => { await rules.cleanup(); await db.terminate(); await deleteApp(app); });

it('E0.5 arquivar repetidamente mantém ficha, estoque, horas, perdas e histórico', async () => {
  const client = clientFor('a');
  const original = (await db.doc('tenants/a/products/p').get()).data();
  await archiveProduct(client, 'a', 'p');
  await archiveProduct(client, 'a', 'p');
  expect((await db.doc('tenants/a/products/p').get()).data()).toEqual({ ...original, status: 'inativo' });
  expect((await db.doc('tenants/a/filaments/f').get()).data()?.stockKg).toBe(1);
  expect((await db.doc('tenants/a/printers/m').get()).data()?.usedHours).toBe(10);
  expect((await db.doc('tenants/a/losses/l').get()).exists).toBe(true);
});
it('E0.5 bloqueia exclusão e devolução pelo batch legado, incluindo redução separada de horas', async () => {
  const client = clientFor('a');
  const batch = writeBatch(client);
  batch.update(doc(client, 'tenants/a/filaments/f'), { stockKg: 2 });
  batch.delete(doc(client, 'tenants/a/products/p'));
  await assertFails(batch.commit());
  await assertFails(updateDoc(doc(client, 'tenants/a/printers/m'), { usedHours: 0 }));
  expect((await db.doc('tenants/a/filaments/f').get()).data()?.stockKg).toBe(1);
});
it('E1 histórico anterior permanece imutável e cliente não grava cálculo forjado', async () => {
  const client = clientFor('a');
  await db.doc('tenants/a/products/p/pricingSnapshots/old-price').set({ ...entry, calculationVersion: 'legacy-ui', actorUid: 'a' });
  await assertFails(setDoc(doc(client, 'tenants/a/products/p/pricingSnapshots/new-price'), { ...entry, calculationVersion: 'legacy-ui', actorUid: 'a' }));
  await assertFails(updateDoc(doc(client, 'tenants/a/products/p/pricingSnapshots/old-price'), { suggestedPrice: 99 }));
  await assertFails(deleteDoc(doc(client, 'tenants/a/products/p/pricingSnapshots/old-price')));
  await assertFails(updateDoc(doc(client, 'tenants/a/products/p'), { pricingHistory: [] }));
  expect((await db.doc('tenants/a/products/p').get()).data()?.pricingHistory).toEqual(oldHistory);
});
it('E1 outro tenant não consegue forjar snapshot', async () => {
  await assertFails(setDoc(doc(clientFor('b'), 'tenants/a/products/p/pricingSnapshots/new-price'), entry));
});
it('E0.5 execução concluída não é apagada por troca de tela', async () => {
  await db.doc('tenants/a/productionOrders/run').set({ productName: 'Peça', status: 'concluida', createdAt: '2026-01-01' });
  await assertFails(deleteDoc(doc(rules.authenticatedContext('a').firestore(), 'tenants/a/productionOrders/run')));
  await assertFails(updateDoc(doc(rules.authenticatedContext('a').firestore(), 'tenants/a/productionOrders/run'), { status: 'fila' }));
});
it('E0.5 repetição do batch de conclusão é recusada sem segunda entrada de produto', async () => {
  await db.doc('tenants/a/productionOrders/run').set({ productName: 'Peça', status: 'fila', createdAt: '2026-01-01' });
  const client = clientFor('a');
  const complete = (stock: number) => {
    const batch = writeBatch(client);
    batch.update(doc(client, 'tenants/a/productionOrders/run'), { status: 'concluida' });
    batch.update(doc(client, 'tenants/a/products/p'), { stock });
    return batch.commit();
  };
  await complete(10);
  await assertFails(complete(20));
  expect((await db.doc('tenants/a/products/p').get()).data()?.stock).toBe(10);
});
