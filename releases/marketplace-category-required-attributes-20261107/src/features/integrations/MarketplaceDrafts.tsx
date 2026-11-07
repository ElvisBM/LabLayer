import { uploadDraftPhoto } from './draft-photo-upload';
import { useEffect, useRef, useState } from 'react';
import { catalogRequest } from '../catalog/client';
import { validPictureUrl, draftStatuses, type ListingDraft, type DraftInput, type DraftAttribute } from '../../../shared/marketplaces/drafts';
import { listingStatus } from '../../../shared/marketplaces/listings';
type User = { getIdToken(): Promise<string> };
type CategoryOption = { id: string; name: string; path: string };
type CategoryGroup = { id: string; label: string };
type CategoryAttribute = { id: string; name: string; valueType: string; maxLength: number; hint: string; values: { id: string; name: string }[] };
type CostEstimate = { price: number; saleFee: number; listingFee: number; shippingCost: number | null; net: number | null; netPercent: number | null; listingTypeName: string; shippingMessage: string };
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
function AttributeFields({ label, values, onChange, hiddenIds = new Set<string>() }: { label: string; values: DraftAttribute[]; onChange: (v: DraftAttribute[]) => void; hiddenIds?: Set<string> }) {
  const visible = values.map((value,index)=>({value,index})).filter(({value})=>!hiddenIds.has(value.id));
  return <fieldset className="space-y-3"><legend className="font-semibold">{label}</legend>
    <p className="text-sm text-slate-600">Os atributos obrigatórios da categoria são preenchidos no campo acima.</p>
    {visible.map(({value:a,index:i}) => <div key={i} className="flex flex-wrap gap-2 items-end">
      <label className="flex-1 min-w-32 text-sm">Código<input aria-label={`${label} código ${i+1}`} className={field} value={a.id} onChange={e => onChange(values.map((v,j)=>j===i?{...v,id:e.target.value}:v))} /></label>
      <label className="flex-1 min-w-32 text-sm">Valor<input aria-label={`${label} valor ${i+1}`} className={field} value={a.value_name ?? ''} onChange={e => onChange(values.map((v,j)=>j===i?{id:v.id,value_name:e.target.value}:v))} /></label>
      {a.value_id && <span className="text-xs text-slate-500 pb-3">ID: {a.value_id}</span>}
      <button type="button" className={button} onClick={()=>onChange(values.filter((_,j)=>j!==i))}>Remover</button>
    </div>)}
    <button type="button" className={`${button} text-indigo-700`} onClick={()=>onChange([...values,{id:'',value_name:''}])}>Adicionar {label.toLowerCase()}</button>
  </fieldset>;
}
function CategoryRequiredAttributes({ categoryId, condition, attributes, loading, error, values, onChange }: {
  categoryId: string; condition: DraftInput['condition']; attributes: CategoryAttribute[]; loading: boolean; error: string;
  values: DraftAttribute[]; onChange: (id: string, value?: Pick<DraftAttribute,'value_id'|'value_name'>) => void;
}) {
  if (!categoryId) return <p className="text-sm text-slate-600">Selecione uma categoria para ver os atributos obrigatórios do Mercado Livre.</p>;
  if (loading) return <p role="status" className="text-sm text-slate-600">Conferindo os atributos obrigatórios desta categoria…</p>;
  if (error) return <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error} A validação do Mercado Livre ainda poderá solicitar outros campos.</p>;
  if (!attributes.length) return <p className="text-sm text-slate-600">Nenhum atributo obrigatório extra foi informado para esta categoria.</p>;
  return <div className="space-y-3">
    {attributes.map(attribute=>{
      const current = values.find(value=>value.id===attribute.id);
      const suggestionsId = `category-attribute-${categoryId}-${attribute.id}`;
      const currentName = current?.value_name ?? attribute.values.find(value=>value.id===current?.value_id)?.name ?? '';
      const update = (name: string) => {
        if (!name.trim()) { onChange(attribute.id); return; }
        const selected = attribute.values.find(value=>value.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase());
        onChange(attribute.id, selected ? {value_id:selected.id,value_name:selected.name} : {value_name:name});
      };
      return <label key={attribute.id} className="block font-medium">{attribute.name} <span className="text-red-700" aria-hidden="true">*</span>
        {attribute.values.length > 0 && <datalist id={suggestionsId}>{attribute.values.map(value=><option key={value.id} value={value.name} />)}</datalist>}
        <input required aria-required="true" list={attribute.values.length ? suggestionsId : undefined} aria-label={`${attribute.name} (obrigatório)`} className={field}
          maxLength={attribute.maxLength} value={currentName} onChange={event=>update(event.target.value)} placeholder={attribute.valueType==='string' ? `Informe ${attribute.name.toLocaleLowerCase()}` : 'Selecione ou digite um valor'} />
        {attribute.hint && <span className="mt-1 block text-xs font-normal text-slate-600">{attribute.hint}</span>}
      </label>;
    })}
    <p className="text-xs text-slate-600">O Mercado Livre exige esses dados para publicar nesta categoria.</p>
  </div>;
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
    <div className="space-y-3">
      <label className="block">Área do produto<select className={field} value={group} onChange={e=>setGroup(e.target.value)}>
        {(groups.length ? groups : [{id:'all',label:'Presentes, casa e utilidades'}]).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label className="block font-medium">Buscar na lista de categorias do Mercado Livre<input aria-label="Buscar na lista de categorias do Mercado Livre" className={field} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Digite o produto: vela, chaveiro, vaso…" /></label>
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
function ListingCostEstimate({ user, base, price, editable, onPriceChange, categoryId, listingTypeId, shippingMode, freeShipping, logisticType, onLogisticTypeChange, logistics, condition }: {
  user: User; base: string; price: number; categoryId: string; listingTypeId: DraftInput['listingTypeId'];
  editable: boolean; onPriceChange: (value: number) => void; shippingMode: DraftInput['shipping']['mode']; freeShipping: boolean;
  logisticType: string; onLogisticTypeChange: (value: string) => void; logistics: string[]; condition: DraftInput['condition'];
}) {
  const [packageSize,setPackageSize] = useState({height:'',width:'',length:'',weight:''});
  const [simulationPrice,setSimulationPrice] = useState(price);
  const [estimate,setEstimate] = useState<CostEstimate | null>(null), [loading,setLoading] = useState(false), [error,setError] = useState('');
  const needsShippingQuote = shippingMode === 'me2' && freeShipping;
  const effectivePrice = editable ? price : simulationPrice;
  const effectiveLogisticType = shippingMode === 'me1' ? 'default' : shippingMode === 'custom' ? 'custom' : shippingMode === 'not_specified' ? 'not_specified' : logisticType;
  useEffect(() => { if (!editable) setSimulationPrice(price); }, [price,editable]);
  useEffect(() => {
    let alive = true;
    if (!categoryId || !Number.isFinite(effectivePrice) || effectivePrice <= 0) { setEstimate(null); setLoading(false); setError(''); return; }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ price:String(effectivePrice), categoryId, listingTypeId, shippingMode, freeShipping:String(freeShipping), logisticType:effectiveLogisticType, condition });
      if (packageSize.height && packageSize.width && packageSize.length && packageSize.weight)
        for (const key of ['height','width','length','weight'] as const) params.set(key, packageSize[key]);
      setLoading(true); setError(''); setEstimate(null);
      catalogRequest(user,`${base}/cost-estimate?${params.toString()}`).then((result: CostEstimate) => { if (alive) setEstimate(result); })
        .catch(e => { if (alive) setError((e as Error).message || 'Não foi possível calcular as tarifas agora.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, 450);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [user,base,effectivePrice,categoryId,listingTypeId,shippingMode,freeShipping,effectiveLogisticType,packageSize,condition]);
  const logisticOptions = logistics.length ? logistics : logisticType ? [logisticType] : [];
  const logisticLabels: Record<string,string> = { drop_off:'Agências / pontos de despacho', cross_docking:'Coleta do Mercado Livre', xd_drop_off:'Places', self_service:'Mercado Envios Flex', fulfillment:'Full', default:'Logística própria (ME1)' };
  return <section className="sm:col-span-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 sm:p-5 space-y-4" aria-label="Estimativa do valor líquido do anúncio">
    <div><h3 className="font-semibold text-slate-900">Quanto você recebe por unidade</h3>
      <p className="text-sm text-slate-600 mt-1">Cálculo com as tarifas atuais do Mercado Livre para a categoria e o tipo de anúncio selecionados.</p></div>
    <label className="block max-w-xs">{editable ? 'Preço do anúncio (R$)' : 'Simular preço de venda (R$)'}<input className={field} aria-label={editable ? 'Preço do anúncio (R$)' : 'Simular preço de venda (R$)'} type="number" min="0" step="0.01" value={editable ? price : simulationPrice} onChange={e=>editable ? onPriceChange(Number(e.target.value)) : setSimulationPrice(Number(e.target.value))} /></label>
    {!editable && <p className="text-sm text-slate-600">Simulação local para conferir o valor líquido; não altera o anúncio publicado.</p>}
    {!categoryId && !loading && <p className="text-sm text-slate-600">Selecione uma categoria válida para consultar a tarifa de venda.</p>}
    {categoryId && effectivePrice <= 0 && !loading && <p className="text-sm text-slate-600">Informe o preço do anúncio para calcular o valor líquido.</p>}
    {loading && <p role="status" className="text-sm text-slate-600">Consultando tarifas do Mercado Livre…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {estimate && <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="space-y-2 text-sm">
        <div className="flex justify-between gap-4"><span>Preço do anúncio</span><strong>{money(estimate.price)}</strong></div>
        <div className="flex justify-between gap-4"><span>Tarifa de venda · {estimate.listingTypeName || (listingTypeId === 'gold_pro' ? 'Premium' : 'Clássico')}</span><strong>−{money(estimate.saleFee)}</strong></div>
        {estimate.listingFee > 0 && <div className="flex justify-between gap-4"><span>Tarifa de publicação · uma vez</span><strong>{money(estimate.listingFee)}</strong></div>}
        <div className="flex justify-between gap-4"><span>Custo de envio pago por você</span><strong>{estimate.shippingCost === null ? 'Aguardando medidas' : estimate.shippingCost ? `−${money(estimate.shippingCost)}` : money(0)}</strong></div>
        {estimate.listingFee > 0 && <p className="text-xs text-slate-500">A tarifa de publicação é mostrada à parte e não foi subtraída do valor por unidade.</p>}
      </div>
      <div className="rounded-xl border border-emerald-200 bg-white px-5 py-4 text-center sm:min-w-52">
        <p className="text-sm text-slate-600">Você recebe, estimado</p>
        <p className="text-2xl font-bold text-emerald-800">{estimate.net === null ? '—' : money(estimate.net)}</p>
        {estimate.netPercent !== null && <p className="text-sm text-slate-500">{estimate.netPercent.toLocaleString('pt-BR',{maximumFractionDigits:2})}% do preço</p>}
      </div>
      {estimate.shippingMessage && <p className="sm:col-span-2 text-sm text-amber-800">{estimate.shippingMessage}</p>}
      {shippingMode !== 'me2' && <p className="sm:col-span-2 text-xs text-slate-500">O líquido não desconta eventuais custos de entrega própria ou personalizada.</p>}
      {shippingMode === 'me2' && !freeShipping && <p className="sm:col-span-2 text-xs text-slate-500">Frete grátis não selecionado. Se o Mercado Livre exigir frete grátis para esta categoria e preço, o valor líquido será menor.</p>}
    </div>}
    {needsShippingQuote && <details open className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <summary className="cursor-pointer font-medium">Calcular meu custo de envio</summary>
      <p className="text-sm text-slate-600">Informe as medidas da embalagem pronta para despacho. O Mercado Livre estima o custo do frete grátis conforme o preço e sua logística.</p>
      {logisticOptions.length > 1 && <label className="block text-sm">Tipo de logística<select aria-label="Tipo de logística para cálculo do frete" className={field} value={logisticType} onChange={e=>onLogisticTypeChange(e.target.value)}>
        {logisticOptions.map(option=><option key={option} value={option}>{logisticLabels[option] || option}</option>)}
      </select></label>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([['height','Altura (cm)'],['width','Largura (cm)'],['length','Comprimento (cm)'],['weight','Peso (g)']] as const).map(([key,label])=><label key={key} className="text-sm">{label}<input aria-label={label} className={field} type="number" min="1" max={key==='weight'?'30000':'1050'} step="1" value={packageSize[key]} onChange={e=>setPackageSize(v=>({...v,[key]:e.target.value}))} /></label>)}
      </div>
    </details>}
    <p className="text-xs text-slate-500">Estimativa por unidade, sujeita a mudanças nas tarifas, subsídios e condições do Mercado Livre. O valor final aparece após a venda.</p>
  </section>;
}
function DraftReview({ initial, user, base, canManage, onBack }: { initial: ListingDraft; user: User; base: string; canManage: boolean; onBack: () => void }) {
  const [draft,setDraft] = useState(initial), [data,setData] = useState<DraftInput>(initial.data);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState(''), [confirm,setConfirm] = useState(false);
  const [photoStatus,setPhotoStatus] = useState('');
  const [categoryAttributes,setCategoryAttributes] = useState<CategoryAttribute[]>([]), [categoryAttributesLoading,setCategoryAttributesLoading] = useState(false), [categoryAttributesError,setCategoryAttributesError] = useState('');
  const [shippingModes,setShippingModes] = useState<DraftInput['shipping']['mode'][]>([]), [shippingLogisticType,setShippingLogisticType] = useState('drop_off'), [shippingLogistics,setShippingLogistics] = useState<string[]>([]), [shippingPreferencesLoading,setShippingPreferencesLoading] = useState(true), [shippingPreferencesError,setShippingPreferencesError] = useState(''), [shippingRefresh,setShippingRefresh] = useState(0);
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (confirm) confirmRef.current?.focus(); }, [confirm]);
  useEffect(() => {
    let alive = true;
    setShippingPreferencesLoading(true); setShippingPreferencesError('');
    catalogRequest(user,`${base}/shipping-preferences`).then(result => {
      if (alive) {
        setShippingModes((result.modes || []).filter((mode: string): mode is DraftInput['shipping']['mode'] => ['me1','me2','custom','not_specified'].includes(mode)));
        if (typeof result.logisticType === 'string') setShippingLogisticType(result.logisticType);
        if (Array.isArray(result.logistics)) setShippingLogistics(result.logistics.filter((item: unknown): item is string => typeof item === 'string'));
      }
    }).catch(e => { if (alive) setShippingPreferencesError((e as Error).message || 'Não foi possível consultar os modos de envio da conta.'); })
      .finally(() => { if (alive) setShippingPreferencesLoading(false); });
    return () => { alive = false; };
  }, [user,base,shippingRefresh]);
  useEffect(() => {
    let alive = true;
    if (!data.categoryId) { setCategoryAttributes([]); setCategoryAttributesLoading(false); setCategoryAttributesError(''); return; }
    setCategoryAttributes([]); setCategoryAttributesLoading(true); setCategoryAttributesError('');
    const params = new URLSearchParams({categoryId:data.categoryId,condition:data.condition});
    catalogRequest(user,`${base}/category-attributes?${params.toString()}`).then(result => {
      if (alive) setCategoryAttributes(Array.isArray(result.attributes) ? result.attributes : []);
    }).catch(e => { if (alive) setCategoryAttributesError((e as Error).message || 'Não foi possível carregar os atributos obrigatórios.'); })
      .finally(() => { if (alive) setCategoryAttributesLoading(false); });
    return () => { alive = false; };
  }, [user,base,data.categoryId,data.condition]);
  const dirty = JSON.stringify(data) !== JSON.stringify(draft.data), editable = canManage && ['draft','approved'].includes(draft.status);
  const shippingModeValid = shippingModes.includes(data.shipping.mode);
  const update = <K extends keyof DraftInput>(key: K,value: DraftInput[K]) => { setData(d => ({...d,[key]:value})); setConfirm(false); setNotice(''); };
  const changeCategory = (categoryId: string) => {
    const oldRequiredIds = new Set(categoryAttributes.map(attribute=>attribute.id));
    setData(d=>({...d,categoryId,attributes:d.attributes.filter(attribute=>!oldRequiredIds.has(attribute.id))}));
    setConfirm(false); setNotice('');
  };
  const updateCategoryAttribute = (id: string, value?: Pick<DraftAttribute,'value_id'|'value_name'>) => {
    setData(d=>({...d,attributes:[...d.attributes.filter(attribute=>attribute.id!==id),...(value ? [{id,...value}] : [])]}));
    setConfirm(false); setNotice('');
  };
  const requiredAttributeIds = new Set(categoryAttributes.map(attribute=>attribute.id));
  const missingRequiredAttributes = categoryAttributes.filter(attribute=>{
    const value = data.attributes.find(item=>item.id===attribute.id);
    return !value?.value_name?.trim() && !value?.value_id;
  });
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
        <label>Quantidade disponível<input className={field} type="number" min="1" step="1" value={data.quantity} onChange={e=>update('quantity',Number(e.target.value))} /></label>
        <label>Condição<select className={field} value={data.condition} onChange={e=>update('condition',e.target.value as DraftInput['condition'])}><option value="new">Novo</option><option value="used">Usado</option></select></label>
      </div>
      <div className="grid gap-4"><MarketplaceCategoryPicker user={user} base={base} value={data.categoryId} onChange={changeCategory} />
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
        <fieldset className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <legend className="px-1 font-semibold">Atributos obrigatórios da categoria</legend>
          <CategoryRequiredAttributes categoryId={data.categoryId} condition={data.condition} attributes={categoryAttributes} loading={categoryAttributesLoading} error={categoryAttributesError}
            values={data.attributes} onChange={updateCategoryAttribute} />
          {!categoryAttributesLoading && !categoryAttributesError && missingRequiredAttributes.length > 0 && <p role="alert" className="text-sm font-medium text-amber-900">
            Preencha: {missingRequiredAttributes.map(attribute=>attribute.name).join(', ')}. O botão de validação será liberado quando esses campos estiverem completos.
          </p>}
        </fieldset>
        <AttributeFields label="Atributos adicionais" values={data.attributes} hiddenIds={requiredAttributeIds} onChange={v=>update('attributes',v)} />
        <AttributeFields label="Condições de venda" values={data.saleTerms} onChange={v=>update('saleTerms',v)} />
        <label className="block">Modo de envio<select required className={field} value={shippingModeValid ? data.shipping.mode : ''} onChange={e=>{const mode=e.target.value as DraftInput['shipping']['mode'];update('shipping',{...data.shipping,mode,free_shipping:mode==='me2'?data.shipping.free_shipping:false});}}><option value="">Selecione um modo disponível para sua conta</option>{shippingModes.map(mode=><option key={mode} value={mode}>{mode === 'me2' ? 'Mercado Envios (logística do Mercado Livre)' : mode === 'me1' ? 'Mercado Envios 1 (logística do vendedor)' : mode === 'custom' ? 'Entrega personalizada' : 'Combinar com o comprador'}</option>)}</select></label>
        {shippingPreferencesLoading && <p role="status" className="text-sm text-slate-500">Conferindo os modos de envio da conta…</p>}
        {shippingPreferencesError && <div role="alert" className="space-y-2 text-sm text-red-700"><p>{shippingPreferencesError}</p><button type="button" className={button} onClick={()=>setShippingRefresh(value=>value+1)}>Consultar modos novamente</button></div>}
        {!shippingPreferencesLoading && !shippingPreferencesError && !shippingModeValid && <p role="alert" className="text-sm text-amber-800">O modo de envio salvo não está habilitado para esta conta. Escolha uma das opções disponíveis acima.</p>}
        <label className="flex gap-2"><input type="checkbox" checked={data.shipping.local_pick_up} onChange={e=>update('shipping',{...data.shipping,local_pick_up:e.target.checked})} />Permitir retirada em mãos</label>
        {data.shipping.mode === 'me2' && <label className="flex gap-2"><input type="checkbox" checked={data.shipping.free_shipping} onChange={e=>update('shipping',{...data.shipping,free_shipping:e.target.checked})} />Oferecer frete grátis</label>}
        <p className="text-sm text-slate-500">No Mercado Envios, o Mercado Livre pode exigir frete grátis conforme o preço e a categoria; confira se o valor do anúncio cobre esse custo antes de publicar.</p>
      </div></details>
    </fieldset>
    <ListingCostEstimate user={user} base={base} price={data.price} editable={editable} onPriceChange={value=>update('price',value)} categoryId={data.categoryId} listingTypeId={data.listingTypeId} shippingMode={data.shipping.mode}
      freeShipping={data.shipping.free_shipping} logisticType={shippingLogisticType} onLogisticTypeChange={setShippingLogisticType} logistics={shippingLogistics} condition={data.condition} />
    <div className="border-t pt-5 space-y-4">
      {dirty && <p className="text-amber-900">Há alterações não salvas. Salve para revisar e aprovar a nova versão.</p>}
      {draft.message && <p className="bg-slate-50 rounded-xl p-4">{draft.message}</p>}
      {draft.itemId && <div className="text-sm"><p>Mercado Livre: {draft.itemId} · {listingStatus[draft.remoteStatus || ''] || draft.remoteStatus || 'Em conferência'}</p>{draft.itemUrl && <a className="text-indigo-700 underline" href={draft.itemUrl} target="_blank" rel="noopener noreferrer">Ver anúncio no Mercado Livre</a>}</div>}
      {error && <p role="alert" className="bg-red-50 text-red-800 rounded-xl p-4">{error}</p>}
      {notice && <p role="status" className="bg-emerald-50 text-emerald-900 rounded-xl p-4">{notice}</p>}
      {busy && <p role="status">Aguarde a confirmação…</p>}
      <div className="flex flex-wrap gap-3">
        {editable && <button className={button} disabled={busy || !dirty} onClick={()=>execute('save')}>Salvar alterações</button>}
        {editable && draft.status === 'draft' && <button className={`${button} bg-indigo-700 text-white`} disabled={busy || dirty || shippingPreferencesLoading || !!shippingPreferencesError || !shippingModeValid || categoryAttributesLoading || (!categoryAttributesError && missingRequiredAttributes.length > 0)} onClick={()=>execute('approve')}>Validar e aprovar rascunho</button>}
        {canManage && draft.status === 'approved' && <button className={`${button} bg-indigo-700 text-white`} disabled={busy || dirty || shippingPreferencesLoading || !!shippingPreferencesError || !shippingModeValid} onClick={()=>setConfirm(true)}>Publicar no Mercado Livre</button>}
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
