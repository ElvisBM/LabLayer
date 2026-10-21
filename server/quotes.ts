import { requireAssets } from './assets';
import type { Express } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { BusinessError, validId } from './session';
import { CatalogError, id, integer, record, textValue } from '../shared/catalog/model';
import { PricingError } from '../shared/pricing/engine';
import { validateQuote } from '../shared/quotes/model';
import { netReceived, instant } from '../shared/finance/model';
import { catalogRecipe, fingerprint, quoteCost } from './quote-cost';

export const targetId = (quoteId: string, lineId: string) =>
  `q-${fingerprint([quoteId, lineId]).slice(0, 48)}`;

export function registerQuoteRoutes(
  app: Express,
  db: Firestore | null,
  verify: (token: string) => Promise<DecodedIdToken>,
) {
  app.post('/api/tenants/:tenantId/quotes/:quoteId/:action', async (req, res) => {
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
      const { tenantId, quoteId, action } = req.params;
      if (!validId(tenantId) || !validId(identity.uid))
        throw new BusinessError(400, 'Identidade inválida.');
      id(quoteId);
      if (!['preview', 'commands'].includes(action))
        throw new BusinessError(404, 'Operação desconhecida.');
      const body = record(
        req.body,
        action === 'preview'
          ? ['expectedRevision']
          : ['requestId', 'type', 'expectedRevision', 'payload'],
        'Comando',
      );
      const expected = integer(body.expectedRevision, 'Revisão esperada');
      const requestId = action === 'commands' ? id(body.requestId) : '';
      const type = action === 'preview' ? 'preview' : textValue(body.type, 'Operação');
      if (type === 'approve')
        record(body.payload, ['versionId', 'reportedBy', 'channel', 'evidence'], 'Aprovação');
      const requestHash = fingerprint([quoteId, identity.uid, body]);
      const output = await db.runTransaction(async (tx) => {
        const root = `tenants/${tenantId}`;
        const ref = (p: string) => db.doc(`${root}/${p}`);
        const cache = new Map<string, any>();
        const get = async (path: string) => {
          if (!cache.has(path)) {
            if (cache.size >= 250)
              throw new CatalogError('Orçamento excede 250 referências. Divida o pedido.');
            cache.set(path, (await tx.get(ref(path))).data());
          }
          return cache.get(path);
        };
        const tenant = (await tx.get(db.doc(root))).data();
        const profile = (await tx.get(db.doc(`users/${identity.uid}`))).data();
        const owner = tenant?.ownerUid === identity.uid;
        if (!tenant || tenant.status === 'inactive' || !(owner || profile?.tenantId === tenantId))
          throw new BusinessError(403, 'Empresa sem acesso.');
        const canApprove =
          owner || (profile?.tenantId === tenantId && profile?.tenantRole === 'admin');
        if (['approve', 'cancel-order', 'bind-custom'].includes(type) && !canApprove)
          throw new BusinessError(
            403,
            'Aprovação e alteração de pedido exigem proprietário ou administrador da empresa.',
          );
        if (requestId) {
          const receipt = await get(`quoteCommands/${requestId}`);
          if (receipt) {
            if (receipt.hash !== requestHash)
              throw new BusinessError(409, 'Chave já utilizada em outro comando.');
            return receipt.result;
          }
        }
        const quote = await get(`quotes/${quoteId}`);
        const now = new Date().toISOString();
        // A second approval, even with a different key, returns the original order and evidence.
        if (
          type === 'approve' &&
          quote?.status === 'approved' &&
          quote.currentVersion === body.payload?.versionId
        ) {
          const existing = await get(`salesOrders/${quoteId}`);
          if (!existing || existing.status !== 'active')
            throw new BusinessError(409, 'Pedido cancelado; crie uma revisão comercial.');
          const result = {
            quoteId,
            revision: quote.revision,
            orderId: quoteId,
            alreadyApproved: true,
          };
          tx.create(ref(`quoteCommands/${requestId}`), {
            hash: requestHash,
            result,
            actorUid: identity.uid,
            createdAt: now,
          });
          return result;
        }
        if ((quote?.revision ?? 0) !== expected)
          throw new BusinessError(409, 'Orçamento mudou. Recarregue antes de continuar.');
        if (type === 'preview') {
          if (!quote || quote.status !== 'draft')
            throw new BusinessError(409, 'Prévia exige rascunho.');
          return quoteCost(get, tenantId, validateQuote(quote.data));
        }
        const writes: (() => void)[] = [];
        const create = (path: string, value: any) => writes.push(() => tx.create(ref(path), value));
        const put = (path: string, value: any) => writes.push(() => tx.set(ref(path), value));
        const revision = expected + 1;
        let next: any = { ...quote, revision, updatedAt: now, updatedBy: identity.uid };
        const result: any = { quoteId, revision };
        const p = body.payload;
        if (type === 'save-draft') {
          const payload = record(p, ['data', 'reason'], 'Rascunho');
          if (quote && ['approved', 'cancelled'].includes(quote.status))
            throw new BusinessError(
              409,
              'Orçamento aprovado/cancelado é imutável. Crie outro com vínculo de revisão.',
            );
          textValue(payload.reason, 'Motivo da revisão', 500);
          const data = validateQuote(payload.data);
          await requireAssets(
            get,
            data.lines.map((l) => l.referenceUrl),
          );
          if (data.sourceRequestId && !(await get(`customRequests/${data.sourceRequestId}`)))
            throw new CatalogError('Solicitação de origem não encontrada.');
          if (data.replacesOrderId) {
            const old = await get(`salesOrders/${data.replacesOrderId}`);
            const closed =
              (await get(`financeAccounts/${data.replacesOrderId}`))?.status === 'closed';
            if (data.replacesOrderId === quoteId || !old || (old.status !== 'cancelled' && !closed))
              throw new BusinessError(
                409,
                'Revisão exige pedido anterior cancelado ou financeiramente conferido após os acordos e fatos físicos.',
              );
          }
          next = {
            ...next,
            data,
            status: 'draft',
            currentVersion: null,
            createdAt: quote?.createdAt ?? now,
            createdBy: quote?.createdBy ?? identity.uid,
          };
        } else if (type === 'record-send') {
          record(
            p,
            ['versionId', 'recipient', 'channel', 'evidence', 'sentAt'],
            'Registro de envio',
          );
          if (
            !quote ||
            !['issued', 'approved'].includes(quote.status) ||
            quote.currentVersion !== id(p.versionId)
          )
            throw new BusinessError(409, 'Registre o envio da versão vigente emitida/aprovada.');
          const snapshot = await get(`quotes/${quoteId}/versions/${p.versionId}`);
          const sentAt = instant(p.sentAt);
          if (!snapshot || sentAt < snapshot.issuedAt || sentAt > snapshot.expiresAt)
            throw new CatalogError('Envio deve ocorrer entre emissão e validade da versão.');
          const dispatch = {
            quoteId,
            versionId: p.versionId,
            kind: 'operator-reported',
            recipient: textValue(p.recipient, 'Destinatário', 200),
            channel: textValue(p.channel, 'Canal do envio', 80),
            evidence: textValue(p.evidence, 'Evidência do envio', 2000),
            sentAt,
            recordedAt: now,
            actorUid: identity.uid,
          };
          create(`quotes/${quoteId}/dispatches/${requestId}`, dispatch);
          next.lastDispatch = { id: requestId, ...dispatch };
          result.dispatchId = requestId;
        } else if (type === 'issue') {
          const payload = record(p, ['expiresAt', 'previewFingerprint'], 'Emissão');
          if (!quote || quote.status !== 'draft')
            throw new BusinessError(409, 'Emissão exige rascunho.');
          const expiry = new Date(textValue(payload.expiresAt, 'Validade'));
          if (
            !Number.isFinite(expiry.getTime()) ||
            expiry.getTime() <= Date.now() ||
            expiry.getTime() > Date.now() + 366 * 86400000
          )
            throw new CatalogError('Validade deve estar no futuro, em até 366 dias.');
          const calculation = await quoteCost(get, tenantId, validateQuote(quote.data));
          if (calculation.fingerprint !== payload.previewFingerprint)
            throw new BusinessError(
              409,
              'Custos ou dados mudaram desde a prévia. Confira uma nova prévia antes de emitir.',
            );
          create(`quotes/${quoteId}/versions/${requestId}`, {
            ...calculation,
            versionId: requestId,
            quoteId,
            issuedAt: now,
            expiresAt: expiry.toISOString(),
            actorUid: identity.uid,
            revision,
          });
          next = {
            ...next,
            status: 'issued',
            currentVersion: requestId,
            expiresAt: expiry.toISOString(),
          };
          result.versionId = requestId;
        } else if (['approve', 'decline', 'expire'].includes(type)) {
          const payload = record(
            p,
            type === 'approve'
              ? ['versionId', 'reportedBy', 'channel', 'evidence']
              : ['versionId', 'reason'],
            'Resposta',
          );
          if (!quote || quote.status !== 'issued' || quote.currentVersion !== id(payload.versionId))
            throw new BusinessError(409, 'Versão não é a proposta vigente.');
          const snapshot = await get(`quotes/${quoteId}/versions/${quote.currentVersion}`);
          if (!snapshot) throw new BusinessError(409, 'Versão emitida ausente.');
          const expired = Date.parse(snapshot.expiresAt) <= Date.now();
          if (type === 'expire' && !expired)
            throw new BusinessError(409, 'Proposta ainda está válida.');
          if (type !== 'expire' && expired)
            throw new BusinessError(409, 'Proposta expirada. Revise e emita novamente.');
          if (type === 'approve') {
            if ((await get('inventoryControl/state'))?.phase !== 'active')
              throw new BusinessError(
                409,
                'Ative e confira o estoque E3 antes de aprovar pedidos.',
              );
            const approval = {
              kind: 'operator-reported',
              actorUid: identity.uid,
              recordedAt: now,
              reportedBy: textValue(payload.reportedBy, 'Quem informou o aceite', 150),
              channel: textValue(payload.channel, 'Canal do aceite', 80),
              evidence: textValue(payload.evidence, 'Evidência do aceite', 2000),
            };
            const targets = snapshot.data.lines.map((l: any) => ({
              id: targetId(quoteId, l.id),
              salesOrderId: quoteId,
              quoteVersionId: quote.currentVersion,
              lineId: l.id,
              description: l.description,
              quantity: l.quantity,
              recipeVersion: l.recipeVersion,
              item:
                l.kind === 'catalog'
                  ? { kind: 'product', id: l.productId, variationId: l.variationId }
                  : null,
              version: 1,
              status: l.kind === 'catalog' ? 'ready' : 'needs-recipe',
            }));
            for (const t of targets) {
              if ((await get(`orders/${t.id}`)) || (await get(`orderTargets/${t.id}`)))
                throw new BusinessError(409, 'Identificador de atendimento em conflito.');
              create(`orderTargets/${t.id}`, t);
            }
            create(`salesOrders/${quoteId}`, {
              quoteId,
              quoteVersionId: quote.currentVersion,
              targetIds: targets.map((t: any) => t.id),
              customerName: snapshot.data.customerName,
              priceCents: snapshot.price.priceCents,
              status: 'active',
              paymentStatus: 'unrecorded',
              approval,
              createdAt: now,
              version: 1,
              replacesOrderId: snapshot.data.replacesOrderId,
            });
            next.status = 'approved';
            next.approval = approval;
            result.orderId = quoteId;
          } else {
            textValue(payload.reason, 'Motivo', 500);
            next.status = type === 'decline' ? 'declined' : 'expired';
          }
        } else if (type === 'cancel') {
          const payload = record(p, ['reason'], 'Cancelamento');
          textValue(payload.reason, 'Motivo do cancelamento', 500);
          if (!quote || !['draft', 'issued', 'declined', 'expired'].includes(quote.status))
            throw new BusinessError(409, 'Use o cancelamento de pedido após aprovação.');
          next.status = 'cancelled';
        } else if (type === 'bind-custom') {
          const payload = record(
            p,
            ['targetId', 'productId', 'variationId', 'recipeVersion', 'reason'],
            'Ficha para peça avulsa',
          );
          textValue(payload.reason, 'Motivo do vínculo', 500);
          const order = await get(`salesOrders/${quoteId}`),
            target = await get(`orderTargets/${id(payload.targetId)}`);
          if (
            !order ||
            order.status !== 'active' ||
            !target ||
            target.salesOrderId !== quoteId ||
            target.item
          )
            throw new BusinessError(409, 'Item sem vínculo pendente neste pedido ativo.');
          await catalogRecipe(
            get,
            id(payload.productId),
            id(payload.variationId),
            id(payload.recipeVersion),
          );
          put(`orderTargets/${payload.targetId}`, {
            ...target,
            item: { kind: 'product', id: payload.productId, variationId: payload.variationId },
            recipeVersion: payload.recipeVersion,
            version: target.version + 1,
            status: 'ready',
            boundAt: now,
            boundBy: identity.uid,
          });
        } else if (type === 'cancel-order') {
          const payload = record(p, ['reason'], 'Cancelamento de pedido');
          textValue(payload.reason, 'Motivo do cancelamento', 500);
          const order = await get(`salesOrders/${quoteId}`);
          if (!order || order.status !== 'active')
            throw new BusinessError(409, 'Pedido não está ativo.');
          const account = await get(`financeAccounts/${quoteId}`);
          if (account && (netReceived(account as any) !== 0 || account.status === 'closed'))
            throw new BusinessError(
              409,
              'Reabra a conferência e reembolse/estorne recebimentos antes de cancelar o pedido.',
            );
          for (const t of order.targetIds) {
            const f = await get(`stockFulfillments/${t}`);
            if (f && (Number(f.reserved) > 0 || Number(f.shipped) > 0))
              throw new BusinessError(
                409,
                'Pedido tem reserva ou expedição. Libere reservas; expedições exigem tratamento de devolução.',
              );
            const plans = await tx.get(
              db.collection(`${root}/stockPlans`).where('orderId', '==', t).limit(501),
            );
            if (plans.size > 500)
              throw new BusinessError(409, 'Histórico excede limite de conferência.');
            if (
              plans.docs.some(
                (d) => d.data().status === 'active' || d.data().remainingRuns !== d.data().runs,
              )
            )
              throw new BusinessError(
                409,
                'Pedido possui produção ativa ou consumo registrado. Cancele apenas planos sem execução; consumo exige revisão operacional.',
              );
          }
          put(`salesOrders/${quoteId}`, {
            ...order,
            status: 'cancelled',
            version: order.version + 1,
            cancelledAt: now,
            cancelledBy: identity.uid,
            cancellationReason: payload.reason,
          });
        } else throw new CatalogError('Operação desconhecida.');
        // All reads and decisions precede the first write. Event/receipt are atomic with the business state.
        put(`quotes/${quoteId}`, next);
        create(`quoteEvents/${requestId}`, {
          quoteId,
          type,
          revision,
          previousStatus: quote?.status ?? null,
          status: next.status,
          versionId: next.currentVersion ?? null,
          actorUid: identity.uid,
          createdAt: now,
          payload: p,
        });
        create(`quoteCommands/${requestId}`, {
          hash: requestHash,
          result,
          actorUid: identity.uid,
          createdAt: now,
        });
        create(`auditLogs/quote-${requestId}`, {
          action: `quote.${type}`,
          quoteId,
          actorUid: identity.uid,
          createdAt: now,
          revision,
        });
        for (const write of writes) write();
        return result;
      });
      return res.json(output);
    } catch (error) {
      if (error instanceof BusinessError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof CatalogError || error instanceof PricingError)
        return res.status(422).json({ error: error.message });
      console.error('Falha no orçamento:', error);
      return res
        .status(503)
        .json({ error: 'Não foi possível concluir. Repita com a mesma solicitação.' });
    }
  });
}
