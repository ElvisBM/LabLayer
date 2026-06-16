export interface PricingSettings {
  failureRate: number;
  maintenancePerMonth: number;
  monthlyUsageHours: number;
  fallbackPrinterAcquisitionCost: number;
  fallbackPrinterLifespanHours: number;
  fallbackPowerConsumptionKwh: number;
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
  fallbackPrinterAcquisitionCost: 3500,
  fallbackPrinterLifespanHours: 10000,
  fallbackPowerConsumptionKwh: 0.12,
};

export const normalizePricingSettings = (raw?: Partial<PricingSettings> | null): PricingSettings => {
  return {
    failureRate: Number(raw?.failureRate ?? DEFAULT_PRICING_SETTINGS.failureRate) || DEFAULT_PRICING_SETTINGS.failureRate,
    maintenancePerMonth: Number(raw?.maintenancePerMonth ?? DEFAULT_PRICING_SETTINGS.maintenancePerMonth) || 0,
    monthlyUsageHours: Number(raw?.monthlyUsageHours ?? DEFAULT_PRICING_SETTINGS.monthlyUsageHours) || DEFAULT_PRICING_SETTINGS.monthlyUsageHours,
    fallbackPrinterAcquisitionCost: Number(raw?.fallbackPrinterAcquisitionCost ?? DEFAULT_PRICING_SETTINGS.fallbackPrinterAcquisitionCost) || 0,
    fallbackPrinterLifespanHours: Number(raw?.fallbackPrinterLifespanHours ?? DEFAULT_PRICING_SETTINGS.fallbackPrinterLifespanHours) || DEFAULT_PRICING_SETTINGS.fallbackPrinterLifespanHours,
    fallbackPowerConsumptionKwh: Number(raw?.fallbackPowerConsumptionKwh ?? DEFAULT_PRICING_SETTINGS.fallbackPowerConsumptionKwh) || 0,
  };
};

const calculateSupplyCostPerUnit = (
  supplyUsages: PricingSupplyUsageLike[] = [],
  supplies: PricingSupplyLike[] = [],
) => {
  return supplyUsages.reduce((sum, usage) => {
    const supply = supplies.find(item => item.id === usage.supplyId);
    return sum + ((Number(usage.quantityPerProduct) || 0) * (Number(supply?.costPerUnit) || 0));
  }, 0);
};

const calculateWasteCost = (
  wastes: PricingWasteLike[] = [],
  filaments: PricingFilamentLike[] = [],
) => {
  return wastes
    .filter(waste => waste.includeInCost)
    .reduce((sum, waste) => {
      const filament = filaments.find(item => item.id === waste.filamentId);
      const costPerGram = filament ? (Number(filament.pricePerKg) || 0) / 1000 : 0;
      return sum + ((Number(waste.weightGrams) || 0) * costPerGram);
    }, 0);
};

const calculatePrinterCostPerHour = (
  variation: PricingVariationLike,
  printers: PricingPrinterLike[],
  energyPrice: number,
  pricingSettings: PricingSettings,
) => {
  const selectedPrinter = printers.find(item => item.id === variation.printerId);

  if (selectedPrinter) {
    const lifespanHours = Math.max(1, Number(selectedPrinter.lifespanHours) || pricingSettings.fallbackPrinterLifespanHours);
    const acquisitionCost = Number(selectedPrinter.acquisitionCost) || 0;
    const maintenanceBudget = Number(selectedPrinter.maintenanceBudget) || 0;
    const powerConsumption = Number(selectedPrinter.powerConsumption) || 0;

    return (acquisitionCost / lifespanHours) + (maintenanceBudget / lifespanHours) + (powerConsumption * energyPrice);
  }

  const manualCostPerHour = Number(variation.printerCostPerHour) || 0;
  if (manualCostPerHour > 0) {
    return manualCostPerHour;
  }

  const fallbackLifespanHours = Math.max(1, pricingSettings.fallbackPrinterLifespanHours);
  return (
    (pricingSettings.fallbackPrinterAcquisitionCost / fallbackLifespanHours) +
    (pricingSettings.fallbackPowerConsumptionKwh * energyPrice)
  );
};

export const calculateVariationUnitCostBreakdown = ({
  variation,
  fixedCost,
  filaments,
  supplies = [],
  supplyUsages = [],
  wastes = [],
  printers = [],
  energyPrice,
  pricingSettings,
}: {
  variation: PricingVariationLike;
  fixedCost: number;
  filaments: PricingFilamentLike[];
  supplies?: PricingSupplyLike[];
  supplyUsages?: PricingSupplyUsageLike[];
  wastes?: PricingWasteLike[];
  printers?: PricingPrinterLike[];
  energyPrice: number;
  pricingSettings: PricingSettings;
}): PricingBreakdown => {
  let materialCost = 0;

  if ((variation.materials || []).length > 0) {
    materialCost = (variation.materials || []).reduce((sum, material) => {
      const filament = filaments.find(item => item.id === material.filamentId);
      const costPerGram = filament ? (Number(filament.pricePerKg) || 0) / 1000 : (Number(variation.materialCostPerGram) || 0);
      return sum + (((Number(material.weightGrams) || 0) + (Number(material.purgeGrams) || 0)) * costPerGram);
    }, 0);
  } else {
    materialCost = (Number(variation.weightGrams) || 0) * (Number(variation.materialCostPerGram) || 0);
  }

  const quantityPerPrint = Math.max(1, Number(variation.quantityPerPrint) || 1);
  const wasteCost = calculateWasteCost(wastes, filaments);
  const printerCostPerHour = calculatePrinterCostPerHour(variation, printers, energyPrice, pricingSettings);
  const operationalOverheadPerHour = pricingSettings.monthlyUsageHours > 0
    ? pricingSettings.maintenancePerMonth / pricingSettings.monthlyUsageHours
    : 0;
  const totalTimeCost = (Number(variation.printTimeHours) || 0) * (printerCostPerHour + operationalOverheadPerHour);

  const materialCostPerUnit = materialCost / quantityPerPrint;
  const timeCostPerUnit = totalTimeCost / quantityPerPrint;
  const supplyCostPerUnit = calculateSupplyCostPerUnit(supplyUsages, supplies);
  const combinedFixedCost = (Number(fixedCost) || 0) + wasteCost;
  const subtotal = materialCostPerUnit + timeCostPerUnit + supplyCostPerUnit + combinedFixedCost;
  const failureAdjustmentPerUnit = subtotal * (Math.max(0, Number(pricingSettings.failureRate) || 0) / 100);
  const total = subtotal + failureAdjustmentPerUnit;

  return {
    materialCostPerUnit,
    timeCostPerUnit,
    supplyCostPerUnit,
    fixedCost: combinedFixedCost,
    failureAdjustmentPerUnit,
    printerCostPerHour,
    operationalOverheadPerHour,
    subtotal,
    total,
  };
};
