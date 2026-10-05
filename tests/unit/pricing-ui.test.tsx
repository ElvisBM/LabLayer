// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fixture } from '../fixtures/legacy-pricing';
const state = vi.hoisted(() => ({ data: {} as Record<string, any>, writes: vi.fn(), save: vi.fn() }));
vi.mock('../../src/firebase', () => ({ db: {} }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ tenantId: 'a', user: { uid: 'a', getIdToken: async () => 'a' } }) }));
vi.mock('../../src/services/product-protection', () => ({ saveCalculatedPrice: state.save }));
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, path: string) => ({ path }), doc: (_: unknown, path: string) => ({ path }),
  onSnapshot: (ref: { path: string }, cb: any) => {
    const value = state.data[ref.path];
    cb(Array.isArray(value) ? { docs: value.map(({ id, ...data }: any) => ({ id, data: () => data })) } : { docs: [], exists: () => value !== undefined, data: () => value });
    return () => {};
  }, updateDoc: state.writes, addDoc: state.writes, setDoc: state.writes, deleteDoc: state.writes,
}));
import { Precificacao } from '../../src/views/Precificacao';
import { ValoresSugeridos } from '../../src/views/ValoresSugeridos';
import { Vendas } from '../../src/views/Vendas';
beforeEach(() => {
  const f = fixture(); state.writes.mockReset(); state.save.mockReset();
  state.data = {
    'tenants/a/products': [{ id: 'p', name: 'Peça', status: 'ativo', variations: [{ id: 'v', color: 'Azul', material: 'PLA', ...f.variation }], fixedCost: f.fixedCost, supplyUsages: f.supplyUsages, wastes: f.wastes }],
    'tenants/a/marketplaces': [{ id: 'c', name: 'Direto', commissionPercent: 10, fixedFee: 2, averageShipping: 0 }],
    'tenants/a/filaments': f.filaments, 'tenants/a/supplies': f.supplies, 'tenants/a/printers': f.printers,
    'tenants/a/settings/printer': { energyPrice: 1 }, 'tenants/a/settings/pricing': f.pricingSettings,
  };
});
afterEach(cleanup);
it('simulador inclui insumos e perdas e mostra o mesmo custo da API', () => {
  render(<Precificacao />);
  expect(screen.getByDisplayValue('5.63')).toBeTruthy();
  expect(screen.getByText(/Estimativa da ficha legada/)).toBeTruthy();
});
it('simulador impede gravar quando insumo não tem preço conhecido', () => {
  state.data['tenants/a/supplies'] = [];
  render(<Precificacao />);
  expect(screen.getByRole('alert').textContent).toContain('Custo do insumo');
  expect(screen.queryByRole('button', { name: /salvar preço/i })).toBeNull();
});
it('valores sugeridos apresenta R$ 12,39 para o mesmo produto', () => {
  render(<ValoresSugeridos />);
  expect(screen.getAllByText('R$ 12.39').length).toBeGreaterThan(0);
  expect(screen.getAllByText('R$ 5.63').length).toBeGreaterThan(0);
});
it('ausência de preço mostra pendência, não sugestão automática zero', () => {
  state.data['tenants/a/filaments'] = [];
  render(<ValoresSugeridos />);
  expect(screen.getByText('Revisar custos')).toBeTruthy();
  expect(screen.getByText('Indisponível')).toBeTruthy();
});
it('venda manual exige custo total explicitamente informado', () => {
  render(<Vendas />);
  fireEvent.click(screen.getByRole('button', { name: /manual|venda|pedido/i }));
  const field = screen.getByLabelText('Custo total confirmado (R$)') as HTMLInputElement;
  expect(field.required).toBe(true); expect(field.value).toBe('');
});
it('meta inviável aparece como erro na tela e não como preço zero', () => {
  render(<Precificacao />);
  fireEvent.click(screen.getByRole('button', { name: /Margem/i }));
  fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '90' } });
  expect(screen.getByRole('alert').textContent).toContain('Meta inviável');
});
