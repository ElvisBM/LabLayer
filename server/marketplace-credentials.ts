import type { Express } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { BusinessError, validId } from './session';

export function loadMarketplaceKey(path: string): Buffer | null {
  try {
    const mode = statSync(path).mode;
    const key = readFileSync(path);
    return !(mode & 0o077) && key.length === 32 ? key : null;
  } catch { return null; }
}

export function sealMarketplaceSecret(key: Buffer, tenant: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`mercadolivre:${tenant}:v1`));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function openMarketplaceSecret(key: Buffer, tenant: string, envelope: ReturnType<typeof sealMarketplaceSecret>) {
  if (envelope.version !== 1) throw Error('Unsupported credential version');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`mercadolivre:${tenant}:v1`));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
}

// Private root collection has no client grants. Only sanitized metadata leaves this module.
export function registerMarketplaceCredentialRoutes(
  app: Express, db: Firestore | null, verify: (token: string) => Promise<DecodedIdToken>, key: Buffer | null,
) {
  async function access(tx: Transaction, tenant: string, identity: DecodedIdToken) {
    const company = (await tx.get(db!.doc(`tenants/${tenant}`))).data();
    const profile = (await tx.get(db!.doc(`users/${identity.uid}`))).data();
    const member = await tx.get(db!.doc(`tenants/${tenant}/members/${identity.uid}`));
    const owner = company?.ownerUid === identity.uid;
    const admin = profile?.tenantId === tenant && (member.exists
      ? member.data()?.active === true && member.data()?.role === 'admin'
      : profile?.tenantRole === 'admin');
    if (!company || company.status === 'inactive' || !(owner || admin || identity.superadmin === true))
      throw new BusinessError(403, 'Somente administradores da empresa podem configurar esta integração.');
  }
  const metadata = (data: any) => ({
    clientId: data?.clientId || '', hasSecret: !!data?.secret,
    revision: data?.revision || 0, updatedAt: data?.updatedAt || null,
    storageReady: !!key, status: data?.secret ? 'credentials-saved' : 'not-configured',
    oauthReady: false,
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
        await access(tx, tenant, identity);
        const ref = db.doc(`privateMarketplaceCredentials/${tenant}`);
        const previous = (await tx.get(ref)).data();
        if (!write) return metadata(previous);
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
        return metadata(next);
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
  for (const path of ['/api/integrations/mercadolivre/auth', '/api/integrations/mercadolivre/callback']) {
    app.get(path, (_req, res) => res.status(409).set('Cache-Control', 'no-store').json({ error: 'Autorização da conta ainda não disponível. Cadastre as credenciais nas Integrações da sua empresa.' }));
  }
}
