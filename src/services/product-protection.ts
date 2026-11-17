import { doc, updateDoc, type Firestore } from 'firebase/firestore';

// Inactivation preserves recipes and their legacy consumption until E2/E3 migrate stock.
export async function archiveProduct(database: Firestore, tenantId: string, productId: string) {
  await updateDoc(doc(database, `tenants/${tenantId}/products/${productId}`), { status: 'inativo' });
}

// The server loads costs/fees from the tenant; client totals are never accepted.
export async function saveCalculatedPrice(user: { getIdToken(): Promise<string> }, tenantId: string, productId: string, command: {
  requestId: string; variationId: string; channelId: string; targetType: string; targetValue: number; includeAffiliate: boolean;
}) {
  const token = await user.getIdToken();
  const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/products/${encodeURIComponent(productId)}/pricing-snapshots`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o cálculo.');
  return result.snapshot;
}
