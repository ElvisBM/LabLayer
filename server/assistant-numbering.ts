import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { existingRequestNumber, formatRequestCode } from '../shared/requests/number';

// Reserve within the same transaction as creation. The caller writes only after all reads.
export async function nextAssistantNumber(db: Firestore, tx: Transaction, tenant: string) {
  const counter = db.doc(`tenants/${tenant}/assistantCounters/requests`);
  const [state, requests] = await Promise.all([
    tx.get(counter),
    tx.get(db.collection(`tenants/${tenant}/customRequests`).select('code', 'requestNumber', 'title')),
  ]);
  const prior = state.data()?.lastNumber;
  let last = Number.isSafeInteger(prior) && prior > 0 ? prior : 0;
  for (const row of requests.docs) last = Math.max(last, existingRequestNumber({ ...row.data(), id: row.id }) || 0);
  if (last >= Number.MAX_SAFE_INTEGER) throw Error('Limite de numeração atingido.');
  return { counter, number: last + 1, code: formatRequestCode(last + 1) };
}
