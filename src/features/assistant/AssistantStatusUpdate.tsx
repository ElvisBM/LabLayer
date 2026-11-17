import { priceFromOrderMessage, quoteTiersFromMessage, optionTotal } from '../../../shared/requests/quote';
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { assistantStatuses } from '../../../shared/assistant/status';
import type { AssistantOrder } from './AssistantOrderCard';
export type StatusPayload = { operationId: string; status: string; expectedStatus: string; expectedUpdatedAt: string | null; deliveryDate?: string; quantity?: number; quotedPrice?: number; tierMessage?: string; quoteMessage?: string; workflowMessage?: string; paid?: boolean; gift?: boolean; priceBasis?: 'unit' | 'total' };
export function AssistantStatusConfirmation({ order, status, busy, onConfirm, onCancel, tierMessage, quoteMessage, workflowMessage, workflowPriceSuggested, workflowPaid }: {
  tierMessage?: string; quoteMessage?: string; workflowMessage?: string; workflowPriceSuggested?: boolean; workflowPaid?: boolean; order: AssistantOrder; status: string; busy: boolean; onConfirm: (payload: StatusPayload) => Promise<void>; onCancel: () => void;
}) {
  const financial = status === 'orcado' || status === 'fila-producao';
  const [gift, setGift] = useState(!!order.isGift && !quoteMessage && !tierMessage);
  const [paymentReceived, setPaymentReceived] = useState(workflowPaid === true);
  const declared = priceFromOrderMessage(quoteMessage);
  const [basis, setBasis] = useState<'unit'|'total'>(declared?.unit ? 'unit' : 'total');
  const tiers = tierMessage ? quoteTiersFromMessage(tierMessage) : null;
  const [quantity, setQuantity] = useState(tiers && !tiers.some(o => o.quantity === order.quantity) ? '' : String(order.quantity || ''));
  const [manualTotal, setManualTotal] = useState(order.quotedPrice ? order.quotedPrice.toFixed(2).replace('.', ',') : '');
  const option = (tiers ?? order.customerQuote?.options)?.find(o => o.quantity === Number(quantity) && o.unitPrice > 0);
  const total = gift ? '0,00' : declared ? (Math.round(declared.amount * 100) * (basis === 'unit' ? Number(quantity) : 1) / 100).toFixed(2).replace('.', ',') : option ? optionTotal(option).toFixed(2).replace('.', ',') : tiers ? '' : manualTotal;
  const [delivery, setDelivery] = useState(order.requestedDeliveryDate || '');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const payload = useRef<StatusPayload | null>(null);
  const sending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); if (quoteMessage) heading.current?.scrollIntoView?.({block:"center"}); }, [quoteMessage]);
  return <form aria-label="Confirmar mudança de status" className="assistant-status-confirmation" onSubmit={async event => {
    event.preventDefault(); if (sending.current) return;
    const price = Number(total.trim().replace(',', '.'));
    if (financial && !payload.current) {
      if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 100000) { setError('Informe uma quantidade inteira entre 1 e 100.000.'); return; }
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(total.trim()) || (gift ? price !== 0 : price <= 0) || price > 100000000000) { setError('Informe o valor total em reais. Exemplo: 125,50.'); return; }
    }
    sending.current = true; setError('');
    const selectedDate = String(new FormData(event.currentTarget).get('deliveryDate') || delivery);
    payload.current ??= { operationId: crypto.randomUUID(), status, expectedStatus: order.status, expectedUpdatedAt: order.updatedAt || null, ...(financial ? { ...(gift ? {gift:true} : {}), quantity: Number(quantity), quotedPrice: price, ...(tierMessage ? { tierMessage } : {}), ...(quoteMessage ? { quoteMessage, priceBasis: basis } : {}) } : {}), ...(workflowMessage ? { workflowMessage, paid: paymentReceived } : {}), ...(status === 'produzindo' || status === 'fila-producao' ? { deliveryDate: selectedDate } : {}) };
    try { await onConfirm(payload.current); }
    catch (e) {
      const code = (e as any).status;
      const uncertain = !(code >= 400 && code < 500 && code !== 429);
      if (!uncertain) payload.current = null;
      setRetry(uncertain); setError((e as Error).message);
    } finally { sending.current = false; }
  }}>
    <h2 ref={heading} tabIndex={-1}>{declared ? 'Conferir valor do orçamento' : tiers ? 'Conferir faixas de preço' : status === 'cancelado' ? 'Cancelar este pedido?' : 'Confirmar mudança de status'}</h2>
    <p>{order.title}</p>
    <p>{order.status === status ? <>Status: <strong>{assistantStatuses[status]}</strong></> : <><strong>{assistantStatuses[order.status]}</strong> → <strong>{assistantStatuses[status]}</strong></>}</p>
    {workflowMessage && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm"><strong>Mensagem do vendedor</strong><p className="mt-1 whitespace-pre-wrap">{workflowMessage}</p></div>}
    {workflowMessage && <label><span><input type="checkbox" checked={paymentReceived} disabled={busy || retry} onChange={e=>setPaymentReceived(e.target.checked)} /> Pagamento recebido</span></label>}
    {financial && <>
      {!tiers && !declared && <label><span><input type="checkbox" checked={gift} disabled={busy || retry} onChange={e=>setGift(e.target.checked)} /> Presente / sem cobrança</span></label>}
      {declared && <><p>{quoteMessage}</p><label>O valor informado é<select value={basis} disabled={busy || retry} onChange={e=>setBasis(e.target.value as 'unit'|'total')}><option value="total">Total do pedido</option><option value="unit">Por unidade</option></select></label></>}
      {tiers && <><p>Confira se os valores são por unidade antes de confirmar.</p><ul>{tiers.map(o => <li key={o.quantity}>{o.quantity} un. × {o.unitPrice.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} = {optionTotal(o).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</li>)}</ul></>}
      <label>Quantidade{tiers ? <select required value={quantity} disabled={busy || retry} onChange={e=>setQuantity(e.target.value)}><option value="">Selecione a quantidade do pedido</option>{tiers.map(o=><option key={o.quantity} value={o.quantity}>{o.quantity}</option>)}</select> : <input type="number" min="1" max="100000" step="1" required value={quantity} disabled={busy || retry} onChange={e => { setQuantity(e.target.value); setManualTotal(''); }} />}</label>
      <label>Valor total do orçamento (R$)<input type="text" inputMode="decimal" required placeholder="Ex.: 125,50" value={total} readOnly={gift || !!declared || !!option || !!tiers} disabled={busy || retry} onChange={e => setManualTotal(e.target.value)} /></label>
      {workflowPriceSuggested && <p className="text-xs text-amber-800">Valor sugerido pelo preço por unidade que já consta no histórico. Confira se ele se aplica a esta quantidade.</p>}
      <p className="text-xs text-slate-600">{gift ? 'Total de R$ 0,00. Nenhum pagamento será registrado.' : declared ? 'A mensagem também ficará no histórico do pedido.' : tiers ? 'O total corresponde à quantidade escolhida. Todas as faixas serão salvas.' : option ? 'Total calculado pela opção de preço cadastrada para esta quantidade.' : 'Informe o total para todas as unidades.'}</p>
    </>}
    {(status === 'produzindo' || status === 'fila-producao') && <label>Data de entrega<input name="deliveryDate" type="date" required min="2000-01-01" max="2100-12-31" disabled={busy || retry} value={delivery} onChange={e => setDelivery(e.target.value)} /></label>}
    <p className="text-xs text-slate-500">{status === 'cancelado' ? 'O pedido será marcado como cancelado. Os dados e o histórico serão preservados.' : 'A atualização será registrada no histórico deste pedido.'}</p>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2"><button className="assistant-send" disabled={busy}><Check size={16} />{busy ? 'Salvando…' : retry ? 'Reenviar a mesma atualização' : declared ? 'Confirmar orçamento' : tiers ? 'Confirmar faixas no orçamento' : status === 'cancelado' ? 'Confirmar cancelamento' : 'Confirmar status'}</button><button className="assistant-card-button" type="button" disabled={busy || retry} onClick={onCancel}>{status === 'cancelado' ? 'Manter pedido' : 'Voltar'}</button></div>
  </form>;
}
