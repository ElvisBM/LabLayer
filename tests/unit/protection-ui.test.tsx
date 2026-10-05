// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Configuracoes } from '../../src/views/Configuracoes';

vi.mock('../../src/firebase', () => ({ db: {} }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ tenantId: 'a', user: { uid: 'a' } }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, path: string) => ({ path }), doc: (_: unknown, path: string) => ({ path }),
  onSnapshot: (_: unknown, callback: any) => { callback({ docs: [], exists: () => false }); return () => {}; },
  updateDoc: vi.fn(), addDoc: vi.fn(), writeBatch: vi.fn(),
}));
import { ValoresSugeridos } from '../../src/views/ValoresSugeridos';
import { Vendas } from '../../src/views/Vendas';
afterEach(cleanup);

it('E0.6 integrações em desenvolvimento não pedem credenciais nem simulam conexão', () => {
  render(<Configuracoes />);
  expect(screen.getAllByText('Em desenvolvimento')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: /autorizar|salvar credenciais/i })).toBeNull();
  expect(document.querySelector('input[type=password]')).toBeNull();
});
it('E0.5 sugestões não oferecem recálculo destrutivo do histórico', () => {
  render(<ValoresSugeridos />);
  expect(screen.queryByRole('button', { name: /recalcular preços salvos/i })).toBeNull();
  expect(screen.getByRole('note').textContent).toContain('histórico permanecem preservados');
});
it('E0.6 vendas mantém entrada manual e informa importação indisponível', () => {
  render(<Vendas />);
  expect(screen.getByText('Importação CSV e sincronização: em desenvolvimento.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /importar|sincronizar/i })).toBeNull();
  expect(screen.getByRole('button', { name: /manual|venda|pedido/i })).toBeTruthy();
});
