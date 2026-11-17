import { expect, it } from 'vitest';
import { D } from '../../shared/pricing/engine';
import {
  amount,
  available,
  consume,
  conversion,
  item,
  itemKey,
  lines,
  receive,
  reconcile,
  release,
  requirements,
  reserve,
  validateBalance,
  type Balance,
} from '../../shared/inventory/model';
import { printRecipe } from '../fixtures/catalog';
const b = (): Balance => ({
  item: { kind: 'filament', id: 'f', variationId: '' },
  label: 'PLA',
  unit: 'mg',
  quantity: '1000',
  reserved: '0',
  value: '100',
  version: 1,
});
it('reserva altera disponível, sem mudar físico nem valor', () => {
  const r = reserve(b(), '600');
  expect(r.quantity).toBe('1000');
  expect(r.value).toBe('100');
  expect(available(r)).toBe('400');
  expect(() => reserve(r, '401')).toThrow();
  expect(release(r, '600')).toEqual(b());
  expect(() => release(r, '601')).toThrow();
});
it('compra soma valor e quantidade; consumo usa média móvel e zera valor na última saída', () => {
  const incoming = receive(b(), '1000', '300');
  expect(consume(incoming, '500')).toMatchObject({
    cost: '100',
    balance: { quantity: '1500', value: '300' },
  });
  expect(consume(incoming, '2000')).toMatchObject({
    cost: '400',
    balance: { quantity: '0', value: '0' },
  });
});
it('saídas fracionárias conservam cada parcela de valor, incluindo resíduo na última', () => {
  let current: Balance = { ...b(), quantity: '3', value: '1' };
  let total = new D(0);
  for (let i = 0; i < 3; i++) {
    const out = consume(current, '1');
    total = total.plus(out.cost);
    current = out.balance;
  }
  expect(total.toFixed()).toBe('1');
  expect(current.value).toBe('0');
  expect(current.quantity).toBe('0');
});
it('consumo não invade reserva de outra execução e aceita zero explícito sem NaN', () => {
  expect(() => consume(reserve(b(), '900'), '101')).toThrow();
  expect(consume({ ...b(), quantity: '0', value: '0' }, '0').cost).toBe('0');
});
it('saldo físico, reserva e valor inválidos são recusados', () => {
  for (const patch of [
    { quantity: '-1' },
    { quantity: '1.2' },
    { reserved: '1001' },
    { quantity: '0' },
    { value: 'NaN' },
  ])
    expect(() => validateBalance({ ...b(), ...patch })).toThrow();
});
it('item é identificado por tipo/ID/variação, sem colisões por nome', () => {
  expect(itemKey(item({ kind: 'product', id: 'same', variationId: 'blue' }))).not.toBe(
    itemKey(item({ kind: 'product', id: 'same', variationId: 'red' })),
  );
  expect(() => item({ kind: 'filament', id: 'f', variationId: 'v' })).toThrow();
});
it('linhas recusam repetição, precisão física inválida e operações excessivas', () => {
  const l = { item: b().item, quantity: '0.4' };
  expect(() => lines([l])).toThrow();
  expect(() =>
    lines([
      { ...l, quantity: '1' },
      { ...l, quantity: '1' },
    ]),
  ).toThrow();
  expect(() =>
    lines(
      Array.from({ length: 41 }, (_, n) => ({ item: { ...b().item, id: `f${n}` }, quantity: '1' })),
    ),
  ).toThrow();
});
it('insumo fracionário conserva seis casas e recusa arredondamento silencioso', () => {
  const supply = { kind: 'supply', id: 's', variationId: '' };
  expect(lines([{ item: supply, quantity: '0.000001' }])[0].quantity).toBe('0.000001');
  expect(() => lines([{ item: supply, quantity: '0.0000001' }])).toThrow();
  expect(() => amount('1e3')).toThrow();
  expect(() => amount('1,2')).toThrow();
});
it('plano usa peso total da ficha sem duplicar suporte/purga e agrega filamento repetido', () => {
  const recipe = printRecipe();
  recipe.materials.push({ ...recipe.materials[0], id: 'other' });
  expect(requirements(recipe, 2)).toEqual([
    { item: { kind: 'filament', id: 'filament', variationId: '' }, quantity: '1600' },
    { item: { kind: 'supply', id: 'supply', variationId: '' }, quantity: '40' },
  ]);
});
it('custo de conversão exige todas as parcelas e origem, inclusive zeros explícitos', () => {
  expect(
    conversion({ energy: '1', labor: '2', machine: '3', other: '0', source: 'Apuração' }).total,
  ).toBe('6');
  expect(() => conversion({ energy: '1', labor: '2', source: 'X' })).toThrow();
});
it('conciliação compara movimentos, projeção e reservas ativas sem alterar dados', () => {
  const balance = reserve(b(), '100'),
    key = itemKey(b().item);
  const events = [{ deltas: [{ key, quantity: '1000', reserved: '100', value: '100' }] }];
  const reservations = [{ status: 'active', lines: [{ item: b().item, quantity: '100' }] }];
  expect(reconcile({ [key]: balance }, events, reservations)).toEqual({
    consistent: true,
    discrepancies: [],
  });
  expect(reconcile({ [key]: { ...balance, value: '101' } }, events, reservations).consistent).toBe(
    false,
  );
  expect(reconcile({ [key]: balance }, events, []).consistent).toBe(false);
  expect(reconcile({}, events, reservations).consistent).toBe(false);
  expect(balance.reserved).toBe('100');
});
