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

// Suggest tiers for review only. Do not interpret totals, partial lists or mixed commands.
export function quoteTiersFromMessage(message: string): QuoteOption[] | null {
  if (typeof message !== 'string' || message.length > 4000 || /[?]|\b(?:total|totais|não|nao|aprovar|aprovado|produzir|cancelar|frete)\b/i.test(message)) return null;
  const parts = message.trim().replace(/[.!]$/, '').split(/\s*(?:[;\n]+|,\s+(?=\d+\s*(?:un|peça)))\s*/i).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return null;
  const options: QuoteOption[] = [];
  for (const [index, line] of parts.entries()) {
    const m = line.match(/(\d+)\s*(?:unidades?|unid\.?|un\.?|peças?)\s*(?:por|a|[:=–—-])\s*(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*(?:cada|por unidade|a unidade))?$/i);
    if (!m || (m.index && (index !== 0 || /\d/.test(line.slice(0, m.index).replace(/\bORC\s*[-#]?\s*\d+\b/gi, ''))))) return null;
    const quantity = Number(m[1]), unitPrice = Number(m[2].replace(',', '.'));
    if (!quantity || quantity > 100000 || unitPrice <= 0 || unitPrice > 1000000 || options.some(o => o.quantity === quantity)) return null;
    options.push({ quantity, unitPrice, deliveryDays: null });
  }
  return options;
}

/** A declared single price, not a question, payment, extra charge or price list. */
export function priceFromOrderMessage(text: unknown) {
  if (typeof text !== 'string' || text.length > 2000 || /[?\n]|\b(?:não|nao|talvez|se|mais|adicional|acréscimo|desconto|frete|pago|pagamento|aprovar|produzir|adicionar|incluir)\b/i.test(text)) return null;
  const m = text.trim().match(/^(?:(?:o\s+)?(?:valor|preço|preço unitário|valor unitário|valor total|total|orçamento)(?:\s+(?:do orçamento|do pedido))?\s*(?:(?:é|fica|ficou|de|em)\s+|[:=]\s*)*(?:R\$\s*)?|R\$\s*)(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+\.\d{1,2})(?:\s*(reais))?(?:\s+(cada|por unidade|a unidade|no total))?(?:[.!]?|(?:\s+e\s+|\s*[,;]\s*)([^\d$?]+))$/i);
  if (!m) return null;
  const amount = Number(m[1].includes(',') || /\.\d{3}$/.test(m[1]) ? m[1].replace(/\./g,'').replace(',','.') : m[1]);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000000) return null;
  return { amount, unit: /unitário/i.test(text) || !!(m[3] && m[3].toLowerCase() !== 'no total') };
}
