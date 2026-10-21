// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const state = vi.hoisted(() => ({ writes: vi.fn(), requests: [] as any[] }));
vi.mock('../../src/firebase', () => ({ db: {} }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ tenantId: 'a' }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, path: string) => ({ path }), doc: (_: unknown, path: string) => ({ path }),
  onSnapshot: (ref: { path: string }, callback: any) => {
    callback({ docs: ref.path.endsWith('/customRequests') ? state.requests.map(({ id, ...data }) => ({ id, data: () => data })) : [], exists: () => false });
    return () => {};
  }, updateDoc: state.writes, addDoc: state.writes, deleteDoc: state.writes,
}));
import { EncomendasOrcamentos } from '../../src/views/EncomendasOrcamentos';

beforeEach(() => {
  state.writes.mockReset();
  state.requests = [
    { id: 'pending', title: 'Chaveiro NFC', customerName: 'Cliente Aurora', description: 'Quantidade provisória: 1 unidade; quantidade final a confirmar.', type: 'orcamento', status: 'aguardando-orcamento', requestedQuantity: 1, quotedPrice: 0, filaments: [], productionTimeHours: 0, createdAt: '2026-10-21T12:00:00Z' },
    { id: 'quoted', title: 'Organizador', customerName: 'Cliente Boreal', description: 'Descrição completa do organizador.', type: 'orcamento', status: 'orcado', requestedQuantity: 10, quotedPrice: 125.5, filaments: [], productionTimeHours: 2, createdAt: '2026-10-20T12:00:00Z' },
  ];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(cleanup);

it('lista mostra quantidade e preço registrado, distinguindo orçamento pendente de preço zero', () => {
  render(<EncomendasOrcamentos />);
  const table = screen.getByRole('table', { name: /Lista simplificada/ });
  expect(within(table).getByText('1 un')).toBeTruthy();
  expect(within(table).getByText('10 un')).toBeTruthy();
  expect(within(table).getByText('A calcular')).toBeTruthy();
  expect(within(table).getByText('R$ 125.50')).toBeTruthy();
  expect(within(table).queryByText('R$ 0.00')).toBeNull();
  expect(within(table).queryByText(state.requests[0].description)).toBeNull();
  expect(state.writes).not.toHaveBeenCalled();
});

it('busca por cliente e filtro de status são preservados ao alternar lista, duas e três caixas, incluindo resultado vazio', () => {
  render(<EncomendasOrcamentos />);
  fireEvent.change(screen.getByPlaceholderText('Buscar solicitação...'), { target: { value: ' boreal ' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por status' }), { target: { value: 'orcado' } });
  expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
  expect(screen.queryByText('Chaveiro NFC')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '2 caixas' }));
  expect(screen.getByRole('heading', { name: 'Organizador' })).toBeTruthy();
  expect(screen.getByText('Descrição completa do organizador.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '3 caixas' }));
  expect(screen.getByRole('button', { name: '3 caixas' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '2 caixas' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('heading', { name: 'Organizador' })).toBeTruthy();
  expect(screen.queryByText('Chaveiro NFC')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
  fireEvent.click(screen.getByRole('button', { name: 'Lista simplificada' }));
  expect(screen.getByRole('button', { name: 'Lista simplificada' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
  fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por status' }), { target: { value: 'finalizado' } });
  expect(screen.getByText('Nenhuma encomenda ou orçamento encontrado com os filtros atuais.')).toBeTruthy();
  expect(state.writes).not.toHaveBeenCalled();
});

it('abrir detalhes recupera o descritivo integral e quantidade sem salvar nem recalcular o registro persistido', () => {
  render(<EncomendasOrcamentos />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhes de Chaveiro NFC' }));
  expect(screen.getByRole('heading', { name: 'Editar Solicitação' })).toBeTruthy();
  expect(screen.getByDisplayValue(state.requests[0].description)).toBeTruthy();
  expect(screen.getByDisplayValue('Cliente Aurora')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Atualizar' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('heading', { name: 'Editar Solicitação' })).toBeNull();
  expect(screen.getByRole('table')).toBeTruthy();
  expect(state.writes).not.toHaveBeenCalled();
});

for (const mode of ['Lista simplificada', '2 caixas', '3 caixas']) {
  it(`nome abre tela exclusiva e Voltar preserva busca, filtro e visualização: ${mode}`, () => {
    render(<EncomendasOrcamentos />);
    fireEvent.change(screen.getByPlaceholderText('Buscar solicitação...'), { target: { value: 'boreal' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por status' }), { target: { value: 'orcado' } });
    fireEvent.click(screen.getByRole('button', { name: mode }));
    fireEvent.click(screen.getByRole('button', { name: 'Organizador' }));
    expect(screen.getByRole('region', { name: 'Detalhes da solicitação' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Editar Solicitação' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByPlaceholderText('Buscar solicitação...')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Visualização das solicitações' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Encomendas e Orçamentos' })).toBeNull();
    expect(screen.getByDisplayValue('125.5')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('Cliente Boreal'), { target: { value: 'Rascunho não salvo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para orçamentos' }));
    expect(screen.queryByRole('region', { name: 'Detalhes da solicitação' })).toBeNull();
    expect(screen.getByDisplayValue('boreal')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Filtrar por status' }) as HTMLSelectElement).value).toBe('orcado');
    expect(screen.getByRole('button', { name: mode }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Organizador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Organizador' }));
    expect(screen.getByDisplayValue('Cliente Boreal')).toBeTruthy();
    expect(state.writes).not.toHaveBeenCalled();
  });
}

it('nova solicitação também abre tela própria e permite voltar sem criar registro', () => {
  render(<EncomendasOrcamentos />);
  fireEvent.click(screen.getByRole('button', { name: 'Nova Solicitação' }));
  expect(screen.getByRole('heading', { name: 'Nova Solicitação' })).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar para orçamentos' }));
  expect(screen.getByRole('table')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nova Solicitação' }));
  expect(state.writes).not.toHaveBeenCalled();
});
