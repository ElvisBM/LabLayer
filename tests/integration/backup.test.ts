import { afterAll, beforeAll, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { exportTenant, restoreTenantToEmulator } from '../../server/tenant-backup';

const app = initializeApp({ projectId: 'demo-lablayer-test' }, 'backup-test');
const db = getFirestore(app);
beforeAll(async () => {
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents', { method: 'DELETE' });
});
afterAll(async () => { await db.terminate(); await deleteApp(app); });

it('E0.1 exporta mais de 500 documentos e restaura cópia com tipos, membros e subcoleções', async () => {
  await db.doc('tenants/backup').set({ ownerUid: 'backup', companyName: 'Teste', createdAt: new Timestamp(100, 123) });
  await db.doc('users/backup').set({ tenantId: 'backup', role: 'admin' });
  await db.doc('users/member').set({ tenantId: 'backup', tenantRole: 'member' });
  await db.doc('users/member/preferences/ui').set({ theme: 'dark' });
  await db.doc('tenants/other').set({ ownerUid: 'other' });
  for (let offset = 0; offset < 510; offset += 100) {
    const batch = db.batch();
    for (let n = offset; n < Math.min(offset + 100, 510); n++) batch.set(db.doc(`tenants/backup/products/p${n}`), { name: `Peça ${n}`, value: n / 100 });
    await batch.commit();
  }
  await db.doc('tenants/backup/products/p0/versions/v1').set({
    at: new Timestamp(100, 987654321), location: new GeoPoint(-23, -46), binary: Buffer.from('abc'),
    reference: db.doc('tenants/backup/products/p1'), nested: [{ type: 'timestamp', value: null }],
  });
  await db.doc('tenants/backup/unknown/missing/children/exists').set({ preserved: true });
  const backup = JSON.parse(JSON.stringify(await exportTenant(db, 'backup', 'demo-lablayer-test', 100)));
  expect(backup.documents).toHaveLength(516);
  expect(backup.documents.some((x: any) => x.path.startsWith('tenants/other'))).toBe(false);
  await expect(restoreTenantToEmulator(backup)).rejects.toMatchObject({ status: 409 });
  await db.recursiveDelete(db.doc('tenants/backup'));
  await db.doc('users/backup').delete(); await db.recursiveDelete(db.doc('users/member'));
  expect(await restoreTenantToEmulator(backup)).toEqual({ restoredDocuments: 516 });
  const restored = await exportTenant(db, 'backup', 'demo-lablayer-test', 73);
  expect(restored.documents).toEqual(backup.documents);
  expect((await db.doc('tenants/other').get()).exists).toBe(true);
});

it('restauração recusa destino com subcoleção órfã e projeto não demo', async () => {
  await db.doc('tenants/isolated').set({ ownerUid: 'isolated' });
  const backup = await exportTenant(db, 'isolated', 'demo-lablayer-test');
  await db.doc('tenants/isolated').delete();
  await db.doc('tenants/isolated/unknown/record').set({ preserved: true });
  await expect(restoreTenantToEmulator(backup)).rejects.toMatchObject({ status: 409 });
  await expect(restoreTenantToEmulator(backup, 'production-project')).rejects.toMatchObject({ status: 403 });
  expect((await db.doc('tenants/isolated/unknown/record').get()).exists).toBe(true);
});
