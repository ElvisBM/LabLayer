import { expect, it } from 'vitest';
import { allocateLines, commercial, validateQuote } from '../../shared/quotes/model';
import { quoteCost } from '../../server/quote-cost';
import { customQuote, productQuote } from '../fixtures/quotes';
import { catalogData, printRecipe, assemblyRecipe } from '../fixtures/catalog';
import { D } from '../../shared/pricing/engine';

it('rascunho admite custo pendente; prévia exige origem e valor explícitos', () => {
  const q = customQuote();
  q.orderExpense = '';
  expect(validateQuote(q).orderExpense).toBe('');
  expect(() => commercial(q, [{ cost: '30', quantity: 3 }])).toThrow('Despesa');
  q.orderExpense = '0';
  q.expenseSource = '';
  expect(() => commercial(q, [{ cost: '30', quantity: 3 }])).toThrow('Origem');
});
it.each([
  (q: any) => q.lines.push(q.lines[0]),
  (q: any) => (q.lines[0].quantity = 1.5),
  (q: any) => (q.lines[0].quantity = 100001),
  (q: any) => (q.lines[0].productId = 'p'),
  (q: any) => (q.lines[0].referenceUrl = 'javascript:alert(1)'),
  (q: any) => (q.lines[0].referenceUrl = 'https://user:secret@example.com/'),
  (q: any) => (q.lines[0].referenceUrl = 'not-url'),
  (q: any) => (q.actorUid = 'admin'),
  (q: any) => (q.discountCents = -1),
])('recusa estrutura comercial inconsistente %#', (mutate) => {
  const q = customQuote();
  mutate(q);
  expect(() => validateQuote(q)).toThrow();
});
it('rateia proporcionalmente e fecha centavos nos itens e unidades', () => {
  const a = allocateLines(10001, [
    { cost: '10', quantity: 3 },
    { cost: '20', quantity: 7 },
  ]);
  expect(a.map((x) => x.totalCents)).toEqual([3334, 6667]);
  expect(a.reduce((s, x) => s + x.unitFloorCents * x.quantity + x.unitsWithExtraCent, 0)).toBe(
    10001,
  );
  expect(
    allocateLines(5, [
      { cost: '0', quantity: 1 },
      { cost: '0', quantity: 2 },
    ]).map((x) => x.totalCents),
  ).toEqual([2, 3]);
});
it('preço agrega custo, despesas, taxas e desconto uma vez; markup usa fator E1', () => {
  const q = customQuote();
  q.discountCents = 100;
  const c = commercial(q, [{ cost: '30', quantity: 3 }]);
  expect(c.cost).toBe('35');
  // 53.57 misses 20% by R$0.004 after the percentage fee rounds to cents.
  expect(c.price.beforeDiscountCents).toBe(5358);
  expect(c.price.priceCents).toBe(5258);
  expect(c.price.feeCents).toBe(776);
  expect(c.price.meetsTarget).toBe(false);
  q.fees = { rate: '0', perUnit: '0', perOrder: '0', source: 'Sem taxas' };
  q.discountCents = 0;
  q.target = { type: 'markup', value: '1.3' };
  expect(commercial(q, [{ cost: '30', quantity: 3 }]).price.priceCents).toBe(4550);
});
const costDocs = () => ({
  'catalogItems/p': catalogData(),
  'catalogItems/p/recipes/v1': { recipe: printRecipe(), variationId: 'blue' },
  'printers/printer': { acquisitionCost: 1000, lifespanHours: 1000, powerConsumption: 0.1 },
  'filaments/filament': { material: 'PLA' },
  'supplies/supply': { unit: 'un' },
  'stockBalances/filament~filament~': {
    item: { kind: 'filament', id: 'filament', variationId: '' },
    label: 'PLA',
    unit: 'mg',
    quantity: '10000',
    reserved: '0',
    value: '100',
    version: 1,
  },
  'stockBalances/supply~supply~': {
    item: { kind: 'supply', id: 'supply', variationId: '' },
    label: 'Caixa',
    unit: 'un',
    quantity: '100',
    reserved: '0',
    value: '50',
    version: 1,
  },
});
it('lote 10, pedido 5: confere material/energia/máquina/trabalho/insumos e explicita excedente', async () => {
  const docs = costDocs();
  const get = async (p: string) => docs[p];
  const q = productQuote();
  const full = await quoteCost(get, 'a', q);
  // 4 material + .2 energy + 2 depreciation + 2 maintenance + 4 overhead
  // + 3 setup + 2 finish + 10 supplies = 27.2 for ten produced units.
  expect(full.lines[0].cost).toBe('27.2');
  expect(full.lines[0].result.excessUnits).toBe(5);
  expect(full.cost).toBe('32.2');
  q.policy.batchAllocation = 'allocated';
  const allocated = await quoteCost(get, 'a', q);
  expect(allocated.lines[0].cost).toBe('13.6');
  expect(allocated.lines[0].result.excessProductionCost).toBe('13.6');
});
it('custo ausente não vira zero; referência exige origem e é substituída pelo custo médio disponível', async () => {
  const docs: any = costDocs();
  delete docs['stockBalances/filament~filament~'];
  const q = productQuote(),
    get = async (p: string) => docs[p];
  await expect(quoteCost(get, 'a', q)).rejects.toThrow('filament');
  q.fallbackRates = [{ kind: 'filament', id: 'filament', rate: '100', source: 'Cotação' }];
  expect((await quoteCost(get, 'a', q)).lines[0].input.runs[0].materials[0].pricePerKg).toBe('100');
  docs['stockBalances/filament~filament~'] = costDocs()['stockBalances/filament~filament~'];
  expect((await quoteCost(get, 'a', q)).lines[0].input.runs[0].materials[0].pricePerKg).toBe(
    '10000',
  );
});
it('vida útil zero e unidade de insumo incompatível impedem emissão', async () => {
  const docs: any = costDocs(),
    q = productQuote(),
    get = async (p: string) => docs[p];
  docs['printers/printer'].lifespanHours = 0;
  await expect(quoteCost(get, 'a', q)).rejects.toThrow('Vida útil');
  docs['printers/printer'].lifespanHours = 1000;
  docs['supplies/supply'].unit = 'kg';
  await expect(quoteCost(get, 'a', q)).rejects.toThrow('unidade');
});
it('cache de tarifa não ignora unidade divergente em outro item da mesma proposta', async () => {
  const docs: any = costDocs(),
    q = productQuote();
  docs['catalogItems/other'] = catalogData();
  const wrong = printRecipe();
  wrong.supplies[0].unit = 'kg';
  docs['catalogItems/other/recipes/v2'] = { recipe: wrong, variationId: 'blue' };
  q.lines.push({ ...q.lines[0], id: 'other', productId: 'other', recipeVersion: 'v2' });
  await expect(quoteCost(async (p) => docs[p], 'a', q)).rejects.toThrow('unidade');
});
it('montagem calcula componentes por fichas fixadas e não duplica custos de impressão', async () => {
  const docs: any = costDocs(),
    q = productQuote();
  const r = assemblyRecipe();
  r.components = [
    { productId: 'child', variationId: 'blue', recipeVersion: 'child-v1', quantity: 2 },
  ];
  docs['catalogItems/p/recipes/v1'].recipe = r;
  docs['catalogItems/child'] = catalogData();
  docs['catalogItems/child/recipes/child-v1'] = { variationId: 'blue', recipe: printRecipe() };
  const c = await quoteCost(async (p) => docs[p], 'a', q);
  expect(c.lines[0].cost).toBe('28.2'); // ten component units 27.2 + five assembly finishes 1
  expect(c.lines[0].result.runs[0].parts.material).toBe('0');
  expect(c.lines[0].components[0].recipeVersion).toBe('child-v1');
});
it('peça avulsa calcula sem acessar catálogo, máquina ou estoque', async () => {
  const c = await quoteCost(
    async () => {
      throw new Error('Não deve ler');
    },
    'a',
    customQuote(),
  );
  expect(c.cost).toBe('35');
  expect(new D(c.lines[0].cost).eq(30)).toBe(true);
});
