import type { Express } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { BusinessError, validId } from './session';
import { CatalogError, id, integer, record, textValue } from '../shared/catalog/model';
import { D } from '../shared/pricing/engine';
import {
  add,
  cash,
  category,
  cents,
  day,
  financeReport,
  instant,
  localDay,
  month,
  netReceived,
  paymentStatus,
  validateAccount,
  zero,
  type DataSet,
} from '../shared/finance/model';
import { fingerprint } from './quote-cost';
import { reconcileInventory } from './inventory';

const normalizedSource = (value: unknown) =>
  textValue(value, 'Documento/referência única', 200)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ');
export async function financeData(
  db: Firestore,
  tx: Transaction,
  tenantId: string,
): Promise<DataSet> {
  const data: DataSet = {};
  for (const name of [
    'financeEvents',
    'financeAccounts',
    'financeReversals',
    'orderClosures',
    'payables',
    'salesOrders',
    'orderTargets',
    'stockShipments',
    'stockFulfillments',
    'stockPurchases',
    'stockReversals',
    'stockEvents',
    'stockPlans',
    'stockRuns',
    'printers',
    'stockPrinterUsage',
  ]) {
    const max = ['salesOrders', 'printers'].includes(name) ? 500 : 10000;
    const result = await tx.get(db.collection(`tenants/${tenantId}/${name}`).limit(max + 1));
    if (result.size > max)
      throw new BusinessError(
        422,
        `Conciliação excede ${max} registros em ${name}. Nenhuma amostra parcial será certificada.`,
      );
    data[name] = result.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
  data.snapshots = [];
  for (const o of data.salesOrders) {
    const s = await tx.get(
      db.doc(`tenants/${tenantId}/quotes/${o.quoteId}/versions/${o.quoteVersionId}`),
    );
    if (s.exists) data.snapshots.push(s.data());
  }
  return data;
}
export function registerFinanceRoutes(
  app: Express,
  db: Firestore | null,
  verify: (token: string) => Promise<DecodedIdToken>,
) {
  const route = (action: 'report' | 'commands') => async (req: any, res: any) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
    let identity: DecodedIdToken;
    try {
      identity = await verify(token);
    } catch {
      return res.status(401).json({ error: 'Sessão inválida.' });
    }
    try {
      const tenantId = req.params.tenantId;
      if (!validId(tenantId) || !validId(identity.uid))
        throw new BusinessError(400, 'Identidade inválida.');
      const body =
        action === 'commands'
          ? record(req.body, ['requestId', 'type', 'expectedVersion', 'payload'], 'Comando')
          : null;
      const requestId = body ? id(body.requestId) : '';
      const type = body ? textValue(body.type, 'Operação', 40) : 'report';
      const expected = body ? integer(body.expectedVersion, 'Versão esperada') : 0;
      const hash = body ? fingerprint([identity.uid, body]) : '';
      const result = await db.runTransaction(async (tx) => {
        const root = `tenants/${tenantId}`,
          ref = (p: string) => db.doc(`${root}/${p}`);
        const get = async (p: string) => (await tx.get(ref(p))).data();
        const tenant = (await tx.get(db.doc(root))).data(),
          profile = (await tx.get(db.doc(`users/${identity.uid}`))).data();
        const owner = tenant?.ownerUid === identity.uid;
        if (!tenant || tenant.status === 'inactive' || !(owner || profile?.tenantId === tenantId))
          throw new BusinessError(403, 'Empresa sem acesso.');
        if (action === 'report') {
          const report = financeReport(await financeData(db, tx, tenantId), month(req.query.month));
          const inventory = await reconcileInventory(db, tx, tenantId);
          return {
            ...report,
            inventory,
            consistent: report.consistent && inventory.consistent && inventory.issues.length === 0,
            generatedAt: new Date().toISOString(),
            legacyNotice:
              'Histórico anterior ao corte não foi migrado nem estimado como zero. Visão gerencial, sem reconciliação bancária ou DRE contábil.',
          };
        }
        if (!(owner || profile?.tenantRole === 'admin'))
          throw new BusinessError(
            403,
            'Operação financeira exige proprietário ou administrador da empresa.',
          );
        const previous = await get(`financeCommands/${requestId}`);
        if (previous) {
          if (previous.hash !== hash)
            throw new BusinessError(409, 'Chave já utilizada com outro conteúdo ou ator.');
          return previous.result;
        }
        if ((await get('inventoryControl/state'))?.phase !== 'active')
          throw new BusinessError(409, 'Ative o estoque E3 antes de operar o financeiro.');
        const now = new Date().toISOString(),
          p = body!.payload;
        const writes: (() => void)[] = [];
        const create = (path: string, value: any) => writes.push(() => tx.create(ref(path), value));
        const put = (path: string, value: any) => writes.push(() => tx.set(ref(path), value));
        const version = (v: any) => {
          if ((v?.version ?? 0) !== expected)
            throw new BusinessError(409, 'Registro mudou. Recarregue antes de confirmar.');
        };
        const source = async (namespace: string, raw: unknown) => {
          const value = normalizedSource(raw),
            key = fingerprint([namespace, value]);
          if (await get(`financeSources/${key}`))
            throw new BusinessError(409, 'Documento/referência já registrado.');
          create(`financeSources/${key}`, { value, requestId, createdAt: now });
          return textValue(raw, 'Documento/referência única', 200);
        };
        const output: any = { commandId: requestId, type, version: expected + 1 };
        if (['receive', 'refund', 'pay', 'reverse'].includes(type)) {
          const allowed =
            type === 'reverse'
              ? ['eventId', 'effectiveAt', 'reason']
              : type === 'pay'
                ? ['payableId', 'amountCents', 'effectiveAt', 'source', 'reason']
                : ['orderId', 'amountCents', 'feeCents', 'effectiveAt', 'source', 'reason'];
          record(p, allowed, 'Movimentação');
          const effectiveAt = instant(p.effectiveAt),
            reason = textValue(p.reason, 'Motivo/conferência', 500);
          let accountKind: 'order' | 'payable' = type === 'pay' ? 'payable' : 'order',
            accountId: string;
          let delta = zero(),
            document = '',
            reverses = '';
          if (type === 'reverse') {
            reverses = id(p.eventId);
            const original = await get(`financeEvents/${reverses}`);
            if (
              !original ||
              original.type === 'reverse' ||
              (await get(`financeReversals/${reverses}`))
            )
              throw new BusinessError(409, 'Evento ausente, já estornado ou estorno de estorno.');
            if (effectiveAt < original.effectiveAt)
              throw new CatalogError('Estorno não pode anteceder o evento original.');
            accountKind = original.accountKind;
            accountId = original.accountId;
            delta = Object.fromEntries(
              Object.entries(original.delta).map(([k, v]) => [k, -Number(v)]),
            ) as any;
            document = original.source;
            create(`financeReversals/${reverses}`, { eventId: requestId, createdAt: now });
          } else {
            accountId = id(type === 'pay' ? p.payableId : p.orderId);
            const value = cents(p.amountCents, 'Valor', true);
            const fee = type === 'pay' ? 0 : cents(p.feeCents, 'Taxa');
            if (fee > value)
              throw new CatalogError('Taxa/restituição de taxa não pode exceder o valor bruto.');
            delta =
              type === 'pay'
                ? { ...zero(), paidCents: value }
                : type === 'receive'
                  ? { ...zero(), receivedCents: value, feesCents: fee }
                  : { ...zero(), refundedCents: value, feesCents: -fee };
            document = await source('cash', p.source);
          }
          if (accountKind === 'order') {
            const order = await get(`salesOrders/${accountId}`),
              account = await get(`financeAccounts/${accountId}`);
            if (!order || order.status !== 'active')
              throw new BusinessError(409, 'Pedido não está ativo.');
            version(account);
            if (account?.status === 'closed')
              throw new BusinessError(
                409,
                'Reabra a conferência financeira antes de alterar lançamentos.',
              );
            if (effectiveAt < order.createdAt)
              throw new CatalogError('Recebimento/reembolso não pode anteceder o pedido canônico.');
            const totals = validateAccount(
              add((account as any) ?? zero(), delta),
              order.priceCents,
              'order',
            );
            put(`financeAccounts/${accountId}`, {
              ...account,
              ...totals,
              version: expected + 1,
              status: 'open',
              updatedAt: now,
            });
            put(`salesOrders/${accountId}`, {
              ...order,
              paymentStatus: paymentStatus(totals, order.priceCents),
            });
          } else {
            const payable = await get(`payables/${accountId}`);
            if (!payable || payable.status === 'cancelled')
              throw new BusinessError(409, 'Conta inexistente ou cancelada.');
            version(payable);
            const totals = validateAccount(
              add({ ...zero(), paidCents: payable.paidCents }, delta),
              payable.amountCents,
              'payable',
            );
            put(`payables/${accountId}`, {
              ...payable,
              paidCents: totals.paidCents,
              version: expected + 1,
            });
          }
          create(`financeEvents/${requestId}`, {
            type,
            accountKind,
            accountId,
            delta,
            cashCents: cash(delta),
            effectiveAt,
            effectiveDay: localDay(effectiveAt),
            source: document,
            reverses,
            reason,
            actorUid: identity.uid,
            recordedAt: now,
          });
          output.accountId = accountId;
        } else if (type === 'create-payable') {
          record(
            p,
            ['description', 'category', 'amountCents', 'dueDate', 'purchaseId', 'source', 'reason'],
            'Conta prevista',
          );
          if (expected !== 0) throw new CatalogError('Nova conta exige versão zero.');
          const amount = cents(p.amountCents, 'Valor da conta', true),
            purchaseId = p.purchaseId === '' ? '' : id(p.purchaseId);
          const c = category(p.category),
            document = await source('payable', p.source);
          if (purchaseId) {
            const purchase = await get(`stockPurchases/${purchaseId}`),
              link = await get(`financePurchaseLinks/${purchaseId}`);
            if (!purchase || (await get(`stockReversals/${purchase.commandId}`)))
              throw new CatalogError('Compra não encontrada ou estornada.');
            if (
              c !== 'material' ||
              new D(purchase.value).times(100).toDecimalPlaces(0).toNumber() !== amount
            )
              throw new CatalogError(
                'Conta da compra deve usar seu valor original arredondado em centavos e categoria material.',
              );
            if (link && (await get(`payables/${link.payableId}`))?.status !== 'cancelled')
              throw new BusinessError(409, 'Compra já possui conta vinculada.');
            put(`financePurchaseLinks/${purchaseId}`, { payableId: requestId });
          } else if (c === 'material')
            throw new CatalogError('Material exige vínculo ao evento de compra E3.');
          create(`payables/${requestId}`, {
            description: textValue(p.description, 'Descrição', 200),
            category: c,
            amountCents: amount,
            paidCents: 0,
            dueDate: day(p.dueDate),
            purchaseId,
            source: document,
            reason: textValue(p.reason, 'Motivo', 500),
            status: 'active',
            version: 1,
            createdAt: now,
            actorUid: identity.uid,
          });
          output.payableId = requestId;
        } else if (type === 'cancel-payable') {
          record(p, ['payableId', 'reason'], 'Cancelamento');
          const payableId = id(p.payableId),
            payable = await get(`payables/${payableId}`);
          if (!payable || payable.status !== 'active' || payable.paidCents !== 0)
            throw new BusinessError(409, 'Estorne os pagamentos antes de cancelar a conta.');
          version(payable);
          put(`payables/${payableId}`, {
            ...payable,
            status: 'cancelled',
            version: expected + 1,
            cancellationReason: textValue(p.reason, 'Motivo', 500),
            cancelledAt: now,
          });
        } else if (type === 'close-order' || type === 'reopen-order') {
          record(
            p,
            type === 'close-order'
              ? ['orderId', 'actualExtraCents', 'source', 'confirmed', 'reason']
              : ['orderId', 'reason'],
            'Conferência',
          );
          const orderId = id(p.orderId),
            order = await get(`salesOrders/${orderId}`),
            account = await get(`financeAccounts/${orderId}`);
          if (!order || order.status !== 'active')
            throw new BusinessError(409, 'Pedido não está ativo.');
          version(account);
          const reason = textValue(p.reason, 'Motivo da conferência', 500);
          if (type === 'reopen-order') {
            if (account?.status !== 'closed')
              throw new BusinessError(409, 'Pedido não está conferido.');
            put(`financeAccounts/${orderId}`, {
              ...account,
              status: 'open',
              version: expected + 1,
              reopenedAt: now,
            });
          } else {
            if (account?.status === 'closed' || p.confirmed !== true)
              throw new CatalogError(
                'Confirme todas as taxas e despesas finais, sem repetir custos já absorvidos no estoque.',
              );
            const report = financeReport(
              await financeData(db, tx, tenantId),
              localDay(now).slice(0, 7),
            );
            const selected = report.orders.find((o) => o.id === orderId);
            const inv = await reconcileInventory(db, tx, tenantId);
            if (
              !report.consistent ||
              !inv.consistent ||
              inv.issues.length ||
              !selected?.fullyShipped ||
              selected.receivableCents !== 0 ||
              selected.pendingProduction
            )
              throw new BusinessError(
                409,
                'Conferência exige estoque/financeiro conciliados, expedição completa e recebimento integral.',
              );
            const extra = cents(p.actualExtraCents, 'Despesa real adicional');
            const final = {
              ...(account ?? zero()),
              status: 'closed',
              version: expected + 1,
              closedAt: now,
              actualExtraCents: extra,
              expenseSource: textValue(
                p.source,
                'Origem das despesas finais e taxas conferidas',
                200,
              ),
              reason,
            };
            put(`financeAccounts/${orderId}`, final);
            create(`orderClosures/${requestId}`, {
              orderId,
              account: final,
              estimatedCost: selected.estimatedCost,
              shipmentCost: selected.shipmentCost,
              lossCost: selected.lossCost,
              actualCost: new D(selected.shipmentCost!)
                .plus(selected.lossCost)
                .plus(new D(extra).div(100))
                .toFixed(),
              priceCents: order.priceCents,
              actorUid: identity.uid,
              createdAt: now,
            });
          }
        } else throw new CatalogError('Operação financeira desconhecida.');
        create(`financeCommands/${requestId}`, {
          hash,
          result: output,
          createdAt: now,
          actorUid: identity.uid,
        });
        create(`financeActions/${requestId}`, {
          type,
          payload: p,
          createdAt: now,
          actorUid: identity.uid,
          result: output,
        });
        create(`auditLogs/finance-${requestId}`, {
          action: `finance.${type}`,
          actorUid: identity.uid,
          createdAt: now,
          result: output,
        });
        for (const write of writes) write();
        return output;
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof BusinessError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof CatalogError) return res.status(422).json({ error: error.message });
      console.error('Falha financeira:', error);
      return res
        .status(503)
        .json({ error: 'Não foi possível concluir. Repita com a mesma solicitação.' });
    }
  };
  app.get('/api/tenants/:tenantId/finance/report', route('report'));
  app.post('/api/tenants/:tenantId/finance/commands', route('commands'));
}
