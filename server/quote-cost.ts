import { createHash } from 'node:crypto';
import { CatalogError, decimalText, id, textValue, validateRecipe } from '../shared/catalog/model';
import { D, calculateCost, decimal, type CostInput } from '../shared/pricing/engine';
import { commercial, type QuoteData, type QuoteLine } from '../shared/quotes/model';
import { validateBalance } from '../shared/inventory/model';

export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type Reader = (path: string) => Promise<any | undefined>;

export async function catalogRecipe(
  get: Reader,
  productId: string,
  variationId: string,
  version: string,
) {
  const p = await get(`catalogItems/${id(productId)}`);
  if (
    !p ||
    p.kind !== 'product' ||
    p.status !== 'active' ||
    !p.variants?.some((v: any) => v.id === variationId && v.status === 'active')
  )
    throw new CatalogError('Produto/variação ativo não encontrado.');
  const r = await get(`catalogItems/${productId}/recipes/${id(version)}`);
  if (!r || r.variationId !== variationId)
    throw new CatalogError('Versão de ficha não encontrada para a variação.');
  return { product: p, recipe: validateRecipe(r.recipe) };
}

export async function quoteCost(get: Reader, tenantId: string, q: QuoteData) {
  const rates: Record<string, { rate: string; source: string }> = {};
  async function rate(kind: 'filament' | 'supply', itemId: string, expectedUnit?: string) {
    const key = `${kind}~${itemId}~`;
    const material = await get(`${kind === 'filament' ? 'filaments' : 'supplies'}/${itemId}`);
    if (!material || (expectedUnit && material.unit !== expectedUnit))
      throw new CatalogError(`Material ausente ou unidade divergente: ${itemId}.`);
    if (rates[key]) return rates[key];
    const raw = await get(`stockBalances/${key}`);
    if (raw) {
      const b = validateBalance(raw);
      if (
        b.item.kind !== kind ||
        b.item.id !== itemId ||
        b.item.variationId !== '' ||
        (expectedUnit && b.unit !== expectedUnit)
      )
        throw new CatalogError(`Saldo incompatível: ${itemId}.`);
      if (new D(b.quantity).gt(0))
        return (rates[key] = {
          rate: new D(b.value)
            .div(b.quantity)
            .times(kind === 'filament' ? 1000000 : 1)
            .toFixed(),
          source: `stock-average:v${b.version}`,
        });
    }
    const fallback = q.fallbackRates.find((r) => r.kind === kind && r.id === itemId);
    if (!fallback)
      throw new CatalogError(
        `Sem custo médio disponível para ${itemId}. Informe tarifa de referência e origem (${kind === 'filament' ? 'R$/kg' : 'R$/unidade'}).`,
      );
    return (rates[key] = { rate: fallback.rate, source: fallback.source });
  }
  async function productCost(
    line: Pick<QuoteLine, 'productId' | 'variationId' | 'recipeVersion' | 'quantity'>,
    depth = 0,
  ): Promise<any> {
    const { recipe, product } = await catalogRecipe(
      get,
      line.productId,
      line.variationId,
      line.recipeVersion,
    );
    if (depth && recipe.kind !== 'print')
      throw new CatalogError('Montagem aninhada não suportada.');
    const p = q.policy;
    textValue(p.source, 'Origem das tarifas de produção', 120);
    for (const key of [
      'energyPricePerKwh',
      'maintenancePerHour',
      'overheadPerHour',
      'laborPerHour',
      'finishLaborPerHour',
    ] as const)
      decimalText(p[key], `Tarifa ${key}`);
    const runCount = Math.ceil(line.quantity / recipe.goodUnits);
    if (runCount > 500)
      throw new CatalogError('Orçamento excede 500 execuções por item. Divida o lote.');
    let printer: CostInput['runs'][number]['printer'] = {
      id: 'manual-assembly',
      source: 'assembly:no-machine',
      powerWatts: '0',
      depreciableValue: '0',
      lifespanHours: '1',
    };
    if (recipe.kind === 'print') {
      const m = await get(`printers/${recipe.printerId}`);
      if (!m) throw new CatalogError('Impressora não encontrada.');
      printer = {
        id: recipe.printerId,
        source: 'printer-catalog',
        powerWatts: decimal(m.powerConsumption, 'Consumo da impressora (kWh/h)')
          .times(1000)
          .toFixed(),
        depreciableValue: decimal(m.acquisitionCost, 'Valor depreciável da impressora').toFixed(),
        lifespanHours: decimal(m.lifespanHours, 'Vida útil da impressora').toFixed(),
      };
    }
    const materials: CostInput['runs'][number]['materials'] = [];
    for (const m of recipe.materials) {
      const r = await rate('filament', m.filamentId);
      materials.push({
        materialId: m.filamentId,
        totalMg: m.totalMg,
        pricePerKg: r.rate,
        source: r.source,
        ...(m.parts ? { parts: m.parts } : {}),
      });
    }
    const supplies: CostInput['supplies'] = [];
    for (const s of recipe.supplies) {
      const r = await rate('supply', s.supplyId, s.unit);
      supplies.push({
        id: s.supplyId,
        quantityPerUnit: s.quantityPerUnit,
        unitCost: r.rate,
        source: r.source,
      });
    }
    const components = [];
    const extras: CostInput['extras'] = [];
    for (const c of recipe.components) {
      // A component's pinned print recipe remains the estimation source; actual weighted
      // stock consumption is recorded independently by E3 at execution time.
      const child = await productCost({ ...c, quantity: c.quantity * line.quantity }, depth + 1);
      components.push({ ...c, calculation: child });
      extras.push({
        id: `${c.productId}-${c.variationId}`.slice(0, 128),
        amount: new D(child.cost).div(line.quantity).toFixed(),
        incidence: 'unit',
        source: 'pinned-component-recipe',
      });
    }
    const input: CostInput = {
      tenantId,
      currency: 'BRL',
      recipeVersion: line.recipeVersion,
      pricingPolicyVersion: 'quote-policy-v1',
      mode: 'estimate',
      lotPolicy: 'conservative-full-runs',
      orderedUnits: line.quantity,
      runs: Array.from({ length: runCount }, (_, i) => ({
        id: `run-${i + 1}`,
        goodUnits: recipe.goodUnits,
        durationSeconds: recipe.durationSeconds,
        materials,
        printer,
        energyPricePerKwh: p.energyPricePerKwh,
        maintenancePerHour: p.maintenancePerHour,
        overheadPerHour: p.overheadPerHour,
        setupSeconds: recipe.setupSeconds,
        laborPerHour: p.laborPerHour,
      })),
      finishSecondsPerUnit: recipe.finishSecondsPerUnit,
      finishLaborPerHour: p.finishLaborPerHour,
      supplies,
      extras,
      risk: { mode: 'none', rate: '0', eligible: [] },
    };
    const result = calculateCost(input);
    const cost =
      p.batchAllocation === 'full-lot'
        ? new D(result.productionCost).plus(result.orderExtras).toFixed()
        : result.orderCost;
    return {
      productName: product.name,
      recipe,
      input,
      result,
      components,
      cost,
      runs: runCount,
      allocation: p.batchAllocation,
    };
  }
  const lines = [];
  for (const l of q.lines) {
    if (l.kind === 'catalog')
      lines.push({ id: l.id, quantity: l.quantity, ...(await productCost(l)) });
    else {
      const cost = new D(decimalText(l.customUnitCost, `Custo unitário de ${l.description}`))
        .times(l.quantity)
        .toFixed();
      textValue(l.costSource, `Origem do custo de ${l.description}`, 120);
      lines.push({
        id: l.id,
        quantity: l.quantity,
        cost,
        source: l.costSource,
        kind: 'manual-confirmed-estimate',
      });
    }
  }
  const result = { calculationVersion: 'quote-v1', data: q, lines, ...commercial(q, lines) };
  // Leave room below Firestore's document limit and bound response/transaction cost.
  if (Buffer.byteLength(JSON.stringify(result)) > 700000)
    throw new CatalogError('Orçamento muito grande. Divida os itens/lotes.');
  return { ...result, fingerprint: fingerprint(result) };
}
