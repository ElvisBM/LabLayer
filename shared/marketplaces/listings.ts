export const platformNames = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', tiktok: 'TikTok Shop' } as const;
export type Platform = keyof typeof platformNames;
export interface ChannelListing {
  id: string; platform: Platform; title: string; status: string;
  price: number | null; currency: string; quantity: number | null;
  url: string | null; thumbnail: string | null;
}
export interface ListingResult {
  listings: ChannelListing[]; total: number; complete: boolean; fetchedAt: string; seller: string;
}
export const listingStatus: Record<string, string> = {
  active: 'Ativo', paused: 'Pausado', closed: 'Encerrado', under_review: 'Em análise', inactive: 'Inativo', payment_required: 'Pagamento pendente',
};
export function safeListingUrl(value: unknown, domain: string): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === domain || url.hostname.endsWith('.' + domain)) ? url.href : null;
  } catch { return null; }
}
export function normalizeMLListing(item: any): ChannelListing {
  return {
    id: item.id, platform: 'mercadolivre', title: String(item.title || item.id).slice(0, 500), status: String(item.status || 'unknown').slice(0, 60),
    price: typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 ? item.price : null,
    currency: /^[A-Z]{3}$/.test(item.currency_id) ? item.currency_id : 'BRL',
    quantity: Number.isSafeInteger(item.available_quantity) && item.available_quantity >= 0 ? item.available_quantity : null,
    url: safeListingUrl(item.permalink, 'mercadolivre.com.br'),
    thumbnail: safeListingUrl(item.secure_thumbnail, 'mlstatic.com') || safeListingUrl(item.pictures?.[0]?.secure_url, 'mlstatic.com'),
  };
}
