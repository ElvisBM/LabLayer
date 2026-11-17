import type { Express, Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { BusinessError, validId } from './session';

export function registerTeamRoutes(app: Express, db: Firestore | null, verify: (token: string) => Promise<DecodedIdToken>) {
  const ref = (p: string) => db!.doc(p);
  const fail = (status: number, message: string): never => { throw new BusinessError(status, message); };
  function fields(body: any, keys: string[]) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k))) fail(400, 'Comando inválido.');
    return body;
  }
  function tenantId(value: unknown) { if (!validId(value)) fail(400, 'Empresa inválida.'); return value as string; }
  function revision(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) fail(400, 'Revisão inválida.'); return Number(value); }
  async function owner(tx: Transaction, tenant: string, identity: DecodedIdToken) {
    const uid = identity.uid;
    const snap = await tx.get(ref(`tenants/${tenant}`));
    if (!snap.exists || snap.data()?.status === 'inactive' || (identity.superadmin !== true && (tenant !== uid || snap.data()?.ownerUid !== uid))) fail(403, 'Somente o proprietário ou administrador da plataforma pode gerenciar acessos.');
    return snap.data()!;
  }
  function audit(tx: Transaction, tenant: string, actor: string, operation: string, targetUid: string, detail: object = {}) {
    tx.create(db!.collection(`tenants/${tenant}/auditLogs`).doc(), { actor, operation, targetUid, ...detail, createdAt: new Date().toISOString() });
  }
  const handler = (run: (req: Request, identity: DecodedIdToken) => Promise<unknown>) => async (req: any, res: any) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    let identity: DecodedIdToken;
    try { identity = await verify(token); if (!validId(identity.uid)) throw Error(); }
    catch { return res.status(401).json({ error: 'Sessão inválida.' }); }
    try { return res.json(await run(req, identity)); }
    catch (error) {
      if (error instanceof BusinessError) return res.status(error.status).json({ error: error.message });
      console.error('Falha na gestão de usuários.');
      return res.status(503).json({ error: 'Não foi possível concluir. Atualize a lista e confira antes de tentar novamente.' });
    }
  };

  app.get('/api/team/companies', handler(async (_req, identity) => db!.runTransaction(async tx => {
    const profile = (await tx.get(ref(`users/${identity.uid}`))).data();
    const links = await tx.get(db!.collection(`users/${identity.uid}/memberships`).limit(101));
    if (links.size > 100) fail(409, 'Mais de 100 vínculos; a lista exige paginação antes de continuar.');
    const ids = [...new Set([identity.uid, profile?.tenantId, ...links.docs.filter(d => d.data().active).map(d => d.id)].filter(validId))];
    const snapshots = await tx.getAll(...ids.map(id => ref(`tenants/${id}`)));
    const companies = snapshots.filter(s => s.exists && s.data()?.status !== 'inactive').map(s => {
      const role = s.id === identity.uid && s.data()?.ownerUid === identity.uid ? 'owner'
        : s.id === profile?.tenantId ? (identity.superadmin === true ? 'platform-admin' : profile?.tenantRole === 'admin' ? 'admin' : 'member')
        : links.docs.find(d => d.id === s.id)?.data().role;
      return { id: s.id, name: s.data()?.companyName || 'Minha Empresa', role };
    });
    return { currentTenantId: profile?.tenantId ?? null, email: identity.email ?? '', companies };
  })));

  app.get('/api/tenants/:tenantId/team', handler(async (req, identity) => {
    const tenant = tenantId(req.params.tenantId);
    return db!.runTransaction(async tx => {
      const company = (await tx.get(ref(`tenants/${tenant}`))).data();
      const profile = (await tx.get(ref(`users/${identity.uid}`))).data();
      const isOwner = identity.superadmin === true || (tenant === identity.uid && company?.ownerUid === identity.uid);
      if (!company || company.status === 'inactive' || !(isOwner || profile?.tenantId === tenant)) fail(403, 'Empresa sem acesso.');
      if (!isOwner) return { tenantId: tenant, companyName: company.companyName, isOwner: false, members: [], requests: [] };
      const members = await tx.get(db!.collection(`tenants/${tenant}/members`).limit(201));
      const legacy = await tx.get(db!.collection('users').where('tenantId', '==', tenant).limit(201));
      const requests = await tx.get(db!.collection(`tenants/${tenant}/accessRequests`).where('status', '==', 'pending').limit(201));
      if ([members, legacy, requests].some(s => s.size > 200)) fail(409, 'Lista excede 200 registros; paginar antes de gerenciar acessos.');
      const result = new Map<string, any>();
      for (const user of legacy.docs) result.set(user.id, { uid: user.id, email: user.data().email || '', name: user.data().name || '', role: user.id === tenant ? 'owner' : user.data().tenantRole === 'admin' ? 'admin' : 'member', revision: 0 });
      for (const user of members.docs) {
        if (user.data().active) result.set(user.id, { uid: user.id, email: user.data().email, name: user.data().name || '', role: user.data().role, revision: user.data().revision });
        else result.delete(user.id);
      }
      if (identity.superadmin === true && result.has(identity.uid)) result.set(identity.uid, { ...result.get(identity.uid), platformAdmin: true });
      result.set(tenant, { uid: tenant, email: company.ownerEmail || identity.email || '', name: legacy.docs.find(d => d.id === tenant)?.data().name || (identity.uid === tenant ? identity.name || '' : ''), role: 'owner', revision: 0 });
      return { tenantId: tenant, companyName: company.companyName, isOwner: true, members: [...result.values()], requests: requests.docs.map(d => ({ uid: d.id, email: d.data().email, revision: d.data().revision, requestedAt: d.data().requestedAt })) };
    });
  }));

  app.post('/api/team/request-access', handler(async (req, identity) => {
    const body = fields(req.body, ['tenantId']); const tenant = tenantId(body.tenantId);
    if (!identity.email_verified || !identity.email) fail(403, 'Verifique o e-mail da sua conta antes de solicitar acesso.');
    if (tenant === identity.uid) fail(409, 'Você já é proprietário desta empresa.');
    return db!.runTransaction(async tx => {
      const company = await tx.get(ref(`tenants/${tenant}`));
      const profile = await tx.get(ref(`users/${identity.uid}`));
      const link = await tx.get(ref(`tenants/${tenant}/members/${identity.uid}`));
      const requestRef = ref(`tenants/${tenant}/accessRequests/${identity.uid}`);
      const previous = await tx.get(requestRef);
      if (!company.exists || company.data()?.status === 'inactive' || !profile.exists) fail(403, 'Empresa ou conta indisponível para solicitação.');
      if (link.data()?.active || profile.data()?.tenantId === tenant) fail(409, 'Você já tem acesso a esta empresa.');
      if (previous.data()?.status === 'pending') return { status: 'pending', revision: previous.data()?.revision };
      const next = (previous.data()?.revision || 0) + 1;
      tx.set(requestRef, { email: identity.email, status: 'pending', revision: next, requestedAt: new Date().toISOString() });
      audit(tx, tenant, identity.uid, 'team.request-access', identity.uid);
      return { status: 'pending', revision: next };
    });
  }));

  app.post('/api/tenants/:tenantId/team/:uid/decision', handler(async (req, identity) => {
    const tenant = tenantId(req.params.tenantId), uid = tenantId(req.params.uid);
    const body = fields(req.body, ['decision', 'role', 'expectedRevision']);
    if (!['approve', 'reject'].includes(body.decision) || !['member', 'admin'].includes(body.role)) fail(400, 'Decisão ou papel inválido.');
    const expected = revision(body.expectedRevision);
    return db!.runTransaction(async tx => {
      await owner(tx, tenant, identity);
      if (uid === tenant) fail(409, 'A propriedade não pode ser alterada por este comando.');
      const requestRef = ref(`tenants/${tenant}/accessRequests/${uid}`);
      const previous = await tx.get(requestRef);
      const profile = await tx.get(ref(`users/${uid}`));
      const memberRef = ref(`tenants/${tenant}/members/${uid}`);
      const member = await tx.get(memberRef);
      if (!profile.exists || previous.data()?.status !== 'pending' || previous.data()?.revision !== expected) fail(409, 'Solicitação alterada; atualize a lista.');
      const status = body.decision === 'approve' ? 'approved' : 'rejected';
      if (status === 'approved') {
        const data = { active: true, role: body.role, email: previous.data()!.email, revision: (member.data()?.revision || 0) + 1, updatedAt: new Date().toISOString() };
        tx.set(memberRef, data);
        tx.set(ref(`users/${uid}/memberships/${tenant}`), data);
      }
      tx.update(requestRef, { status, revision: expected + 1, decidedBy: identity.uid, decidedAt: new Date().toISOString() });
      audit(tx, tenant, identity.uid, `team.${status}`, uid, { role: body.role });
      return { status };
    });
  }));

  app.post('/api/tenants/:tenantId/team/:uid/revoke', handler(async (req, identity) => {
    const tenant = tenantId(req.params.tenantId), uid = tenantId(req.params.uid);
    const expected = revision(fields(req.body, ['expectedRevision']).expectedRevision);
    return db!.runTransaction(async tx => {
      await owner(tx, tenant, identity);
      if (uid === tenant) fail(409, 'Não é possível remover o proprietário.');
      const memberRef = ref(`tenants/${tenant}/members/${uid}`);
      const member = await tx.get(memberRef);
      const userRef = ref(`users/${uid}`), user = await tx.get(userRef);
      const active = member.exists ? member.data()?.active : user.data()?.tenantId === tenant;
      if (!active || (member.data()?.revision || 0) !== expected) fail(409, 'Vínculo alterado; atualize a lista.');
      const value = { active: false, role: member.data()?.role || 'member', revision: expected + 1, updatedAt: new Date().toISOString() };
      tx.set(memberRef, value, { merge: true });
      tx.set(ref(`users/${uid}/memberships/${tenant}`), value, { merge: true });
      if (user.data()?.tenantId === tenant) tx.update(userRef, { tenantId: uid, tenantRole: 'owner' });
      audit(tx, tenant, identity.uid, 'team.revoked', uid);
      return { status: 'revoked' };
    });
  }));

  app.post('/api/team/select-company', handler(async (req, identity) => {
    const tenant = tenantId(fields(req.body, ['tenantId']).tenantId);
    return db!.runTransaction(async tx => {
      const company = await tx.get(ref(`tenants/${tenant}`));
      const profileRef = ref(`users/${identity.uid}`), profile = await tx.get(profileRef);
      const member = await tx.get(ref(`tenants/${tenant}/members/${identity.uid}`));
      const isOwner = tenant === identity.uid && company.data()?.ownerUid === identity.uid;
      const legacyMember = !member.exists && profile.data()?.tenantId === tenant;
      if (!profile.exists || !company.exists || company.data()?.status === 'inactive' || !(isOwner || member.data()?.active || legacyMember)) fail(403, 'Empresa sem acesso aprovado.');
      const role = isOwner ? 'owner' : member.exists ? member.data()!.role : profile.data()?.tenantRole === 'admin' ? 'admin' : 'member';
      tx.update(profileRef, { tenantId: tenant, tenantRole: role });
      audit(tx, tenant, identity.uid, 'team.selected', identity.uid);
      return { tenantId: tenant };
    });
  }));
}
