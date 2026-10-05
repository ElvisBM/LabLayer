import { D, decimal, calculatePrice, PricingError } from '../../shared/pricing/engine';
export interface PricingSettings {
  failureRate: number;
  maintenancePerMonth: number;
  monthlyUsageHours: number;
}

export interface PricingFilamentLike {
  id: string;
  pricePerKg?: number;
}

export interface PricingPrinterLike {
  id: string;
  acquisitionCost?: number;
  lifespanHours?: number;
  maintenanceBudget?: number;
  powerConsumption?: number;
  status?: 'operacional' | 'manutenção' | 'inativa';
}

export interface PricingSupplyLike {
  id: string;
  costPerUnit?: number;
}

export interface PricingVariationMaterialLike {
  filamentId?: string;
  weightGrams?: number;
  purgeGrams?: number;
}

export interface PricingWasteLike {
  filamentId?: string;
  weightGrams?: number;
  includeInCost?: boolean;
}

export interface PricingVariationLike {
  filamentId?: string;
  weightGrams?: number;
  printTimeHours?: number;
  quantityPerPrint?: number;
  materialCostPerGram?: number;
  printerCostPerHour?: number;
  printerId?: string;
  materials?: PricingVariationMaterialLike[];
}

export interface PricingSupplyUsageLike {
  supplyId: string;
  quantityPerProduct: number;
}

export interface PricingBreakdown {
  calculationVersion: string;
  complete: boolean;
  issues: string[];
  totalDecimal: string;
  materialCostPerUnit: number;
  timeCostPerUnit: number;
  supplyCostPerUnit: number;
  fixedCost: number;
  failureAdjustmentPerUnit: number;
  printerCostPerHour: number;
  operationalOverheadPerHour: number;
  subtotal: number;
  total: number;
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  failureRate: 5,
  maintenancePerMonth: 150,
  monthlyUsageHours: 160,
};

// Missing settings keep the documented legacy defaults; an explicit zero stays zero.
export const normalizePricingSettings = (raw?: Partial<PricingSettings> | null): PricingSettings => ({
  failureRate: Number(raw?.failureRate ?? DEFAULT_PRICING_SETTINGS.failureRate),
  maintenancePerMonth: Number(raw?.maintenancePerMonth ?? DEFAULT_PRICING_SETTINGS.maintenancePerMonth),
  monthlyUsageHours: Number(raw?.monthlyUsageHours ?? DEFAULT_PRICING_SETTINGS.monthlyUsageHours),
});
export const LEGACY_COST_VERSION = 'legacy-compatible-v2';
export type VariationCostInput = {
  variation: PricingVariationLike; fixedCost: number; filaments: PricingFilamentLike[];
  supplies?: PricingSupplyLike[]; supplyUsages?: PricingSupplyUsageLike[]; wastes?: PricingWasteLike[];
  printers?: PricingPrinterLike[]; energyPrice: number; pricingSettings: PricingSettings;
};

// Compatibility only: fixed costs/wastes remain per unit, reserve on the whole subtotal.
// These legacy assumptions are NOT a confirmed recipe for the canonical v1 engine.
export function calculateVariationUnitCostBreakdown({ variation, fixedCost, filaments, supplies = [], supplyUsages = [], wastes = [], printers = [], energyPrice, pricingSettings }: VariationCostInput): PricingBreakdown {
  const issues: string[] = [];
  const read = (value: unknown, field: string) => {
    try { return decimal(value, field); }
    catch (error) { issues.push((error as Error).message); return new D(0); }
  };
  const pricePerGram = (id: string | undefined) => {
    const filament = filaments.find(f => f.id === id);
    return read(filament?.pricePerKg, `Preço do filamento ${id || 'não selecionado'}`).div(1000);
  };
  const materials = variation.materials?.length ? variation.materials : [{ filamentId: variation.filamentId, weightGrams: variation.weightGrams }];
  const materialCost = materials.reduce((sum, m) => {
    const price = m.filamentId ? pricePerGram(m.filamentId) : read(variation.materialCostPerGram, 'Custo manual do material/g');
    return sum.plus(read(m.weightGrams, 'Peso').plus(read(m.purgeGrams ?? 0, 'Purga')).times(price));
  }, new D(0));
  const yieldValue = read(variation.quantityPerPrint, 'Unidades por impressão');
  if (!yieldValue.isInteger() || yieldValue.lt(1)) issues.push('Unidades por impressão devem ser inteiras e maiores que zero.');
  const quantity = yieldValue.gte(1) ? yieldValue : new D(1);
  const hours = read(variation.printTimeHours, 'Tempo de impressão');
  let printerCost = new D(0);
  if (variation.printerId) {
    const printer = printers.find(p => p.id === variation.printerId);
    if (!printer) issues.push('Impressora selecionada não encontrada.');
    else {
      if (printer.status === 'inativa' || printer.status === 'manutenção') issues.push('Impressora selecionada indisponível.');
      const life = read(printer.lifespanHours, 'Vida útil da impressora');
      if (life.lte(0)) issues.push('Vida útil deve ser maior que zero.');
      printerCost = read(printer.acquisitionCost, 'Valor da impressora').div(life.gt(0) ? life : 1)
        .plus(read(printer.powerConsumption, 'Potência legada em kW').times(read(energyPrice, 'Tarifa de energia')));
    }
  } else printerCost = read(variation.printerCostPerHour, 'Selecione impressora ou informe custo manual/h');
  const monthlyHours = read(pricingSettings.monthlyUsageHours, 'Horas mensais');
  const maintenance = read(pricingSettings.maintenancePerMonth, 'Manutenção mensal');
  if (maintenance.gt(0) && monthlyHours.lte(0)) issues.push('Manutenção mensal exige horas produtivas maiores que zero.');
  const overhead = monthlyHours.gt(0) ? maintenance.div(monthlyHours) : new D(0);
  const materialUnit = materialCost.div(quantity), timeUnit = hours.times(printerCost.plus(overhead)).div(quantity);
  const supplyUnit = supplyUsages.reduce((sum, u) => sum.plus(read(u.quantityPerProduct, 'Quantidade de insumo')
    .times(read(supplies.find(s => s.id === u.supplyId)?.costPerUnit, `Custo do insumo ${u.supplyId}`))), new D(0));
  const waste = wastes.filter(w => w.includeInCost).reduce((sum, w) => sum.plus(read(w.weightGrams, 'Perda').times(pricePerGram(w.filamentId))), new D(0));
  const fixed = read(fixedCost, 'Custo fixo').plus(waste);
  const subtotal = materialUnit.plus(timeUnit).plus(supplyUnit).plus(fixed);
  const rate = read(pricingSettings.failureRate, 'Reserva percentual');
  if (rate.gt(100)) issues.push('Reserva deve estar entre 0% e 100%.');
  const reserve = subtotal.times(rate.div(100)), total = subtotal.plus(reserve);
  if (total.gt('1000000000000')) issues.push('Custo calculado excede o limite suportado.');
  return { calculationVersion: LEGACY_COST_VERSION, complete: issues.length === 0, issues: [...new Set(issues)], totalDecimal: total.toFixed(),
    materialCostPerUnit: materialUnit.toNumber(), timeCostPerUnit: timeUnit.toNumber(), supplyCostPerUnit: supplyUnit.toNumber(),
    fixedCost: fixed.toNumber(), failureAdjustmentPerUnit: reserve.toNumber(), printerCostPerHour: printerCost.toNumber(),
    operationalOverheadPerHour: overhead.toNumber(), subtotal: subtotal.toNumber(), total: total.toNumber() };
}

export function suggestedPrice(cost: number | string, quantity = 1, multiplier = '2.2') {
  return calculatePrice({ cost: decimal(cost, 'Custo').times(quantity).toFixed(), quantity, fees: [], target: { type: 'markup', value: multiplier } }).priceCents / 100;
}
export type LegacyTargetType = 'profit' | 'margin' | 'markup' | 'custom';
export type LegacyChannel = { commissionPercent?: number; fixedFee?: number; averageShipping?: number; affiliateCommission?: number; status?: string };
export function calculateChannelPrice(cost: number | string, channel: LegacyChannel, targetType: LegacyTargetType, targetValue: number, includeAffiliate = false) {
  if (channel.status === 'inativo') throw new PricingError('Canal inativo.');
  const coveredCost = decimal(cost, 'Custo').plus(decimal(channel.averageShipping ?? 0, 'Frete'));
  const commission = decimal(channel.commissionPercent ?? 0, 'Comissão').div(100);
  const affiliate = includeAffiliate ? decimal(channel.affiliateCommission ?? 0, 'Afiliados').div(100) : new D(0);
  const value = decimal(targetValue, 'Meta');
  const target = { type: targetType === 'custom' ? 'manual' as const : targetType, value: (targetType === 'margin' ? value.div(100) : value).toFixed() };
  const input = { cost: coveredCost.toFixed(), quantity: 1, fees: [
    { id: 'commission', rate: commission.toFixed(), basis: 'gross' as const },
    { id: 'affiliate', rate: affiliate.toFixed(), basis: 'gross' as const },
    { id: 'fixed', amount: decimal(channel.fixedFee ?? 0, 'Taxa fixa').toFixed(), incidence: 'order' as const },
  ], target };
  const result = calculatePrice(input);
  const minPrice = calculatePrice({ ...input, target: { type: 'profit', value: '0' } }).priceCents / 100;
  const aggressiveTarget = targetType === 'markup' ? { type: 'markup' as const, value: D.max(1, value.minus('0.5')).toFixed() }
    : targetType === 'custom' ? { type: 'profit' as const, value: '0' } : { ...target, value: new D(target.value).div(2).toFixed() };
  const aggressivePrice = calculatePrice({ ...input, target: aggressiveTarget }).priceCents / 100;
  return { input, result, cost: coveredCost.toNumber(), finalPrice: result.priceCents / 100, totalFees: result.feeCents / 100,
    percentFeesAmount: result.feeLines.filter(f => f.id !== 'fixed').reduce((a, f) => a + f.cents, 0) / 100,
    netRevenue: Number(result.netRevenue), netProfit: Number(result.profit),
    realMargin: result.margin === null ? null : new D(result.margin).times(100).toNumber(),
    realMarkup: coveredCost.isZero() ? null : new D(result.netRevenue).div(coveredCost).toNumber(), minPrice, aggressivePrice };
}
