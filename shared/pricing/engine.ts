import Decimal from 'decimal.js';

// Never depend on another consumer's global Decimal configuration.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const CALCULATION_VERSION = 'lablayer-cost-v1';
export const PRICE_VERSION = 'lablayer-price-v1';
export class PricingError extends Error {}
export function decimal(value: unknown, field: string): Decimal {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '' ||
      (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value))) throw new PricingError(`${field}: valor obrigatório e não negativo.`);
  const result = new D(value);
  if (!result.isFinite() || result.isNegative() || result.gt('1000000000000')) throw new PricingError(`${field}: valor fora dos limites.`);
  return result;
}
export function count(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > 1_000_000_000) throw new PricingError(`${field}: inteiro inválido.`);
  return Number(value);
}
function label(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new PricingError(`${field}: identificação obrigatória.`);
}
function list<T>(value: T[], field: string): T[] {
  if (!Array.isArray(value) || value.length > 500) throw new PricingError(`${field}: lista inválida (máximo 500).`);
  return value;
}
const sum = (values: Decimal[]) => values.reduce((a, b) => a.plus(b), new D(0));
const cents = (value: Decimal): number => {
  const n = value.times(100).toDecimalPlaces(0).toNumber();
  if (!Number.isSafeInteger(n)) throw new PricingError('Valor comercial excede o limite de centavos.');
  return n;
};
export type Money = string;
export type CostPart = 'material' | 'energy' | 'depreciation' | 'maintenance' | 'overhead' | 'setup';
export interface CostInput {
  tenantId: string; currency: 'BRL'; recipeVersion: string; pricingPolicyVersion: string;
  mode: 'estimate' | 'actual'; lotPolicy: 'explicit-runs' | 'conservative-full-runs'; orderedUnits: number;
  runs: Array<{
    id: string; goodUnits: number; durationSeconds: number;
    materials: Array<{ materialId: string; totalMg: number; pricePerKg: Money; source: string;
      parts?: { pieceMg: number; supportMg: number; purgeMg: number } }>;
    printer: { id: string; source: string; powerWatts: Money; depreciableValue: Money; lifespanHours: Money };
    energyPricePerKwh: Money; maintenancePerHour: Money; overheadPerHour: Money;
    setupSeconds: number; laborPerHour: Money;
  }>;
  finishSecondsPerUnit: number; finishLaborPerHour: Money;
  supplies: Array<{ id: string; quantityPerUnit: Money; unitCost: Money; source: string }>;
  extras: Array<{ id: string; amount: Money; incidence: 'unit' | 'run' | 'order'; source: string }>;
  risk: { mode: 'none' | 'reserve'; rate: Money; eligible: CostPart[] };
}

/** One commercial output per run. All masses already include purge/support exactly once. */
export function calculateCost(input: CostInput) {
  for (const key of ['tenantId', 'recipeVersion', 'pricingPolicyVersion'] as const) label(input[key], key);
  if (input.currency !== 'BRL' || !['estimate', 'actual'].includes(input.mode) ||
      !['explicit-runs', 'conservative-full-runs'].includes(input.lotPolicy)) throw new PricingError('Contrato de custo inválido.');
  const ordered = count(input.orderedUnits, 'quantidade do pedido');
  const risk = input.risk;
  if (!risk || !['none', 'reserve'].includes(risk.mode)) throw new PricingError('Política de reserva inválida.');
  const rate = decimal(risk.rate, 'reserva');
  const keys: CostPart[] = ['material', 'energy', 'depreciation', 'maintenance', 'overhead', 'setup'];
  list(risk.eligible, 'base da reserva');
  if (rate.gt(1) || new Set(risk.eligible).size !== risk.eligible.length || risk.eligible.some(k => !keys.includes(k)) ||
      (risk.mode === 'none' && !rate.isZero()) || (input.mode === 'actual' && risk.mode !== 'none')) throw new PricingError('Reserva estimada não pode ser aplicada ao custo real. Confira a base e a taxa.');
  const ids = new Set<string>();
  const runs = list(input.runs, 'execuções').map(run => {
    label(run.id, 'execução');
    if (ids.has(run.id)) throw new PricingError('Execução duplicada.');
    ids.add(run.id);
    const goodUnits = count(run.goodUnits, 'unidades boas', input.mode === 'estimate' ? 1 : 0);
    const hours = new D(count(run.durationSeconds, 'duração')).div(3600);
    label(run.printer?.id, 'impressora'); label(run.printer?.source, 'origem da impressora');
    const life = decimal(run.printer.lifespanHours, 'vida útil');
    if (life.isZero()) throw new PricingError('Vida útil deve ser maior que zero.');
    const material = sum(list(run.materials, 'materiais').map(m => {
      label(m.materialId, 'material'); label(m.source, 'origem do material');
      const mg = count(m.totalMg, 'peso total');
      if (m.parts && count(m.parts.pieceMg, 'peça') + count(m.parts.supportMg, 'suporte') + count(m.parts.purgeMg, 'purga') !== mg) throw new PricingError('Peça, suporte e purga não reconciliam com o peso total.');
      return new D(mg).div(1_000_000).times(decimal(m.pricePerKg, 'preço/kg'));
    }));
    const parts: Record<CostPart, Decimal> = {
      material,
      energy: decimal(run.printer.powerWatts, 'potência W').div(1000).times(hours).times(decimal(run.energyPricePerKwh, 'energia/kWh')),
      depreciation: decimal(run.printer.depreciableValue, 'valor depreciável').div(life).times(hours),
      maintenance: decimal(run.maintenancePerHour, 'manutenção/h').times(hours),
      overhead: decimal(run.overheadPerHour, 'rateio/h').times(hours),
      setup: new D(count(run.setupSeconds, 'setup')).div(3600).times(decimal(run.laborPerHour, 'trabalho/h')),
    };
    const base = sum(Object.values(parts));
    const reserve = risk.mode === 'reserve' ? sum(risk.eligible.map(k => parts[k])).times(rate) : new D(0);
    return { id: run.id, goodUnits, parts: Object.fromEntries(keys.map(k => [k, parts[k].toFixed()])), base: base.toFixed(), reserve: reserve.toFixed(), total: base.plus(reserve).toFixed() };
  });
  if (!runs.length) throw new PricingError('Informe pelo menos uma execução.');
  const produced = runs.reduce((a, r) => a + r.goodUnits, 0);
  if (!Number.isSafeInteger(produced) || ordered > produced) throw new PricingError('Quantidade do pedido supera as unidades boas.');
  const finish = new D(count(input.finishSecondsPerUnit, 'acabamento')).div(3600).times(decimal(input.finishLaborPerHour, 'acabamento/h')).times(produced);
  const supplies = sum(list(input.supplies, 'insumos').map(s => {
    label(s.id, 'insumo'); label(s.source, 'origem do insumo');
    return decimal(s.quantityPerUnit, 'quantidade de insumo').times(decimal(s.unitCost, 'custo do insumo')).times(produced);
  }));
  let productionExtras = new D(0), orderExtras = new D(0);
  for (const extra of list(input.extras, 'adicionais')) {
    label(extra.id, 'adicional'); label(extra.source, 'origem do adicional');
    const amount = decimal(extra.amount, 'valor adicional');
    if (extra.incidence === 'order') orderExtras = orderExtras.plus(amount);
    else if (extra.incidence === 'unit') productionExtras = productionExtras.plus(amount.times(produced));
    else if (extra.incidence === 'run') productionExtras = productionExtras.plus(amount.times(runs.length));
    else throw new PricingError('Incidência do adicional é obrigatória.');
  }
  const productionCost = sum(runs.map(r => new D(r.total))).plus(finish).plus(supplies).plus(productionExtras);
  const unitCost = produced ? productionCost.div(produced) : null;
  const allocated = unitCost ? unitCost.times(ordered) : new D(0);
  return { calculationVersion: CALCULATION_VERSION, currency: input.currency, mode: input.mode,
    lotPolicy: input.lotPolicy, runs, producedUnits: produced, orderedUnits: ordered, excessUnits: produced - ordered,
    finish: finish.toFixed(), supplies: supplies.toFixed(), productionExtras: productionExtras.toFixed(), orderExtras: orderExtras.toFixed(),
    productionCost: productionCost.toFixed(), unitProductionCost: unitCost?.toFixed() ?? null,
    allocatedProductionCost: allocated.toFixed(), excessProductionCost: produced ? productionCost.minus(allocated).toFixed() : '0',
    lossCost: produced ? '0' : productionCost.toFixed(), orderCost: allocated.plus(orderExtras).toFixed(),
  };
}

export type PriceTarget = { type: 'margin' | 'profit' | 'markup' | 'manual'; value: Money };
export interface PriceInput {
  cost: Money; quantity: number;
  fees: Array<{ id: string; rate: Money; basis: 'gross' } | { id: string; amount: Money; incidence: 'unit' | 'order' }>;
  target: PriceTarget; discountCents?: number;
}
/** Rates are fractions (0.10 = 10%). Each fee is rounded separately to cents. */
export function calculatePrice(input: PriceInput) {
  const cost = decimal(input.cost, 'custo');
  const quantity = count(input.quantity, 'quantidade', 1);
  const ids = new Set<string>();
  const fees = list(input.fees, 'taxas').map(f => {
    label(f.id, 'taxa');
    if (ids.has(f.id)) throw new PricingError('Taxa duplicada.'); ids.add(f.id);
    if ('rate' in f) {
      if (f.basis !== 'gross' || 'amount' in f) throw new PricingError('Base de taxa não suportada.');
      return { id: f.id, rate: decimal(f.rate, 'taxa percentual'), fixedCents: 0 };
    }
    if (!['unit', 'order'].includes(f.incidence)) throw new PricingError('Incidência da taxa é obrigatória.');
    return { id: f.id, rate: new D(0), fixedCents: cents(decimal(f.amount, 'taxa fixa').times(f.incidence === 'unit' ? quantity : 1)) };
  });
  const rate = sum(fees.map(f => f.rate));
  const fixed = sum(fees.map(f => new D(f.fixedCents))).div(100);
  const target = decimal(input.target?.value, 'meta');
  const type = input.target?.type;
  let denominator = new D(1).minus(rate);
  if (type === 'margin') denominator = denominator.minus(target);
  if (denominator.lte(0)) throw new PricingError('Meta inviável: taxas e margem esgotam o preço.');
  let theoretical: Decimal;
  if (type === 'margin') theoretical = cost.plus(fixed).div(denominator);
  else if (type === 'profit') theoretical = cost.plus(fixed).plus(target).div(denominator);
  else if (type === 'markup') theoretical = cost.times(target).plus(fixed).div(denominator);
  else if (type === 'manual') theoretical = target;
  else throw new PricingError('Tipo de meta inválido.');
  const evaluate = (priceCents: number) => {
    if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new PricingError('Preço excede o limite de centavos.');
    const price = new D(priceCents).div(100);
    const feeLines = fees.map(f => ({ id: f.id, cents: f.fixedCents + cents(price.times(f.rate)) }));
    const feeCents = feeLines.reduce((a, f) => a + f.cents, 0);
    if (!Number.isSafeInteger(feeCents)) throw new PricingError('Taxas excedem o limite.');
    const net = price.minus(new D(feeCents).div(100));
    const profit = net.minus(cost);
    const meetsTarget = type === 'margin' ? profit.gte(price.times(target)) : type === 'profit' ? profit.gte(target) : type === 'markup' ? net.gte(cost.times(target)) : true;
    return { priceCents, feeLines, feeCents, netRevenue: net.toFixed(), profit: profit.toFixed(), margin: price.isZero() ? null : profit.div(price).toFixed(), meetsTarget };
  };
  let beforeDiscountCents = cents(theoretical);
  let attempt = evaluate(beforeDiscountCents);
  // Prevent unbounded work for pathological fee/target combinations.
  for (let i = 0; type !== 'manual' && !attempt.meetsTarget && i < 10000; i++) attempt = evaluate(++beforeDiscountCents);
  if (!attempt.meetsTarget) throw new PricingError('Meta exige ajuste excessivo de centavos. Revise as taxas.');
  const discountCents = count(input.discountCents ?? 0, 'desconto');
  if (discountCents > beforeDiscountCents) throw new PricingError('Desconto supera o preço.');
  return { calculationVersion: PRICE_VERSION, theoretical: theoretical.toFixed(), beforeDiscountCents, discountCents, ...evaluate(beforeDiscountCents - discountCents) };
}

export function allocateCents(total: number, quantity: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || count(quantity, 'quantidade', 1) > 100000) throw new PricingError('Rateio inválido.');
  const base = Math.floor(total / quantity), remainder = total % quantity;
  return Array.from({ length: quantity }, (_, i) => base + (i < remainder ? 1 : 0));
}
