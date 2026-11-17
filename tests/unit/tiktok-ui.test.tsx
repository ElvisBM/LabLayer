// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TikTokCredentials, tikTokNavigation } from '../../src/features/integrations/TikTokCredentials';
import { MarketplaceListings } from '../../src/features/integrations/MarketplaceListings';
const mock = vi.hoisted(() => ({ call: vi.fn(), user: { uid: 'owner', getIdToken: vi.fn() }, tenantId: 'a' }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user, tenantId: mock.tenantId }) }));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: (...args: any[]) => mock.call(...args) }));
const settings = { appKey: 'my-app', serviceId: '123', hasSecret: true, revision: 1, storageReady: true, connection: { status: 'not-connected', shops: [], connectionId: null, shop: null } };
beforeEach(() => { mock.tenantId = 'a'; mock.call.mockReset().mockResolvedValue(settings); }); afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('saved secret is blank, preservation and authorization are explicit', async () => {
  render(<TikTokCredentials />); await screen.findByDisplayValue('my-app');
  expect((screen.getByLabelText('App Secret') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar credenciais TikTok' }));
  await vi.waitFor(() => expect(mock.call).toHaveBeenCalledWith(mock.user, '/api/tenants/a/integrations/tiktokshop/credentials', { appKey: 'my-app', serviceId: '123', appSecret: '', expectedRevision: 1 }));
  expect(await screen.findByText(/Credenciais salvas. Clique/)).toBeTruthy();
});
it('unsaved changes disable authorization and failed save requires reload', async () => {
  render(<TikTokCredentials />); await screen.findByDisplayValue('my-app');
  fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'replacement-secret-test' } });
  expect((screen.getByRole('button', { name: 'Conectar TikTok Shop' }) as HTMLButtonElement).disabled).toBe(true);
  mock.call.mockRejectedValueOnce(Error('Configuração alterada'));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar credenciais TikTok' })); await screen.findByRole('alert');
  expect((screen.getByLabelText('App Secret') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('App Key').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
});
it('only navigates to authorized TikTok host', async () => {
  const navigation = vi.spyOn(tikTokNavigation, 'open').mockImplementation(() => {});
  render(<TikTokCredentials />); await screen.findByDisplayValue('my-app');
  mock.call.mockResolvedValueOnce({ authorizationUrl: 'https://evil.example/open/authorize' });
  fireEvent.click(screen.getByRole('button', { name: 'Conectar TikTok Shop' })); await screen.findByRole('alert'); expect(navigation).not.toHaveBeenCalled();
  mock.call.mockResolvedValueOnce({ authorizationUrl: 'https://services.tiktokshop.com/open/authorize?service_id=123&state=test' });
  fireEvent.click(screen.getByRole('button', { name: 'Conectar TikTok Shop' })); await vi.waitFor(() => expect(navigation).toHaveBeenCalledTimes(1));
});
it('requires explicit shop selection even when only one shop is authorized', async () => {
  const connected = { ...settings, connection: { status: 'select-shop', connectionId: 'version', shops: [{ id: '55', name: 'Minha loja', region: 'BR' }], shop: null } };
  mock.call.mockResolvedValue(connected); render(<TikTokCredentials />); await screen.findByDisplayValue('my-app');
  const save = screen.getByRole('button', { name: 'Usar esta loja' }); expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Loja desta empresa'), { target: { value: '55' } }); fireEvent.click(save);
  await vi.waitFor(() => expect(mock.call).toHaveBeenCalledWith(mock.user, '/api/tenants/a/integrations/tiktokshop/select-shop', { shopId: '55', connectionId: 'version' }));
});
it('tenant change discards old credentials and forbidden members have no form', async () => {
  let finish!: (v: any) => void; mock.call.mockImplementationOnce(() => new Promise(resolve => finish = resolve));
  const view = render(<TikTokCredentials />); mock.tenantId = 'b'; mock.call.mockRejectedValue(Error('Sem permissão')); view.rerender(<TikTokCredentials />);
  await screen.findByRole('alert'); finish(settings); await vi.waitFor(() => expect(screen.queryByLabelText('App Key')).toBeNull());
});
const row = { id: '1234', platform: 'tiktok', title: 'Produto TikTok', status: 'active', price: 29.9, currency: 'BRL', quantity: 5, url: null, thumbnail: null };
const tiktok = { status: 'connected', listings: [row], total: 1, complete: true, fetchedAt: '2026-10-23T17:00:00Z', seller: 'LOJA' };
it('TikTok remains visible when Mercado Livre fails and does not expose unsupported actions', async () => {
  mock.call.mockImplementation((_u, path) => path.includes('/tiktokshop/') ? Promise.resolve(tiktok) : Promise.reject(Error('Falha Mercado Livre')));
  render(<MarketplaceListings />); await screen.findByText('Produto TikTok'); await screen.findByRole('alert');
  const article = screen.getByRole('article'); expect(within(article).getByText('TikTok Shop')).toBeTruthy(); expect(within(article).queryByRole('button')).toBeNull();
  fireEvent.change(screen.getByLabelText('Plataforma'), { target: { value: 'tiktok' } }); expect(screen.getByText('Produto TikTok')).toBeTruthy();
});
it('TikTok error does not hide Mercado Livre; refresh removes stale TikTok rows', async () => {
  const ml = { ...tiktok, canManage: true, listings: [{ ...row, id: 'MLB1', platform: 'mercadolivre', title: 'Produto ML' }] };
  mock.call.mockImplementation((_u, path) => Promise.resolve(path.includes('/tiktokshop/') ? tiktok : ml));
  render(<MarketplaceListings />); await screen.findByText('Produto TikTok'); await screen.findByText('Produto ML');
  mock.call.mockImplementation((_u, path) => path.includes('/tiktokshop/') ? Promise.reject(Error('Acesso TikTok revogado')) : Promise.resolve(ml));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar anúncios' })); await screen.findByRole('alert');
  expect(screen.getByText('Produto ML')).toBeTruthy(); expect(screen.queryByText('Produto TikTok')).toBeNull();
});
it('does not navigate on a delayed OAuth reply after changing company', async () => {
  const navigation = vi.spyOn(tikTokNavigation, 'open').mockImplementation(() => {});
  const view = render(<TikTokCredentials />); await screen.findByDisplayValue('my-app');
  let finish!: (v: any) => void; mock.call.mockImplementationOnce(() => new Promise(resolve => finish = resolve));
  fireEvent.click(screen.getByRole('button', { name: 'Conectar TikTok Shop' }));
  mock.tenantId = 'b'; view.rerender(<TikTokCredentials />); await screen.findByDisplayValue('my-app');
  finish({ authorizationUrl: 'https://services.tiktokshop.com/open/authorize?service_id=123&state=old' });
  await new Promise(resolve => setTimeout(resolve, 0)); expect(navigation).not.toHaveBeenCalled();
});
