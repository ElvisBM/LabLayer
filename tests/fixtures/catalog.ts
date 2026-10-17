import type { CatalogData, Recipe } from '../../shared/catalog/model';
export const catalogData = (): CatalogData => ({
  name: 'Peça',
  sku: 'P',
  description: '',
  kind: 'product',
  requestId: '',
  status: 'active',
  variants: [{ id: 'blue', name: 'Azul', sku: 'P-AZ', status: 'active' }],
});
export const printRecipe = (): Recipe => ({
  kind: 'print',
  goodUnits: 10,
  durationSeconds: 7200,
  printerId: 'printer',
  setupSeconds: 900,
  finishSecondsPerUnit: 60,
  materials: [
    {
      id: 'line',
      filamentId: 'filament',
      mode: 'parts',
      totalMg: 400,
      parts: { pieceMg: 250, supportMg: 50, purgeMg: 100 },
    },
  ],
  components: [],
  supplies: [{ supplyId: 'supply', unit: 'un', quantityPerUnit: '2' }],
  files: [{ name: 'Peça.stl', url: 'https://example.com/peca.stl' }],
  notes: '',
});
export const assemblyRecipe = (): Recipe => ({
  kind: 'assembly',
  goodUnits: 1,
  durationSeconds: 0,
  printerId: '',
  setupSeconds: 0,
  finishSecondsPerUnit: 60,
  materials: [],
  supplies: [],
  files: [],
  notes: '',
  components: [
    { productId: 'base', variationId: 'blue', recipeVersion: 'base-v1', quantity: 1 },
    { productId: 'top', variationId: 'blue', recipeVersion: 'top-v1', quantity: 1 },
  ],
});
