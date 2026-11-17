import { describe, expect, it } from 'vitest';
import { normalizeCustomRequest, validateDocument } from '../../server/admin-contract';

describe('E0.3 contrato de solicitação', () => {
  it('PATCH só de status não injeta valores nem undefined', () => {
    expect(normalizeCustomRequest({ status: 'orcado' }, 'patch')).toEqual({ status: 'orcado' });
  });
  it('converte aliases e remove campos alternativos', () => {
    expect(normalizeCustomRequest({ name: ' Peça ', observation: ' Texto ', referenceImageBase64: 'data:image/png;base64,aaa' }, 'patch'))
      .toEqual({ title: 'Peça', description: 'Texto', referenceImageUrl: 'data:image/png;base64,aaa' });
  });
  it('campo canônico explícito prevalece mesmo vazio e zero é preservado', () => {
    expect(normalizeCustomRequest({ description: '', notes: 'não aplicar', quotedPrice: 0 }, 'patch'))
      .toEqual({ description: '', quotedPrice: 0 });
  });
  it.each([{ requestedQuantity: 0 }, { requestedQuantity: 1.5 }, { requestedQuantity: '10' }, { productionTimeHours: -1 }, { quotedPrice: NaN }, { quotedPrice: null }, { status: 'aprovado' }, { role: 'superadmin' }, { filaments: 'x' }, { title: '' }])('rejeita dado inválido %j', invalid => {
    expect(() => validateDocument('customRequests', 'r', normalizeCustomRequest({ title: 'Peça', ...invalid }, 'create'))).toThrow();
  });
  it('rascunho permite valores monetários zero deliberados', () => {
    const draft = normalizeCustomRequest({ title: 'Peça', quotedPrice: 0 }, 'create');
    expect(() => validateDocument('customRequests', 'r', draft)).not.toThrow();
    expect(JSON.stringify(draft)).not.toContain('undefined');
  });
});
