// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Configuracoes } from '../../src/views/Configuracoes';

vi.mock('../../src/firebase', () => ({ db: {} }));
const identity = vi.hoisted(() => ({ uid: 'a' }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ tenantId: 'a', user: identity }) }));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: vi.fn(async () => { throw Error('Somente administradores'); }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, path: string) => ({ path }), doc: (_: unknown, path: string) => ({ path }),
  onSnapshot: (_: unknown, callback: any) => { callback({ docs: [], exists: () => false }); return () => {}; },
  updateDoc: vi.fn(), addDoc: vi.fn(), writeBatch: vi.fn(),
}));
import { ValoresSugeridos } from '../../src/views/ValoresSugeridos';
import { Vendas } from '../../src/views/Vendas';
afterEach(cleanup);

it('E0.6 integrações não simulam conexão; credenciais ML exigem autorização do servidor', async () => {
  render(<Configuracoes />);
  // Credenciais e conexão do Mercado Livre consultam o servidor separadamente; ambos recusam.
  const alerts = await screen.findAllByRole('alert');
  expect(alerts.length).toBeGreaterThan(0);
  for (const alert of alerts) expect(alert.textContent).toBe('Somente administradores');
  expect(screen.getAllByText('Em desenvolvimento')).toHaveLength(3);
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
