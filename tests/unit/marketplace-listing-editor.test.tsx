// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarketplaceListingEditor } from '../../src/features/integrations/MarketplaceListingEditor';
import { MarketplaceListings } from '../../src/features/integrations/MarketplaceListings';
const mock = vi.hoisted(() => ({ call: vi.fn(), user: { uid: 'owner', getIdToken: vi.fn() }, tenantId: 'a' }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user, tenantId: mock.tenantId }) }));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: (...args: any[]) => mock.call(...args) }));
const listing = { id: 'MLB1', platform: 'mercadolivre', title: 'Peça', status: 'active', price: 29.9, currency: 'BRL', quantity: 3, url: 'https://produto.mercadolivre.com.br/MLB1', thumbnail: null };
const detail = { listing, revision: 'a'.repeat(64), capabilities: { title: true, price: true, titleReason: '', priceReason: '', publish: false, unpublish: true } };
const saved = vi.fn(), back = vi.fn();
const editor = (action: 'edit' | 'publish' | 'unpublish' = 'edit') => render(<MarketplaceListingEditor user={mock.user} tenant="a" id="MLB1" action={action} onSaved={saved} onBack={back} />);
beforeEach(() => { mock.call.mockReset().mockResolvedValue(detail); saved.mockReset(); back.mockReset(); }); afterEach(cleanup);
it('abre página com voltar, consulta atual e exige revisão antes de salvar', async () => {
  editor(); await screen.findByLabelText('Preço');
  fireEvent.change(screen.getByLabelText('Preço'), { target: { value: '34,50' } });
  expect(screen.queryByRole('button',{ name: 'Confirmar e salvar' })).toBeNull();
  fireEvent.click(screen.getByRole('button',{ name: 'Revisar alterações' })); expect(screen.getByText(/29.90 → 34.50/)).toBeTruthy();
  mock.call.mockResolvedValue({ confirmed: true }); fireEvent.click(screen.getByRole('button',{ name: 'Confirmar e salvar' }));
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(mock.call).toHaveBeenLastCalledWith(mock.user, '/api/tenants/a/marketplace-listings/MLB1/actions', expect.objectContaining({ action: 'edit', revision: detail.revision, changes: { price: 34.5 }, requestId: expect.any(String) }));
});
it('despublicar informa pausa reversível e só envia após confirmação', async () => {
  editor('unpublish'); await screen.findByText(/O anúncio será pausado/);
  expect(mock.call).toHaveBeenCalledTimes(1); mock.call.mockResolvedValue({ confirmed: true });
  fireEvent.click(screen.getByRole('button',{ name: 'Confirmar despublicação' })); await vi.waitFor(() => expect(saved).toHaveBeenCalled());
  expect(mock.call.mock.calls[1][2].action).toBe('unpublish'); expect(mock.call.mock.calls[1][2].changes).toBeUndefined();
});
it('publicação proibida fica desabilitada', async () => {
  editor('publish'); await screen.findByText(/Publicação disponível somente/);
  expect((screen.getByRole('button',{ name: 'Confirmar publicação' }) as HTMLButtonElement).disabled).toBe(true);
});
it('campos restritos mostram motivo e não permitem alteração', async () => {
  mock.call.mockResolvedValue({ ...detail, capabilities: { ...detail.capabilities, title: false, price: false, titleReason: 'Título do catálogo', priceReason: 'Preço automático' } });
  editor(); await screen.findByText('Preço automático');
  expect((screen.getByLabelText('Título') as HTMLInputElement).disabled).toBe(true); expect((screen.getByLabelText('Preço') as HTMLInputElement).disabled).toBe(true);
});
it('erro exige reabrir, mantém mensagem e não indica sucesso', async () => {
  editor('unpublish'); await screen.findByText(/O anúncio será pausado/); mock.call.mockRejectedValue(Error('Não foi possível confirmar'));
  fireEvent.click(screen.getByRole('button',{ name: 'Confirmar despublicação' })); await screen.findByRole('alert');
  expect(saved).not.toHaveBeenCalled(); expect((screen.getByRole('button',{ name: 'Confirmar despublicação' }) as HTMLButtonElement).disabled).toBe(true);
  mock.call.mockResolvedValue(detail); fireEvent.click(screen.getByRole('button', { name: 'Reabrir e conferir anúncio' }));
  await vi.waitFor(() => expect((screen.getByRole('button',{ name: 'Confirmar despublicação' }) as HTMLButtonElement).disabled).toBe(false));
});
it('não envia preço inválido e voltar não modifica nada', async () => {
  editor(); await screen.findByLabelText('Preço'); fireEvent.change(screen.getByLabelText('Preço'), { target: { value: '2,123' } });
  expect((screen.getByRole('button',{ name: 'Revisar alterações' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{ name: 'Voltar aos anúncios' })); expect(back).toHaveBeenCalledOnce(); expect(mock.call).toHaveBeenCalledTimes(1);
});
it('lista mostra ações por estado apenas para administrador', async () => {
  mock.call.mockResolvedValue({ listings: [listing, { ...listing, id: 'MLB2', status: 'paused' }], total: 2, complete: true, canManage: true, fetchedAt: new Date().toISOString(), seller: 'LOJA' });
  const view = render(<MarketplaceListings />); await screen.findByRole('button',{ name: 'Despublicar' });
  expect(screen.getByRole('button',{ name: 'Publicar' })).toBeTruthy(); expect(screen.getAllByRole('button',{ name: 'Editar' })).toHaveLength(2);
  mock.call.mockResolvedValue(detail); fireEvent.click(screen.getByRole('button',{ name: 'Despublicar' })); await screen.findByRole('button',{ name: 'Confirmar despublicação' });
  view.unmount(); mock.call.mockResolvedValue({ listings: [listing], total: 1, complete: true, canManage: false, fetchedAt: new Date().toISOString(), seller: 'LOJA' }); render(<MarketplaceListings />);
  await screen.findByText('Somente administradores podem publicar, editar ou despublicar anúncios.'); expect(screen.queryByRole('button',{ name: 'Editar' })).toBeNull();
});
