import { assetId } from '../assets/model';
import { CatalogError, decimalText, id, integer, record, textValue } from '../catalog/model';
import { D, calculatePrice, type PriceTarget } from '../pricing/engine';

export type QuoteLine = {
  id: string;
  kind: 'catalog' | 'custom';
  description: string;
  quantity: number;
  productId: string;
  variationId: string;
  recipeVersion: string;
  referenceUrl: string;
  customUnitCost: string;
  costSource: string;
};
export type QuoteData = {
  customerName: string;
  customerContact: string;
  description: string;
  sourceRequestId: string;
  replacesOrderId: string;
  lines: QuoteLine[];
  policy: {
    batchAllocation: 'full-lot' | 'allocated';
    energyPricePerKwh: string;
    maintenancePerHour: string;
    overheadPerHour: string;
    laborPerHour: string;
    finishLaborPerHour: string;
    source: string;
  };
  fallbackRates: { kind: 'filament' | 'supply'; id: string; rate: string; source: string }[];
  orderExpense: string;
  expenseSource: string;
  fees: { rate: string; perOrder: string; perUnit: string; source: string };
  target: PriceTarget;
  discountCents: number;
};
const optionalId = (v: unknown) => (v === '' ? '' : id(v));
// Empty amounts are valid in a draft; the server preview requires every cost input.
const draftMoney = (v: unknown, label: string) => (v === '' ? '' : decimalText(v, label));
export function validateQuote(raw: unknown): QuoteData {
  const q = record(
    raw,
    [
      'customerName',
      'customerContact',
      'description',
      'sourceRequestId',
      'replacesOrderId',
      'lines',
      'policy',
      'fallbackRates',
      'orderExpense',
      'expenseSource',
      'fees',
      'target',
      'discountCents',
    ],
    'Orçamento',
  );
  if (!Array.isArray(q.lines) || !q.lines.length || q.lines.length > 20)
    throw new CatalogError('Orçamento exige entre 1 e 20 itens.');
  const lines = q.lines.map((raw): QuoteLine => {
    const l = record(
      raw,
      [
        'id',
        'kind',
        'description',
        'quantity',
        'productId',
        'variationId',
        'recipeVersion',
        'referenceUrl',
        'customUnitCost',
        'costSource',
      ],
      'Item',
    );
    if (!['catalog', 'custom'].includes(l.kind)) throw new CatalogError('Tipo de item inválido.');
    const url = textValue(l.referenceUrl, 'Referência visual', 2048, true);
    if (url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new CatalogError('Referência visual inválida.');
      }
      if (!assetId(url) && (parsed.protocol !== 'https:' || parsed.username || parsed.password))
        throw new CatalogError('Referência visual exige HTTPS sem credenciais.');
    }
    if (
      l.kind === 'custom' &&
      (l.productId !== '' || l.variationId !== '' || l.recipeVersion !== '')
    )
      throw new CatalogError('Peça avulsa não recebe vínculo implícito ao catálogo.');
    return {
      id: id(l.id),
      kind: l.kind,
      description: textValue(l.description, 'Descrição do item', 500),
      quantity: integer(l.quantity, 'Quantidade', 1),
      productId: optionalId(l.productId),
      variationId: optionalId(l.variationId),
      recipeVersion: optionalId(l.recipeVersion),
      referenceUrl: url,
      customUnitCost: draftMoney(l.customUnitCost, 'Custo avulso'),
      costSource: textValue(l.costSource, 'Origem do custo', 120, true),
    };
  });
  if (
    new Set(lines.map((l) => l.id)).size !== lines.length ||
    lines.reduce((s, l) => s + l.quantity, 0) > 100000
  )
    throw new CatalogError('Itens repetidos ou quantidade total acima de 100.000.');
  const p = record(
    q.policy,
    [
      'batchAllocation',
      'energyPricePerKwh',
      'maintenancePerHour',
      'overheadPerHour',
      'laborPerHour',
      'finishLaborPerHour',
      'source',
    ],
    'Política de custo',
  );
  if (!['full-lot', 'allocated'].includes(p.batchAllocation))
    throw new CatalogError('Base de lote obrigatória.');
  const policy = {
    ...p,
    source: textValue(p.source, 'Origem das tarifas', 120, true),
  } as QuoteData['policy'];
  for (const k of [
    'energyPricePerKwh',
    'maintenancePerHour',
    'overheadPerHour',
    'laborPerHour',
    'finishLaborPerHour',
  ] as const)
    policy[k] = draftMoney(p[k], k);
  if (!Array.isArray(q.fallbackRates) || q.fallbackRates.length > 50)
    throw new CatalogError('Tarifas inválidas.');
  const fallbackRates = q.fallbackRates.map((raw) => {
    const r = record(raw, ['kind', 'id', 'rate', 'source'], 'Tarifa');
    if (!['filament', 'supply'].includes(r.kind))
      throw new CatalogError('Tipo de tarifa inválido.');
    return {
      kind: r.kind,
      id: id(r.id),
      rate: decimalText(r.rate, 'Tarifa'),
      source: textValue(r.source, 'Origem da tarifa', 120),
    };
  });
  if (new Set(fallbackRates.map((r) => `${r.kind}/${r.id}`)).size !== fallbackRates.length)
    throw new CatalogError('Tarifa duplicada.');
  const f = record(q.fees, ['rate', 'perOrder', 'perUnit', 'source'], 'Taxas');
  const target = record(q.target, ['type', 'value'], 'Meta');
  if (!['margin', 'profit', 'markup', 'manual'].includes(target.type))
    throw new CatalogError('Meta inválida.');
  return {
    customerName: textValue(q.customerName, 'Cliente', 150),
    customerContact: textValue(q.customerContact, 'Contato', 150, true),
    description: textValue(q.description, 'Descrição', 2000, true),
    sourceRequestId: optionalId(q.sourceRequestId),
    replacesOrderId: optionalId(q.replacesOrderId),
    lines,
    policy,
    fallbackRates,
    orderExpense: draftMoney(q.orderExpense, 'Despesa do pedido'),
    expenseSource: textValue(q.expenseSource, 'Origem da despesa', 120, true),
    fees: {
      rate: draftMoney(f.rate, 'Taxa percentual'),
      perOrder: draftMoney(f.perOrder, 'Taxa por pedido'),
      perUnit: draftMoney(f.perUnit, 'Taxa por unidade'),
      source: textValue(f.source, 'Origem das taxas', 120, true),
    },
    target: { type: target.type, value: draftMoney(target.value, 'Meta') },
    discountCents: integer(q.discountCents, 'Desconto em centavos'),
  };
}

/** Allocate commercial cents by line cost (quantity only when every cost is zero).
 * Largest remainder is deterministic and never creates/destroys a cent. */
export function allocateLines(total: number, lines: { cost: string; quantity: number }[]) {
  if (!Number.isSafeInteger(total) || total < 0 || !lines.length)
    throw new CatalogError('Total inválido.');
  const cost = lines.reduce((s, l) => s.plus(l.cost), new D(0));
  const weights = lines.map((l) => (cost.gt(0) ? new D(l.cost) : new D(l.quantity)));
  const sum = weights.reduce((s, w) => s.plus(w), new D(0));
  const exact = weights.map((w) => w.times(total).div(sum));
  const cents = exact.map((v) => v.floor().toNumber());
  const order = exact
    .map((v, i) => ({ i, r: v.minus(cents[i]) }))
    .sort((a, b) => b.r.comparedTo(a.r) || a.i - b.i);
  const rest = total - cents.reduce((s, n) => s + n, 0);
  for (let i = 0; i < rest; i++) cents[order[i].i]++;
  return cents.map((totalCents, i) => ({
    totalCents,
    quantity: lines[i].quantity,
    unitFloorCents: Math.floor(totalCents / lines[i].quantity),
    unitsWithExtraCent: totalCents % lines[i].quantity,
  }));
}
export function commercial(q: QuoteData, lines: { cost: string; quantity: number }[]) {
  const cost = lines
    .reduce((s, l) => s.plus(l.cost), new D(decimalText(q.orderExpense, 'Despesa do pedido')))
    .toFixed();
  textValue(q.expenseSource, 'Origem da despesa (declare zero se não houver)', 120);
  textValue(q.fees.source, 'Origem das taxas (declare zero se não houver)', 120);
  const price = calculatePrice({
    cost,
    quantity: lines.reduce((s, l) => s + l.quantity, 0),
    fees: [
      { id: 'percent', rate: q.fees.rate, basis: 'gross' },
      { id: 'order', amount: q.fees.perOrder, incidence: 'order' },
      { id: 'unit', amount: q.fees.perUnit, incidence: 'unit' },
    ],
    target: q.target,
    discountCents: q.discountCents,
  });
  return { cost, price, allocations: allocateLines(price.priceCents, lines) };
}

export const blankLine = (lineId: string): QuoteLine => ({
  id: lineId,
  kind: 'custom',
  description: '',
  quantity: 1,
  productId: '',
  variationId: '',
  recipeVersion: '',
  referenceUrl: '',
  customUnitCost: '',
  costSource: '',
});
export const blankQuote = (): QuoteData => ({
  customerName: '',
  customerContact: '',
  description: '',
  sourceRequestId: '',
  replacesOrderId: '',
  lines: [blankLine('item-1')],
  policy: {
    batchAllocation: 'full-lot',
    energyPricePerKwh: '',
    maintenancePerHour: '',
    overheadPerHour: '',
    laborPerHour: '',
    finishLaborPerHour: '',
    source: '',
  },
  fallbackRates: [],
  orderExpense: '',
  expenseSource: '',
  fees: { rate: '', perOrder: '', perUnit: '', source: '' },
  target: { type: 'margin', value: '' },
  discountCents: 0,
});
