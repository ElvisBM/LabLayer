import { optionTotal, publicCustomerQuote } from '../requests/quote';
import { validDeliveryDate, type WorkflowChange } from './workflow';

export const assistantStatuses: Record<string, string> = {
  'aguardando-orcamento': 'Aguardando orçamento', orcado: 'Orçado',
  'fila-producao': 'Aprovado · na fila', produzindo: 'Em produção', finalizado: 'Finalizado', cancelado: 'Cancelado',
};
export const nextAssistantStatus: Record<string, string | undefined> = {
  'aguardando-orcamento': 'orcado', orcado: 'fila-producao', 'fila-producao': 'produzindo', produzindo: 'finalizado',
};
export function canCancelAssistantOrder(status: string) {
  return ['aguardando-orcamento', 'orcado', 'fila-producao', 'produzindo'].includes(status);
}
export function canChangeAssistantStatus(from: string, to: string) {
  return Object.hasOwn(assistantStatuses, from) && Object.hasOwn(assistantStatuses, to) && from !== to;
}
// Manual confirmations validate the destination even when earlier steps were skipped.
export function assistantStatusUpdate(row: any, status: string, deliveryDate: unknown, now: string, quote: { quantity?: unknown; quotedPrice?: unknown; gift?: unknown } = {}) {
  if (!canChangeAssistantStatus(row.status, status)) throw Error('Esta mudança de status não está disponível. Atualize o pedido e confira a etapa atual.');
  const patch: Record<string, string | number | boolean> = { status, updatedAt: now };
  const entered = quote.quantity !== undefined || quote.quotedPrice !== undefined;
  const needsQuote = status === 'orcado' || status === 'fila-producao';
  if (quote.gift !== undefined && (typeof quote.gift !== 'boolean' || !needsQuote)) throw Error('Presente inválido para esta etapa.');
  if (status === 'fila-producao' && quote.quantity === undefined) throw Error('Confirme a quantidade para a fila de produção.');
  if (entered && !needsQuote) throw Error('Quantidade e valor só podem ser cadastrados ao marcar como orçado.');
  if (needsQuote) {
    const quantity = entered ? quote.quantity : row.requestedQuantity;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || (!entered && row.provisionalQuantity))
      throw Error('Confirme uma quantidade inteira entre 1 e 100.000.');
    const option = publicCustomerQuote(row.customerQuote)?.options.find(o => o.quantity === quantity && o.unitPrice > 0);
    const total = option ? optionTotal(option) : undefined;
    const price = entered ? quote.quotedPrice : total ?? row.quotedPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || (quote.gift === true ? price !== 0 : price <= 0) || price > 100000000000 || Math.round(price * 100) / 100 !== price)
      throw Error('Informe o valor total do orçamento em reais, com até duas casas decimais.');
    if (!quote.gift && total !== undefined && price !== total) throw Error('O total deve corresponder à opção cadastrada para esta quantidade.');
    if (quote.gift === true || row.isGift) patch.isGift = quote.gift === true;
    patch.requestedQuantity = quantity;
    patch.quotedPrice = price;
    if (row.provisionalQuantity) patch.provisionalQuantity = false;
  }
  if (deliveryDate !== undefined && ((status !== 'produzindo' && status !== 'fila-producao') || !validDeliveryDate(deliveryDate))) throw Error('Data de entrega inválida para esta atualização.');
  if (status === 'produzindo' || status === 'fila-producao') {
    const delivery = deliveryDate ?? row.requestedDeliveryDate;
    if (!validDeliveryDate(delivery)) throw Error('Informe a data de entrega combinada.');
    patch.requestedDeliveryDate = delivery;
    if (status === 'produzindo') patch.startedAt = now;
    else patch.approvedAt = now;
  }
  if (status === 'finalizado') patch.completedAt = now;
  const changes: WorkflowChange[] = Object.entries(patch).filter(([field, value]) => field !== 'updatedAt' && (row[field] ?? '') !== value)
    .map(([field, after]) => ({ field, before: row[field] ?? '', after }));
  return { patch, changes };
}
