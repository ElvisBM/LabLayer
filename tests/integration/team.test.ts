import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../../server';
import { provisionSession } from '../../server/session';
import { CONTENTION_TIMEOUT_MS } from '../contention-timeout';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'team-test');
const db = getFirestore(firebase);
let app: Awaited<ReturnType<typeof createApp>>, rules: RulesTestEnvironment;
const identity = (uid: string) => ({ uid, email: `${uid}@example.test`, email_verified: uid !== 'unverified' } as any);
const post = (route: string, body: object, uid = 'a') => request(app).post(route).set('Authorization', `Bearer ${uid}`).send(body);
const get = (route: string, uid = 'a') => request(app).get(route).set('Authorization', `Bearer ${uid}`);
const join = (uid = 'b') => post('/api/team/request-access', { tenantId: 'a' }, uid);
const decide = (decision = 'approve', uid = 'b', role = 'member', actor = 'a') => post(`/api/tenants/a/team/${uid}/decision`, { decision, role, expectedRevision: 1 }, actor);
const data = async (p: string) => (await db.doc(p).get()).data();
beforeAll(async () => {
  rules = await initializeTestEnvironment({ projectId: 'demo-lablayer-test', firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') } });
  app = await createApp({ database: db, env: {}, verifyIdToken: async token => { if (token === 'invalid') throw Error(); return identity(token); } });
});
beforeEach(async () => {
  await rules.clearFirestore();
  for (const uid of ['a', 'b', 'other', 'unverified']) {
    await db.doc(`tenants/${uid}`).set({ ownerUid: uid, ownerEmail: `${uid}@example.test`, companyName: uid, status: 'active' });
    await db.doc(`users/${uid}`).set({ tenantId: uid, tenantRole: 'owner', email: `${uid}@example.test`, role: 'admin' });
  }
  await db.doc('users/legacy').set({ tenantId: 'a', tenantRole: 'member', email: 'legacy@example.test', role: 'admin' });
  await db.doc('tenants/a/products/private').set({ name: 'Produto da empresa A' });
  await db.doc('tenants/b/customRequests/keep').set({ title: 'Pedido preservado' });
});
afterAll(async () => { await rules.cleanup(); await db.terminate(); await deleteApp(firebase); });

it('lista empresa atual, dono e membros legados sem expor outras empresas', async () => {
  const team = (await get('/api/tenants/a/team').expect(200)).body;
  expect(team.members.map((m: any) => m.uid).sort()).toEqual(['a', 'legacy']);
  expect(team.isOwner).toBe(true);
  expect((await get('/api/tenants/a/team', 'legacy').expect(200)).body.members).toEqual([]);
  await get('/api/tenants/a/team', 'other').expect(403);
  expect((await get('/api/team/companies', 'b').expect(200)).body.companies.map((c: any) => c.id)).toEqual(['b']);
});
it('exige token, e-mail verificado e alvo válido; não aceita UID/papel injetados', async () => {
  await request(app).post('/api/team/request-access').send({ tenantId: 'a' }).expect(401);
  await join('unverified').expect(403);
  await post('/api/team/request-access', { tenantId: 'a', uid: 'other' }, 'b').expect(400);
  await post('/api/team/request-access', { tenantId: 'missing' }, 'b').expect(403);
  await post('/api/team/request-access', { tenantId: 'a' }, 'invalid').expect(401);
  await post('/api/team/request-access', { tenantId: 'a' }, 'a').expect(409);
});
it('pedido pendente é idempotente e não concede acesso', async () => {
  const first = (await join().expect(200)).body;
  expect((await join().expect(200)).body).toEqual(first);
  expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(1);
  await post('/api/team/select-company', { tenantId: 'a' }, 'b').expect(403);
  expect((await data('users/b'))?.tenantId).toBe('b');
  await assertFails(getDoc(doc(rules.authenticatedContext('b').firestore(), 'tenants/a/products/private')));
});
it('somente proprietário aprova, sem promover a owner/superadmin', async () => {
  await join().expect(200);
  await decide('approve', 'b', 'member', 'legacy').expect(403);
  await decide('approve', 'b', 'member', 'other').expect(403);
  await decide('approve', 'b', 'owner').expect(400);
  await decide('approve', 'b', 'superadmin').expect(400);
  expect(await data('tenants/a/members/b')).toBeUndefined();
});
it('aprovação requer seleção explícita; troca preserva dados da empresa anterior e papel correto', async () => {
  await join().expect(200); await decide('approve', 'b', 'admin').expect(200);
  expect((await data('users/b'))?.tenantId).toBe('b');
  expect((await get('/api/team/companies', 'b').expect(200)).body.companies.map((c: any) => c.id).sort()).toEqual(['a', 'b']);
  await post('/api/team/select-company', { tenantId: 'a' }, 'b').expect(200);
  expect(await data('users/b')).toMatchObject({ tenantId: 'a', tenantRole: 'admin', role: 'admin' });
  expect(await provisionSession(db, identity('b'))).toEqual({ tenantId: 'a', isSuperAdmin: false });
  await assertSucceeds(getDoc(doc(rules.authenticatedContext('b').firestore(), 'tenants/a/products/private')));
  await post('/api/team/select-company', { tenantId: 'b' }, 'b').expect(200);
  expect(await data('users/b')).toMatchObject({ tenantId: 'b', tenantRole: 'owner' });
  expect(await data('tenants/b/customRequests/keep')).toEqual({ title: 'Pedido preservado' });
  expect((await get('/api/tenants/a/team').expect(200)).body.members.some((m: any) => m.uid === 'b')).toBe(true);
});
it('revogação bloqueia API/rules e seleção posterior, sem excluir histórico', async () => {
  await join(); await decide(); await post('/api/team/select-company', { tenantId: 'a' }, 'b').expect(200);
  await post('/api/tenants/a/team/b/revoke', { expectedRevision: 1 }).expect(200);
  expect(await data('users/b')).toMatchObject({ tenantId: 'b', tenantRole: 'owner' });
  await get('/api/tenants/a/team', 'b').expect(403);
  await post('/api/team/select-company', { tenantId: 'a' }, 'b').expect(403);
  await assertFails(getDoc(doc(rules.authenticatedContext('b').firestore(), 'tenants/a/products/private')));
  expect(await data('tenants/a/products/private')).toBeTruthy();
  expect((await get('/api/team/companies', 'b').expect(200)).body.companies.map((c: any) => c.id)).toEqual(['b']);
});
it('remove membro legado, protege proprietário e recusa revisões obsoletas', async () => {
  await post('/api/tenants/a/team/a/revoke', { expectedRevision: 0 }).expect(409);
  await post('/api/tenants/a/team/legacy/revoke', { expectedRevision: 0 }, 'legacy').expect(403);
  await post('/api/tenants/a/team/legacy/revoke', { expectedRevision: 1 }).expect(409);
  await post('/api/tenants/a/team/legacy/revoke', { expectedRevision: 0 }).expect(200);
  expect((await data('users/legacy'))?.tenantId).toBe('legacy');
  await provisionSession(db, identity('legacy'));
  expect((await data('tenants/legacy'))?.ownerUid).toBe('legacy');
});
it('recusa acessos em empresa inativa e permite rejeição/reenvio com revisão nova', async () => {
  await join(); await decide('reject').expect(200);
  expect(await data('tenants/a/members/b')).toBeUndefined();
  expect((await join().expect(200)).body.revision).toBe(3);
  await decide().expect(409);
  await db.doc('tenants/a').update({ status: 'inactive' });
  await get('/api/tenants/a/team').expect(403);
  await post('/api/team/select-company', { tenantId: 'a' }, 'a').expect(403);
});
it('aprovação e recusa concorrentes não duplicam nem contradizem concessão', { timeout: CONTENTION_TIMEOUT_MS }, async () => {
  await join();
  const results = await Promise.all([decide(), decide('reject')]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const status = (await data('tenants/a/accessRequests/b'))?.status;
  expect(Boolean((await data('tenants/a/members/b'))?.active)).toBe(status === 'approved');
  expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(2);
});
it('falha na auditoria não publica concessão nem decisão parcial', async () => {
  await join();
  const original = db.collection.bind(db);
  const spy = vi.spyOn(db, 'collection').mockImplementation((p: string) => { if (p.endsWith('/auditLogs')) throw Error('audit unavailable'); return original(p); });
  try { await decide().expect(503); } finally { spy.mockRestore(); }
  expect(await data('tenants/a/members/b')).toBeUndefined();
  expect(await data('users/b/memberships/a')).toBeUndefined();
  expect((await data('tenants/a/accessRequests/b'))?.status).toBe('pending');
});
it('cliente não cria vínculos, concede papel ou lê solicitações diretamente', async () => {
  const client = rules.authenticatedContext('b').firestore();
  for (const p of ['users/b/memberships/a', 'tenants/a/members/b', 'tenants/a/accessRequests/b']) {
    await assertFails(setDoc(doc(client, p), { active: true, role: 'admin' }));
    await assertFails(getDoc(doc(client, p)));
  }
});
