import express, { type Express } from 'express';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { createHash } from 'node:crypto';
import { BusinessError, validId } from './session';
import { CatalogError, id, record, textValue } from '../shared/catalog/model';
import { assetId, MAX_ASSET_BYTES } from '../shared/assets/model';

export type AssetStore = {
  put(path: string, bytes: Buffer, mime: string): Promise<void>;
  get(path: string): Promise<Buffer>;
};
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const mimeExtensions: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'model/stl': ['stl'],
  'model/3mf': ['3mf'],
};
export function inspectAsset(bytes: Buffer, name: string, mime: string) {
  const ext = name.split('.').at(-1)?.toLowerCase();
  if (
    !bytes.length ||
    bytes.length > MAX_ASSET_BYTES ||
    !mimeExtensions[mime]?.includes(ext ?? '') ||
    /[\x00-\x1f\x7f/\\]/.test(name)
  )
    throw new CatalogError('Arquivo inválido. Use PNG, JPEG, WebP, PDF, STL ou 3MF, até 10 MiB.');
  const head = bytes.subarray(0, 16),
    text = bytes.subarray(0, 128).toString('utf8');
  const valid =
    mime === 'image/png'
      ? head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : mime === 'image/jpeg'
        ? head.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        : mime === 'image/webp'
          ? text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP'
          : mime === 'application/pdf'
            ? text.startsWith('%PDF-')
            : mime === 'model/3mf'
              ? head.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))
              : (bytes.length >= 84 && 84 + bytes.readUInt32LE(80) * 50 === bytes.length) ||
                /^\s*solid\s/.test(text);
  if (!valid) throw new CatalogError('Conteúdo não corresponde ao formato informado.');
  // Signature validation is not antivirus or a model parser. Files are attachment-only, never executed.
  return { name, mime, size: bytes.length, sha256: digest(bytes) };
}
export async function requireAssets(get: (path: string) => Promise<any>, references: string[]) {
  for (const reference of references) {
    const key = assetId(reference);
    if (key && !(await get(`assets/${key}`)))
      throw new CatalogError('Arquivo privado não encontrado nesta empresa.');
  }
}
export function registerAssetRoutes(
  app: Express,
  db: Firestore | null,
  verify: (t: string) => Promise<DecodedIdToken>,
  store: AssetStore | null,
) {
  async function access(tx: Transaction, tenantId: string, uid: string, ownerOnly = false) {
    if (!validId(tenantId) || !validId(uid)) throw new BusinessError(400, 'Identidade inválida.');
    const tenant = (await tx.get(db!.doc(`tenants/${tenantId}`))).data();
    const profile = (await tx.get(db!.doc(`users/${uid}`))).data();
    const member = (await tx.get(db!.doc(`tenants/${tenantId}/members/${uid}`))).data();
    const owner = tenant?.ownerUid === uid;
    if (
      !tenant ||
      tenant.status === 'inactive' ||
      !(owner || (profile?.tenantId === tenantId && member?.active !== false)) ||
      (ownerOnly && !owner)
    )
      throw new BusinessError(403, 'Sem acesso aos arquivos desta empresa.');
  }
  const handler =
    (action: (req: any, res: any, uid: string) => Promise<any>) => async (req: any, res: any) => {
      if (!db) return res.status(503).json({ error: 'Banco indisponível.' });
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      let uid: string;
      try {
        if (!token) throw new Error();
        uid = (await verify(token)).uid;
      } catch {
        return res.status(401).json({ error: 'Autenticação necessária.' });
      }
      try {
        await action(req, res, uid);
      } catch (e) {
        if (e instanceof BusinessError) return res.status(e.status).json({ error: e.message });
        if (e instanceof CatalogError || e instanceof URIError)
          return res.status(422).json({ error: e.message });
        console.error('Falha em arquivo:', e);
        return res
          .status(503)
          .json({
            error: 'Arquivo não confirmado. Tente novamente; o mesmo conteúdo não será duplicado.',
          });
      }
    };
  async function persist(
    tenantId: string,
    uid: string,
    bytes: Buffer,
    name: string,
    mime: string,
    migration?: any,
  ) {
    if (!store) throw new BusinessError(503, 'Armazenamento privado não configurado.');
    const meta = inspectAsset(bytes, textValue(name, 'Nome do arquivo', 180), mime);
    const key = digest(JSON.stringify(meta)),
      path = `tenants/${tenantId}/managed-assets/${key}`;
    await db!.runTransaction((tx) => access(tx, tenantId, uid, !!migration));
    // Object is immutable and deterministic. A failed metadata transaction leaves a reusable
    // orphan, never a published reference. Retrying recovers it without a second object.
    await store.put(path, bytes, mime);
    await db!.runTransaction(async (tx) => {
      await access(tx, tenantId, uid, !!migration);
      const ref = db!.doc(`tenants/${tenantId}/assets/${key}`),
        prior = await tx.get(ref);
      let migrationRef: any, alreadyMigrated: any;
      if (migration) {
        const original = (
          await tx.get(
            db!.doc(`tenants/${tenantId}/${migration.collection}/${migration.documentId}`),
          )
        ).data();
        const file = legacyFiles(migration.collection, original).find(
          (f) => f.field === migration.field,
        );
        if (!file || digest(file.value) !== migration.sourceHash)
          throw new BusinessError(409, 'Mídia de origem mudou. Confira novamente.');
        migrationRef = db!.doc(
          `tenants/${tenantId}/assetMigrations/${digest(JSON.stringify(migration))}`,
        );
        alreadyMigrated = await tx.get(migrationRef);
      }
      const createdAt = new Date().toISOString();
      if (!prior.exists) {
        tx.create(ref, { ...meta, path, createdAt, actorUid: uid });
        tx.create(db!.doc(`tenants/${tenantId}/auditLogs/asset-${key}`), {
          action: 'asset.upload',
          assetId: key,
          actorUid: uid,
          createdAt,
        });
      }
      if (migration && !alreadyMigrated.exists) {
        tx.create(migrationRef, { ...migration, assetId: key, createdAt, actorUid: uid });
        tx.create(db!.doc(`tenants/${tenantId}/auditLogs/asset-migration-${migrationRef.id}`), {
          action: 'asset.migrate',
          assetId: key,
          source: migration,
          actorUid: uid,
          createdAt,
        });
      }
    });
    return { ...meta, id: key, reference: `asset:${key}` };
  }
  app.post(
    '/api/tenants/:tenantId/assets/upload',
    express.raw({ type: 'application/octet-stream', limit: MAX_ASSET_BYTES }),
    handler(async (req, res, uid) => {
      if (!Buffer.isBuffer(req.body))
        throw new CatalogError('Envie o arquivo como application/octet-stream.');
      res.json(
        await persist(
          req.params.tenantId,
          uid,
          req.body,
          decodeURIComponent(req.get('X-File-Name') ?? ''),
          req.get('X-File-Type') ?? '',
        ),
      );
    }),
  );
  app.get(
    '/api/tenants/:tenantId/assets/:assetId/download',
    handler(async (req, res, uid) => {
      const key = assetId(`asset:${req.params.assetId}`);
      if (!key) throw new CatalogError('Identificador de arquivo inválido.');
      const tenantId = req.params.tenantId;
      const meta = await db!.runTransaction(async (tx) => {
        await access(tx, tenantId, uid);
        return (await tx.get(db!.doc(`tenants/${tenantId}/assets/${key}`))).data();
      });
      if (!meta) throw new BusinessError(404, 'Arquivo não encontrado.');
      if (!store) throw new BusinessError(503, 'Armazenamento privado não configurado.');
      const bytes = await store.get(`tenants/${tenantId}/managed-assets/${key}`);
      if (bytes.length !== meta.size || digest(bytes) !== meta.sha256)
        throw new BusinessError(409, 'Integridade do arquivo divergente.');
      res
        .set({
          'Content-Type': meta.mime,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        })
        .send(bytes);
    }),
  );
  const legacy = handler(async (req, res, uid) => {
    const tenantId = req.params.tenantId,
      collection = req.params.collection,
      documentId = id(req.params.documentId);
    if (!['products', 'customRequests'].includes(collection))
      throw new CatalogError('Origem não suportada.');
    const doc = await db!.runTransaction(async (tx) => {
      await access(tx, tenantId, uid, true);
      return (await tx.get(db!.doc(`tenants/${tenantId}/${collection}/${documentId}`))).data();
    });
    const files = legacyFiles(collection, doc);
    if (req.method === 'GET')
      return res.json({
        files: files.map((f) => ({ field: f.field, name: f.name, sourceHash: digest(f.value) })),
      });
    const p = record(req.body, ['field', 'sourceHash'], 'Migração'),
      file = files.find((f) => f.field === p.field);
    if (!file || digest(file.value) !== p.sourceHash)
      throw new BusinessError(409, 'Mídia mudou ou não está incorporada. Atualize a prévia.');
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(file.value);
    if (!match) throw new CatalogError('Mídia incorporada inválida.');
    const mime = match[1],
      bytes = Buffer.from(match[2], 'base64');
    const ext = mimeExtensions[mime]?.[0];
    const name = file.name.includes('.') ? file.name : `${file.name}.${ext ?? 'bin'}`;
    res.json(
      await persist(tenantId, uid, bytes, name, mime, {
        collection,
        documentId,
        field: p.field,
        sourceHash: p.sourceHash,
      }),
    );
  });
  app.get('/api/tenants/:tenantId/assets/legacy/:collection/:documentId', legacy);
  app.post('/api/tenants/:tenantId/assets/legacy/:collection/:documentId', legacy);
}
function legacyFiles(
  collection: string,
  doc: any,
): { field: string; name: string; value: string }[] {
  if (!doc) return [];
  const fields =
    collection === 'products' ? ['imageUrl'] : ['referenceImageUrl', 'quoteMediaImageUrl'];
  const files = fields.map((field) => ({ field, name: field, value: doc[field] }));
  if (collection === 'products' && Array.isArray(doc.files))
    doc.files.forEach((f: any, i: number) =>
      files.push({ field: `files.${i}`, name: f.name || `arquivo-${i}`, value: f.url }),
    );
  return files.filter((f) => typeof f.value === 'string' && f.value.startsWith('data:'));
}
