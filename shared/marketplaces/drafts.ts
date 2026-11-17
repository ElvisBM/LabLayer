export type DraftAttribute = { id: string; value_name?: string; value_id?: string };
export type DraftInput = {
  externalId: string; title: string; description: string; price: number; quantity: number;
  pictures: string[]; categoryId: string; condition: 'new' | 'used';
  listingTypeId: 'gold_special' | 'gold_pro'; attributes: DraftAttribute[]; saleTerms: DraftAttribute[];
  shipping: { mode: 'me1' | 'me2' | 'custom' | 'not_specified'; local_pick_up: boolean; free_shipping: boolean };
};
export type ListingDraft = {
  id: string; data: DraftInput; revision: number; status: 'draft' | 'approved' | 'publishing' | 'published' | 'attention';
  createdAt: string; updatedAt: string; itemId?: string; itemUrl?: string; remoteStatus?: string; message?: string;
};
export const draftStatuses: Record<ListingDraft['status'], string> = {
  draft: 'Aguardando revisão', approved: 'Aprovado para publicar', publishing: 'Publicação em andamento',
  published: 'Enviado ao Mercado Livre', attention: 'Conferir publicação',
};
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (s: string): never => { throw new Error(s); };
function text(v: unknown, name: string, max: number, required = false) {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim())) fail(`${name}: texto inválido.`);
  return (v as string).trim();
}
export function validPictureUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.includes('.') &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) && !u.hostname.endsWith('.local');
  } catch { return false; }
}
function attributes(v: unknown): DraftAttribute[] {
  if (!Array.isArray(v) || v.length > 100) fail('Informe até 100 atributos.');
  const ids = new Set<string>();
  return (v as unknown[]).map(a => {
    if (!record(a) || Object.keys(a).some(k => !['id', 'value_id', 'value_name'].includes(k)) || !/^[A-Z0-9_]{1,80}$/.test(a.id) || ids.has(a.id)) fail('Atributo inválido ou repetido.');
    const attr = a as Record<string, any>; ids.add(attr.id);
    if (attr.value_id === undefined && attr.value_name === undefined) fail('Informe o valor do atributo.');
    return { id: attr.id, ...(attr.value_id === undefined ? {} : { value_id: text(attr.value_id, 'ID do valor', 100, true) }),
      ...(attr.value_name === undefined ? {} : { value_name: text(attr.value_name, 'Valor do atributo', 500, true) }) };
  });
}
export function normalizeDraft(v: unknown): DraftInput {
  if (!record(v)) fail('Envie um objeto JSON.');
  const b = v as Record<string, any>;
  const fields = ['externalId','title','description','price','quantity','pictures','categoryId','condition','listingTypeId','attributes','saleTerms','shipping'];
  if (Object.keys(b).some(k => !fields.includes(k))) fail('Campo não permitido no rascunho.');
  const externalId = text(b.externalId, 'Referência', 100, true);
  if (!/^[\w.-]+$/.test(externalId)) fail('Referência: use letras, números, ponto, hífen ou sublinhado.');
  if (typeof b.price !== 'number' || !Number.isFinite(b.price) || b.price < 0 || b.price > 99999999 || Math.abs(b.price * 100 - Math.round(b.price * 100)) > 0.000001) fail('Preço inválido: informe um número com até duas casas decimais.');
  if (!Number.isSafeInteger(b.quantity) || b.quantity < 1 || b.quantity > 999999) fail('Quantidade deve ser um inteiro de 1 a 999999.');
  const pictures = Array.isArray(b.pictures) ? b.pictures.map((p: unknown) => typeof p === 'string' ? p.trim() : p).filter((p: unknown) => p !== '') : b.pictures;
  if (!Array.isArray(pictures) || pictures.length > 12 || pictures.some((p: unknown) => typeof p !== 'string' || p.length > 2000 || !validPictureUrl(p))) fail('Fotos: informe até 12 URLs HTTPS públicas.');
  const categoryId = text(b.categoryId ?? '', 'Categoria', 30);
  if (categoryId && !/^MLB\d+$/.test(categoryId)) fail('Categoria deve ser um código MLB seguido de números.');
  const condition = b.condition ?? 'new', listingTypeId = b.listingTypeId ?? 'gold_special';
  if (!['new','used'].includes(condition) || !['gold_special','gold_pro'].includes(listingTypeId)) fail('Condição ou tipo de anúncio inválido.');
  const shipping = b.shipping ?? { mode: 'me2', local_pick_up: false, free_shipping: false };
  if (!record(shipping) || Object.keys(shipping).some(k => !['mode','local_pick_up','free_shipping'].includes(k)) ||
      !['me1','me2','custom','not_specified'].includes(shipping.mode) || typeof shipping.local_pick_up !== 'boolean' || typeof shipping.free_shipping !== 'boolean') fail('Configuração de entrega inválida.');
  return { externalId, title: text(b.title, 'Título', 60, true), description: text(b.description ?? '', 'Descrição', 5000), price: b.price,
    quantity: b.quantity, pictures: [...pictures], categoryId, condition, listingTypeId, attributes: attributes(b.attributes ?? []), saleTerms: attributes(b.saleTerms ?? []),
    shipping: { mode: shipping.mode, local_pick_up: shipping.local_pick_up, free_shipping: shipping.free_shipping } };
}
export function publicationPayload(data: DraftInput, userProducts: boolean) {
  if (!data.categoryId || data.price <= 0 || !data.pictures.length || !data.description) fail('Complete categoria, preço, fotos e descrição antes de aprovar.');
  return { ...(userProducts ? { family_name: data.title } : { title: data.title }), category_id: data.categoryId, price: data.price,
    currency_id: 'BRL', available_quantity: data.quantity, buying_mode: 'buy_it_now', condition: data.condition, listing_type_id: data.listingTypeId,
    pictures: data.pictures.map(source => ({ source })), attributes: data.attributes, sale_terms: data.saleTerms, shipping: data.shipping };
}
