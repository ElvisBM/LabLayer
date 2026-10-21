import express, { type Express, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
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
export function registerAssistantRoutes(
  app: Express,
  db: Firestore | null,
  verify: (t: string) => Promise<DecodedIdToken>,
  store: AssetStore | null,
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
    return { ...link, companyName: company.companyName || "LabLayer" };
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
        await db!.runTransaction((tx) => access(tx, key));
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
    publicRoute(async (_req, res, key) => {
      const result = await db!.runTransaction(async (tx) => {
        const link = await access(tx, key);
        const mappings = await tx.get(
          db!
            .collection(`assistantLinks/${key}/requests`)
            .orderBy("createdAt", "desc")
            .limit(100),
        );
        const rows = mappings.empty
          ? []
          : await tx.getAll(
              ...mappings.docs.map((d) =>
                ref(`tenants/${link.tenantId}/customRequests/${d.id}`),
              ),
            );
        return {
          seller: link.name,
          company: link.companyName,
          mode: "guided",
          requests: mappings.docs.flatMap((d, i) =>
            rows[i].exists
              ? [
                  {
                    id: d.id,
                    title: d.data().title,
                    customerName: d.data().customerName,
                    quantity: d.data().quantity,
                    createdAt: d.data().createdAt,
                    status: rows[i].data()?.status,
                  },
                ]
              : [],
          ),
        };
      });
      res.json(result);
    }),
  );
  app.post(
    "/api/assistant/draft",
    publicRoute(async (req, res, _key) => {
      const message = text(fields(req.body, ["message"]).message, 4000);
      res.json({
        draft: suggestIntake(message),
        message:
          "Confira o título, o cliente e a quantidade antes de cadastrar. O texto completo será preservado. Áudios e imagens ficam anexados para análise da equipe.",
      });
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
      const message = text(body.message, 4000),
        ids = attachments(body.attachments),
        fingerprint = hash(JSON.stringify({ intake, message, ids }));
      const requestId = `bot-${hash(`${key}:${body.operationId}`).slice(0, 32)}`;
      await db!.runTransaction(async (tx) => {
        const link = await access(tx, key),
          mapping = ref(`assistantLinks/${key}/requests/${requestId}`),
          previous = await tx.get(mapping);
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
        const description = `${intake.description}\n\nRecebido pelo assistente · vendedor: ${link.name}.${intake.provisionalQuantity ? " Quantidade provisória: 1 unidade; confirmar com o cliente." : ""}`;
        tx.create(ref(`tenants/${link.tenantId}/customRequests/${requestId}`), {
          title: intake.title,
          type: "orcamento",
          status: "aguardando-orcamento",
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
          "Solicitação cadastrada no LabLayer. A equipe fará os cálculos e preparará o orçamento.",
      });
    }),
  );
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
        if (!mapping || !existing.exists)
          fail(404, "Solicitação não encontrada neste link.");
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
    const info = (
      await tx.get(ref(`tenants/${tenant}/assistantRequests/${requestId}`))
    ).data();
    if (!info) return { attachments: [], notes: [] };
    const notes = await tx.get(
      db!
        .collection(`tenants/${tenant}/assistantRequests/${requestId}/notes`)
        .orderBy("createdAt")
        .limit(100),
    );
    return {
      seller: info.seller,
      provisionalQuantity: info.provisionalQuantity,
      attachments: info.attachments,
      notes: notes.docs.map((d) => ({
        id: d.id,
        message: d.data().message,
        attachments: d.data().attachments,
        createdAt: d.data().createdAt,
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
          const mapping = (
            await tx.get(ref(`assistantLinks/${key}/requests/${requestId}`))
          ).data();
          if (!mapping) fail(404, "Solicitação não encontrada neste link.");
          const row = (
            await tx.get(
              ref(`tenants/${link.tenantId}/customRequests/${requestId}`),
            )
          ).data();
          if (!row) fail(404, "Solicitação não disponível.");
          return {
            id: requestId,
            title: mapping.title,
            description: mapping.description,
            customerName: mapping.customerName,
            quantity: mapping.quantity,
            status: row.status,
            ...(await detail(tx, link.tenantId, requestId)),
          };
        }),
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
      const meta = await db!.runTransaction(async (tx) => {
        const link = await access(tx, key);
        const owned = await tx.get(ref(`assistantLinks/${key}/assets/${id}`));
        if (!owned.exists) fail(404, "Arquivo não encontrado neste link.");
        return (
          await tx.get(ref(`tenants/${link.tenantId}/assets/${id}`))
        ).data();
      });
      if (!meta) fail(404, "Arquivo indisponível.");
      const bytes = await store.get(meta.path);
      if (bytes.length !== meta.size || hash(bytes) !== meta.sha256)
        fail(503, "Arquivo não confirmado.");
      res.set({
        "Content-Type": meta.mime,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      });
      res.send(bytes);
    }),
  );
}
