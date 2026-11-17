// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MarketplaceListings } from '../../src/features/integrations/MarketplaceListings';
import { Sidebar } from '../../src/components/Sidebar';
import { normalizeMLListing, safeListingUrl } from '../../shared/marketplaces/listings';
const mock = vi.hoisted(() => ({ call: vi.fn(), user: { uid: 'member', getIdToken: vi.fn() }, tenantId: 'a' }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user, tenantId: mock.tenantId }) }));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: (...args: any[]) => args[1].includes('/tiktokshop/') ? Promise.resolve({ status: 'not-connected', listings: [], total: null }) : mock.call(...args) }));
const listing = (id: string, status = 'active') => ({ id, platform: 'mercadolivre', title: `Anúncio ${id}`, status, price: 29.9, currency: 'BRL', quantity: 3, url: 'https://produto.mercadolivre.com.br/'+id, thumbnail: null });
const data = { listings: [listing('MLB1'), listing('MLB2', 'paused'), listing('MLB3', 'closed')], total: 3, complete: true, seller: 'LOJA', fetchedAt: '2026-10-23T17:00:00Z' };
beforeEach(() => { mock.tenantId = 'a'; mock.call.mockReset().mockResolvedValue(data); }); afterEach(cleanup);
it('menu abre Anúncios como página separada', () => {
  const navigate = vi.fn(); render(<Sidebar currentView="anuncios" setCurrentView={navigate} isMobileOpen={true} setIsMobileOpen={vi.fn()} isDesktopOpen={true} setIsDesktopOpen={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Anúncios' })); expect(navigate).toHaveBeenCalledWith('anuncios');
});
it('exibe tags, preço, quantidade e link seguro; plataformas pendentes são explícitas', async () => {
  render(<MarketplaceListings />); await screen.findByText('Anúncio MLB1');
  expect(screen.getAllByText('Integração pendente')).toHaveLength(1);
  const row = screen.getAllByRole('article')[0]; expect(within(row).getByText('Mercado Livre')).toBeTruthy();
  expect(within(row).getByText(/29,90/)).toBeTruthy(); expect(within(row).getByText('Quantidade no canal: 3')).toBeTruthy();
  expect(within(row).getByRole('link').getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.change(screen.getByLabelText('Plataforma'), { target: { value: 'shopee' } });
  expect(screen.getByText(/Shopee ainda não está integrado/)).toBeTruthy(); expect(screen.queryAllByRole('article')).toHaveLength(0);
});
it('filtra por status e busca normalizada por nome/código', async () => {
  render(<MarketplaceListings />); await screen.findByText('Anúncio MLB1');
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paused' } });
  expect(screen.getAllByRole('article')).toHaveLength(1); expect(screen.getByText('Anúncio MLB2')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
  fireEvent.change(screen.getByLabelText('Buscar anúncio'), { target: { value: 'anuncio mlb3' } });
  expect(screen.getAllByRole('article')).toHaveLength(1); expect(screen.getByText('Anúncio MLB3')).toBeTruthy();
});
it('pagina 25 por vez e atualização força nova consulta', async () => {
  mock.call.mockResolvedValue({ ...data, total: 26, listings: Array.from({ length: 26 }, (_, i) => listing('MLB'+i)) });
  render(<MarketplaceListings />); await screen.findByText('Anúncio MLB0');
  expect(screen.getAllByRole('article')).toHaveLength(25); fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
  expect(screen.getAllByRole('article')).toHaveLength(1); expect(screen.getByText('Anúncio MLB25')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar anúncios' }));
  await vi.waitFor(() => expect(mock.call).toHaveBeenLastCalledWith(mock.user, '/api/tenants/a/marketplace-listings?refresh=1'));
  await screen.findByText('Anúncio MLB0');
});
it('erro apaga resultado anterior e informa indisponibilidade, não zero anúncios', async () => {
  render(<MarketplaceListings />); await screen.findByText('Anúncio MLB1'); mock.call.mockRejectedValue(Error('Acesso revogado'));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar anúncios' })); await screen.findByRole('alert');
  expect(screen.queryAllByRole('article')).toHaveLength(0); expect(screen.getByText('Consulta indisponível')).toBeTruthy();
});
it('troca de empresa elimina resultados e ignora resposta antiga', async () => {
  let finish: (value: any) => void = () => {}; mock.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<MarketplaceListings />); mock.tenantId = 'b'; mock.call.mockResolvedValue({ ...data, listings: [], total: 0 });
  view.rerender(<MarketplaceListings />); await screen.findByText(/Nenhum anúncio encontrado/);
  finish(data); await vi.waitFor(() => expect(screen.queryAllByRole('article')).toHaveLength(0));
});
it('mostra cobertura parcial e descarta URLs inseguras e quantidades inválidas', async () => {
  mock.call.mockResolvedValue({ ...data, complete: false, total: 1001 }); render(<MarketplaceListings />);
  expect(await screen.findByText(/Consulta parcial: 3 de 1001/)).toBeTruthy();
  expect(safeListingUrl('https://mercadolivre.com.br.evil.example/x', 'mercadolivre.com.br')).toBeNull();
  expect(safeListingUrl('javascript:alert(1)', 'mercadolivre.com.br')).toBeNull();
  const row = normalizeMLListing({ id: 'MLB1', available_quantity: -1, price: NaN, permalink: 'https://evil.example' });
  expect(row).toMatchObject({ price: null, quantity: null, url: null });
});

it('usa a foto HTTPS quando o Mercado Livre só oferece thumbnail HTTP', () => {
  const row = normalizeMLListing({ id: 'MLB1', thumbnail: 'http://http2.mlstatic.com/small.jpg', pictures: [{ secure_url: 'https://http2.mlstatic.com/large.jpg' }] });
  expect(row.thumbnail).toBe('https://http2.mlstatic.com/large.jpg');
  expect(normalizeMLListing({ id: 'MLB2', pictures: [{ secure_url: 'https://evil.example/photo.jpg' }] }).thumbnail).toBeNull();
});
