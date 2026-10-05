import { BusinessError, validId } from './session';

export const WRITABLE_COLLECTIONS = new Set(['customRequests', 'suppliers', 'marketplaces', 'settings']);
export const isRecord = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);

const requestDefaults = {
  type: 'orcamento', status: 'aguardando-orcamento', sourceChannel: 'manual',
  description: '', customerName: '', customerPhone: '', sourceMessage: '',
  requestedQuantity: 1, productionTimeHours: 0, printerId: '', filaments: [],
  referenceImageUrl: '', quoteMediaImageUrl: '', quoteMediaUrl: '',
  estimatedUnitCost: 0, suggestedUnitPrice: 0, quotedPrice: 0,
  quoteSentAt: '', approvedAt: '', paidAt: '', startedAt: '', completedAt: '',
};
const aliases = {
  title: ['name'], description: ['observation', 'observacao', 'notes'],
  referenceImageUrl: ['referenceImageBase64', 'referenceImageDataUrl'],
  quoteMediaImageUrl: ['quoteMediaImageBase64', 'quoteMediaImageDataUrl'],
};

export function normalizeCustomRequest(payload: Record<string, any>, mode: 'create' | 'patch') {
  const result = { ...payload };
  for (const [canonical, alternatives] of Object.entries(aliases)) {
    if (!Object.hasOwn(result, canonical)) {
      const source = alternatives.find(key => Object.hasOwn(result, key));
      if (source) result[canonical] = result[source];
    }
    for (const alias of alternatives) delete result[alias];
  }
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') result[key] = value.trim();
  }
  return mode === 'create' ? { ...requestDefaults, ...result } : result;
}

type Rule = { kind: 'string' | 'number' | 'array'; min?: number; max?: number; values?: string[]; integer?: boolean };
const string = (max: number, min = 0): Rule => ({ kind: 'string', max, min });
const number = (min = 0, integer = false): Rule => ({ kind: 'number', min, integer });
const enumeration = (...values: string[]): Rule => ({ kind: 'string', values });
const schemas: Record<string, { fields: Record<string, Rule>; required: string[] }> = {
  customRequests: {
    fields: {
      title: string(150, 1), type: enumeration('orcamento', 'encomenda'),
      status: enumeration('aguardando-orcamento', 'orcado', 'fila-producao', 'produzindo', 'finalizado'),
      sourceChannel: enumeration('manual', 'whatsapp'), description: string(5000), customerName: string(150),
      customerPhone: string(50), sourceMessage: string(10000), requestedQuantity: number(1, true),
      productionTimeHours: number(), printerId: string(100), filaments: { kind: 'array', max: 50 },
      referenceImageUrl: string(200000), quoteMediaImageUrl: string(200000), quoteMediaUrl: string(2000),
      estimatedUnitCost: number(), suggestedUnitPrice: number(), quotedPrice: number(),
      quoteSentAt: string(50), approvedAt: string(50), paidAt: string(50), startedAt: string(50), completedAt: string(50),
    }, required: ['title', 'type', 'status', 'requestedQuantity', 'productionTimeHours', 'filaments'],
  },
  suppliers: {
    fields: { name: string(100, 1), phone: string(30), address: string(300), notes: string(500), status: enumeration('ativo', 'inativo') },
    required: ['name'],
  },
  marketplaces: {
    fields: { name: string(50, 1), commissionPercent: number(), fixedFee: number(), averageShipping: number(),
      affiliateCommission: number(), payoutDays: number(0, true), status: enumeration('ativo', 'inativo') }, required: ['name'],
  },
};

function assertField(field: string, value: any, rule: Rule) {
  const invalid = rule.kind === 'array'
    ? !Array.isArray(value) || value.length > (rule.max ?? Infinity)
    : rule.kind === 'number'
      ? typeof value !== 'number' || !Number.isFinite(value) || value < (rule.min ?? 0) || (rule.integer && !Number.isInteger(value))
      : typeof value !== 'string' || value.length < (rule.min ?? 0) || value.length > (rule.max ?? Infinity) || (rule.values && !rule.values.includes(value));
  if (invalid) throw new BusinessError(400, `Campo inválido: ${field}.`);
}

export function validateDocument(collection: string, docId: string, data: Record<string, any>) {
  const schema = collection === 'settings'
    ? docId === 'pricing' ? { fields: { failureRate: number(), maintenancePerMonth: number(), monthlyUsageHours: number(), markup: number() }, required: [] }
      : docId === 'printer' ? { fields: { energyPrice: number() }, required: [] } : undefined
    : schemas[collection];
  if (!schema) throw new BusinessError(403, 'Escrita genérica suspensa; este domínio requer comando de negócio.');
  const fields: Record<string, Rule> = { ...schema.fields, createdAt: string(50, 1), updatedAt: string(50, 1) };
  for (const key of Object.keys(data)) {
    if (!Object.hasOwn(fields, key)) throw new BusinessError(400, `Campo não permitido: ${key}.`);
    assertField(key, data[key], fields[key]);
  }
  for (const key of schema.required) if (!Object.hasOwn(data, key)) throw new BusinessError(400, `Campo obrigatório: ${key}.`);
  if (collection === 'customRequests') {
    if (data.printerId && !validId(data.printerId)) throw new BusinessError(400, 'printerId inválido.');
    for (const item of data.filaments) {
      if (!isRecord(item) || !validId(item.filamentId)) throw new BusinessError(400, 'Filamento inválido.');
      for (const key of Object.keys(item)) if (!['id', 'filamentId', 'filamentName', 'weightGrams'].includes(key)) throw new BusinessError(400, `Campo de filamento não permitido: ${key}.`);
      assertField('weightGrams', item.weightGrams, number());
      if (item.id !== undefined) assertField('id', item.id, string(100, 1));
      if (item.filamentName !== undefined) assertField('filamentName', item.filamentName, string(200));
    }
  }
}
