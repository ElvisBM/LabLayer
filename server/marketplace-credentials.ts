import { registerTikTokRoutes } from './tiktok';
import type { Express } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { marketplaceAccess, sealMarketplaceSecret, openMarketplaceSecret } from './marketplace-security';
export { loadMarketplaceKey, sealMarketplaceSecret, openMarketplaceSecret } from './marketplace-security';
import { registerMarketplaceOAuthRoutes, connectionMetadata } from './marketplace-oauth';
import { BusinessError, validId } from './session';

// Private root collection has no client grants. Only sanitized metadata leaves this module.
export function registerMarketplaceCredentialRoutes(
  app: Express, db: Firestore | null, verify: (token: string) => Promise<DecodedIdToken>, key: Buffer | null,
) {
  const metadata = (data: any, connection: any) => ({
    clientId: data?.clientId || '', hasSecret: !!data?.secret,
    revision: data?.revision || 0, updatedAt: data?.updatedAt || null,
    storageReady: !!key, status: data?.secret ? 'credentials-saved' : 'not-configured',
    oauthReady: !!key, connection: connectionMetadata(data, connection),
  });
  const handler = (write: boolean) => async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
    let identity: DecodedIdToken;
    try { identity = await verify(token); if (!validId(identity.uid)) throw Error(); }
    catch { return res.status(401).json({ error: 'Sessão inválida.' }); }
    const tenant = req.params.tenantId;
    if (!validId(tenant)) return res.status(400).json({ error: 'Empresa inválida.' });
    if (!db) return res.status(503).json({ error: 'Banco indisponível.' });
    try {
      const result = await db.runTransaction(async tx => {
        await marketplaceAccess(db!, tx, tenant, identity);
        const ref = db.doc(`privateMarketplaceCredentials/${tenant}`);
        const previous = (await tx.get(ref)).data();
        const connection = (await tx.get(db.doc(`privateMarketplaceConnections/${tenant}`))).data();
        if (!write) return metadata(previous, connection);
        if (!key) throw new BusinessError(503, 'Armazenamento protegido indisponível. Tente novamente mais tarde.');
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['clientId', 'clientSecret', 'expectedRevision'].includes(k)) ||
          typeof b.clientId !== 'string' || !/^\d{5,30}$/.test(b.clientId) ||
          typeof b.clientSecret !== 'string' || (b.clientSecret !== '' && !/^[\x21-\x7e]{16,512}$/.test(b.clientSecret)) ||
          !Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 0)
          throw new BusinessError(400, 'Confira o App ID, o segredo e a revisão da configuração.');
        if ((previous?.revision || 0) !== b.expectedRevision)
          throw new BusinessError(409, 'Configuração alterada. Recarregue antes de salvar novamente.');
        if (!b.clientSecret && (!previous?.secret || previous.clientId !== b.clientId))
          throw new BusinessError(400, 'Informe o Client Secret para este App ID.');
        const next = {
          clientId: b.clientId, secret: b.clientSecret ? sealMarketplaceSecret(key, tenant, b.clientSecret) : previous!.secret,
          revision: b.expectedRevision + 1, updatedAt: new Date().toISOString(), updatedBy: identity.uid,
        };
        // Check encryption key/envelope integrity also when preserving an existing secret.
        openMarketplaceSecret(key, tenant, next.secret);
        tx.set(ref, next);
        tx.create(db.collection(`tenants/${tenant}/auditLogs`).doc(), {
          operation: 'marketplace.credentials.saved', provider: 'mercadolivre', actor: identity.uid,
          revision: next.revision, secretReplaced: !!b.clientSecret, createdAt: next.updatedAt,
        });
        return metadata(next, connection);
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof BusinessError) return res.status(error.status).json({ error: error.message });
      // Never log the request body, provider credentials, ciphertext or SDK exception payload.
      return res.status(503).json({ error: 'Não foi possível confirmar o salvamento. Recarregue a configuração antes de tentar novamente.' });
    }
  };
  const route = '/api/tenants/:tenantId/integrations/mercadolivre/credentials';
  app.get(route, handler(false));
  app.post(route, handler(true));
  const loadToken = registerMarketplaceOAuthRoutes(app, db, verify, key);
  registerTikTokRoutes(app, db, verify, key);
  // Exposed so server-side integrations (MCP) reuse the same refresh/lease logic.
  return loadToken;
}
