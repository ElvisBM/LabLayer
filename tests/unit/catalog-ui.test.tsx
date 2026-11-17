// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { catalogData, printRecipe } from '../fixtures/catalog';
import { inspectLegacyProduct } from '../../shared/catalog/model';
const state = vi.hoisted(() => ({
  data: {} as Record<string, any[]>,
  api: vi.fn(),
  physicalWrite: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ db: {} }));
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ tenantId: 'a', user: { uid: 'a', getIdToken: async () => 'token' } }),
}));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: state.api }));
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, path: string) => ({ path }),
  onSnapshot: (ref: any, cb: any) => {
    cb({
      docs: (state.data[ref.path] ?? []).map(({ id, ...data }: any) => ({ id, data: () => data })),
    });
    return () => {};
  },
  updateDoc: state.physicalWrite,
  addDoc: state.physicalWrite,
  writeBatch: state.physicalWrite,
}));
import { CatalogPage } from '../../src/features/catalog/CatalogPage';
import { RecipeEditor } from '../../src/features/catalog/RecipeEditor';
const resources = {
  printers: [{ id: 'printer', name: 'Impressora', status: 'operacional' }],
  filaments: [{ id: 'filament', material: 'PLA', color: 'Azul' }],
  supplies: [{ id: 'supply', name: 'Embalagem', unit: 'un' }],
  catalogItems: [],
};
beforeEach(() => {
  state.data = {};
  state.api.mockReset().mockResolvedValue({ revision: 1 });
  state.physicalWrite.mockReset();
});
afterEach(cleanup);
const editor = (initial = { id: 'recipe1', version: 1, recipe: printRecipe() }) =>
  render(
    <RecipeEditor
      item={{ id: 'p', revision: 1, ...catalogData() }}
      variationId="blue"
      initial={initial}
      resources={resources}
      user={{}}
      tenantId="a"
      onClose={vi.fn()}
    />,
  );
it('catálogo deixa explícito que a preparação não ativa estoque ou preço operacional', () => {
  render(<CatalogPage onBack={vi.fn()} />);
  expect(screen.getByRole('note').textContent).toContain('em preparação');
  expect(screen.getByRole('note').textContent).toContain('não altera saldos');
});
it('novo cadastro tem nome e variação mas não escreve receita, fabricação nem estoque', async () => {
  render(<CatalogPage onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Novo cadastro sem movimentação' }));
  fireEvent.change(screen.getByLabelText('Nome do produto ou referência'), {
    target: { value: 'Produto novo' },
  });
  fireEvent.change(screen.getByLabelText('Nome da variação 1'), { target: { value: 'Azul' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro versionado' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(1));
  const command = state.api.mock.calls[0][2];
  expect(command).toMatchObject({
    expectedRevision: 0,
    legacySource: null,
    data: { name: 'Produto novo', kind: 'product', variants: [{ name: 'Azul' }] },
  });
  expect(command.data).not.toHaveProperty('stock');
  expect(command).not.toHaveProperty('recipe');
  expect(state.physicalWrite).not.toHaveBeenCalled();
});
it('abrir e salvar receita mantém 0,4 g, suporte e purga exatamente', async () => {
  editor();
  expect(screen.getByLabelText('Peso total 1 (g)')).toHaveProperty('value', '0.4');
  expect(screen.getByLabelText('Purga 1 (g)')).toHaveProperty('value', '0.1');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova versão' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(1));
  expect(state.api.mock.calls[0][2]).toMatchObject({
    expectedRevision: 1,
    expectedRecipeVersion: 'recipe1',
    variationId: 'blue',
    recipe: printRecipe(),
  });
  expect(state.physicalWrite).not.toHaveBeenCalled();
});
it('base total não adiciona novamente purga da versão anterior', async () => {
  editor();
  fireEvent.change(screen.getByLabelText('Base do peso 1'), { target: { value: 'total' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova versão' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(1));
  expect(state.api.mock.calls[0][2].recipe.materials[0]).toMatchObject({
    totalMg: 400,
    mode: 'total',
    parts: null,
  });
});
it('peso abaixo da precisão e parcelas divergentes são mostrados antes da gravação', async () => {
  editor();
  fireEvent.change(screen.getByLabelText('Peso total 1 (g)'), { target: { value: '0,0001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova versão' }));
  expect((await screen.findByRole('alert')).textContent).toContain('arredondada');
  expect(state.api).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Peso total 1 (g)'), { target: { value: '0,5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova versão' }));
  expect((await screen.findByRole('alert')).textContent).toContain('fechar o peso');
});
it('repetição após falha de conexão conserva a chave do comando', async () => {
  state.api
    .mockRejectedValueOnce(new Error('Conexão perdida'))
    .mockResolvedValueOnce({ version: 2 });
  editor();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova versão' }));
  await screen.findByText('Conexão perdida');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar nova versão' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
  expect(state.api.mock.calls[0][2].requestId).toBe(state.api.mock.calls[1][2].requestId);
});
it('legado exige conferência da origem e não apresenta purga ausente como zero', async () => {
  const original = {
    id: 'legacy',
    name: 'Peça antiga',
    productType: 'orcamento',
    variations: [
      {
        id: 'blue',
        color: 'Azul',
        printTimeHours: 1,
        quantityPerPrint: 2,
        materials: [{ filamentId: 'filament', weightGrams: 0.4 }],
      },
    ],
  };
  state.data['tenants/a/products'] = [original];
  state.api
    .mockResolvedValueOnce({
      updateTime: '100:123',
      source: original,
      review: inspectLegacyProduct(original),
    })
    .mockResolvedValueOnce({ revision: 1 });
  render(<CatalogPage onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Revisar Peça antiga' }));
  await screen.findByText('Conferência do registro original');
  expect(screen.getByText(/purga desconhecida mg/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro versionado' }));
  fireEvent.submit(
    screen.getByRole('button', { name: 'Salvar cadastro versionado' }).closest('form')!,
  );
  expect((await screen.findByRole('alert')).textContent).toContain('Confirme a revisão');
  expect(state.api).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Motivo da classificação'), {
    target: { value: 'Produto reutilizável confirmado, sem copiar saldos.' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro versionado' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
  expect(state.api.mock.calls[1][2]).toMatchObject({
    legacySource: { productId: 'legacy', updateTime: '100:123' },
    data: { variants: [{ id: 'blue' }] },
  });
  expect(state.physicalWrite).not.toHaveBeenCalled();
});
