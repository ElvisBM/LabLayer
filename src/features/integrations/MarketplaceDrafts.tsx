import { useEffect, useState } from 'react';
import { catalogRequest } from '../catalog/client';
import { draftStatuses, type ListingDraft } from '../../../shared/marketplaces/drafts';
import { DraftReview, money } from './DraftReview';
type User = { getIdToken(): Promise<string> };
const button = 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50';
const solid = (color: 'indigo' | 'emerald') => `rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${color === 'indigo' ? 'bg-indigo-700 hover:bg-indigo-800' : 'bg-emerald-700 hover:bg-emerald-800'}`;
export function MarketplaceDrafts({ user, tenant }: { user: User; tenant: string }) {
  const [rows, setRows] = useState<ListingDraft[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<ListingDraft | null>(null), [refresh, setRefresh] = useState(0);
  const [working, setWorking] = useState<string | null>(null), [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, { error?: string; notice?: string }>>({});
  const base = `/api/tenants/${encodeURIComponent(tenant)}/listing-drafts`;
  useEffect(() => {
    let alive = true; setBusy(true); setError('');
    catalogRequest(user,base).then(r => { if (alive) { setRows(r.drafts); setCursor(r.nextCursor); setManage(r.canManage); } })
      .catch(e => { if (alive) { setRows([]); setError(e.message); } }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [user,base,refresh]);
  async function more() {
    setBusy(true); setError('');
    try { const r = await catalogRequest(user,`${base}?after=${cursor}`); setRows(old => [...old,...r.drafts]); setCursor(r.nextCursor); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  // Mesma rota da tela de revisão: o servidor valida no Mercado Livre e exige administrador logado.
  async function quick(d: ListingDraft, action: 'approve' | 'publish') {
    setWorking(d.id); setConfirmPublish(null); setFeedback(f => ({ ...f, [d.id]: {} }));
    const replace = (next: ListingDraft) => setRows(old => old.map(row => row.id === next.id ? next : row));
    try {
      const next: ListingDraft = await catalogRequest(user, `${base}/${d.id}/actions`, { action, revision: d.revision });
      replace(next);
      setFeedback(f => ({ ...f, [d.id]: { notice: action === 'approve'
        ? (next.message ? `Aprovado. ${next.message}` : 'Aprovado. Confira e clique em Publicar.')
        : `Publicado no Mercado Livre${next.itemId ? ` (${next.itemId})` : ''}.` } }));
    } catch (e) {
      setFeedback(f => ({ ...f, [d.id]: { error: (e as Error).message } }));
      try { replace(await catalogRequest(user, `${base}/${d.id}`)); } catch { /* Mantém o erro; o botão Atualizar recarrega. */ }
    } finally { setWorking(null); }
  }
  if (selected) return <DraftReview key={selected.id} initial={selected} user={user} base={base} canManage={manage} onBack={() => { setSelected(null); setRefresh(n=>n+1); }} />;
  return <section aria-label="Rascunhos de anúncios" className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-900">Rascunhos de anúncios</h2><p className="text-sm text-slate-500 mt-1">1. Envie pela integração · 2. Revise e aprove · 3. Publique no Mercado Livre</p></div>
      <button className={button} disabled={busy} onClick={() => setRefresh(n=>n+1)}>Atualizar rascunhos</button></div>
    {busy && <p role="status">Carregando rascunhos…</p>}
    {error && <p role="alert" className="bg-red-50 text-red-800 rounded-xl p-4">{error}</p>}
    {!busy && !error && !rows.length && <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-8"><h3 className="font-semibold">Pronto para receber seus anúncios</h3><p className="text-slate-600 mt-2">Envie título, descrição, fotos e preço com sua chave de integração. Os rascunhos aparecerão aqui para revisão. O envio não publica no Mercado Livre.</p></div>}
    <div className="grid gap-4 md:grid-cols-2">{[...rows].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(d => <article key={d.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
      <div className="flex gap-4">{d.data.pictures[0] && <img src={d.data.pictures[0]} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-20 h-20 object-contain rounded-lg bg-slate-50" />}
        <div className="min-w-0"><p className="text-xs text-slate-500 break-all">{d.data.externalId}</p><h3 className="font-semibold break-words">{d.data.title}</h3><p className="text-slate-600">{money(d.data.price)} · {d.data.quantity} unidade(s)</p></div></div>
      <p className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${d.status === 'approved' || d.status === 'published' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>{draftStatuses[d.status]}</p>
      {feedback[d.id]?.error && <p role="alert" className="bg-red-50 text-red-800 rounded-lg p-3 text-sm break-words">{feedback[d.id].error}</p>}
      {feedback[d.id]?.notice && <p role="status" className="bg-emerald-50 text-emerald-800 rounded-lg p-3 text-sm break-words">{feedback[d.id].notice}</p>}
      {manage && d.status === 'draft' && <button className={`${solid('indigo')} block w-full`} disabled={working !== null} onClick={() => quick(d, 'approve')}>{working === d.id ? 'Validando no Mercado Livre…' : 'Aprovar'}</button>}
      {manage && d.status === 'approved' && (confirmPublish === d.id
        ? <div className="flex gap-2"><button className={`${solid('emerald')} flex-1`} disabled={working !== null} onClick={() => quick(d, 'publish')}>{working === d.id ? 'Publicando…' : 'Confirmar publicação'}</button><button className={button} disabled={working !== null} onClick={() => setConfirmPublish(null)}>Cancelar</button></div>
        : <button className={`${solid('emerald')} block w-full`} disabled={working !== null} onClick={() => setConfirmPublish(d.id)}>Publicar</button>)}
      <button className={`${button} block w-full text-indigo-700`} disabled={working === d.id} onClick={() => setSelected(d)}>Revisar rascunho</button>
    </article>)}</div>
    {cursor && <button className={button} disabled={busy} onClick={more}>Carregar mais rascunhos</button>}
  </section>;
}
