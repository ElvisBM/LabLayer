import { registerInventoryRoutes } from './server/inventory';
import { registerQuoteRoutes } from './server/quotes';
import { registerFinanceRoutes } from './server/finance';
import { registerCatalogRoutes } from './server/catalog';
import { registerPricingRoutes } from './server/pricing';
import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { fileURLToPath } from "node:url";
import { registerSessionRoute, validId } from "./server/session";
import { normalizeCustomRequest, validateDocument } from "./server/admin-contract";
import { registerAdminWrites } from "./server/admin-writes";
import { registerWhatsAppIngress } from "./server/whatsapp";
import { DEFAULT_PRICING_SETTINGS, calculateVariationUnitCostBreakdown, normalizePricingSettings, suggestedPrice } from "./src/utils/pricing";

import { registerAssetRoutes, type AssetStore } from './server/assets';

export type AppOptions = {
  assetStore?: AssetStore | null;
  database?: Firestore | null;
  verifyIdToken?: (token: string) => Promise<DecodedIdToken>;
  env?: NodeJS.ProcessEnv;
  serveFrontend?: boolean;
};

// Importing the module never reads credentials, starts a server or opens a database.
export async function createApp(options: AppOptions = {}) {
const env = options.env ?? process.env;
const FIRESTORE_DATABASE_ID = env.FIRESTORE_DATABASE_ID || "ai-studio-914d19ee-caef-46d9-9cf8-561cc915d716";
const FIREBASE_SERVICE_ACCOUNT_FILE = env.FIREBASE_SERVICE_ACCOUNT_FILE || path.join(process.cwd(), "firebase-service-account.json");
const FIREBASE_STORAGE_BUCKET = env.FIREBASE_STORAGE_BUCKET?.trim() || "";
const ADMIN_API_DOCS_PATH = path.join(process.cwd(), "docs", "admin-api.md");
let resolvedFirebaseStorageBucket = FIREBASE_STORAGE_BUCKET;

type ScopedApiKey = {
  id: string;
  tokenHash: string;
  tenantId: string;
  actor: string;
  active?: boolean;
  scopes?: string[];
};

const hashApiToken = (token: string) => createHash("sha256").update(token).digest("hex");

const parseScopedApiKeys = (rawValue?: string): ScopedApiKey[] => {
  if (!rawValue?.trim()) {
    return [];
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter((item): item is ScopedApiKey =>
      isPlainObject(item) &&
      typeof item.id === "string" &&
      typeof item.tokenHash === "string" &&
      validId(item.tenantId) &&
      typeof item.actor === "string" && item.actor.length > 0 &&
      /^[a-f0-9]{64}$/i.test(item.tokenHash) &&
      (item.scopes === undefined || (Array.isArray(item.scopes) && item.scopes.every(scope => typeof scope === "string"))),
    );
  } catch (error) {
    console.error("LABLAYER_API_KEYS_JSON inválido:", error);
    return [];
  }
};

// Inicializa Firebase Admin apenas uma vez
if (options.database === undefined && !getApps().length) {
  try {
    if (env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      if (!resolvedFirebaseStorageBucket && serviceAccount?.project_id) {
        resolvedFirebaseStorageBucket = `${serviceAccount.project_id}.firebasestorage.app`;
      }
      initializeApp({
        credential: cert(serviceAccount),
        storageBucket: resolvedFirebaseStorageBucket || undefined,
      });
      console.log("Firebase Admin inicializado com sucesso.");
    } else if (fs.existsSync(FIREBASE_SERVICE_ACCOUNT_FILE)) {
      const serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_SERVICE_ACCOUNT_FILE, "utf8"));
      if (!resolvedFirebaseStorageBucket && serviceAccount?.project_id) {
        resolvedFirebaseStorageBucket = `${serviceAccount.project_id}.firebasestorage.app`;
      }
      initializeApp({
        credential: cert(serviceAccount),
        storageBucket: resolvedFirebaseStorageBucket || undefined,
      });
      console.log("Firebase Admin inicializado com sucesso via arquivo.");
    } else {
      console.warn("Aviso: credenciais Firebase Admin não encontradas no ambiente ou arquivo.");
    }
  } catch (err) {
    console.error("Erro ao inicializar Firebase Admin:", err);
  }
}
const db = options.database !== undefined ? options.database : (getApps().length ? getFirestore(getApps()[0], FIRESTORE_DATABASE_ID) : null);
const storageBucket = options.database === undefined && getApps().length
  ? getStorage(getApps()[0]).bucket(resolvedFirebaseStorageBucket || undefined)
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

  return Math.max(1, Math.min(Math.floor(parsed), max));
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

type ProductPricingContext = {
  filaments: Array<Record<string, unknown> & { id: string }>;
  supplies: Array<Record<string, unknown> & { id: string }>;
  printers: Array<Record<string, unknown> & { id: string }>;
  energyPrice: number;
  pricingSettings: ReturnType<typeof normalizePricingSettings>;
};

const buildTenantCollectionPath = (tenantId: string, collectionName: string) =>
  `tenants/${tenantId}/${collectionName}`;

const normalizeCustomRequestPayload = (payload: Record<string, unknown>, mode: 'create' | 'patch' = 'create') => normalizeCustomRequest(payload, mode);
const normalizeCollectionPayload = (collectionName: string, payload: Record<string, unknown>, mode: 'create' | 'patch') =>
  collectionName === 'customRequests' ? normalizeCustomRequestPayload(payload, mode) : payload;

const IMAGE_DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s;

const getImageExtensionFromMimeType = (mimeType: string) => {
  const subtype = mimeType.split("/")[1] || "png";
  if (subtype === "jpeg") return "jpg";
  if (subtype.includes("svg")) return "svg";
  if (subtype.includes("webp")) return "webp";
  if (subtype.includes("gif")) return "gif";
  return subtype.replace(/[^a-z0-9]/gi, "") || "png";
};

const uploadDataUrlImage = async ({
  tenantId,
  docId,
  fieldName,
  dataUrl,
}: {
  tenantId: string;
  docId: string;
  fieldName: "referenceImageUrl" | "quoteMediaImageUrl";
  dataUrl: string;
}) => {
  const trimmedValue = dataUrl.trim();
  const matches = trimmedValue.match(IMAGE_DATA_URL_PATTERN);

  if (!matches) {
    return trimmedValue;
  }

  if (!storageBucket) {
    return trimmedValue;
  }

  const [, mimeType, base64Content] = matches;
  const fileExtension = getImageExtensionFromMimeType(mimeType);
  const filePath = `tenants/${tenantId}/customRequests/${docId}/${fieldName}-${Date.now()}.${fileExtension}`;
  const downloadToken = randomUUID();

  await storageBucket.file(filePath).save(Buffer.from(base64Content, "base64"), {
    resumable: false,
    metadata: {
      contentType: mimeType,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket.name)}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
};

const resolveCustomRequestImageField = async ({
  tenantId,
  docId,
  fieldName,
  payload,
}: {
  tenantId: string;
  docId: string;
  fieldName: "referenceImageUrl" | "quoteMediaImageUrl";
  payload: Record<string, unknown>;
}) => {
  const fieldAliases = fieldName === "referenceImageUrl"
    ? ["referenceImageBase64", "referenceImageDataUrl", "referenceImageUrl"]
    : ["quoteMediaImageBase64", "quoteMediaImageDataUrl", "quoteMediaImageUrl"];

  const incomingValue = fieldAliases.find((alias) => typeof payload[alias] === "string");

  if (!incomingValue) {
    return undefined;
  }

  const value = String(payload[incomingValue] ?? "").trim();
  if (!value) {
    return "";
  }

  return uploadDataUrlImage({
    tenantId,
    docId,
    fieldName,
    dataUrl: value,
  });
};

const prepareCollectionPayload = async ({
  tenantId,
  docId,
  collectionName,
  payload,
  mode = 'create',
}: {
  tenantId: string;
  docId: string;
  collectionName: string;
  payload: Record<string, unknown>;
  mode?: 'create' | 'patch';
}) => {
  const normalizedPayload = normalizeCollectionPayload(collectionName, payload, mode);
  if (collectionName === 'customRequests') {
    const validation = mode === 'patch'
      ? normalizeCustomRequest({ title: 'Validação parcial', ...normalizedPayload }, 'create')
      : normalizedPayload;
    validateDocument(collectionName, docId, validation);
  }

  if (collectionName !== "customRequests") {
    return normalizedPayload;
  }

  const [referenceImageUrl, quoteMediaImageUrl] = await Promise.all([
    resolveCustomRequestImageField({ tenantId, docId, fieldName: "referenceImageUrl", payload: normalizedPayload }),
    resolveCustomRequestImageField({ tenantId, docId, fieldName: "quoteMediaImageUrl", payload: normalizedPayload }),
  ]);

  const preparedPayload = {
    ...normalizedPayload,
    ...(referenceImageUrl !== undefined ? { referenceImageUrl } : {}),
    ...(quoteMediaImageUrl !== undefined ? { quoteMediaImageUrl } : {}),
  } as Record<string, unknown>;

  const {
    referenceImageBase64: _referenceImageBase64,
    referenceImageDataUrl: _referenceImageDataUrl,
    quoteMediaImageBase64: _quoteMediaImageBase64,
    quoteMediaImageDataUrl: _quoteMediaImageDataUrl,
    ...preparedPayloadWithoutAliases
  } = preparedPayload;

  return preparedPayloadWithoutAliases;
};

const formatCurrencyRangeLabel = (values: number[]) => {
  if (values.length === 0) return "Nao definido";
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  if (minValue === maxValue) return `R$ ${minValue.toFixed(2)}`;
  return `R$ ${minValue.toFixed(2)} - R$ ${maxValue.toFixed(2)}`;
};

const getSavedProductSalePrices = (product: Record<string, unknown>) => {
  const variations = Array.isArray(product.variations) ? product.variations : [];

  return variations.flatMap((variation) => {
    const channelPrices = isPlainObject(variation) && Array.isArray(variation.channelPrices)
      ? variation.channelPrices
      : [];

    return channelPrices
      .map((channelPrice) => (isPlainObject(channelPrice) ? Number(channelPrice.price) || 0 : 0))
      .filter((price) => price > 0);
  });
};

const calculateProductVariationCost = (
  product: Record<string, unknown>,
  variation: Record<string, unknown>,
  context: ProductPricingContext,
) => {
  return calculateVariationUnitCostBreakdown({
    variation,
    fixedCost: Number(product.fixedCost) || 0,
    filaments: context.filaments,
    supplies: context.supplies,
    supplyUsages: Array.isArray(product.supplyUsages) ? product.supplyUsages : [],
    wastes: Array.isArray(product.wastes) ? product.wastes : [],
    printers: context.printers,
    energyPrice: context.energyPrice,
    pricingSettings: context.pricingSettings,
  });
};

const buildProductComputedPricing = (
  product: Record<string, unknown>,
  context: ProductPricingContext,
) => {
  const variations = (Array.isArray(product.variations) ? product.variations : [])
    .filter((variation): variation is Record<string, unknown> => isPlainObject(variation));

  const breakdowns = variations.map(variation => calculateProductVariationCost(product, variation, context));
  const complete = breakdowns.length > 0 && breakdowns.every(b => b.complete);
  const issues = breakdowns.length ? breakdowns.flatMap(b => b.issues) : ['Ficha sem variação.'];
  const unitCosts = complete ? breakdowns.map(b => Number(b.totalDecimal)) : [];
  const suggestedSalePrices = complete ? breakdowns.map(b => suggestedPrice(b.totalDecimal)) : [];
  const savedSalePrices = getSavedProductSalePrices(product);
  const latestSuggestedPrice = isPlainObject(product.latestSuggestedPrice)
    ? Number(product.latestSuggestedPrice.suggestedPrice) || 0
    : 0;

  const resolvedSalePrices = savedSalePrices.length > 0
    ? savedSalePrices
    : (suggestedSalePrices.length > 0 ? suggestedSalePrices : (latestSuggestedPrice > 0 ? [latestSuggestedPrice] : []));

  const resolvedSalePriceSource = savedSalePrices.length > 0
    ? "saved_price"
    : (suggestedSalePrices.length > 0 ? "automatic_suggestion" : (latestSuggestedPrice > 0 ? "latest_suggested_price" : "unavailable"));

  return {
    calculationVersion: 'legacy-compatible-v2',
    pricingComplete: complete,
    pricingIssues: issues,
    calculatedUnitCost: unitCosts[0] ?? null,
    calculatedUnitCostRange: unitCosts,
    calculatedUnitCostLabel: formatCurrencyRangeLabel(unitCosts),
    calculatedSuggestedSalePrice: suggestedSalePrices[0] ?? null,
    calculatedSuggestedSalePriceRange: suggestedSalePrices,
    calculatedSuggestedSalePriceLabel: formatCurrencyRangeLabel(suggestedSalePrices),
    resolvedSalePrice: resolvedSalePrices[0] ?? 0,
    resolvedSalePriceRange: resolvedSalePrices,
    resolvedSalePriceLabel: formatCurrencyRangeLabel(resolvedSalePrices),
    resolvedSalePriceSource,
    hasSavedSalePrice: savedSalePrices.length > 0,
  };
};

const loadProductPricingContext = async (tenantId: string): Promise<ProductPricingContext> => {
  if (!db) {
    return {
      filaments: [],
      supplies: [],
      printers: [],
      energyPrice: 0.95,
      pricingSettings: DEFAULT_PRICING_SETTINGS,
    };
  }

  const [filamentsSnapshot, suppliesSnapshot, printersSnapshot, printerSettingsSnapshot, pricingSettingsSnapshot] = await Promise.all([
    db.collection(buildTenantCollectionPath(tenantId, "filaments")).get(),
    db.collection(buildTenantCollectionPath(tenantId, "supplies")).get(),
    db.collection(buildTenantCollectionPath(tenantId, "printers")).get(),
    db.doc(`tenants/${tenantId}/settings/printer`).get(),
    db.doc(`tenants/${tenantId}/settings/pricing`).get(),
  ]);

  return {
    filaments: filamentsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })),
    supplies: suppliesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })),
    printers: printersSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })),
    energyPrice: printerSettingsSnapshot.exists ? Number(printerSettingsSnapshot.data()?.energyPrice ?? 0.95) : 0.95,
    pricingSettings: normalizePricingSettings(pricingSettingsSnapshot.exists ? pricingSettingsSnapshot.data() : null),
  };
};

const enrichAdminItem = async (
  tenantId: string,
  collectionName: string,
  item: Record<string, unknown>,
  productPricingContext?: ProductPricingContext,
) => {
  if (collectionName !== "products") {
    return item;
  }

  const context = productPricingContext || await loadProductPricingContext(tenantId);
  return {
    ...item,
    apiComputedPricing: buildProductComputedPricing(item, context),
  };
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

const hasCollectionFilters = (query: express.Request["query"]) => {
  const supportedFilters = [query.q, query.name, query.color, query.title];
  return supportedFilters.some((value) => typeof value === "string" && value.trim().length > 0);
};

  const app = express();
  const adminApiToken = env.ADMIN_API_TOKEN?.trim();
  const scopedApiKeys = parseScopedApiKeys(env.LABLAYER_API_KEYS_JSON);

  app.disable("x-powered-by");
  app.use(express.json());

  registerSessionRoute(app, db, options.verifyIdToken ?? ((token) => getAuth().verifyIdToken(token, true)));
  registerPricingRoutes(app, db, options.verifyIdToken ?? ((token) => getAuth().verifyIdToken(token, true)));
  registerCatalogRoutes(app, db, options.verifyIdToken ?? ((token) => getAuth().verifyIdToken(token, true)));
  registerInventoryRoutes(app, db, options.verifyIdToken ?? ((token) => getAuth().verifyIdToken(token, true)));
  registerQuoteRoutes(app, db, options.verifyIdToken ?? ((token) => getAuth().verifyIdToken(token, true)));
  registerFinanceRoutes(app, db, options.verifyIdToken ?? ((token) => getAuth().verifyIdToken(token, true)));

  const assetStore: AssetStore | null = options.assetStore !== undefined ? options.assetStore : storageBucket ? {
    async put(objectPath, bytes, mime) {
      try { await storageBucket.file(objectPath).save(bytes, {resumable:false, preconditionOpts:{ifGenerationMatch:0}, metadata:{contentType:mime,cacheControl:'private, no-store'}}); }
      catch (error) { if (Number((error as any).code) !== 412) throw error; }
    },
    async get(objectPath) { return (await storageBucket.file(objectPath).download())[0]; },
  } : null;
  registerAssetRoutes(app, db, options.verifyIdToken ?? ((token) => getAuth().verifyIdToken(token, true)), assetStore);

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const requireAdminApiToken: express.RequestHandler = async (req, res, next) => {
    const providedToken =
      (typeof req.headers["x-lablayer-admin-token"] === "string" ? req.headers["x-lablayer-admin-token"] : "") ||
      extractBearerToken(typeof req.headers.authorization === "string" ? req.headers.authorization : undefined);

    if (!adminApiToken && scopedApiKeys.length === 0) {
      return res.status(503).json({ error: "Nenhuma chave da API administrativa está configurada." });
    }

    const scopedKey = providedToken
      ? scopedApiKeys.find((item) => item.active !== false && item.tokenHash === hashApiToken(providedToken))
      : undefined;
    const hasTechnicalAccess = Boolean(providedToken && adminApiToken && timingSafeEqual(Buffer.from(hashApiToken(providedToken)), Buffer.from(hashApiToken(adminApiToken))));

    if (!hasTechnicalAccess && !scopedKey) {
      return res.status(401).json({ error: "Token administrativo inválido." });
    }

    const requestedTenantId = req.params.tenantId;
    if (req.params.docId && !validId(req.params.docId)) return res.status(400).json({ error: 'docId inválido.' });
    if (scopedKey && requestedTenantId && scopedKey.tenantId !== requestedTenantId) {
      return res.status(403).json({ error: "Esta chave não possui acesso ao tenant solicitado." });
    }

    res.locals.apiAccess = scopedKey
      ? { keyId: scopedKey.id, tenantId: scopedKey.tenantId, actor: scopedKey.actor, scopes: scopedKey.scopes ?? [] }
      : { keyId: "technical", tenantId: null, actor: "api-token", scopes: [] };

    if (requestedTenantId) {
      if (!validId(requestedTenantId)) return res.status(400).json({ error: 'tenantId inválido.' });
      if (!db) return res.status(503).json({ error: 'Banco de dados não disponível.' });
      try {
        const tenant = await db.doc(`tenants/${requestedTenantId}`).get();
        if (!tenant.exists) return res.status(404).json({ error: 'Empresa não encontrada.' });
        if (tenant.data()?.status === 'inactive') return res.status(403).json({ error: 'Empresa inativa.' });
      } catch { return res.status(503).json({ error: 'Não foi possível verificar a empresa.' }); }
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

  app.get("/api/admin/docs", requireAdminApiToken, async (req, res) => {
    try {
      const format = typeof req.query.format === "string" ? req.query.format.trim().toLowerCase() : "json";
      const markdown = fs.readFileSync(ADMIN_API_DOCS_PATH, "utf8");

      if (format === "markdown" || format === "md" || format === "text") {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        return res.send(markdown);
      }

      return res.json({
        title: "LabLayer Admin API",
        path: "/api/admin/docs",
        formats: ["json", "markdown"],
        content: markdown,
      });
    } catch (error) {
      console.error("Erro ao carregar documentação da API admin:", error);
      return res.status(500).json({ error: "Erro interno ao carregar documentação." });
    }
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

      let cursors: Record<string, string> = {};
      try {
        const parsed = req.query.cursors ? JSON.parse(String(req.query.cursors)) : {};
        if (!isPlainObject(parsed) || Object.entries(parsed).some(([key, value]) => !collectionsToFetch.includes(key) || !validId(value))) throw Error();
        cursors = parsed as Record<string, string>;
      } catch { return res.status(400).json({ error: 'cursors deve conter IDs válidos por coleção.' }); }
      const nextCursors: Record<string, string> = {};
      const exportPayload = await Promise.all(
        collectionsToFetch.map(async (collectionName) => {
          let pageQuery = db.collection(`tenants/${tenantId}/${collectionName}`).orderBy(FieldPath.documentId()).limit(limit + 1);
          if (cursors[collectionName]) pageQuery = pageQuery.startAfter(cursors[collectionName]);
          const snapshot = await pageQuery.get();
          const page = snapshot.docs.slice(0, limit);
          if (snapshot.size > limit) nextCursors[collectionName] = page.at(-1)!.id;
          return [
            collectionName,
            page.map((docSnapshot) => ({ ...docSnapshot.data(), id: docSnapshot.id })),
          ] as const;
        }),
      );

      return res.json({
        tenantId,
        exportedAt: new Date().toISOString(),
        limit,
        collections: Object.fromEntries(exportPayload),
        nextCursors,
        hasMore: Object.keys(nextCursors).length > 0,
        completeBackup: false,
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
      const shouldFilterBeforeLimit = hasCollectionFilters(req.query);

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

      const snapshot = await db
        .collection(buildTenantCollectionPath(tenantId, collectionName))
        .limit(shouldFilterBeforeLimit ? 5000 : limit)
        .get();
      const items = snapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ...docSnapshot.data(),
      }));
      const filteredItems = filterCollectionItems(collectionName, items, req.query).slice(0, limit);
      const productPricingContext = collectionName === "products"
        ? await loadProductPricingContext(tenantId)
        : undefined;
      const enrichedItems = await Promise.all(
        filteredItems.map((item) => enrichAdminItem(tenantId, collectionName, item, productPricingContext)),
      );

      return res.json({
        tenantId,
        collection: collectionName,
        count: enrichedItems.length,
        items: enrichedItems,
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

      const item = await enrichAdminItem(tenantId, collectionName, {
        id: docSnapshot.id,
        ...docSnapshot.data(),
      });

      return res.json(item);
    } catch (error) {
      console.error("Erro ao carregar documento pela API admin:", error);
      return res.status(500).json({ error: "Erro interno ao carregar documento." });
    }
  });

  registerAdminWrites(app, db, requireAdminApiToken, prepareCollectionPayload);
  registerWhatsAppIngress(app, db, env, scopedApiKeys, prepareCollectionPayload);

  // These legacy routes did not implement authenticated, tenant-scoped workflows.
  app.use(['/api/integrations', '/api/webhooks/shopify', '/api/webhooks/woocommerce'], (_req, res) => {
    res.status(501).json({ error: 'Integração indisponível durante estabilização. Nenhum dado foi sincronizado.' });
  });

  // Vite middleware for development
  if (options.serveFrontend && env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (options.serveFrontend) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp({ serveFrontend: true }).then(app => {
    const port = Number(process.env.PORT) || 3000;
    app.listen(port, "0.0.0.0", () => console.log(`Server running on http://localhost:${port}`));
  }).catch(error => { console.error("Falha ao iniciar servidor:", error); process.exitCode = 1; });
}
