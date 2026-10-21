// @vitest-environment jsdom
import React, { lazy } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App';
import { ViewBoundary } from '../../src/components/ViewBoundary';

const context = vi.hoisted(() => ({
  auth: { user: { uid: 'operator' } as { uid: string } | null, tenantId: 'tenant-a', loading: false, initializationError: null as string | null },
  phase: 'active',
}));
vi.mock('../../src/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: any) => children,
  useAuth: () => context.auth,
}));
vi.mock('../../src/features/inventory/useInventoryPhase', () => ({ useInventoryPhase: () => ({ phase: context.phase }) }));
vi.mock('../../src/firebase', () => ({ logout: vi.fn() }));
vi.mock('../../src/views/Login', () => ({ Login: () => <p>Login isolado</p> }));
vi.mock('../../src/components/TopBar', () => ({ TopBar: ({ title }: any) => <h1>{title}</h1> }));
vi.mock('../../src/components/Sidebar', () => ({ Sidebar: ({ setCurrentView }: any) => <nav>{[
  'dashboard', 'produtos', 'precificacao', 'vendas', 'encomendas', 'financeiro', 'insumos', 'agenda', 'perdas', 'filamentos', 'estoque',
].map(view => <button key={view} onClick={() => setCurrentView(view)}>menu-{view}</button>)}</nav> }));
vi.mock('../../src/features/finance/FinancePage', () => ({ FinancePage: () => <p>Financeiro canônico</p> }));
vi.mock('../../src/features/catalog/CatalogPage', () => ({ CatalogPage: ({ operational }: any) => <p>Catálogo {operational ? 'operacional' : 'preparação'}</p> }));
vi.mock('../../src/features/quotes/QuotesPage', () => ({ QuotesPage: () => <p>Orçamento canônico</p> }));
vi.mock('../../src/features/inventory/InventoryPage', () => ({ InventoryPage: () => <p>Estoque canônico</p> }));
vi.mock('../../src/views/Dashboard', () => ({ Dashboard: () => <p>Dashboard legado</p> }));
vi.mock('../../src/views/Produtos', () => ({ Produtos: ({ mode, editorProductId, onOpenEditor, onCloseEditor, onOpenCatalog }: any) => <div>
  <p>Produtos legado {mode} {editorProductId}</p>
  {mode === 'list' ? <><button onClick={() => onOpenEditor('edit', 'product-1')}>Editar produto legado</button><button onClick={onOpenCatalog}>Preparar catálogo</button></> : <button onClick={onCloseEditor}>Voltar à lista</button>}
</div> }));

beforeEach(() => {
  context.auth = { user: { uid: 'operator' }, tenantId: 'tenant-a', loading: false, initializationError: null };
  context.phase = 'active';
});
afterEach(cleanup);

it('carrega páginas canônicas após o corte e preserva os atalhos antigos', async () => {
  render(<App />);
  expect(await screen.findByText('Financeiro canônico')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'menu-produtos' }));
  expect(await screen.findByText('Catálogo operacional')).toBeTruthy();
  for (const view of ['precificacao', 'vendas', 'encomendas']) {
    fireEvent.click(screen.getByRole('button', { name: `menu-${view}` }));
    expect(await screen.findByText('Orçamento canônico')).toBeTruthy();
  }
  for (const view of ['insumos', 'agenda', 'perdas', 'filamentos', 'estoque']) {
    fireEvent.click(screen.getByRole('button', { name: `menu-${view}` }));
    expect(await screen.findByText('Estoque canônico')).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button', { name: 'menu-financeiro' }));
  expect(await screen.findByText('Financeiro canônico')).toBeTruthy();
  expect(screen.queryByText('Dashboard legado')).toBeNull();
});

it('preserva lista/editor legado, produto selecionado e acesso explícito ao novo fluxo', async () => {
  context.phase = 'legacy';
  render(<App />);
  expect(await screen.findByText('Dashboard legado')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'menu-produtos' }));
  expect(await screen.findByText('Produtos legado list')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Editar produto legado' }));
  expect(await screen.findByText('Produtos legado editor product-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar catálogo' }));
  expect(await screen.findByText('Catálogo preparação')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Orçamentos e pedidos' }));
  expect(await screen.findByText('Orçamento canônico')).toBeTruthy();
});

it('não abre operações enquanto autenticação/estado do estoque estão incertos', async () => {
  context.auth.user = null;
  const view = render(<App />);
  expect(screen.getByText('Login isolado')).toBeTruthy();
  expect(screen.queryByRole('navigation')).toBeNull();
  context.auth.user = { uid: 'operator' };
  context.phase = 'loading';
  view.rerender(<App />);
  expect(screen.getByText('Conferindo estado do estoque...')).toBeTruthy();
  expect(screen.queryByText('Financeiro canônico')).toBeNull();
  context.phase = 'error';
  view.rerender(<App />);
  expect(screen.getByRole('alert').textContent).toContain('Não foi possível conferir');
  context.phase = 'active';
  context.auth.initializationError = 'Vínculo da empresa não confirmado';
  view.rerender(<App />);
  expect(screen.getByRole('alert').textContent).toContain('Vínculo da empresa');
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('sinaliza carregamento até o módulo resolver, sem anunciar uma operação concluída', async () => {
  let resolve!: (value: { default: React.ComponentType }) => void;
  const Page = lazy(() => new Promise<{ default: React.ComponentType }>(done => { resolve = done; }));
  render(<ViewBoundary><Page /></ViewBoundary>);
  expect(screen.getByRole('status').textContent).toBe('Carregando tela...');
  await act(async () => { resolve({ default: () => <p>Tela pronta</p> }); });
  expect(screen.getByText('Tela pronta')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

it('falha de download oferece recuperação sem recarga automática e permite outra tela', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const Page = lazy(() => Promise.reject(new Error('chunk indisponível')));
  const view = render(<ViewBoundary key="failed"><Page /></ViewBoundary>);
  expect((await screen.findByRole('alert')).textContent).toContain('alterações ainda não salvas serão perdidas');
  expect(screen.getByRole('button', { name: 'Recarregar aplicativo' })).toBeTruthy();
  view.rerender(<ViewBoundary key="other"><p>Outra tela</p></ViewBoundary>);
  expect(screen.getByText('Outra tela')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  consoleError.mockRestore();
});
