import type { Express } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

export class BusinessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && !value.includes('/') && value !== '.' && value !== '..';
}

// All privilege-bearing fields are derived on the server. The body is never used.
export async function provisionSession(db: Firestore, identity: DecodedIdToken) {
  const uid = identity.uid;
  if (!validId(uid)) throw new BusinessError(401, 'Identidade inválida.');
  const userRef = db.doc(`users/${uid}`);
  const now = new Date().toISOString();
  return db.runTransaction(async tx => {
    const profile = await tx.get(userRef);
    const previous = profile.data();
    const tenantId = previous?.tenantId || uid;
    if (!validId(tenantId)) throw new BusinessError(409, 'Vínculo de empresa requer revisão.');
    const tenantRef = db.doc(`tenants/${tenantId}`);
    const tenant = await tx.get(tenantRef);
    if (tenantId !== uid && !tenant.exists) throw new BusinessError(409, 'Empresa vinculada não encontrada.');
    if (tenant.exists && tenant.data()?.ownerUid !== uid && tenantId === uid) {
      throw new BusinessError(409, 'Propriedade da empresa requer revisão.');
    }
    if (tenant.data()?.status === 'inactive') throw new BusinessError(403, 'Empresa inativa.');
    if (!tenant.exists) {
      tx.create(tenantRef, {
        ownerUid: uid, ownerEmail: identity.email ?? '',
        companyName: typeof identity.name === 'string' ? identity.name.slice(0, 100) || 'Minha Empresa' : 'Minha Empresa',
        plan: 'free', status: 'active', createdAt: now,
      });
    }
    if (!profile.exists) {
      tx.create(userRef, {
        email: identity.email ?? '', role: 'admin', tenantId: uid,
        tenantRole: 'owner', createdAt: now,
      });
    } else if (!previous?.tenantId && tenantId === uid) {
      // Safe legacy repair: only the authenticated user's own tenant.
      tx.update(userRef, { tenantId: uid, tenantRole: 'owner' });
    }
    return { tenantId, isSuperAdmin: identity.superadmin === true };
  });
}

export function registerSessionRoute(
  app: Express, db: Firestore | null, verify: (token: string) => Promise<DecodedIdToken>,
) {
  app.post('/api/session', async (req, res) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
    if (!db) return res.status(503).json({ error: 'Banco de dados não disponível.' });
    let identity: DecodedIdToken;
    try { identity = await verify(token); }
    catch { return res.status(401).json({ error: 'Sessão inválida ou expirada.' }); }
    try { return res.json(await provisionSession(db, identity)); }
    catch (error) {
      if (error instanceof BusinessError) return res.status(error.status).json({ error: error.message });
      console.error('Falha ao provisionar sessão:', error);
      return res.status(503).json({ error: 'Não foi possível inicializar a empresa. Tente novamente.' });
    }
  });
}
