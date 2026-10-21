import { doc, writeBatch, type Firestore } from 'firebase/firestore';

export const REQUEST_STATUSES = ['aguardando-orcamento', 'orcado', 'fila-producao', 'produzindo', 'finalizado'] as const;
export type RequestStatus = typeof REQUEST_STATUSES[number];
export const MAX_BULK_REQUESTS = 100;

// One atomic commit under the same Firestore rules used by individual edits.
export async function changeRequestStatuses(db: Firestore, tenantId: string, ids: string[], status: RequestStatus) {
  const validId = (id: unknown): id is string => typeof id === 'string' && !!id && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..';
  if (!validId(tenantId) || !ids.length || ids.length > MAX_BULK_REQUESTS || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length || !REQUEST_STATUSES.includes(status))
    throw Error('Selecione de 1 a 100 solicitações válidas e um status.');
  const batch = writeBatch(db);
  const updatedAt = new Date().toISOString();
  for (const id of ids) batch.update(doc(db, `tenants/${tenantId}/customRequests/${id}`), { status, updatedAt });
  await batch.commit();
}
