import type { ChannelListing } from './listings';
export const tikTokStatuses: Record<string, string> = { DRAFT: 'draft', PENDING: 'under_review', FAILED: 'rejected', ACTIVATE: 'active', SELLER_DEACTIVATED: 'paused', PLATFORM_DEACTIVATED: 'platform_inactive', FREEZE: 'frozen', DELETED: 'closed', SCHEDULED: 'scheduled' };
export function normalizeTikTokListing(item: any): ChannelListing {
  if (typeof item?.id !== 'string' || !/^\d{1,40}$/.test(item.id)) throw Error('Invalid product id');
  const skus = Array.isArray(item.skus) ? item.skus : [];
  const prices = skus.map((s: any) => s.price?.sale_price);
  const currencies = skus.map((s: any) => s.price?.currency);
  // Show a price only when all variants have the same complete price/currency. No invented minimum or FX conversion.
  const samePrice = prices.length > 0 && prices.every((p: any) => typeof p === 'string' && /^\d+(\.\d{1,4})?$/.test(p) && p === prices[0]) &&
    currencies.every((c: any) => typeof c === 'string' && /^[A-Z]{3}$/.test(c) && c === currencies[0]);
  let quantity: number | null = skus.length ? 0 : null; const seen = new Set<string>();
  for (const sku of skus) {
    if (typeof sku.id !== 'string' || !Array.isArray(sku.inventory) || !sku.inventory.length) { quantity = null; break; }
    for (const inv of sku.inventory) {
      const key = sku.id + ':' + inv.warehouse_id;
      if (typeof inv.warehouse_id !== 'string' || seen.has(key) || !Number.isSafeInteger(inv.quantity) || inv.quantity < 0) { quantity = null; break; }
      seen.add(key); quantity! += inv.quantity;
    }
    if (quantity === null || !Number.isSafeInteger(quantity)) { quantity = null; break; }
  }
  return { id: item.id, platform: 'tiktok', title: String(item.title || item.id).slice(0, 500),
    status: tikTokStatuses[item.status] || 'unknown', price: samePrice && Number.isFinite(Number(prices[0])) ? Number(prices[0]) : null,
    currency: samePrice ? currencies[0] : 'BRL', quantity, url: null, thumbnail: null };
}
