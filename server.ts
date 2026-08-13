import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const WooCommerceRestApi = (WooCommerceRestApiModule as unknown as { default?: typeof WooCommerceRestApiModule }).default || WooCommerceRestApiModule;
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "ai-studio-914d19ee-caef-46d9-9cf8-561cc915d716";
const FIREBASE_SERVICE_ACCOUNT_FILE = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || path.join(process.cwd(), "firebase-service-account.json");

// Inicializa Firebase Admin apenas uma vez
if (!getApps().length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      initializeApp({
        credential: cert(serviceAccount)
      });
      console.log("Firebase Admin inicializado com sucesso.");
    } else if (fs.existsSync(FIREBASE_SERVICE_ACCOUNT_FILE)) {
      const serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_SERVICE_ACCOUNT_FILE, "utf8"));
      initializeApp({
        credential: cert(serviceAccount)
      });
      console.log("Firebase Admin inicializado com sucesso via arquivo.");
    } else {
      console.warn("Aviso: credenciais Firebase Admin não encontradas no ambiente ou arquivo.");
    }
  } catch (err) {
    console.error("Erro ao inicializar Firebase Admin:", err);
  }
}
const db = getApps().length ? getFirestore(getApps()[0], FIRESTORE_DATABASE_ID) : null;

// Inicializa API do WooCommerce
const hasWooCommerceCredentials = Boolean(
  process.env.WOOCOMMERCE_URL &&
  process.env.WOOCOMMERCE_CONSUMER_KEY &&
  process.env.WOOCOMMERCE_CONSUMER_SECRET,
);

const wooCommerce = hasWooCommerceCredentials
  ? new WooCommerceRestApi({
      url: process.env.WOOCOMMERCE_URL,
      consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
      version: 'wc/v3',
      queryStringAuth: true
    })
  : null;

const ADMIN_API_COLLECTIONS = new Set([
  "products",
  "filaments",
  "printers",
  "supplies",
  "orders",
  "transactions",
  "marketplaces",
  "productionOrders",
  "customRequests",
  "losses",
  "suppliers",
  "inventoryMovements",
  "failures",
  "settings",
]);

const extractBearerToken = (authorizationHeader?: string) => {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return "";
  }

  return authorizationHeader.slice("Bearer ".length).trim();
};

const parsePositiveLimit = (rawLimit: unknown, fallback = 100, max = 500) => {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
};

const normalizeComparableValue = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const matchesSearchTerm = (value: unknown, term: string) =>
  normalizeComparableValue(value).includes(normalizeComparableValue(term));

const isValidAdminCollection = (collectionName: string) => ADMIN_API_COLLECTIONS.has(collectionName);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const buildTenantCollectionPath = (tenantId: string, collectionName: string) =>
  `tenants/${tenantId}/${collectionName}`;

const normalizeAdminPayload = (
  payload: Record<string, unknown>,
  {
    preserveCreatedAt = false,
  }: { preserveCreatedAt?: boolean } = {},
) => {
  const normalizedPayload = { ...payload };

  if (!preserveCreatedAt && normalizedPayload.createdAt == null) {
    normalizedPayload.createdAt = new Date().toISOString();
  }

  normalizedPayload.updatedAt = new Date().toISOString();

  return normalizedPayload;
};

const normalizeCustomRequestPayload = (payload: Record<string, unknown>) => {
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : "";

  const descriptionCandidates = [
    payload.description,
    payload.observation,
    payload.observacao,
    payload.notes,
  ];

  const description =
    descriptionCandidates.find((value) => typeof value === "string" && value.trim())?.toString().trim() || "";

  const filaments = Array.isArray(payload.filaments)
    ? payload.filaments
    : [];

  return {
    ...payload,
    title,
    description,
    type: payload.type === "encomenda" ? "encomenda" : "orcamento",
    status: typeof payload.status === "string" && payload.status.trim() ? payload.status : "aguardando-orcamento",
    sourceChannel: payload.sourceChannel === "whatsapp" ? "whatsapp" : "manual",
    customerName: typeof payload.customerName === "string" ? payload.customerName.trim() : "",
    customerPhone: typeof payload.customerPhone === "string" ? payload.customerPhone.trim() : "",
    sourceMessage: typeof payload.sourceMessage === "string" ? payload.sourceMessage.trim() : "",
    requestedQuantity: Math.max(1, Number(payload.requestedQuantity) || 1),
    productionTimeHours: Math.max(0, Number(payload.productionTimeHours) || 0),
    printerId: typeof payload.printerId === "string" ? payload.printerId.trim() : "",
    filaments,
    referenceImageUrl: typeof payload.referenceImageUrl === "string" ? payload.referenceImageUrl : "",
    quoteMediaImageUrl: typeof payload.quoteMediaImageUrl === "string" ? payload.quoteMediaImageUrl : "",
    quoteMediaUrl: typeof payload.quoteMediaUrl === "string" ? payload.quoteMediaUrl.trim() : "",
    estimatedUnitCost: Math.max(0, Number(payload.estimatedUnitCost) || 0),
    suggestedUnitPrice: Math.max(0, Number(payload.suggestedUnitPrice) || 0),
    quotedPrice: Math.max(0, Number(payload.quotedPrice) || 0),
  };
};

const normalizeCollectionPayload = (collectionName: string, payload: Record<string, unknown>) => {
  if (collectionName === "customRequests") {
    return normalizeCustomRequestPayload(payload);
  }

  return payload;
};

const filterCollectionItems = (
  collectionName: string,
  items: Array<Record<string, unknown>>,
  query: express.Request["query"],
) => {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const name = typeof query.name === "string" ? query.name.trim() : "";
  const color = typeof query.color === "string" ? query.color.trim() : "";
  const title = typeof query.title === "string" ? query.title.trim() : "";

  return items.filter((item) => {
    if (q) {
      const haystackByCollection: Record<string, unknown[]> = {
        products: [item.name, item.baseSku, item.category, item.status],
        filaments: [item.color, item.brand, item.material, item.lineType, item.store],
        customRequests: [item.title, item.description, item.customerName, item.sourceMessage, item.status],
      };

      const haystack = haystackByCollection[collectionName] || Object.values(item);
      if (!haystack.some((value) => matchesSearchTerm(value, q))) {
        return false;
      }
    }

    if (collectionName === "products" && name && !matchesSearchTerm(item.name, name)) {
      return false;
    }

    if (collectionName === "filaments" && color && !matchesSearchTerm(item.color, color)) {
      return false;
    }

    if (collectionName === "customRequests" && title && !matchesSearchTerm(item.title, title)) {
      return false;
    }

    return true;
  });
};

const isEqualValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const buildChangedFields = (
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
) => {
  const changedKeys = new Set([
    ...Object.keys(previousValue),
    ...Object.keys(nextValue),
  ]);

  return Array.from(changedKeys).reduce<Record<string, { before: unknown; after: unknown }>>((acc, key) => {
    const before = previousValue[key];
    const after = nextValue[key];

    if (!isEqualValue(before, after)) {
      acc[key] = {
        before: before === undefined ? null : before,
        after: after === undefined ? null : after,
      };
    }

    return acc;
  }, {});
};

const resolveActor = (req: express.Request) => {
  const actorHeader = req.headers["x-lablayer-admin-actor"];
  if (typeof actorHeader === "string" && actorHeader.trim()) {
    return actorHeader.trim();
  }

  return "api-token";
};

const writeAuditLog = async ({
  tenantId,
  actor,
  action,
  collectionName,
  docId,
  changedFields,
}: {
  tenantId: string;
  actor: string;
  action: "create" | "update" | "delete";
  collectionName: string;
  docId: string;
  changedFields: Record<string, { before: unknown; after: unknown }>;
}) => {
  if (!db || Object.keys(changedFields).length === 0) {
    return;
  }

  await db.collection(buildTenantCollectionPath(tenantId, "auditLogs")).add({
    actor,
    action,
    collectionName,
    docId,
    changedFields,
    createdAt: new Date().toISOString(),
  });
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const whatsappIngestToken = process.env.WHATSAPP_INGEST_TOKEN?.trim();
  const adminApiToken = process.env.ADMIN_API_TOKEN?.trim();

  app.disable("x-powered-by");
  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const requireAdminApiToken: express.RequestHandler = (req, res, next) => {
    const providedToken =
      (typeof req.headers["x-lablayer-admin-token"] === "string" ? req.headers["x-lablayer-admin-token"] : "") ||
      extractBearerToken(typeof req.headers.authorization === "string" ? req.headers.authorization : undefined);

    if (!adminApiToken) {
      return res.status(503).json({ error: "ADMIN_API_TOKEN não configurado." });
    }

    if (!providedToken || providedToken !== adminApiToken) {
      return res.status(401).json({ error: "Token administrativo inválido." });
    }

    next();
  };

  app.get("/api/admin/health", requireAdminApiToken, (req, res) => {
    res.json({
      status: "ok",
      service: "lablayer-admin-api",
      databaseAvailable: Boolean(db),
      collections: Array.from(ADMIN_API_COLLECTIONS),
      auditCollection: "auditLogs",
    });
  });

  app.get("/api/admin/tenants/:tenantId", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId } = req.params;

      if (!tenantId) {
        return res.status(400).json({ error: "tenantId é obrigatório." });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      const tenantDoc = await db.doc(`tenants/${tenantId}`).get();

      if (!tenantDoc.exists) {
        return res.status(404).json({ error: "Tenant não encontrado." });
      }

      return res.json({
        id: tenantDoc.id,
        ...tenantDoc.data(),
      });
    } catch (error) {
      console.error("Erro ao carregar tenant pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao carregar tenant." });
    }
  });

  app.get("/api/admin/tenants/:tenantId/export", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId } = req.params;
      const requestedCollections = String(req.query.collections || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const collectionsToFetch = requestedCollections.length > 0
        ? requestedCollections
        : Array.from(ADMIN_API_COLLECTIONS);
      const invalidCollections = collectionsToFetch.filter((item) => !ADMIN_API_COLLECTIONS.has(item));
      const limit = parsePositiveLimit(req.query.limit, 100, 500);

      if (!tenantId) {
        return res.status(400).json({ error: "tenantId é obrigatório." });
      }

      if (invalidCollections.length > 0) {
        return res.status(400).json({
          error: "Coleções inválidas informadas.",
          invalidCollections,
          allowedCollections: Array.from(ADMIN_API_COLLECTIONS),
        });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      const exportPayload = await Promise.all(
        collectionsToFetch.map(async (collectionName) => {
          const snapshot = await db.collection(`tenants/${tenantId}/${collectionName}`).limit(limit).get();

          return [
            collectionName,
            snapshot.docs.map((docSnapshot) => ({
              id: docSnapshot.id,
              ...docSnapshot.data(),
            })),
          ] as const;
        }),
      );

      return res.json({
        tenantId,
        exportedAt: new Date().toISOString(),
        limit,
        collections: Object.fromEntries(exportPayload),
      });
    } catch (error) {
      console.error("Erro ao exportar dados pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao exportar dados." });
    }
  });

  app.get("/api/admin/tenants/:tenantId/audit-logs", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId } = req.params;
      const limit = parsePositiveLimit(req.query.limit, 100, 500);

      if (!tenantId) {
        return res.status(400).json({ error: "tenantId é obrigatório." });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      const snapshot = await db
        .collection(buildTenantCollectionPath(tenantId, "auditLogs"))
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      return res.json({
        tenantId,
        collection: "auditLogs",
        count: snapshot.size,
        items: snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        })),
      });
    } catch (error) {
      console.error("Erro ao listar histórico da API admin:", error);
      return res.status(500).json({ error: "Erro interno ao listar histórico." });
    }
  });

  app.get("/api/admin/tenants/:tenantId/:collectionName", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId, collectionName } = req.params;
      const limit = parsePositiveLimit(req.query.limit, 100, 500);

      if (!tenantId) {
        return res.status(400).json({ error: "tenantId é obrigatório." });
      }

      if (!isValidAdminCollection(collectionName)) {
        return res.status(400).json({
          error: "Coleção não permitida.",
          allowedCollections: Array.from(ADMIN_API_COLLECTIONS),
        });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      const snapshot = await db.collection(buildTenantCollectionPath(tenantId, collectionName)).limit(limit).get();
      const items = snapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ...docSnapshot.data(),
      }));
      const filteredItems = filterCollectionItems(collectionName, items, req.query);

      return res.json({
        tenantId,
        collection: collectionName,
        count: filteredItems.length,
        items: filteredItems,
      });
    } catch (error) {
      console.error("Erro ao listar coleção pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao listar coleção." });
    }
  });

  app.get("/api/admin/tenants/:tenantId/:collectionName/:docId", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId, collectionName, docId } = req.params;

      if (!tenantId || !docId) {
        return res.status(400).json({ error: "tenantId e docId são obrigatórios." });
      }

      if (!isValidAdminCollection(collectionName)) {
        return res.status(400).json({
          error: "Coleção não permitida.",
          allowedCollections: Array.from(ADMIN_API_COLLECTIONS),
        });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      const docSnapshot = await db.doc(`${buildTenantCollectionPath(tenantId, collectionName)}/${docId}`).get();

      if (!docSnapshot.exists) {
        return res.status(404).json({ error: "Documento não encontrado." });
      }

      return res.json({
        id: docSnapshot.id,
        ...docSnapshot.data(),
      });
    } catch (error) {
      console.error("Erro ao carregar documento pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao carregar documento." });
    }
  });

  app.post("/api/admin/tenants/:tenantId/:collectionName", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId, collectionName } = req.params;
      const actor = resolveActor(req);
      const requestedId = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      const rawPayload = isPlainObject(req.body) ? req.body : null;

      if (!tenantId) {
        return res.status(400).json({ error: "tenantId é obrigatório." });
      }

      if (!isValidAdminCollection(collectionName)) {
        return res.status(400).json({
          error: "Coleção não permitida.",
          allowedCollections: Array.from(ADMIN_API_COLLECTIONS),
        });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      if (!rawPayload) {
        return res.status(400).json({ error: "O body deve ser um objeto JSON válido." });
      }

      const { id: _ignoredId, ...payloadWithoutId } = rawPayload;
      const collectionPayload = normalizeCollectionPayload(collectionName, payloadWithoutId);
      const normalizedPayload = normalizeAdminPayload(collectionPayload);
      const collectionPath = buildTenantCollectionPath(tenantId, collectionName);

      if (requestedId) {
        await db.doc(`${collectionPath}/${requestedId}`).set(normalizedPayload, { merge: false });
        await writeAuditLog({
          tenantId,
          actor,
          action: "create",
          collectionName,
          docId: requestedId,
          changedFields: buildChangedFields({}, normalizedPayload),
        });
        return res.status(201).json({
          success: true,
          tenantId,
          collection: collectionName,
          id: requestedId,
          item: {
            id: requestedId,
            ...normalizedPayload,
          },
        });
      }

      const docRef = await db.collection(collectionPath).add(normalizedPayload);
      await writeAuditLog({
        tenantId,
        actor,
        action: "create",
        collectionName,
        docId: docRef.id,
        changedFields: buildChangedFields({}, normalizedPayload),
      });
      return res.status(201).json({
        success: true,
        tenantId,
        collection: collectionName,
        id: docRef.id,
        item: {
          id: docRef.id,
          ...normalizedPayload,
        },
      });
    } catch (error) {
      console.error("Erro ao criar documento pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao criar documento." });
    }
  });

  app.put("/api/admin/tenants/:tenantId/:collectionName/:docId", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId, collectionName, docId } = req.params;
      const actor = resolveActor(req);
      const rawPayload = isPlainObject(req.body) ? req.body : null;

      if (!tenantId || !docId) {
        return res.status(400).json({ error: "tenantId e docId são obrigatórios." });
      }

      if (!isValidAdminCollection(collectionName)) {
        return res.status(400).json({
          error: "Coleção não permitida.",
          allowedCollections: Array.from(ADMIN_API_COLLECTIONS),
        });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      if (!rawPayload) {
        return res.status(400).json({ error: "O body deve ser um objeto JSON válido." });
      }

      const docPath = `${buildTenantCollectionPath(tenantId, collectionName)}/${docId}`;
      const currentDoc = await db.doc(docPath).get();

      if (!currentDoc.exists) {
        return res.status(404).json({ error: "Documento não encontrado." });
      }

      const { id: _ignoredId, ...payloadWithoutId } = rawPayload;
      const currentData = (currentDoc.data() ?? {}) as Record<string, unknown>;
      const normalizedPayload = normalizeAdminPayload(payloadWithoutId, {
        preserveCreatedAt: Boolean(payloadWithoutId.createdAt ?? currentData.createdAt),
      });

      if (normalizedPayload.createdAt == null && currentData.createdAt != null) {
        normalizedPayload.createdAt = currentData.createdAt;
      }

      await db.doc(docPath).set(normalizedPayload, { merge: false });
      await writeAuditLog({
        tenantId,
        actor,
        action: "update",
        collectionName,
        docId,
        changedFields: buildChangedFields(currentData, normalizedPayload),
      });

      return res.json({
        success: true,
        tenantId,
        collection: collectionName,
        id: docId,
        item: {
          id: docId,
          ...normalizedPayload,
        },
      });
    } catch (error) {
      console.error("Erro ao substituir documento pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao substituir documento." });
    }
  });

  app.patch("/api/admin/tenants/:tenantId/:collectionName/:docId", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId, collectionName, docId } = req.params;
      const actor = resolveActor(req);
      const rawPayload = isPlainObject(req.body) ? req.body : null;

      if (!tenantId || !docId) {
        return res.status(400).json({ error: "tenantId e docId são obrigatórios." });
      }

      if (!isValidAdminCollection(collectionName)) {
        return res.status(400).json({
          error: "Coleção não permitida.",
          allowedCollections: Array.from(ADMIN_API_COLLECTIONS),
        });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      if (!rawPayload) {
        return res.status(400).json({ error: "O body deve ser um objeto JSON válido." });
      }

      const docPath = `${buildTenantCollectionPath(tenantId, collectionName)}/${docId}`;
      const currentDoc = await db.doc(docPath).get();

      if (!currentDoc.exists) {
        return res.status(404).json({ error: "Documento não encontrado." });
      }

      const { id: _ignoredId, ...payloadWithoutId } = rawPayload;
      const currentData = (currentDoc.data() ?? {}) as Record<string, unknown>;
      const mergedPayload = normalizeAdminPayload(payloadWithoutId, {
        preserveCreatedAt: true,
      });

      await db.doc(docPath).set(mergedPayload, { merge: true });

      const updatedDoc = await db.doc(docPath).get();
      const updatedData = (updatedDoc.data() ?? {}) as Record<string, unknown>;
      await writeAuditLog({
        tenantId,
        actor,
        action: "update",
        collectionName,
        docId,
        changedFields: buildChangedFields(currentData, updatedData),
      });

      return res.json({
        success: true,
        tenantId,
        collection: collectionName,
        id: docId,
        item: {
          id: updatedDoc.id,
          ...updatedDoc.data(),
        },
      });
    } catch (error) {
      console.error("Erro ao atualizar documento pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao atualizar documento." });
    }
  });

  app.delete("/api/admin/tenants/:tenantId/:collectionName/:docId", requireAdminApiToken, async (req, res) => {
    try {
      const { tenantId, collectionName, docId } = req.params;
      const actor = resolveActor(req);

      if (!tenantId || !docId) {
        return res.status(400).json({ error: "tenantId e docId são obrigatórios." });
      }

      if (!isValidAdminCollection(collectionName)) {
        return res.status(400).json({
          error: "Coleção não permitida.",
          allowedCollections: Array.from(ADMIN_API_COLLECTIONS),
        });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      const docPath = `${buildTenantCollectionPath(tenantId, collectionName)}/${docId}`;
      const currentDoc = await db.doc(docPath).get();

      if (!currentDoc.exists) {
        return res.status(404).json({ error: "Documento não encontrado." });
      }

      const currentData = (currentDoc.data() ?? {}) as Record<string, unknown>;
      await db.doc(docPath).delete();
      await writeAuditLog({
        tenantId,
        actor,
        action: "delete",
        collectionName,
        docId,
        changedFields: buildChangedFields(currentData, {}),
      });

      return res.json({
        success: true,
        tenantId,
        collection: collectionName,
        id: docId,
        deleted: true,
      });
    } catch (error) {
      console.error("Erro ao excluir documento pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao excluir documento." });
    }
  });

  app.post("/api/public/tenants/:tenantId/custom-requests/whatsapp", async (req, res) => {
    try {
      const { tenantId } = req.params;
      const providedToken =
        (typeof req.headers["x-lablayer-webhook-token"] === "string" ? req.headers["x-lablayer-webhook-token"] : "") ||
        (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
          ? req.headers.authorization.slice("Bearer ".length)
          : "");

      if (!tenantId) {
        return res.status(400).json({ error: "tenantId é obrigatório." });
      }

      if (whatsappIngestToken && providedToken !== whatsappIngestToken) {
        return res.status(401).json({ error: "Token do webhook inválido." });
      }

      if (!db) {
        return res.status(503).json({ error: "Banco de dados não disponível." });
      }

      const {
        title,
        type,
        status,
        customerName,
        customerPhone,
        sourceMessage,
        description,
        requestedQuantity,
        productionTimeHours,
        quotedPrice,
        referenceImageUrl,
        quoteMediaUrl,
      } = req.body ?? {};

      const safeTitle = typeof title === "string" && title.trim().length > 0
        ? title.trim()
        : `Solicitação WhatsApp ${typeof customerName === "string" && customerName.trim() ? `- ${customerName.trim()}` : ''}`.trim();

      const safeDescription = typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : typeof sourceMessage === "string"
          ? sourceMessage.trim()
          : "";

      const payload = {
        title: safeTitle,
        type: type === "encomenda" ? "encomenda" : "orcamento",
        status: status || "aguardando-orcamento",
        sourceChannel: "whatsapp",
        customerName: typeof customerName === "string" ? customerName.trim() : "",
        customerPhone: typeof customerPhone === "string" ? customerPhone.trim() : "",
        sourceMessage: typeof sourceMessage === "string" ? sourceMessage.trim() : "",
        description: safeDescription,
        requestedQuantity: Math.max(1, Number(requestedQuantity) || 1),
        productionTimeHours: Math.max(0, Number(productionTimeHours) || 0),
        printerId: "",
        filaments: [],
        referenceImageUrl: typeof referenceImageUrl === "string" ? referenceImageUrl.trim() : "",
        quoteMediaImageUrl: "",
        quoteMediaUrl: typeof quoteMediaUrl === "string" ? quoteMediaUrl.trim() : "",
        estimatedUnitCost: 0,
        suggestedUnitPrice: 0,
        quotedPrice: Math.max(0, Number(quotedPrice) || 0),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const docRef = await db.collection(`tenants/${tenantId}/customRequests`).add(payload);

      return res.status(201).json({
        success: true,
        id: docRef.id,
        tenantId,
      });
    } catch (error) {
      console.error("Erro ao receber solicitação do WhatsApp:", error);
      return res.status(500).json({ error: "Erro interno ao salvar solicitação do WhatsApp." });
    }
  });

  // ==========================================
  // MERCADO LIVRE OAUTH & API
  // ==========================================
  app.get("/api/integrations/mercadolivre/auth", (req, res) => {
    const clientId = process.env.ML_CLIENT_ID;
    const redirectUri = `${process.env.APP_URL}/api/integrations/mercadolivre/callback`;
    
    if (!clientId) {
      return res.status(500).send("ML_CLIENT_ID não configurado no .env. Configure para iniciar o OAuth.");
    }
    
    const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}`;
    res.redirect(authUrl);
  });

  app.get("/api/integrations/mercadolivre/callback", async (req, res) => {
    const { code } = req.query;
    // Aqui você faria um POST para https://api.mercadolibre.com/oauth/token
    // passando o code, client_id, client_secret e redirect_uri para obter o access_token
    console.log("ML Auth Code recebido:", code);
    res.redirect('/?view=configuracoes&status=ml_success');
  });

  // ==========================================
  // SHOPEE OAUTH & API
  // ==========================================
  app.get("/api/integrations/shopee/auth", (req, res) => {
    const partnerId = process.env.SHOPEE_PARTNER_ID;
    const partnerKey = process.env.SHOPEE_PARTNER_KEY;
    
    if (!partnerId || !partnerKey) {
      return res.status(500).send("SHOPEE_PARTNER_ID ou SHOPEE_PARTNER_KEY não configurados no .env.");
    }

    // A Shopee exige geração de assinatura (HMAC-SHA256) com timestamp
    // Redirecionamento para a página de autorização da Shopee Open Platform
    const redirectUrl = `${process.env.APP_URL}/api/integrations/shopee/callback`;
    res.send(`Redirecionando para Shopee Auth (Simulação). Callback: ${redirectUrl}`);
  });

  // ==========================================
  // SHOPIFY & WOOCOMMERCE
  // ==========================================
  // Estas plataformas geralmente usam tokens fixos (Admin API) ou chaves geradas no painel
  // Os endpoints abaixo serviriam para receber webhooks de novos pedidos
  
  app.post("/api/webhooks/shopify/orders/create", (req, res) => {
    console.log("Novo pedido Shopify recebido:", req.body);
    res.status(200).send("OK");
  });

  // Webhook: WooCommerce -> LabLayer (Receber Pedidos)
  app.post("/api/webhooks/woocommerce/orders/create", async (req, res) => {
    try {
      const orderId = req.body.id;
      if (!orderId) {
        return res.status(400).send("ID do pedido não encontrado no payload.");
      }
      
      console.log(`Novo pedido WooCommerce recebido: #${orderId}`);

      if (!db) {
        console.error("Banco de dados Firestore não inicializado (Admin).");
        return res.status(500).send("Banco de dados não disponível.");
      }

      // Salva o pedido no Firestore na coleção "integrations_woo_orders"
      await db.collection("integrations_woo_orders").doc(String(orderId)).set({
        ...req.body,
        lablayer_synced_at: FieldValue.serverTimestamp()
      }, { merge: true });

      res.status(200).send("OK");
    } catch (error) {
      console.error("Erro ao processar webhook WooCommerce:", error);
      res.status(500).send("Erro interno ao salvar pedido.");
    }
  });

  // API: LabLayer -> WooCommerce (Enviar Produtos)
  app.post("/api/integrations/woocommerce/sync-product", async (req, res) => {
    try {
      if (!wooCommerce) {
        return res.status(503).json({
          error: "Integração WooCommerce não configurada.",
        });
      }

      const { name, regular_price, description, images } = req.body;

      // Validação básica
      if (!name || !regular_price) {
        return res.status(400).json({ error: "Campos obrigatórios: name, regular_price." });
      }

      const productData = {
        name,
        type: "simple",
        regular_price: String(regular_price),
        description: description || "",
        images: images || [], // Formato experado pelo woo: [{ src: "url_da_imagem" }]
      };

      // Realiza a requisição para criar/atualizar no WooCommerce
      const response = await wooCommerce.post("products", productData);
      
      res.json({ 
        success: true, 
        woo_product_id: response.data.id,
        message: "Produto sincronizado com sucesso no WooCommerce!" 
      });

    } catch (error: any) {
      console.error("Erro ao sincronizar produto Woo:", error.response?.data || error.message);
      res.status(500).json({ 
        error: "Erro ao comunicar com a API do WooCommerce.",
        details: error.response?.data || error.message
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
