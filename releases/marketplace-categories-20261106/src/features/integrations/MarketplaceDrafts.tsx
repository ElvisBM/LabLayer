import { uploadDraftPhoto } from './draft-photo-upload';
import { useEffect, useRef, useState } from 'react';
import { catalogRequest } from '../catalog/client';
import { validPictureUrl, draftStatuses, type ListingDraft, type DraftInput, type DraftAttribute } from '../../../shared/marketplaces/drafts';
import { listingStatus } from '../../../shared/marketplaces/listings';
type User = { getIdToken(): Promise<string> };
type CategoryOption = { id: string; name: string; path: string };
type CategoryGroup = { id: string; label: string };
const field = 'block w-full rounded-xl border border-slate-300 bg-white p-3 mt-1';
const button = 'rounded-xl border px-4 py-3 font-medium disabled:opacity-50';
const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function MarketplaceDrafts({ user, tenant }: { user: User; tenant: string }) {
  const [rows, setRows] = useState<ListingDraft[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<ListingDraft | null>(null), [refresh, setRefresh] = useState(0);
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
  if (selected) return <DraftReview key={selected.id} initial={selected} user={user} base={base} canManage={manage} onBack={() => { setSelected(null); setRefresh(n=>n+1); }} />;
  return <section aria-label="Rascunhos de anúncios" className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-2xl font-bold">Rascunhos de anúncios</h2><p className="text-slate-600 mt-1">1. Envie pela integração · 2. Revise e aprove · 3. Publique no Mercado Livre</p></div>
      <button className={button} disabled={busy} onClick={() => setRefresh(n=>n+1)}>Atualizar rascunhos</button></div>
    {busy && <p role="status">Carregando rascunhos…</p>}
    {error && <p role="alert" className="bg-red-50 text-red-800 rounded-xl p-4">{error}</p>}
    {!busy && !error && !rows.length && <div className="bg-white border rounded-2xl p-8"><h3 className="font-semibold">Pronto para receber seus anúncios</h3><p className="text-slate-600 mt-2">Envie título, descrição, fotos e preço com sua chave de integração. Os rascunhos aparecerão aqui para revisão. O envio não publica no Mercado Livre.</p></div>}
    <div className="grid gap-4 md:grid-cols-2">{[...rows].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(d => <article key={d.id} className="bg-white rounded-2xl border p-5 space-y-3">
      <div className="flex gap-4">{d.data.pictures[0] && <img src={d.data.pictures[0]} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-20 h-20 object-contain rounded-lg bg-slate-50" />}
        <div className="min-w-0"><p className="text-xs text-slate-500 break-all">{d.data.externalId}</p><h3 className="font-semibold break-words">{d.data.title}</h3><p className="text-slate-600">{money(d.data.price)} · {d.data.quantity} unidade(s)</p></div></div>
      <p className={`inline-block rounded-full px-3 py-1 text-sm ${d.status === 'approved' || d.status === 'published' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>{draftStatuses[d.status]}</p>
      <button className={`${button} block w-full text-indigo-700`} onClick={() => setSelected(d)}>Revisar rascunho</button>
    </article>)}</div>
    {cursor && <button className={button} disabled={busy} onClick={more}>Carregar mais rascunhos</button>}
  </section>;
}
function AttributeFields({ label, values, onChange }: { label: string; values: DraftAttribute[]; onChange: (v: DraftAttribute[]) => void }) {
  return <fieldset className="space-y-3"><legend className="font-semibold">{label}</legend>
    {values.map((a,i) => <div key={i} className="flex flex-wrap gap-2 items-end">
      <label className="flex-1 min-w-32 text-sm">Código<input aria-label={`${label} código ${i+1}`} className={field} value={a.id} onChange={e => onChange(values.map((v,j)=>j===i?{...v,id:e.target.value}:v))} /></label>
      <label className="flex-1 min-w-32 text-sm">Valor<input aria-label={`${label} valor ${i+1}`} className={field} value={a.value_name ?? ''} onChange={e => onChange(values.map((v,j)=>j===i?{id:v.id,value_name:e.target.value}:v))} /></label>
      {a.value_id && <span className="text-xs text-slate-500 pb-3">ID: {a.value_id}</span>}
      <button type="button" className={button} onClick={()=>onChange(values.filter((_,j)=>j!==i))}>Remover</button>
    </div>)}
    <button type="button" className={`${button} text-indigo-700`} onClick={()=>onChange([...values,{id:'',value_name:''}])}>Adicionar {label.toLowerCase()}</button>
  </fieldset>;
}
function MarketplaceCategoryPicker({ user, base, value, onChange }: {
  user: User; base: string; value: string; onChange: (id: string) => void;
}) {
  const [group,setGroup] = useState('all'), [query,setQuery] = useState('');
  const [groups,setGroups] = useState<CategoryGroup[]>([]), [categories,setCategories] = useState<CategoryOption[]>([]);
  const [selected,setSelected] = useState<CategoryOption | null>(null), [busy,setBusy] = useState(false);
  const [error,setError] = useState(''), [loaded,setLoaded] = useState(false), [total,setTotal] = useState(0), [hasMore,setHasMore] = useState(false);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setBusy(true); setError('');
      const params = new URLSearchParams({ group, q: query, ...(value ? { id: value } : {}) });
      catalogRequest(user, `${base}/categories?${params.toString()}`)
        .then(result => {
          if (!alive) return;
          setGroups(result.groups || []); setCategories(result.categories || []); setSelected(result.selected || null);
          setTotal(result.total || 0); setHasMore(result.hasMore === true); setLoaded(true);
        })
        .catch(e => { if (alive) { setError((e as Error).message || 'Não foi possível carregar as categorias do Mercado Livre.'); setLoaded(true); } })
        .finally(() => { if (alive) setBusy(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [user,base,group,query,value]);
  const options = selected && !categories.some(category => category.id === selected.id) ? [selected,...categories] : categories;
  const selectedValue = value && (selected?.id === value || !loaded) ? value : '';
  return <div className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">Área do produto<select className={field} value={group} onChange={e=>setGroup(e.target.value)}>
        {(groups.length ? groups : [{id:'all',label:'Presentes, casa e utilidades'}]).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label className="block">Buscar categoria oficial<input className={field} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ex.: vela de Natal, chaveiro, vaso" /></label>
    </div>
    <label className="block">Categoria do Mercado Livre<select required className={field} value={selectedValue} onChange={e=>{const category=options.find(item=>item.id===e.target.value);if(category)setSelected(category);onChange(e.target.value);}}>
      <option value="">Selecione uma categoria válida</option>
      {options.map(category=><option key={category.id} value={category.id}>{category.path} · {category.id}</option>)}
    </select></label>
    <p className="text-xs text-slate-500">A categoria descreve o produto final; impressão 3D é o método de fabricação. A lista contém categorias oficiais disponíveis para anúncios no Brasil.</p>
    {busy && <p role="status" className="text-sm text-slate-500">Carregando categorias oficiais…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!error && loaded && value && !selected && <p role="alert" className="text-sm text-amber-800">O código atual ({value}) não existe na lista de categorias do Mercado Livre. Escolha uma opção válida.</p>}
    {!error && selected && selected.id === value && <p className="text-sm text-emerald-800">Categoria válida: {selected.path}</p>}
    {!query && loaded && total > 0 && <p className="text-xs text-slate-500">Sugestões: Natal, lembrancinhas, decoração, artesanato, miniaturas e utilidades.</p>}
    {query && loaded && !categories.length && !busy && <p className="text-sm text-slate-500">Nenhuma categoria encontrada. Tente um termo mais curto, como “vela”, “vaso” ou “suporte”.</p>}
    {hasMore && <p className="text-xs text-slate-500">Mostrando {categories.length} de {total} resultados; refine a busca para localizar a categoria certa.</p>}
  </div>;
}
function DraftReview({ initial, user, base, canManage, onBack }: { initial: ListingDraft; user: User; base: string; canManage: boolean; onBack: () => void }) {
  const [draft,setDraft] = useState(initial), [data,setData] = useState<DraftInput>(initial.data);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState(''), [confirm,setConfirm] = useState(false);
  const [photoStatus,setPhotoStatus] = useState('');
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (confirm) confirmRef.current?.focus(); }, [confirm]);
  const dirty = JSON.stringify(data) !== JSON.stringify(draft.data), editable = canManage && ['draft','approved'].includes(draft.status);
  const update = <K extends keyof DraftInput>(key: K,value: DraftInput[K]) => { setData(d => ({...d,[key]:value})); setConfirm(false); setNotice(''); };
  async function execute(action: 'save' | 'approve' | 'publish' | 'complete' | 'refresh') {
    setBusy(true); setError(''); setNotice('');
    try {
      const path = `${base}/${draft.id}`;
      const next = await catalogRequest(user, action === 'refresh' ? path : `${path}/${action === 'save' ? 'save' : 'actions'}`,
        action === 'refresh' ? undefined : action === 'save' ? { revision:draft.revision,data } : { action,revision:draft.revision });
      setDraft(next); setData(next.data); setConfirm(false);
      setNotice(action === 'save' ? 'Rascunho atualizado. Revise e aprove a nova versão.' : action === 'approve' ? 'Aprovado. O anúncio só será enviado quando você confirmar a publicação.' : action === 'refresh' ? 'Rascunho atualizado.' : 'Anúncio e descrição enviados ao Mercado Livre.');
    } catch (e) {
      setError((e as Error).message); setConfirm(false);
      if (action === 'publish' || action === 'complete') {
        try { const next = await catalogRequest(user,`${base}/${draft.id}`); setDraft(next); setData(next.data); } catch { /* Preserve the error and offer explicit refresh. */ }
      }
    } finally { setBusy(false); }
  }
  async function upload(files: File[]) {
    const existing = data.pictures.filter(p=>p.trim());
    if (!files.length) return;
    if (existing.length + files.length > 12) { setPhotoStatus('O anúncio pode ter até 12 fotos.'); return; }
    setBusy(true); setError(''); setNotice(''); setConfirm(false);
    const urls: string[] = [];
    try {
      for (let i=0;i<files.length;i++) {
        setPhotoStatus(`Enviando foto ${i+1} de ${files.length}…`);
        urls.push(await uploadDraftPhoto(user,base,files[i]));
      }
      setPhotoStatus('Upload concluído. Salve as alterações para anexar as fotos ao rascunho.');
      setNotice('Fotos enviadas à LabLayer. Clique em Salvar alterações para anexá-las ao rascunho.');
    } catch (e) {
      setPhotoStatus((e as Error).message);
      setError((e as Error).message);
      setNotice(urls.length ? `${urls.length} foto(s) enviada(s). Salve as alterações para manter essas fotos no rascunho.` : '');
    } finally {
      if (urls.length) setData(d=>({...d,pictures:[...new Set([...d.pictures.filter(p=>p.trim()),...urls])]}));
      setBusy(false);
    }
  }
  return <section className="bg-white border rounded-2xl p-5 sm:p-8 space-y-6" aria-label="Revisão do rascunho">
    <button className="text-indigo-700" disabled={busy} onClick={onBack}>← Voltar aos rascunhos</button>
    <div><p className="text-sm text-slate-500">{data.externalId} · Revisão {draft.revision}</p><h2 className="text-2xl font-bold mt-1">Revisar anúncio</h2><p className="mt-2 font-medium text-indigo-700">{draftStatuses[draft.status]}</p></div>
    {!canManage && <p className="text-slate-600">Somente administradores podem editar, aprovar e publicar.</p>}
    <fieldset disabled={!editable || busy} className="space-y-5 disabled:opacity-80">
      <label className="block">Título / nome do produto<input className={field} maxLength={60} value={data.title} onChange={e=>update('title',e.target.value)} /></label>
      <label className="block">Descrição<textarea className={field} rows={7} maxLength={5000} value={data.description} onChange={e=>update('description',e.target.value)} /></label>
      <div className="grid sm:grid-cols-3 gap-4">
        <label>Preço (R$)<input className={field} type="number" min="0" step="0.01" value={data.price} onChange={e=>update('price',Number(e.target.value))} /></label>
        <label>Quantidade disponível<input className={field} type="number" min="1" step="1" value={data.quantity} onChange={e=>update('quantity',Number(e.target.value))} /></label>
        <label>Condição<select className={field} value={data.condition} onChange={e=>update('condition',e.target.value as DraftInput['condition'])}><option value="new">Novo</option><option value="used">Usado</option></select></label>
      </div>
      <div className="grid gap-4"><MarketplaceCategoryPicker user={user} base={base} value={data.categoryId} onChange={id=>update('categoryId',id)} />
        <label>Tipo de anúncio<select className={field} value={data.listingTypeId} onChange={e=>update('listingTypeId',e.target.value as DraftInput['listingTypeId'])}><option value="gold_special">Clássico</option><option value="gold_pro">Premium</option></select></label></div>
      <div className="space-y-3"><p className="font-semibold">Fotos do anúncio</p>
        <label className="block">Enviar fotos do computador ou celular<input aria-label="Enviar fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple className={field}
          onChange={e=>{const files=Array.from(e.target.files || []);e.target.value='';void upload(files);}} /></label>
        <p className="text-sm text-slate-500">JPEG, PNG ou WebP, até 10 MiB por foto. Máximo de 12 fotos. A LabLayer hospeda as fotos e gera os links para o anúncio.</p>
        {photoStatus && <p aria-live="polite" className="text-sm text-indigo-700">{photoStatus}</p>}
        <div className="flex gap-3 overflow-x-auto">{data.pictures.map((src,i)=>validPictureUrl(src.trim()) && <div key={src+i} className="shrink-0 space-y-2">
          <img src={src} alt={`Foto ${i+1} do anúncio`} loading="lazy" referrerPolicy="no-referrer" className="h-36 w-36 object-contain rounded-xl border bg-slate-50" />
          <button type="button" className="text-sm text-red-700" onClick={()=>update('pictures',data.pictures.filter((_,j)=>j!==i))}>Remover foto {i+1}</button>
        </div>)}</div>
        <details><summary className="text-sm text-indigo-700 cursor-pointer">Usar links de fotos já hospedadas</summary>
          <label className="block text-sm mt-3">Links HTTPS das fotos (um por linha)<textarea className={field} rows={3} value={data.pictures.join('\n')} onChange={e=>update('pictures',e.target.value.split('\n'))} /></label>
        </details>
      </div>
      <details className="border rounded-xl p-4" open><summary className="cursor-pointer font-semibold">Características e entrega</summary><div className="space-y-5 mt-4">
        <AttributeFields label="Atributos" values={data.attributes} onChange={v=>update('attributes',v)} />
        <AttributeFields label="Condições de venda" values={data.saleTerms} onChange={v=>update('saleTerms',v)} />
        <label className="block">Entrega<select className={field} value={data.shipping.mode} onChange={e=>update('shipping',{...data.shipping,mode:e.target.value as DraftInput['shipping']['mode']})}><option value="me2">Mercado Envios</option><option value="not_specified">Combinar com o comprador</option></select></label>
        <label className="flex gap-2"><input type="checkbox" checked={data.shipping.local_pick_up} onChange={e=>update('shipping',{...data.shipping,local_pick_up:e.target.checked})} />Permitir retirada em mãos</label>
        <label className="flex gap-2"><input type="checkbox" checked={data.shipping.free_shipping} onChange={e=>update('shipping',{...data.shipping,free_shipping:e.target.checked})} />Oferecer frete grátis</label>
      </div></details>
    </fieldset>
    <div className="border-t pt-5 space-y-4">
      {dirty && <p className="text-amber-900">Há alterações não salvas. Salve para revisar e aprovar a nova versão.</p>}
      {draft.message && <p className="bg-slate-50 rounded-xl p-4">{draft.message}</p>}
      {draft.itemId && <div className="text-sm"><p>Mercado Livre: {draft.itemId} · {listingStatus[draft.remoteStatus || ''] || draft.remoteStatus || 'Em conferência'}</p>{draft.itemUrl && <a className="text-indigo-700 underline" href={draft.itemUrl} target="_blank" rel="noopener noreferrer">Ver anúncio no Mercado Livre</a>}</div>}
      {error && <p role="alert" className="bg-red-50 text-red-800 rounded-xl p-4">{error}</p>}
      {notice && <p role="status" className="bg-emerald-50 text-emerald-900 rounded-xl p-4">{notice}</p>}
      {busy && <p role="status">Aguarde a confirmação…</p>}
      <div className="flex flex-wrap gap-3">
        {editable && <button className={button} disabled={busy || !dirty} onClick={()=>execute('save')}>Salvar alterações</button>}
        {editable && draft.status === 'draft' && <button className={`${button} bg-indigo-700 text-white`} disabled={busy || dirty} onClick={()=>execute('approve')}>Validar e aprovar rascunho</button>}
        {canManage && draft.status === 'approved' && <button className={`${button} bg-indigo-700 text-white`} disabled={busy || dirty} onClick={()=>setConfirm(true)}>Publicar no Mercado Livre</button>}
        {canManage && ['attention','publishing'].includes(draft.status) && draft.itemId && <button className={`${button} bg-indigo-700 text-white`} disabled={busy} onClick={()=>execute('complete')}>Concluir publicação</button>}
        <button className={button} disabled={busy || dirty} onClick={()=>execute('refresh')}>Conferir atualização</button>
      </div>
      {confirm && !dirty && <div ref={confirmRef} tabIndex={-1} className="border border-indigo-200 bg-indigo-50 rounded-xl p-4 space-y-3" role="group" aria-label="Confirmar publicação">
        <p>Publicar <strong>{data.title}</strong> por <strong>{money(data.price)}</strong>, com {data.quantity} unidade(s), no Mercado Livre?</p>
        <p className="text-sm">O anúncio ficará disponível para venda conforme a análise do Mercado Livre. Aplicam-se as tarifas do tipo de anúncio e as condições de entrega selecionadas. O Mercado Livre poderá gerar o título a partir do nome e das características do produto.</p>
        <div className="flex flex-wrap gap-3"><button disabled={busy} className={`${button} bg-indigo-700 text-white`} onClick={()=>execute('publish')}>Confirmar publicação</button><button disabled={busy} className={button} onClick={()=>setConfirm(false)}>Voltar à revisão</button></div>
      </div>}
    </div>
  </section>;
}
