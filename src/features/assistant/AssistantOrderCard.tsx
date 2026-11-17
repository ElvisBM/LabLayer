import { requestCode, withoutRequestCode } from '../../../shared/requests/number';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, RefreshCw } from 'lucide-react';
import { formatCustomerQuote, optionTotal, type CustomerQuote } from '../../../shared/requests/quote';
import { assistantStatuses as statuses, canChangeAssistantStatus } from '../../../shared/assistant/status';
import type { ReactNode } from 'react';
import { AssistantQuoteImage } from '../requests/PublicQuoteImage';

export type AssistantOrder = {
  id: string; title: string; isGift?: boolean; customerName?: string; quantity: number; status: string;
  code?: string; requestNumber?: string | number; quotedPrice?: number | null;
  customerQuote?: CustomerQuote | null; quoteImageId?: string | null;
  createdAt?: string; quoteSentAt?: string; description?: string; updatedAt?: string; requestedDeliveryDate?: string | null;
};
export const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function dateLabel(value?: string | null) {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
}
export function orderHeading(order: AssistantOrder) {
  const code = requestCode(order);
  const title = withoutRequestCode(order.customerQuote?.name || order.title) || order.title;
  return { code, title };
}
export function AssistantOrderCard({ order, token, busy, workflowUpdates, onOpen, onApprove, onStatus, confirmation }: {
  order: AssistantOrder; token: string; busy: boolean; workflowUpdates?: boolean; onOpen: () => void; onApprove: () => void; onStatus: (status: string) => void; confirmation?: ReactNode;
}) {
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(false);
  const quoteText = order.customerQuote ? formatCustomerQuote(order.customerQuote) : '';
  const selectedOption = order.customerQuote?.options.find(option => option.quantity === order.quantity);
  const total = order.quotedPrice ?? (selectedOption ? optionTotal(selectedOption) : null);
  const delivery = dateLabel(order.requestedDeliveryDate);
  const { code } = orderHeading(order);
  return <article className="assistant-order-card">
    <div className="assistant-order-top">
      <button className="assistant-order-link" disabled={busy} onClick={onOpen}>
        <h3>{code && withoutRequestCode(order.title) ? `${code} — ${withoutRequestCode(order.title)}` : code || order.title}</h3><p>{order.customerName || 'Cliente a confirmar'} · {order.quantity} {order.quantity === 1 ? 'unidade' : 'unidades'}</p>
      </button>
      <span className={`assistant-badge status-${order.status}`}><i />{statuses[order.status] || order.status || 'Não informado'}</span>
    </div>
    <div className="assistant-order-bottom">
      <div><small>Total do orçamento</small><strong>{order.isGift ? 'Presente · sem cobrança' : total == null ? 'Ainda não calculado' : money(total)}</strong></div>
      {order.updatedAt && <span className="assistant-updated"><RefreshCw size={13} />{dateLabel(order.updatedAt)}</span>}
      <div className="assistant-order-actions">
        {workflowUpdates && <label className="assistant-status-control"><span>Atualizar status</span><select aria-label={`Atualizar status de ${code || order.title}`} disabled={busy} value={order.status} onChange={e => onStatus(e.target.value)}>
          {Object.entries(statuses).map(([value, label]) => <option key={value} value={value} disabled={value !== order.status && !canChangeAssistantStatus(order.status, value)}>{label}</option>)}
        </select></label>}
        <button className="assistant-card-button" disabled={busy} onClick={onOpen}>Abrir pedido<ChevronRight size={15} /></button>
        {!!quoteText && <button className="assistant-card-button is-copy" onClick={async () => {
          try { await navigator.clipboard.writeText(quoteText); setNotice('Orçamento copiado!'); }
          catch { setExpanded(true); setNotice('Não foi possível copiar. Selecione o texto do orçamento abaixo.'); }
        }}><Copy size={15} />Copiar orçamento</button>}
      </div>
    </div>
    {confirmation && <div className="assistant-inline-confirmation">{confirmation}</div>}
    {notice && <p className="text-xs text-indigo-700 mt-3" role="status">{notice}</p>}
    {quoteText && <details className="assistant-quote-details" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>Ver opções do orçamento</summary>{expanded && <div className="space-y-3 pt-3"><p className="whitespace-pre-wrap">{quoteText}</p><AssistantQuoteImage defer id={order.quoteImageId} requestId={order.id} token={token} text={quoteText} /></div>}</details>}
    {(delivery || selectedOption?.deliveryDays || (workflowUpdates && ['orcado', 'fila-producao'].includes(order.status))) && <div className={`assistant-delivery ${!delivery && order.status === 'fila-producao' ? 'needs-date' : ''}`}>
      <div><strong>{delivery ? 'Entrega combinada' : selectedOption?.deliveryDays ? 'Prazo do orçamento' : 'Confirme a entrega com o cliente'}</strong><p>{delivery || (selectedOption?.deliveryDays ? `${selectedOption.deliveryDays} dias · confirme a data ao aprovar` : 'Quantidade e prazo serão conferidos antes de salvar.')}</p></div>
      {workflowUpdates && ['orcado', 'fila-producao'].includes(order.status) && <button className="assistant-card-button is-copy" disabled={busy} onClick={onApprove}>{order.status === 'orcado' ? 'Aprovar produção' : 'Ajustar entrega'}</button>}
    </div>}
  </article>;
}

export function ProductionConfirmation({ order, busy, retry, onConfirm, onCancel, feedback, inline = false }: { order: AssistantOrder; busy: boolean; retry: boolean; onConfirm: (command: string) => void; onCancel: () => void; feedback?: ReactNode; inline?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); if (!inline) heading.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }, []);
  const [quantity, setQuantity] = useState(order.quantity);
  const [delivery, setDelivery] = useState(order.requestedDeliveryDate || '');
  const [days, setDays] = useState('');
  const quantities = Array.from(new Set([order.quantity, ...(order.customerQuote?.options || []).filter(o => o.unitPrice > 0).map(o => o.quantity)])).sort((a,b) => a-b);
  function updateDays(value: string) {
    setDays(value);
    if (!value || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 365) { setDelivery(''); return; }
    const date = new Date();
    date.setDate(date.getDate() + Number(value));
    setDelivery(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  }
  return <form aria-label="Confirmar aprovação" className="assistant-surface assistant-approval space-y-4" onSubmit={event => {
    event.preventDefault();
    const selectedDate = String(new FormData(event.currentTarget).get('deliveryDate') || delivery);
    onConfirm(`Aprovado; ${quantity} unidades; entregar dia ${selectedDate.split('-').reverse().join('/')}`);
  }}>
    <div><h2 ref={heading} tabIndex={-1}>{order.status === 'orcado' ? 'Confirmar aprovação' : 'Atualizar entrega combinada'}</h2><p className="text-sm mt-2">{order.title} · {order.customerName || 'Cliente a confirmar'}</p></div>
    <p className="text-sm text-slate-600">{order.status === 'orcado' ? 'Ao confirmar, o pedido será autorizado e entrará na fila de produção.' : 'O pedido continuará na fila de produção com a data informada abaixo.'}</p>
    <div className="assistant-approval-fields">
      <label>Quantidade<select required className="min-h-11 rounded-lg border bg-white px-2" disabled={busy || retry} value={quantity} onChange={e => setQuantity(Number(e.target.value))}>{quantities.map(q => <option key={q} value={q}>{q} {q === 1 ? 'unidade' : 'unidades'}</option>)}</select></label>
      <label>Prazo a partir de hoje (dias)<input type="number" min={1} max={365} step={1} disabled={busy || retry} value={days} placeholder="Ex.: 7" onChange={e => updateDays(e.target.value)} /></label>
      <label>Data de entrega<input name="deliveryDate" type="date" min="2000-01-01" max="2100-12-31" required disabled={busy || retry} value={delivery} onChange={e => { setDelivery(e.target.value); setDays(''); }} /></label>
    </div>
    <p className="text-xs text-slate-500">O LabLayer confere a quantidade com as opções de preço cadastradas. A confirmação fica no histórico do pedido.</p>
    {feedback}
    <div className="flex flex-wrap gap-2"><button className="assistant-send" disabled={busy}><Check size={17} />{retry ? 'Reenviar a mesma aprovação' : busy ? 'Salvando…' : 'Confirmar e salvar'}</button><button type="button" className="assistant-card-button" disabled={busy || retry} onClick={onCancel}>Cancelar</button></div>
  </form>;
}
