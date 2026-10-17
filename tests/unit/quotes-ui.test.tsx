// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { customQuote } from '../fixtures/quotes';
import { quoteCost } from '../../server/quote-cost';
const state = vi.hoisted(() => ({
  data: {} as Record<string, any[]>,
  api: vi.fn(),
  write: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ db: {} }));
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ tenantId: 'a', user: { uid: 'a' } }),
}));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: state.api }));
vi.mock('firebase/firestore', () => ({
  collection: (_: any, path: string) => ({ path }),
  doc: (_: any, path: string) => ({ path }),
  query: (ref: any) => ref,
  limit: () => ({}),
  orderBy: () => ({}),
  getDoc: vi.fn(),
  onSnapshot: (ref: any, cb: any) => {
    const values = state.data[ref.path] ?? [];
    cb({ size: values.length, docs: values.map(({ id, ...d }: any) => ({ id, data: () => d })) });
    return () => {};
  },
  addDoc: state.write,
  updateDoc: state.write,
  setDoc: state.write,
}));
import { QuotesWorkspace, QuotePreview } from '../../src/features/quotes/QuotesPage';
const renderPage = () =>
  render(
    <QuotesWorkspace tenantId="a" user={{ uid: 'a' }} onInventory={vi.fn()} onCatalog={vi.fn()} />,
  );
const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => {
  state.data = {};
  state.api.mockReset().mockResolvedValue({ revision: 1 });
  state.write.mockReset();
});
afterEach(cleanup);
it('novo orçamento avulso inicia com custos vazios, permite rascunho e não exige produto', async () => {
  renderPage();
  fireEvent.click(screen.getByText('Novo orçamento'));
  expect((screen.getByLabelText('Custo unitário confirmado (R$)') as HTMLInputElement).value).toBe(
    '',
  );
  expect(screen.queryByLabelText('Produto')).toBeNull();
  fill('Cliente', 'Maria');
  fill('Descrição do item', 'Personalizado');
  fill('Motivo / registro da operação', 'Nova solicitação');
  fireEvent.click(screen.getByText('Salvar rascunho / iniciar revisão'));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(1));
  expect(state.api.mock.calls[0][2]).toMatchObject({
    type: 'save-draft',
    expectedRevision: 0,
    payload: { data: { lines: [{ kind: 'custom', customUnitCost: '', productId: '' }] } },
  });
  expect(state.write).not.toHaveBeenCalled();
});
it('retry conserva a chave após falha de rede e mostra pendência de custo recebida do servidor', async () => {
  state.api
    .mockRejectedValueOnce(new Error('Custo unitário obrigatório'))
    .mockResolvedValueOnce({ revision: 1 });
  renderPage();
  fireEvent.click(screen.getByText('Novo orçamento'));
  fireEvent.click(screen.getByText('Salvar rascunho / iniciar revisão'));
  expect((await screen.findByRole('alert')).textContent).toContain('Custo unitário obrigatório');
  fireEvent.click(screen.getByText('Salvar rascunho / iniciar revisão'));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
  expect(state.api.mock.calls[0][2]).toEqual(state.api.mock.calls[1][2]);
});
it('prévia permite conferência de centavos e custo; dados pendentes alterados bloqueiam recalcular', async () => {
  const q = customQuote();
  // Firestore does not preserve JavaScript object key insertion order.
  const shuffled = Object.fromEntries(Object.entries(q).reverse());
  state.data['tenants/a/quotes'] = [{ id: 'q', data: shuffled, status: 'draft', revision: 1 }];
  state.api.mockResolvedValue(await quoteCost(async () => undefined, 'a', q));
  renderPage();
  fireEvent.click(screen.getByText(/Cliente — Rascunho/));
  const button = screen.getByText('Calcular prévia') as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(await screen.findByText(/3 × R\$/)).toBeTruthy();
  expect(screen.getByText(/Custo manual confirmado/)).toBeTruthy();
  fill('Cliente', 'Outro');
  expect(button.disabled).toBe(true);
  expect(screen.queryByText('Emitir versão conferida')).toBeNull();
});
it('aprovação mostra origem interna, envia evidência e não permite editar data do aceite', async () => {
  const q = customQuote(),
    snapshot = await quoteCost(async () => undefined, 'a', q);
  state.data['tenants/a/quotes'] = [
    { id: 'q', data: q, status: 'issued', revision: 2, currentVersion: 'v1' },
  ];
  state.data['tenants/a/quotes/q/versions'] = [
    {
      ...snapshot,
      id: 'v1',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  ];
  renderPage();
  fireEvent.click(screen.getByText(/Cliente — Emitido/));
  expect(screen.getByText(/Não é assinatura nem autenticação do cliente/)).toBeTruthy();
  fill('Quem informou o aceite', 'João');
  fill('Canal do aceite', 'WhatsApp');
  fill('Evidência / referência do aceite', 'Conversa 123');
  fireEvent.click(screen.getByText('Registrar aprovação e criar pedido'));
  await waitFor(() => expect(state.api).toHaveBeenCalledTimes(1));
  expect(state.api.mock.calls[0][2]).toMatchObject({
    type: 'approve',
    expectedRevision: 2,
    payload: { versionId: 'v1', reportedBy: 'João', channel: 'WhatsApp', evidence: 'Conversa 123' },
  });
  expect(state.api.mock.calls[0][2].payload).not.toHaveProperty('recordedAt');
});
it('documento reconcilia unitários com centavo residual e alerta resultado negativo', async () => {
  const q = customQuote();
  q.target = { type: 'manual', value: '1' };
  const snapshot = await quoteCost(async () => undefined, 'a', q);
  render(<QuotePreview value={snapshot} />);
  expect(screen.getByText(/2 × R\$.*0,33.*1 × R\$.*0,34/)).toBeTruthy();
  expect(screen.getByText(/Total: R\$.*1,00/)).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('resultado estimado negativo');
});
