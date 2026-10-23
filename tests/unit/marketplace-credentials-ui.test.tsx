// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MercadoLivreCredentials, marketplaceNavigation } from '../../src/features/integrations/MercadoLivreCredentials';
const mock = vi.hoisted(() => ({ call: vi.fn(), user: { uid: 'admin', getIdToken: vi.fn() }, tenantId: 'a' }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user, tenantId: mock.tenantId }) }));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: (...args: any[]) => mock.call(...args) }));
const data = { clientId: '2379102902840747', hasSecret: false, revision: 0, storageReady: true, oauthReady: true, connection: { status: 'not-connected' } };
beforeEach(() => { window.history.replaceState({}, '', '/'); vi.restoreAllMocks(); mock.tenantId = 'a'; mock.call.mockReset().mockResolvedValue(data); });
afterEach(cleanup);
it('preenche App ID, envia segredo somente ao backend e limpa após salvar sem anunciar conexão', async () => {
  render(<MercadoLivreCredentials />);
  const form = await screen.findByRole('form', { name: 'Credenciais Mercado Livre' });
  expect((screen.getByLabelText('App ID / Client ID') as HTMLInputElement).value).toBe(data.clientId);
  const secret = screen.getByLabelText('Client Secret') as HTMLInputElement;
  expect(secret.type).toBe('password');
  fireEvent.change(secret, { target: { value: 'only-for-test-secret-12345' } });
  mock.call.mockResolvedValue({ ...data, hasSecret: true, revision: 1 });
  fireEvent.submit(form);
  expect(await screen.findByText(/Credenciais salvas com segurança/)).toBeTruthy();
  expect(secret.value).toBe('');
  expect(mock.call).toHaveBeenLastCalledWith(mock.user, '/api/tenants/a/integrations/mercadolivre/credentials', { clientId: data.clientId, clientSecret: 'only-for-test-secret-12345', expectedRevision: 0 });
  expect((screen.getByRole('button', { name: 'Conectar Mercado Livre' }) as HTMLButtonElement).disabled).toBe(false);
});
it('não oferece formulário ao usuário sem permissão', async () => {
  mock.call.mockRejectedValue(Error('Somente administradores da empresa'));
  render(<MercadoLivreCredentials />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Somente administradores da empresa');
  expect(screen.queryByRole('form')).toBeNull();
});
it('falha limpa segredo, não anuncia sucesso e exige recarregar antes de nova escrita', async () => {
  render(<MercadoLivreCredentials />);
  const form = await screen.findByRole('form');
  fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'only-for-test-secret-12345' } });
  mock.call.mockRejectedValue(Error('Configuração alterada'));
  fireEvent.submit(form);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Configuração alterada');
  expect((screen.getByLabelText('Client Secret') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText(/salvas com segurança/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Salvar credenciais' }).closest('fieldset')!.disabled).toBe(true);
});
it('troca de empresa descarta segredo e estado do formulário anterior', async () => {
  const view = render(<MercadoLivreCredentials />);
  await screen.findByRole('form');
  fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'only-for-test-secret-12345' } });
  mock.tenantId = 'b'; mock.call.mockResolvedValue({ ...data, clientId: '999999' });
  view.rerender(<MercadoLivreCredentials />);
  await screen.findByRole('form');
  expect((screen.getByLabelText('Client Secret') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('App ID / Client ID') as HTMLInputElement).value).toBe('999999');
});

it('conecta usando revisão salva e navega apenas ao domínio oficial sem segredo na URL', async () => {
  mock.call.mockResolvedValue({ ...data, hasSecret: true, revision: 2 });
  const navigate = vi.spyOn(marketplaceNavigation, 'open').mockImplementation(() => {});
  render(<MercadoLivreCredentials />); const button = await screen.findByRole('button', { name: 'Conectar Mercado Livre' });
  const url = 'https://auth.mercadolivre.com.br/authorization?state=test-state';
  mock.call.mockResolvedValue({ authorizationUrl: url }); fireEvent.click(button);
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(url));
  expect(mock.call).toHaveBeenLastCalledWith(mock.user, '/api/tenants/a/integrations/mercadolivre/connect', { expectedRevision: 2 });
});
it('não permite conectar com alterações não salvas ou cofre indisponível', async () => {
  mock.call.mockResolvedValue({ ...data, hasSecret: true }); render(<MercadoLivreCredentials />);
  const button = await screen.findByRole('button', { name: 'Conectar Mercado Livre' });
  fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'unsaved-new-secret-12345' } });
  expect((button as HTMLButtonElement).disabled).toBe(true); cleanup();
  mock.call.mockResolvedValue({ ...data, hasSecret: true, oauthReady: false }); render(<MercadoLivreCredentials />);
  expect((await screen.findByRole('button', { name: 'Conectar Mercado Livre' }) as HTMLButtonElement).disabled).toBe(true);
});
it('erro ao iniciar não anuncia conexão e URL externa inesperada é bloqueada', async () => {
  mock.call.mockResolvedValue({ ...data, hasSecret: true });
  const navigate = vi.spyOn(marketplaceNavigation, 'open').mockImplementation(() => {});
  render(<MercadoLivreCredentials />); const button = await screen.findByRole('button', { name: 'Conectar Mercado Livre' });
  mock.call.mockResolvedValue({ authorizationUrl: 'https://evil.example' }); fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Endereço de autorização inválido.');
  expect(navigate).not.toHaveBeenCalled(); expect(screen.queryByText('Conta conectada')).toBeNull();
});
it('resultado na URL não pode simular sucesso; conta conectada vem do servidor', async () => {
  window.history.replaceState({}, '', '/?view=configuracoes&mercadolivre=connected');
  render(<MercadoLivreCredentials />); await screen.findByRole('form');
  expect(screen.queryByText('Conta conectada')).toBeNull(); cleanup();
  mock.call.mockResolvedValue({ ...data, hasSecret: true, connection: { status: 'connected', userId: '123', nickname: 'LOJA CERTA' } });
  render(<MercadoLivreCredentials />); expect(await screen.findByText('LOJA CERTA')).toBeTruthy();
  expect(screen.getByText('Conta conectada')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Verificar conexão' })).toBeTruthy();
});
it('mostra cancelamento e permite reiniciar a autorização', async () => {
  window.history.replaceState({}, '', '/?view=configuracoes&mercadolivre=denied');
  mock.call.mockResolvedValue({ ...data, hasSecret: true }); render(<MercadoLivreCredentials />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'A autorização foi cancelada no Mercado Livre. Você pode tentar novamente.');
  expect(await screen.findByRole('button', { name: 'Conectar Mercado Livre' })).toBeTruthy();
});
it('verifica conexão por chamada autenticada e mostra confirmação somente após resposta', async () => {
  mock.call.mockResolvedValue({ ...data, hasSecret: true, connection: { status: 'connected', userId: '123', nickname: 'LOJA' } });
  render(<MercadoLivreCredentials />); const button = await screen.findByRole('button', { name: 'Verificar conexão' });
  mock.call.mockResolvedValue({ connection: { status: 'connected', userId: '123', nickname: 'LOJA' } }); fireEvent.click(button);
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Conexão verificada com o Mercado Livre.');
  expect(mock.call).toHaveBeenLastCalledWith(mock.user, '/api/tenants/a/integrations/mercadolivre/check', {});
});
