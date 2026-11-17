import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { catalogRequest } from '../catalog/client';
import { listingStatus, type ListingDetail } from '../../../shared/marketplaces/listings';
export type ListingAction = 'edit' | 'publish' | 'unpublish';
const names = { edit: 'Editar anúncio', publish: 'Publicar anúncio', unpublish: 'Despublicar anúncio' };
export function MarketplaceListingEditor({ user, tenant, id, action, onBack, onSaved }: {
  user: { getIdToken(): Promise<string> }; tenant: string; id: string; action: ListingAction; onBack(): void; onSaved(): void;
}) {
  const [detail, setDetail] = useState<ListingDetail | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(true), [reload, setReload] = useState(0), [mustReload, setMustReload] = useState(false);
  const [title, setTitle] = useState(''), [price, setPrice] = useState(''), [review, setReview] = useState(false);
  const live = useRef(true), saving = useRef(false);
  const path = `/api/tenants/${encodeURIComponent(tenant)}/marketplace-listings/${encodeURIComponent(id)}`;
  useEffect(() => {
    live.current = true; let current = true; setBusy(true); setError(''); setReview(false); setDetail(null);
    catalogRequest(user, path).then((result: ListingDetail) => {
      if (!current) return; setDetail(result); setTitle(result.listing.title); setPrice(result.listing.price?.toFixed(2).replace('.', ',') || ''); setMustReload(false);
    }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; live.current = false; };
  }, [user, path, reload]);
  const number = /^(?:\d+)(?:[.,]\d{1,2})?$/.test(price.trim()) ? Number(price.trim().replace(',', '.')) : NaN;
  const changes: Record<string, unknown> = {};
  if (detail?.capabilities.title && title.trim() !== detail.listing.title) changes.title = title.trim();
  if (detail?.capabilities.price && number !== detail.listing.price) changes.price = number;
  const valid = !!detail && (action !== 'edit' ? detail.capabilities[action] :
    Object.keys(changes).length > 0 && (!('title' in changes) || (title.trim().length > 0 && title.trim().length <= 60)) &&
    (!('price' in changes) || (Number.isFinite(number) && number > 0 && number <= 99999999)));
  async function submit() {
    if (!valid || !detail || saving.current || mustReload) return;
    saving.current = true; setBusy(true); setError('');
    try {
      await catalogRequest(user, path + '/actions', { requestId: crypto.randomUUID(), revision: detail.revision, action, ...(action === 'edit' ? { changes } : {}) });
      if (live.current) onSaved();
    } catch (e) { if (live.current) { setError(e instanceof Error ? e.message : 'Não foi possível confirmar.'); setMustReload(true); setReview(false); } }
    finally { saving.current = false; if (live.current) setBusy(false); }
  }
  return <section className="max-w-3xl mx-auto space-y-5" aria-label={names[action]}>
    <button disabled={busy && !!detail} onClick={onBack} className="flex items-center gap-2 text-sm disabled:opacity-50"><ArrowLeft className="w-4 h-4" />Voltar aos anúncios</button>
    <h2 className="text-2xl font-bold">{names[action]}</h2>
    {busy && !detail && <p role="status">Consultando dados atuais do Mercado Livre…</p>}
    {error && <div role="alert" className="rounded-xl p-4 bg-amber-50 text-amber-950">{error}</div>}
    {!busy && (!detail || mustReload) && <button className="border rounded-lg px-4 py-2" onClick={() => setReload(n => n + 1)}>Reabrir e conferir anúncio</button>}
    {detail && <div className="bg-white border rounded-2xl p-5 space-y-5">
      <div className="flex gap-4 items-start">{detail.listing.thumbnail && <img src={detail.listing.thumbnail} alt="" referrerPolicy="no-referrer" className="w-20 h-20 object-contain" />}<div><h3 className="font-bold">{detail.listing.title}</h3><p className="text-sm text-slate-500">Mercado Livre · {id} · {listingStatus[detail.listing.status] || detail.listing.status}</p></div></div>
      {action === 'edit' ? <fieldset disabled={busy || mustReload || review} className="space-y-4">
        <label className="block text-sm font-medium">Título<input aria-label="Título" value={title} maxLength={60} disabled={!detail.capabilities.title} onChange={e => setTitle(e.target.value)} className="block w-full mt-1 border rounded-lg p-3 disabled:bg-slate-100" /></label>
        {detail.capabilities.titleReason && <p className="text-xs text-slate-500">{detail.capabilities.titleReason}</p>}
        <label className="block text-sm font-medium">Preço ({detail.listing.currency})<input aria-label="Preço" inputMode="decimal" value={price} disabled={!detail.capabilities.price} onChange={e => setPrice(e.target.value)} className="block w-full mt-1 border rounded-lg p-3 disabled:bg-slate-100" /></label>
        {detail.capabilities.priceReason && <p className="text-xs text-slate-500">{detail.capabilities.priceReason}</p>}
        <p className="text-sm text-slate-600">Quantidade no canal: {detail.listing.quantity ?? 'indisponível'}. A edição de estoque por depósito e variação ainda é feita no Mercado Livre.</p>
      </fieldset> : <p>{action === 'unpublish' ? 'O anúncio será pausado no Mercado Livre e deixará de receber novas vendas. Você poderá publicá-lo novamente depois.' : 'O anúncio será reativado no Mercado Livre, com o preço e a quantidade atuais.'}</p>}
      {action !== 'edit' && !valid && <p role="status" className="text-amber-800">{action === 'publish' ? 'Publicação disponível somente para anúncios pausados com estoque. Anúncios encerrados precisam ser republicados pelo Mercado Livre.' : 'Despublicação disponível somente para anúncios ativos.'}</p>}
      {review && action === 'edit' && <div className="bg-slate-50 border rounded-xl p-4 space-y-2"><p className="font-semibold">Confira antes de salvar no Mercado Livre:</p>{'title' in changes && <p>Título: {detail.listing.title} → {String(changes.title)}</p>}{'price' in changes && <p>Preço: {detail.listing.price?.toFixed(2)} → {number.toFixed(2)} {detail.listing.currency}</p>}</div>}
      <div className="flex flex-wrap gap-3">
        {action === 'edit' && !review ? <button disabled={!valid || busy || mustReload} onClick={() => setReview(true)} className="bg-indigo-700 text-white rounded-xl px-4 py-3 disabled:opacity-40">Revisar alterações</button> : <button disabled={!valid || busy || mustReload} onClick={submit} className="bg-indigo-700 text-white rounded-xl px-4 py-3 disabled:opacity-40">{busy ? 'Confirmando…' : action === 'edit' ? 'Confirmar e salvar' : action === 'publish' ? 'Confirmar publicação' : 'Confirmar despublicação'}</button>}
        {review && <button disabled={busy} onClick={() => setReview(false)} className="border rounded-xl px-4 py-3">Voltar à edição</button>}
        {detail.listing.url && <a href={detail.listing.url} target="_blank" rel="noopener noreferrer" className="text-sm underline px-2 py-3">Abrir no Mercado Livre</a>}
      </div>
    </div>}
  </section>;
}
