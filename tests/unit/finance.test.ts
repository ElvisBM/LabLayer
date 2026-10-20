import { expect, it } from 'vitest';
import {
  add,
  cash,
  day,
  financeReport,
  inputCents,
  instant,
  localDay,
  paymentStatus,
  validateAccount,
  zero,
  type DataSet,
} from '../../shared/finance/model';

it('reais entram em centavos exatos e não aceitam arredondamento silencioso', () => {
  expect(inputCents('1,25')).toBe(125);
  expect(inputCents('0')).toBe(0);
  for (const value of ['', '-1', '1.005', '1.000,10', '1e3', 'Infinity'])
    expect(() => inputCents(value)).toThrow();
});
it('mês operacional usa São Paulo e não a data UTC do evento', () => {
  expect(localDay('2026-10-01T01:00:00Z')).toBe('2026-09-30');
  expect(localDay('2026-10-01T03:00:00Z')).toBe('2026-10-01');
  expect(instant('2026-09-30T22:00:00-03:00', Date.parse('2026-10-10T00:00:00Z'))).toBe(
    '2026-10-01T01:00:00.000Z',
  );
});
it('datas impossíveis, sem fuso e caixa futuro são recusados', () => {
  expect(() => day('2026-02-30')).toThrow();
  expect(() => instant('2026-10-01T12:00')).toThrow();
  expect(() => instant('2099-01-01T00:00:00Z')).toThrow();
});
it('recebimento bruto quita dívida; taxa só reduz caixa; reembolso pode manter taxa cobrada', () => {
  const received = { ...zero(), receivedCents: 10000, feesCents: 500 };
  expect(cash(received)).toBe(9500);
  expect(paymentStatus(received, 10000)).toBe('paid');
  const refunded = add(received, { ...zero(), refundedCents: 10000 });
  expect(cash(validateAccount(refunded, 10000, 'order'))).toBe(-500);
  expect(paymentStatus(refunded, 10000)).toBe('refunded');
});
it('excesso de recebimento, reembolso, pagamento e estorno com dependências são barrados', () => {
  expect(() => validateAccount({ ...zero(), receivedCents: 101 }, 100, 'order')).toThrow();
  expect(() =>
    validateAccount({ ...zero(), receivedCents: 100, refundedCents: 101 }, 100, 'order'),
  ).toThrow();
  expect(() => validateAccount({ ...zero(), paidCents: 101 }, 100, 'payable')).toThrow();
  expect(() => validateAccount({ ...zero(), feesCents: -1 }, 100, 'order')).toThrow();
});
function data(): DataSet {
  return {
    salesOrders: [
      {
        id: 'o',
        quoteId: 'o',
        quoteVersionId: 'v',
        targetIds: ['t'],
        customerName: 'Cliente',
        status: 'active',
        priceCents: 10000,
        paymentStatus: 'unrecorded',
        createdAt: '2026-10-01T10:00:00Z',
      },
    ],
    orderTargets: [{ id: 't', salesOrderId: 'o', quoteVersionId: 'v', quantity: 2 }],
    snapshots: [
      {
        quoteId: 'o',
        versionId: 'v',
        cost: '20',
        price: { priceCents: 10000, feeCents: 1000 },
        data: {
          lines: [
            {
              id: 'l',
              kind: 'catalog',
              productId: 'p',
              variationId: 'v',
              description: 'Peça',
              quantity: 2,
            },
          ],
        },
        allocations: [{ totalCents: 10000 }],
      },
    ],
  };
}
it('contas futuras e receita aprovada não viram caixa, e realizado desconhecido fica null', () => {
  const d = data();
  d.payables = [
    {
      id: 'bill',
      amountCents: 500,
      paidCents: 0,
      status: 'active',
      dueDate: '2026-11-01',
      purchaseId: '',
    },
  ];
  const r = financeReport(d, '2026-10');
  expect(r.approvedRevenueCents).toBe(10000);
  expect(r.cash.netCents).toBe(0);
  expect(r.payableCents).toBe(500);
  expect(r.orders[0].actualCost).toBeNull();
  expect(r.consistent).toBe(true);
  expect(r.pending).toHaveLength(2);
});
it('resultado confirmado usa custo expedido e adicional uma vez; energia paga não é descontada novamente', () => {
  const d = data();
  d.salesOrders[0].paymentStatus = 'paid';
  const account = {
    id: 'o',
    ...zero(),
    receivedCents: 10000,
    feesCents: 500,
    status: 'closed',
    version: 2,
    actualExtraCents: 300,
    closedAt: '2026-10-10T10:00:00Z',
  };
  d.financeAccounts = [account];
  d.financeEvents = [
    {
      id: 'r',
      type: 'receive',
      accountKind: 'order',
      accountId: 'o',
      delta: { ...zero(), receivedCents: 10000, feesCents: 500 },
      cashCents: 9500,
      source: 'Recebimento',
      effectiveAt: '2026-10-10T10:00:00Z',
    },
    {
      id: 'p',
      type: 'pay',
      accountKind: 'payable',
      accountId: 'bill',
      delta: { ...zero(), paidCents: 1000 },
      cashCents: -1000,
      source: 'Conta energia',
      effectiveAt: '2026-10-10T10:00:00Z',
    },
  ];
  d.payables = [
    { id: 'bill', category: 'energy', amountCents: 1000, paidCents: 1000, status: 'active' },
  ];
  d.stockShipments = [{ id: 's', orderId: 't', quantity: '2', cost: '22' }];
  d.stockFulfillments = [{ orderId: 't', shipped: '2' }];
  d.orderClosures = [{ orderId: 'o', account, actualCost: '25' }];
  const r = financeReport(d, '2026-10');
  expect(r.orders[0].actualCost).toBe('25');
  expect(r.orders[0].actualProfit).toBe('70');
  expect(r.orders[0].costVariance).toBe('5');
  expect(r.cash.netCents).toBe(8500);
  expect(r.confirmedOrderProfit).toBe('70');
  expect(r.consistent).toBe(true);
});
it('compras mantêm valor histórico e estornos aparecem no próprio mês', () => {
  const d: DataSet = {
    stockPurchases: [
      {
        id: 'purchase',
        commandId: 'event',
        quantity: '10',
        value: '100',
        receivedAt: '2026-09-10T10:00:00Z',
      },
    ],
    stockEvents: [{ id: 'event', type: 'purchase', deltas: [{ quantity: '10', value: '100' }] }],
    stockReversals: [{ id: 'event', createdAt: '2026-10-01T10:00:00Z' }],
  };
  expect(financeReport(d, '2026-09').purchaseValue).toBe('100');
  const october = financeReport(d, '2026-10');
  expect(october.purchaseValue).toBe('0');
  expect(october.purchaseReversalValue).toBe('100');
  expect(october.cash.netCents).toBe(0);
});
it('rankings distinguem IDs com mesmo nome e versões ausentes não viram custo zero', () => {
  const d = data();
  d.snapshots[0].data.lines.push({
    kind: 'catalog',
    productId: 'p2',
    variationId: 'v',
    description: 'Peça',
    quantity: 1,
  });
  d.snapshots[0].allocations = [{ totalCents: 5000 }, { totalCents: 5000 }];
  expect(financeReport(d, '2026-10').ranking.map((r) => r.id)).toEqual(['p/v', 'p2/v']);
  d.snapshots = [];
  const r = financeReport(d, '2026-10');
  expect(r.orders[0].estimatedCost).toBeNull();
  expect(r.consistent).toBe(false);
});
it('projeção financeira divergente e vínculo de estorno órfão são exibidos', () => {
  const d = data();
  d.financeAccounts = [{ id: 'o', ...zero(), receivedCents: 1 }];
  d.financeReversals = [{ id: 'orphan', eventId: 'missing' }];
  const r = financeReport(d, '2026-10');
  expect(r.consistent).toBe(false);
  expect(r.discrepancies.some((s) => s.includes('projeção'))).toBe(true);
  expect(r.discrepancies.some((s) => s.includes('órfão'))).toBe(true);
});
it('situação de impressora e horas vêm do cadastro e das execuções, sem presumir manutenção', () => {
  const r = financeReport(
    {
      printers: [{ id: 'p', name: 'Máquina', status: 'manutenção' }, { id: 'u' }],
      stockPrinterUsage: [{ id: 'p', seconds: 3600 }],
    },
    '2026-10',
  );
  expect(r.printers[0]).toMatchObject({ status: 'manutenção', secondsAfterCut: 3600 });
  expect(r.printers[1].status).toBe('situação não informada');
});
it('cancelamento posterior é mostrado no mês próprio sem apagar aprovações históricas', () => {
  const d = data();
  d.salesOrders[0].status = 'cancelled';
  d.salesOrders[0].cancelledAt = '2026-11-01T10:00:00Z';
  expect(financeReport(d, '2026-10').approvedRevenueCents).toBe(10000);
  expect(financeReport(d, '2026-10').cancelledRevenueCents).toBe(0);
  expect(financeReport(d, '2026-11').cancelledRevenueCents).toBe(10000);
});
