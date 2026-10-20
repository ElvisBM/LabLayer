import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';
import { D } from '../../../shared/pricing/engine';
import { inputCents, localDay } from '../../../shared/finance/model';

const money = (v: string | number) =>
  new D(v).toNumber().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cent = (n: number) => money(new D(n).div(100).toFixed());
const input = 'rounded border border-outline-variant/40 bg-surface-container p-2 w-full';
const operations: Record<string, string> = {
  receive: 'Registrar recebimento',
  refund: 'Registrar reembolso',
  'create-payable': 'Criar conta prevista',
  pay: 'Pagar conta',
  reverse: 'Estornar lançamento de caixa',
  'cancel-payable': 'Cancelar conta sem pagamento',
  'close-order': 'Conferir resultado final do pedido',
  'reopen-order': 'Reabrir conferência do pedido',
};
const categoryLabels = {
  material: 'Material (compra E3)',
  energy: 'Energia',
  maintenance: 'Manutenção',
  labor: 'Trabalho',
  shipping: 'Frete',
  equipment: 'Equipamento',
  other: 'Outros',
};
const paymentLabels = {
  unrecorded: 'Sem recebimento',
  partial: 'Parcial',
  paid: 'Recebido integralmente',
  refunded: 'Reembolsado',
};
export function FinancePage({ onOrders, onInventory }: { onOrders(): void; onInventory(): void }) {
  const { tenantId, user } = useAuth();
  return tenantId && user ? (
    <FinanceWorkspace
      key={tenantId}
      tenantId={tenantId}
      user={user}
      onOrders={onOrders}
      onInventory={onInventory}
    />
  ) : null;
}
export function FinanceWorkspace({
  tenantId,
  user,
  onOrders,
  onInventory,
}: {
  tenantId: string;
  user: any;
  onOrders(): void;
  onInventory(): void;
}) {
  const [month, setMonth] = useState(() => localDay(new Date().toISOString()).slice(0, 7));
  const [report, setReport] = useState<any>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [operation, setOperation] = useState(''),
    [fields, setFields] = useState<Record<string, string>>({});
  const [expectedVersion, setExpectedVersion] = useState(0),
    [confirmed, setConfirmed] = useState(false);
  const pending = useRef<{ signature: string; requestId: string } | null>(null),
    generation = useRef(0),
    mounted = useRef(true);
  const refresh = async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const data = await catalogRequest(
        user,
        `/api/tenants/${tenantId}/finance/report?month=${encodeURIComponent(month)}`,
      );
      if (mounted.current && current === generation.current) setReport(data);
    } catch (e) {
      if (mounted.current && current === generation.current) {
        setReport(null);
        setError(e instanceof Error ? e.message : 'Falha ao conferir.');
      }
    } finally {
      if (mounted.current && current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [tenantId, month]);
  const set = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));
  const field = (key: string, label: string, type = 'text') => (
    <label className="block">
      {label}
      <input
        className={input}
        type={type}
        value={fields[key] ?? ''}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const select = (
    key: string,
    label: string,
    rows: { id: string; label: string }[],
    change?: (value: string) => void,
  ) => (
    <label className="block">
      {label}
      <select
        className={input}
        value={fields[key] ?? ''}
        onChange={(e) => {
          set(key, e.target.value);
          change?.(e.target.value);
        }}
      >
        <option value="">Selecione</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
  const submit = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const reason = fields.reason ?? '';
      let payload: any;
      if (['receive', 'refund', 'pay', 'reverse'].includes(operation)) {
        // The input is explicitly labelled UTC-03:00; persisted instants always include a zone.
        const effectiveAt = fields.effectiveAt
          ? new Date(`${fields.effectiveAt}:00-03:00`).toISOString()
          : '';
        payload =
          operation === 'reverse'
            ? { eventId: fields.eventId, effectiveAt, reason }
            : {
                ...(operation === 'pay'
                  ? { payableId: fields.payableId }
                  : { orderId: fields.orderId, feeCents: inputCents(fields.fee ?? '') }),
                amountCents: inputCents(fields.amount ?? ''),
                source: fields.source ?? '',
                effectiveAt,
                reason,
              };
      } else if (operation === 'create-payable')
        payload = {
          description: fields.description ?? '',
          category: fields.category ?? '',
          amountCents: inputCents(fields.amount ?? ''),
          dueDate: fields.dueDate ?? '',
          purchaseId: fields.purchaseId ?? '',
          source: fields.source ?? '',
          reason,
        };
      else if (operation === 'cancel-payable') payload = { payableId: fields.payableId, reason };
      else if (operation === 'close-order')
        payload = {
          orderId: fields.orderId,
          actualExtraCents: inputCents(fields.extra ?? ''),
          source: fields.source ?? '',
          confirmed,
          reason,
        };
      else payload = { orderId: fields.orderId, reason };
      const body = { type: operation, expectedVersion, payload },
        signature = JSON.stringify(body);
      if (pending.current?.signature !== signature)
        pending.current = { signature, requestId: crypto.randomUUID() };
      await catalogRequest(user, `/api/tenants/${tenantId}/finance/commands`, {
        ...body,
        requestId: pending.current.requestId,
      });
      if (mounted.current) {
        pending.current = null;
        setNotice('Operação registrada e auditada.');
        setOperation('');
        setFields({});
        setConfirmed(false);
        await refresh();
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Falha ao registrar.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">Financeiro e conciliação</h2>
      <p>
        Visão gerencial do modelo novo. Pedido aprovado, caixa realizado e custo de expedição são
        apresentados separadamente. Energia e manutenção pagas aparecem no caixa; não são
        descontadas novamente do custo já absorvido no estoque.
      </p>
      <div className="flex gap-4">
        <button onClick={onOrders}>Orçamentos e pedidos</button>
        <button onClick={onInventory}>Estoque e produção</button>
        <button disabled={loading || busy} onClick={() => refresh()}>
          Atualizar e conciliar
        </button>
      </div>
      <label>
        Mês de referência (São Paulo)
        <input
          className={input}
          type="month"
          value={month}
          disabled={busy}
          onChange={(e) => {
            setMonth(e.target.value);
            setOperation('');
            setReport(null);
          }}
        />
      </label>
      {loading && <p role="status">Conferindo eventos e projeções...</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {report && (
        <>
          <p>{report.legacyNotice}</p>
          {report.inventory?.control?.phase !== 'active' && (
            <p role="alert">
              Ative e confira o estoque E3 antes de registrar operações financeiras.
            </p>
          )}
          <p role={report.consistent ? 'status' : 'alert'}>
            {report.consistent
              ? 'Conciliação técnica sem divergências nos registros carregados.'
              : 'Há divergências: revise os eventos antes de fechar pedidos.'}{' '}
            Gerado em{' '}
            {new Date(report.generatedAt).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })}
            .
          </p>
          {[
            ...report.discrepancies,
            ...(report.inventory?.discrepancies ?? []),
            ...(report.inventory?.issues ?? []),
          ].map((s: string, i: number) => (
            <p role="alert" key={i}>
              {s}
            </p>
          ))}
          <div className="grid gap-4 md:grid-cols-3">
            <p>
              Pedidos aprovados no mês, bruto (data de aprovação):{' '}
              <strong>{cent(report.approvedRevenueCents)}</strong> · Cancelamentos no mês (data do
              cancelamento): <strong>{cent(report.cancelledRevenueCents)}</strong>
            </p>
            <p>
              Movimentação líquida de caixa no mês (data efetiva):{' '}
              <strong>{cent(report.cash.netCents)}</strong>. Não é saldo bancário.
            </p>
            <p>
              Resultado gerencial dos {report.closedOrderCount} pedidos com conferência vigente no
              mês (data da conferência): <strong>{money(report.confirmedOrderProfit)}</strong>. Não
              é lucro líquido da empresa.
            </p>
            <p>
              A receber, todos os pedidos ativos: <strong>{cent(report.receivableCents)}</strong>
            </p>
            <p>
              A pagar, todas as contas previstas: <strong>{cent(report.payableCents)}</strong>. Não
              reduz caixa realizado.
            </p>
            <p>
              Compras recebidas no mês: <strong>{money(report.purchaseValue)}</strong> · Estornos de
              compra no mês: <strong>{money(report.purchaseReversalValue)}</strong>. Não são
              pagamentos presumidos.
            </p>
          </div>
          <details>
            <summary>Pendências operacionais e financeiras ({report.pending.length})</summary>
            {report.pending.map((p: string, i: number) => (
              <p key={i}>{p}</p>
            ))}
          </details>
          <fieldset
            disabled={busy || loading || report.inventory?.control?.phase !== 'active'}
            className="space-y-3 rounded border p-4"
          >
            <legend>Registrar operação financeira</legend>
            <label>
              Operação
              <select
                className={input}
                value={operation}
                onChange={(e) => {
                  setOperation(e.target.value);
                  setFields({});
                  setExpectedVersion(0);
                  setConfirmed(false);
                }}
              >
                <option value="">Selecione</option>
                {Object.entries(operations).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {operation && (
              <>
                {['receive', 'refund', 'close-order', 'reopen-order'].includes(operation) &&
                  select(
                    'orderId',
                    'Pedido',
                    report.orders
                      .filter((o: any) => o.status === 'active')
                      .map((o: any) => ({
                        id: o.id,
                        label: `${o.customerName} — ${o.id} — ${cent(o.priceCents)}`,
                      })),
                    (v) =>
                      setExpectedVersion(
                        report.orders.find((o: any) => o.id === v)?.account.version ?? 0,
                      ),
                  )}
                {['pay', 'cancel-payable'].includes(operation) &&
                  select(
                    'payableId',
                    'Conta prevista',
                    report.payables
                      .filter((p: any) => p.status === 'active')
                      .map((p: any) => ({
                        id: p.id,
                        label: `${p.description} — restante ${cent(p.outstandingCents)}`,
                      })),
                    (v) =>
                      setExpectedVersion(
                        report.payables.find((p: any) => p.id === v)?.version ?? 0,
                      ),
                  )}
                {operation === 'reverse' && (
                  <>
                    {select(
                      'eventId',
                      'Lançamento do mês',
                      report.events
                        .filter((e: any) => e.type !== 'reverse')
                        .map((e: any) => ({
                          id: e.id,
                          label: `${e.source} — ${cent(e.cashCents)} — ${e.effectiveDay}`,
                        })),
                      (v) => {
                        const e = report.events.find((e: any) => e.id === v);
                        setExpectedVersion(
                          e?.accountKind === 'order'
                            ? (report.orders.find((o: any) => o.id === e.accountId)?.account
                                .version ?? 0)
                            : (report.payables.find((p: any) => p.id === e?.accountId)?.version ??
                                0),
                        );
                      },
                    )}
                    <p>
                      Para estornar lançamento de outro mês, selecione o mês de origem acima. O
                      estorno terá sua própria data efetiva.
                    </p>
                  </>
                )}
                {operation === 'create-payable' && (
                  <>
                    {field('description', 'Descrição da conta')}
                    {select(
                      'category',
                      'Categoria',
                      Object.entries(categoryLabels).map(([id, label]) => ({ id, label })),
                    )}
                    {field('dueDate', 'Vencimento', 'date')}
                    {select(
                      'purchaseId',
                      'Compra recebida (obrigatória para material)',
                      report.purchases
                        .filter((p: any) => !p.reversed)
                        .map((p: any) => ({
                          id: p.id,
                          label: `${p.source} — ${money(p.value)} — ${p.item.id}`,
                        })),
                      (v) => {
                        const p = report.purchases.find((p: any) => p.id === v);
                        if (p) {
                          set('amount', new D(p.value).toDecimalPlaces(2).toFixed(2));
                          set('category', 'material');
                        }
                      },
                    )}
                  </>
                )}
                {['receive', 'refund', 'pay', 'create-payable'].includes(operation) &&
                  field('amount', 'Valor bruto (R$)')}
                {['receive', 'refund'].includes(operation) && (
                  <>
                    {field(
                      'fee',
                      operation === 'receive'
                        ? 'Taxa efetivamente retida (R$; informe zero se não houver)'
                        : 'Taxa devolvida pelo intermediário (R$; informe zero se não houver)',
                    )}
                    <p>
                      O recebimento bruto quita o pedido; a taxa reduz o dinheiro líquido que
                      entrou.
                    </p>
                  </>
                )}
                {['receive', 'refund', 'pay', 'reverse'].includes(operation) &&
                  field('effectiveAt', 'Data e hora efetiva (UTC−03:00)', 'datetime-local')}
                {['receive', 'refund', 'pay', 'create-payable'].includes(operation) &&
                  field('source', 'Documento/referência única (inclua parcela/linha)')}
                {operation === 'close-order' && (
                  <>
                    {field('extra', 'Despesa real adicional do pedido (R$)')}
                    {field('source', 'Origem da despesa adicional e conferência de taxas')}
                    <p>
                      Informe somente despesas deste pedido ainda não incluídas no custo de
                      expedição nem nas taxas retidas. Zero deve ser confirmado. Despesas de caixa
                      não são importadas automaticamente como custo.
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />{' '}
                      Conferi todas as taxas e despesas finais, sem duplicar custos do estoque
                    </label>
                  </>
                )}
                {field('reason', 'Motivo e conferência')}
                <button onClick={submit}>Confirmar operação</button>
              </>
            )}
          </fieldset>
          <section>
            <h3 className="font-bold">Pedidos: estimado versus realizado</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Preço</th>
                    <th>Recebimento</th>
                    <th>Custo estimado</th>
                    <th>Custo realizado</th>
                    <th>Diferença de custo</th>
                    <th>Taxa estimada / debitada</th>
                    <th>Resultado confirmado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.orders.map((o: any) => (
                    <tr key={o.id}>
                      <td>
                        {o.customerName} · {o.id}
                        <br />
                        {o.status === 'cancelled'
                          ? 'Cancelado'
                          : o.fullyShipped
                            ? 'Expedido'
                            : 'Expedição pendente'}
                      </td>
                      <td>{cent(o.priceCents)}</td>
                      <td>
                        {paymentLabels[o.paymentStatus] ?? o.paymentStatus} ·{' '}
                        {cent(o.receivedCents)}
                      </td>
                      <td>{o.estimatedCost === null ? 'Desconhecido' : money(o.estimatedCost)}</td>
                      <td>
                        {o.actualCost === null
                          ? 'Pendente de expedição/conferência'
                          : money(o.actualCost)}
                      </td>
                      <td>{o.costVariance === null ? 'Pendente' : money(o.costVariance)}</td>
                      <td>
                        {o.estimatedFeesCents === null
                          ? 'Desconhecida'
                          : cent(o.estimatedFeesCents)}{' '}
                        / {cent(o.actualFeesCents)}
                      </td>
                      <td>{o.actualProfit === null ? 'Pendente' : money(o.actualProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              O custo realizado usa as saídas de estoque, perdas totais vinculadas e despesas
              adicionais confirmadas. Diferenças podem refletir consumo real, perdas, custo médio,
              lote excedente ou tarifas. Custos antigos desconhecidos não viram zero.
            </p>
            {report.orders.map((o: any) => (
              <details key={o.id}>
                <summary>
                  Memória de conferência — {o.customerName} · {o.id}
                </summary>
                <p>
                  Custo das execuções vinculadas: {money(o.productionCost)} · Perda total sem
                  entrada de acabado: {money(o.lossCost)} · Custo expedido:{' '}
                  {o.shipmentCost === null ? 'Pendente' : money(o.shipmentCost)}.
                </p>
                <p>
                  Origem das despesas finais: {o.account.expenseSource ?? 'Ainda não conferida'} ·
                  Adicional:{' '}
                  {o.account.actualExtraCents === undefined
                    ? 'Pendente'
                    : cent(o.account.actualExtraCents)}
                  . Preparação e energia já absorvidas no estoque não são somadas outra vez.
                </p>
                {o.targets.map((t: any) => (
                  <p key={t.id}>
                    {t.description} · pedido {t.quantity} · reservado {t.fulfillment?.reserved ?? 0}{' '}
                    · expedido {t.fulfillment?.shipped ?? 0}
                  </p>
                ))}
                {(o.closures ?? []).map((c: any) => (
                  <p key={c.id}>
                    Conferência preservada em{' '}
                    {new Date(c.createdAt).toLocaleString('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                    })}
                    : custo {money(c.actualCost)} · {c.account.reason}
                  </p>
                ))}
              </details>
            ))}
          </section>
          <section>
            <h3 className="font-bold">Contas previstas e pagamentos</h3>
            {report.payables.map((p: any) => (
              <p key={p.id}>
                {p.description} · {categoryLabels[p.category]} · vence {p.dueDate} · previsto{' '}
                {cent(p.amountCents)} · pago {cent(p.paidCents)} · restante{' '}
                {cent(p.outstandingCents)} · {p.status === 'cancelled' ? 'cancelada' : 'ativa'}
              </p>
            ))}
          </section>
          <section>
            <h3 className="font-bold">Movimentos de caixa do mês</h3>
            <p>
              Bruto recebido: {cent(report.cash.receivedCents)} · Reembolsos:{' '}
              {cent(report.cash.refundedCents)} · Taxas líquidas: {cent(report.cash.feesCents)} ·
              Pagamentos: {cent(report.cash.paidCents)}. Estornos compensam suas parcelas na data
              efetiva.
            </p>
            {report.events.map((e: any) => (
              <p key={e.id}>
                {e.effectiveDay} · {e.source} ·{' '}
                {e.type === 'reverse' ? 'Estorno' : operations[e.type]} · líquido{' '}
                {cent(e.cashCents)} · {e.reason}
              </p>
            ))}
          </section>
          <section>
            <h3 className="font-bold">Itens em pedidos aprovados no mês</h3>
            {report.ranking.map((r: any) => (
              <p key={r.id}>
                {r.label} · ID {r.id} · {r.quantity} unidades · {cent(r.revenueCents)}
              </p>
            ))}
          </section>
          <section>
            <h3 className="font-bold">Impressoras e alertas operacionais</h3>
            {report.printers.map((p: any) => (
              <p key={p.id}>
                {p.name} · {p.status} · horas após corte:{' '}
                {new D(p.secondsAfterCut).div(3600).toFixed(2)}
                {p.status !== 'operacional' && ' · indisponível para novos planos'}
              </p>
            ))}
            <p>
              Horas vêm das execuções registradas. Não há previsão automática de manutenção nem
              estimativa de precisão do histórico anterior.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
