import type { CostInput } from '../../shared/pricing/engine';
export const goldenCost = (): CostInput => ({
  tenantId: 'a', currency: 'BRL', recipeVersion: 'r1', pricingPolicyVersion: 'p1',
  mode: 'estimate', lotPolicy: 'explicit-runs', orderedUnits: 10,
  runs: [{ id: 'run1', goodUnits: 10, durationSeconds: 7200,
    materials: [{ materialId: 'pla', totalMg: 150000, pricePerKg: '100', source: 'cadastro:f1',
      parts: { pieceMg: 120000, supportMg: 20000, purgeMg: 10000 } }],
    printer: { id: 'm1', source: 'cadastro:m1', powerWatts: '100', depreciableValue: '2000', lifespanHours: '10000' },
    energyPricePerKwh: '1', maintenancePerHour: '0.1', overheadPerHour: '0.5', setupSeconds: 900, laborPerHour: '20',
  }], finishSecondsPerUnit: 180, finishLaborPerHour: '20',
  supplies: [{ id: 's1', quantityPerUnit: '1', unitCost: '0.5', source: 'cadastro:s1' }],
  extras: [{ id: 'box', amount: '2', incidence: 'order', source: 'manual' }, { id: 'shipping', amount: '3', incidence: 'order', source: 'manual' }],
  risk: { mode: 'reserve', rate: '0.05', eligible: ['material', 'energy', 'depreciation', 'maintenance', 'overhead', 'setup'] },
});
