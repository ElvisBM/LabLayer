import { FieldPath, Timestamp, GeoPoint, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { BusinessError, validId } from './session';

type Value = { type: string; value?: any };
export type TenantBackup = {
  version: 1; tenantId: string; projectId: string; exportedAt: string;
  consistency: 'requires-paused-writes'; documents: Array<{ path: string; data: Value }>;
};

function encode(value: any): Value {
  if (value instanceof Timestamp) return { type: 'timestamp', value: [value.seconds, value.nanoseconds] };
  if (value instanceof GeoPoint) return { type: 'geopoint', value: [value.latitude, value.longitude] };
  if (value instanceof DocumentReference) return { type: 'reference', value: value.path };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { type: 'bytes', value: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return { type: 'array', value: value.map(encode) };
  if (value && typeof value === 'object') return { type: 'map', value: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { type: 'special-number', value: String(value) };
  return { type: 'scalar', value };
}
function decode(db: Firestore, item: Value): any {
  switch (item.type) {
    case 'timestamp': return new Timestamp(item.value[0], item.value[1]);
    case 'geopoint': return new GeoPoint(item.value[0], item.value[1]);
    case 'reference': return db.doc(item.value);
    case 'bytes': return Buffer.from(item.value, 'base64');
    case 'array': return item.value.map((v: Value) => decode(db, v));
    case 'map': return Object.fromEntries(Object.entries(item.value).map(([k, v]) => [k, decode(db, v as Value)]));
    case 'special-number': return Number(item.value);
    case 'scalar': return item.value;
    default: throw new BusinessError(400, 'Tipo de backup desconhecido.');
  }
}

// A consistent backup requires pausing every writer during this read.
export async function exportTenant(db: Firestore, tenantId: string, projectId: string, pageSize = 200): Promise<TenantBackup> {
  if (!validId(tenantId) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new BusinessError(400, 'Parâmetros de exportação inválidos.');
  const documents: TenantBackup['documents'] = [];
  const visited = new Set<string>();
  async function visit(ref: DocumentReference) {
    if (visited.has(ref.path)) return;
    visited.add(ref.path);
    const snap = await ref.get();
    if (snap.exists) documents.push({ path: ref.path, data: encode(snap.data()) });
    for (const collection of await ref.listCollections()) {
      let cursor: string | undefined;
      do {
        let query = collection.orderBy(FieldPath.documentId()).limit(pageSize);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        for (const child of page.docs) await visit(child.ref);
        cursor = page.size === pageSize ? page.docs.at(-1)!.id : undefined;
      } while (cursor);
      // listDocuments also finds missing parent documents with live subcollections.
      for (const child of await collection.listDocuments()) if (!visited.has(child.path)) await visit(child);
    }
  }
  const root = db.doc(`tenants/${tenantId}`);
  if (!(await root.get()).exists) throw new BusinessError(404, 'Empresa não encontrada.');
  await visit(root);
  await visit(db.doc(`users/${tenantId}`));
  let cursor: string | undefined;
  do {
    let query = db.collection('users').where('tenantId', '==', tenantId).orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const user of page.docs) await visit(user.ref);
    cursor = page.size === pageSize ? page.docs.at(-1)!.id : undefined;
  } while (cursor);
  return { version: 1, tenantId, projectId, exportedAt: new Date().toISOString(),
    consistency: 'requires-paused-writes', documents: documents.sort((a, b) => a.path.localeCompare(b.path)) };
}

// Restoration is deliberately restricted to a local demo project and empty destination.
export async function restoreTenantToEmulator(backup: TenantBackup, projectId = 'demo-lablayer-test') {
  if (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
    throw new BusinessError(403, 'Restauração permitida somente em emulador local demo.');
  }
  const db = new Firestore({ projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
  try {
  if (backup.version !== 1 || !validId(backup.tenantId)) throw new BusinessError(400, 'Backup inválido.');
  const unique = new Set<string>();
  const decoded = backup.documents.map(item => {
    const data = decode(db, item.data);
    const ownTenant = item.path === `tenants/${backup.tenantId}` || item.path.startsWith(`tenants/${backup.tenantId}/`);
    const ownProfile = /^users\/[^/]+$/.test(item.path) && (data.tenantId === backup.tenantId || item.path === `users/${backup.tenantId}`);
    if ((!ownTenant && !ownProfile) || unique.has(item.path)) throw new BusinessError(400, 'Escopo ou duplicação inválida no backup.');
    unique.add(item.path);
    return { ref: db.doc(item.path), data };
  });
  // Preflight prevents partially overwriting an existing operation.
  for (const item of decoded) if ((await item.ref.get()).exists) throw new BusinessError(409, 'Destino deve estar vazio.');
  for (let i = 0; i < decoded.length; i += 200) {
    const batch = db.batch();
    for (const item of decoded.slice(i, i + 200)) batch.create(item.ref, item.data);
    await batch.commit();
  }
  return { restoredDocuments: decoded.length };
  } finally { await db.terminate(); }
}
