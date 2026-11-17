import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { uploadDraftPhoto } from './draft-photo-upload';
import { catalogRequest } from '../catalog/client';
import { validPictureUrl, draftStatuses, type ListingDraft, type DraftInput, type DraftAttribute } from '../../../shared/marketplaces/drafts';
import { listingStatus } from '../../../shared/marketplaces/listings';

type User = { getIdToken(): Promise<string> };
type CategoryOption = { id: string; name: string; path: string };
type CategoryAttribute = { id: string; name: string; valueType: string; maxLength: number; hint: string; values: { id: string; name: string }[] };
type CostEstimate = { price: number; saleFee: number; listingFee: number; shippingCost: number | null; net: number | null; netPercent: number | null; listingTypeName: string; shippingMessage: string };
type ShippingMode = DraftInput['shipping']['mode'];

export const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const card = 'bg-white rounded-xl border border-slate-200 shadow-sm p-5 sm:p-6';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50 disabled:text-slate-500';
const smallInput = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50 disabled:text-slate-500';
const label = 'block text-sm font-medium text-slate-700 mb-1.5';
const smallLabel = 'block text-xs font-medium text-slate-600 mb-1';
const secondary = 'py-2 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium text-sm transition disabled:opacity-50 disabled:cursor-not-allowed';
const primary = 'w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed';
const link = 'text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline disabled:opacity-50';
const shippingModeNames: Record<ShippingMode, string> = {
  me2: 'Mercado Envios (logística do Mercado Livre)', me1: 'Mercado Envios 1 (logística do vendedor)', custom: 'Entrega personalizada', not_specified: 'Combinar com o comprador',
};
const statusBadge: Record<ListingDraft['status'], string> = {
  draft: 'bg-amber-50 text-amber-800 border-amber-200', approved: 'bg-emerald-50 text-emerald-800 border-emerald-200', published: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  publishing: 'bg-indigo-50 text-indigo-800 border-indigo-200', attention: 'bg-rose-50 text-rose-800 border-rose-200',
};
const statusDot: Record<ListingDraft['status'], string> = { draft: 'bg-amber-500', approved: 'bg-emerald-500', published: 'bg-emerald-500', publishing: 'bg-indigo-500', attention: 'bg-rose-500' };
// Nomes amigáveis dos códigos de atributo mais comuns do Mercado Livre; códigos desconhecidos aparecem como estão.
const attributeNames: Record<string, string> = {
  BRAND: 'Marca', MODEL: 'Modelo', COLOR: 'Cor', MAIN_COLOR: 'Cor principal', MATERIAL: 'Material', MATERIALS: 'Materiais', GTIN: 'Código universal (GTIN)',
  EMPTY_GTIN_REASON: 'Motivo de não ter GTIN', SELLER_SKU: 'SKU do vendedor', LINE: 'Linha', HEIGHT: 'Altura', WIDTH: 'Largura', LENGTH: 'Comprimento', DEPTH: 'Profundidade',
  WEIGHT: 'Peso', DIAMETER: 'Diâmetro', UNITS_PER_PACK: 'Unidades por kit', PIECES_NUMBER: 'Quantidade de peças', SHAPE: 'Formato', STYLE: 'Estilo', THEME: 'Tema',
  CHARACTER: 'Personagem', MANUFACTURER: 'Fabricante', IS_KIT: 'É kit', FINISH: 'Acabamento', ITEM_CONDITION: 'Condição do item',
};
const MANUFACTURING = 'MANUFACTURING_TIME', WARRANTY_TYPE = 'WARRANTY_TYPE', WARRANTY_TIME = 'WARRANTY_TIME';
const termIds = new Set([MANUFACTURING, WARRANTY_TYPE, WARRANTY_TIME]);
const manufacturingDays = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30];
const warrantyDays = [7, 30, 90];
const term = (terms: DraftAttribute[], id: string) => terms.find(item => item.id === id);
const withTerm = (terms: DraftAttribute[], id: string, value?: string) => [...terms.filter(item => item.id !== id), ...(value ? [{ id, value_name: value }] : [])];

function Card({ title, aside, description, children }: { title: string; aside?: ReactNode; description?: ReactNode; children: ReactNode }) {
  const id = useId();
  return <section className={card} aria-labelledby={id}>
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div><h3 id={id} className="text-base font-semibold text-slate-900">{title}</h3>{description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}</div>
      {aside}
    </div>
    {children}
  </section>;
}

function CategoryCombobox({ user, base, value, title, onChange }: { user: User; base: string; value: string; title: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [categories, setCategories] = useState<CategoryOption[]>([]), [selected, setSelected] = useState<CategoryOption | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [total, setTotal] = useState(0), [hasMore, setHasMore] = useState(false);
  const [suggestion, setSuggestion] = useState<CategoryOption | null>(null);
  const listId = useId();
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setBusy(true); setError('');
      const params = new URLSearchParams({ group: 'all', q: query, ...(value ? { id: value } : {}) });
      catalogRequest(user, `${base}/categories?${params.toString()}`)
        .then(result => {
          if (!alive) return;
          setCategories(result?.categories || []); setSelected(result?.selected || null);
          setTotal(result?.total || 0); setHasMore(result?.hasMore === true); setLoaded(true); setActive(0);
        })
        .catch(e => { if (alive) { setError((e as Error).message || 'Não foi possível carregar as categorias do Mercado Livre.'); setLoaded(true); } })
        .finally(() => { if (alive) setBusy(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [user, base, query, value]);
  useEffect(() => {
    let alive = true;
    if (title.trim().length < 3) { setSuggestion(null); return; }
    const timer = window.setTimeout(() => {
      catalogRequest(user, `${base}/category-suggestion?${new URLSearchParams({ q: title.trim() }).toString()}`)
        .then(result => { if (alive) setSuggestion(result?.suggestion || null); })
        .catch(() => { if (alive) setSuggestion(null); });
    }, 600);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [user, base, title]);
  const choose = (category: CategoryOption) => { setSelected(category); setOpen(false); setQuery(''); onChange(category.id); };
  const valid = !!value && selected?.id === value;
  const display = open ? query : valid ? selected!.path : value;
  return <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
    <label htmlFor={`${listId}-input`} className={label}>Categoria no Mercado Livre</label>
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
      <input id={`${listId}-input`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off"
        aria-activedescendant={open && categories[active] ? `${listId}-${categories[active].id}` : undefined}
        className={`${input} pl-9`} value={display} placeholder="Digite o produto para buscar (ex.: enfeite natal, vaso, chaveiro)…"
        onFocus={() => { setOpen(true); setQuery(''); }} onBlur={() => setOpen(false)} onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, categories.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && open && categories[active]) { e.preventDefault(); choose(categories[active]); }
        }} />
      {open && <div id={listId} role="listbox" aria-label="Categorias encontradas" className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto divide-y divide-slate-100">
        {categories.map((category, index) => <div key={category.id} id={`${listId}-${category.id}`} role="option" aria-selected={category.id === value}
          onMouseDown={e => e.preventDefault()} onClick={() => choose(category)} onMouseEnter={() => setActive(index)}
          className={`cursor-pointer px-4 py-2.5 text-sm ${index === active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>
          {category.path} <span className="text-xs text-slate-400">· {category.id}</span>
        </div>)}
        {busy && <div className="px-4 py-3 text-xs text-slate-500">Carregando categorias oficiais…</div>}
        {!busy && loaded && !categories.length && <div className="px-4 py-3 text-xs text-slate-500">Nenhuma categoria encontrada. Tente um termo mais curto, como “vela”, “vaso” ou “suporte”.</div>}
        {!busy && hasMore && <div className="px-4 py-2 text-xs text-slate-400">Mostrando {categories.length} de {total}. Refine a busca para encontrar a categoria certa.</div>}
        {!busy && !query && categories.length > 0 && <div className="px-4 py-2 text-xs text-slate-400">Sugestões: Natal, lembrancinhas, decoração, artesanato, miniaturas e utilidades.</div>}
      </div>}
    </div>
    {suggestion && suggestion.id !== value && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-indigo-50/70 border border-indigo-100 px-3.5 py-2.5 text-xs">
      <div className="text-indigo-900"><span className="font-semibold">✨ Sugestão do Mercado Livre para este título:</span> <span>{suggestion.path} ({suggestion.id})</span></div>
      <button type="button" className="px-2.5 py-1 rounded-md bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition disabled:opacity-50" onClick={() => choose(suggestion)}>Aplicar sugestão</button>
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {!error && loaded && value && !selected && !busy && <p role="alert" className="mt-2 text-sm text-amber-800">O código atual ({value}) não existe na lista de categorias do Mercado Livre. Escolha uma opção válida.</p>}
    {valid && <p className="mt-2 text-xs text-emerald-700">Categoria válida · {selected!.id}</p>}
    <p className="mt-2 text-xs text-slate-500">A categoria descreve o produto final; impressão 3D é o método de fabricação.</p>
  </div>;
}

function RequiredAttributes({ categoryId, attributes, loading, error, values, missing, onChange }: {
  categoryId: string; attributes: CategoryAttribute[]; loading: boolean; error: string; values: DraftAttribute[]; missing: CategoryAttribute[];
  onChange: (id: string, value?: Pick<DraftAttribute, 'value_id' | 'value_name'>) => void;
}) {
  const notice = (text: string, role?: 'status' | 'alert') => <div role={role} className="mt-4 rounded-lg bg-amber-50/70 border border-amber-200 px-4 py-3 text-xs text-amber-800 flex items-center gap-2"><span aria-hidden="true">⚠️</span><span>{text}</span></div>;
  if (!categoryId) return notice('Selecione uma categoria acima para carregar os atributos obrigatórios e liberar o cálculo de tarifa.');
  if (loading) return <p role="status" className="mt-4 text-sm text-slate-600">Conferindo os atributos obrigatórios desta categoria…</p>;
  if (error) return notice(`${error} A validação do Mercado Livre ainda poderá solicitar outros campos.`, 'alert');
  if (!attributes.length) return <p className="mt-4 text-xs text-slate-500">Nenhum atributo obrigatório extra foi informado para esta categoria.</p>;
  return <fieldset className="mt-4 rounded-xl bg-emerald-50/40 border border-emerald-200 p-4">
    <legend className="sr-only">Atributos obrigatórios da categoria</legend>
    <div className="flex items-center justify-between mb-3 gap-2">
      <span className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">Atributos obrigatórios da categoria</span>
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${missing.length ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>{missing.length ? `${missing.length} pendente(s)` : 'Completos'}</span>
    </div>
    <div className="grid sm:grid-cols-2 gap-3">
      {attributes.map(attribute => {
        const current = values.find(value => value.id === attribute.id);
        const suggestionsId = `category-attribute-${categoryId}-${attribute.id}`;
        const currentName = current?.value_name ?? attribute.values.find(value => value.id === current?.value_id)?.name ?? '';
        const update = (name: string) => {
          if (!name.trim()) { onChange(attribute.id); return; }
          const match = attribute.values.find(value => value.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
          onChange(attribute.id, match ? { value_id: match.id, value_name: match.name } : { value_name: name });
        };
        return <label key={attribute.id} className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">{attribute.name} <span className="text-red-700" aria-hidden="true">*</span></span>
          {attribute.values.length > 0 && <datalist id={suggestionsId}>{attribute.values.map(value => <option key={value.id} value={value.name} />)}</datalist>}
          <input required aria-required="true" list={attribute.values.length ? suggestionsId : undefined} aria-label={`${attribute.name} (obrigatório)`} className={smallInput}
            maxLength={attribute.maxLength} value={currentName} onChange={event => update(event.target.value)}
            placeholder={attribute.valueType === 'string' ? `Informe ${attribute.name.toLocaleLowerCase()}` : 'Selecione ou digite um valor'} />
          {attribute.hint && <span className="mt-1 block text-[11px] text-slate-500">{attribute.hint}</span>}
        </label>;
      })}
    </div>
    {missing.length > 0 && <p role="alert" className="mt-3 text-xs font-medium text-amber-900">Preencha: {missing.map(attribute => attribute.name).join(', ')}. A aprovação é liberada quando esses campos estiverem completos.</p>}
  </fieldset>;
}


function AttributeGrid({ title, name, addLabel, values, hiddenIds, onChange, children }: {
  title: string; name: string; addLabel: string; values: DraftAttribute[]; hiddenIds: Set<string>; onChange: (v: DraftAttribute[]) => void; children?: ReactNode;
}) {
  const [newRows, setNewRows] = useState<Set<number>>(new Set());
  const visible = values.map((value, index) => ({ value, index })).filter(({ value, index }) => newRows.has(index) || !hiddenIds.has(value.id));
  const remove = (index: number) => {
    onChange(values.filter((_, j) => j !== index));
    setNewRows(rows => new Set([...rows].filter(row => row !== index).map(row => row > index ? row - 1 : row)));
  };
  const add = () => { setNewRows(rows => new Set([...rows, values.length])); onChange([...values, { id: '', value_name: '' }]); };
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <button type="button" className={link} onClick={add}>+ {addLabel}</button>
    </div>
    <div className="grid sm:grid-cols-2 gap-4">
      {children}
      {visible.map(({ value: attribute, index }) => {
        const editingCode = newRows.has(index) || !attribute.id;
        const friendly = attributeNames[attribute.id];
        const setValue = (text: string) => onChange(values.map((v, j) => j === index ? { id: v.id, value_name: text } : v));
        return <div key={index} className="relative">
          <button type="button" aria-label={`Remover ${friendly || attribute.id || 'atributo'} (${name.toLocaleLowerCase()} ${index + 1})`} onClick={() => remove(index)}
            className="absolute top-0 right-0 text-[11px] text-slate-400 hover:text-rose-600 disabled:hidden">Remover</button>
          {editingCode
            ? <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
              <label><span className={smallLabel}>Código</span><input aria-label={`${name} código ${index + 1}`} className={`${smallInput} font-mono uppercase`} placeholder="WEIGHT" value={attribute.id}
                onChange={e => onChange(values.map((v, j) => j === index ? { ...v, id: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') } : v))} /></label>
              <label><span className={smallLabel}>Valor</span><input aria-label={`${name} valor ${index + 1}`} className={smallInput} placeholder="Ex.: 120 g" value={attribute.value_name ?? ''} onChange={e => setValue(e.target.value)} /></label>
            </div>
            : <label className="block"><span className={smallLabel}>{friendly || attribute.id} {friendly && <span className="text-slate-400 font-normal">({attribute.id})</span>}</span>
              <input aria-label={`${name} valor ${index + 1}`} className={smallInput} value={attribute.value_name ?? ''} placeholder={attribute.value_id ? `ID do valor: ${attribute.value_id}` : ''} onChange={e => setValue(e.target.value)} />
            </label>}
        </div>;
      })}
    </div>
  </div>;
}

function ManufacturingTime({ terms, onChange }: { terms: DraftAttribute[]; onChange: (terms: DraftAttribute[]) => void }) {
  const current = term(terms, MANUFACTURING)?.value_name ?? '';
  const options = manufacturingDays.map(days => `${days} ${days === 1 ? 'dia' : 'dias'}`);
  return <label className="block"><span className={label}>Prazo de produção <span className="text-slate-400 font-normal">(opcional)</span></span>
    <select className={input} value={current} onChange={e => onChange(withTerm(terms, MANUFACTURING, e.target.value))}>
      <option value="">Pronta entrega</option>
      {current && !options.includes(current) && <option value={current}>{current}</option>}
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>;
}

function Warranty({ terms, onChange }: { terms: DraftAttribute[]; onChange: (terms: DraftAttribute[]) => void }) {
  const type = term(terms, WARRANTY_TYPE), time = term(terms, WARRANTY_TIME);
  const typeName = type?.value_name ?? '', timeName = time?.value_name ?? '';
  const key = !type && !time ? '' : typeName === 'Sem garantia' && !time ? 'none' : typeName === 'Garantia do vendedor' && timeName ? `seller:${timeName}` : 'custom';
  const sellerOptions = warrantyDays.map(days => `${days} dias`);
  const select = (next: string) => {
    let result = terms.filter(item => item.id !== WARRANTY_TYPE && item.id !== WARRANTY_TIME);
    if (next === 'custom') return;
    if (next === 'none') result = withTerm(result, WARRANTY_TYPE, 'Sem garantia');
    if (next.startsWith('seller:')) result = withTerm(withTerm(result, WARRANTY_TYPE, 'Garantia do vendedor'), WARRANTY_TIME, next.slice(7));
    onChange(result);
  };
  return <label className="block"><span className={smallLabel}>Garantia</span>
    <select className={smallInput} value={key} onChange={e => select(e.target.value)}>
      <option value="">Não informar</option>
      {key === 'custom' && <option value="custom">{[typeName || (type?.value_id ? `Tipo ${type.value_id}` : ''), timeName].filter(Boolean).join(': ') || 'Definida pela integração'}</option>}
      {key.startsWith('seller:') && !sellerOptions.includes(timeName) && <option value={key}>Garantia do vendedor: {timeName}</option>}
      {sellerOptions.map(option => <option key={option} value={`seller:${option}`}>Garantia do vendedor: {option}</option>)}
      <option value="none">Sem garantia</option>
    </select>
  </label>;
}

function Photos({ pictures, editable, busy, status, onChange, onUpload }: {
  pictures: string[]; editable: boolean; busy: boolean; status: string; onChange: (pictures: string[]) => void; onUpload: (files: File[]) => void;
}) {
  const [urlOpen, setUrlOpen] = useState(false), [url, setUrl] = useState(''), [urlError, setUrlError] = useState(''), [dragging, setDragging] = useState(false);
  const list = pictures.filter(p => p.trim());
  const addUrl = () => {
    const value = url.trim();
    if (!validPictureUrl(value)) { setUrlError('Use um link HTTPS público de imagem (ex.: https://…/foto.jpg).'); return; }
    if (list.includes(value)) { setUrlError('Esta foto já está no anúncio.'); return; }
    if (list.length >= 12) { setUrlError('O anúncio pode ter até 12 fotos.'); return; }
    onChange([...list, value]); setUrl(''); setUrlError('');
  };
  const makeCover = (index: number) => onChange([list[index], ...list.filter((_, j) => j !== index)]);
  return <Card title="2. Fotos do anúncio" description={<>A <strong>Foto 1</strong> é a capa nas buscas do Mercado Livre. JPEG, PNG ou WebP, até 12 fotos de no máximo 10 MiB. A LabLayer hospeda as fotos e gera os links.</>}
    aside={editable && <button type="button" className={link} onClick={() => setUrlOpen(v => !v)} aria-expanded={urlOpen}>+ Importar por URL externa</button>}>
    {urlOpen && <div className="mb-4">
      <div className="flex gap-2">
        <input type="url" aria-label="Link HTTPS da foto" className={smallInput} placeholder="Cole a URL da imagem hospedada (https://…)" value={url}
          onChange={e => { setUrl(e.target.value); setUrlError(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }} />
        <button type="button" className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50" onClick={addUrl}>Adicionar</button>
      </div>
      {urlError && <p role="alert" className="mt-1 text-xs text-red-700">{urlError}</p>}
    </div>}
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
      {list.map((src, index) => <div key={src + index} className={`group relative aspect-square rounded-lg border bg-slate-50 overflow-hidden ${index === 0 ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200'}`}>
        {validPictureUrl(src.trim())
          ? <img src={src} alt={`Foto ${index + 1} do anúncio`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
          : <div className="h-full w-full flex items-center justify-center p-2 text-center text-[11px] text-rose-700">Link inválido: use HTTPS público</div>}
        {index === 0
          ? <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-semibold shadow-sm">Capa</span>
          : <button type="button" aria-label={`Usar foto ${index + 1} como capa`} onClick={() => makeCover(index)}
            className="sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-800/80 text-white text-[10px] font-medium transition disabled:hidden">Usar capa</button>}
        <button type="button" aria-label={`Remover foto ${index + 1}`} title="Remover foto" onClick={() => onChange(list.filter((_, j) => j !== index))}
          className="sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-rose-600 text-white text-sm flex items-center justify-center shadow-sm transition disabled:hidden">×</button>
        <span className="absolute bottom-1 left-1.5 text-[10px] font-medium text-slate-500 bg-white/80 rounded px-1">Foto {index + 1}</span>
      </div>)}
      {editable && list.length < 12 && <label onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) onUpload(Array.from(e.dataTransfer.files || [])); }}
        className={`aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center p-2 cursor-pointer transition text-center ${dragging ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-500 hover:border-indigo-400 hover:bg-indigo-50/30 hover:text-indigo-600'}`}>
        <span aria-hidden="true" className="text-xl mb-1">+</span>
        <span className="text-[11px] font-medium">Adicionar fotos</span>
        <span className="text-[10px] text-slate-400">ou arraste aqui</span>
        <input aria-label="Enviar fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={busy}
          onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; onUpload(files); }} />
      </label>}
    </div>
    {!list.length && !editable && <p className="text-sm text-slate-500">Nenhuma foto no rascunho.</p>}
    {status && <p aria-live="polite" className="mt-3 text-xs text-indigo-700">{status}</p>}
  </Card>;
}

function Pricing({ user, base, data, editable, busy, onPriceChange, onListingTypeChange, onFreeShippingChange, logisticType, onLogisticTypeChange, logistics }: {
  user: User; base: string; data: DraftInput; editable: boolean; busy: boolean; onPriceChange: (value: number) => void;
  onListingTypeChange: (value: DraftInput['listingTypeId']) => void; onFreeShippingChange: (value: boolean) => void;
  logisticType: string; onLogisticTypeChange: (value: string) => void; logistics: string[];
}) {
  const { price, categoryId, listingTypeId, condition } = data, shippingMode = data.shipping.mode, freeShipping = data.shipping.free_shipping;
  const [packageSize, setPackageSize] = useState({ height: '', width: '', length: '', weight: '' });
  const [simulationPrice, setSimulationPrice] = useState(price);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const needsShippingQuote = shippingMode === 'me2' && freeShipping;
  const effectivePrice = editable ? price : simulationPrice;
  const effectiveLogisticType = shippingMode === 'me1' ? 'default' : shippingMode === 'custom' ? 'custom' : shippingMode === 'not_specified' ? 'not_specified' : logisticType;
  useEffect(() => { if (!editable) setSimulationPrice(price); }, [price, editable]);
  useEffect(() => {
    let alive = true;
    if (!categoryId || !Number.isFinite(effectivePrice) || effectivePrice <= 0) { setEstimate(null); setLoading(false); setError(''); return; }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ price: String(effectivePrice), categoryId, listingTypeId, shippingMode, freeShipping: String(freeShipping), logisticType: effectiveLogisticType, condition });
      if (packageSize.height && packageSize.width && packageSize.length && packageSize.weight)
        for (const key of ['height', 'width', 'length', 'weight'] as const) params.set(key, packageSize[key]);
      setLoading(true); setError(''); setEstimate(null);
      catalogRequest(user, `${base}/cost-estimate?${params.toString()}`).then((result: CostEstimate) => { if (alive) setEstimate(result || null); })
        .catch(e => { if (alive) setError((e as Error).message || 'Não foi possível calcular as tarifas agora.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, 450);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [user, base, effectivePrice, categoryId, listingTypeId, shippingMode, freeShipping, effectiveLogisticType, packageSize, condition]);
  const logisticOptions = logistics.length ? logistics : logisticType ? [logisticType] : [];
  const logisticLabels: Record<string, string> = { drop_off: 'Agências / pontos de despacho', cross_docking: 'Coleta do Mercado Livre', xd_drop_off: 'Places', self_service: 'Mercado Envios Flex', fulfillment: 'Full', default: 'Logística própria (ME1)' };
  const rate = estimate && estimate.price > 0 ? estimate.saleFee / estimate.price * 100 : null;
  const types: { id: DraftInput['listingTypeId']; name: string; hint: string }[] = [
    { id: 'gold_special', name: 'Clássico', hint: 'Tarifa menor' }, { id: 'gold_pro', name: 'Premium', hint: 'Parcelamento sem juros' },
  ];
  const priceLabel = editable ? 'Preço do anúncio' : 'Simular preço de venda';
  return <section className={card} aria-label="Estimativa do valor líquido do anúncio">
    <h3 className="text-base font-semibold text-slate-900 mb-1">Precificação e repasse</h3>
    <p className="text-xs text-slate-500 mb-4">Tarifas atuais do Mercado Livre para a categoria e o tipo de anúncio escolhidos.</p>
    <div className="mb-4">
      <label htmlFor="draft-price" className={label}>{priceLabel}</label>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium">R$</span>
        <input id="draft-price" aria-label={editable ? 'Preço (R$)' : 'Simular preço de venda (R$)'} type="number" min="0" step="0.01" disabled={busy}
          className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-2 text-base font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50"
          value={editable ? price : simulationPrice} onChange={e => editable ? onPriceChange(Number(e.target.value)) : setSimulationPrice(Number(e.target.value))} />
      </div>
      {!editable && <p className="mt-1 text-xs text-slate-500">Simulação local; não altera o anúncio.</p>}
    </div>
    <fieldset className="mb-4" disabled={!editable || busy}>
      <legend className={label}>Tipo de anúncio</legend>
      <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Tipo de anúncio">
        {types.map(type => {
          const checked = listingTypeId === type.id;
          return <button key={type.id} type="button" role="radio" aria-checked={checked} onClick={() => onListingTypeChange(type.id)}
            className={`text-left p-2.5 rounded-lg transition disabled:cursor-not-allowed ${checked ? 'border-2 border-indigo-600 bg-indigo-50/50' : 'border border-slate-200 hover:border-slate-300 bg-white'}`}>
            <span className="block text-sm font-semibold text-slate-900">{type.name}</span>
            <span className="block text-[11px] text-slate-500">{checked && rate !== null ? `Tarifa de ${percent(rate)}%` : type.hint}</span>
          </button>;
        })}
      </div>
    </fieldset>
    <div className="mb-4 rounded-lg bg-slate-50 border border-slate-200 p-3">
      {shippingMode === 'me2'
        ? <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600" checked={freeShipping} disabled={!editable || busy} onChange={e => onFreeShippingChange(e.target.checked)} />
          <span><span className="block text-sm font-medium text-slate-800">Oferecer frete grátis</span>
            <span className="block text-[11px] text-slate-500">O Mercado Livre pode exigir frete grátis conforme o preço e a categoria; confira se o preço cobre esse custo.</span></span>
        </label>
        : <p className="text-[11px] text-slate-500">Frete grátis só está disponível no Mercado Envios. O líquido não desconta custos de entrega própria ou personalizada.</p>}
    </div>
    {needsShippingQuote && <details open className="mb-4 rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">Medidas da embalagem para o frete</summary>
      <p className="mt-2 text-[11px] text-slate-500">Embalagem pronta para despacho. O Mercado Livre calcula o custo do frete grátis com essas medidas.</p>
      {logisticOptions.length > 1 && <label className="block mt-2"><span className={smallLabel}>Tipo de logística</span><select aria-label="Tipo de logística para cálculo do frete" className={smallInput} value={logisticType} onChange={e => onLogisticTypeChange(e.target.value)}>
        {logisticOptions.map(option => <option key={option} value={option}>{logisticLabels[option] || option}</option>)}
      </select></label>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {([['height', 'Altura (cm)'], ['width', 'Largura (cm)'], ['length', 'Comprimento (cm)'], ['weight', 'Peso (g)']] as const).map(([key, text]) => <label key={key}><span className={smallLabel}>{text}</span>
          <input aria-label={text} className={smallInput} type="number" min="1" max={key === 'weight' ? '30000' : '1050'} step="1" value={packageSize[key]} onChange={e => setPackageSize(v => ({ ...v, [key]: e.target.value }))} /></label>)}
      </div>
    </details>}
    <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4 space-y-2">
      <div className="flex justify-between text-xs text-slate-600"><span>Valor de venda</span><span className="font-medium text-slate-800">{money(estimate?.price ?? (effectivePrice || 0))}</span></div>
      <div className="flex justify-between text-xs text-slate-600"><span>Tarifa ML {estimate ? `· ${estimate.listingTypeName || (listingTypeId === 'gold_pro' ? 'Premium' : 'Clássico')}` : ''} <span className="text-slate-400">{rate !== null ? `(${percent(rate)}%)` : !categoryId ? '(selecione a categoria)' : ''}</span></span>
        <span className="font-medium text-rose-700">{estimate ? `−${money(estimate.saleFee)}` : '—'}</span></div>
      <div className="flex justify-between text-xs text-slate-600"><span>Frete pago por você</span>
        <span className="font-medium text-slate-800">{!estimate ? '—' : estimate.shippingCost === null ? 'Aguardando medidas' : estimate.shippingCost ? `−${money(estimate.shippingCost)}` : money(0)}</span></div>
      {estimate && estimate.listingFee > 0 && <div className="flex justify-between text-xs text-slate-600"><span>Tarifa de publicação (uma vez, à parte)</span><span className="font-medium text-slate-800">{money(estimate.listingFee)}</span></div>}
      <div className="pt-2 border-t border-emerald-200/80 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-800">Você recebe</span>
        <span className="text-right"><span className="block text-xl font-bold text-emerald-700">{estimate?.net == null ? '—' : money(estimate.net)}</span>
          {estimate?.netPercent != null && <span className="block text-[11px] text-slate-500">{percent(estimate.netPercent)}% do preço</span>}</span>
      </div>
    </div>
    <div className="mt-3 space-y-1.5 text-xs">
      {!categoryId && !loading && <p className="text-slate-500">Selecione uma categoria válida para consultar a tarifa de venda.</p>}
      {categoryId && effectivePrice <= 0 && !loading && <p className="text-slate-500">Informe o preço para calcular o valor líquido.</p>}
      {loading && <p role="status" className="text-slate-500">Consultando tarifas do Mercado Livre…</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-red-800">{error}</p>}
      {estimate?.shippingMessage && <p className="text-amber-800">{estimate.shippingMessage}</p>}
      {estimate && shippingMode === 'me2' && !freeShipping && <p className="text-slate-500">Sem frete grátis. Se o Mercado Livre exigir frete grátis para esta categoria e preço, o líquido será menor.</p>}
      <p className="text-slate-400">Estimativa por unidade, sujeita a mudanças de tarifas e condições do Mercado Livre.</p>
    </div>
  </section>;
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <li className={`flex items-start gap-2 ${ok ? 'text-emerald-700' : 'text-slate-500'}`}><span aria-hidden="true" className="w-3 shrink-0">{ok ? '✓' : '○'}</span><span><span className="sr-only">{ok ? 'Concluído: ' : 'Pendente: '}</span>{children}</span></li>;
}

export function DraftReview({ initial, user, base, canManage, onBack }: { initial: ListingDraft; user: User; base: string; canManage: boolean; onBack: () => void }) {
  const [draft, setDraft] = useState(initial), [data, setData] = useState<DraftInput>(initial.data);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirm, setConfirm] = useState(false);
  const [photoStatus, setPhotoStatus] = useState('');
  const [categoryAttributes, setCategoryAttributes] = useState<CategoryAttribute[]>([]), [categoryAttributesLoading, setCategoryAttributesLoading] = useState(false), [categoryAttributesError, setCategoryAttributesError] = useState('');
  const [shippingModes, setShippingModes] = useState<ShippingMode[]>([]), [shippingLogisticType, setShippingLogisticType] = useState('drop_off'), [shippingLogistics, setShippingLogistics] = useState<string[]>([]);
  const [shippingPreferencesLoading, setShippingPreferencesLoading] = useState(true), [shippingPreferencesError, setShippingPreferencesError] = useState(''), [shippingRefresh, setShippingRefresh] = useState(0);
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (confirm) confirmRef.current?.focus(); }, [confirm]);
  useEffect(() => {
    let alive = true;
    setShippingPreferencesLoading(true); setShippingPreferencesError('');
    catalogRequest(user, `${base}/shipping-preferences`).then(result => {
      if (alive) {
        setShippingModes((result?.modes || []).filter((mode: string): mode is ShippingMode => ['me1', 'me2', 'custom', 'not_specified'].includes(mode)));
        if (typeof result?.logisticType === 'string') setShippingLogisticType(result.logisticType);
        if (Array.isArray(result?.logistics)) setShippingLogistics(result.logistics.filter((item: unknown): item is string => typeof item === 'string'));
      }
    }).catch(e => { if (alive) setShippingPreferencesError((e as Error).message || 'Não foi possível consultar os modos de envio da conta.'); })
      .finally(() => { if (alive) setShippingPreferencesLoading(false); });
    return () => { alive = false; };
  }, [user, base, shippingRefresh]);
  useEffect(() => {
    let alive = true;
    if (!data.categoryId) { setCategoryAttributes([]); setCategoryAttributesLoading(false); setCategoryAttributesError(''); return; }
    setCategoryAttributes([]); setCategoryAttributesLoading(true); setCategoryAttributesError('');
    const params = new URLSearchParams({ categoryId: data.categoryId, condition: data.condition });
    catalogRequest(user, `${base}/category-attributes?${params.toString()}`).then(result => {
      if (alive) setCategoryAttributes(Array.isArray(result?.attributes) ? result.attributes : []);
    }).catch(e => { if (alive) setCategoryAttributesError((e as Error).message || 'Não foi possível carregar os atributos obrigatórios.'); })
      .finally(() => { if (alive) setCategoryAttributesLoading(false); });
    return () => { alive = false; };
  }, [user, base, data.categoryId, data.condition]);
  const dirty = JSON.stringify(data) !== JSON.stringify(draft.data), editable = canManage && ['draft', 'approved'].includes(draft.status);
  const shippingModeValid = shippingModes.includes(data.shipping.mode);
  const update = <K extends keyof DraftInput>(key: K, value: DraftInput[K]) => { setData(d => ({ ...d, [key]: value })); setConfirm(false); setNotice(''); };
  const changeCategory = (categoryId: string) => {
    const oldRequiredIds = new Set(categoryAttributes.map(attribute => attribute.id));
    setData(d => ({ ...d, categoryId, attributes: d.attributes.filter(attribute => !oldRequiredIds.has(attribute.id)) }));
    setConfirm(false); setNotice('');
  };
  const updateCategoryAttribute = (id: string, value?: Pick<DraftAttribute, 'value_id' | 'value_name'>) => {
    setData(d => ({ ...d, attributes: [...d.attributes.filter(attribute => attribute.id !== id), ...(value ? [{ id, ...value }] : [])] }));
    setConfirm(false); setNotice('');
  };
  const requiredAttributeIds = new Set(categoryAttributes.map(attribute => attribute.id));
  const missingRequiredAttributes = categoryAttributes.filter(attribute => {
    const value = data.attributes.find(item => item.id === attribute.id);
    return !value?.value_name?.trim() && !value?.value_id;
  });
  async function execute(action: 'save' | 'approve' | 'publish' | 'complete' | 'refresh') {
    setBusy(true); setError(''); setNotice('');
    try {
      const path = `${base}/${draft.id}`;
      const next = await catalogRequest(user, action === 'refresh' ? path : `${path}/${action === 'save' ? 'save' : 'actions'}`,
        action === 'refresh' ? undefined : action === 'save' ? { revision: draft.revision, data } : { action, revision: draft.revision });
      setDraft(next); setData(next.data); setConfirm(false);
      setNotice(action === 'save' ? 'Rascunho atualizado. Revise e aprove a nova versão.' : action === 'approve' ? 'Aprovado. O anúncio só será enviado quando você confirmar a publicação.' : action === 'refresh' ? 'Rascunho atualizado.' : 'Anúncio e descrição enviados ao Mercado Livre.');
    } catch (e) {
      setError((e as Error).message); setConfirm(false);
      if (action === 'publish' || action === 'complete') {
        try { const next = await catalogRequest(user, `${base}/${draft.id}`); setDraft(next); setData(next.data); } catch { /* Preserve the error and offer explicit refresh. */ }
      }
    } finally { setBusy(false); }
  }
  async function upload(files: File[]) {
    const existing = data.pictures.filter(p => p.trim());
    if (!files.length) return;
    if (existing.length + files.length > 12) { setPhotoStatus('O anúncio pode ter até 12 fotos.'); return; }
    setBusy(true); setError(''); setNotice(''); setConfirm(false);
    const urls: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setPhotoStatus(`Enviando foto ${i + 1} de ${files.length}…`);
        urls.push(await uploadDraftPhoto(user, base, files[i]));
      }
      setPhotoStatus('Upload concluído. Salve as alterações para anexar as fotos ao rascunho.');
      setNotice('Fotos enviadas à LabLayer. Clique em Salvar alterações para anexá-las ao rascunho.');
    } catch (e) {
      setPhotoStatus((e as Error).message);
      setError((e as Error).message);
      setNotice(urls.length ? `${urls.length} foto(s) enviada(s). Salve as alterações para manter essas fotos no rascunho.` : '');
    } finally {
      if (urls.length) setData(d => ({ ...d, pictures: [...new Set([...d.pictures.filter(p => p.trim()), ...urls])] }));
      setBusy(false);
    }
  }
  const titleLength = data.title.length;
  const validPhotos = data.pictures.filter(p => validPictureUrl(p.trim())).length;
  const approveBlocked = busy || dirty || shippingPreferencesLoading || !!shippingPreferencesError || !shippingModeValid || categoryAttributesLoading || (!categoryAttributesError && missingRequiredAttributes.length > 0);
  const publishBlocked = busy || dirty || shippingPreferencesLoading || !!shippingPreferencesError || !shippingModeValid;
  const otherTerms = data.saleTerms.some(item => !termIds.has(item.id));
  return <section aria-label="Revisão do rascunho">
    <div className="mb-6">
      <button type="button" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50" disabled={busy} onClick={onBack}>← Voltar aos rascunhos</button>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold text-slate-900">Revisar anúncio</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge[draft.status]}`}>
          <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${statusDot[draft.status]}`} />{draftStatuses[draft.status]}
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-1 font-mono break-all">{data.externalId} · Revisão {draft.revision}</p>
      {!canManage && <p className="mt-3 rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-600">Somente administradores podem editar, aprovar e publicar.</p>}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <fieldset disabled={!editable || busy} className="lg:col-span-8 space-y-6 min-w-0">
        <legend className="sr-only">Dados do anúncio</legend>
        <Card title="1. Informações do anúncio" aside={<span className="text-xs font-medium text-slate-500">Obrigatório para publicar</span>}>
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <label htmlFor="draft-title" className="text-sm font-medium text-slate-700">Título do anúncio</label>
                <span aria-live="polite" className={`text-xs ${titleLength >= 58 ? 'font-semibold text-amber-600' : 'font-medium text-slate-500'}`}>{titleLength} / 60 caracteres</span>
              </div>
              <input id="draft-title" aria-label="Título / nome do produto" className={input} maxLength={60} value={data.title} onChange={e => update('title', e.target.value)} />
              <p className="mt-1 text-xs text-slate-500">Evite termos como “Promoção” ou “Frete grátis” no título; o Mercado Livre penaliza a relevância.</p>
            </div>
            <label className="block"><span className={label}>Descrição</span>
              <textarea className={`${input} leading-relaxed`} rows={6} maxLength={5000} value={data.description} onChange={e => update('description', e.target.value)} /></label>
            <div className="grid sm:grid-cols-3 gap-4">
              <label className="block"><span className={label}>Quantidade disponível</span><input className={input} type="number" min="1" step="1" value={data.quantity} onChange={e => update('quantity', Number(e.target.value))} /></label>
              <label className="block"><span className={label}>Condição</span><select className={input} value={data.condition} onChange={e => update('condition', e.target.value as DraftInput['condition'])}><option value="new">Novo</option><option value="used">Usado</option></select></label>
              <ManufacturingTime terms={data.saleTerms} onChange={v => update('saleTerms', v)} />
            </div>
          </div>
        </Card>
        <Photos pictures={data.pictures} editable={editable} busy={busy} status={photoStatus} onChange={v => update('pictures', v)} onUpload={files => void upload(files)} />
        <Card title="3. Categoria e ficha técnica" description="A categoria define os atributos obrigatórios e a tarifa do Mercado Livre.">
          <CategoryCombobox user={user} base={base} value={data.categoryId} title={data.title} onChange={changeCategory} />
          <RequiredAttributes categoryId={data.categoryId} attributes={categoryAttributes} loading={categoryAttributesLoading} error={categoryAttributesError}
            values={data.attributes} missing={missingRequiredAttributes} onChange={updateCategoryAttribute} />
          <div className="mt-6 pt-5 border-t border-slate-100 space-y-6">
            <AttributeGrid title="Ficha técnica do produto" name="Atributos adicionais" addLabel="Adicionar outro atributo" values={data.attributes} hiddenIds={requiredAttributeIds} onChange={v => update('attributes', v)}>
              <Warranty terms={data.saleTerms} onChange={v => update('saleTerms', v)} />
            </AttributeGrid>
            <details open={otherTerms} className="group">
              <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">Outras condições de venda (avançado)</summary>
              <div className="mt-3"><AttributeGrid title="Condições de venda" name="Condições de venda" addLabel="Adicionar condição de venda" values={data.saleTerms} hiddenIds={termIds} onChange={v => update('saleTerms', v)} /></div>
            </details>
          </div>
        </Card>
        <Card title="4. Logística e entrega">
          <div className="grid sm:grid-cols-2 gap-4 items-end">
            <label className="block"><span className={label}>Modo de envio</span>
              <select required className={input} value={shippingModeValid ? data.shipping.mode : ''} onChange={e => { const mode = e.target.value as ShippingMode; update('shipping', { ...data.shipping, mode, free_shipping: mode === 'me2' ? data.shipping.free_shipping : false }); }}>
                <option value="">Selecione um modo disponível para sua conta</option>
                {shippingModes.map(mode => <option key={mode} value={mode}>{shippingModeNames[mode]}</option>)}
              </select></label>
            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer sm:pb-2.5">
              <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-indigo-600" checked={data.shipping.local_pick_up} onChange={e => update('shipping', { ...data.shipping, local_pick_up: e.target.checked })} />
              <span>Permitir retirada em mãos</span></label>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {shippingPreferencesLoading && <p role="status" className="text-slate-500">Conferindo os modos de envio da conta…</p>}
            {shippingPreferencesError && <div role="alert" className="space-y-2 text-red-700"><p>{shippingPreferencesError}</p><button type="button" className={secondary} onClick={() => setShippingRefresh(value => value + 1)}>Consultar modos novamente</button></div>}
            {!shippingPreferencesLoading && !shippingPreferencesError && !shippingModeValid && <p role="alert" className="text-amber-800">O modo de envio salvo não está habilitado para esta conta. Escolha uma das opções disponíveis acima.</p>}
            {data.shipping.mode === 'me2' && <p className="text-xs text-slate-500">O frete grátis e as medidas da embalagem ficam no painel de precificação.</p>}
          </div>
        </Card>
      </fieldset>
      <div className="lg:col-span-4 space-y-5 lg:sticky lg:top-20 min-w-0">
        <Pricing user={user} base={base} data={data} editable={editable} busy={busy} onPriceChange={value => update('price', value)}
          onListingTypeChange={value => update('listingTypeId', value)} onFreeShippingChange={value => update('shipping', { ...data.shipping, free_shipping: value })}
          logisticType={shippingLogisticType} onLogisticTypeChange={setShippingLogisticType} logistics={shippingLogistics} />
        <section className={card} aria-label="Ações do rascunho">
          <div className="text-xs space-y-1.5 pb-3 mb-4 border-b border-slate-100">
            <p className="font-semibold text-slate-800 uppercase tracking-wide">Checklist antes de aprovar</p>
            <ul className="space-y-1.5">
              <Check ok={!!data.title.trim() && !!data.description.trim()}>Título e descrição preenchidos</Check>
              <Check ok={validPhotos > 0}>{validPhotos ? `${validPhotos} foto(s) anexada(s)` : 'Adicionar ao menos uma foto'}</Check>
              <Check ok={!!data.categoryId}>{data.categoryId ? 'Categoria do Mercado Livre selecionada' : 'Selecionar categoria do Mercado Livre'}</Check>
              {!!data.categoryId && <Check ok={!categoryAttributesLoading && !missingRequiredAttributes.length}>{missingRequiredAttributes.length ? `Preencher ${missingRequiredAttributes.length} atributo(s) obrigatório(s)` : 'Atributos obrigatórios completos'}</Check>}
              <Check ok={data.price > 0}>{data.price > 0 ? 'Preço informado' : 'Informar o preço'}</Check>
              <Check ok={shippingModeValid}>{shippingModeValid ? 'Modo de envio disponível na conta' : 'Escolher o modo de envio'}</Check>
              {dirty && <Check ok={false}>Salvar as alterações</Check>}
            </ul>
          </div>
          <div className="space-y-3 text-sm">
            {dirty && <p className="text-amber-900 text-xs">Há alterações não salvas. Salve para revisar e aprovar a nova versão.</p>}
            {draft.message && <p className="bg-slate-50 rounded-lg p-3 text-xs">{draft.message}</p>}
            {draft.itemId && <div className="text-xs"><p>Mercado Livre: {draft.itemId} · {listingStatus[draft.remoteStatus || ''] || draft.remoteStatus || 'Em conferência'}</p>{draft.itemUrl && <a className="text-indigo-700 underline" href={draft.itemUrl} target="_blank" rel="noopener noreferrer">Ver anúncio no Mercado Livre</a>}</div>}
            {error && <p role="alert" className="bg-red-50 text-red-800 rounded-lg p-3">{error}</p>}
            {notice && <p role="status" className="bg-emerald-50 text-emerald-900 rounded-lg p-3">{notice}</p>}
            {busy && <p role="status" className="text-slate-500">Aguarde a confirmação…</p>}
            {editable && draft.status === 'draft' && <button className={primary} disabled={approveBlocked} onClick={() => execute('approve')}>Validar e aprovar rascunho</button>}
            {canManage && draft.status === 'approved' && <button className={primary} disabled={publishBlocked} onClick={() => setConfirm(true)}>Publicar no Mercado Livre</button>}
            {canManage && ['attention', 'publishing'].includes(draft.status) && draft.itemId && <button className={primary} disabled={busy} onClick={() => execute('complete')}>Concluir publicação</button>}
            {confirm && !dirty && <div ref={confirmRef} tabIndex={-1} className="border border-indigo-200 bg-indigo-50 rounded-lg p-3 space-y-3" role="group" aria-label="Confirmar publicação">
              <p>Publicar <strong>{data.title}</strong> por <strong>{money(data.price)}</strong>, com {data.quantity} unidade(s), no Mercado Livre?</p>
              <p className="text-xs">O anúncio ficará disponível para venda conforme a análise do Mercado Livre. Aplicam-se as tarifas do tipo de anúncio e as condições de entrega selecionadas. O Mercado Livre poderá gerar o título a partir do nome e das características do produto.</p>
              <div className="flex flex-wrap gap-2"><button disabled={busy} className={`${primary} w-auto`} onClick={() => execute('publish')}>Confirmar publicação</button><button disabled={busy} className={secondary} onClick={() => setConfirm(false)}>Voltar à revisão</button></div>
            </div>}
            <div className={`grid gap-2 ${editable ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {editable && <button className={secondary} disabled={busy || !dirty} onClick={() => execute('save')}>Salvar alterações</button>}
              <button className={`${secondary} bg-slate-50`} title="Busca a versão mais recente do rascunho e do status no Mercado Livre" disabled={busy || dirty} onClick={() => execute('refresh')}>Conferir atualização</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </section>;
}
