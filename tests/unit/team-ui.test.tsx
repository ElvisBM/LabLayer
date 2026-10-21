// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TeamPage } from '../../src/features/team/TeamPage';
const mock = vi.hoisted(() => ({ call: vi.fn(), owner: true, sendVerification: vi.fn(), user: { email: 'owner@example.test', emailVerified: true, reload: vi.fn(), getIdToken: vi.fn(async () => 'token') } }));
vi.mock('firebase/auth', () => ({ sendEmailVerification: mock.sendVerification }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user, tenantId: 'a' }) }));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: (...args: any[]) => mock.call(...args) }));
beforeEach(() => {
  mock.owner = true; mock.user.emailVerified = true; mock.sendVerification.mockReset(); mock.user.reload.mockReset();
  mock.call.mockReset();
  mock.call.mockImplementation(async (_user: unknown, path: string) => path.endsWith('/companies')
    ? { currentTenantId: 'a', companies: [{ id: 'a', name: 'Empresa A', role: 'owner' }] }
    : { tenantId: 'a', companyName: 'Empresa A', isOwner: mock.owner, members: [{ uid: 'a', email: 'owner@example.test', role: 'owner', revision: 0 }, { uid: 'm', email: 'member@example.test', role: 'member', revision: 2 }], requests: [{ uid: 'new', email: 'new@example.test', revision: 1 }] });
});
afterEach(cleanup);
it('mostra empresa, conta e aprova somente com papel e revisão explícitos', async () => {
  render(<TeamPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar new@example.test' }));
  expect(mock.call).toHaveBeenCalledWith(expect.anything(), '/api/tenants/a/team/new/decision', { decision: 'approve', role: 'member', expectedRevision: 1 });
  expect(await screen.findByText(/Acesso aprovado/)).toBeTruthy();
  expect(screen.getByText(/Conta: owner@example.test/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Remover acesso de owner@example.test' })).toBeNull();
});
it('membro não recebe controles de aprovação e pedido não simula acesso concedido', async () => {
  mock.owner = false;
  render(<TeamPage />);
  expect(await screen.findByText(/lista e a aprovação de usuários/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Aprovar new@example.test' })).toBeNull();
  expect(screen.queryByRole('form', { name: 'Cadastrar usuário' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'ID da empresa' }), { target: { value: 'other' } });
  fireEvent.click(screen.getByRole('button', { name: 'Solicitar acesso' }));
  expect(await screen.findByText(/Aguarde a aprovação/)).toBeTruthy();
  expect(mock.call).toHaveBeenCalledWith(expect.anything(), '/api/team/request-access', { tenantId: 'other' });
});

it('cadastra nome, e-mail, papel e senha no tenant atual e limpa a senha após sucesso', async () => {
  render(<TeamPage />);
  await screen.findByRole('form', { name: 'Cadastrar usuário' });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: ' Nova Pessoa ' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'NEW@example.test' } });
  fireEvent.change(screen.getByLabelText('Tipo de acesso'), { target: { value: 'admin' } });
  const password = screen.getByLabelText('Senha inicial') as HTMLInputElement;
  expect(password.type).toBe('password');
  fireEvent.change(password, { target: { value: 'Initial-test-123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar usuário' }));
  expect(await screen.findByText(/Usuário cadastrado com acesso/)).toBeTruthy();
  expect(mock.call).toHaveBeenCalledWith(mock.user, '/api/tenants/a/team/create-user', expect.objectContaining({ requestId: expect.any(String), name: 'Nova Pessoa', email: 'new@example.test', role: 'admin', password: 'Initial-test-123!' }));
  expect(password.value).toBe('');
});

it('falha mantém identificador para retry e não anuncia acesso concedido', async () => {
  render(<TeamPage />);
  const form = await screen.findByRole('form', { name: 'Cadastrar usuário' });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Pessoa' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'new@example.test' } });
  fireEvent.change(screen.getByLabelText('Senha inicial'), { target: { value: 'Initial-test-123!' } });
  mock.call.mockRejectedValue(Error('Serviço indisponível'));
  fireEvent.submit(form);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Serviço indisponível');
  expect(screen.queryByText(/Usuário cadastrado com acesso/)).toBeNull();
  expect((screen.getByLabelText('Senha inicial') as HTMLInputElement).readOnly).toBe(true);
  const firstId = mock.call.mock.calls.at(-1)![2].requestId;
  fireEvent.submit(form);
  await screen.findByRole('alert');
  expect(mock.call.mock.calls.at(-1)![2].requestId).toBe(firstId);
});
it('erro de concessão não anuncia sucesso e remoção exige confirmação', async () => {
  render(<TeamPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remover acesso de member@example.test' }));
  expect(mock.call.mock.calls.filter(call => call[1].endsWith('/revoke'))).toHaveLength(0);
  mock.call.mockImplementationOnce(async () => { throw Error('Sem permissão'); });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Sem permissão');
  expect(screen.queryByText('Acesso removido.')).toBeNull();
});

it('verificação de e-mail só é enviada por ação explícita e renova token após confirmação', async () => {
  mock.user.emailVerified = false;
  mock.user.reload.mockImplementation(async () => { mock.user.emailVerified = true; });
  render(<TeamPage />);
  expect(mock.sendVerification).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar link de verificação' }));
  expect(await screen.findByText('Link de verificação enviado para o e-mail da sua conta.')).toBeTruthy();
  expect(mock.sendVerification).toHaveBeenCalledWith(mock.user);
  fireEvent.click(screen.getByRole('button', { name: 'Já confirmei meu e-mail' }));
  expect(await screen.findByText('E-mail verificado. Você já pode solicitar acesso.')).toBeTruthy();
  expect(mock.user.getIdToken).toHaveBeenCalledWith(true);
});
