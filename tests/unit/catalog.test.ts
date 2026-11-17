import { expect, it } from 'vitest';
import {
  fromPhysical,
  toPhysical,
  parseInput,
  validateCatalog,
  validateRecipe,
  inspectLegacyProduct,
  mountableUnits,
} from '../../shared/catalog/model';
import { assemblyRecipe, catalogData, printRecipe } from '../fixtures/catalog';

it('0,4 g e 0,0004 kg preservam 400 mg sem arredondamento', () => {
  expect(toPhysical('0,4', 'g')).toBe(400);
  expect(toPhysical('0.0004', 'kg')).toBe(400);
  expect(fromPhysical(400, 'g')).toBe('0.4');
  expect(fromPhysical(400, 'kg')).toBe('0.0004');
  for (const mg of [0, 1, 400, 125499, 1000000000])
    expect(toPhysical(fromPhysical(mg, 'kg'), 'kg')).toBe(mg);
});
it('segundos e decimal brasileiro não são truncados nem confundidos com milhar', () => {
  expect(toPhysical('1,25', 'h')).toBe(4500);
  expect(toPhysical('0,5', 'min')).toBe(30);
  expect(parseInput(' 12,34 ')).toBe('12.34');
  expect(() => parseInput('1.234,56')).toThrow();
  expect(() => toPhysical('0.0001', 'g')).toThrow(/arredondada/);
  expect(() => toPhysical('0.0001', 'h')).toThrow(/arredondada/);
  expect(() => toPhysical(-1, 'g')).toThrow();
  expect(() => toPhysical(NaN, 'g')).toThrow();
});
it('peso total não soma suporte/purga duas vezes; parcelas precisam reconciliar', () => {
  const recipe = printRecipe();
  expect(validateRecipe(recipe).materials[0].totalMg).toBe(400);
  recipe.materials[0].parts!.purgeMg++;
  expect(() => validateRecipe(recipe)).toThrow(/fechar/);
  recipe.materials[0].mode = 'total';
  expect(() => validateRecipe(recipe)).toThrow(/novamente/);
  recipe.materials[0].parts = null;
  expect(validateRecipe(recipe).materials[0].totalMg).toBe(400);
});
it.each(['durationSeconds', 'goodUnits', 'setupSeconds', 'finishSecondsPerUnit'])(
  '%s recusa valores fracionados',
  (field) => {
    expect(() => validateRecipe({ ...printRecipe(), [field]: 1.5 })).toThrow();
  },
);
it('recusa rendimento zero, material sem vínculo e referências de arquivo incorporadas', () => {
  expect(() => validateRecipe({ ...printRecipe(), goodUnits: 0 })).toThrow();
  const recipe = printRecipe();
  recipe.materials[0].filamentId = '';
  expect(() => validateRecipe(recipe)).toThrow();
  expect(() =>
    validateRecipe({
      ...printRecipe(),
      files: [{ name: 'Foto', url: 'data:image/png;base64,xxx' }],
    }),
  ).toThrow(/HTTPS/);
  expect(() =>
    validateRecipe({
      ...printRecipe(),
      files: [{ name: 'Foto', url: 'https://user:secret@example.com/f' }],
    }),
  ).toThrow();
});
it('cadastro não aceita estoque, preços calculados ou identificações duplicadas', () => {
  expect(() => validateCatalog({ ...catalogData(), stock: 10 })).toThrow(/não permitido/);
  const data = catalogData();
  data.variants.push(data.variants[0]);
  expect(() => validateCatalog(data)).toThrow(/duplicada/);
  expect(() => validateCatalog({ ...catalogData(), requestId: 'request' })).toThrow();
  expect(() =>
    validateCatalog({ ...catalogData(), kind: 'request-reference', requestId: 'request' }),
  ).toThrow(/receita/);
  expect(
    validateCatalog({
      ...catalogData(),
      kind: 'request-reference',
      requestId: 'request',
      variants: [],
    }).kind,
  ).toBe('request-reference');
});
it('BOM usa IDs e reservas: 10 bases + 6 tampas = 6 montáveis, sem criar saldo acabado', () => {
  const balances = {
    'base/blue': { physical: 10, reserved: 0 },
    'top/blue': { physical: 6, reserved: 0 },
  };
  const before = structuredClone(balances),
    components = assemblyRecipe().components;
  expect(mountableUnits(components, balances)).toEqual({
    complete: true,
    mountable: 6,
    missing: [],
  });
  expect(balances).toEqual(before);
  balances['top/blue'].reserved = 2;
  expect(mountableUnits(components, balances).mountable).toBe(4);
  components[0].quantity = 3;
  expect(mountableUnits(components, balances).mountable).toBe(3);
  delete balances['top/blue'];
  expect(mountableUnits(components, balances)).toMatchObject({ complete: false, mountable: null });
});
it('BOM recusa componente duplicado e reserva superior ao saldo', () => {
  const components = assemblyRecipe().components;
  expect(() => mountableUnits([...components, components[0]], {})).toThrow(/duplicada/);
  expect(() => mountableUnits(components, { 'base/blue': { physical: 2, reserved: 3 } })).toThrow(
    /Reserva/,
  );
  expect(() => validateRecipe({ ...assemblyRecipe(), goodUnits: 2 })).toThrow(/Montagem/);
});
it('diagnóstico preserva pesos, purga e ausências sem converter legado automaticamente', () => {
  const source = {
    name: 'Peça',
    productType: 'orcamento',
    stock: 16,
    productionTables: [{ tableName: 'Mesa' }],
    variations: [
      {
        id: 'v',
        printTimeHours: 1.25,
        quantityPerPrint: 10,
        materials: [{ filamentId: 'f', weightGrams: 0.4, purgeGrams: 0.1, objectName: 'Base' }],
      },
      { id: 'v', materials: [{ weightGrams: 0.0001 }] },
      null,
    ],
  };
  const copy = structuredClone(source),
    report = inspectLegacyProduct(source);
  expect(source).toEqual(copy);
  expect(report.requiresReview).toBe(true);
  expect(report.candidates[0]).toMatchObject({
    variationId: 'v',
    durationSeconds: 4500,
    materials: [{ weightMg: 400, purgeMg: 100, supportMg: null }],
  });
  expect(report.candidates[1].warnings.join(' ')).toContain('duplicado');
  expect(report.candidates[1].materials[0].weightMg).toBeNull();
  expect(report.issues.join(' ')).toContain('Saldo de abertura');
  expect(report).not.toHaveProperty('stock');
});

it('identificador reservado não entra em mapas serializados', () => {
  const data = catalogData();
  data.variants[0].id = '__proto__';
  expect(() => validateCatalog(data)).toThrow();
});
