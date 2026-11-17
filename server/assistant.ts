import { salesSummary } from './assistant-sales-intake';
import { compareRequestList, type RequestListSort } from '../shared/requests/number';
import { nextAssistantNumber } from './assistant-numbering';
import { createAssistantImagePreviewer } from './assistant-image-preview';
import { assistantStatuses, assistantStatusUpdate } from '../shared/assistant/status';
import { assetId } from '../shared/assets/model';
import { requestCodes, matchesApprovalReference, matchesRequestQuery, parseProductionCommand, productionUpdate } from '../shared/assistant/workflow';
import { priceFromOrderMessage, publicCustomerQuote, quoteTiersFromMessage, formatCustomerQuote } from '../shared/requests/quote';
import { assistantAiFromEnvironment, aiProductionCommand, AI_MAX_BYTES, type AssistantAi, type AiFile, type ConversationAction } from "./assistant-ai";
import express, { type Express, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { BusinessError, validId } from "./session";
import { inspectAsset, type AssetStore } from "./assets";
import { validateIntake, suggestIntake } from "../shared/assistant/model";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const safeKey = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const operationId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(v);
const fail = (status: number, message: string): never => {
  throw new BusinessError(status, message);
};
function fields(body: any, allowed: string[]) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    fail(422, "Comando inválido.");
  return body;
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(422, "Texto vazio ou maior que o limite.");
  return (value as string).trim();
}
function attachments(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 6 ||
    value.some((x) => !safeKey(x)) ||
    new Set(value).size !== value.length
  )
    fail(422, "Até seis anexos válidos por envio.");
  return value as string[];
}
export function inspectAssistantFile(
  bytes: Buffer,
  name: string,
  mime: string,
) {
  if (!name || name.length > 180) fail(422, "Nome de arquivo inválido.");
  if (["image/png", "image/jpeg", "image/webp"].includes(mime))
    return inspectAsset(bytes, name, mime);
  if (
    !bytes.length ||
    bytes.length > 10 * 1024 * 1024 ||
    !name ||
    name.length > 180 ||
    /[\x00-\x1f\x7f/\\]/.test(name)
  )
    fail(422, "Arquivo inválido (máximo 10 MiB).");
  const ext = name.split(".").at(-1)?.toLowerCase(),
    head = bytes.subarray(0, 16);
  const allowed =
    (mime === "audio/mpeg" &&
      ext === "mp3" &&
      (head.toString().startsWith("ID3") ||
        (head[0] === 255 && (head[1] & 224) === 224))) ||
    (["audio/mp4", "audio/x-m4a"].includes(mime) &&
      ["m4a", "mp4"].includes(ext || "") &&
      head.subarray(4, 8).toString() === "ftyp") ||
    (mime === "audio/webm" &&
      ext === "webm" &&
      head.subarray(0, 4).toString("hex") === "1a45dfa3") ||
    (mime === "audio/ogg" &&
      ["ogg", "oga"].includes(ext || "") &&
      head.subarray(0, 4).toString() === "OggS") ||
    (["audio/wav", "audio/x-wav"].includes(mime) &&
      ext === "wav" &&
      head.subarray(0, 4).toString() === "RIFF" &&
      head.subarray(8, 12).toString() === "WAVE");
  if (!allowed)
    fail(
      422,
      "Envie PNG, JPEG, WebP ou áudio MP3, M4A, WebM, OGG ou WAV válido.",
    );
  return { name, mime, size: bytes.length, sha256: hash(bytes) };
}
function orderSummary(row: any) {
  return {
    quantity: row.requestedQuantity ?? 1,
    isGift: row.isGift === true,
    quotedPrice: row.isGift === true ? 0 : typeof row.quotedPrice === 'number' && Number.isFinite(row.quotedPrice) && row.quotedPrice > 0 ? row.quotedPrice : null,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    requestedDeliveryDate: typeof row.requestedDeliveryDate === 'string' ? row.requestedDeliveryDate : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    quoteSentAt: typeof row.quoteSentAt === 'string' ? row.quoteSentAt : null,
    code: typeof row.code === 'string' ? row.code : null,
    requestNumber: typeof row.requestNumber === 'string' || typeof row.requestNumber === 'number' ? row.requestNumber : null,
  };
}
export function registerAssistantRoutes(
  app: Express,
  db: Firestore | null,
  verify: (t: string) => Promise<DecodedIdToken>,
  store: AssetStore | null,
  ai: AssistantAi | null = assistantAiFromEnvironment(app),
) {
  app.get("/assistente", (_req, res, next) => {
    res.set({
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    });
    next();
  });
  const ref = (p: string) => db!.doc(p);
  const imagePreview = createAssistantImagePreviewer();
  const aiEnabled = (tenantId: string) => !!ai && (!process.env.LABLAYER_ASSISTANT_AI_TENANTS || process.env.LABLAYER_ASSISTANT_AI_TENANTS.split(",").includes(tenantId));
  async function owner(
    tx: Transaction,
    tenant: string,
    identity: DecodedIdToken,
  ) {
    if (!validId(tenant)) fail(422, "Empresa inválida.");
    const company = (await tx.get(ref(`tenants/${tenant}`))).data();
    if (
      !company ||
      company.status === "inactive" ||
      !(
        identity.superadmin === true ||
        (tenant === identity.uid && company.ownerUid === identity.uid)
      )
    )
      fail(
        403,
        "Somente o proprietário ou administrador da plataforma pode gerenciar links.",
      );
  }
  async function member(
    tx: Transaction,
    tenant: string,
    identity: DecodedIdToken,
  ) {
    if (!validId(tenant)) fail(422, "Empresa inválida.");
    const company = (await tx.get(ref(`tenants/${tenant}`))).data();
    const profile = (await tx.get(ref(`users/${identity.uid}`))).data();
    const membership = (
      await tx.get(ref(`tenants/${tenant}/members/${identity.uid}`))
    ).data();
    if (
      !company ||
      company.status === "inactive" ||
      !(
        company.ownerUid === identity.uid ||
        (profile?.tenantId === tenant && membership?.active !== false)
      )
    )
      fail(403, "Sem acesso à empresa.");
  }
  async function access(tx: Transaction, key: string): Promise<any> {
    const link = (await tx.get(ref(`assistantLinks/${key}`))).data();
    if (
      !link ||
      !link.active ||
      !validId(link.tenantId) ||
      !link.expiresAt ||
      link.expiresAt <= new Date().toISOString()
    )
      fail(
        403,
        "Link inválido, expirado ou revogado. Solicite um novo acesso.",
      );
    const company = (await tx.get(ref(`tenants/${link.tenantId}`))).data();
    if (!company || company.status === "inactive")
      fail(403, "Empresa indisponível.");
    return { ...link, companyName: company.companyName || "LabLayer", sharedRequests: company.assistantSharedRequests === true, workflowUpdates: company.assistantWorkflowUpdates === true };
  }
  const errors = (res: Response, e: any) => {
    if (e instanceof BusinessError)
      return res.status(e.status).json({ error: e.message });
    console.error("Falha no assistente (sem dados da mensagem).");
    return res.status(503).json({
      error: "Operação não confirmada. Tente novamente com o mesmo envio.",
    });
  };
  const admin =
    (
      action: (req: Request, res: Response, id: DecodedIdToken) => Promise<any>,
    ) =>
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "private, no-store");
      if (!db) return res.status(503).json({ error: "Banco indisponível." });
      let identity: DecodedIdToken;
      try {
        const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
        if (!token) throw Error();
        identity = await verify(token);
        if (!validId(identity.uid)) throw Error();
      } catch {
        return res.status(401).json({ error: "Autenticação necessária." });
      }
      try {
        await action(req, res, identity);
      } catch (e) {
        errors(res, e);
      }
    };
  // Bounded process limiter is a first layer; persistent daily quotas survive restarts.
  const rates = new Map<string, { start: number; count: number }>();
  const publicRoute =
    (action: (req: Request, res: Response, key: string) => Promise<any>) =>
    async (req: Request, res: Response) => {
      res.set({
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      });
      if (!db) return res.status(503).json({ error: "Banco indisponível." });
      const token = req.headers.authorization?.match(
        /^Bearer ([A-Za-z0-9_-]{43})$/,
      )?.[1];
      if (!token)
        return res
          .status(401)
          .json({ error: "Abra o link exclusivo enviado pelo responsável." });
      const key = hash(token),
        now = Date.now(),
        bucket = rates.get(key);
      if (rates.size > 10000) rates.clear();
      if (!bucket || now - bucket.start > 60000)
        rates.set(key, { start: now, count: 1 });
      else if (++bucket.count > 120)
        return res
          .status(429)
          .json({ error: "Muitos envios. Aguarde um minuto." });
      try {
        // Every GET validates access inside its own read-only transaction.
        // Writes keep the early check, including before parsing an upload body.
        if (req.method !== "GET") await db!.runTransaction((tx) => access(tx, key));
        await action(req, res, key);
      } catch (e) {
        errors(res, e);
      }
    };
  function audit(
    tx: Transaction,
    tenant: string,
    actor: string,
    operation: string,
    target: string,
  ) {
    tx.create(db!.collection(`tenants/${tenant}/auditLogs`).doc(), {
      actor,
      operation,
      target,
      createdAt: new Date().toISOString(),
    });
  }
  function consume(
    tx: Transaction,
    key: string,
    link: any,
    kind: "requests" | "bytes",
    amount: number,
  ) {
    const day = new Date().toISOString().slice(0, 10);
    const quota =
      link.quotaDay === day
        ? { requests: link.requests || 0, bytes: link.bytes || 0 }
        : { requests: 0, bytes: 0 };
    quota[kind] += amount;
    if (quota.requests > 100 || quota.bytes > 50 * 1024 * 1024)
      fail(429, "Limite diário deste link atingido (100 pedidos ou 50 MiB).");
    tx.update(ref(`assistantLinks/${key}`), { quotaDay: day, ...quota });
  }
  app.get(
    "/api/tenants/:tenantId/assistant-links",
    admin(async (req, res, id) => {
      const tenant = req.params.tenantId as string;
      const links = await db!.runTransaction(async (tx) => {
        await owner(tx, tenant, id);
        const rows = await tx.get(
          db!.collection("assistantLinks").where("tenantId", "==", tenant),
        );
        return rows.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          active: d.data().active,
          expiresAt: d.data().expiresAt,
          createdAt: d.data().createdAt,
        }));
      });
      res.json({ links });
    }),
  );
  app.post(
    "/api/tenants/:tenantId/assistant-links",
    admin(async (req, res, id) => {
      const tenant = req.params.tenantId as string,
        body = fields(req.body, ["name"]);
      const name = text(body.name, 80);
      const token = randomBytes(32).toString("base64url"),
        key = hash(token),
        now = new Date().toISOString(),
        expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
      await db!.runTransaction(async (tx) => {
        await owner(tx, tenant, id);
        const links = await tx.get(
          db!.collection("assistantLinks").where("tenantId", "==", tenant),
        );
        if (
          links.docs.filter((d) => d.data().active && d.data().expiresAt > now)
            .length >= 30
        )
          fail(
            409,
            "Revogue um acesso antes de criar mais de 30 links ativos.",
          );
        tx.create(ref(`assistantLinks/${key}`), {
          tenantId: tenant,
          name,
          active: true,
          createdAt: now,
          expiresAt,
          createdBy: id.uid,
        });
        audit(tx, tenant, id.uid, "assistant.link-created", key);
      });
      res.json({ id: key, token, expiresAt });
    }),
  );
  app.post(
    "/api/tenants/:tenantId/assistant-links/:key/revoke",
    admin(async (req, res, id) => {
      const tenant = req.params.tenantId as string,
        key = req.params.key as string;
      if (!safeKey(key)) fail(422, "Link inválido.");
      await db!.runTransaction(async (tx) => {
        await owner(tx, tenant, id);
        const link = (await tx.get(ref(`assistantLinks/${key}`))).data();
        if (link?.tenantId !== tenant) fail(404, "Link não encontrado.");
        tx.update(ref(`assistantLinks/${key}`), {
          active: false,
          revokedAt: new Date().toISOString(),
        });
        audit(tx, tenant, id.uid, "assistant.link-revoked", key);
      });
      res.json({ revoked: true });
    }),
  );
  app.get(
    "/api/assistant",
    publicRoute(async (req, res, key) => {
      const summary = req.query.summary;
      if (summary !== undefined && summary !== "true") fail(422, "Resumo inválido.");
      const statusFilter = req.query.status;
      const allowedStatuses = Object.keys(assistantStatuses);
      if (statusFilter !== undefined && (typeof statusFilter !== "string" || !["active", "all", ...allowedStatuses].includes(statusFilter))) fail(422, "Filtro de status inválido.");
      const statuses = statusFilter === "active" ? ["aguardando-orcamento", "orcado"] : statusFilter && statusFilter !== "all" ? [statusFilter] : null;
      const direction = req.query.sort ?? 'asc';
      if (direction !== 'asc' && direction !== 'desc' && !(statusFilter === 'fila-producao' && (direction === 'delivery-asc' || direction === 'delivery-desc'))) return fail(422, 'Ordenação inválida.');
      const cursor = req.query.cursor;
      if (cursor !== undefined && !validId(cursor)) fail(422, "Página inválida.");
      const result = await db!.runTransaction(async (tx) => {
        const link = await access(tx, key);
        // Opening the conversation only needs access and company metadata.
        if (summary === "true") return {
          seller: link.name, company: link.companyName, mode: aiEnabled(link.tenantId) ? "ai" : "guided",
          workflowUpdates: link.workflowUpdates, requestScope: link.sharedRequests ? "tenant" : "link", requests: [], nextCursor: null,
        };
        function paginate<T extends { id: string }>(items: T[]) {
          items.sort((a, b) => compareRequestList(a, b, direction as RequestListSort));
          const start = cursor ? items.findIndex(item => item.id === cursor) + 1 : 0;
          if (cursor && !start) fail(422, 'A lista mudou. Reabra Pedidos para atualizar.');
          const rows = items.slice(start, start + 100);
          return { rows, nextCursor: start + rows.length < items.length ? rows.at(-1)!.id : null };
        }
        if (link.sharedRequests) {
          const fields = ["title", "customerName", "requestedQuantity", "customerQuote", "quotedPrice", "isGift", "updatedAt", "requestedDeliveryDate", "createdAt", "quoteSentAt", "code", "requestNumber", "quoteMediaImageUrl", "referenceImageUrl", "status"];
          const collection = db!.collection(`tenants/${link.tenantId}/customRequests`);
          const query = (statuses ? collection.where("status", "in", statuses) : collection).orderBy(FieldPath.documentId());
          // The common case stays one query. For larger lists, rank remaining IDs
          // with only their numbering fields and fetch card details for this page.
          const initial = await tx.get(query.select(...fields).limit(101));
          const rest = initial.size < 101 ? [] : (await tx.get(query.startAfter(initial.docs[100]).select("code", "requestNumber", "title", "requestedDeliveryDate"))).docs;
          const { rows: ranked, nextCursor } = paginate([...initial.docs, ...rest].map(d => ({ ...d.data(), id: d.id, ref: d.ref })));
          const cards = new Map(initial.docs.map(d => [d.id, d]));
          const missing = ranked.filter(d => !cards.has(d.id));
          if (missing.length) for (const d of await tx.getAll(...missing.map(d => d.ref), { fieldMask: fields })) {
            if (d.exists) cards.set(d.id, d as typeof initial.docs[number]);
          }
          const rows = ranked.map(d => cards.get(d.id)!);
          return { seller: link.name, company: link.companyName, mode: aiEnabled(link.tenantId) ? "ai" : "guided",
            workflowUpdates: link.workflowUpdates, requestScope: "tenant", nextCursor,
            requests: rows.map(d => ({ id: d.id, title: d.data().title || "Pedido sem título",
              customerName: d.data().customerName || "", quantity: d.data().requestedQuantity ?? 1,
              customerQuote: publicCustomerQuote(d.data().customerQuote),
              ...orderSummary(d.data()),
              quoteImageId: assetId(d.data().quoteMediaImageUrl || d.data().referenceImageUrl || ""),
              createdAt: d.data().createdAt || null, status: d.data().status || "aguardando-orcamento" })) };
        }
        const mappings = await tx.get(
          db!
            .collection(`assistantLinks/${key}/requests`)
            .select("title", "customerName", "quantity", "createdAt"),
        );
        const rows = mappings.empty
          ? []
          : await tx.getAll(
              ...mappings.docs.map((d) =>
                ref(`tenants/${link.tenantId}/customRequests/${d.id}`),
              ), { fieldMask: ["status", "updatedAt", "code", "requestNumber", "requestedQuantity", ...(link.workflowUpdates ? ["quotedPrice", "isGift", "customerQuote", "requestedDeliveryDate"] : [])] },
            );
        const page = paginate(mappings.docs.flatMap((d, i) =>
            rows[i].exists && (!statuses || statuses.includes(rows[i].data()?.status))
              ? [
                  {
                    id: d.id,
                    title: d.data().title,
                    customerName: d.data().customerName,
                    quantity: link.workflowUpdates ? rows[i].data()?.requestedQuantity ?? d.data().quantity : d.data().quantity,
                    ...(link.workflowUpdates ? { isGift: rows[i].data()?.isGift === true, quotedPrice: rows[i].data()?.quotedPrice ?? null, customerQuote: publicCustomerQuote(rows[i].data()?.customerQuote), requestedDeliveryDate: rows[i].data()?.requestedDeliveryDate ?? null } : {}),
                    createdAt: d.data().createdAt,
                    status: rows[i].data()?.status,
                    updatedAt: rows[i].data()?.updatedAt || null,
                    code: rows[i].data()?.code || null,
                    requestNumber: rows[i].data()?.requestNumber || null,
                  },
                ]
              : [],
          ));
        return {
          seller: link.name, company: link.companyName, mode: aiEnabled(link.tenantId) ? "ai" : "guided",
          workflowUpdates: link.workflowUpdates, requestScope: "link", requests: page.rows, nextCursor: page.nextCursor,
        };
      }, { readOnly: true });
      res.json(result);
    }),
  );
  const aiBusy = new Set<string>();
  const messageFingerprint = (body: any, message: string, ids: string[]) => hash(JSON.stringify({ message, ids, requestId: body.requestId || null }));
  async function productionReceipt(key: string, body: any, message: string, ids: string[]) {
    return db!.runTransaction(async tx => {
      await access(tx, key);
      const receipt = await tx.get(ref(`assistantLinks/${key}/messageUpdates/${body.operationId}`));
      if (!receipt.exists) return null;
      if (receipt.data()!.fingerprint !== messageFingerprint(body, message, ids)) fail(409, 'Envio já utilizado com outros dados.');
      return receipt.data()!.result;
    });
  }
  async function applyProductionMessage(key: string, body: any, message: string, ids: string[], action?: ConversationAction, transcript = '') {
    let interpreted;
    try { interpreted = action ? aiProductionCommand(action, message) : null; }
    catch (error) { fail(422, (error as Error).message); }
    const command = interpreted?.command ?? parseProductionCommand(message);
    const query = interpreted?.query || (command?.code ? `ORC-${command.code}` : '');
    if (!command || (!query && !body.requestId)) return null;
    const fingerprint = messageFingerprint(body, message, ids);
    return db!.runTransaction(async tx => {
      const link = await access(tx, key);
      if (!link.workflowUpdates) fail(403, 'Atualização de produção pelo bot não está habilitada nesta empresa.');
      const receiptRef = ref(`assistantLinks/${key}/messageUpdates/${body.operationId}`);
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data()!.fingerprint !== fingerprint) fail(409, 'Envio já utilizado com outros dados.');
        return receipt.data()!.result;
      }
      let requestId = body.requestId;
      if (query) {
        const index = await tx.get(db!.collection(link.sharedRequests ? `tenants/${link.tenantId}/customRequests` : `assistantLinks/${key}/requests`).orderBy(FieldPath.documentId()).limit(1001));
        if (index.size > 1000) fail(409, 'Busca excede o limite. Selecione o pedido e envie o comando sem código.');
        const rows = link.sharedRequests ? index.docs : index.empty ? [] : await tx.getAll(...index.docs.map(d => ref(`tenants/${link.tenantId}/customRequests/${d.id}`)));
        const matches = rows.filter(d => d.exists).filter(d => matchesApprovalReference(query, [d.id, d.data()!.title, d.data()!.customerName, d.data()!.code, d.data()!.requestNumber].filter(v => typeof v === 'string')));
        if (matches.length !== 1) fail(409, matches.length ? 'Mais de um pedido corresponde à referência. Selecione o pedido correto e confirme a aprovação sem repetir o nome ou código.' : 'Pedido não encontrado. Confira o código ou nome; nada foi alterado.');
        requestId = matches[0].id;
      }
      const mapping = await tx.get(ref(`assistantLinks/${key}/requests/${requestId}`));
      const requestRef = ref(`tenants/${link.tenantId}/customRequests/${requestId}`);
      const row = await tx.get(requestRef);
      if ((!link.sharedRequests && !mapping.exists) || !row.exists) fail(404, 'Pedido não encontrado neste acesso.');
      const phase = await tx.get(ref(`tenants/${link.tenantId}/inventoryControl/state`));
      if (phase.exists && phase.data()?.phase !== 'legacy') fail(409, 'A produção desta empresa usa o fluxo novo. Atualize pelo módulo de pedidos.');
      // An unpriced order needs a reviewed total (or gift) and delivery date.
      if (row.get('status') === 'aguardando-orcamento' && !command.paid && !command.personalization.length && !ids.length) {
        return { draft:null, selectedRequestId:requestId, action:{intent:'queueReview', quantity:command.quantity, deliveryDate:command.deliveryDate},
          message:'Confira a quantidade, o valor ou a opção de presente e a entrega para colocar este pedido diretamente na fila.' };
      }
      const requestedQuantity = row.get('requestedQuantity') ?? row.get('quantity');
      const hasPriceOption = command.quantity === undefined || publicCustomerQuote(row.get('customerQuote'))?.options.some(option => option.quantity === command.quantity && option.unitPrice > 0);
      if (row.get('status') === 'orcado' && command.quantity !== undefined && command.quantity !== requestedQuantity && !hasPriceOption && !ids.length) {
        return { draft:null, selectedRequestId:requestId,
          action:{intent:'approvalReview', quantity:command.quantity, deliveryDate:command.deliveryDate ?? row.get('requestedDeliveryDate') ?? null, paid:command.paid, workflowMessage:message}, transcript,
          message:'A quantidade aprovada não tem um total cadastrado para essa opção. Confira o valor e a entrega antes de colocar o pedido na fila.' };
      }
      const files = await ownedFiles(tx, key, ids);
      const notes = await tx.get(db!.collection(`tenants/${link.tenantId}/assistantRequests/${requestId}/notes`).limit(101));
      if (notes.size >= 100) fail(409, 'Limite de 100 atualizações atingido.');
      const now = new Date().toISOString();
      let update;
      try { update = productionUpdate(row.data(), command, now); }
      catch (error) { fail(409, (error as Error).message); }
      const noteId = `update-${hash(`${key}:${body.operationId}`)}`;
      const result = { draft: null, action: { intent: 'updated' }, updatedRequestId: requestId, transcript,
        message: `Pedido encaminhado para a fila de produção. ${command.paid ? 'Pagamento informado como recebido. ' : ''}${command.deliveryDate ? `Entrega solicitada para ${command.deliveryDate.split('-').reverse().join('/')}. ` : ''}Informações registradas na linha do tempo.${command.personalization.length || command.quantity !== undefined ? ' Quantidade e opção de orçamento conferidas.' : ''}` };
      tx.update(requestRef, update!.patch);
      tx.create(ref(`tenants/${link.tenantId}/assistantRequests/${requestId}/notes/${noteId}`), {
        message, attachments: files, seller: link.name, linkId: key, createdAt: now, fingerprint,
        kind: 'workflow-update', changes: update!.changes, paymentReported: command.paid,
        personalization: command.personalization,
        interpretation: action ? 'ai' : 'deterministic',
      });
      tx.create(receiptRef, { fingerprint, requestId, result, createdAt: now });
      audit(tx, link.tenantId, `assistant:${key}`, 'assistant.workflow-updated', requestId);
      return result;
    });
  }
  async function findConversationRequests(key: string, queryText: string, selectedId?: string) {
    return db!.runTransaction(async tx => {
      const link = await access(tx, key);
      const normalized = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const query = normalized(queryText);
      if (queryText && !query) return { candidates: [], truncated: false };
      let rows;
      let truncated = false;
      if (!query && selectedId) {
        if (!link.sharedRequests && !(await tx.get(ref(`assistantLinks/${key}/requests/${selectedId}`))).exists) fail(404, "Pedido não encontrado.");
        rows = [await tx.get(ref(`tenants/${link.tenantId}/customRequests/${selectedId}`))];
      } else if (link.sharedRequests) {
        const page = await tx.get(db!.collection(`tenants/${link.tenantId}/customRequests`).orderBy(FieldPath.documentId()).limit(1001));
        truncated = page.size > 1000; rows = page.docs.slice(0, 1000);
      } else {
        const mappings = await tx.get(db!.collection(`assistantLinks/${key}/requests`).orderBy(FieldPath.documentId()).limit(1001));
        truncated = mappings.size > 1000;
        rows = mappings.empty ? [] : await tx.getAll(...mappings.docs.slice(0, 1000).map(d => ref(`tenants/${link.tenantId}/customRequests/${d.id}`)));
      }
      const matches = rows.filter(d => d.exists).filter(d => {
        const r = d.data()!;
        return !query || matchesRequestQuery(queryText, [d.id, r.title, r.customerName, r.code, r.requestNumber && 'ORC-' + r.requestNumber].filter(v => typeof v === 'string'));
      });
      return { candidates: matches.slice(0, 20).map(d => ({ id: d.id, title: d.data()!.title || "Pedido sem título", customerName: d.data()!.customerName || "", status: d.data()!.status })), truncated: truncated || matches.length > 20 };
    });
  }
  app.post(
    "/api/assistant/draft",
    publicRoute(async (req, res, key) => {
      const body = fields(req.body, ["message", "attachments", "guided", "conversation", "requestId", "operationId"]);
      const message = text(body.message, 4000);
      const ids = attachments(body.attachments ?? []);
      if (body.guided !== undefined && typeof body.guided !== "boolean") fail(422, "Modo inválido.");
      if (body.conversation !== undefined && typeof body.conversation !== "boolean") fail(422, "Modo inválido.");
      if (body.requestId !== undefined && (!body.conversation || !validId(body.requestId))) fail(422, "Pedido inválido.");
      if (body.operationId !== undefined && !operationId(body.operationId)) fail(422, 'Identificador de envio inválido.');
      if (body.conversation && !body.requestId) {
        const summary = salesSummary(message);
        if (summary) {
          const workflow = await db!.runTransaction(async tx => {
            const link = await access(tx, key); await ownedFiles(tx,key,ids); return link.workflowUpdates;
          });
          return res.json({ draft:summary.draft, initialStage:workflow ? summary.stage : undefined, transcript:'',
            message:'Preparei um novo pedido com os dados da mensagem. Confira antes de cadastrar.' });
        }
      }
      if (body.conversation && !body.guided && body.operationId) {
        const receipt = await productionReceipt(key, body, message, ids);
        if (receipt) return res.json(receipt);
      }
      const fallback = (notice: string) => res.json(body.conversation && !body.guided
        ? { draft: null, action: { intent: "clarify" }, mode: "guided", transcript: "", message: "Não consegui interpretar esta mensagem. Use a lista para consultar ou complementar um pedido, ou marque Novo pedido manual para cadastrar. " + notice }
        : { draft: suggestIntake(message), mode: "guided", transcript: "", message: notice });
      // Selected context is always authorized before sending any data to the provider.
      if (body.requestId) await db!.runTransaction(async tx => {
        const link = await access(tx, key);
        if (!link.sharedRequests && !(await tx.get(ref(`assistantLinks/${key}/requests/${body.requestId}`))).exists) fail(404, "Pedido não encontrado.");
        if (!(await tx.get(ref(`tenants/${link.tenantId}/customRequests/${body.requestId}`))).exists) fail(404, "Pedido não encontrado.");
      });
      if (body.conversation && !body.guided && body.operationId) {
        const updated = await applyProductionMessage(key, body, message, ids);
        if (updated) return res.json(updated);
      }
      if (body.requestId && !body.guided && !ids.length && priceFromOrderMessage(message)) {
        return res.json({ draft: null, selectedRequestId: body.requestId, action: { intent: 'quotePrice', note: message },
          message: 'Identifiquei um valor de orçamento para o pedido aberto. Confira o total antes de salvar.' });
      }
      if (body.requestId && !body.guided && !ids.length && !requestCodes(message).length && message.length <= 2000 &&
          /^(?:adicion(?:ar|e|a)|acrescent(?:ar|e|a)|inclu(?:ir|a|i)|anot(?:ar|e|a)|observação\s*:|complemento\s*:)\s+\S/i.test(message) && !message.includes('?')) {
        return res.json({ draft: null, selectedRequestId: body.requestId, action: { intent: 'update', note: message },
          message: 'Confira o complemento do pedido aberto. O valor do orçamento não muda.' });
      }
      if (body.conversation && !body.guided && !ids.length && quoteTiersFromMessage(message)) {
        const codes = requestCodes(message);
        if (codes.length > 1 || (!codes.length && !body.requestId)) return res.json({ draft: null, mode: 'guided', message: 'Informe um único código ORC junto com as faixas de preço.' });
        const found = await findConversationRequests(key, codes.length ? 'ORC-' + codes[0] : '', body.requestId);
        const selected = found.candidates.length === 1 && !found.truncated ? found.candidates[0] : null;
        if (body.requestId && selected?.id !== body.requestId) return res.json({ draft: null, mode: 'guided', message: 'O código da mensagem não corresponde ao pedido aberto. Confira o pedido.' });
        return res.json({ draft: null, action: { intent: 'quoteTiers', note: message }, ...found, selectedRequestId: selected?.id,
          message: selected ? 'Confira os valores por unidade e a quantidade no próprio pedido.' : found.candidates.length ? 'Escolha o pedido para conferir os preços.' : 'Não encontrei o pedido indicado. Confira o código.' });
      }
      // A code by itself selects a request; this read does not need a model or consume AI quota.
      if (body.conversation && !body.guided && /^orc\s*[-#]?\s*\d+[.!]?$/i.test(message)) {
        await db!.runTransaction(async tx => { await access(tx, key); await ownedFiles(tx, key, ids); });
        const found = await findConversationRequests(key, message);
        const selectedRequestId = found.candidates.length === 1 && !found.truncated ? found.candidates[0].id : undefined;
        return res.json({ draft: null, action: { intent: 'lookup', query: message }, ...found, selectedRequestId,
          message: selectedRequestId ? (ids.length ? 'Pedido localizado. A imagem está pronta para anexar; escolha abaixo como deseja usá-la.' : 'Pedido localizado. Pode continuar falando sobre ele.') : found.candidates.length ? 'Encontrei mais de um pedido. Escolha abaixo.' : 'Não encontrei esse pedido. Confira o código.' });
      }
      // Check ownership even when the fallback is selected.
      const enabled = await db!.runTransaction(async tx => { const link = await access(tx, key); await ownedFiles(tx, key, ids); return aiEnabled(link.tenantId); });
      if (!enabled || body.guided) return fallback("Confira título, cliente e quantidade. Modo guiado: imagens e áudios ficam anexados para análise da equipe.");
      if (aiBusy.has(key)) fail(429, "Já existe uma interpretação em andamento neste acesso.");
      aiBusy.add(key);
      try {
        const context = await db!.runTransaction(async tx => {
          const link = await access(tx, key);
          const metas = [];
          for (const id of ids) metas.push((await tx.get(ref(`tenants/${link.tenantId}/assets/${id}`))).data());
          return { link, metas };
        });
        if (context.metas.some(m => !m) || context.metas.reduce((n, m) => n + m!.size, 0) > AI_MAX_BYTES)
          return fallback("IA não utilizada: os anexos excedem 8 MiB no total. Preencha a conferência manualmente; os anexos serão preservados.");
        const audios = context.metas.filter(m => m!.mime.startsWith("audio/"));
        if (audios.length > 1 || audios.some(m => m!.mime === "audio/ogg"))
          return fallback("IA não utilizada: envie um áudio MP3, M4A, WAV ou WebM por pedido. OGG e áudios adicionais ficam disponíveis para a equipe ouvir.");
        const aiFiles: AiFile[] = [];
        for (const meta of context.metas) {
          if (!store) fail(503, "Armazenamento indisponível.");
          const bytes = await store!.get(meta!.path);
          if (bytes.length !== meta!.size || hash(bytes) !== meta!.sha256) fail(503, "Anexo não confirmado.");
          aiFiles.push({ name: meta!.name, mime: meta!.mime, data: bytes.toString("base64") });
        }
        const day = new Date().toISOString().slice(0, 10);
        await db!.runTransaction(async tx => {
          const link = await access(tx, key), quotaRef = ref(`assistantAiQuotas/${hash(link.tenantId)}`);
          const tenantQuota = (await tx.get(quotaRef)).data();
          const linkCount = link.aiDay === day ? link.aiCount || 0 : 0;
          const tenantCount = tenantQuota?.day === day ? tenantQuota.count || 0 : 0;
          if (linkCount >= 30 || tenantCount >= 300) fail(429, "Limite diário de IA atingido. Use o preenchimento manual.");
          tx.update(ref(`assistantLinks/${key}`), { aiDay: day, aiCount: linkCount + 1 });
          tx.set(quotaRef, { day, count: tenantCount + 1 });
        });
        let result;
        try {
          result = await ai.interpret({ message, attachments: aiFiles, ...(body.conversation ? { conversation: true, selectedRequest: !!body.requestId } : {}) }, async () => {
            await db!.runTransaction(tx => access(tx, key));
          });
        } catch {
          // Revocation must never turn into a successful fallback response.
          await db!.runTransaction(tx => access(tx, key));
          return fallback("A IA não concluiu a interpretação. Confira manualmente; seu texto e anexos continuam disponíveis. Nenhum pedido foi cadastrado.");
        }
        // Revalidate access independently of the adapter, including test/alternate adapters.
        await db!.runTransaction(tx => access(tx, key));
        if (body.conversation && result.action?.intent === 'approve') {
          if (!body.operationId || result.warnings.length || result.action.question) return res.json({ draft: null, action: { intent: 'clarify' }, transcript: result.transcript,
            message: result.action.question || result.warnings.join(' ') || 'Reenvie a aprovação pelo formulário atualizado para registrar com segurança.' });
          const updated = await applyProductionMessage(key, body, message, ids, result.action, result.transcript);
          if (updated) return res.json(updated);
          return res.json({ draft: null, action: { intent: 'clarify' }, transcript: result.transcript, message: 'Informe o código ou nome do cliente, ou selecione o orçamento que deseja aprovar.' });
        }
        if (body.conversation && result.action?.intent !== "create") {
          const action = result.action;
          if (!action || action.intent === "clarify" || (!action.query && !body.requestId))
            return res.json({ draft: null, action: { intent: "clarify" }, transcript: result.transcript, message: action?.question || "Informe o nome do cliente ou código do pedido e o que deseja consultar ou acrescentar." });
          const found = await findConversationRequests(key, action.query, body.requestId);
          return res.json({ draft: null, action, ...found, selectedRequestId: found.candidates.length === 1 && !found.truncated ? found.candidates[0].id : undefined, transcript: result.transcript,
            message: found.candidates.length === 1 && !found.truncated ? (action.intent === 'update' ? 'Confira a atualização abaixo antes de salvar no pedido.' : 'Pedido localizado. Pode continuar falando sobre ele.') : found.candidates.length ? (action.intent === "update" ? "Escolha o pedido e confira o complemento antes de registrar. Quantidade, preço e status não são alterados por este envio." : "Escolha o pedido para ver os dados atuais do LabLayer.") + (found.truncated ? " Exibindo resultados parciais; use a lista para localizar os demais." : "") : found.truncated ? "A busca foi parcial. Use a lista de pedidos para continuar a consulta." : "Não encontrei um pedido com essa referência. Confira o nome ou código; nenhum novo pedido foi criado." });
        }
        res.json({ ...result, mode: "ai", message: "Sugestão da IA: confira todos os dados antes de cadastrar. " + result.warnings.join(" ") });
      } finally { aiBusy.delete(key); }
    }),
  );
  async function ownedFiles(tx: Transaction, key: string, ids: string[]) {
    const result = [];
    for (const id of ids) {
      const value = (
        await tx.get(ref(`assistantLinks/${key}/assets/${id}`))
      ).data();
      if (!value)
        fail(422, "Anexo não pertence a este acesso ou não foi concluído.");
      result.push({ id, name: value.name, mime: value.mime });
    }
    return result;
  }
  app.post(
    "/api/assistant/requests",
    publicRoute(async (req, res, key) => {
      const body = fields(req.body, [
        "operationId",
        "intake",
        "initialStage",
        "message",
        "attachments",
      ]);
      if (!operationId(body.operationId))
        fail(422, "Identificador do envio inválido.");
      let intake;
      try {
        intake = validateIntake(body.intake);
      } catch (e) {
        fail(422, (e as Error).message);
      }
      const stage = body.initialStage === undefined ? undefined : fields(body.initialStage, ['status','deliveryDate','quotedPrice','gift']);
      if (stage && (typeof stage.status !== 'string' || !Object.hasOwn(assistantStatuses, stage.status) || stage.status === 'aguardando-orcamento')) fail(422, 'Etapa inicial inválida.');
      const message = text(body.message, 4000),
        ids = attachments(body.attachments),
        fingerprint = hash(JSON.stringify({ intake, message, ids, stage }));
      const requestId = `bot-${hash(`${key}:${body.operationId}`).slice(0, 32)}`;
      await db!.runTransaction(async (tx) => {
        const link = await access(tx, key),
          mapping = ref(`assistantLinks/${key}/requests/${requestId}`),
          previous = await tx.get(mapping);
        if (stage && !link.workflowUpdates) fail(403, 'Este acesso não permite escolher a etapa do pedido.');
        if (previous.exists) {
          if (previous.data()?.fingerprint !== fingerprint)
            fail(409, "Este envio já foi utilizado com outros dados.");
          return;
        }
        const control = (
          await tx.get(ref(`tenants/${link.tenantId}/inventoryControl/state`))
        ).data();
        if (control && control.phase !== "legacy")
          fail(
            409,
            "A empresa migrou o fluxo de orçamentos. O assistente precisa ser conectado ao novo fluxo antes de receber novos pedidos.",
          );
        const files = await ownedFiles(tx, key, ids),
          now = new Date().toISOString();
        let initialPatch = {};
        if (stage) {
          try {
            const financial = stage.status === 'orcado' || stage.status === 'fila-producao';
            if (financial && intake.provisionalQuantity) throw Error('Confirme a quantidade do pedido.');
            initialPatch = assistantStatusUpdate({status:'aguardando-orcamento',requestedQuantity:intake.quantity}, stage.status, stage.deliveryDate, now,
              { ...(financial ? { quantity:intake.quantity } : {}), quotedPrice:stage.quotedPrice, gift:stage.gift }).patch;
          } catch (e) { fail(422,(e as Error).message); }
        }
        const numbering = await nextAssistantNumber(db!, tx, link.tenantId);
        const description = `${intake.description}\n\nRecebido pelo assistente · vendedor: ${link.name}.${intake.provisionalQuantity ? " Quantidade provisória: 1 unidade; confirmar com o cliente." : ""}`;
        tx.create(ref(`tenants/${link.tenantId}/customRequests/${requestId}`), {
          title: intake.title,
          code: numbering.code,
          requestNumber: numbering.number,
          type: "orcamento",
          status: "aguardando-orcamento",
          ...initialPatch,
          sourceChannel: "manual",
          customerName: intake.customerName,
          customerPhone: "",
          description,
          sourceMessage: message,
          requestedQuantity: intake.quantity,
          productionTimeHours: 0,
          printerId: "",
          filaments: [],
          referenceImageUrl: files.find((f) => f.mime.startsWith("image/"))
            ? `asset:${files.find((f) => f.mime.startsWith("image/"))!.id}`
            : "",
          createdAt: now,
          updatedAt: now,
        });
        tx.set(numbering.counter, { lastNumber: numbering.number, updatedAt: now });
        tx.create(mapping, {
          ...intake,
          message,
          attachments: files,
          fingerprint,
          createdAt: now,
        });
        tx.create(
          ref(`tenants/${link.tenantId}/assistantRequests/${requestId}`),
          {
            linkId: key,
            seller: link.name,
            attachments: files,
            provisionalQuantity: intake.provisionalQuantity,
            createdAt: now,
          },
        );
        if (stage) tx.create(ref(`tenants/${link.tenantId}/assistantRequests/${requestId}/notes/initial`), {
          kind:'workflow-update', seller:link.name, linkId:key, createdAt:now, attachments:[],
          message:`Pedido cadastrado na etapa ${assistantStatuses[stage.status]}.${stage.gift ? ' Presente, sem cobrança.' : ''}`
        });
        consume(tx, key, link, "requests", 1);
        audit(
          tx,
          link.tenantId,
          `assistant:${key}`,
          "assistant.request-created",
          requestId,
        );
      });
      res.json({
        id: requestId,
        message:
          stage ? `Pedido cadastrado como ${assistantStatuses[stage.status]}.` : "Solicitação cadastrada no LabLayer. A equipe fará os cálculos e preparará o orçamento.",
      });
    }),
  );
  app.post('/api/assistant/requests/:requestId/status', publicRoute(async (req, res, key) => {
    const requestId = req.params.requestId as string;
    const body = fields(req.body, ['operationId', 'status', 'expectedStatus', 'expectedUpdatedAt', 'deliveryDate', 'quantity', 'quotedPrice', 'tierMessage', 'quoteMessage', 'workflowMessage', 'paid', 'priceBasis', 'gift']);
    if (!validId(requestId) || !operationId(body.operationId) || typeof body.status !== 'string' || !Object.hasOwn(assistantStatuses, body.status)
      || typeof body.expectedStatus !== 'string' || !Object.hasOwn(assistantStatuses, body.expectedStatus)
      || !(body.expectedUpdatedAt === null || (typeof body.expectedUpdatedAt === 'string' && body.expectedUpdatedAt.length <= 40))) fail(422, 'Atualização de status inválida.');
    const fingerprint = hash(JSON.stringify({ requestId, status: body.status, expectedStatus: body.expectedStatus, expectedUpdatedAt: body.expectedUpdatedAt, deliveryDate: body.deliveryDate ?? null, quantity: body.quantity, quotedPrice: body.quotedPrice, tierMessage: body.tierMessage, quoteMessage: body.quoteMessage, workflowMessage: body.workflowMessage, paid: body.paid, priceBasis: body.priceBasis, gift: body.gift }));
    const result = await db!.runTransaction(async tx => {
      const link = await access(tx, key);
      if (!link.workflowUpdates) fail(403, 'Atualização de status pelo bot não está habilitada nesta empresa.');
      const mapping = await tx.get(ref(`assistantLinks/${key}/requests/${requestId}`));
      const requestRef = ref(`tenants/${link.tenantId}/customRequests/${requestId}`);
      const snapshot = await tx.get(requestRef);
      if ((!link.sharedRequests && !mapping.exists) || !snapshot.exists) fail(404, 'Pedido não encontrado neste acesso.');
      const receiptRef = ref(`assistantLinks/${key}/statusUpdates/${body.operationId}`);
      const receipt = await tx.get(receiptRef);
      const row = snapshot.data()!;
      if (receipt.exists) {
        if (receipt.data()!.fingerprint !== fingerprint) fail(409, 'Envio já utilizado com outros dados.');
        // A delayed retry must not put an older status back into the interface.
        return { ...receipt.data()!.result, request: { ...orderSummary(row), ...(body.tierMessage ? { customerQuote: publicCustomerQuote(row.customerQuote) } : {}), status: row.status } };
      }
      const phase = await tx.get(ref(`tenants/${link.tenantId}/inventoryControl/state`));
      if (phase.exists && phase.data()?.phase !== 'legacy') fail(409, 'Esta empresa usa o fluxo novo. Atualize pelo módulo de pedidos.');
      if (row.status !== body.expectedStatus || (row.updatedAt || null) !== body.expectedUpdatedAt) fail(409, 'O pedido mudou desde que você abriu a tela. Recarregue os pedidos antes de atualizar o status.');
      const notes = await tx.get(db!.collection(`tenants/${link.tenantId}/assistantRequests/${requestId}/notes`).limit(101));
      if (notes.size >= 100) fail(409, 'Limite de 100 atualizações atingido.');
      const now = new Date().toISOString();
      const workflowMessage = body.workflowMessage === undefined ? '' : text(body.workflowMessage, 2000);
      if (workflowMessage && body.status !== 'fila-producao') fail(422, 'A mensagem de aprovação só pode acompanhar a entrada na fila de produção.');
      if (body.paid !== undefined && (typeof body.paid !== 'boolean' || (body.paid && (body.status !== 'fila-producao' || !workflowMessage)))) fail(422, 'Confirme o pagamento junto com a aprovação para a fila.');
      const infoRef = ref(`tenants/${link.tenantId}/assistantRequests/${requestId}`);
      const provisional = ['orcado','fila-producao'].includes(body.status) && (await tx.get(infoRef)).get('provisionalQuantity') === true;
      let update;
      const options = body.tierMessage === undefined ? null : quoteTiersFromMessage(body.tierMessage);
      const tiers = options ? { name: String(row.title || 'Orçamento').slice(0, 150), size: '', options } : null;
      if (body.tierMessage !== undefined && (!tiers || row.customerQuote?.options?.length || body.status !== 'orcado' ||
        !['aguardando-orcamento', 'orcado'].includes(row.status) || !options?.some(o => o.quantity === body.quantity) ||
        (requestCodes(body.tierMessage).length && !matchesRequestQuery(body.tierMessage, [requestId, row.code, row.title, row.requestNumber && 'ORC-' + row.requestNumber].filter(Boolean))))) fail(409, 'Confira o pedido e suas opções de preço antes de salvar as faixas.');
      const price = priceFromOrderMessage(body.quoteMessage);
      if (body.quoteMessage !== undefined || body.priceBasis !== undefined) {
        if (!price || body.tierMessage !== undefined || body.status !== 'orcado' || !['aguardando-orcamento','orcado'].includes(row.status) ||
            !['unit','total'].includes(body.priceBasis) || !Number.isInteger(body.quantity) ||
            body.quotedPrice !== Math.round(price.amount * 100) * (body.priceBasis === 'unit' ? body.quantity : 1) / 100)
          fail(422, 'Confira a quantidade e o valor informado no orçamento.');
      }
      try {
        update = assistantStatusUpdate({ ...row, ...(provisional ? { provisionalQuantity: true } : {}), ...(tiers ? { customerQuote: tiers } : {}), ...(tiers || price ? { status: 'aguardando-orcamento' } : {}) }, body.status, body.deliveryDate, now, body);
        if ((tiers || price) && row.status === 'orcado') update.changes = update.changes.filter(c => c.field !== 'status');
      } catch (e) { fail(409, (e as Error).message); }
      if (body.paid === true) {
        update.patch.paidAt = row.paidAt || now;
        if (!row.paidAt) update.changes.push({ field: 'paidAt', before: '', after: now });
      }
      const noteId = `status-${hash(`${key}:${body.operationId}`)}`;
      const note = { id: noteId, message: price ? body.quoteMessage : tiers ? formatCustomerQuote(tiers) : workflowMessage || `Status atualizado: ${assistantStatuses[row.status]} → ${assistantStatuses[body.status]}.`, seller: link.name,
        createdAt: now, kind: 'workflow-update', changes: update!.changes, attachments: [], paymentReported: body.paid === true };
      const result = { message: price ? 'Valor do orçamento e mensagem salvos no pedido.' : tiers ? 'Faixas de preço salvas no orçamento.' : 'Status atualizado com sucesso.', request: { ...orderSummary({ ...row, ...update!.patch }), ...(tiers ? { customerQuote: tiers } : {}), status: body.status }, note };
      tx.update(requestRef, update!.patch);
      if (tiers) tx.update(requestRef, { customerQuote: tiers });
      if (provisional) tx.update(infoRef, { provisionalQuantity: false });
      const { id: _id, ...storedNote } = note;
      tx.create(ref(`tenants/${link.tenantId}/assistantRequests/${requestId}/notes/${noteId}`), { ...storedNote, linkId: key, fingerprint });
      tx.create(receiptRef, { fingerprint, result, createdAt: now });
      audit(tx, link.tenantId, `assistant:${key}`, 'assistant.status-updated', requestId);
      return result;
    });
    res.json(result);
  }));
  app.post(
    "/api/assistant/requests/:requestId/notes",
    publicRoute(async (req, res, key) => {
      const requestId = req.params.requestId as string,
        body = fields(req.body, ["operationId", "message", "attachments"]);
      if (!validId(requestId) || !operationId(body.operationId))
        fail(422, "Identificador inválido.");
      const message = text(body.message, 2000),
        ids = attachments(body.attachments),
        fingerprint = hash(JSON.stringify({ message, ids }));
      await db!.runTransaction(async (tx) => {
        const link = await access(tx, key),
          mapping = (
            await tx.get(ref(`assistantLinks/${key}/requests/${requestId}`))
          ).data();
        const existing = await tx.get(
          ref(`tenants/${link.tenantId}/customRequests/${requestId}`),
        );
        if ((!link.sharedRequests && !mapping) || !existing.exists)
          fail(404, "Solicitação não encontrada neste acesso.");
        const noteRef = ref(
            `tenants/${link.tenantId}/assistantRequests/${requestId}/notes/${body.operationId}`,
          ),
          prev = await tx.get(noteRef);
        if (prev.exists) {
          if (prev.data()?.fingerprint !== fingerprint)
            fail(409, "Envio já utilizado com outros dados.");
          return;
        }
        const files = await ownedFiles(tx, key, ids);
        const notes = await tx.get(
          db!
            .collection(
              `tenants/${link.tenantId}/assistantRequests/${requestId}/notes`,
            )
            .limit(101),
        );
        if (notes.size >= 100)
          fail(409, "Limite de 100 complementos atingido.");
        tx.create(noteRef, {
          message,
          attachments: files,
          seller: link.name,
          linkId: key,
          createdAt: new Date().toISOString(),
          fingerprint,
        });
        audit(
          tx,
          link.tenantId,
          `assistant:${key}`,
          "assistant.note-added",
          requestId,
        );
      });
      res.json({
        message:
          "Complemento salvo com os anexos. A equipe poderá consultá-lo no orçamento.",
      });
    }),
  );
  async function detail(tx: Transaction, tenant: string, requestId: string) {
    const [infoSnapshot, notes] = await Promise.all([
      tx.get(ref(`tenants/${tenant}/assistantRequests/${requestId}`)),
      tx.get(db!.collection(`tenants/${tenant}/assistantRequests/${requestId}/notes`).orderBy("createdAt").limit(100)),
    ]);
    const info = infoSnapshot.data();
    return {
      seller: info?.seller || (notes.empty ? "" : "Equipe"),
      provisionalQuantity: info?.provisionalQuantity || false,
      attachments: info?.attachments || [],
      notes: notes.docs.map((d) => ({
        id: d.id,
        message: d.data().message,
        seller: d.data().seller || "Equipe",
        attachments: d.data().attachments,
        createdAt: d.data().createdAt,
        kind: d.data().kind || 'note',
        changes: d.data().changes || [],
        paymentReported: d.data().paymentReported === true,
        personalization: d.data().personalization || [],
      })),
    };
  }
  app.get(
    "/api/assistant/requests/:requestId",
    publicRoute(async (req, res, key) => {
      const requestId = req.params.requestId as string;
      if (!validId(requestId)) fail(422, "Solicitação inválida.");
      res.json(
        await db!.runTransaction(async (tx) => {
          const link = await access(tx, key);
          const mapping = link.sharedRequests ? null : (
            await tx.get(ref(`assistantLinks/${key}/requests/${requestId}`))
          ).data();
          if (!link.sharedRequests && !mapping) fail(404, "Solicitação não encontrada neste acesso.");
          const [rowSnapshot, info] = await Promise.all([
            tx.get(ref(`tenants/${link.tenantId}/customRequests/${requestId}`)),
            detail(tx, link.tenantId, requestId),
          ]);
          const row = rowSnapshot.data();
          if (!row) fail(404, "Solicitação não disponível.");
          // Only managed images referenced by this request are exposed, never arbitrary URLs.
          const referenceIds = (link.sharedRequests ? [row.referenceImageUrl, row.quoteMediaImageUrl] : [])
            .filter((v): v is string => typeof v === "string" && /^asset:[a-f0-9]{64}$/.test(v))
            .map(v => v.slice(6));
          const files = [...info.attachments];
          const missing = [...new Set(referenceIds)].filter(id => !files.some(f => f.id === id));
          if (missing.length) {
            const metas = await tx.getAll(...missing.map(id => ref(`tenants/${link.tenantId}/assets/${id}`)));
            metas.forEach((snapshot, i) => { const meta = snapshot.data(); if (meta) files.push({ id: missing[i], name: meta.name, mime: meta.mime }); });
          }
          return {
            id: requestId,
            title: link.sharedRequests ? row.title || "Pedido sem título" : mapping.title,
            description: link.sharedRequests ? row.description || "" : mapping.description,
            customerName: link.sharedRequests ? row.customerName || "" : mapping.customerName,
            quantity: link.sharedRequests || link.workflowUpdates ? row.requestedQuantity ?? mapping?.quantity ?? 1 : mapping.quantity,
            ...(!link.sharedRequests && link.workflowUpdates ? { ...orderSummary(row), customerQuote: publicCustomerQuote(row.customerQuote) } : {}),
            status: row.status,
            code: row.code || null,
            requestNumber: row.requestNumber || null,
            updatedAt: row.updatedAt || null,
            createdAt: row.createdAt || null,
            ...(link.sharedRequests ? { ...orderSummary(row), quoteImageId: assetId(row.quoteMediaImageUrl || row.referenceImageUrl || ""), customerQuote: publicCustomerQuote(row.customerQuote) } : {}),
            ...info, attachments: files,
          };
        }, { readOnly: true }),
      );
    }),
  );
  app.get(
    "/api/tenants/:tenantId/assistant-requests/:requestId",
    admin(async (req, res, id) => {
      const tenant = req.params.tenantId as string,
        requestId = req.params.requestId as string;
      if (!validId(requestId)) fail(422, "Solicitação inválida.");
      res.json(
        await db!.runTransaction(async (tx) => {
          await member(tx, tenant, id);
          return detail(tx, tenant, requestId);
        }),
      );
    }),
  );
  app.post(
    "/api/assistant/assets",
    publicRoute(async (req, res, key) => {
      // Authenticate before reading the binary body to bound unauthenticated work.
      await new Promise<void>((resolve, reject) =>
        express.raw({ type: "application/octet-stream", limit: "10mb" })(
          req,
          res,
          (e) =>
            e
              ? reject(new BusinessError(413, "Arquivo maior que 10 MiB."))
              : resolve(),
        ),
      );
      if (!store) fail(503, "Armazenamento indisponível.");
      if (!Buffer.isBuffer(req.body)) fail(422, "Conteúdo binário necessário.");
      let meta;
      try {
        meta = inspectAssistantFile(
          req.body,
          decodeURIComponent(String(req.headers["x-file-name"] || "")),
          String(req.headers["x-file-type"] || ""),
        );
      } catch (e) {
        fail(422, (e as Error).message);
      }
      const id = hash(JSON.stringify(meta));
      const link = await db!.runTransaction(async (tx) => {
        const current = await access(tx, key);
        const prev = await tx.get(ref(`assistantLinks/${key}/assets/${id}`));
        if (!prev.exists) consume(tx, key, current, "bytes", meta.size);
        return current;
      });
      const path = `tenants/${link.tenantId}/managed-assets/${id}`;
      await store.put(path, req.body, meta.mime);
      await db!.runTransaction(async (tx) => {
        await access(tx, key);
        tx.set(
          ref(`tenants/${link.tenantId}/assets/${id}`),
          {
            ...meta,
            path,
            actorUid: `assistant:${key}`,
            createdAt: new Date().toISOString(),
          },
          { merge: true },
        );
        tx.set(ref(`assistantLinks/${key}/assets/${id}`), meta);
      });
      res.json({ id, name: meta.name, mime: meta.mime });
    }),
  );
  app.get(
    "/api/assistant/assets/:id",
    publicRoute(async (req, res, key) => {
      const id = req.params.id as string;
      if (!safeKey(id)) fail(422, "Arquivo inválido.");
      if (!store) fail(503, "Armazenamento indisponível.");
      if (req.query.preview !== undefined && req.query.preview !== 'true') fail(422, 'Prévia inválida.');
      const meta = await db!.runTransaction(async (tx) => {
        const link = await access(tx, key);
        const [owned, metadata] = await tx.getAll(ref(`assistantLinks/${key}/assets/${id}`), ref(`tenants/${link.tenantId}/assets/${id}`));
        if (!owned.exists) {
          const requestId = req.query.requestId;
          if (!link.sharedRequests || !validId(requestId)) fail(404, "Arquivo não encontrado neste acesso.");
          const row = (await tx.get(ref(`tenants/${link.tenantId}/customRequests/${requestId}`))).data();
          if (!row) fail(404, "Solicitação não disponível.");
          if (![row.referenceImageUrl, row.quoteMediaImageUrl].includes(`asset:${id}`)) {
            const info = await detail(tx, link.tenantId, requestId as string);
            const references = [...info.attachments, ...info.notes.flatMap(n => n.attachments || [])];
            if (!references.some(f => f.id === id)) fail(404, "Arquivo não vinculado ao pedido.");
          }
        }
        return metadata.data();
      }, { readOnly: true });
      if (!meta) fail(404, "Arquivo indisponível.");
      const loadOriginal = async () => {
        const bytes = await store.get(meta.path);
        if (bytes.length !== meta.size || hash(bytes) !== meta.sha256) fail(503, "Arquivo não confirmado.");
        return bytes;
      };
      const output = req.query.preview === 'true' && ['image/png', 'image/jpeg', 'image/webp'].includes(meta.mime)
        ? await imagePreview(`${meta.path}:${meta.sha256}`, meta.mime, loadOriginal)
        : { bytes: await loadOriginal(), mime: meta.mime };
      res.set({
        "Content-Type": output.mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      });
      res.send(output.bytes);
    }),
  );
}
