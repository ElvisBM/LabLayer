import React, { useState } from 'react';
import { formatCustomerQuote, type CustomerQuote as Quote } from '../../../shared/requests/quote';
export function CustomerQuotePreview({ quote, image }: { quote?: Quote | null; image?: React.ReactNode }) {
  const [notice, setNotice] = useState('');
  const text = quote ? formatCustomerQuote(quote) : '';
  if (!text) return null;
  return <section aria-label="Orçamento para o cliente" className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-sm space-y-3 font-normal text-slate-900 min-w-0">
    {image}
    <p className="whitespace-pre-wrap break-words">{text}</p>
    <button type="button" className="min-h-11 rounded-lg border border-indigo-300 bg-white px-3 font-semibold text-indigo-700" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setNotice('Orçamento copiado!'); }
      catch { setNotice('Não foi possível copiar. Selecione o texto acima e copie manualmente.'); }
    }}>Copiar orçamento</button>
    {notice && <p role="status" className="text-xs">{notice}</p>}
  </section>;
}
export function CustomerQuoteEditor({ quote, onChange }: { quote: Quote | null; onChange: (q: Quote | null) => void }) {
  const input = 'block w-full rounded border p-2 bg-white text-slate-900';
  if (!quote) return <button type="button" className="min-h-11 text-primary font-semibold" onClick={() => onChange({ name: '', size: '', options: [{quantity:1,unitPrice:0,deliveryDays:null}] })}>Adicionar opções de orçamento para o cliente</button>;
  return <section className="rounded-xl border p-4 space-y-3">
    <h3 className="font-bold">Orçamento para enviar ao cliente</h3>
    <label className="block">Nome do produto<input className={input} required maxLength={150} value={quote.name} onChange={e => onChange({...quote,name:e.target.value})} /></label>
    <label className="block">Tamanho / dimensões (opcional)<input className={input} maxLength={250} value={quote.size} onChange={e => onChange({...quote,size:e.target.value})} /></label>
    <p className="text-sm">Cada opção é uma quantidade exata. O total do pedido usa a opção correspondente à quantidade pedida. Peso e horas são internos.</p>
    {quote.options.map((option, i) => <fieldset key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-3 border rounded p-3">
      <legend>Opção {i+1}</legend>
      {([{ key:'quantity',label:'Quantidade',min:1,max:100000,step:1 },{key:'unitPrice',label:'Preço por unidade (R$)',min:0,max:1000000,step:0.01},{key:'deliveryDays',label:'Prazo de entrega (dias)',min:1,max:3650,step:1}] as const).map(f => <label key={f.key}>{f.label}<input className={input} type="number" required={f.key !== 'deliveryDays'} min={f.min} max={f.max} step={f.step} value={option[f.key] ?? ''} onChange={e => onChange({...quote,options:quote.options.map((o,j)=>j===i ? {...o,[f.key]:e.target.value === '' && f.key === 'deliveryDays' ? null : Number(e.target.value)} : o)})} /></label>)}
      {quote.options.length > 1 && <button type="button" onClick={() => onChange({...quote,options:quote.options.filter((_,j)=>j!==i)})}>Remover opção {i+1}</button>}
    </fieldset>)}
    {quote.options.length < 5 && <button type="button" className="min-h-11 text-primary" onClick={() => onChange({...quote,options:[...quote.options,{quantity:Math.max(...quote.options.map(o=>o.quantity))+1,unitPrice:0,deliveryDays:null}]})}>Adicionar opção por quantidade</button>}
    <CustomerQuotePreview quote={quote} />
    <button type="button" className="min-h-11 text-sm underline" onClick={() => onChange(null)}>Remover opções do orçamento</button>
  </section>;
}
