import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import WooCommerceRestApiModule from "@woocommerce/woocommerce-rest-api";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const WooCommerceRestApi = (WooCommerceRestApiModule as unknown as { default?: typeof WooCommerceRestApiModule }).default || WooCommerceRestApiModule;

// Inicializa Firebase Admin apenas uma vez
if (!getApps().length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      initializeApp({
        credential: cert(serviceAccount)
      });
      console.log("Firebase Admin inicializado com sucesso.");
    } else {
      console.warn("Aviso: FIREBASE_SERVICE_ACCOUNT não encontrado no .env.");
    }
  } catch (err) {
    console.error("Erro ao inicializar Firebase Admin:", err);
  }
}
const db = getApps().length ? getFirestore() : null;

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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const whatsappIngestToken = process.env.WHATSAPP_INGEST_TOKEN?.trim();

  app.disable("x-powered-by");
  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
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
