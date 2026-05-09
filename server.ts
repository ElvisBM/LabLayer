import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import * as admin from "firebase-admin";

// Inicializa Firebase Admin apenas uma vez
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase Admin inicializado com sucesso.");
    } else {
      console.warn("Aviso: FIREBASE_SERVICE_ACCOUNT não encontrado no .env.");
    }
  } catch (err) {
    console.error("Erro ao inicializar Firebase Admin:", err);
  }
}
const db = admin.apps.length ? admin.firestore() : null;

// Inicializa API do WooCommerce
const wooCommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL || 'https://brincamentelab.com.br',
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || '',
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || '',
  version: 'wc/v3',
  queryStringAuth: true
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable("x-powered-by");
  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
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
        lablayer_synced_at: admin.firestore.FieldValue.serverTimestamp()
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
