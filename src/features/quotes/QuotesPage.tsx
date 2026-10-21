import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { catalogRequest } from '../catalog/client';
import { blankLine, blankQuote, type QuoteData } from '../../../shared/quotes/model';
import { D } from '../../../shared/pricing/engine';
import { itemKey } from '../../../shared/inventory/model';

const money = (v: string | number) =>
  new D(v).toNumber().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cents = (v: number) => money(new D(v).div(100).toFixed());
const labels: Record<string, string> = {
  draft: 'Rascunho',
  issued: 'Emitido',
  approved: 'Aprovado',
  declined: 'Recusado',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};
const cls = 'w-full rounded border border-outline-variant/40 bg-surface-container p-2';
const resources = [
  'quotes',
  'catalogItems',
  'salesOrders',
  'orderTargets',
  'stockBalances',
  'stockFulfillments',
  'stockPlans',
  'filaments',
  'supplies',
] as const;
const numeric = (s: string) => s.trim().replace(',', '.');
const stable = (v: any): string =>
  JSON.stringify(
    v && typeof v === 'object'
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(stable(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, JSON.parse(stable(v[k]))]),
          )
      : v,
  );

function Input({
  label,
  value,
  change,
  type = 'text',
}: {
  label: string;
  value: string | number;
  change(v: string): void;
  type?: string;
}) {
  return (
    <label className="block">
      {label}
      <input className={cls} type={type} value={value} onChange={(e) => change(e.target.value)} />
    </label>
  );
}
function ProductChoice({
  products,
  value,
  change,
}: {
  products: any[];
  value: any;
  change(v: { productId: string; variationId: string; recipeVersion: string }): void;
}) {
  const product = products.find((p) => p.id === value.productId);
  const choose = (p: any, variationId: string) =>
    change({
      productId: p?.id ?? '',
      variationId,
      recipeVersion: p?.recipeHeads?.[variationId] ?? '',
    });
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <label>
        Produto
        <select
          className={cls}
          value={value.productId}
          onChange={(e) => {
            const p = products.find((p) => p.id === e.target.value);
            choose(p, p?.variants?.find((v: any) => v.status === 'active')?.id ?? '');
          }}
        >
          <option value="">Selecione</option>
          {products
            .filter((p) => p.status === 'active' && p.kind === 'product')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Variação
        <select
          className={cls}
          value={value.variationId}
          onChange={(e) => choose(product, e.target.value)}
        >
          <option value="">Selecione</option>
          {product?.variants
            ?.filter((v: any) => v.status === 'active')
            .map((v: any) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
        </select>
      </label>
      <p>
        Ficha vinculada:{' '}
        {value.recipeVersion || 'Cadastre uma ficha no catálogo para esta variação.'}
      </p>
    </div>
  );
}

export function QuotePreview({ value }: { value: any }) {
  return (
    <section aria-label="Prévia do orçamento" className="space-y-3 rounded border p-4">
      <h3 className="font-bold">{value.data.customerName} — proposta</h3>
      <p>{value.data.description}</p>
      <table className="w-full text-left">
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantidade</th>
            <th>Preço unitário</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {value.data.lines.map((l: any, i: number) => {
            const a = value.allocations[i];
            return (
              <tr key={l.id}>
                <td>
                  {l.description}
                  {l.referenceUrl && (
                    <a
                      className="block underline"
                      target="_blank"
                      rel="noreferrer"
                      href={l.referenceUrl}
                    >
                      Referência visual
                    </a>
                  )}
                </td>
                <td>{l.quantity}</td>
                <td>
                  {a.quantity - a.unitsWithExtraCent} × {cents(a.unitFloorCents)}
                  {a.unitsWithExtraCent > 0 &&
                    ` + ${a.unitsWithExtraCent} × ${cents(a.unitFloorCents + 1)}`}
                </td>
                <td>{cents(a.totalCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        Antes do desconto: {cents(value.price.beforeDiscountCents)} · Desconto:{' '}
        {cents(value.price.discountCents)} · <strong>Total: {cents(value.price.priceCents)}</strong>
      </p>
      {value.expiresAt && (
        <p>
          Emitido em {new Date(value.issuedAt).toLocaleString('pt-BR')} · Validade:{' '}
          {new Date(value.expiresAt).toLocaleString('pt-BR')}
        </p>
      )}
      <details>
        <summary>Conferir custos e resultado estimado (uso interno)</summary>
        <p>
          Custo base: {money(value.cost)} · Taxas: {cents(value.price.feeCents)} · Lucro:{' '}
          {money(value.price.profit)} · Margem:{' '}
          {value.price.margin === null
            ? 'indefinida'
            : `${new D(value.price.margin).times(100).toFixed(2)}%`}
        </p>
        <p>
          Despesa do pedido: {money(value.data.orderExpense)} ({value.data.expenseSource}). Taxas:{' '}
          {value.data.fees.source}.
        </p>
        <p>
          Meta {value.data.target.type}: {value.data.target.value} ·{' '}
          {value.price.meetsTarget
            ? 'Meta atendida'
            : 'Atenção: preço final abaixo da meta informada'}
          .
        </p>
        {new D(value.price.profit).lt(0) && (
          <p role="alert">Preço abaixo do custo e das taxas: resultado estimado negativo.</p>
        )}
        {value.lines.map((l: any) => (
          <div className="my-3 border-t pt-2" key={l.id}>
            <strong>
              {value.data.lines.find((i: any) => i.id === l.id)?.description}: {money(l.cost)}
            </strong>
            {l.result ? (
              <>
                <p>
                  {l.runs} execução(ões), {l.result.producedUnits} unidades produzidas estimadas,{' '}
                  {l.result.excessUnits} excedentes. Base comercial:{' '}
                  {l.allocation === 'full-lot' ? 'lote inteiro' : 'unidades do pedido'}.
                </p>
                <p>
                  Lote: {money(l.result.productionCost)} · Parcela das unidades pedidas:{' '}
                  {money(l.result.allocatedProductionCost)} · Excedente:{' '}
                  {money(l.result.excessProductionCost)}.
                </p>
                <p>
                  Material:{' '}
                  {money(
                    l.result.runs
                      .reduce((s: any, r: any) => s.plus(r.parts.material), new D(0))
                      .toFixed(),
                  )}{' '}
                  · Energia:{' '}
                  {money(
                    l.result.runs
                      .reduce((s: any, r: any) => s.plus(r.parts.energy), new D(0))
                      .toFixed(),
                  )}{' '}
                  · Depreciação:{' '}
                  {money(
                    l.result.runs
                      .reduce((s: any, r: any) => s.plus(r.parts.depreciation), new D(0))
                      .toFixed(),
                  )}
                </p>
                <p>
                  Manutenção:{' '}
                  {money(
                    l.result.runs
                      .reduce((s: any, r: any) => s.plus(r.parts.maintenance), new D(0))
                      .toFixed(),
                  )}{' '}
                  · Rateio:{' '}
                  {money(
                    l.result.runs
                      .reduce((s: any, r: any) => s.plus(r.parts.overhead), new D(0))
                      .toFixed(),
                  )}{' '}
                  · Preparação:{' '}
                  {money(
                    l.result.runs
                      .reduce((s: any, r: any) => s.plus(r.parts.setup), new D(0))
                      .toFixed(),
                  )}
                </p>
                <p>
                  Acabamento: {money(l.result.finish)} · Insumos: {money(l.result.supplies)} ·
                  Componentes: {money(l.result.productionExtras)}. Tarifas:{' '}
                  {value.data.policy.source}.
                </p>
                {l.input.runs[0].materials.map((m: any) => (
                  <p key={m.materialId}>
                    {m.materialId}: {money(m.pricePerKg)}/kg — {m.source}
                  </p>
                ))}
                {l.input.supplies.map((s: any) => (
                  <p key={s.id}>
                    {s.id}: {money(s.unitCost)}/unidade — {s.source}
                  </p>
                ))}
                {l.components.map((c: any) => (
                  <p key={`${c.productId}/${c.variationId}`}>
                    Componente {c.calculation.productName}: {money(c.calculation.cost)} (ficha{' '}
                    {c.recipeVersion})
                  </p>
                ))}
              </>
            ) : (
              <p>
                Custo manual confirmado: {l.source}. Estimativa da peça avulsa; ficha de produção
                será vinculada antes do atendimento.
              </p>
            )}
          </div>
        ))}
      </details>
    </section>
  );
}

export function QuotesPage({ onInventory, onCatalog }: { onInventory(): void; onCatalog(): void }) {
  const { user, tenantId } = useAuth();
  return user && tenantId ? (
    <QuotesWorkspace
      key={tenantId}
      user={user}
      tenantId={tenantId}
      onInventory={onInventory}
      onCatalog={onCatalog}
    />
  ) : null;
}

export function QuotesWorkspace({
  user,
  tenantId,
  onInventory,
  onCatalog,
}: {
  user: any;
  tenantId: string;
  onInventory(): void;
  onCatalog(): void;
}) {
  const [data, setData] = useState<Record<string, any[]>>({}),
    [versions, setVersions] = useState<any[]>([]);
  const [quoteId, setQuoteId] = useState(''),
    [draft, setDraft] = useState<QuoteData>(blankQuote),
    [revision, setRevision] = useState(0);
  const [viewVersion, setViewVersion] = useState(''),
    [preview, setPreview] = useState<any>(null);
  const [reason, setReason] = useState(''),
    [expiry, setExpiry] = useState('');
  const [reportedBy, setReportedBy] = useState(''),
    [channel, setChannel] = useState(''),
    [evidence, setEvidence] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [limited, setLimited] = useState<string[]>([]);
  const [binding, setBinding] = useState({ productId: '', variationId: '', recipeVersion: '' });
  const pending = useRef<{ signature: string; id: string } | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const stops = resources.map((name) =>
      onSnapshot(
        query(collection(db, `tenants/${tenantId}/${name}`), limit(501)),
        (snap) => {
          setData((d) => ({
            ...d,
            [name]: snap.docs.slice(0, 500).map((v) => ({ ...v.data(), id: v.id })),
          }));
          setLimited((l) =>
            snap.size > 500 ? [...new Set([...l, name])] : l.filter((v) => v !== name),
          );
        },
        () => setError('Não foi possível carregar os dados. Confira seu acesso e recarregue.'),
      ),
    );
    return () => {
      mounted.current = false;
      stops.forEach((s) => s());
    };
  }, [tenantId]);
  useEffect(() => {
    setVersions([]);
    setViewVersion('');
    if (!quoteId) return;
    return onSnapshot(
      query(
        collection(db, `tenants/${tenantId}/quotes/${quoteId}/versions`),
        orderBy('issuedAt', 'desc'),
        limit(101),
      ),
      (snap) => {
        setVersions(snap.docs.slice(0, 100).map((v) => ({ ...v.data(), id: v.id })));
        if (snap.size > 100)
          setError(
            'Mostrando as 100 versões mais recentes. O histórico completo permanece preservado.',
          );
      },
      () => setError('Falha ao carregar versões.'),
    );
  }, [tenantId, quoteId]);
  const list = (name: string) => data[name] ?? [];
  const quote = list('quotes').find((q) => q.id === quoteId),
    order = list('salesOrders').find((o) => o.id === quoteId);
  const frozen = versions.find((v) => v.id === (viewVersion || quote?.currentVersion));
  const dirty = !quote || stable(quote.data) !== stable(draft);
  const editable = !quote || ['draft', 'issued', 'declined', 'expired'].includes(quote.status);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Falha ao concluir.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const send = async (type: string, payload: any, stockVersion?: number) => {
    const path =
      stockVersion === undefined
        ? `/api/tenants/${tenantId}/quotes/${quoteId}/commands`
        : `/api/tenants/${tenantId}/inventory/commands`;
    const body =
      stockVersion === undefined
        ? { type, expectedRevision: revision, payload }
        : { type, expectedVersion: stockVersion, payload };
    const signature = JSON.stringify([path, body]);
    if (pending.current?.signature !== signature)
      pending.current = { signature, id: crypto.randomUUID() };
    const result = await catalogRequest(user, path, { ...body, requestId: pending.current.id });
    if (mounted.current) {
      pending.current = null;
      if (result.revision) setRevision(result.revision);
      setNotice('Operação registrada.');
      setPreview(null);
    }
    return result;
  };
  const open = (q?: any) => {
    setQuoteId(q?.id ?? crypto.randomUUID());
    setDraft(q?.data ?? blankQuote());
    setRevision(q?.revision ?? 0);
    setPreview(null);
    setViewVersion('');
    setReason('');
    setError('');
    setNotice('');
    setReportedBy('');
    setChannel('');
    setEvidence('');
    setBinding({ productId: '', variationId: '', recipeVersion: '' });
  };
  const update = (patch: Partial<QuoteData>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setPreview(null);
  };
  const field = (key: keyof QuoteData, label: string) => (
    <Input label={label} value={String(draft[key])} change={(v) => update({ [key]: v })} />
  );
  const targets = list('orderTargets').filter((t) => t.salesOrderId === quoteId);
  const reserve = async (t: any) => {
    const f = list('stockFulfillments').find((f) => f.orderId === t.id);
    const b = list('stockBalances').find((b) => itemKey(b.item) === itemKey(t.item));
    const remaining = new D(t.quantity - (t.waivedQuantity ?? 0))
      .minus(f?.reserved ?? 0)
      .minus(f?.shipped ?? 0);
    const available = b ? new D(b.quantity).minus(b.reserved) : new D(0);
    const quantity = D.min(remaining, available);
    if (quantity.lte(0)) throw new Error('Sem produto disponível ou pedido já atendido.');
    await send(
      'reserve-order',
      { orderId: t.id, item: t.item, quantity: quantity.toFixed(), reason },
      f?.version ?? 0,
    );
  };
  const plan = async (t: any) => {
    const f = list('stockFulfillments').find((f) => f.orderId === t.id);
    const plans = list('stockPlans').filter((p) => p.orderId === t.id);
    const made = Math.max(0, plans.reduce((s, p) => s + p.goodUnits, 0) - Number(f?.returned ?? 0));
    const pending = plans.reduce(
      (s, p) => s + (p.status === 'active' ? p.remainingRuns * p.recipe.goodUnits : 0),
      0,
    );
    const missing = Math.max(
      0,
      t.quantity -
        (t.waivedQuantity ?? 0) -
        Math.max(Number(f?.reserved ?? 0) + Number(f?.shipped ?? 0), made) -
        pending,
    );
    if (!missing) throw new Error('Pedido já coberto por reservas ou produção vinculada.');
    const r = await getDoc(
      doc(db, `tenants/${tenantId}/catalogItems/${t.item.id}/recipes/${t.recipeVersion}`),
    );
    if (!r.exists()) throw new Error('Ficha não encontrada.');
    await send(
      'plan',
      {
        orderId: t.id,
        productId: t.item.id,
        variationId: t.item.variationId,
        recipeVersion: t.recipeVersion,
        runs: Math.ceil(missing / r.data().recipe.goodUnits),
        reprintOf: '',
        reason,
      },
      0,
    );
  };
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">Orçamentos e pedidos</h2>
      <p>
        Registre a solicitação, confira os custos e emita a proposta. O aceite é informado por um
        operador. Pagamentos, produção e expedição têm controles separados.
      </p>
      <div className="flex gap-4">
        <button onClick={onInventory}>Estoque e produção</button>
        <button onClick={onCatalog}>Produtos e fichas</button>
        <button disabled={busy} onClick={() => open()}>
          Novo orçamento
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {limited.length > 0 && (
        <p role="alert">
          Listas excedem 500 registros: {limited.join(', ')}. Requer consulta assistida para
          registros fora da lista. Planejamento rápido bloqueado.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {list('quotes').map((q) => (
          <button disabled={busy} className="rounded border p-2" key={q.id} onClick={() => open(q)}>
            {q.data.customerName} —{' '}
            {q.status === 'issued' && Date.parse(q.expiresAt) <= Date.now()
              ? 'Expirado'
              : labels[q.status]}{' '}
            — {q.id.slice(0, 8)}
          </button>
        ))}
      </div>
      {quoteId && (
        <fieldset disabled={busy} className="space-y-4">
          <legend>
            Orçamento {quoteId} · revisão {revision} · {labels[quote?.status ?? 'draft']}
          </legend>
          {quote && quote.revision !== revision && (
            <p role="alert">
              Este orçamento mudou em outra sessão. Reabra-o na lista para conferir a revisão atual.
            </p>
          )}
          {editable && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {field('customerName', 'Cliente')}
                {field('customerContact', 'Contato')}
                {field('description', 'Descrição da solicitação')}
                {field('sourceRequestId', 'Solicitação anterior (opcional)')}
                {field('replacesOrderId', 'Pedido cancelado que esta revisão substitui (opcional)')}
              </div>
              {draft.lines.map((l, index) => {
                const change = (patch: any) =>
                  update({
                    lines: draft.lines.map((v, i) => (i === index ? { ...v, ...patch } : v)),
                  });
                return (
                  <fieldset className="space-y-2 rounded border p-3" key={l.id}>
                    <legend>Item {index + 1}</legend>
                    <label>
                      Tipo
                      <select
                        className={cls}
                        value={l.kind}
                        onChange={(e) =>
                          change({
                            kind: e.target.value,
                            productId: '',
                            variationId: '',
                            recipeVersion: '',
                          })
                        }
                      >
                        <option value="custom">Peça avulsa</option>
                        <option value="catalog">Produto do catálogo</option>
                      </select>
                    </label>
                    {l.kind === 'catalog' && (
                      <ProductChoice products={list('catalogItems')} value={l} change={change} />
                    )}
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
                        label="Descrição do item"
                        value={l.description}
                        change={(v) => change({ description: v })}
                      />
                      <Input
                        label="Quantidade"
                        type="number"
                        value={l.quantity}
                        change={(v) => change({ quantity: Number(v) })}
                      />
                      <Input
                        label="Referência visual (HTTPS, opcional)"
                        value={l.referenceUrl}
                        change={(v) => change({ referenceUrl: v })}
                      />
                      {l.kind === 'custom' && (
                        <>
                          <Input
                            label="Custo unitário confirmado (R$)"
                            value={l.customUnitCost}
                            change={(v) => change({ customUnitCost: numeric(v) })}
                          />
                          <Input
                            label="Origem do custo avulso"
                            value={l.costSource}
                            change={(v) => change({ costSource: v })}
                          />
                        </>
                      )}
                    </div>
                    <button
                      disabled={draft.lines.length === 1}
                      onClick={() => update({ lines: draft.lines.filter((v) => v.id !== l.id) })}
                    >
                      Remover item
                    </button>
                  </fieldset>
                );
              })}
              <button
                disabled={draft.lines.length >= 20}
                onClick={() => update({ lines: [...draft.lines, blankLine(crypto.randomUUID())] })}
              >
                Adicionar item
              </button>
              {draft.lines.some((l) => l.kind === 'catalog') && (
                <details open>
                  <summary>Tarifas de produção e base do lote</summary>
                  <p>
                    Informe zero explicitamente quando não houver custo. A ficha fornece peso,
                    tempo, rendimento, insumos e componentes. A máquina fornece consumo e
                    depreciação.
                  </p>
                  <label>
                    Base comercial
                    <select
                      className={cls}
                      value={draft.policy.batchAllocation}
                      onChange={(e) =>
                        update({
                          policy: { ...draft.policy, batchAllocation: e.target.value as any },
                        })
                      }
                    >
                      <option value="full-lot">Cobrar custo do lote inteiro</option>
                      <option value="allocated">
                        Cobrar somente unidades do pedido; excedente fica na operação
                      </option>
                    </select>
                  </label>
                  <div className="grid gap-3 md:grid-cols-3">
                    {(
                      [
                        ['energyPricePerKwh', 'Energia (R$/kWh)'],
                        ['maintenancePerHour', 'Manutenção (R$/h)'],
                        ['overheadPerHour', 'Rateio operacional (R$/h)'],
                        ['laborPerHour', 'Preparação (R$/h)'],
                        ['finishLaborPerHour', 'Acabamento (R$/h)'],
                        ['source', 'Origem das tarifas'],
                      ] as const
                    ).map(([key, label]) => (
                      <Input
                        key={key}
                        label={label}
                        value={draft.policy[key]}
                        change={(v) =>
                          update({
                            policy: { ...draft.policy, [key]: key === 'source' ? v : numeric(v) },
                          })
                        }
                      />
                    ))}
                  </div>
                  <p>
                    Sem saldo com custo médio, cadastre abaixo uma tarifa de referência. O custo
                    médio disponível sempre tem prioridade.
                  </p>
                  {draft.fallbackRates.map((r, i) => (
                    <div className="grid gap-2 md:grid-cols-3" key={i}>
                      <label>
                        Material e unidade
                        <select
                          className={cls}
                          value={`${r.kind}/${r.id}`}
                          onChange={(e) => {
                            const [kind, id] = e.target.value.split('/');
                            update({
                              fallbackRates: draft.fallbackRates.map((v, j) =>
                                j === i ? { ...v, kind: kind as any, id } : v,
                              ),
                            });
                          }}
                        >
                          <option value={`${r.kind}/${r.id}`}>{r.id || 'Selecione'}</option>
                          {(['filament', 'supply'] as const).flatMap((kind) =>
                            list(kind === 'filament' ? 'filaments' : 'supplies').map((m) => (
                              <option key={`${kind}/${m.id}`} value={`${kind}/${m.id}`}>
                                {m.name ?? `${m.material} ${m.color}`} —{' '}
                                {kind === 'filament' ? 'R$/kg' : `R$/${m.unit}`}
                              </option>
                            )),
                          )}
                        </select>
                      </label>
                      <Input
                        label="Tarifa de referência"
                        value={r.rate}
                        change={(v) =>
                          update({
                            fallbackRates: draft.fallbackRates.map((x, j) =>
                              j === i ? { ...x, rate: numeric(v) } : x,
                            ),
                          })
                        }
                      />
                      <Input
                        label="Origem da tarifa"
                        value={r.source}
                        change={(v) =>
                          update({
                            fallbackRates: draft.fallbackRates.map((x, j) =>
                              j === i ? { ...x, source: v } : x,
                            ),
                          })
                        }
                      />
                      <button
                        onClick={() =>
                          update({ fallbackRates: draft.fallbackRates.filter((_, j) => i !== j) })
                        }
                      >
                        Remover tarifa
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      update({
                        fallbackRates: [
                          ...draft.fallbackRates,
                          { kind: 'filament', id: '', rate: '', source: '' },
                        ],
                      })
                    }
                  >
                    Adicionar tarifa sem saldo
                  </button>
                </details>
              )}
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  label="Despesas do pedido (R$)"
                  value={draft.orderExpense}
                  change={(v) => update({ orderExpense: numeric(v) })}
                />
                {field('expenseSource', 'Origem das despesas (ou declaração de zero)')}
                {(
                  [
                    ['rate', 'Taxa sobre venda (fração: 0,10 = 10%)'],
                    ['perOrder', 'Taxa fixa por pedido (R$)'],
                    ['perUnit', 'Taxa fixa por unidade (R$)'],
                    ['source', 'Origem das taxas (ou declaração de zero)'],
                  ] as const
                ).map(([key, label]) => (
                  <Input
                    key={key}
                    label={label}
                    value={draft.fees[key]}
                    change={(v) =>
                      update({ fees: { ...draft.fees, [key]: key === 'source' ? v : numeric(v) } })
                    }
                  />
                ))}
                <label>
                  Meta
                  <select
                    className={cls}
                    value={draft.target.type}
                    onChange={(e) =>
                      update({ target: { ...draft.target, type: e.target.value as any } })
                    }
                  >
                    <option value="margin">Margem (fração: 0,30 = 30%)</option>
                    <option value="markup">Markup (fator: 1,30 = custo + 30%)</option>
                    <option value="profit">Lucro total (R$)</option>
                    <option value="manual">Preço total manual (R$)</option>
                  </select>
                </label>
                <Input
                  label="Valor da meta"
                  value={draft.target.value}
                  change={(v) => update({ target: { ...draft.target, value: numeric(v) } })}
                />
                <Input
                  label="Desconto total (centavos)"
                  type="number"
                  value={draft.discountCents}
                  change={(v) => update({ discountCents: Number(v) })}
                />
              </div>
            </>
          )}
          <Input label="Motivo / registro da operação" value={reason} change={setReason} />
          {editable && (
            <div className="flex gap-4">
              <button
                onClick={() =>
                  run(async () => {
                    await send('save-draft', { data: draft, reason });
                  })
                }
              >
                Salvar rascunho / iniciar revisão
              </button>
              <button
                disabled={dirty || quote?.status !== 'draft'}
                onClick={() =>
                  run(async () => {
                    const p = await catalogRequest(
                      user,
                      `/api/tenants/${tenantId}/quotes/${quoteId}/preview`,
                      { expectedRevision: revision },
                    );
                    if (mounted.current) setPreview(p);
                  })
                }
              >
                Calcular prévia
              </button>
            </div>
          )}
          {preview && (
            <>
              <QuotePreview value={preview} />
              <Input
                label="Validade da proposta"
                type="datetime-local"
                value={expiry}
                change={setExpiry}
              />
              <button
                onClick={() =>
                  run(async () => {
                    await send('issue', {
                      expiresAt: new Date(expiry).toISOString(),
                      previewFingerprint: preview.fingerprint,
                    });
                  })
                }
              >
                Emitir versão conferida
              </button>
            </>
          )}
          {versions.length > 0 && (
            <label>
              Versões emitidas
              <select
                className={cls}
                value={viewVersion || quote?.currentVersion || ''}
                onChange={(e) => setViewVersion(e.target.value)}
              >
                <option value="">Selecione</option>
                {versions.map((v) => (
                  <option value={v.id} key={v.id}>
                    {new Date(v.issuedAt).toLocaleString('pt-BR')} —{' '}
                    {v.id === quote?.currentVersion ? 'vigente' : 'substituída'} — {v.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {frozen && <QuotePreview value={frozen} />}
          {quote?.status === 'issued' && (
            <section className="space-y-3 rounded border p-4">
              <h3>Aprovação informada pelo operador</h3>
              <p>
                Este registro documenta um aceite recebido externamente. Não é assinatura nem
                autenticação do cliente. A data será registrada pelo servidor.
              </p>
              <Input label="Quem informou o aceite" value={reportedBy} change={setReportedBy} />
              <Input label="Canal do aceite" value={channel} change={setChannel} />
              <Input
                label="Evidência / referência do aceite"
                value={evidence}
                change={setEvidence}
              />
              <button
                disabled={!!viewVersion && viewVersion !== quote.currentVersion}
                onClick={() =>
                  run(async () => {
                    await send('approve', {
                      versionId: quote.currentVersion,
                      reportedBy,
                      channel,
                      evidence,
                    });
                  })
                }
              >
                Registrar aprovação e criar pedido
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    await send('decline', { versionId: quote.currentVersion, reason });
                  })
                }
              >
                Registrar recusa
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    await send('expire', { versionId: quote.currentVersion, reason });
                  })
                }
              >
                Registrar expiração
              </button>
            </section>
          )}
          {quote && editable && (
            <button
              onClick={() =>
                run(async () => {
                  await send('cancel', { reason });
                })
              }
            >
              Cancelar orçamento
            </button>
          )}
          {order && (
            <section className="space-y-4 rounded border p-4">
              <h3>
                Pedido {order.id} — {order.status === 'active' ? 'ativo' : 'cancelado'}
              </h3>
              <p>
                Pagamento:{' '}
                {(
                  {
                    unrecorded: 'sem recebimento registrado',
                    partial: 'recebimento parcial',
                    paid: 'recebido integralmente',
                    refunded: 'reembolsado',
                  } as Record<string, string>
                )[order.paymentStatus] ?? order.paymentStatus}
                . Consulte os eventos em Financeiro e conciliação. Não há sinal obrigatório
                automático.
              </p>
              <p>
                Aceite informado por {order.approval.reportedBy}, via {order.approval.channel},
                registrado em {new Date(order.approval.recordedAt).toLocaleString('pt-BR')}.
                Evidência: {order.approval.evidence}
              </p>
              {targets.map((t) => {
                const f = list('stockFulfillments').find((f) => f.orderId === t.id);
                return (
                  <div key={t.id} className="rounded border p-3 space-y-2">
                    <strong>
                      {t.description} · {t.quantity} unidades
                    </strong>
                    <p>
                      Reservadas: {f?.reserved ?? 0} · Expedidas: {f?.shipped ?? 0} · Aguardando
                      alocação:{' '}
                      {new D(t.quantity - (t.waivedQuantity ?? 0))
                        .minus(f?.reserved ?? 0)
                        .minus(f?.shipped ?? 0)
                        .toFixed()}
                    </p>
                    {order.status === 'active' &&
                      (!t.item ? (
                        <>
                          <p>
                            Peça avulsa: crie uma ficha no catálogo e vincule-a explicitamente. O
                            preço aceito permanece preservado.
                          </p>
                          <ProductChoice
                            products={list('catalogItems')}
                            value={binding}
                            change={setBinding}
                          />
                          <button
                            onClick={() =>
                              run(async () => {
                                await send('bind-custom', { targetId: t.id, ...binding, reason });
                              })
                            }
                          >
                            Vincular ficha ao item
                          </button>
                        </>
                      ) : (
                        <>
                          <p>Ficha de produção: {t.recipeVersion}</p>
                          <button
                            disabled={limited.length > 0}
                            onClick={() => run(() => reserve(t))}
                          >
                            Reservar estoque disponível
                          </button>
                          <button disabled={limited.length > 0} onClick={() => run(() => plan(t))}>
                            Planejar fabricação da falta
                          </button>
                          <p>
                            Separe primeiro o estoque disponível. O planejamento reserva materiais;
                            conclua a execução e a expedição na tela de estoque e produção.
                          </p>
                        </>
                      ))}
                  </div>
                );
              })}
              {order.status === 'active' && (
                <>
                  <button
                    onClick={() =>
                      run(async () => {
                        await send('cancel-order', { reason });
                      })
                    }
                  >
                    Cancelar pedido após conferência
                  </button>
                  <p>
                    Libere reservas e planos sem execução antes de cancelar. Consumo ou expedição
                    impedem cancelamento simples. Para alterar termos aceitos, cancele o pedido
                    conferido e crie outro orçamento vinculado.
                  </p>
                </>
              )}
            </section>
          )}
        </fieldset>
      )}
    </div>
  );
}
