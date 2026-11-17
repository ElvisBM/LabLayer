import { expect, it } from 'vitest';
import { calculateVariationUnitCostBreakdown, calculateChannelPrice, normalizePricingSettings, suggestedPrice, type VariationCostInput } from '../../src/utils/pricing';
import { calculateRecordedSale } from '../../src/utils/sales';
import { fixture } from '../fixtures/legacy-pricing';
it('unifica o exemplo divergente sem arredondar custo antes do markup', () => {
  const b = calculateVariationUnitCostBreakdown(fixture());
  expect(b.complete).toBe(true); expect(b.totalDecimal).toBe('5.628');
  expect(suggestedPrice(b.totalDecimal)).toBe(12.39);
  expect(suggestedPrice(b.totalDecimal, 10)).toBe(123.82);
});
it('preserva zero de reserva/horas/tarifa e sinaliza rateio impossível', () => {
  expect(normalizePricingSettings({ failureRate: 0, maintenancePerMonth: 0, monthlyUsageHours: 0 })).toEqual({ failureRate: 0, maintenancePerMonth: 0, monthlyUsageHours: 0 });
  const input = fixture(); input.energyPrice = 0; input.pricingSettings = normalizePricingSettings({ failureRate: 0, maintenancePerMonth: 0, monthlyUsageHours: 0 });
  expect(calculateVariationUnitCostBreakdown(input)).toMatchObject({ complete: true, failureAdjustmentPerUnit: 0, printerCostPerHour: .2 });
  input.pricingSettings.maintenancePerMonth = 100;
  expect(calculateVariationUnitCostBreakdown(input).complete).toBe(false);
});
it('material simples usa preço cadastrado e ausente não assume zero', () => {
  const input = fixture(); input.variation = { ...input.variation, materials: [], filamentId: 'f', weightGrams: 100, materialCostPerGram: 999 };
  expect(calculateVariationUnitCostBreakdown(input).materialCostPerUnit).toBe(1);
  input.filaments = [];
  expect(calculateVariationUnitCostBreakdown(input).complete).toBe(false);
});
it('impressora ausente não usa a média da frota; manual zero explícito é válido', () => {
  const input = fixture(); delete input.variation.printerId;
  expect(calculateVariationUnitCostBreakdown(input).complete).toBe(false);
  input.variation.printerCostPerHour = 0;
  expect(calculateVariationUnitCostBreakdown(input)).toMatchObject({ complete: true, printerCostPerHour: 0 });
});
it('insumo sem preço, máquina inativa e quantidade fracionada impedem resultado completo', () => {
  const input = fixture(); input.supplies = []; input.printers![0].status = 'inativa'; input.variation.quantityPerPrint = .5;
  const result = calculateVariationUnitCostBreakdown(input);
  expect(result.complete).toBe(false); expect(result.issues.length).toBeGreaterThanOrEqual(3);
});
it('afiliados entram somente quando selecionados; taxas inviáveis não viram preço zero', () => {
  const channel = { commissionPercent: 10, affiliateCommission: 5, fixedFee: 2, averageShipping: 3 };
  const without = calculateChannelPrice('10', channel, 'margin', 20), withAffiliate = calculateChannelPrice('10', channel, 'margin', 20, true);
  expect(withAffiliate.finalPrice).toBeGreaterThan(without.finalPrice);
  expect(withAffiliate.result.feeLines.find(f => f.id === 'affiliate')!.cents).toBeGreaterThan(0);
  expect(() => calculateChannelPrice('10', channel, 'margin', 90)).toThrow(/inviável/);
});
it('venda exige custo confirmado e mantém lucro negativo quando necessário', () => {
  expect(() => calculateRecordedSale({ quantity: 2, soldPrice: 20, fees: 1, totalCost: '' })).toThrow();
  expect(calculateRecordedSale({ quantity: 2, soldPrice: 20, fees: 1, totalCost: '25.10' })).toEqual({ realCost: 25.1, realProfit: -6.1, costSource: 'manual-confirmed' });
  expect(calculateRecordedSale({ quantity: 1, soldPrice: 0, fees: 0, totalCost: '0' }).realProfit).toBe(0);
  expect(() => calculateRecordedSale({ quantity: 1.2, soldPrice: 2, fees: 0, totalCost: '0' })).toThrow();
});
