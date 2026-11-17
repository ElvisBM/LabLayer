import type { Express } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { BusinessError, validId } from './session';

export interface TeamAuth {
  getUser(uid: string): Promise<{ uid: string; email?: string; disabled: boolean }>;
  createUser(input: { uid: string; email: string; displayName: string; password: string; disabled: boolean }): Promise<unknown>;
  updateUser(uid: string, input: { disabled: boolean }): Promise<unknown>;
}

// Auth and Firestore cannot share a transaction. Reserve a stable operation, create
// the Auth account disabled, link it atomically, then enable. Retries never reset a password.
export function registerTeamCreateRoute(app: Express, db: Firestore | null,
  verify: (token: string) => Promise<DecodedIdToken>, auth: TeamAuth) {
  const fail = (code: number, message: string): never => { throw new BusinessError(code, message); };
  async function owner(tx: Transaction, tenant: string, identity: DecodedIdToken) {
    const uid = identity.uid;
    const company = await tx.get(db!.doc(`tenants/${tenant}`));
    if (!company.exists || (identity.superadmin !== true && (tenant !== uid || company.data()?.ownerUid !== uid)) || company.data()?.status === 'inactive') fail(403, 'Somente o proprietário ou administrador da plataforma pode cadastrar usuários nesta empresa.');
  }
  app.post('/api/tenants/:tenantId/team/create-user', async (req, res) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
    if (!db) return res.status(503).json({ error: 'Banco indisponível.' });
    let identity: DecodedIdToken;
    try { identity = await verify(token); if (!validId(identity.uid)) throw Error(); }
    catch { return res.status(401).json({ error: 'Sessão inválida.' }); }
    let operation: ReturnType<Firestore['doc']> | undefined;
    let locked = false;
    const lockId = randomUUID();
    try {
      const tenant = req.params.tenantId;
      const body = req.body;
      if (!validId(tenant) || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['requestId', 'name', 'email', 'role', 'password'].includes(k))) fail(400, 'Cadastro inválido.');
      const { requestId, role, password } = body;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) fail(400, 'Identificador de cadastro inválido.');
      if (!name || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Informe nome e e-mail válidos.');
      if (!['member', 'admin'].includes(role)) fail(400, 'Tipo de acesso inválido.');
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'A senha inicial deve ter de 12 a 128 caracteres.');
      const uid = `team_${createHash('sha256').update(`${tenant}:${identity.uid}:${requestId}`).digest('hex').slice(0, 40)}`;
      operation = db.doc(`tenants/${tenant}/userCreations/${requestId}`);
      const op = operation;
      const alreadyDone = await db.runTransaction(async tx => {
        await owner(tx, tenant, identity);
        const previous = await tx.get(op);
        const data = previous.data();
        if (data && (data.actor !== identity.uid || data.email !== email || data.name !== name || data.role !== role || data.uid !== uid)) fail(409, 'Este cadastro já foi usado com outros dados. Atualize a tela.');
        if (data?.status === 'complete') return true;
        if (data?.lockedUntil > Date.now()) fail(409, 'Cadastro em processamento. Aguarde antes de tentar novamente.');
        tx.set(op, { actor: identity.uid, uid, email, name, role, status: data?.status || 'reserved', lockId, lockedUntil: Date.now() + 120_000, updatedAt: new Date().toISOString() }, { merge: true });
        return false;
      });
      if (alreadyDone) return res.json({ status: 'created', uid });
      locked = true;
      let account;
      try { account = await auth.getUser(uid); }
      catch (error: any) { if (error?.code !== 'auth/user-not-found') throw error; }
      if (account && account.email?.toLowerCase() !== email) fail(409, 'Identidade divergente; solicite revisão do cadastro.');
      if (!account) await auth.createUser({ uid, email, displayName: name, password, disabled: true });
      await db.runTransaction(async tx => {
        await owner(tx, tenant, identity);
        const current = await tx.get(op);
        if (current.data()?.lockId !== lockId) fail(409, 'Cadastro retomado por outra solicitação. Aguarde e tente novamente.');
        if (current.data()?.status === 'linked') return;
        const profileRef = db.doc(`users/${uid}`);
        const profile = await tx.get(profileRef);
        if (profile.exists) fail(409, 'Perfil já existente; cadastro requer revisão.');
        const now = new Date().toISOString();
        const member = { active: true, role, name, email, revision: 1, updatedAt: now };
        tx.create(profileRef, { name, email, role: 'user', tenantId: tenant, tenantRole: role, createdAt: now });
        tx.create(db.doc(`tenants/${tenant}/members/${uid}`), member);
        tx.create(db.doc(`users/${uid}/memberships/${tenant}`), member);
        tx.update(op, { status: 'linked', updatedAt: now });
        tx.create(db.collection(`tenants/${tenant}/auditLogs`).doc(), { actor: identity.uid, operation: 'team.user-linked', targetUid: uid, role, createdAt: now });
      });
      // A concurrently revoked link must not be reactivated by a retry.
      await db.runTransaction(async tx => {
        await owner(tx, tenant, identity);
        const member = await tx.get(db.doc(`tenants/${tenant}/members/${uid}`));
        if (!member.data()?.active) fail(409, 'Acesso removido durante o cadastro. Não reative automaticamente.');
      });
      await auth.updateUser(uid, { disabled: false });
      await db.runTransaction(async tx => {
        await owner(tx, tenant, identity);
        const current = await tx.get(op);
        const member = await tx.get(db.doc(`tenants/${tenant}/members/${uid}`));
        if (!member.data()?.active || current.data()?.lockId !== lockId) fail(409, 'O acesso mudou durante o cadastro. Atualize os acessos para conferir.');
        if (current.data()?.status !== 'complete') {
          tx.update(op, { status: 'complete', lockedUntil: 0, updatedAt: new Date().toISOString() });
          tx.create(db.collection(`tenants/${tenant}/auditLogs`).doc(), { actor: identity.uid, operation: 'team.user-created', targetUid: uid, role, createdAt: new Date().toISOString() });
        }
      });
      res.json({ status: 'created', uid });
    } catch (error: any) {
      if (locked && operation) { try { const op = operation; await db.runTransaction(async tx => { const current = await tx.get(op); if (current.data()?.lockId === lockId) tx.update(op, { lockedUntil: 0 }); }); } catch { /* Lease expires; no credential or request body is logged. */ } }
      if (error instanceof BusinessError) return res.status(error.status).json({ error: error.message });
      if (error?.code === 'auth/email-already-exists') return res.status(409).json({ error: 'Este e-mail já tem uma conta. Use a solicitação de acesso à empresa; a senha existente não foi alterada.' });
      if (['auth/invalid-email', 'auth/invalid-password', 'auth/password-does-not-meet-requirements'].includes(error?.code)) return res.status(400).json({ error: 'E-mail ou senha recusados pelo serviço de autenticação. Confira os requisitos.' });
      return res.status(503).json({ error: 'Não foi possível concluir o cadastro. Tente novamente com os mesmos dados para retomar; a senha não foi salva no LabLayer.' });
    }
  });
}
