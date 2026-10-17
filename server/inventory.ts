import type { Express } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { BusinessError, validId } from './session';
import {
  CatalogError,
  record,
  id,
  integer,
  textValue,
  validateRecipe,
} from '../shared/catalog/model';
import { D } from '../shared/pricing/engine';
import {
  INVENTORY_VERSION,
  item,
  itemKey,
  amount,
  quantity,
  money,
  lines,
  receive,
  consume,
  reserve,
  release,
  requirements,
  conversion,
  reconcile,
  validateBalance,
  type Item,
  type Balance,
  type Line,
} from '../shared/inventory/model';

const canonical = (v: any): string =>
  JSON.stringify(
    v && typeof v === 'object'
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, JSON.parse(canonical(v[k]))]),
          )
      : v,
  );
const hash = (v: any) => createHash('sha256').update(canonical(v)).digest('hex');
const version = (doc: any, expected: number) => {
  if ((doc?.version ?? 0) !== expected)
    throw new BusinessError(409, 'Registro alterado. Recarregue antes de confirmar.');
};
const bounded = async (tx: Transaction, db: Firestore, path: string, max = 500) => {
  const result = await tx.get(db.collection(path).limit(max + 1));
  if (result.size > max)
    throw new BusinessError(
      422,
      `Conferência excede ${max} registros em ${path.split('/').at(-1)}. Requer revisão assistida; nenhum resultado parcial foi aprovado.`,
    );
  return result.docs.map((d) => ({ ...d.data(), id: d.id }) as any);
};

export async function requireLegacyInventory(db: Firestore, tx: Transaction, tenantId: string) {
  const state = await tx.get(db.doc(`tenants/${tenantId}/inventoryControl/state`));
  if (state.exists && state.data()?.phase !== 'legacy')
    throw new BusinessError(
      409,
      'Operação antiga bloqueada após o corte de estoque. Atualize a aplicação e use os novos comandos.',
    );
}

class Context {
  balances = new Map<string, { before: Balance | null; after: Balance }>();
  writes: Array<{ ref: DocumentReference; value: any; create: boolean }> = [];
  constructor(
    public db: Firestore,
    public tx: Transaction,
    public root: string,
  ) {}
  ref(path: string) {
    return this.db.doc(`${this.root}/${path}`);
  }
  async get(path: string) {
    return (await this.tx.get(this.ref(path))).data();
  }
  put(path: string, value: any, create = false) {
    this.writes.push({ ref: this.ref(path), value, create });
  }
  async describe(i: Item, active = false) {
    const source = await this.get(
      `${i.kind === 'filament' ? 'filaments' : i.kind === 'supply' ? 'supplies' : 'catalogItems'}/${i.id}`,
    );
    if (!source) throw new CatalogError('Item não existe nesta empresa.');
    if (i.kind === 'product') {
      const v = source.variants?.find((v: any) => v.id === i.variationId);
      if (
        source.kind !== 'product' ||
        !v ||
        (active && (source.status !== 'active' || v.status !== 'active'))
      )
        throw new CatalogError('Produto/variação não disponível.');
      return { label: `${source.name} / ${v.name}`, unit: 'un' };
    }
    return {
      label: String(source.name ?? `${source.material ?? ''} ${source.color ?? ''}`).trim() || i.id,
      unit: i.kind === 'filament' ? 'mg' : textValue(source.unit, 'Unidade do insumo', 20),
    };
  }
  async balance(i: Item, allowNew = false) {
    const key = itemKey(i),
      cached = this.balances.get(key);
    if (cached) return cached.after;
    const metadata = await this.describe(i);
    const doc = await this.get(`stockBalances/${key}`);
    if (doc && itemKey(doc.item) !== key) throw new CatalogError('Identidade do saldo divergente.');
    if (!doc && !allowNew) throw new CatalogError(`Abertura pendente: ${metadata.label}.`);
    if (doc && doc.unit !== metadata.unit)
      throw new CatalogError('Unidade do cadastro mudou; reconcilie antes de operar.');
    const before = doc ? validateBalance(doc as Balance) : null;
    const after: Balance = before
      ? { ...before, ...metadata }
      : { item: i, ...metadata, quantity: '0', reserved: '0', value: '0', version: 0 };
    this.balances.set(key, { before, after });
    return after;
  }
  set(b: Balance) {
    this.balances.get(itemKey(b.item))!.after = validateBalance(b);
  }
  async hold(ls: Line[]) {
    for (const l of ls) this.set(reserve(await this.balance(l.item), l.quantity));
  }
  async free(ls: Line[]) {
    for (const l of ls) this.set(release(await this.balance(l.item), l.quantity));
  }
  async debit(ls: Line[]) {
    let cost = new D(0);
    const costs: Array<{ item: Item; quantity: string; value: string }> = [];
    for (const l of ls) {
      const result = consume(await this.balance(l.item), l.quantity);
      this.set(result.balance);
      cost = cost.plus(result.cost);
      costs.push({ ...l, value: result.cost });
    }
    return { total: cost.toFixed(), lines: costs };
  }
  commit(requestId: string, type: string, actor: string, payload: any, result: any) {
    const now = new Date().toISOString();
    const deltas = [...this.balances.entries()].map(([key, { before, after }]) => ({
      key,
      item: after.item,
      quantity: new D(after.quantity).minus(before?.quantity ?? 0).toFixed(),
      reserved: new D(after.reserved).minus(before?.reserved ?? 0).toFixed(),
      value: new D(after.value).minus(before?.value ?? 0).toFixed(),
      beforeVersion: before?.version ?? 0,
      afterVersion: (before?.version ?? 0) + 1,
    }));
    if (deltas.length > 81)
      throw new CatalogError(
        'Operação física excede o limite de itens; não foi dividida em gravações parciais.',
      );
    for (const [key, { before, after }] of this.balances)
      this.tx.set(this.ref(`stockBalances/${key}`), {
        ...after,
        schemaVersion: INVENTORY_VERSION,
        version: (before?.version ?? 0) + 1,
        updatedAt: now,
      });
    for (const w of this.writes)
      if (w.create) this.tx.create(w.ref, w.value);
      else this.tx.set(w.ref, w.value);
    this.tx.create(this.ref(`stockEvents/${requestId}`), {
      schemaVersion: INVENTORY_VERSION,
      type,
      actorUid: actor,
      createdAt: now,
      payload,
      result,
      deltas,
    });
    this.tx.create(this.ref(`auditLogs/stock-${requestId}`), {
      action: `inventory.${type}`,
      actor,
      commandId: requestId,
      createdAt: now,
    });
  }
}

async function openingIssues(ctx: Context) {
  const [filaments, supplies, catalog, legacy, balances] = await Promise.all(
    ['filaments', 'supplies', 'catalogItems', 'products', 'stockBalances'].map((c) =>
      bounded(ctx.tx, ctx.db, `${ctx.root}/${c}`),
    ),
  );
  const required: Array<Item & { label: string }> = [];
  for (const f of filaments)
    required.push({
      kind: 'filament',
      id: f.id,
      variationId: '',
      label: `${f.material ?? ''} ${f.color ?? ''}`.trim() || f.id,
    });
  for (const s of supplies)
    required.push({ kind: 'supply', id: s.id, variationId: '', label: s.name ?? s.id });
  for (const p of catalog)
    if (p.kind === 'product')
      for (const v of p.variants)
        required.push({
          kind: 'product',
          id: p.id,
          variationId: v.id,
          label: `${p.name} / ${v.name}`,
        });
  const keys = new Set(balances.map((b) => b.id));
  const issues = legacy
    .filter((p) => !catalog.some((c) => c.id === p.id && c.legacySource?.productId === p.id))
    .map((p) => `Classificação legada pendente: ${p.name ?? p.id}.`);
  for (const i of required)
    if (!keys.has(itemKey(i))) issues.push(`Abertura pendente: ${i.label}.`);
  for (const b of balances) {
    if (!required.some((i) => itemKey(i) === b.id)) issues.push(`Saldo sem cadastro: ${b.id}.`);
    try {
      const metadata = await ctx.describe(b.item);
      validateBalance(b);
      if (metadata.unit !== b.unit || itemKey(b.item) !== b.id)
        throw new CatalogError('Unidade/identidade divergente.');
    } catch {
      issues.push(`Saldo/unidade inválido: ${b.id}.`);
    }
  }
  return { issues, required, balances };
}

async function checkLedger(ctx: Context, balances: any[]) {
  const [events, reservations, plans, fulfillments, shipments, runs, usage] = await Promise.all(
    [
      'stockEvents',
      'stockReservations',
      'stockPlans',
      'stockFulfillments',
      'stockShipments',
      'stockRuns',
      'stockPrinterUsage',
    ].map((c) => bounded(ctx.tx, ctx.db, `${ctx.root}/${c}`, 10000)),
  );
  const result = reconcile(
    Object.fromEntries(balances.map((b) => [b.id, b])),
    events,
    reservations,
  );
  for (const r of reservations.filter((r) => r.status === 'active')) {
    if (r.kind === 'production') {
      const plan = plans.find((p) => p.id === r.planId);
      if (
        !plan ||
        plan.status !== 'active' ||
        canonical(requirements(plan.recipe, plan.remainingRuns)) !== canonical(r.lines)
      )
        result.discrepancies.push(`${r.id}: reserva sem plano ativo correspondente.`);
    } else if (
      r.kind !== 'order' ||
      !fulfillments.some(
        (f) =>
          f.orderId === r.orderId &&
          r.lines.length === 1 &&
          itemKey(f.item) === itemKey(r.lines[0].item),
      )
    )
      result.discrepancies.push(`${r.id}: reserva sem atendimento correspondente.`);
  }
  for (const p of plans.filter((p) => p.status === 'active'))
    if (!reservations.some((r) => r.planId === p.id && r.status === 'active'))
      result.discrepancies.push(`${p.id}: plano sem reserva ativa.`);
  for (const f of fulfillments) {
    const held = reservations
      .filter((r) => r.kind === 'order' && r.orderId === f.orderId && r.status === 'active')
      .reduce((q, r) => q.plus(r.lines[0].quantity), new D(0));
    const sent = shipments
      .filter((s) => s.orderId === f.orderId)
      .reduce((q, s) => q.plus(s.quantity), new D(0));
    if (
      !held.eq(f.reserved) ||
      !sent.eq(f.shipped) ||
      held.plus(sent).gt(f.target) ||
      !(await ctx.get(`orders/${f.orderId}`))
    )
      result.discrepancies.push(
        `${f.orderId}: atendimento diverge das reservas/expedições ou perdeu o pedido.`,
      );
  }
  const printerIds = new Set([
    ...usage.map((u) => u.id),
    ...runs.filter((r) => r.printerId).map((r) => r.printerId),
  ]);
  for (const printerId of printerIds) {
    const seconds = runs
      .filter((r) => r.printerId === printerId)
      .reduce((n, r) => n + r.durationSeconds, 0);
    if (usage.find((u) => u.id === printerId)?.seconds !== seconds)
      result.discrepancies.push(`${printerId}: horas divergem das execuções.`);
  }
  result.consistent = result.discrepancies.length === 0;
  return result;
}

export function registerInventoryRoutes(
  app: Express,
  db: Firestore | null,
  verify: (token: string) => Promise<DecodedIdToken>,
) {
  async function authorize(tx: Transaction, tenantId: string, uid: string) {
    const tenant = await tx.get(db!.doc(`tenants/${tenantId}`)),
      profile = await tx.get(db!.doc(`users/${uid}`));
    const owner = tenant.data()?.ownerUid === uid && tenantId === uid;
    if (
      !tenant.exists ||
      tenant.data()?.status === 'inactive' ||
      (!owner && profile.data()?.tenantId !== tenantId)
    )
      throw new BusinessError(403, 'Empresa sem acesso.');
    return owner;
  }
  const handler = (run: (req: any, uid: string) => Promise<any>) => async (req: any, res: any) => {
    if (!db) return res.status(503).json({ error: 'Banco indisponível.' });
    let identity: DecodedIdToken;
    try {
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) throw new Error();
      identity = await verify(token);
    } catch {
      return res.status(401).json({ error: 'Sessão inválida.' });
    }
    try {
      if (!validId(identity.uid) || !validId(req.params.tenantId))
        throw new BusinessError(400, 'Identidade inválida.');
      return res.json(await run(req, identity.uid));
    } catch (e) {
      if (e instanceof BusinessError) return res.status(e.status).json({ error: e.message });
      if (e instanceof CatalogError) return res.status(422).json({ error: e.message });
      console.error('Falha no estoque:', e);
      return res.status(503).json({ error: 'Operação não concluída. Repita com a mesma chave.' });
    }
  };
  app.get(
    '/api/tenants/:tenantId/inventory/reconcile',
    handler(async (req, uid) =>
      db!.runTransaction(async (tx) => {
        await authorize(tx, req.params.tenantId, uid);
        const ctx = new Context(db!, tx, `tenants/${req.params.tenantId}`);
        const opening = await openingIssues(ctx);
        const result = await checkLedger(ctx, opening.balances);
        return {
          ...opening,
          ...result,
          control: (await ctx.get('inventoryControl/state')) ?? { phase: 'legacy', version: 0 },
        };
      }),
    ),
  );
  app.post(
    '/api/tenants/:tenantId/inventory/commands',
    handler(async (req, uid) => {
      const body = record(req.body, ['requestId', 'type', 'expectedVersion', 'payload'], 'Comando');
      const requestId = id(body.requestId),
        expected = integer(body.expectedVersion, 'Versão esperada'),
        type = textValue(body.type, 'Operação', 40);
      if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload))
        throw new CatalogError('Dados da operação obrigatórios.');
      const fingerprint = hash({ ...body, actorUid: uid });
      return db!.runTransaction(async (tx) => {
        const owner = await authorize(tx, req.params.tenantId, uid);
        const ctx = new Context(db!, tx, `tenants/${req.params.tenantId}`);
        const previous = await ctx.get(`inventoryCommands/${requestId}`);
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new BusinessError(409, 'Chave já utilizada com outro comando.');
          return { ...previous.result, repeated: true };
        }
        const state = (await ctx.get('inventoryControl/state')) ?? { phase: 'legacy', version: 0 };
        const restricted = ['freeze', 'activate', 'open', 'adjust', 'reverse', 'create-material'];
        if (restricted.includes(type) && !owner)
          throw new BusinessError(403, 'Operação exige o responsável pela empresa.');
        if (
          !['freeze', 'activate', 'open', 'create-material'].includes(type) &&
          state.phase !== 'active' &&
          !(type === 'adjust' && state.phase === 'frozen')
        )
          throw new BusinessError(409, 'Estoque novo ainda não está ativo.');
        const now = new Date().toISOString();
        let result: any = { commandId: requestId, type };
        if (type === 'freeze') {
          const inProgress = await Promise.all(
            ['productionOrders', 'customRequests'].map((c) => bounded(tx, db!, `${ctx.root}/${c}`)),
          );
          if (inProgress.flat().some((d) => d.status === 'produzindo'))
            throw new BusinessError(
              409,
              'Conclua ou reconcilie as execuções legadas em andamento antes do corte.',
            );
          const p = record(body.payload, ['reason', 'backupReference'], 'Congelamento');
          version(state, expected);
          if (state.phase !== 'legacy') throw new BusinessError(409, 'Empresa já iniciou o corte.');
          ctx.put('inventoryControl/state', {
            phase: 'frozen',
            version: expected + 1,
            reason: textValue(p.reason, 'Motivo', 500),
            backupReference: textValue(p.backupReference, 'Referência do backup conferido', 500),
            actorUid: uid,
            frozenAt: now,
          });
        } else if (type === 'activate') {
          const p = record(body.payload, ['reason', 'confirmed'], 'Ativação');
          version(state, expected);
          if (state.phase !== 'frozen' || p.confirmed !== true)
            throw new CatalogError('Congele e confira a abertura antes de ativar.');
          const opening = await openingIssues(ctx);
          const check = await checkLedger(ctx, opening.balances);
          if (opening.issues.length || !check.consistent)
            throw new CatalogError([...opening.issues, ...check.discrepancies].join(' '));
          ctx.put('inventoryControl/state', {
            ...state,
            phase: 'active',
            version: expected + 1,
            activatedAt: now,
            activationReason: textValue(p.reason, 'Conferência da abertura', 500),
            actorUid: uid,
          });
        } else if (type === 'create-material') {
          const p = record(body.payload, ['kind', 'id', 'name', 'unit'], 'Material');
          if (state.phase === 'legacy')
            throw new CatalogError('Prepare o corte antes do novo cadastro.');
          if (!['filament', 'supply'].includes(p.kind))
            throw new CatalogError('Tipo de material inválido.');
          const i = item({ kind: p.kind, id: p.id, variationId: '' }),
            name = textValue(p.name, 'Nome'),
            unit = p.kind === 'filament' ? 'mg' : textValue(p.unit, 'Unidade', 20);
          if (p.kind === 'filament' && p.unit !== 'mg')
            throw new CatalogError('Filamentos usam mg.');
          const path = `${p.kind === 'filament' ? 'filaments' : 'supplies'}/${i.id}`;
          if (await ctx.get(`stockBalances/${itemKey(i)}`))
            throw new BusinessError(409, 'Saldo existente exige reconciliação do cadastro.');
          version(await ctx.get(path), expected);
          if (await ctx.get(path)) throw new BusinessError(409, 'Material já existe.');
          ctx.put(
            path,
            p.kind === 'filament'
              ? {
                  material: name,
                  color: '',
                  stockKg: 0,
                  initialStockKg: 0,
                  pricePerKg: 0,
                  createdAt: now,
                }
              : { name, unit, quantity: 0, costPerUnit: 0, createdAt: now },
            true,
          );
          // A new material has explicit zero opening; no historical balance is inferred.
          ctx.balances.set(itemKey(i), {
            before: null,
            after: {
              item: i,
              label: name,
              unit,
              quantity: '0',
              reserved: '0',
              value: '0',
              version: 0,
            },
          });
        } else if (type === 'open' || type === 'adjust' || type === 'purchase') {
          const p = record(
            body.payload,
            ['item', 'quantity', 'value', 'reason', 'source'],
            'Movimento',
          );
          const i = item(p.item),
            q = quantity(p.quantity, i, type === 'purchase'),
            value = money(p.value);
          textValue(p.reason, 'Motivo', 500);
          const source = textValue(p.source, 'Documento/origem', 500);
          if (type === 'open' && state.phase === 'legacy')
            throw new CatalogError('Congele o legado antes da abertura.');
          if (type === 'purchase' && i.kind === 'product')
            throw new CatalogError('Produto acabado entra por produção ou contagem conferida.');
          const b = await ctx.balance(i, type === 'open');
          version(b, expected);
          if (type === 'open' && b.version !== 0)
            throw new BusinessError(409, 'Abertura já registrada.');
          if (type === 'purchase') {
            const key = hash(source);
            if (await ctx.get(`stockPurchases/${key}`))
              throw new BusinessError(
                409,
                'Documento de compra já recebido. Use uma identificação única por linha/documento.',
              );
            ctx.put(
              `stockPurchases/${key}`,
              {
                source,
                commandId: requestId,
                item: i,
                quantity: q,
                value,
                actorUid: uid,
                receivedAt: now,
              },
              true,
            );
            ctx.set(receive(b, q, value));
          } else ctx.set(validateBalance({ ...b, quantity: q, value }));
        } else if (type === 'plan') {
          const p = record(
            body.payload,
            ['productId', 'variationId', 'recipeVersion', 'runs', 'reason', 'reprintOf'],
            'Plano',
          );
          if (expected !== 0) throw new BusinessError(409, 'Novo plano exige versão zero.');
          const productId = id(p.productId),
            variationId = id(p.variationId),
            recipeVersion = id(p.recipeVersion),
            runs = integer(p.runs, 'Execuções', 1);
          if (runs > 1000) throw new CatalogError('Plano excede 1000 execuções.');
          await ctx.describe({ kind: 'product', id: productId, variationId }, true);
          const snapshot = await ctx.get(`catalogItems/${productId}/recipes/${recipeVersion}`);
          if (!snapshot || snapshot.variationId !== variationId)
            throw new CatalogError('Versão de receita não encontrada.');
          const recipe = validateRecipe(snapshot.recipe),
            needed = requirements(recipe, runs);
          for (const c of recipe.components) {
            await ctx.describe(
              { kind: 'product', id: c.productId, variationId: c.variationId },
              true,
            );
            const componentVersion = await ctx.get(
              `catalogItems/${c.productId}/recipes/${c.recipeVersion}`,
            );
            if (
              !componentVersion ||
              componentVersion.variationId !== c.variationId ||
              componentVersion.recipe?.kind !== 'print'
            )
              throw new CatalogError('Versão do componente não encontrada ou incompatível.');
          }
          if (recipe.kind === 'print') {
            const printer = await ctx.get(`printers/${recipe.printerId}`);
            if (!printer || ['inativa', 'manutenção'].includes(printer.status))
              throw new CatalogError('Impressora indisponível.');
          }
          if (p.reprintOf !== '') {
            const previousRun = await ctx.get(`stockRuns/${id(p.reprintOf)}`);
            if (
              !previousRun ||
              previousRun.productId !== productId ||
              previousRun.variationId !== variationId
            )
              throw new CatalogError(
                'Reimpressão exige execução anterior do mesmo produto/variação.',
              );
          }
          for (const s of recipe.supplies)
            if (
              (await ctx.describe({ kind: 'supply', id: s.supplyId, variationId: '' })).unit !==
              s.unit
            )
              throw new CatalogError('Unidade da ficha diverge do insumo.');
          await ctx.balance({ kind: 'product', id: productId, variationId });
          await ctx.hold(needed);
          const plan = {
            id: requestId,
            productId,
            variationId,
            recipeVersion,
            recipe,
            runs,
            remainingRuns: runs,
            goodUnits: 0,
            rejectedUnits: 0,
            status: 'active',
            version: 1,
            reprintOf: p.reprintOf,
            reason: textValue(p.reason, 'Motivo do plano', 500),
            createdAt: now,
            actorUid: uid,
          };
          ctx.put(`stockPlans/${requestId}`, plan, true);
          ctx.put(
            `stockReservations/${requestId}`,
            { kind: 'production', planId: requestId, status: 'active', lines: needed, version: 1 },
            true,
          );
          result.planId = requestId;
        } else if (type === 'complete') {
          const p = record(
            body.payload,
            [
              'planId',
              'runs',
              'goodUnits',
              'rejectedUnits',
              'durationSeconds',
              'actual',
              'conversion',
              'reason',
            ],
            'Execução',
          );
          const planId = id(p.planId),
            plan = await ctx.get(`stockPlans/${planId}`),
            reservation = await ctx.get(`stockReservations/${planId}`);
          if (!plan || plan.status !== 'active' || reservation?.status !== 'active')
            throw new BusinessError(409, 'Plano sem reserva ativa.');
          if (
            canonical(reservation.lines) !==
            canonical(requirements(plan.recipe, plan.remainingRuns))
          )
            throw new BusinessError(409, 'Reserva diverge do plano; reconcilie antes de concluir.');
          version(plan, expected);
          const runs = integer(p.runs, 'Execuções concluídas', 1),
            good = integer(p.goodUnits, 'Unidades boas'),
            rejected = integer(p.rejectedUnits, 'Unidades rejeitadas'),
            seconds = integer(p.durationSeconds, 'Duração');
          if (runs > plan.remainingRuns || good + rejected !== plan.recipe.goodUnits * runs)
            throw new CatalogError(
              'Unidades boas + rejeitadas devem fechar o rendimento das execuções informadas.',
            );
          const actual = lines(p.actual, false),
            expectedLines = requirements(plan.recipe, runs);
          if (
            actual.length !== expectedLines.length ||
            expectedLines.some((e) => !actual.some((a) => itemKey(a.item) === itemKey(e.item)))
          )
            throw new CatalogError(
              'Informe o consumo real de todos os itens da ficha, inclusive zero.',
            );
          // Assemblies consume exact recipe components for every attempted unit, including rejects.
          if (
            plan.recipe.kind === 'assembly' &&
            expectedLines.some(
              (e) =>
                e.item.kind === 'product' &&
                !new D(actual.find((a) => itemKey(a.item) === itemKey(e.item))!.quantity).eq(
                  e.quantity,
                ),
            )
          )
            throw new CatalogError(
              'Montagem exige a quantidade exata de componentes por unidade tentada.',
            );
          if (plan.recipe.kind === 'print' && seconds === 0)
            throw new CatalogError('Informe o tempo real da impressão.');
          if (
            plan.recipe.kind === 'print' &&
            good > 0 &&
            actual
              .filter((l) => l.item.kind === 'filament')
              .every((l) => new D(l.quantity).isZero())
          )
            throw new CatalogError('Saída impressa exige consumo real de material.');
          await ctx.free(expectedLines);
          const consumed = await ctx.debit(actual),
            extra = conversion(p.conversion),
            total = new D(consumed.total).plus(extra.total).toFixed();
          const output: Item = {
            kind: 'product',
            id: plan.productId,
            variationId: plan.variationId,
          };
          if (good) ctx.set(receive(await ctx.balance(output), String(good), total));
          const remaining = plan.remainingRuns - runs;
          ctx.put(`stockPlans/${planId}`, {
            ...plan,
            remainingRuns: remaining,
            goodUnits: plan.goodUnits + good,
            rejectedUnits: plan.rejectedUnits + rejected,
            status: remaining ? 'active' : 'completed',
            version: plan.version + 1,
          });
          ctx.put(`stockReservations/${planId}`, {
            ...reservation,
            status: remaining ? 'active' : 'consumed',
            lines: remaining ? requirements(plan.recipe, remaining) : [],
            version: reservation.version + 1,
          });
          if (plan.recipe.kind === 'print') {
            const printer = await ctx.get(`printers/${plan.recipe.printerId}`);
            if (!printer) throw new CatalogError('Impressora da execução não encontrada.');
            const usage = await ctx.get(`stockPrinterUsage/${plan.recipe.printerId}`);
            ctx.put(`stockPrinterUsage/${plan.recipe.printerId}`, {
              seconds: integer((usage?.seconds ?? 0) + seconds, 'Uso acumulado'),
              version: (usage?.version ?? 0) + 1,
            });
          }
          ctx.put(
            `stockRuns/${requestId}`,
            {
              planId,
              productId: plan.productId,
              variationId: plan.variationId,
              recipeVersion: plan.recipeVersion,
              runs,
              goodUnits: good,
              rejectedUnits: rejected,
              durationSeconds: seconds,
              printerId: plan.recipe.printerId,
              consumption: consumed,
              conversion: extra,
              totalCost: total,
              lossCost: good ? '0' : total,
              unitCost: good ? new D(total).div(good).toFixed() : null,
              costKind: 'inventory-plus-confirmed-conversion',
              reason: textValue(p.reason, 'Registro da execução', 500),
              createdAt: now,
              actorUid: uid,
            },
            true,
          );
          result.runId = requestId;
          result.totalCost = total;
        } else if (type === 'reserve-order') {
          const p = record(
            body.payload,
            ['orderId', 'item', 'quantity', 'reason'],
            'Reserva de pedido',
          );
          const orderId = id(p.orderId),
            i = item(p.item),
            q = quantity(p.quantity, i, true);
          if (i.kind !== 'product') throw new CatalogError('Pedido reserva produto acabado.');
          await ctx.describe(i, true);
          const order = await ctx.get(`orders/${orderId}`);
          if (!order) throw new CatalogError('Pedido/venda de origem não encontrado.');
          const target = integer(order.quantity, 'Quantidade do pedido', 1),
            fulfillment = await ctx.get(`stockFulfillments/${orderId}`);
          version(fulfillment, expected);
          if (fulfillment && itemKey(fulfillment.item) !== itemKey(i))
            throw new CatalogError('Produto do atendimento é imutável.');
          const f = fulfillment ?? {
            orderId,
            item: i,
            target,
            reserved: '0',
            shipped: '0',
            version: 0,
          };
          if (new D(f.reserved).plus(f.shipped).plus(q).gt(f.target))
            throw new CatalogError('Reserva excede a quantidade restante do pedido.');
          await ctx.hold([{ item: i, quantity: q }]);
          ctx.put(`stockFulfillments/${orderId}`, {
            ...f,
            reserved: new D(f.reserved).plus(q).toFixed(),
            version: f.version + 1,
          });
          ctx.put(
            `stockReservations/${requestId}`,
            {
              kind: 'order',
              orderId,
              status: 'active',
              lines: [{ item: i, quantity: q }],
              version: 1,
              reason: textValue(p.reason, 'Conferência do vínculo ao pedido', 500),
            },
            true,
          );
          result.reservationId = requestId;
        } else if (type === 'ship' || type === 'cancel') {
          const p = record(
            body.payload,
            type === 'ship' ? ['reservationId', 'quantity', 'reason'] : ['reservationId', 'reason'],
            'Reserva',
          );
          const reservationId = id(p.reservationId),
            r = await ctx.get(`stockReservations/${reservationId}`);
          if (!r || r.status !== 'active') throw new BusinessError(409, 'Reserva não está ativa.');
          version(r, expected);
          textValue(p.reason, 'Motivo', 500);
          if (type === 'ship') {
            if (r.kind !== 'order') throw new CatalogError('Expedição exige reserva de pedido.');
            const l = r.lines[0],
              q = quantity(p.quantity, l.item, true);
            if (new D(q).gt(l.quantity)) throw new CatalogError('Expedição excede a reserva.');
            await ctx.free([{ item: l.item, quantity: q }]);
            const cost = await ctx.debit([{ item: l.item, quantity: q }]);
            const remaining = new D(l.quantity).minus(q).toFixed(),
              f = await ctx.get(`stockFulfillments/${r.orderId}`);
            if (!f) throw new CatalogError('Atendimento não encontrado.');
            ctx.put(`stockFulfillments/${r.orderId}`, {
              ...f,
              reserved: new D(f.reserved).minus(q).toFixed(),
              shipped: new D(f.shipped).plus(q).toFixed(),
              version: f.version + 1,
            });
            ctx.put(`stockReservations/${reservationId}`, {
              ...r,
              status: remaining === '0' ? 'consumed' : 'active',
              lines: remaining === '0' ? [] : [{ item: l.item, quantity: remaining }],
              version: r.version + 1,
            });
            ctx.put(
              `stockShipments/${requestId}`,
              {
                orderId: r.orderId,
                reservationId,
                item: l.item,
                quantity: q,
                cost: cost.total,
                createdAt: now,
                actorUid: uid,
                reason: p.reason,
              },
              true,
            );
            result.cost = cost.total;
          } else {
            await ctx.free(r.lines);
            ctx.put(`stockReservations/${reservationId}`, {
              ...r,
              status: 'cancelled',
              lines: [],
              version: r.version + 1,
            });
            if (r.kind === 'production') {
              const plan = await ctx.get(`stockPlans/${r.planId}`);
              ctx.put(`stockPlans/${r.planId}`, {
                ...plan,
                status: 'cancelled',
                version: plan!.version + 1,
              });
            } else {
              const f = await ctx.get(`stockFulfillments/${r.orderId}`);
              if (!f) throw new CatalogError('Atendimento não encontrado.');
              ctx.put(`stockFulfillments/${r.orderId}`, {
                ...f,
                reserved: new D(f.reserved).minus(r.lines[0].quantity).toFixed(),
                version: f.version + 1,
              });
            }
          }
        } else if (type === 'reverse') {
          const p = record(body.payload, ['eventId', 'reason', 'physicalConfirmed'], 'Estorno');
          const eventId = id(p.eventId),
            e = await ctx.get(`stockEvents/${eventId}`);
          if (!e || !['purchase', 'adjust'].includes(e.type) || p.physicalConfirmed !== true)
            throw new CatalogError(
              'Estorno automático admite apenas compra/ajuste conferido, sem operações posteriores. Para fatos físicos, registre contagem compensatória com referência.',
            );
          if (await ctx.get(`stockReversals/${eventId}`))
            throw new BusinessError(409, 'Movimento já estornado.');
          textValue(p.reason, 'Motivo do estorno', 500);
          for (const d of e.deltas) {
            const b = await ctx.balance(d.item);
            version(b, expected);
            if (b.version !== d.afterVersion || b.reserved !== '0')
              throw new BusinessError(
                409,
                'Movimento possui dependências; registre ajuste físico conferido.',
              );
            ctx.set(
              validateBalance({
                ...b,
                quantity: new D(b.quantity).minus(d.quantity).toFixed(),
                value: new D(b.value).minus(d.value).toFixed(),
              }),
            );
          }
          ctx.put(
            `stockReversals/${eventId}`,
            { commandId: requestId, createdAt: now, actorUid: uid },
            true,
          );
        } else throw new CatalogError('Operação não reconhecida.');
        ctx.commit(requestId, type, uid, body.payload, result);
        tx.create(ctx.ref(`inventoryCommands/${requestId}`), {
          fingerprint,
          result,
          actorUid: uid,
          createdAt: now,
        });
        return { ...result, repeated: false };
      });
    }),
  );
}
