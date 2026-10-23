import { useEffect, useState } from 'react';
import { ExternalLink, Megaphone, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';
import { listingStatus, platformNames, type ListingResult, type Platform } from '../../../shared/marketplaces/listings';

const badges: Record<Platform, string> = {
  mercadolivre: 'bg-yellow-100 text-yellow-950 border-yellow-200',
  shopee: 'bg-orange-100 text-orange-900 border-orange-200',
  tiktok: 'bg-slate-900 text-white border-pink-400',
};
function PlatformTag({ platform }: { platform: Platform }) {
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${badges[platform]}`}>{platformNames[platform]}</span>;
}
const money = (price: number | null, currency: string) => price === null ? 'Preço indisponível' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(price);

export function MarketplaceListings() {
  const { user, tenantId } = useAuth();
  if (!user || !tenantId) return <p>Selecione uma empresa para consultar os anúncios.</p>;
  return <Listings key={`${user.uid}:${tenantId}`} user={user} tenant={tenantId} />;
}
function Listings({ user, tenant }: { user: { getIdToken(): Promise<string> }; tenant: string }) {
  const [data, setData] = useState<ListingResult | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('all'), [status, setStatus] = useState('all'), [page, setPage] = useState(1);
  useEffect(() => {
    let alive = true;
    setBusy(true); setError('');
    catalogRequest(user, `/api/tenants/${encodeURIComponent(tenant)}/marketplace-listings${refresh ? '?refresh=1' : ''}`)
      .then(result => { if (alive) { setData(result); setPage(1); } })
      .catch(err => { if (alive) { setData(null); setError(err instanceof Error ? err.message : 'Não foi possível consultar os anúncios.'); } })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [user, tenant, refresh]);
  const clean = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rows = (data?.listings || []).filter(item => (platform === 'all' || item.platform === platform) &&
    (status === 'all' || item.status === status) && clean(`${item.title} ${item.id}`).includes(clean(search)));
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const currentPage = Math.min(page, pages);
  const unavailable = platform === 'shopee' || platform === 'tiktok';
  return <section className="space-y-6" aria-label="Anúncios nas plataformas">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="w-6 h-6" />Anúncios</h2>
        <p className="text-sm text-slate-600 mt-1">Acompanhe os anúncios e a quantidade disponível em cada canal.</p></div>
      <button disabled={busy} onClick={() => setRefresh(n => n + 1)} className="inline-flex items-center gap-2 bg-white border rounded-xl px-4 py-2 disabled:opacity-50">
        <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Consultando…' : 'Atualizar anúncios'}</button>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {(Object.keys(platformNames) as Platform[]).map(key => <div key={key} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <PlatformTag platform={key} />
        <p className="text-sm text-slate-600">{key !== 'mercadolivre' ? 'Integração pendente' : data ? `${data.total} anúncios na conta · ${data.listings.filter(i => i.status === 'active').length} ativos${data.complete ? '' : ' na amostra'}` : busy ? 'Consultando conta…' : 'Consulta indisponível'}</p>
        {key === 'mercadolivre' && data && <p className="text-xs text-slate-500 break-all">Conta: {data.seller}</p>}
      </div>)}
    </div>
    <div className="flex flex-col md:flex-row gap-3">
      <label className="flex items-center gap-2 bg-white border rounded-xl px-3 flex-1"><Search className="w-4 h-4 text-slate-400" /><input aria-label="Buscar anúncio" placeholder="Buscar por título ou código do anúncio" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="py-3 w-full bg-transparent outline-none" /></label>
      <label className="text-sm">Plataforma<select aria-label="Plataforma" value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }} className="block w-full border rounded-xl bg-white p-2.5"><option value="all">Todas as plataformas</option>{Object.entries(platformNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="text-sm">Status<select aria-label="Status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="block w-full border rounded-xl bg-white p-2.5"><option value="all">Todos os status</option>{[...new Set([...Object.keys(listingStatus), ...(data?.listings.map(i => i.status) || [])])].map(id => <option key={id} value={id}>{listingStatus[id] || id}</option>)}</select></label>
    </div>
    {error && <div role="alert" className="bg-amber-50 text-amber-950 p-4 rounded-xl">{error} <a href="/?view=configuracoes" className="underline">Abrir Configurações</a></div>}
    {data && <div className="text-xs text-slate-500 space-y-1"><p>Atualizado em {new Date(data.fetchedAt).toLocaleString('pt-BR')}. Quantidade informada pela plataforma; não representa o estoque consolidado do LabLayer.</p>
      {!data.complete && <p role="status" className="text-amber-800">Consulta parcial: {data.listings.length} de {data.total} anúncios. Os filtros e a contagem de ativos consideram apenas os anúncios carregados.</p>}</div>}
    {unavailable ? <p className="rounded-xl bg-white border p-6">{platformNames[platform as Platform]} ainda não está integrado. Os anúncios aparecerão aqui após a conexão dessa plataforma.</p> : <>
      {busy && !data && <p role="status">Carregando anúncios do Mercado Livre…</p>}
      {!busy && data && rows.length === 0 && <p className="bg-white border rounded-xl p-6">Nenhum anúncio encontrado com os filtros selecionados.</p>}
      <div className="space-y-3" aria-busy={busy}>
        {rows.slice((currentPage - 1) * 25, currentPage * 25).map(item => <article key={`${item.platform}:${item.id}`} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-4">
          {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-20 h-20 object-contain rounded-lg bg-slate-50 shrink-0" /> : <div className="w-20 h-20 bg-slate-50 rounded-lg flex items-center justify-center shrink-0"><Megaphone className="text-slate-300" /></div>}
          <div className="flex-1 min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><PlatformTag platform={item.platform} /><span className={`text-xs rounded-full px-3 py-1 ${item.status === 'active' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>{listingStatus[item.status] || item.status}</span></div>
            <h3 className="font-semibold break-words">{item.title}</h3><p className="text-xs text-slate-500">{item.id}</p>
            {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-700 inline-flex gap-1 items-center">Ver anúncio <ExternalLink className="w-3.5 h-3.5" /></a>}
          </div>
          <div className="sm:text-right shrink-0"><p className="font-bold text-lg">{money(item.price, item.currency)}</p><p className="text-sm text-slate-600">Quantidade no canal: {item.quantity ?? 'indisponível'}</p></div>
        </article>)}
      </div>
      {data && rows.length > 0 && <nav aria-label="Paginação dos anúncios" className="flex flex-wrap justify-between items-center gap-3 text-sm"><span>{rows.length} anúncios encontrados · Página {currentPage} de {pages}</span><div className="flex gap-2"><button className="border rounded-lg px-4 py-2 disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="border rounded-lg px-4 py-2 disabled:opacity-40" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Próxima</button></div></nav>}
    </>}
  </section>;
}
