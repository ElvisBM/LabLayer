import { collection, doc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';

// Inactivation preserves recipes and their legacy consumption until E2/E3 migrate stock.
export async function archiveProduct(database: Firestore, tenantId: string, productId: string) {
  await updateDoc(doc(database, `tenants/${tenantId}/products/${productId}`), { status: 'inativo' });
}

export type LegacyPriceEntry = {
  id: string; savedAt: string; variationId: string; variationLabel: string;
  channelId: string; channelName: string; targetType: string; targetValue: number;
  suggestedPrice: number; cost: number; profit: number; margin: number;
};

export async function appendPriceSnapshot(database: Firestore, tenantId: string, productId: string, entry: LegacyPriceEntry, actorUid: string) {
  if (!actorUid || !entry.id || [entry.targetValue, entry.suggestedPrice, entry.cost, entry.profit, entry.margin].some(v => !Number.isFinite(v)) || entry.cost < 0 || entry.suggestedPrice < 0) {
    throw new Error('Preço ou identidade inválidos.');
  }
  const product = doc(database, `tenants/${tenantId}/products/${productId}`);
  const snapshot = doc(collection(product, 'pricingSnapshots'), entry.id);
  const batch = writeBatch(database);
  batch.set(snapshot, { ...entry, actorUid, calculationVersion: 'legacy-ui' });
  batch.update(product, { latestSuggestedPrice: entry });
  await batch.commit();
}
