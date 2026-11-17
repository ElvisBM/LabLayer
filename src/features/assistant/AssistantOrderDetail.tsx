import { withoutRequestCode } from '../../../shared/requests/number';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Copy, ImageIcon, Paperclip } from 'lucide-react';
import { assistantStatuses } from '../../../shared/assistant/status';
import { formatCustomerQuote, optionTotal } from '../../../shared/requests/quote';
import { AssistantQuoteImage } from '../requests/PublicQuoteImage';
import { Files, type Attachment } from './AssistantFiles';
import { dateLabel, money, orderHeading, type AssistantOrder } from './AssistantOrderCard';

export function AssistantOrderDetail({ order, token, busy, onBack, onAttach, loadFile, timeline, children, focusOnOpen = true }: {
  order: AssistantOrder & { attachments?: Attachment[]; notes?: any[] }; token: string; busy: boolean;
  onBack: () => void; onAttach: () => void; loadFile: (id: string, preview?: boolean) => Promise<Blob>; timeline: ReactNode; children: ReactNode; focusOnOpen?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [copyNotice, setCopyNotice] = useState('');
  useEffect(() => { if (!focusOnOpen) return; heading.current?.focus({ preventScroll: true }); heading.current?.closest('.assistant-app')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }, [order.id]);
  const { code, title } = orderHeading(order);
  const quote = order.customerQuote;
  const quoteText = quote ? formatCustomerQuote(quote) : '';
  const selected = quote?.options.find(option => option.quantity === order.quantity);
  const total = order.quotedPrice ?? (selected ? optionTotal(selected) : null);
  const files = [...new Map([...(order.attachments || []), ...(order.notes || []).flatMap(note => note.attachments || [])].map(file => [file.id, file])).values()];
  return <section className="assistant-surface assistant-order-detail">
    <button className="assistant-back" disabled={busy} onClick={onBack}><ArrowLeft size={17} />Voltar aos pedidos</button>
    <div className="assistant-detail-heading"><div><h2 ref={heading} tabIndex={-1}>{code && withoutRequestCode(title) ? `${code} — ${title}` : code || title}</h2><p>{order.customerName || 'Cliente a confirmar'} · {order.quantity} {order.quantity === 1 ? 'unidade' : 'unidades'}</p></div><span className={`assistant-badge status-${order.status}`}><i />{assistantStatuses[order.status] || order.status}</span></div>
    <dl className="assistant-detail-metrics">
      <div><dt>Valor do orçamento</dt><dd>{total == null ? 'Ainda não calculado' : money(total)}</dd></div>
      <div><dt>Última atualização</dt><dd>{dateLabel(order.updatedAt) || 'Não informada'}</dd></div>
      <div><dt>Previsão de entrega</dt><dd>{dateLabel(order.requestedDeliveryDate) || 'Não definida'}</dd></div>
    </dl>
    <section className="assistant-detail-block" aria-label="Orçamento do pedido">
      <div className="assistant-block-heading"><h3><span>1</span>{order.quoteSentAt ? 'Orçamento enviado' : 'Orçamento do cliente'}</h3>{quoteText && <button className="assistant-text-action" onClick={async () => {
        try { await navigator.clipboard.writeText(quoteText); setCopyNotice('Orçamento copiado!'); }
        catch { setCopyNotice('Não foi possível copiar. Selecione o texto do orçamento abaixo.'); }
      }}><Copy size={17} />Copiar texto</button>}</div>
      {copyNotice && <p role="status" className="text-xs text-indigo-700 mb-3">{copyNotice}</p>}
      <div className="assistant-detail-quote">
        <div className="assistant-detail-image">{order.quoteImageId ? <AssistantQuoteImage id={order.quoteImageId} requestId={order.id} token={token} text={quoteText} /> : <div className="assistant-image-empty"><ImageIcon size={32} /><p>Prévia ainda não disponível</p></div>}</div>
        <div>{quote ? <><h4>{quote.name}</h4>{quote.size && <p className="assistant-quote-description">{quote.size}</p>}<ul className="assistant-quote-options">{[...quote.options].sort((a,b) => a.quantity-b.quantity).map(option => <li key={option.quantity}><div><span>{option.quantity} {option.quantity === 1 ? 'unidade' : 'unidades'}</span>{option.deliveryDays != null && <small>Prazo: {option.deliveryDays} {option.deliveryDays === 1 ? 'dia' : 'dias'}</small>}</div><div><strong>{money(optionTotal(option))}</strong>{option.quantity > 1 && <small>{money(option.unitPrice)} por unidade</small>}</div></li>)}</ul></> : <p className="text-sm text-slate-500">As opções de orçamento ainda não foram disponibilizadas neste acesso.</p>}
          {order.description && <details className="assistant-request-description"><summary>Descrição do pedido</summary><p>{order.description}</p></details>}
        </div>
      </div>
    </section>
    <section className="assistant-detail-block" aria-label="Arquivos do pedido"><div className="assistant-block-heading"><h3><span>2</span>Arquivos do pedido</h3><button className="assistant-text-action" disabled={busy} onClick={onAttach}><Paperclip size={17} />Adicionar</button></div>
      {files.length ? <Files grid files={files} load={loadFile} /> : <p className="assistant-block-empty">Nenhum arquivo anexado a este pedido.</p>}
    </section>
    <section className="assistant-detail-block" aria-label="Histórico do pedido"><div className="assistant-block-heading"><h3><span>3</span>Histórico</h3></div>{timeline}</section>
    {children}
  </section>;
}
