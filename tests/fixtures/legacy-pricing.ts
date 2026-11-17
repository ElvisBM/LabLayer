import type { VariationCostInput } from '../../src/utils/pricing';
export const fixture = (): VariationCostInput => ({ variation: { quantityPerPrint: 10, printTimeHours: 2, printerId: 'm', materials: [{ filamentId: 'f', weightGrams: 100, purgeGrams: 10 }] },
  fixedCost: 1, filaments: [{ id: 'f', pricePerKg: 100 }], printers: [{ id: 'm', acquisitionCost: 2000, lifespanHours: 10000, powerConsumption: .1, status: 'operacional' }],
  supplies: [{ id: 's', costPerUnit: 1 }], supplyUsages: [{ supplyId: 's', quantityPerProduct: 1 }], wastes: [{ filamentId: 'f', weightGrams: 20, includeInCost: true }],
  energyPrice: 1, pricingSettings: { failureRate: 5, maintenancePerMonth: 160, monthlyUsageHours: 160 } });
