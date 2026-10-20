import { CatalogError, integer, textValue } from '../catalog/model';
import { D } from '../pricing/engine';

export const TIME_ZONE = 'America/Sao_Paulo';
export function cents(value: unknown, label = 'Valor', positive = false) {
  return integer(value, `${label} em centavos`, positive ? 1 : 0);
}
export function inputCents(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized))
    throw new CatalogError('Informe reais com até duas casas decimais.');
  return cents(new D(normalized).times(100).toNumber());
}
export function day(value: unknown) {
  const v = textValue(value, 'Data', 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(`${v}T12:00:00Z`)) ||
    new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v
  )
    throw new CatalogError('Data de calendário inválida.');
  return v;
}
export function instant(value: unknown, now = Date.now()) {
  const v = textValue(value, 'Data efetiva com fuso', 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v))
    throw new CatalogError('Data efetiva exige horário e fuso explícito.');
  day(v.slice(0, 10));
  const timestamp = Date.parse(v);
  if (!Number.isFinite(timestamp) || timestamp > now + 300000)
    throw new CatalogError('Caixa realizado não admite data futura. Registre uma conta prevista.');
  return new Date(timestamp).toISOString();
}
export function localDay(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new CatalogError('Evento sem instante válido.');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
export function month(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    throw new CatalogError('Mês inválido.');
  return value;
}
export type Delta = {
  receivedCents: number;
  refundedCents: number;
  feesCents: number;
  paidCents: number;
};
export const zero = (): Delta => ({
  receivedCents: 0,
  refundedCents: 0,
  feesCents: 0,
  paidCents: 0,
});
export function add(a: Delta, b: Delta): Delta {
  const result = zero();
  for (const key of Object.keys(result) as (keyof Delta)[]) {
    if (
      !Number.isSafeInteger(a[key]) ||
      !Number.isSafeInteger(b[key]) ||
      !Number.isSafeInteger(a[key] + b[key])
    )
      throw new CatalogError('Projeção financeira inválida.');
    result[key] = a[key] + b[key];
  }
  return result;
}
export const netReceived = (d: Delta) => d.receivedCents - d.refundedCents;
export const cash = (d: Delta) => netReceived(d) - d.feesCents - d.paidCents;
export function validateAccount(d: Delta, totalCents: number, kind: 'order' | 'payable') {
  add(zero(), d);
  if (Object.values(d).some((v) => v < 0))
    throw new CatalogError('Estorno possui dependências; reverta os eventos dependentes primeiro.');
  if (
    kind === 'order' &&
    (d.paidCents !== 0 ||
      netReceived(d) < 0 ||
      netReceived(d) > totalCents ||
      d.feesCents > d.receivedCents)
  )
    throw new CatalogError('Recebimento/reembolso excede o valor ou saldo do pedido.');
  if (
    kind === 'payable' &&
    (d.receivedCents !== 0 ||
      d.refundedCents !== 0 ||
      d.feesCents !== 0 ||
      d.paidCents > totalCents)
  )
    throw new CatalogError('Pagamento excede o saldo da conta.');
  return d;
}
export function paymentStatus(d: Delta, totalCents: number) {
  return totalCents > 0 && netReceived(d) === totalCents
    ? 'paid'
    : netReceived(d) > 0
      ? 'partial'
      : d.refundedCents > 0
        ? 'refunded'
        : 'unrecorded';
}
export const categories = [
  'material',
  'energy',
  'maintenance',
  'labor',
  'shipping',
  'equipment',
  'other',
] as const;
export function category(value: unknown) {
  if (!categories.includes(value as any)) throw new CatalogError('Categoria inválida.');
  return value as (typeof categories)[number];
}

export type DataSet = Record<string, any[]>;
const sumMoney = (values: any[], key: string) =>
  values.reduce((s, v) => s.plus(v[key]), new D(0)).toFixed();
const sumCents = (values: number[]) =>
  values.reduce((s, v) => {
    if (!Number.isSafeInteger(v) || !Number.isSafeInteger(s + v))
      throw new CatalogError(
        'Agregado excede o limite de centavos exatos; reduza o escopo do relatório.',
      );
    return s + v;
  }, 0);
/** Same immutable sources feed API and UI. Unknown costs stay null. Cash never
 * subtracts an estimated cost, stock value or an unpaid payable. */
export function financeReport(data: DataSet, selectedMonth: string) {
  month(selectedMonth);
  const rows = (key: string) => data[key] ?? [];
  const discrepancies: string[] = [],
    pending: string[] = [];
  const inMonth = (value: string) => localDay(value).slice(0, 7) === selectedMonth;
  const projections = new Map<string, Delta>();
  const sources = new Set<string>();
  const reversed = new Set(rows('financeReversals').map((r) => r.id));
  let movement = zero();
  for (const e of rows('financeEvents')) {
    const key = `${e.accountKind}/${e.accountId}`;
    try {
      projections.set(key, add(projections.get(key) ?? zero(), e.delta));
      if (cash(e.delta) !== e.cashCents) discrepancies.push(`${e.id}: caixa diverge das parcelas.`);
      if (inMonth(e.effectiveAt)) movement = add(movement, e.delta);
      if (e.type !== 'reverse') {
        const source = String(e.source).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
        if (sources.has(source)) discrepancies.push(`${e.id}: documento de caixa repetido.`);
        sources.add(source);
      } else {
        const original = rows('financeEvents').find((x) => x.id === e.reverses);
        if (
          !original ||
          original.type === 'reverse' ||
          original.accountId !== e.accountId ||
          original.accountKind !== e.accountKind ||
          Object.keys(zero()).some((k) => e.delta[k] !== -original.delta[k]) ||
          !reversed.has(e.reverses)
        )
          discrepancies.push(`${e.id}: estorno sem evento original compatível.`);
      }
    } catch {
      discrepancies.push(`${e.id}: evento financeiro inválido.`);
    }
  }
  for (const a of rows('financeAccounts')) {
    const key = `order/${a.id}`;
    if (JSON.stringify(add(zero(), a)) !== JSON.stringify(projections.get(key) ?? zero()))
      discrepancies.push(`${a.id}: projeção do pedido diverge dos eventos.`);
    if (!rows('salesOrders').some((o) => o.id === a.id))
      discrepancies.push(`${a.id}: conta financeira sem pedido.`);
    projections.delete(key);
  }
  for (const r of rows('financeReversals'))
    if (!rows('financeEvents').some((e) => e.id === r.eventId && e.reverses === r.id))
      discrepancies.push(`${r.id}: vínculo de estorno órfão.`);
  const payables = rows('payables').map((p) => {
    const key = `payable/${p.id}`,
      ledger = projections.get(key) ?? zero();
    if (p.paidCents !== ledger.paidCents)
      discrepancies.push(`${p.id}: pagamentos divergem da conta.`);
    if (p.status === 'cancelled' && p.paidCents !== 0)
      discrepancies.push(`${p.id}: conta cancelada com pagamento.`);
    try {
      validateAccount(ledger, p.amountCents, 'payable');
    } catch {
      discrepancies.push(`${p.id}: saldo inválido.`);
    }
    projections.delete(key);
    if (p.purchaseId && !rows('stockPurchases').some((x) => x.id === p.purchaseId))
      discrepancies.push(`${p.id}: compra vinculada ausente.`);
    return { ...p, outstandingCents: p.status === 'cancelled' ? 0 : p.amountCents - p.paidCents };
  });
  for (const key of projections.keys()) discrepancies.push(`${key}: eventos sem projeção.`);
  const orders = rows('salesOrders').map((o) => {
    const a = rows('financeAccounts').find((a) => a.id === o.id) ?? {
      ...zero(),
      version: 0,
      status: 'open',
    };
    const snapshot = rows('snapshots').find(
      (s) => s.quoteId === o.id && s.versionId === o.quoteVersionId,
    );
    const targets = rows('orderTargets').filter((t) => t.salesOrderId === o.id);
    const shipments = rows('stockShipments').filter((s) => targets.some((t) => t.id === s.orderId));
    const runs = rows('stockRuns').filter((r) => targets.some((t) => t.id === r.orderId));
    const lossCost = sumMoney(runs, 'lossCost');
    const pendingProduction = rows('stockPlans').some(
      (p) => p.status === 'active' && targets.some((t) => t.id === p.orderId),
    );
    let full =
      targets.length === o.targetIds.length &&
      targets.length > 0 &&
      o.targetIds.every((id: string) => targets.some((t) => t.id === id));
    if (
      !o.targetIds.every((id: string) =>
        targets.some((t) => t.id === id && t.quoteVersionId === o.quoteVersionId),
      )
    )
      discrepancies.push(`${o.id}: alvos divergem do pedido aprovado.`);
    for (const t of targets) {
      const shipped = shipments
        .filter((s) => s.orderId === t.id)
        .reduce((n, s) => n + Number(s.quantity), 0);
      const f = rows('stockFulfillments').find((f) => f.orderId === t.id);
      if (shipped !== Number(f?.shipped ?? 0) || shipped > t.quantity)
        discrepancies.push(`${t.id}: quantidade expedida diverge do atendimento.`);
      if (shipped !== t.quantity) full = false;
    }
    try {
      validateAccount(a, o.priceCents, 'order');
    } catch {
      discrepancies.push(`${o.id}: saldo financeiro inválido.`);
    }
    if (paymentStatus(a, o.priceCents) !== o.paymentStatus)
      discrepancies.push(`${o.id}: situação de pagamento diverge dos eventos.`);
    if (!snapshot || snapshot.price.priceCents !== o.priceCents)
      discrepancies.push(`${o.id}: versão aprovada ausente ou preço divergente.`);
    if (o.status === 'active' && !full) pending.push(`${o.id}: expedição incompleta.`);
    if (o.status === 'active' && a.status !== 'closed')
      pending.push(`${o.id}: despesas e taxas finais ainda não conferidas.`);
    if (a.status === 'closed') {
      const closure = rows('orderClosures').find(
        (c) => c.orderId === o.id && c.account.version === a.version,
      );
      if (
        !closure ||
        closure.account.actualExtraCents !== a.actualExtraCents ||
        closure.account.feesCents !== a.feesCents ||
        !full ||
        pendingProduction ||
        o.priceCents !== netReceived(a)
      )
        discrepancies.push(`${o.id}: conferência final diverge das fontes.`);
    }
    const shipmentCost = shipments.length ? sumMoney(shipments, 'cost') : null;
    const actualCost =
      full && a.status === 'closed' && shipmentCost !== null
        ? new D(shipmentCost).plus(lossCost).plus(new D(a.actualExtraCents).div(100)).toFixed()
        : null;
    if (a.status === 'closed') {
      const closure = rows('orderClosures').find(
        (c) => c.orderId === o.id && c.account.version === a.version,
      );
      if (closure && closure.actualCost !== actualCost)
        discrepancies.push(`${o.id}: custo realizado mudou após a conferência.`);
    }
    const actualProfit =
      actualCost === null
        ? null
        : new D(o.priceCents - a.feesCents).div(100).minus(actualCost).toFixed();
    return {
      id: o.id,
      customerName: o.customerName,
      status: o.status,
      createdAt: o.createdAt,
      cancelledAt: o.cancelledAt ?? null,
      priceCents: o.priceCents,
      paymentStatus: o.paymentStatus,
      account: a,
      receivedCents: netReceived(a),
      receivableCents: o.status === 'cancelled' ? 0 : o.priceCents - netReceived(a),
      fullyShipped: full,
      pendingProduction,
      productionCost: sumMoney(runs, 'totalCost'),
      lossCost,
      shipmentCost,
      estimatedCost: snapshot?.cost ?? null,
      estimatedFeesCents: snapshot?.price.feeCents ?? null,
      actualFeesCents: a.feesCents,
      actualCost,
      actualProfit,
      closures: rows('orderClosures').filter((c) => c.orderId === o.id),
      costVariance:
        actualCost !== null && snapshot ? new D(actualCost).minus(snapshot.cost).toFixed() : null,
      targets: targets.map((t) => ({
        ...t,
        fulfillment: rows('stockFulfillments').find((f) => f.orderId === t.id) ?? null,
      })),
    };
  });
  const purchases = rows('stockPurchases').map((p) => ({
    ...p,
    reversed: rows('stockReversals').some((r) => r.id === p.commandId),
  }));
  for (const p of purchases) {
    const e = rows('stockEvents').find((e) => e.id === p.commandId);
    if (
      !e ||
      e.type !== 'purchase' ||
      e.deltas.length !== 1 ||
      !new D(e.deltas[0].value).eq(p.value) ||
      !new D(e.deltas[0].quantity).eq(p.quantity) ||
      (p.item && ['kind', 'id', 'variationId'].some((k) => e.deltas[0].item?.[k] !== p.item[k]))
    )
      discrepancies.push(`${p.id}: compra diverge do evento de recebimento.`);
  }
  const monthlyPurchases = purchases.filter((p) => inMonth(p.receivedAt));
  const ranking = new Map<string, any>();
  for (const o of orders.filter((o) => inMonth(o.createdAt))) {
    const snapshot = rows('snapshots').find((s) => s.quoteId === o.id);
    if (!snapshot) continue;
    snapshot.data.lines.forEach((line: any, i: number) => {
      const key =
        line.kind === 'catalog'
          ? `${line.productId}/${line.variationId}`
          : `custom/${o.id}/${line.id}`;
      const r = ranking.get(key) ?? {
        id: key,
        label: line.description,
        quantity: 0,
        revenueCents: 0,
      };
      r.quantity += line.quantity;
      r.revenueCents = sumCents([r.revenueCents, snapshot.allocations[i].totalCents]);
      ranking.set(key, r);
    });
  }
  const monthlyOrders = orders.filter((o) => inMonth(o.createdAt));
  const closed = orders.filter((o) => o.actualProfit !== null && inMonth(o.account.closedAt));
  return {
    month: selectedMonth,
    timeZone: TIME_ZONE,
    consistent: discrepancies.length === 0,
    discrepancies,
    pending,
    cash: {
      ...movement,
      netCents: cash(movement),
      label: 'Movimentação líquida registrada; não é saldo bancário',
    },
    approvedRevenueCents: sumCents(monthlyOrders.map((o) => o.priceCents)),
    cancelledRevenueCents: sumCents(
      orders.filter((o) => o.cancelledAt && inMonth(o.cancelledAt)).map((o) => o.priceCents),
    ),
    receivableCents: sumCents(orders.map((o) => o.receivableCents)),
    payableCents: sumCents(payables.map((p) => p.outstandingCents)),
    confirmedOrderProfit: sumMoney(closed, 'actualProfit'),
    closedOrderCount: closed.length,
    purchases,
    purchaseValue: sumMoney(monthlyPurchases, 'value'),
    purchaseReversalValue: sumMoney(
      rows('stockReversals')
        .filter((r) => inMonth(r.createdAt))
        .flatMap((r) => purchases.filter((p) => p.commandId === r.id)),
      'value',
    ),
    orders,
    payables,
    ranking: [...ranking.values()].sort(
      (a, b) => b.revenueCents - a.revenueCents || a.id.localeCompare(b.id),
    ),
    events: rows('financeEvents').filter((e) => inMonth(e.effectiveAt)),
    printers: rows('printers').map((p) => ({
      id: p.id,
      name: p.name,
      status: ['operacional', 'manutenção', 'inativa'].includes(p.status)
        ? p.status
        : 'situação não informada',
      secondsAfterCut: rows('stockPrinterUsage').find((u) => u.id === p.id)?.seconds ?? 0,
    })),
  };
}
