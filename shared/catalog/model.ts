import { D } from '../pricing/engine';

export class CatalogError extends Error {}
export function record(value: unknown, fields: string[], name: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CatalogError(`${name}: objeto obrigatório.`);
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new CatalogError(`${name}: campo não permitido.`);
  return value as Record<string, any>;
}
export function id(value: unknown, field = 'Identificador'): string {
  if (typeof value !== 'string' || value === '__proto__' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new CatalogError(`${field}: use letras, números, hífen ou sublinhado.`);
  return value;
}
export function textValue(value: unknown, field: string, max = 120, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw new CatalogError(`${field}: texto inválido.`);
  return value.trim();
}
export function integer(value: unknown, field: string, min = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > 1_000_000_000)
    throw new CatalogError(`${field}: inteiro inválido.`);
  return Number(value);
}
export function decimalText(value: unknown, field: string, positive = false): string {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value) || value.length > 40)
    throw new CatalogError(`${field}: decimal obrigatório.`);
  const d = new D(value);
  if (d.gt(1_000_000_000) || (positive && d.lte(0)))
    throw new CatalogError(`${field}: valor fora dos limites.`);
  return d.toFixed();
}
export function parseInput(value: string): string {
  // UI accepts comma or dot as decimal separator, never ambiguous thousands grouping.
  return decimalText(value.trim().replace(',', '.'), 'Valor');
}
export function toPhysical(value: string | number, unit: 'g' | 'kg' | 'min' | 'h'): number {
  const parsed = typeof value === 'number' ? String(value) : parseInput(value);
  const d = new D(decimalText(parsed, 'Medida')).times(
    { g: 1000, kg: 1000000, min: 60, h: 3600 }[unit],
  );
  if (!d.isInteger())
    throw new CatalogError(
      'Medida deve ser exata em miligramas ou segundos; não será arredondada.',
    );
  return integer(d.toNumber(), 'Medida');
}
export function fromPhysical(value: number, unit: 'g' | 'kg' | 'min' | 'h'): string {
  return new D(integer(value, 'Medida'))
    .div({ g: 1000, kg: 1000000, min: 60, h: 3600 }[unit])
    .toFixed();
}
function array(value: unknown, field: string, max = 50): any[] {
  if (!Array.isArray(value) || value.length > max)
    throw new CatalogError(`${field}: lista inválida (máximo ${max}).`);
  return value;
}
function unique(values: string[], field: string) {
  if (new Set(values).size !== values.length)
    throw new CatalogError(`${field}: identificação duplicada.`);
}
export function recipeHead(heads: Record<string, string>, variationId: string): string | null {
  return Object.hasOwn(heads, variationId) ? heads[variationId] : null;
}
export type Variant = { id: string; name: string; sku: string; status: 'active' | 'archived' };
export type CatalogData = {
  name: string;
  sku: string;
  description: string;
  kind: 'product' | 'request-reference';
  requestId: string;
  status: 'active' | 'archived';
  variants: Variant[];
};
export function validateCatalog(raw: unknown): CatalogData {
  const x = record(
    raw,
    ['name', 'sku', 'description', 'kind', 'requestId', 'status', 'variants'],
    'Cadastro',
  );
  if (
    !['product', 'request-reference'].includes(x.kind) ||
    !['active', 'archived'].includes(x.status)
  )
    throw new CatalogError('Tipo ou situação inválidos.');
  const variants = array(x.variants, 'Variações').map((raw) => {
    const v = record(raw, ['id', 'name', 'sku', 'status'], 'Variação');
    if (!['active', 'archived'].includes(v.status))
      throw new CatalogError('Situação da variação inválida.');
    return {
      id: id(v.id),
      name: textValue(v.name, 'Nome da variação'),
      sku: textValue(v.sku, 'SKU', 60, true),
      status: v.status,
    } as Variant;
  });
  unique(
    variants.map((v) => v.id),
    'Variações',
  );
  if (x.kind === 'product' && !variants.length)
    throw new CatalogError('Produto exige pelo menos uma variação.');
  if (x.kind === 'request-reference' && variants.length)
    throw new CatalogError('Solicitação vinculada não recebe receita de catálogo.');
  if (x.kind === 'product' && x.requestId !== '')
    throw new CatalogError('Produto não recebe vínculo de solicitação.');
  return {
    name: textValue(x.name, 'Nome'),
    sku: textValue(x.sku, 'SKU', 60, true),
    description: textValue(x.description, 'Descrição', 2000, true),
    kind: x.kind,
    status: x.status,
    requestId: x.kind === 'request-reference' ? id(x.requestId, 'Solicitação') : '',
    variants,
  };
}
export type RecipeMaterial = {
  id: string;
  filamentId: string;
  mode: 'total' | 'parts';
  totalMg: number;
  parts: null | { pieceMg: number; supportMg: number; purgeMg: number };
};
export type Component = {
  productId: string;
  variationId: string;
  recipeVersion: string;
  quantity: number;
};
export type Recipe = {
  kind: 'print' | 'assembly';
  goodUnits: number;
  durationSeconds: number;
  printerId: string;
  setupSeconds: number;
  finishSecondsPerUnit: number;
  materials: RecipeMaterial[];
  components: Component[];
  supplies: Array<{ supplyId: string; quantityPerUnit: string; unit: string }>;
  files: Array<{ name: string; url: string }>;
  notes: string;
};
export function validateRecipe(raw: unknown): Recipe {
  const x = record(
    raw,
    [
      'kind',
      'goodUnits',
      'durationSeconds',
      'printerId',
      'setupSeconds',
      'finishSecondsPerUnit',
      'materials',
      'components',
      'supplies',
      'files',
      'notes',
    ],
    'Receita',
  );
  if (!['print', 'assembly'].includes(x.kind)) throw new CatalogError('Tipo de receita inválido.');
  const materials = array(x.materials, 'Materiais').map((raw) => {
    const m = record(raw, ['id', 'filamentId', 'mode', 'totalMg', 'parts'], 'Material');
    if (!['total', 'parts'].includes(m.mode)) throw new CatalogError('Informe a base do peso.');
    const totalMg = integer(m.totalMg, 'Peso total', 1);
    let parts: RecipeMaterial['parts'] = null;
    if (m.mode === 'parts') {
      const p = record(m.parts, ['pieceMg', 'supportMg', 'purgeMg'], 'Parcelas do peso');
      parts = {
        pieceMg: integer(p.pieceMg, 'Peça'),
        supportMg: integer(p.supportMg, 'Suporte'),
        purgeMg: integer(p.purgeMg, 'Purga'),
      };
      if (parts.pieceMg + parts.supportMg + parts.purgeMg !== totalMg)
        throw new CatalogError('Peça + suporte + purga devem fechar o peso total.');
    } else if (m.parts !== null)
      throw new CatalogError('Peso total já inclui suporte e purga; não some parcelas novamente.');
    return {
      id: id(m.id),
      filamentId: id(m.filamentId, 'Filamento'),
      mode: m.mode,
      totalMg,
      parts,
    } as RecipeMaterial;
  });
  unique(
    materials.map((m) => m.id),
    'Linhas de material',
  );
  const components = array(x.components, 'Componentes').map((raw) => {
    const c = record(raw, ['productId', 'variationId', 'recipeVersion', 'quantity'], 'Componente');
    return {
      productId: id(c.productId),
      variationId: id(c.variationId),
      recipeVersion: id(c.recipeVersion),
      quantity: integer(c.quantity, 'Quantidade do componente', 1),
    };
  });
  unique(
    components.map((c) => `${c.productId}/${c.variationId}`),
    'Componentes',
  );
  const supplies = array(x.supplies, 'Insumos').map((raw) => {
    const s = record(raw, ['supplyId', 'quantityPerUnit', 'unit'], 'Insumo');
    return {
      supplyId: id(s.supplyId),
      quantityPerUnit: decimalText(s.quantityPerUnit, 'Quantidade por unidade', true),
      unit: textValue(s.unit, 'Unidade do insumo', 20),
    };
  });
  unique(
    supplies.map((s) => s.supplyId),
    'Insumos',
  );
  const files = array(x.files, 'Arquivos', 10).map((raw) => {
    const f = record(raw, ['name', 'url'], 'Arquivo');
    const url = textValue(f.url, 'URL', 2048);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new CatalogError('URL de arquivo inválida.');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw new CatalogError('Arquivo exige referência HTTPS sem credenciais na URL.');
    return { name: textValue(f.name, 'Nome do arquivo'), url };
  });
  const result: Recipe = {
    kind: x.kind,
    goodUnits: integer(x.goodUnits, 'Rendimento', 1),
    durationSeconds: integer(x.durationSeconds, 'Tempo'),
    printerId: x.printerId,
    setupSeconds: integer(x.setupSeconds, 'Preparação'),
    finishSecondsPerUnit: integer(x.finishSecondsPerUnit, 'Acabamento'),
    materials,
    components,
    supplies,
    files,
    notes: textValue(x.notes, 'Observações', 2000, true),
  };
  if (x.kind === 'print') {
    id(x.printerId, 'Impressora');
    if (!materials.length || components.length || !result.durationSeconds)
      throw new CatalogError(
        'Impressão exige material, impressora e tempo; componentes pertencem à montagem.',
      );
  } else if (
    materials.length ||
    !components.length ||
    result.goodUnits !== 1 ||
    x.printerId !== '' ||
    result.durationSeconds !== 0
  )
    throw new CatalogError(
      'Montagem usa componentes por unidade acabada, sem nova impressão implícita.',
    );
  return result;
}
export function mountableUnits(
  components: Component[],
  balances: Record<string, { physical: number; reserved: number }>,
) {
  if (!components.length) throw new CatalogError('Montagem sem componentes.');
  unique(
    components.map((c) => `${c.productId}/${c.variationId}`),
    'Componentes',
  );
  const missing: string[] = [];
  const quantities = components.map((c) => {
    const key = `${id(c.productId)}/${id(c.variationId)}`;
    const needed = integer(c.quantity, 'Quantidade', 1),
      balance = balances[key];
    if (!balance) {
      missing.push(key);
      return 0;
    }
    const physical = integer(balance.physical, 'Saldo'),
      reserved = integer(balance.reserved, 'Reserva');
    if (reserved > physical) throw new CatalogError('Reserva supera saldo físico.');
    return Math.floor((physical - reserved) / needed);
  });
  return {
    complete: missing.length === 0,
    mountable: missing.length ? null : Math.min(...quantities),
    missing,
  };
}

// Read-only diagnostic. No guessed yield, automatic stock opening, or name-based links.
export function inspectLegacyProduct(product: Record<string, any>) {
  const issues: string[] = [
    'Saldo de abertura exige contagem/conciliação na E3; a ficha não comprova produção.',
  ];
  if (product.productType && product.productType !== 'produto')
    issues.push(
      'Orçamento/encomenda no catálogo: classifique e vincule uma solicitação, sem copiar estoque.',
    );
  if (product.productionTables?.length)
    issues.push(
      'Mesas antigas precisam ser identificadas como receita ou execução; não converter por nome.',
    );
  if (product.fixedCost || product.wastes?.length)
    issues.push('Confirme incidência de custos fixos e perdas; não presumir unidade ou execução.');
  if (
    (typeof product.imageUrl === 'string' && product.imageUrl.startsWith('data:')) ||
    (Array.isArray(product.files) &&
      product.files.some((f: any) => typeof f?.url === 'string' && f.url.startsWith('data:')))
  )
    issues.push(
      'Arquivo incorporado: preservar original e substituir por referência de armazenamento.',
    );
  const allVariations = Array.isArray(product.variations) ? product.variations : [];
  if (allVariations.length > 50)
    issues.push(
      'Mais de 50 variações: revisão manual necessária; diagnóstico limitado às primeiras 50.',
    );
  const variations = allVariations.slice(0, 50);
  if (!variations.length)
    issues.push('Sem variações: crie IDs de saída; não reconstruir pela agenda.');
  const ids = new Set<string>();
  const candidates = variations.map((raw: any, index: number) => {
    const v = raw && typeof raw === 'object' ? raw : {};
    const warnings: string[] = [];
    try {
      id(v.id);
      if (ids.has(v.id)) throw new Error();
      ids.add(v.id);
    } catch {
      warnings.push('ID de variação ausente, duplicado ou inválido.');
    }
    if (!Number.isSafeInteger(v.quantityPerPrint) || v.quantityPerPrint <= 0)
      warnings.push('Rendimento precisa de confirmação.');
    const convert = (value: unknown, unit: 'g' | 'h', field: string) => {
      if (value === undefined || value === null || value === '') {
        warnings.push(`${field} ausente.`);
        return null;
      }
      try {
        return toPhysical(value as any, unit);
      } catch {
        warnings.push(`${field} não conversível sem arredondamento.`);
        return null;
      }
    };
    if (Array.isArray(v.materials) && v.materials.length > 50)
      warnings.push('Mais de 50 materiais; diagnóstico limitado aos primeiros 50.');
    const materials = (
      Array.isArray(v.materials) && v.materials.length ? v.materials.slice(0, 50) : [v]
    ).map((raw: any) => {
      const m = raw && typeof raw === 'object' ? raw : {};
      return {
        filamentId: m.filamentId ?? null,
        weightMg: convert(m.weightGrams, 'g', 'Peso'),
        purgeMg: convert(m.purgeGrams, 'g', 'Purga'),
        supportMg: m.supportGrams === undefined ? null : convert(m.supportGrams, 'g', 'Suporte'),
        objectName: typeof m.objectName === 'string' ? m.objectName.slice(0, 150) : null,
      };
    });
    warnings.push(
      'Confirme se o peso já inclui suporte/purga e se os materiais formam uma saída ou componentes separados.',
    );
    return {
      index,
      variationId: typeof v.id === 'string' ? v.id : null,
      durationSeconds: convert(v.printTimeHours, 'h', 'Tempo'),
      materials,
      warnings,
    };
  });
  return { requiresReview: true, issues, candidates };
}
