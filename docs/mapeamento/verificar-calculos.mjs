// Auditoria local: executa o código puro existente sem iniciar o servidor,
// carregar credenciais, acessar Firebase ou alterar registros do negócio.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const results = [];
function check(id, description, run) {
  try {
    const evidence = run();
    results.push({ id, description, status: 'confirmado', evidence });
  } catch (error) {
    results.push({ id, description, status: 'divergiu', error: error.message });
  }
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}
function extract(file, names, bindings = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      assert.ok(!found.has(node.name.text), `Nome ambíguo: ${node.name.text}`);
      found.set(node.name.text, `const ${node.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const name of names) assert.ok(found.has(name), `Função não encontrada: ${name}`);
  const text = names.map(name => found.get(name)).join('\n') + '\nObject.assign(result, {' + names.join(',') + '});';
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = vm.createContext({ ...bindings, result: {} });
  vm.runInContext(js, context, { timeout: 5000 });
  return context.result;
}
const pricingSource = fs.readFileSync(path.join(root, 'src/utils/pricing.ts'), 'utf8');
const compiled = ts.transpileModule(pricingSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const context = vm.createContext({ exports: {} });
vm.runInContext(compiled, context, { timeout: 5000 });
const { calculateVariationUnitCostBreakdown: cost, normalizePricingSettings: normalize, DEFAULT_PRICING_SETTINGS } = context.exports;
const fixture = {
  variation: { materials: [{ filamentId: 'f', weightGrams: 100, purgeGrams: 10 }], printTimeHours: 2, quantityPerPrint: 10, printerId: 'p' },
  fixedCost: 1,
  filaments: [{ id: 'f', pricePerKg: 100 }],
  printers: [{ id: 'p', acquisitionCost: 2000, lifespanHours: 10000, powerConsumption: 0.1, status: 'operacional' }],
  energyPrice: 1,
  pricingSettings: { failureRate: 5, maintenancePerMonth: 160, monthlyUsageHours: 160 },
  supplies: [{ id: 's', costPerUnit: 0.5 }],
  supplyUsages: [{ supplyId: 's', quantityPerProduct: 2 }],
  wastes: [{ filamentId: 'f', weightGrams: 20, includeInCost: true }],
};
check('C01', 'Custo completo do motor compartilhado', () => {
  const b = cost(fixture);
  near(b.materialCostPerUnit, 1.1); near(b.timeCostPerUnit, 0.26);
  near(b.supplyCostPerUnit, 1); near(b.fixedCost, 3);
  near(b.subtotal, 5.36); near(b.failureAdjustmentPerUnit, 0.268); near(b.total, 5.628);
  return b;
});
check('C02', 'Chamadas sem insumos e perdas subestimam o mesmo cenário', () => {
  const simulator = cost({ ...fixture, supplies: [], supplyUsages: [], wastes: [] }).total;
  const suggested = cost({ ...fixture, wastes: [] }).total;
  near(simulator, 2.478); near(suggested, 3.528);
  return { catalogo: cost(fixture).total, simulador: simulator, valoresSugeridos: suggested };
});
check('C03', 'Desperdício marcado não é dividido pelo rendimento', () => {
  const b = cost({ ...fixture, variation: { ...fixture.variation, quantityPerPrint: 100 } });
  near(b.fixedCost, 3); return { rendimento: 100, custoFixoMaisPerdaPorUnidade: b.fixedCost };
});
check('C04', 'Taxa de falha zero normalizada volta a cinco', () => {
  const n = normalize({ failureRate: 0, monthlyUsageHours: 0, maintenancePerMonth: 0 });
  assert.equal(n.failureRate, 5); assert.equal(n.monthlyUsageHours, 160); assert.equal(n.maintenancePerMonth, 0); return n;
});
check('C05', 'Variação legada usa custo manual por grama', () => {
  const b = cost({ ...fixture, variation: { weightGrams: 100, filamentId: 'f', materialCostPerGram: 0.12 }, fixedCost: 0, supplies: [], supplyUsages: [], wastes: [], pricingSettings: { ...fixture.pricingSettings, failureRate: 0 } });
  near(b.total, 12); return { custoMaterial: b.total, precoCadastroPorGrama: 0.1 };
});
check('C06', 'Média da frota prevalece sobre custo manual', () => {
  const b = cost({ ...fixture, variation: { printTimeHours: 1, printerCostPerHour: 99 } });
  near(b.printerCostPerHour, 0.3); return b.printerCostPerHour;
});
check('C07', 'Impressora selecionada inativa continua precificando', () => {
  const b = cost({ ...fixture, printers: [{ ...fixture.printers[0], status: 'inativa' }] });
  near(b.printerCostPerHour, 0.3); return b.printerCostPerHour;
});
check('C08', 'Vida útil zero recebe dez mil horas no motor', () => {
  const b = cost({ ...fixture, printers: [{ ...fixture.printers[0], lifespanHours: 0 }] });
  near(b.printerCostPerHour, 0.3); return b.printerCostPerHour;
});
check('C09', 'Rendimento zero vira um e preço ausente pode zerar material', () => {
  const b = cost({ ...fixture, variation: { materials: [{ filamentId: 'inexistente', weightGrams: 100 }], quantityPerPrint: 0 }, fixedCost: 0, supplies: [], supplyUsages: [], wastes: [] });
  near(b.total, 0); return b.total;
});
check('C10', 'Manutenção individual não altera o cálculo', () => {
  const b = cost({ ...fixture, printers: [{ ...fixture.printers[0], maintenanceBudget: 999999 }] });
  near(b.total, cost(fixture).total); return b.total;
});
const price = extract('src/views/ValoresSugeridos.tsx', ['calculateTargetBasedPrice']).calculateTargetBasedPrice;
check('C11', 'Quatro metas de preço e limite de margem', () => {
  const values = { lucro: price(10, 2, 0.1, 'profit', 5), margem: price(10, 2, 0.1, 'margin', 20), markup: price(10, 2, 0.1, 'markup', 2.2), manual: price(10, 2, 0.1, 'custom', 30), inviavel: price(10, 2, 0.1, 'margin', 90) };
  near(values.lucro, 18.89); near(values.margem, 17.14); near(values.markup, 26.67); near(values.manual, 30); near(values.inviavel, 0); return values;
});
const api = extract('server.ts', ['isPlainObject', 'formatCurrencyRangeLabel', 'getSavedProductSalePrices', 'calculateProductVariationCost', 'buildProductComputedPricing', 'normalizeCustomRequestPayload', 'normalizeAdminPayload', 'resolveActor'], { calculateVariationUnitCostBreakdown: cost, PRODUCT_SUGGESTED_MARKUP_MULTIPLIER: 2.2 });
check('C12', 'API arredonda custo antes de aplicar 2,2', () => {
  const product = { variations: [fixture.variation], fixedCost: 1, supplyUsages: fixture.supplyUsages, wastes: fixture.wastes };
  const result = api.buildProductComputedPricing(product, fixture);
  const uiSuggestion = Number((cost(fixture).total * 2.2).toFixed(2));
  near(result.calculatedSuggestedSalePrice, 12.39); near(uiSuggestion, 12.38); return { api: result.calculatedSuggestedSalePrice, catalogo: uiSuggestion };
});
check('C13', 'Normalização de PATCH só com status injeta defaults', () => {
  const n = api.normalizeAdminPayload(api.normalizeCustomRequestPayload({ status: 'orcado' }), { preserveCreatedAt: true });
  assert.equal(n.title, ''); assert.equal(n.requestedQuantity, 1); assert.equal(n.quotedPrice, 0); assert.equal(n.createdAt, undefined); assert.ok(Object.hasOwn(n, 'createdAt'));
  return { title: n.title, requestedQuantity: n.requestedQuantity, quotedPrice: n.quotedPrice, filaments: n.filaments, createdAtPresenteComoUndefined: true };
});
check('C14', 'Alias de observação permanece no documento normalizado', () => {
  const n = api.normalizeCustomRequestPayload({ title: 'Exemplo', observation: 'Texto' });
  assert.equal(n.description, 'Texto'); assert.equal(n.observation, 'Texto'); return { description: n.description, observation: n.observation };
});
check('C15', 'Ator de auditoria vem do header e não da chave escopada', () => {
  assert.equal(api.resolveActor({ headers: {} }), 'api-token');
  assert.equal(api.resolveActor({ headers: { 'x-lablayer-admin-actor': 'informado' } }), 'informado'); return 'Header ou api-token';
});
const productFns = extract('src/views/Produtos.tsx', ['padDateTimeSegment', 'formatLocalDateTimeInput', 'parseLocalDateTimeInput', 'addMinutesToDateTime', 'addHoursToDateTime', 'calculateDateTimeMinutes', 'calculateDateTimeHours', 'getDurationMinutesFromHours', 'getTableDurationMinutes', 'getTableDurationHours', 'getProductProductionTables', 'getProductStockInfo', 'calculateFilamentUsageMap', 'buildVariationFromProductionTables'], { productionOrders: [], filaments: fixture.filaments, defaultVariation: {} });
check('C16', 'Ficha com peso e zero peças consome um lote', () => {
  const usage = productFns.calculateFilamentUsageMap({ variations: [{ quantityPerPrint: 10, materials: [{ filamentId: 'f', weightGrams: 100, pieces: 0 }] }] });
  near(usage.f, 0.1); return usage;
});
check('C17', 'Peças acima do rendimento arredondam lotes para cima', () => {
  const usage = productFns.calculateFilamentUsageMap({ variations: [{ quantityPerPrint: 10, materials: [{ filamentId: 'f', weightGrams: 100, pieces: 11 }] }] });
  near(usage.f, 0.2); return usage;
});
check('C18', 'Perda fora do custo continua consumindo estoque', () => {
  const usage = productFns.calculateFilamentUsageMap({ wastes: [{ filamentId: 'f', weightGrams: 20, includeInCost: false }] });
  near(usage.f, 0.02); return usage;
});
check('C19', 'Fallback de materiais cria mesas e soma componentes como produtos', () => {
  const product = { variations: [{ materials: [{ id: 'a', objectName: 'Base', pieces: 10, weightGrams: 100 }, { id: 'b', objectName: 'Tampa', pieces: 6, weightGrams: 60 }] }] };
  const stock = productFns.getProductStockInfo(product);
  assert.equal(stock.complete, 16); return { calculado: stock.complete, seForemKitsBaseETampa: 6 };
});
check('C20', 'Conversão de materiais para mesas perde purga e arredonda gramas', () => {
  const tables = productFns.getProductProductionTables({ variations: [{ materials: [{ id: 'a', filamentId: 'f', weightGrams: 0.4, purgeGrams: 10, pieces: 1 }] }] });
  const v = productFns.buildVariationFromProductionTables(tables);
  near(v.materials[0].weightGrams, 0); near(v.materials[0].purgeGrams, 0); return v.materials[0];
});
check('C21', 'Tempo com datas atravessa meia noite e rejeita fim anterior', () => {
  near(productFns.calculateDateTimeHours('2026-10-01T23:30', '2026-10-02T01:00'), 1.5);
  near(productFns.calculateDateTimeHours('2026-10-02T01:00', '2026-10-01T23:30'), 0); return { valido: 1.5, invertido: 0 };
});
const printer = extract('src/views/Impressoras.tsx', ['calculateCostPerHour'], { energyPrice: 1 });
check('C22', 'Tela de impressoras zera custo se vida útil for zero', () => {
  const value = printer.calculateCostPerHour({ ...fixture.printers[0], lifespanHours: 0 });
  near(value, 0); return { tela: value, motor: 0.3 };
});
const purchases = extract('src/views/Filamentos.tsx', ['getLocalDateString', 'getPurchaseHistory', 'getAveragePricePerKg', 'getPurchasedValue']);
check('C23', 'Média de compras ponderada pelos quilos de todo histórico', () => {
  const f = { purchaseHistory: [{ quantityKg: 1, pricePerKg: 100 }, { quantityKg: 3, pricePerKg: 80 }] };
  near(purchases.getAveragePricePerKg(f), 85); near(purchases.getPurchasedValue(f), 340); return { precoPorKg: 85, comprado: 340 };
});
check('C24', 'API sem variações pode informar preço sugerido mas resolução indisponível', () => {
  const n = api.buildProductComputedPricing({ fixedCost: 10, variations: [] }, fixture);
  near(n.calculatedSuggestedSalePrice, 22); near(n.resolvedSalePrice, 0); assert.equal(n.resolvedSalePriceSource, 'unavailable'); return n;
});
const report = { finalidade: 'Caracterização do comportamento atual; confirmado não significa regra de negócio correta.', execucao: 'Código puro real extraído por AST, sem montar React ou conectar Firebase.', total: results.length, confirmados: results.filter(r => r.status === 'confirmado').length, casos: results };
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--salvar')) fs.writeFileSync(path.join(here, 'resultados-calculos.json'), json);
console.log(json);
if (results.some(r => r.status !== 'confirmado')) process.exitCode = 1;
