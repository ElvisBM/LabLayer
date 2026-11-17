export const REQUEST_SORT_OPTIONS = [
  { value: 'updatedAt', label: 'Última atualização' },
  { value: 'title', label: 'Solicitação' },
  { value: 'customerName', label: 'Cliente' },
  { value: 'requestedQuantity', label: 'Quantidade' },
  { value: 'status', label: 'Status' },
  { value: 'quotedPrice', label: 'Orçamento' },
  { value: 'createdAt', label: 'Data de criação' },
] as const;
export type RequestSortField = typeof REQUEST_SORT_OPTIONS[number]['value'];
export type RequestSortDirection = 'asc' | 'desc';
type SortableRequest = { id: string; title: string; status: string; customerName?: string; requestedQuantity?: number; quotedPrice?: number; createdAt?: string; updatedAt?: string };
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const stages = ['aguardando-orcamento', 'orcado', 'fila-producao', 'produzindo', 'finalizado', 'cancelado'];
function value(row: SortableRequest, field: RequestSortField): string | number | null {
  if (field === 'updatedAt' || field === 'createdAt') {
    const date = Date.parse(field === 'updatedAt' ? row.updatedAt || row.createdAt || '' : row.createdAt || '');
    return Number.isFinite(date) ? date : null;
  }
  if (field === 'status') { const index = stages.indexOf(row.status); return index < 0 ? null : index; }
  if (field === 'quotedPrice' || field === 'requestedQuantity') {
    const number = row[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || (field === 'requestedQuantity' && number === 0)) return null;
    // A pending zero quote is displayed as "A calcular", not a priced quote.
    return field === 'quotedPrice' && row.status === 'aguardando-orcamento' && number === 0 ? null : number;
  }
  return row[field]?.trim() || null;
}
export function compareRequests(a: SortableRequest, b: SortableRequest, field: RequestSortField, direction: RequestSortDirection) {
  const completed = Number(['finalizado', 'cancelado'].includes(a.status)) - Number(['finalizado', 'cancelado'].includes(b.status));
  if (completed) return completed; // Never reverse this priority with descending order.
  const av = value(a, field), bv = value(b, field);
  if (av === null || bv === null) {
    if (av !== bv) return av === null ? 1 : -1;
  } else {
    const compared = typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv));
    if (compared) return direction === 'asc' ? compared : -compared;
  }
  return collator.compare(a.id, b.id);
}
