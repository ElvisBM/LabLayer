import React, { useState, type ReactNode } from 'react';
import { ChevronRight, Copy, CalendarDays } from 'lucide-react';
import { requestCode, withoutRequestCode } from '../../../shared/requests/number';
import { formatCustomerQuote, type CustomerQuote } from '../../../shared/requests/quote';
import { CustomerQuotePreview } from './CustomerQuote';
import { TenantQuoteImage } from './QuoteImage';

type Order = { id: string; title: string; code?: string; requestNumber?: string | number; customerName?: string; requestedQuantity: number; status: string; quotedPrice?: number; customerQuote?: CustomerQuote | null; requestedDeliveryDate?: string; updatedAt?: string; referenceImageUrl?: string; quoteMediaImageUrl?: string };
export function PlatformOrderCard({ order, statusLabel, statusClass, selection, onOpen }: { order: Order; statusLabel: string; statusClass: string; selection: ReactNode; onOpen: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState('');
  const code = requestCode(order);
  const title = withoutRequestCode(order.title) || order.title;
  const quoteText = order.customerQuote ? formatCustomerQuote(order.customerQuote) : '';
  const total = order.status === 'aguardando-orcamento' && !order.quotedPrice ? 'A calcular' : order.quotedPrice == null ? 'Não informado' : order.quotedPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const delivery = order.requestedDeliveryDate?.split('-').reverse().join('/');
  return <article className="min-w-0 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4 sm:p-5 shadow-sm">
    <div className="flex items-start gap-3">
      <div className="pt-1">{selection}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button id={`request-title-${order.id}`} type="button" onClick={onOpen} className="min-w-0 text-left rounded focus-visible:ring-2 focus-visible:ring-primary">
            <span className="block text-xs font-bold tracking-wide text-primary mb-1">{code || 'Sem número atribuído'}</span>
            <h3 className="text-base sm:text-lg font-bold break-words">{title}</h3>
            <span className="block mt-1 text-sm text-on-surface-variant">{order.customerName || 'Cliente a confirmar'} · {order.requestedQuantity > 0 ? `${order.requestedQuantity} ${order.requestedQuantity === 1 ? 'unidade' : 'unidades'}` : 'Quantidade a confirmar'}</span>
          </button>
          <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>{statusLabel}</span>
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-outline-variant/15 pt-4">
          <div><span className="block text-xs text-on-surface-variant">Total do orçamento</span><strong className="block mt-1 text-xl font-bold text-primary tabular-nums">{total}</strong></div>
          <div className="flex flex-wrap gap-2">
            {!!quoteText && <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/30 px-3 text-sm font-semibold text-primary" onClick={async () => {
              try { await navigator.clipboard.writeText(quoteText); setNotice('Orçamento copiado!'); }
              catch { setExpanded(true); setNotice('Selecione e copie o texto nas opções abaixo.'); }
            }}><Copy size={15} />Copiar orçamento</button>}
            <button type="button" aria-label={`Abrir detalhes de ${code ? `${code} — ` : ''}${title}`} onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary">Abrir pedido<ChevronRight size={16} /></button>
          </div>
        </div>
        {delivery && <p className="mt-4 flex items-center gap-2 text-sm text-on-surface-variant"><CalendarDays size={16} />Entrega combinada: <strong className="text-on-surface">{delivery}</strong></p>}
        {quoteText && <details className="mt-4 border-t border-outline-variant/15 pt-3 text-sm" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
          <summary className="cursor-pointer font-semibold text-primary min-h-8">Ver opções do orçamento</summary>
          {expanded && <CustomerQuotePreview quote={order.customerQuote} image={<TenantQuoteImage reference={order.quoteMediaImageUrl || order.referenceImageUrl} text={quoteText} />} />}
        </details>}
        {notice && <p role="status" className="mt-2 text-sm text-primary">{notice}</p>}
      </div>
    </div>
  </article>;
}
