export interface QuoteOption { quantity: number; unitPrice: number; deliveryDays: number | null }
export interface CustomerQuote { name: string; size: string; options: QuoteOption[] }
const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ');
export const optionTotal = (option: QuoteOption) => Math.round(option.unitPrice * 100) * option.quantity / 100;
export function validCustomerQuote(value: unknown): value is CustomerQuote {
  const q = value as CustomerQuote;
  return !!q && typeof q.name === 'string' && q.name.trim().length > 0 && q.name.length <= 150 && typeof q.size === 'string' && q.size.length <= 250 &&
    Array.isArray(q.options) && q.options.length >= 1 && q.options.length <= 5 && new Set(q.options.map(o => o?.quantity)).size === q.options.length &&
    q.options.every(o => !!o && Number.isInteger(o.quantity) && o.quantity >= 1 && o.quantity <= 100000 && Number.isFinite(o.unitPrice) && o.unitPrice >= 0 && o.unitPrice <= 1000000 && Math.abs(o.unitPrice * 100 - Math.round(o.unitPrice * 100)) < 0.000001 && (o.deliveryDays === null || (Number.isInteger(o.deliveryDays) && o.deliveryDays >= 1 && o.deliveryDays <= 3650)));
}
// Explicit projection: production inputs and internal notes never enter customer text/API.
export function publicCustomerQuote(value: unknown): CustomerQuote | null {
  if (!validCustomerQuote(value)) return null;
  return { name: value.name, size: value.size, options: value.options.map(({ quantity, unitPrice, deliveryDays }) => ({ quantity, unitPrice, deliveryDays })) };
}
export function formatCustomerQuote(quote: CustomerQuote): string {
  if (!validCustomerQuote(quote)) return '';
  return [`Orçamento — ${quote.name.trim()}`, quote.size.trim(), ...[...quote.options].sort((a,b) => a.quantity-b.quantity).map(o =>
    `• ${o.quantity} ${o.quantity === 1 ? 'unidade' : 'unidades'}: ${currency(o.unitPrice)}${o.quantity === 1 ? '' : ` por unidade — Total: ${currency(optionTotal(o))}`}${o.deliveryDays === null ? '' : `\n  Prazo de entrega: ${o.deliveryDays} ${o.deliveryDays === 1 ? 'dia' : 'dias'}.`}`)].filter(Boolean).join('\n');
}
