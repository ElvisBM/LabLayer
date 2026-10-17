import { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';
import { useInventoryPhase } from './useInventoryPhase';
import { D } from '../../../shared/pricing/engine';
import { amount, itemKey, requirements, type Item } from '../../../shared/inventory/model';

const resourceNames = [
  'stockBalances',
  'stockReservations',
  'stockPlans',
  'stockFulfillments',
  'stockPrinterUsage',
  'filaments',
  'supplies',
  'catalogItems',
  'orders',
  'orderTargets',
  'salesOrders',
  'stockRuns',
  'stockShipments',
] as const;
const operations: Record<string, string> = {
  freeze: 'Iniciar corte e congelar legado',
  open: 'Registrar saldo de abertura',
  activate: 'Ativar estoque conferido',
  'create-material': 'Cadastrar material',
  purchase: 'Receber compra',
  adjust: 'Ajustar contagem e valor',
  plan: 'Planejar impressão ou montagem',
  complete: 'Concluir execução',
  'reserve-order': 'Reservar produto para pedido',
  ship: 'Expedir reserva de pedido',
  cancel: 'Cancelar reserva restante',
  reverse: 'Estornar compra ou ajuste',
};
const inputClass = 'rounded border border-outline-variant/40 bg-surface-container p-2 w-full';
const decimal = (v: string) => amount(v.trim().replace(',', '.'), 'Valor', 12);
const displayQuantity = (b: any, q: string) =>
  b.item.kind === 'filament' ? `${new D(q).div(1000).toFixed()} g` : `${q} ${b.unit}`;
export function InventoryPage({ onCatalog }: { onCatalog(): void }) {
  const { tenantId, user } = useAuth();
  return tenantId && user ? (
    <InventoryWorkspace key={tenantId} tenantId={tenantId} user={user} onCatalog={onCatalog} />
  ) : null;
}
export function InventoryWorkspace({
  tenantId,
  user,
  onCatalog,
}: {
  tenantId: string;
  user: any;
  onCatalog(): void;
}) {
  const control = useInventoryPhase(tenantId);
  const [resources, setResources] = useState<Record<string, any[]>>({});
  const [events, setEvents] = useState<any[]>([]),
    [recipes, setRecipes] = useState<any[]>([]);
  const [operation, setOperation] = useState(''),
    [fields, setFields] = useState<Record<string, string>>({});
  const [expectedVersion, setExpectedVersion] = useState(0),
    [confirmed, setConfirmed] = useState(false);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null),
    [limited, setLimited] = useState<string[]>([]);
  const pending = useRef<{ signature: string; requestId: string } | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const stops = resourceNames.map((name) =>
      onSnapshot(
        query(collection(db, `tenants/${tenantId}/${name}`), limit(501)),
        (s) => {
          setResources((r) => ({
            ...r,
            [name]: s.docs.slice(0, 500).map((d) => ({ ...d.data(), id: d.id })),
          }));
          setLimited((l) =>
            s.size > 500 ? [...new Set([...l, name])] : l.filter((n) => n !== name),
          );
        },
        () => setError('Não foi possível carregar a operação. Confira o acesso e recarregue.'),
      ),
    );
    stops.push(
      onSnapshot(
        query(
          collection(db, `tenants/${tenantId}/stockEvents`),
          orderBy('createdAt', 'desc'),
          limit(100),
        ),
        (s) => setEvents(s.docs.map((d) => ({ ...d.data(), id: d.id }))),
        () => setError('Erro ao carregar movimentos.'),
      ),
    );
    return () => {
      mounted.current = false;
      stops.forEach((s) => s());
    };
  }, [tenantId]);
  useEffect(() => {
    setRecipes([]);
    if (!fields.productId) return;
    return onSnapshot(
      query(
        collection(db, `tenants/${tenantId}/catalogItems/${fields.productId}/recipes`),
        orderBy('createdAt', 'desc'),
        limit(100),
      ),
      (s) => setRecipes(s.docs.map((d) => ({ ...d.data(), id: d.id }))),
      () => setError('Erro ao carregar fichas.'),
    );
  }, [tenantId, fields.productId]);
  const list = (name: string) => resources[name] ?? [];
  const balances = list('stockBalances');
  const candidates: Array<{ item: Item; label: string; unit: string }> = [
    ...list('filaments').map((f) => ({
      item: { kind: 'filament' as const, id: f.id, variationId: '' },
      label: `${f.material ?? f.id} ${f.color ?? ''}`,
      unit: 'g',
    })),
    ...list('supplies').map((s) => ({
      item: { kind: 'supply' as const, id: s.id, variationId: '' },
      label: s.name,
      unit: s.unit,
    })),
    ...list('catalogItems')
      .filter((p) => p.kind === 'product')
      .flatMap((p) =>
        p.variants.map((v: any) => ({
          item: { kind: 'product' as const, id: p.id, variationId: v.id },
          label: `${p.name} / ${v.name}`,
          unit: 'un',
        })),
      ),
  ];
  const chosen = candidates.find((c) => itemKey(c.item) === fields.itemKey);
  const chosenPlan = list('stockPlans').find((p) => p.id === fields.planId);
  const chosenRecipe = recipes.find((r) => r.id === fields.recipeVersion);
  const assemblyAvailability =
    chosenRecipe?.recipe.kind === 'assembly'
      ? (chosenRecipe.recipe.components.map((c: any) => {
          const b = balances.find(
            (b) =>
              b.item.kind === 'product' &&
              b.item.id === c.productId &&
              b.item.variationId === c.variationId,
          );
          return b ? new D(b.quantity).minus(b.reserved).div(c.quantity).floor().toNumber() : null;
        }) as Array<number | null>)
      : null;
  const set = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));
  function chooseOperation(value: string) {
    setOperation(value);
    setFields({});
    setActual({});
    setExpectedVersion(control.version);
    setConfirmed(false);
    setError('');
    setNotice('');
    pending.current = null;
  }
  function chooseItem(value: string) {
    set('itemKey', value);
    setExpectedVersion(
      operation === 'reserve-order'
        ? (list('stockFulfillments').find((f) => f.orderId === fields.orderId)?.version ?? 0)
        : (balances.find((b) => b.id === value)?.version ?? 0),
    );
  }
  const physical = (i: Item, value: string) =>
    i.kind === 'filament' ? new D(decimal(value)).times(1000).toFixed() : decimal(value);
  async function reconcileNow() {
    setBusy(true);
    setError('');
    try {
      const r = await catalogRequest(user, `/api/tenants/${tenantId}/inventory/reconcile`);
      if (mounted.current) setReport(r);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      let payload: any;
      let expected = expectedVersion;
      const reason = fields.reason ?? '';
      if (operation === 'freeze') {
        if (!confirmed) throw new Error('Confirme a pausa dos operadores e o backup.');
        payload = { reason, backupReference: fields.source };
      } else if (operation === 'activate') payload = { reason, confirmed };
      else if (operation === 'create-material') {
        expected = 0;
        payload = {
          kind: fields.kind,
          id: fields.materialId,
          name: fields.name,
          unit: fields.kind === 'filament' ? 'mg' : fields.unit,
        };
      } else if (['open', 'purchase', 'adjust'].includes(operation)) {
        if (!chosen) throw new Error('Escolha o item.');
        payload = {
          item: chosen.item,
          quantity: physical(chosen.item, fields.quantity),
          value: decimal(fields.value),
          reason,
          source: fields.source,
        };
      } else if (operation === 'plan') {
        expected = 0;
        const recipe = recipes.find((r) => r.id === fields.recipeVersion);
        if (!recipe) throw new Error('Escolha a ficha.');
        payload = {
          productId: fields.productId,
          variationId: recipe.variationId,
          recipeVersion: recipe.id,
          runs: Number(fields.runs),
          reprintOf: fields.reprintOf ?? '',
          reason,
        };
      } else if (operation === 'complete') {
        if (!chosenPlan || !confirmed)
          throw new Error('Confira o consumo, as quantidades e os custos reais.');
        payload = {
          planId: chosenPlan.id,
          runs: Number(fields.runs),
          goodUnits: Number(fields.goodUnits),
          rejectedUnits: Number(fields.rejectedUnits),
          durationSeconds: Number(fields.durationSeconds),
          actual: requirements(chosenPlan.recipe, 1).map((l) => ({
            item: l.item,
            quantity: physical(l.item, actual[itemKey(l.item)] ?? ''),
          })),
          conversion: {
            energy: decimal(fields.energy),
            labor: decimal(fields.labor),
            machine: decimal(fields.machine),
            other: decimal(fields.other),
            source: fields.source,
          },
          reason,
        };
      } else if (operation === 'reserve-order') {
        if (!chosen) throw new Error('Escolha o produto.');
        payload = {
          orderId: fields.orderId,
          item: chosen.item,
          quantity: decimal(fields.quantity),
          reason,
        };
      } else if (operation === 'ship' || operation === 'cancel')
        payload = {
          reservationId: fields.reservationId,
          ...(operation === 'ship' ? { quantity: decimal(fields.quantity) } : {}),
          reason,
        };
      else if (operation === 'reverse')
        payload = { eventId: fields.eventId, reason, physicalConfirmed: confirmed };
      else throw new Error('Selecione a operação.');
      const command = { type: operation, expectedVersion: expected, payload },
        signature = JSON.stringify(command);
      if (pending.current?.signature !== signature)
        pending.current = { signature, requestId: crypto.randomUUID() };
      setBusy(true);
      await catalogRequest(user, `/api/tenants/${tenantId}/inventory/commands`, {
        ...command,
        requestId: pending.current.requestId,
      });
      if (mounted.current) {
        setNotice('Operação registrada. Confira saldos e histórico abaixo.');
        setOperation('');
        setFields({});
        setReport(null);
        pending.current = null;
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const field = (name: string, label: string, type = 'text', required = true) => (
    <label className="block">
      {label}
      <input
        className={inputClass}
        type={type}
        required={required}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 1 : undefined}
        value={fields[name] ?? ''}
        onChange={(e) => set(name, e.target.value)}
      />
    </label>
  );
  const select = (
    name: string,
    label: string,
    options: Array<{ id: string; label: string }>,
    change?: (value: string) => void,
  ) => (
    <label className="block">
      {label}
      <select
        className={inputClass}
        required={name !== 'reprintOf'}
        value={fields[name] ?? ''}
        onChange={(e) => (change ? change(e.target.value) : set(name, e.target.value))}
      >
        <option value="">Selecione</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const enabled =
    control.phase === 'legacy'
      ? ['freeze']
      : control.phase === 'frozen'
        ? ['open', 'adjust', 'create-material', 'activate']
        : control.phase === 'active'
          ? [
              'open',
              'create-material',
              'purchase',
              'adjust',
              'plan',
              'complete',
              'reserve-order',
              'ship',
              'cancel',
              'reverse',
            ]
          : [];
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Estoque e produção</h2>
      <p role="note">
        {control.phase === 'legacy'
          ? 'Preparação do corte: o estoque antigo permanece operacional até o congelamento. Faça backup e confira a classificação dos produtos antes de iniciar. Congelar bloqueia as telas antigas de estoque, vendas, orçamentos e financeiro; execute primeiro em uma empresa de homologação.'
          : control.phase === 'frozen'
            ? 'Operação antiga congelada. Informe quantidades físicas e valores de abertura, inclusive zeros. A ativação exige conferência de todos os itens.'
            : control.phase === 'active'
              ? 'Estoque por movimentos ativo. Reservar separa disponibilidade; somente recebimento, execução, expedição e ajuste alteram o físico.'
              : 'Carregando o estado da operação. Não grave por outra tela enquanto o estado estiver indisponível.'}
      </p>
      <p>
        Novas propostas estão em Orçamentos e pedidos. As expedições atendem seus itens aprovados e
        os pedidos históricos. O fechamento financeiro será integrado na E5.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {limited.length > 0 && (
        <p role="alert">
          Mais de 500 registros: {limited.join(', ')}. Esta tela está limitada; a migração exige
          conferência assistida e não será ativada com relatório incompleto.
        </p>
      )}
      <div className="flex gap-4">
        <button disabled={busy} onClick={onCatalog}>
          Catálogo e fichas
        </button>
        <button disabled={busy || !enabled.length} onClick={reconcileNow}>
          Conferir abertura e conciliação
        </button>
      </div>
      {report && (
        <section className="rounded border p-4">
          <h3>Resultado da conferência</h3>
          <p>
            {report.consistent
              ? 'Movimentos, saldos e reservas reconciliados.'
              : 'Há divergências; confira antes de operar.'}
          </p>
          {[...report.issues, ...report.discrepancies].map((s: string, i: number) => (
            <p key={i}>{s}</p>
          ))}
          <p>Itens identificados: {report.required.length}. Esta conferência não altera saldos.</p>
        </section>
      )}
      <label className="block">
        Operação
        <select
          disabled={busy}
          className={inputClass}
          value={operation}
          onChange={(e) => chooseOperation(e.target.value)}
        >
          <option value="">Escolha uma operação</option>
          {enabled
            .filter(
              (x) =>
                user.uid === tenantId ||
                !['freeze', 'activate', 'open', 'adjust', 'reverse', 'create-material'].includes(x),
            )
            .map((x) => (
              <option key={x} value={x}>
                {operations[x]}
              </option>
            ))}
        </select>
      </label>
      {operation && (
        <form onSubmit={submit} className="border rounded p-4">
          <fieldset disabled={busy} className="grid md:grid-cols-2 gap-4">
            {['freeze', 'open', 'purchase', 'adjust', 'complete'].includes(operation) &&
              field(
                'source',
                operation === 'freeze'
                  ? 'Referência do backup testado'
                  : operation === 'complete'
                    ? 'Origem dos custos reais de conversão'
                    : 'Documento ou origem da contagem (compra: identificação única por linha)',
              )}
            {['freeze', 'activate', 'complete', 'reverse'].includes(operation) && (
              <label className="block">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{' '}
                {operation === 'freeze'
                  ? 'Conferi o backup e pausei os operadores para o corte'
                  : operation === 'activate'
                    ? 'Conferi a abertura física, os valores e os vínculos de todos os itens'
                    : operation === 'reverse'
                      ? 'Conferi o efeito físico que será estornado'
                      : 'Conferi consumo real (incluindo suporte e purga), unidades e custos'}
              </label>
            )}
            {['open', 'purchase', 'adjust', 'reserve-order'].includes(operation) &&
              select(
                'itemKey',
                'Item',
                candidates
                  .filter((c) => operation !== 'reserve-order' || c.item.kind === 'product')
                  .map((c) => ({ id: itemKey(c.item), label: `${c.label} (${c.unit})` })),
                chooseItem,
              )}
            {['open', 'purchase', 'adjust', 'reserve-order', 'ship'].includes(operation) &&
              field(
                'quantity',
                operation === 'adjust' || operation === 'open'
                  ? `Quantidade física conferida (${chosen?.unit ?? 'un'})`
                  : `Quantidade (${chosen?.unit ?? 'un'})`,
              )}
            {['open', 'purchase', 'adjust'].includes(operation) &&
              field(
                'value',
                operation === 'purchase'
                  ? 'Custo total recebido em R$ (incluindo despesas atribuídas)'
                  : 'Valor total do estoque conferido em R$',
              )}
            {operation === 'create-material' && (
              <>
                {select('kind', 'Tipo de material', [
                  { id: 'filament', label: 'Filamento' },
                  { id: 'supply', label: 'Insumo' },
                ])}
                {field('materialId', 'Código único do material')}
                {field('name', 'Nome do material')}
                {fields.kind === 'supply' && field('unit', 'Unidade do insumo')}
              </>
            )}
            {operation === 'plan' && (
              <>
                {assemblyAvailability && (
                  <p role="status">
                    Montáveis pelos componentes disponíveis:{' '}
                    {assemblyAvailability.some((n) => n === null)
                      ? 'abertura pendente'
                      : Math.min(...assemblyAvailability)}
                    . Insumos adicionais também serão conferidos na reserva.
                  </p>
                )}
                {select(
                  'productId',
                  'Produto a fabricar',
                  list('catalogItems')
                    .filter((p) => p.kind === 'product' && p.status === 'active')
                    .map((p) => ({ id: p.id, label: p.name })),
                )}
                {select(
                  'recipeVersion',
                  'Ficha e variação (até 100 versões recentes)',
                  recipes.map((r) => ({
                    id: r.id,
                    label: `${r.variationId} — v${r.version} — ${r.recipe.kind === 'print' ? 'impressão' : 'montagem'}`,
                  })),
                )}
                {field('runs', 'Número de execuções', 'number')}
                {select('reprintOf', 'Reimpressão de execução anterior (opcional)', [
                  { id: '', label: 'Não é reimpressão' },
                  ...list('stockRuns')
                    .filter((r) => r.productId === fields.productId)
                    .map((r) => ({ id: r.id, label: r.id })),
                ])}
                <p>
                  Para um novo plano, deixe a reimpressão vazia. Cada execução usa o rendimento
                  completo da ficha; as saídas reais são conferidas na conclusão.
                </p>
              </>
            )}
            {operation === 'complete' && (
              <>
                {select(
                  'planId',
                  'Plano a concluir',
                  list('stockPlans')
                    .filter((p) => p.status === 'active')
                    .map((p) => ({
                      id: p.id,
                      label: `${p.productId} / ${p.variationId} — ${p.remainingRuns} execuções restantes`,
                    })),
                  (value) => {
                    const p = list('stockPlans').find((p) => p.id === value);
                    set('planId', value);
                    setExpectedVersion(p?.version ?? 0);
                    setActual({});
                  },
                )}
                {field('runs', 'Execuções realizadas', 'number')}
                {field('goodUnits', 'Unidades boas', 'number')}
                {field('rejectedUnits', 'Unidades rejeitadas', 'number')}
                {field('durationSeconds', 'Tempo real em segundos', 'number')}
                {chosenPlan &&
                  requirements(chosenPlan.recipe, 1).map((l) => {
                    const c = candidates.find((c) => itemKey(c.item) === itemKey(l.item));
                    return (
                      <label key={itemKey(l.item)}>
                        Consumo real — {c?.label ?? l.item.id} ({c?.unit ?? 'un'}; previsto por
                        execução:{' '}
                        {l.item.kind === 'filament'
                          ? new D(l.quantity).div(1000).toFixed()
                          : l.quantity}
                        )
                        <input
                          className={inputClass}
                          required
                          value={actual[itemKey(l.item)] ?? ''}
                          onChange={(e) =>
                            setActual((a) => ({ ...a, [itemKey(l.item)]: e.target.value }))
                          }
                        />
                      </label>
                    );
                  })}
                {field('energy', 'Energia real em R$')}
                {field('labor', 'Trabalho real em R$')}
                {field('machine', 'Máquina/manutenção atribuída em R$')}
                {field('other', 'Outros custos de conversão em R$')}
                <p>
                  Informe zero explicitamente quando não houver custo. Não repita aqui os materiais
                  e insumos: o sistema usa o valor de saída do estoque.
                </p>
              </>
            )}
            {operation === 'reserve-order' &&
              select(
                'orderId',
                'Pedido/venda existente',
                [
                  ...list('orders'),
                  ...list('orderTargets').filter(
                    (t) =>
                      t.item &&
                      list('salesOrders').some(
                        (o) => o.id === t.salesOrderId && o.status === 'active',
                      ),
                  ),
                ].map((o) => ({
                  id: o.id,
                  label: `${o.salesOrderId ?? o.orderNumber ?? o.id} — ${o.description ?? o.productName ?? ''} (${o.quantity})`,
                })),
                (value) => {
                  set('orderId', value);
                  setExpectedVersion(
                    list('stockFulfillments').find((f) => f.orderId === value)?.version ?? 0,
                  );
                },
              )}
            {['ship', 'cancel'].includes(operation) &&
              select(
                'reservationId',
                'Reserva ativa',
                list('stockReservations')
                  .filter(
                    (r) => r.status === 'active' && (operation !== 'ship' || r.kind === 'order'),
                  )
                  .map((r) => ({
                    id: r.id,
                    label: `${r.kind === 'order' ? 'Pedido' : 'Produção'} — ${r.orderId ?? r.planId} — ${r.id}`,
                  })),
                (value) => {
                  set('reservationId', value);
                  setExpectedVersion(
                    list('stockReservations').find((r) => r.id === value)?.version ?? 0,
                  );
                },
              )}
            {operation === 'reverse' &&
              select(
                'eventId',
                'Compra ou ajuste recente',
                events
                  .filter((e) => ['purchase', 'adjust'].includes(e.type))
                  .map((e) => ({
                    id: e.id,
                    label: `${e.createdAt} — ${operations[e.type]} — ${e.id}`,
                  })),
                (value) => {
                  set('eventId', value);
                  const event = events.find((e) => e.id === value);
                  setExpectedVersion(event?.deltas[0]?.afterVersion ?? 0);
                },
              )}
            {field('reason', 'Motivo e conferência da operação')}
            <button type="submit" className="rounded bg-primary text-on-primary p-3">
              {busy ? 'Registrando...' : 'Confirmar operação'}
            </button>
          </fieldset>
        </form>
      )}
      <section>
        <h3 className="font-bold">Saldo único por item</h3>
        <p>
          Disponibilidade zerada:{' '}
          {balances.filter((b) => new D(b.quantity).minus(b.reserved).lte(0)).length} itens. Valor
          total: R$ {balances.reduce((v, b) => v.plus(b.value), new D(0)).toFixed(2)}.
        </p>
        <div className="overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                {[
                  'Item',
                  'Físico',
                  'Reservado',
                  'Disponível',
                  'Valor R$',
                  'Custo médio R$/unidade base',
                ].map((s) => (
                  <th className="p-2" key={s}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.id}>
                  <td className="p-2">{b.label}</td>
                  <td>{displayQuantity(b, b.quantity)}</td>
                  <td>{displayQuantity(b, b.reserved)}</td>
                  <td>{displayQuantity(b, new D(b.quantity).minus(b.reserved).toFixed())}</td>
                  <td>{b.value}</td>
                  <td>
                    {new D(b.quantity).isZero()
                      ? 'Sem saldo'
                      : `${new D(b.value).div(b.quantity).toFixed(12)} / ${b.unit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="font-bold">Execuções e perdas registradas</h3>
        {list('stockRuns').map((r) => (
          <p key={r.id}>
            {r.productId}/{r.variationId}: {r.goodUnits} boas, {r.rejectedUnits} rejeitadas;{' '}
            {r.durationSeconds} s; custo R$ {r.totalCost}; perda integral R$ {r.lossCost}. Execução:{' '}
            {r.id}
          </p>
        ))}
        <p>
          Horas após o corte:{' '}
          {list('stockPrinterUsage')
            .map((p) => `${p.id}: ${new D(p.seconds).div(3600).toFixed(4)} h`)
            .join('; ') || 'Nenhuma execução.'}
        </p>
      </section>
      <section>
        <h3 className="font-bold">100 movimentos mais recentes</h3>
        {events.map((e) => (
          <details key={e.id}>
            <summary>
              {e.createdAt} — {operations[e.type] ?? e.type} — {e.id}
            </summary>
            <p>{e.payload.reason}</p>
            {e.deltas.map((d: any) => (
              <p key={d.key}>
                {d.key}: físico {d.quantity}; reservado {d.reserved}; valor R$ {d.value} (deltas na
                unidade base).
              </p>
            ))}
          </details>
        ))}
      </section>
    </div>
  );
}
