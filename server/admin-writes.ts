import type { Express, RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { BusinessError, validId } from './session';
import { isRecord, normalizeCustomRequest, validateDocument, WRITABLE_COLLECTIONS } from './admin-contract';

export type WriteMode = 'create' | 'patch' | 'replace';
export async function writeAdminDocument(db: Firestore, input: {
  tenantId: string; collection: string; id: string; payload: Record<string, any>;
  mode: WriteMode; actor: string; keyId: string;
  receipt?: { id: string; fingerprint: string };
}) {
  const { tenantId, collection, id, mode, actor, keyId } = input;
  if (!validId(tenantId) || !validId(id)) throw new BusinessError(400, 'Identificador inválido.');
  if (!WRITABLE_COLLECTIONS.has(collection)) throw new BusinessError(403, 'Escrita genérica suspensa; este domínio requer comando de negócio.');
  const payload = collection === 'customRequests' ? normalizeCustomRequest(input.payload, mode === 'patch' ? 'patch' : 'create') : { ...input.payload };
  const now = new Date().toISOString();
  const ref = db.doc(`tenants/${tenantId}/${collection}/${id}`);
  const auditRef = db.collection(`tenants/${tenantId}/auditLogs`).doc();
  return db.runTransaction(async tx => {
    const tenant = await tx.get(db.doc(`tenants/${tenantId}`));
    if (!tenant.exists) throw new BusinessError(404, 'Empresa não encontrada.');
    if (tenant.data()?.status === 'inactive') throw new BusinessError(403, 'Empresa inativa.');
    const current = await tx.get(ref);
    const receiptRef = input.receipt ? db.doc(`tenants/${tenantId}/webhookReceipts/${input.receipt.id}`) : null;
    if (receiptRef) {
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data()?.fingerprint !== input.receipt!.fingerprint) throw new BusinessError(409, 'Evento já recebido com conteúdo diferente.');
        if (!current.exists) throw new BusinessError(409, 'Solicitação original não está mais disponível.');
        return current.data()!;
      }
    }
    if (mode === 'create' && current.exists) throw new BusinessError(409, 'Documento já existe. Criação não sobrescreve dados.');
    if (mode !== 'create' && !current.exists) throw new BusinessError(404, 'Documento não encontrado.');
    const before = current.data() ?? {};
    if (current.exists && Object.hasOwn(payload, 'createdAt') && payload.createdAt !== before.createdAt) throw new BusinessError(400, 'createdAt é imutável.');
    const next: Record<string, any> = { ...(mode === 'patch' ? before : {}), ...payload,
      createdAt: before.createdAt ?? payload.createdAt ?? now, updatedAt: now };
    validateDocument(collection, id, next);
    if (collection === 'customRequests') {
      const references = new Set<string>();
      if (next.printerId) references.add(`printers/${next.printerId}`);
      for (const material of next.filaments) references.add(`filaments/${material.filamentId}`);
      for (const relative of references) {
        if (!(await tx.get(db.doc(`tenants/${tenantId}/${relative}`))).exists) throw new BusinessError(400, `Referência não encontrada nesta empresa: ${relative}.`);
      }
    }
    const changedFields = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(next)])]
      .filter(key => JSON.stringify(before[key]) !== JSON.stringify(next[key]))
      .map(key => [key, { before: before[key] ?? null, after: next[key] ?? null }]));
    if (mode === 'create') tx.create(ref, next); else tx.set(ref, next);
    tx.create(auditRef, { actor, keyId, action: mode === 'create' ? 'create' : 'update', collectionName: collection,
      docId: id, changedFields, createdAt: now });
    if (receiptRef) tx.create(receiptRef, { fingerprint: input.receipt!.fingerprint, documentId: id, createdAt: now });
    return next;
  });
}

export function registerAdminWrites(app: Express, db: Firestore | null, auth: RequestHandler,
  prepare: (input: { tenantId: string; docId: string; collectionName: string; payload: Record<string, any>; mode: 'create' | 'patch' }) => Promise<Record<string, any>>) {
  for (const [verb, mode, suffix] of [['post', 'create', ''], ['patch', 'patch', '/:docId'], ['put', 'replace', '/:docId']] as const) {
    app[verb](`/api/admin/tenants/:tenantId/:collectionName${suffix}`, auth, async (req, res) => {
      try {
        const { tenantId, collectionName } = req.params;
        if (!db) return res.status(503).json({ error: 'Banco de dados não disponível.' });
        if (!isRecord(req.body)) throw new BusinessError(400, 'O body deve ser um objeto JSON.');
        if (!WRITABLE_COLLECTIONS.has(collectionName)) throw new BusinessError(403, 'Escrita genérica suspensa; este domínio requer comando de negócio.');
        const access = res.locals.apiAccess;
        if (access.keyId !== 'technical' && !access.scopes.includes(`${collectionName}:write`)) throw new BusinessError(403, 'Chave sem escopo de escrita para esta coleção.');
        const { id: requestedId, ...raw } = req.body;
        if (requestedId !== undefined && !validId(requestedId)) throw new BusinessError(400, 'id inválido.');
        const id = req.params.docId || requestedId || db.collection(`tenants/${tenantId}/${collectionName}`).doc().id;
        if (!validId(id)) throw new BusinessError(400, 'id inválido.');
        if (req.params.docId && requestedId !== undefined && requestedId !== id) throw new BusinessError(400, 'id diverge da rota.');
        // An early existence check avoids uploading media on obvious duplicate creates.
        if (mode === 'create' && (await db.doc(`tenants/${tenantId}/${collectionName}/${id}`).get()).exists) throw new BusinessError(409, 'Documento já existe.');
        const payload = await prepare({ tenantId, docId: id, collectionName, payload: raw, mode: mode === 'patch' ? 'patch' : 'create' });
        const item = await writeAdminDocument(db, { tenantId, collection: collectionName, id, payload, mode, actor: access.actor, keyId: access.keyId });
        return res.status(mode === 'create' ? 201 : 200).json({ success: true, tenantId, collection: collectionName, id, item: { id, ...item } });
      } catch (error) {
        if (error instanceof BusinessError) return res.status(error.status).json({ error: error.message });
        console.error('Falha em escrita administrativa:', error);
        return res.status(500).json({ error: 'Não foi possível concluir a operação.' });
      }
    });
  }
  app.delete('/api/admin/tenants/:tenantId/:collectionName/:docId', auth, (_req, res) =>
    res.status(403).json({ error: 'Exclusão genérica suspensa para preservar histórico. Use arquivamento no fluxo suportado.' }));
}
