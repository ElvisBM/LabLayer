// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { printRecipe } from '../fixtures/catalog';
const state = vi.hoisted(() => ({
  phase: 'active',
  version: 2,
  data: {} as Record<string, any[]>,
  api: vi.fn(),
  write: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ db: {} }));
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ tenantId: 'a', user: { uid: 'a', getIdToken: async () => 'token' } }),
}));
vi.mock('../../src/features/inventory/useInventoryPhase', () => ({
  useInventoryPhase: () => ({ phase: state.phase, version: state.version }),
}));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: state.api }));
vi.mock('firebase/firestore', () => ({
  collection: (_: any, path: string) => ({ path }),
  query: (ref: any) => ref,
  limit: () => ({}),
  orderBy: () => ({}),
  onSnapshot: (ref: any, cb: any) => {
    const values = state.data[ref.path] ?? [];
    cb({
      size: values.length,
      docs: values.map(({ id, ...data }: any) => ({ id, data: () => data })),
    });
    return () => {};
  },
  updateDoc: state.write,
  addDoc: state.write,
  writeBatch: state.write,
}));
import { InventoryWorkspace } from '../../src/features/inventory/InventoryPage';
const renderPage = () =>
  render(<InventoryWorkspace tenantId="a" user={{ uid: 'a' }} onCatalog={vi.fn()} />);
const choose = (operation: string) =>
  fireEvent.change(screen.getByLabelText('Operação'), { target: { value: operation } });
const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => {
  state.phase = 'active';
  state.api.mockReset().mockResolvedValue({});
  state.write.mockReset();
  state.data = {
    'tenants/a/filaments': [{ id: 'filament', material: 'PLA', color: 'Azul' }],
    'tenants/a/supplies': [{ id: 'supply', name: 'Caixa', unit: 'un' }],
    'tenants/a/stockBalances': [
      {
        id: 'filament~filament~',
        item: { kind: 'filament', id: 'filament', variationId: '' },
        label: 'PLA Azul',
        unit: 'mg',
        quantity: '1000',
        reserved: '400',
        value: '10',
        version: 3,
      },
    ],
  };
});
afterEach(cleanup);
it('mostra físico, reservado e disponível da mesma projeção, convertendo mg em g', () => {
  renderPage();
  expect(screen.getByText('1 g')).toBeTruthy();
  expect(screen.getByText('0.4 g')).toBeTruthy();
  expect(screen.getByText('0.6 g')).toBeTruthy();
  expect(state.write).not.toHaveBeenCalled();
});
it('recebimento preserva 0,4 g e usa o comando autenticado, sem escrita direta', async () => {
  renderPage();
  choose('purchase');
  fill('Item', 'filament~filament~');
  fill('Quantidade (g)', '0,4');
  fill(/Custo total recebido/, '1,25');
  fill(/Documento ou origem/, 'NF123-1');
  fill('Motivo e conferência da operação', 'Recebido');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  await waitFor(() => expect(state.api).toHaveBeenCalled());
  expect(state.api.mock.calls[0][2]).toMatchObject({
    type: 'purchase',
    expectedVersion: 3,
    payload: { quantity: '400', value: '1.25' },
  });
  expect(state.write).not.toHaveBeenCalled();
});
it('retry após falha de rede conserva a chave e a versão conferida', async () => {
  state.api.mockRejectedValueOnce(new Error('Conexão interrompida')).mockResolvedValueOnce({});
  renderPage();
  choose('purchase');
  fill('Item', 'filament~filament~');
  fill('Quantidade (g)', '1');
  fill(/Custo total recebido/, '2');
  fill(/Documento ou origem/, 'NF1');
  fill('Motivo e conferência da operação', 'Recebido');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
  expect(state.api.mock.calls[0][2]).toEqual(state.api.mock.calls[1][2]);
});
it('congelamento exige declaração de backup e pausa dos operadores', async () => {
  state.phase = 'legacy';
  renderPage();
  choose('freeze');
  fill('Referência do backup testado', 'backup');
  fill('Motivo e conferência da operação', 'Corte');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Confirme a pausa dos operadores e o backup.',
  );
  expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Conferi o backup e pausei os operadores para o corte'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
  await waitFor(() => expect(state.api).toHaveBeenCalled());
});
it('conclusão exige consumo e custos reais explícitos, sem transformar estimativa em fato', () => {
  state.data['tenants/a/stockPlans'] = [
    {
      id: 'plan',
      productId: 'p',
      variationId: 'blue',
      recipe: printRecipe(),
      remainingRuns: 1,
      status: 'active',
      version: 1,
    },
  ];
  renderPage();
  choose('complete');
  fill('Plano a concluir', 'plan');
  expect((screen.getByLabelText('Energia real em R$') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(/Consumo real — PLA/) as HTMLInputElement).value).toBe('');
  expect(screen.getByText(/Não repita aqui os materiais/)).toBeTruthy();
  expect(state.api).not.toHaveBeenCalled();
});
it('conciliação informa divergências sem gravar ajustes automáticos', async () => {
  state.api.mockResolvedValue({
    consistent: false,
    issues: [],
    discrepancies: ['Saldo diverge'],
    required: [],
  });
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir abertura e conciliação' }));
  expect(await screen.findByText('Saldo diverge')).toBeTruthy();
  expect(state.api.mock.calls[0]).toHaveLength(2);
  expect(state.write).not.toHaveBeenCalled();
});
