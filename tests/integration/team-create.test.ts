import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerTeamCreateRoute, type TeamAuth } from '../../server/team-create';
import { CONTENTION_TIMEOUT_MS } from '../contention-timeout';

const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'team-create-test');
const db = getFirestore(firebase);
const accounts = new Map<string, { uid: string; email: string; disabled: boolean }>();
const auth: TeamAuth = {
  getUser: vi.fn(async uid => { if (!accounts.has(uid)) throw { code: 'auth/user-not-found' }; return accounts.get(uid)!; }),
  createUser: vi.fn(async input => {
    if ([...accounts.values()].some(a => a.email === input.email)) throw { code: 'auth/email-already-exists' };
    accounts.set(input.uid, { uid: input.uid, email: input.email, disabled: input.disabled });
  }),
  updateUser: vi.fn(async (uid, input) => { Object.assign(accounts.get(uid)!, input); }),
};
const app = express(); app.use(express.json());
registerTeamCreateRoute(app, db, async token => { if (token === 'invalid') throw Error(); return { uid: token, superadmin: token === 'platform' } as any; }, auth);
let rules: RulesTestEnvironment;
let body: { requestId: string; name: string; email: string; role: string; password: string };
const post = (data: object = body, actor = 'a', tenant = 'a') => request(app).post(`/api/tenants/${tenant}/team/create-user`).set('Authorization', `Bearer ${actor}`).send(data);
beforeAll(async () => {
  rules = await initializeTestEnvironment({ projectId: 'demo-lablayer-test', firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await rules.clearFirestore(); accounts.clear(); vi.clearAllMocks();
  body = { requestId: randomUUID(), name: ' Pessoa Teste ', email: 'NEW@example.test', role: 'member', password: 'Test-only-Long123!' };
  await db.doc('tenants/a').set({ ownerUid: 'a', status: 'active' });
  await db.doc('users/a').set({ tenantId: 'a', tenantRole: 'owner', role: 'admin' });
  await db.doc('users/member').set({ tenantId: 'a', tenantRole: 'admin', role: 'admin' });
  await db.doc('tenants/a/products/private').set({ name: 'Empresa A' });
});
afterAll(async () => { await rules.cleanup(); await db.terminate(); await deleteApp(firebase); });

it.each(['member', 'admin'])('cria %s no tenant correto sem persistir senha e permite login/acesso após vínculo', async role => {
  const response = await post({ ...body, role }).expect(200); const uid = response.body.uid;
  expect(auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ disabled: true, password: body.password }));
  expect(accounts.get(uid)?.disabled).toBe(false);
  expect((await db.doc(`users/${uid}`).get()).data()).toMatchObject({ name: 'Pessoa Teste', email: 'new@example.test', tenantId: 'a', tenantRole: role, role: 'user' });
  expect((await db.doc(`tenants/a/members/${uid}`).get()).data()).toMatchObject({ active: true, role });
  const documents = [await db.doc(`users/${uid}`).get(), ...(await db.collection('tenants/a/userCreations').get()).docs, ...(await db.collection('tenants/a/auditLogs').get()).docs];
  expect(JSON.stringify(documents.map(d => d.data()))).not.toContain(body.password);
  await assertSucceeds(getDoc(doc(rules.authenticatedContext(uid).firestore(), 'tenants/a/products/private')));
  await assertFails(getDoc(doc(rules.authenticatedContext('other').firestore(), 'tenants/a/products/private')));
});
it('bloqueia não proprietário, token inválido, tenant alheio e empresa inativa', async () => {
  await post(body, 'member').expect(403); await post(body, 'invalid').expect(401); await post(body, 'a', 'b').expect(403);
  await request(app).post('/api/tenants/a/team/create-user').send(body).expect(401);
  await db.doc('tenants/a').update({ status: 'inactive' }); await post().expect(403);
  expect(auth.createUser).not.toHaveBeenCalled();
});
it('recusa privilégios injetados, senha curta e dados inválidos antes de criar conta', async () => {
  for (const invalid of [{ role: 'owner' }, { role: 'superadmin' }, { uid: 'override' }, { tenantId: 'b' }, { password: '123' }, { password: 'a'.repeat(129) }, { email: 'invalid' }, { name: ' ' }, { requestId: '../x' }]) await post({ ...body, ...invalid }).expect(400);
  expect(auth.createUser).not.toHaveBeenCalled();
});
it('repetição retorna mesmo usuário, sem trocar senha nem duplicar auditoria', async () => {
  const first = (await post().expect(200)).body;
  expect((await post({ ...body, password: 'A-different-password' }).expect(200)).body).toEqual(first);
  expect(auth.createUser).toHaveBeenCalledTimes(1); expect(auth.updateUser).toHaveBeenCalledTimes(1);
  expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(2);
  await post({ ...body, email: 'different@example.test' }).expect(409);
});
it('e-mail existente não ganha novo vínculo nem tem senha alterada', async () => {
  accounts.set('existing', { uid: 'existing', email: 'new@example.test', disabled: false });
  expect((await post().expect(409)).body.error).toContain('já tem uma conta');
  expect(auth.updateUser).not.toHaveBeenCalled();
  expect((await db.collection('tenants/a/members').get()).empty).toBe(true);
});
it('falha no vínculo mantém conta desabilitada e retry retoma sem recriar', async () => {
  const original = db.collection.bind(db);
  const spy = vi.spyOn(db, 'collection').mockImplementation(p => { if (p.endsWith('/auditLogs')) throw Error('offline'); return original(p); });
  try { await post().expect(503); } finally { spy.mockRestore(); }
  expect([...accounts.values()][0].disabled).toBe(true);
  expect((await db.collection('tenants/a/members').get()).empty).toBe(true);
  const done = (await post().expect(200)).body;
  expect(accounts.get(done.uid)?.disabled).toBe(false); expect(auth.createUser).toHaveBeenCalledTimes(1);
});
it('falha na ativação permite retomar e revogação intermediária impede reativar acesso', async () => {
  vi.mocked(auth.updateUser).mockRejectedValueOnce(Error('unavailable'));
  await post().expect(503);
  const uid = [...accounts.keys()][0];
  expect(accounts.get(uid)?.disabled).toBe(true);
  await db.doc(`tenants/a/members/${uid}`).update({ active: false });
  await post().expect(409);
  expect(auth.updateUser).toHaveBeenCalledTimes(1);
  expect(accounts.get(uid)?.disabled).toBe(true);
});
it('duas chamadas concorrentes não criam duas contas', { timeout: CONTENTION_TIMEOUT_MS }, async () => {
  const results = await Promise.all([post(), post()]);
  expect(results.some(r => r.status === 200)).toBe(true);
  expect(results.every(r => [200, 409].includes(r.status))).toBe(true);
  expect(auth.createUser).toHaveBeenCalledTimes(1);
});
it('operações internas não podem ser lidas ou gravadas pelo navegador, nem pelo dono', async () => {
  const client = rules.authenticatedContext('a').firestore();
  await assertFails(setDoc(doc(client, `tenants/a/userCreations/${body.requestId}`), { status: 'complete' }));
  await assertFails(getDoc(doc(client, `tenants/a/userCreations/${body.requestId}`)));
});

it('administrador da plataforma pode gerenciar empresa ativa, mas campo role do perfil não promove membro', async () => {
  await db.doc('users/member').update({ role: 'superadmin' });
  await post(body, 'member').expect(403);
  await post(body, 'platform').expect(200);
});
