import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

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

  app.post("/api/webhooks/woocommerce/orders/create", (req, res) => {
    console.log("Novo pedido WooCommerce recebido:", req.body);
    res.status(200).send("OK");
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
