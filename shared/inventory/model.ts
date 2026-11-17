import { D } from '../pricing/engine';
import { CatalogError, id, record, textValue, integer, type Recipe } from '../catalog/model';

export const INVENTORY_VERSION = 'inventory-v1';
export const MAX_LINES = 40;
export type Item = { kind: 'filament' | 'supply' | 'product'; id: string; variationId: string };
export type Line = { item: Item; quantity: string };
export type Balance = {
  item: Item;
  unit: string;
  label: string;
  quantity: string;
  reserved: string;
  value: string;
  version: number;
};
export function item(raw: unknown): Item {
  const x = record(raw, ['kind', 'id', 'variationId'], 'Item');
  if (!['filament', 'supply', 'product'].includes(x.kind))
    throw new CatalogError('Tipo de item inválido.');
  if (x.kind !== 'product' && x.variationId !== '')
    throw new CatalogError('Material não tem variação.');
  return { kind: x.kind, id: id(x.id), variationId: x.kind === 'product' ? id(x.variationId) : '' };
}
export const itemKey = (x: Item) => `${x.kind}~${x.id}~${x.variationId}`;
export function amount(raw: unknown, field = 'Quantidade', decimals = 6): string {
  if (typeof raw !== 'string' || raw.length > 40 || !/^\d+(\.\d+)?$/.test(raw))
    throw new CatalogError(`${field}: decimal não negativo obrigatório.`);
  const n = new D(raw);
  if (n.gt('1000000000000') || n.decimalPlaces() > decimals)
    throw new CatalogError(`${field}: valor ou precisão excedidos.`);
  return n.toFixed();
}
export const money = (raw: unknown) => amount(raw, 'Valor em reais', 12);
export function quantity(raw: unknown, x: Item, positive = false): string {
  const q = amount(raw, 'Quantidade', x.kind === 'supply' ? 6 : 0);
  if (positive && new D(q).lte(0)) throw new CatalogError('Quantidade deve ser maior que zero.');
  return q;
}
export function lines(raw: unknown, positive = true): Line[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_LINES)
    throw new CatalogError(`Informe de 1 a ${MAX_LINES} itens por operação.`);
  const result = raw.map((v) => {
    const x = record(v, ['item', 'quantity'], 'Linha');
    const i = item(x.item);
    return { item: i, quantity: quantity(x.quantity, i, positive) };
  });
  if (new Set(result.map((l) => itemKey(l.item))).size !== result.length)
    throw new CatalogError('Item repetido.');
  return result;
}
export function validateBalance(b: Balance): Balance {
  quantity(b.quantity, b.item);
  quantity(b.reserved, b.item);
  money(b.value);
  if (new D(b.reserved).gt(b.quantity)) throw new CatalogError('Saldo disponível insuficiente.');
  if (new D(b.quantity).isZero() && !new D(b.value).isZero())
    throw new CatalogError('Saldo zero deve ter valor zero.');
  return b;
}
export const available = (b: Balance) => new D(b.quantity).minus(b.reserved).toFixed();
export function reserve(b: Balance, q: string): Balance {
  quantity(q, b.item);
  return validateBalance({ ...b, reserved: new D(b.reserved).plus(q).toFixed() });
}
export function release(b: Balance, q: string): Balance {
  quantity(q, b.item);
  if (new D(q).gt(b.reserved)) throw new CatalogError('Liberação supera a reserva.');
  return validateBalance({ ...b, reserved: new D(b.reserved).minus(q).toFixed() });
}
export function receive(b: Balance, q: string, value: string): Balance {
  quantity(q, b.item);
  money(value);
  return validateBalance({
    ...b,
    quantity: new D(b.quantity).plus(q).toFixed(),
    value: new D(b.value).plus(value).toFixed(),
  });
}
export function consume(b: Balance, q: string): { balance: Balance; cost: string } {
  quantity(q, b.item);
  if (new D(q).isZero()) return { balance: b, cost: '0' };
  if (new D(q).gt(available(b)))
    throw new CatalogError('Saldo disponível insuficiente; confira reservas e consumo adicional.');
  const cost = new D(q).eq(b.quantity)
    ? b.value
    : new D(b.value)
        .times(q)
        .div(b.quantity || '1')
        .toDecimalPlaces(12)
        .toFixed();
  return {
    balance: validateBalance({
      ...b,
      quantity: new D(b.quantity).minus(q).toFixed(),
      value: new D(b.value).minus(cost).toFixed(),
    }),
    cost,
  };
}
export function requirements(recipe: Recipe, runs: number): Line[] {
  integer(runs, 'Execuções', 1);
  const map = new Map<string, Line>();
  const add = (i: Item, q: string) => {
    const key = itemKey(i),
      previous = map.get(key)?.quantity ?? '0';
    map.set(key, { item: i, quantity: new D(previous).plus(q).toFixed() });
  };
  for (const m of recipe.materials)
    add(
      { kind: 'filament', id: m.filamentId, variationId: '' },
      new D(m.totalMg).times(runs).toFixed(),
    );
  for (const c of recipe.components)
    add(
      { kind: 'product', id: c.productId, variationId: c.variationId },
      new D(c.quantity).times(runs).toFixed(),
    );
  for (const s of recipe.supplies)
    add(
      { kind: 'supply', id: s.supplyId, variationId: '' },
      new D(s.quantityPerUnit).times(recipe.goodUnits).times(runs).toFixed(),
    );
  return lines([...map.values()]);
}
export function conversion(raw: unknown) {
  const x = record(
    raw,
    ['energy', 'labor', 'machine', 'other', 'source'],
    'Custos de conversão confirmados',
  );
  const result = {
    energy: money(x.energy),
    labor: money(x.labor),
    machine: money(x.machine),
    other: money(x.other),
    source: textValue(x.source, 'Origem dos custos', 500),
  };
  return {
    ...result,
    total: new D(result.energy)
      .plus(result.labor)
      .plus(result.machine)
      .plus(result.other)
      .toFixed(),
  };
}
export function reconcile(
  balances: Record<string, Balance>,
  events: Array<{
    deltas: Array<{ key: string; quantity: string; reserved: string; value: string }>;
  }>,
  reservations: Array<{ status: string; lines: Line[] }>,
) {
  const totals = new Map<
    string,
    {
      quantity: InstanceType<typeof D>;
      reserved: InstanceType<typeof D>;
      value: InstanceType<typeof D>;
    }
  >();
  const held = new Map<string, InstanceType<typeof D>>();
  for (const e of events)
    for (const d of e.deltas) {
      const v = totals.get(d.key) ?? { quantity: new D(0), reserved: new D(0), value: new D(0) };
      v.quantity = v.quantity.plus(d.quantity);
      v.reserved = v.reserved.plus(d.reserved);
      v.value = v.value.plus(d.value);
      totals.set(d.key, v);
    }
  for (const r of reservations)
    if (r.status === 'active')
      for (const l of r.lines)
        held.set(itemKey(l.item), (held.get(itemKey(l.item)) ?? new D(0)).plus(l.quantity));
  const discrepancies: string[] = [];
  for (const key of new Set([...Object.keys(balances), ...totals.keys(), ...held.keys()])) {
    const b = balances[key],
      t = totals.get(key);
    if (
      !b ||
      !t ||
      !t.quantity.eq(b.quantity) ||
      !t.reserved.eq(b.reserved) ||
      !t.value.eq(b.value)
    )
      discrepancies.push(`${key}: projeção diverge dos movimentos.`);
    if (!b || !(held.get(key) ?? new D(0)).eq(b.reserved))
      discrepancies.push(`${key}: reserva diverge dos vínculos ativos.`);
    if (b) {
      try {
        validateBalance(b);
      } catch {
        discrepancies.push(`${key}: saldo inválido.`);
      }
    }
  }
  return { consistent: discrepancies.length === 0, discrepancies };
}
