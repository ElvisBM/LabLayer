// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { zero } from '../../shared/finance/model';
const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ tenantId: 'a', user: { uid: 'a' } }),
}));
vi.mock('../../src/features/catalog/client', () => ({ catalogRequest: state.api }));
import { FinanceWorkspace } from '../../src/features/finance/FinancePage';
const data = () => ({
  month: '2026-10',
  generatedAt: '2026-10-20T12:00:00Z',
  consistent: true,
  legacyNotice: 'Histórico antigo não migrado.',
  cash: { ...zero(), netCents: 0 },
  approvedRevenueCents: 10000,
  cancelledRevenueCents: 0,
  closedOrderCount: 0,
  confirmedOrderProfit: '0',
  receivableCents: 10000,
  payableCents: 0,
  purchaseValue: '0',
  purchaseReversalValue: '0',
  discrepancies: [],
  pending: [],
  inventory: { consistent: true, discrepancies: [], issues: [], control: { phase: 'active' } },
  orders: [
    {
      id: 'order',
      customerName: 'Cliente',
      priceCents: 10000,
      status: 'active',
      paymentStatus: 'unrecorded',
      receivedCents: 0,
      estimatedCost: '20',
      actualCost: null,
      costVariance: null,
      estimatedFeesCents: 1000,
      actualFeesCents: 0,
      actualProfit: null,
      account: { ...zero(), version: 0 },
      productionCost: '0',
      lossCost: '0',
      shipmentCost: null,
      targets: [],
    },
  ],
  payables: [],
  events: [],
  purchases: [],
  ranking: [],
  printers: [],
});
const page = () =>
  render(
    <FinanceWorkspace tenantId="a" user={{ uid: 'a' }} onOrders={vi.fn()} onInventory={vi.fn()} />,
  );
const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const choose = async (op: string) => {
  await screen.findByLabelText('Operação');
  fill('Operação', op);
};
beforeEach(() => {
  state.api.mockReset().mockResolvedValue(data());
});
afterEach(cleanup);
it('mostra caixa e receita separados, pendências de custo e limitações gerenciais', async () => {
  page();
  await screen.findByText(/Conciliação técnica sem divergências/);
  expect(screen.getByText(/Não é saldo bancário/)).toBeTruthy();
  expect(screen.getByText(/Não é lucro líquido/)).toBeTruthy();
  expect(screen.getByText('Pendente de expedição/conferência')).toBeTruthy();
  expect(screen.getByText(/Histórico antigo não migrado/)).toBeTruthy();
});
it('recebimento usa centavos exatos, taxa explícita, fuso e API autenticada', async () => {
  page();
  await choose('receive');
  fill('Pedido', 'order');
  fill('Valor bruto (R$)', '10,25');
  fill(/Taxa efetivamente/, '0,25');
  fill(/Data e hora/, '2026-10-20T10:00');
  fill(/Documento\/referência/, 'PIX 1');
  fill('Motivo e conferência', 'Extrato');
  fireEvent.click(screen.getByText('Confirmar operação'));
  await waitFor(() =>
    expect(state.api.mock.calls.some((c) => c[2]?.type === 'receive')).toBe(true),
  );
  const body = state.api.mock.calls.find((c) => c[2]?.type === 'receive')![2];
  expect(body).toMatchObject({
    expectedVersion: 0,
    payload: {
      orderId: 'order',
      amountCents: 1025,
      feeCents: 25,
      effectiveAt: '2026-10-20T13:00:00.000Z',
    },
  });
});
it('campo de taxa vazio não é presumido como zero', async () => {
  page();
  await choose('receive');
  fill('Pedido', 'order');
  fill('Valor bruto (R$)', '10');
  fireEvent.click(screen.getByText('Confirmar operação'));
  expect((await screen.findByRole('alert')).textContent).toContain('duas casas');
  expect(state.api.mock.calls.filter((c) => c[2])).toHaveLength(0);
});
it('retorno após falha de conexão reutiliza o comando integral, sem atualizar a versão silenciosamente', async () => {
  state.api.mockImplementation(async (_user, _path, body) => {
    if (body) throw new Error('Conexão interrompida');
    return data();
  });
  page();
  await choose('receive');
  fill('Pedido', 'order');
  fill('Valor bruto (R$)', '10');
  fill(/Taxa efetivamente/, '0');
  fill(/Data e hora/, '2026-10-20T10:00');
  fill(/Documento\/referência/, 'PIX 1');
  fill('Motivo e conferência', 'Extrato');
  fireEvent.click(screen.getByText('Confirmar operação'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Confirmar operação'));
  await waitFor(() => expect(state.api.mock.calls.filter((c) => c[2])).toHaveLength(2));
  const calls = state.api.mock.calls.filter((c) => c[2]);
  expect(calls[0][2]).toEqual(calls[1][2]);
});
it('conferência exige declaração explícita e não preenche despesa real com orçamento', async () => {
  page();
  await choose('close-order');
  expect(
    (screen.getByLabelText('Despesa real adicional do pedido (R$)') as HTMLInputElement).value,
  ).toBe('');
  expect((screen.getByLabelText(/Conferi todas as taxas/) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText(/Despesas de caixa não são importadas/)).toBeTruthy();
});
it('erro de relatório não mostra indicadores como se fossem zero', async () => {
  state.api.mockRejectedValue(new Error('Conciliação excede limite'));
  page();
  expect((await screen.findByRole('alert')).textContent).toContain('excede limite');
  expect(screen.queryByText(/Movimentação líquida de caixa no mês/)).toBeNull();
});
