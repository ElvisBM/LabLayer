import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { fileURLToPath } from "node:url";
import { registerSessionRoute } from "./server/session";
import { DEFAULT_PRICING_SETTINGS, calculateVariationUnitCostBreakdown, normalizePricingSettings } from "./src/utils/pricing";

export type AppOptions = {
  database?: Firestore | null;
  verifyIdToken?: (token: string) => Promise<DecodedIdToken>;
  env?: NodeJS.ProcessEnv;
  serveFrontend?: boolean;
};

// Importing the module never reads credentials, starts a server or opens a database.
export async function createApp(options: AppOptions = {}) {
const env = options.env ?? process.env;
const WooCommerceRestApi = (WooCommerceRestApiModule as unknown as { default?: typeof WooCommerceRestApiModule }).default || WooCommerceRestApiModule;
const FIRESTORE_DATABASE_ID = env.FIRESTORE_DATABASE_ID || "ai-studio-914d19ee-caef-46d9-9cf8-561cc915d716";
const FIREBASE_SERVICE_ACCOUNT_FILE = env.FIREBASE_SERVICE_ACCOUNT_FILE || path.join(process.cwd(), "firebase-service-account.json");
const FIREBASE_STORAGE_BUCKET = env.FIREBASE_STORAGE_BUCKET?.trim() || "";
const ADMIN_API_DOCS_PATH = path.join(process.cwd(), "docs", "admin-api.md");
const PRODUCT_SUGGESTED_MARKUP_MULTIPLIER = 2.2;
let resolvedFirebaseStorageBucket = FIREBASE_STORAGE_BUCKET;

type ScopedApiKey = {
  id: string;
  tokenHash: string;
  tenantId: string;
  actor: string;
  active?: boolean;
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
      typeof item.tenantId === "string" &&
      typeof item.actor === "string",
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

// Inicializa API do WooCommerce
const hasWooCommerceCredentials = Boolean(
  env.WOOCOMMERCE_URL &&
  env.WOOCOMMERCE_CONSUMER_KEY &&
  env.WOOCOMMERCE_CONSUMER_SECRET,
);

const wooCommerce = hasWooCommerceCredentials
  ? new WooCommerceRestApi({
      url: env.WOOCOMMERCE_URL,
      consumerKey: env.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: env.WOOCOMMERCE_CONSUMER_SECRET,
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

type ProductPricingContext = {
  filaments: Array<Record<string, unknown> & { id: string }>;
  supplies: Array<Record<string, unknown> & { id: string }>;
  printers: Array<Record<string, unknown> & { id: string }>;
  energyPrice: number;
  pricingSettings: ReturnType<typeof normalizePricingSettings>;
};

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

  const referenceImageInput =
    typeof payload.referenceImageUrl === "string" && payload.referenceImageUrl.trim()
      ? payload.referenceImageUrl.trim()
      : typeof payload.referenceImageBase64 === "string" && payload.referenceImageBase64.trim()
        ? payload.referenceImageBase64.trim()
        : typeof payload.referenceImageDataUrl === "string" && payload.referenceImageDataUrl.trim()
          ? payload.referenceImageDataUrl.trim()
          : "";

  const quoteMediaImageInput =
    typeof payload.quoteMediaImageUrl === "string" && payload.quoteMediaImageUrl.trim()
      ? payload.quoteMediaImageUrl.trim()
      : typeof payload.quoteMediaImageBase64 === "string" && payload.quoteMediaImageBase64.trim()
        ? payload.quoteMediaImageBase64.trim()
        : typeof payload.quoteMediaImageDataUrl === "string" && payload.quoteMediaImageDataUrl.trim()
          ? payload.quoteMediaImageDataUrl.trim()
          : "";

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
    referenceImageUrl: referenceImageInput,
    quoteMediaImageUrl: quoteMediaImageInput,
    quoteMediaUrl: typeof payload.quoteMediaUrl === "string" ? payload.quoteMediaUrl.trim() : "",
    estimatedUnitCost: Math.max(0, Number(payload.estimatedUnitCost) || 0),
    suggestedUnitPrice: Math.max(0, Number(payload.suggestedUnitPrice) || 0),
    quotedPrice: Math.max(0, Number(payload.quotedPrice) || 0),
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt.trim() : undefined,
    quoteSentAt: typeof payload.quoteSentAt === "string" ? payload.quoteSentAt.trim() : "",
    approvedAt: typeof payload.approvedAt === "string" ? payload.approvedAt.trim() : "",
    paidAt: typeof payload.paidAt === "string" ? payload.paidAt.trim() : "",
    startedAt: typeof payload.startedAt === "string" ? payload.startedAt.trim() : "",
    completedAt: typeof payload.completedAt === "string" ? payload.completedAt.trim() : "",
  };
};

const normalizeCollectionPayload = (collectionName: string, payload: Record<string, unknown>) => {
  if (collectionName === "customRequests") {
    return normalizeCustomRequestPayload(payload);
  }

  return payload;
};

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
}: {
  tenantId: string;
  docId: string;
  collectionName: string;
  payload: Record<string, unknown>;
}) => {
  const normalizedPayload = normalizeCollectionPayload(collectionName, payload);

  if (collectionName !== "customRequests") {
    return normalizedPayload;
  }

  const [referenceImageUrl, quoteMediaImageUrl] = await Promise.all([
    resolveCustomRequestImageField({ tenantId, docId, fieldName: "referenceImageUrl", payload }),
    resolveCustomRequestImageField({ tenantId, docId, fieldName: "quoteMediaImageUrl", payload }),
  ]);

  const preparedPayload = {
    ...normalizedPayload,
    referenceImageUrl: referenceImageUrl ?? normalizedPayload.referenceImageUrl,
    quoteMediaImageUrl: quoteMediaImageUrl ?? normalizedPayload.quoteMediaImageUrl,
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
  }).total;
};

const buildProductComputedPricing = (
  product: Record<string, unknown>,
  context: ProductPricingContext,
) => {
  const variations = (Array.isArray(product.variations) ? product.variations : [])
    .filter((variation): variation is Record<string, unknown> => isPlainObject(variation));

  const unitCosts = variations.map((variation) => Number(calculateProductVariationCost(product, variation, context).toFixed(2)));
  const suggestedSalePrices = unitCosts.map((unitCost) => Number((unitCost * PRODUCT_SUGGESTED_MARKUP_MULTIPLIER).toFixed(2)));
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
    calculatedUnitCost: unitCosts[0] ?? (Number(product.fixedCost) || 0),
    calculatedUnitCostRange: unitCosts,
    calculatedUnitCostLabel: formatCurrencyRangeLabel(unitCosts),
    calculatedSuggestedSalePrice: suggestedSalePrices[0] ?? (Number(product.fixedCost) > 0
      ? Number((Number(product.fixedCost) * PRODUCT_SUGGESTED_MARKUP_MULTIPLIER).toFixed(2))
      : 0),
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
    energyPrice: printerSettingsSnapshot.exists ? Number(printerSettingsSnapshot.data()?.energyPrice) || 0.95 : 0.95,
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

  const app = express();
  const whatsappIngestToken = env.WHATSAPP_INGEST_TOKEN?.trim();
  const adminApiToken = env.ADMIN_API_TOKEN?.trim();
  const scopedApiKeys = parseScopedApiKeys(env.LABLAYER_API_KEYS_JSON);

  app.disable("x-powered-by");
  app.use(express.json());

  registerSessionRoute(app, db, options.verifyIdToken ?? ((token) => getAuth().verifyIdToken(token, true)));

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const requireAdminApiToken: express.RequestHandler = (req, res, next) => {
    const providedToken =
      (typeof req.headers["x-lablayer-admin-token"] === "string" ? req.headers["x-lablayer-admin-token"] : "") ||
      extractBearerToken(typeof req.headers.authorization === "string" ? req.headers.authorization : undefined);

    if (!adminApiToken && scopedApiKeys.length === 0) {
      return res.status(503).json({ error: "Nenhuma chave da API administrativa está configurada." });
    }

    const scopedKey = providedToken
      ? scopedApiKeys.find((item) => item.active !== false && item.tokenHash === hashApiToken(providedToken))
      : undefined;
    const hasTechnicalAccess = Boolean(providedToken && adminApiToken && providedToken === adminApiToken);

    if (!hasTechnicalAccess && !scopedKey) {
      return res.status(401).json({ error: "Token administrativo inválido." });
    }

    const requestedTenantId = req.params.tenantId;
    if (scopedKey && requestedTenantId && scopedKey.tenantId !== requestedTenantId) {
      return res.status(403).json({ error: "Esta chave não possui acesso ao tenant solicitado." });
    }

    res.locals.apiAccess = scopedKey
      ? { keyId: scopedKey.id, tenantId: scopedKey.tenantId, actor: scopedKey.actor }
      : { keyId: "technical", tenantId: null, actor: "api-token" };

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
      const collectionPath = buildTenantCollectionPath(tenantId, collectionName);
      const targetDocId = requestedId || db.collection(collectionPath).doc().id;
      const collectionPayload = await prepareCollectionPayload({
        tenantId,
        docId: targetDocId,
        collectionName,
        payload: payloadWithoutId,
      });
      const normalizedPayload = normalizeAdminPayload(collectionPayload);

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

      const docRef = db.doc(`${collectionPath}/${targetDocId}`);
      await docRef.set(normalizedPayload, { merge: false });
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
      const collectionPayload = await prepareCollectionPayload({
        tenantId,
        docId,
        collectionName,
        payload: payloadWithoutId,
      });
      const normalizedPayload = normalizeAdminPayload(collectionPayload, {
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
      const collectionPayload = await prepareCollectionPayload({
        tenantId,
        docId,
        collectionName,
        payload: payloadWithoutId,
      });
      const mergedPayload = normalizeAdminPayload(collectionPayload, {
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
        createdAt,
        quoteSentAt,
        approvedAt,
        paidAt,
        startedAt,
        completedAt,
        referenceImageBase64,
        referenceImageDataUrl,
        quoteMediaImageBase64,
        quoteMediaImageDataUrl,
      } = req.body ?? {};

      const safeTitle = typeof title === "string" && title.trim().length > 0
        ? title.trim()
        : `Solicitação WhatsApp ${typeof customerName === "string" && customerName.trim() ? `- ${customerName.trim()}` : ''}`.trim();

      const safeDescription = typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : typeof sourceMessage === "string"
          ? sourceMessage.trim()
          : "";

      const docRef = db.collection(`tenants/${tenantId}/customRequests`).doc();

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
        createdAt: typeof createdAt === "string" && createdAt.trim() ? createdAt.trim() : new Date().toISOString(),
        quoteSentAt: typeof quoteSentAt === "string" ? quoteSentAt.trim() : "",
        approvedAt: typeof approvedAt === "string" ? approvedAt.trim() : "",
        paidAt: typeof paidAt === "string" ? paidAt.trim() : "",
        startedAt: typeof startedAt === "string" ? startedAt.trim() : "",
        completedAt: typeof completedAt === "string" ? completedAt.trim() : "",
        updatedAt: new Date().toISOString(),
      };

      const preparedPayload = await prepareCollectionPayload({
        tenantId,
        docId: docRef.id,
        collectionName: "customRequests",
        payload: {
          ...payload,
          referenceImageBase64,
          referenceImageDataUrl,
          quoteMediaImageBase64,
          quoteMediaImageDataUrl,
        },
      });

      await docRef.set(preparedPayload, { merge: false });

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
    const clientId = env.ML_CLIENT_ID;
    const redirectUri = `${env.APP_URL}/api/integrations/mercadolivre/callback`;
    
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
    const partnerId = env.SHOPEE_PARTNER_ID;
    const partnerKey = env.SHOPEE_PARTNER_KEY;
    
    if (!partnerId || !partnerKey) {
      return res.status(500).send("SHOPEE_PARTNER_ID ou SHOPEE_PARTNER_KEY não configurados no .env.");
    }

    // A Shopee exige geração de assinatura (HMAC-SHA256) com timestamp
    // Redirecionamento para a página de autorização da Shopee Open Platform
    const redirectUrl = `${env.APP_URL}/api/integrations/shopee/callback`;
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
