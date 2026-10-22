// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MercadoLivreCredentials } from '../../src/features/integrations/MercadoLivreCredentials';
const mock = vi.hoisted(() => ({ call: vi.fn(), user: { uid: 'admin', getIdToken: vi.fn() }, tenantId: 'a' }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user, tenantId: mock.tenantId }) }));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: (...args: any[]) => mock.call(...args) }));
const data = { clientId: '2379102902840747', hasSecret: false, revision: 0, storageReady: true };
beforeEach(() => { mock.tenantId = 'a'; mock.call.mockReset().mockResolvedValue(data); });
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
  expect(screen.queryByRole('button', { name: /Conectar/ })).toBeNull();
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
