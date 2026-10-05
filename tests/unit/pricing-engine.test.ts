import { describe, expect, it } from 'vitest';
import { allocateCents, calculateCost, calculatePrice, D, type CostInput, type PriceInput } from '../../shared/pricing/engine';
import { goldenCost } from '../fixtures/pricing';
const price = (overrides: Partial<PriceInput> = {}) => calculatePrice({ cost: '42.89', quantity: 10,
  fees: [{ id: 'commission', rate: '0.1', basis: 'gross' }, { id: 'fixed', amount: '2', incidence: 'order' }],
  target: { type: 'margin', value: '0.2' }, ...overrides });

describe('E1 contrato de custo', () => {
  it('reproduz cada parcela do exemplo independente de homologação', () => {
    const result = calculateCost(goldenCost());
    expect(result.runs[0]).toEqual({ id: 'run1', goodUnits: 10,
      parts: { material: '15', energy: '0.2', depreciation: '0.4', maintenance: '0.2', overhead: '1', setup: '5' },
      base: '21.8', reserve: '1.09', total: '22.89' });
    expect(result).toMatchObject({ finish: '10', supplies: '5', productionCost: '37.89', orderCost: '42.89', unitProductionCost: '3.789', excessProductionCost: '0' });
  });
  it('preserva precisão subgrama e não soma purga duas vezes', () => {
    const input = goldenCost();
    input.runs[0].materials = [{ materialId: 'f', totalMg: 400, pricePerKg: '100', source: 'manual', parts: { pieceMg: 300, supportMg: 0, purgeMg: 100 } }];
    expect(calculateCost(input).runs[0].parts.material).toBe('0.04');
    input.runs[0].materials[0].parts!.purgeMg = 101;
    expect(() => calculateCost(input)).toThrow(/reconciliam/);
  });
  it('aceita preço zero explícito e recusa preço desconhecido', () => {
    const input = goldenCost(); input.runs[0].materials[0].pricePerKg = '0';
    expect(calculateCost(input).runs[0].parts.material).toBe('0');
    delete input.runs[0].materials[0].pricePerKg;
    expect(() => calculateCost(input)).toThrow(/preço/);
  });
  it('aloca excedente ao estoque previsto sem cobrar unidades extras', () => {
    const input = goldenCost(); input.orderedUnits = 6; input.lotPolicy = 'conservative-full-runs';
    expect(calculateCost(input)).toMatchObject({ excessUnits: 4, allocatedProductionCost: '22.734', excessProductionCost: '15.156', orderCost: '27.734' });
  });
  it('distingue adicionais por unidade, execução e pedido em várias mesas', () => {
    const input = goldenCost(); input.runs.push({ ...structuredClone(input.runs[0]), id: 'run2' }); input.orderedUnits = 20;
    input.extras = [{ id: 'u', amount: '1', incidence: 'unit', source: 'manual' }, { id: 'r', amount: '2', incidence: 'run', source: 'manual' }, { id: 'o', amount: '3', incidence: 'order', source: 'manual' }];
    expect(calculateCost(input)).toMatchObject({ productionExtras: '24', orderExtras: '3', orderCost: '102.78' });
  });
  it('custo real inclui execução perdida sem acrescentar reserva estimada', () => {
    const input = goldenCost(); input.mode = 'actual'; input.risk = { mode: 'none', rate: '0', eligible: [] };
    input.runs.push({ ...structuredClone(input.runs[0]), id: 'failed', goodUnits: 0 });
    expect(calculateCost(input)).toMatchObject({ producedUnits: 10, productionCost: '58.6', orderCost: '63.6' });
    input.runs[0].goodUnits = 0; input.orderedUnits = 0; input.extras = [];
    expect(calculateCost(input)).toMatchObject({ unitProductionCost: null, lossCost: '43.6', orderCost: '0', excessProductionCost: '0' });
  });
  it.each<[string, (x: CostInput) => void]>([
    ['vida útil zero', x => { x.runs[0].printer.lifespanHours = '0'; }],
    ['quantidade fracionada', x => { x.runs[0].goodUnits = 1.2; }],
    ['quantidade sem capacidade', x => { x.orderedUnits = 11; }],
    ['mesa duplicada', x => { x.runs.push(x.runs[0]); }],
    ['origem ausente', x => { delete x.runs[0].printer.source; }],
    ['massa negativa', x => { x.runs[0].materials[0].totalMg = -1; }],
    ['reserva sobre custo real', x => { x.mode = 'actual'; }],
    ['reserva duplicada', x => { x.risk.eligible.push('material'); }],
    ['NaN', x => { x.finishLaborPerHour = 'NaN'; }],
    ['infinito', x => { x.runs[0].energyPricePerKwh = 'Infinity'; }],
  ])('recusa %s', (_, mutate) => { const x = goldenCost(); mutate(x); expect(() => calculateCost(x)).toThrow(); });
});

describe('E1 contrato comercial', () => {
  it('preço, comissão arredondada, lucro e rateio fecham o exemplo', () => {
    const result = price();
    expect(result).toMatchObject({ priceCents: 6413, feeCents: 841, profit: '12.83', meetsTarget: true });
    expect(Number(result.margin)).toBeCloseTo(.20006237, 8);
    expect(allocateCents(result.priceCents, 10)).toEqual([642, 642, 642, 641, 641, 641, 641, 641, 641, 641]);
  });
  it('sobe centavo necessário para preservar margem após arredondar comissão', () => {
    const result = price({ cost: '1', quantity: 1, fees: [{ id: 'f', rate: '0.1', basis: 'gross' }], target: { type: 'margin', value: '0.2' } });
    expect(result.priceCents).toBe(143); expect(result.meetsTarget).toBe(true);
    expect(price({ cost: '0.01', fees: [], target: { type: 'margin', value: '0.2' } }).priceCents).toBe(2);
  });
  it.each(['margin', 'profit', 'markup', 'manual'] as const)('não gera NaN ou infinito no modo %s', type => {
    const result = price({ target: { type, value: type === 'margin' ? '0.2' : '2' } });
    expect(Number.isSafeInteger(result.priceCents)).toBe(true); expect(Number.isFinite(Number(result.profit))).toBe(true);
  });
  it('recusa meta inviável e base percentual não suportada', () => {
    expect(() => price({ target: { type: 'margin', value: '0.9' } })).toThrow(/inviável/);
    expect(() => price({ fees: [{ id: 'x', rate: '1', basis: 'gross' }] })).toThrow(/inviável/);
    expect(() => price({ fees: [{ id: 'x', rate: '0.1', basis: 'net' as any }] })).toThrow(/Base/);
  });
  it('desconto altera receita e taxas, não custo; zero não tem margem', () => {
    const result = price({ discountCents: 100 });
    expect(result).toMatchObject({ priceCents: 6313, feeCents: 831, profit: '11.93', meetsTarget: false });
    expect(price({ target: { type: 'manual', value: '0' } })).toMatchObject({ priceCents: 0, margin: null, profit: '-44.89' });
    expect(() => price({ discountCents: 99999 })).toThrow(/Desconto/);
  });
  it('taxa fixa por item multiplica quantidade uma única vez', () => {
    expect(price({ fees: [{ id: 'f', amount: '2', incidence: 'unit' }], target: { type: 'profit', value: '0' } })).toMatchObject({ priceCents: 6289, feeCents: 2000, profit: '0' });
  });
  it('varre combinações independentes conferindo identidade contábil e meta', () => {
    for (const cost of ['0', '0.01', '1.005', '5.628', '10000.1234']) for (const rate of ['0', '0.1', '0.3333']) for (const margin of ['0', '0.2', '0.6']) {
      const result = price({ cost, fees: [{ id: 'f', rate, basis: 'gross' }], target: { type: 'margin', value: margin } });
      const revenue = new D(result.priceCents).div(100), fee = new D(result.feeCents).div(100);
      expect(revenue.minus(fee).minus(cost).eq(result.profit)).toBe(true);
      expect(new D(result.profit).gte(revenue.times(margin))).toBe(true);
      expect(allocateCents(result.priceCents, 7).reduce((a, b) => a + b, 0)).toBe(result.priceCents);
    }
  });
});
