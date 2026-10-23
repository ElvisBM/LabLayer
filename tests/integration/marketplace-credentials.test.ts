import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerMarketplaceCredentialRoutes, openMarketplaceSecret } from '../../server/marketplace-credentials';

const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'marketplace-credentials-test');
const db = getFirestore(firebase), key = randomBytes(32);
const verify = async (token: string) => { if (token === 'invalid') throw Error(); return { uid: token, superadmin: token === 'platform' } as any; };
const app = express(); app.use(express.json()); registerMarketplaceCredentialRoutes(app, db, verify, key);
let rules: RulesTestEnvironment;
const path = '/api/tenants/a/integrations/mercadolivre/credentials';
const secret = 'test-only-credential-123456789';
const body = { clientId: '2379102902840747', clientSecret: secret, expectedRevision: 0 };
const post = (data = body, actor = 'owner', url = path) => request(app).post(url).set('Authorization', `Bearer ${actor}`).send(data);
beforeAll(async () => { rules = await initializeTestEnvironment({ projectId: 'demo-lablayer-test', firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => {
  await rules.clearFirestore();
  await db.doc('tenants/a').set({ ownerUid: 'owner', status: 'active' });
  await db.doc('users/admin').set({ tenantId: 'a', tenantRole: 'admin' });
  await db.doc('users/member').set({ tenantId: 'a', tenantRole: 'member', role: 'superadmin' });
});
afterAll(async () => { await rules.cleanup(); await db.terminate(); await deleteApp(firebase); });

it('salva criptografado por empresa; leitura e auditoria nunca retornam segredo ou ciphertext', async () => {
  const saved = await post().expect(200);
  expect(saved.body).toMatchObject({ clientId: body.clientId, hasSecret: true, revision: 1, status: 'credentials-saved', oauthReady: true });
  const stored = (await db.doc('privateMarketplaceCredentials/a').get()).data()!;
  expect(openMarketplaceSecret(key, 'a', stored.secret)).toBe(secret);
  expect(() => openMarketplaceSecret(key, 'b', stored.secret)).toThrow();
  expect(() => openMarketplaceSecret(randomBytes(32), 'a', stored.secret)).toThrow();
  const read = await request(app).get(path).set('Authorization', 'Bearer owner').expect(200);
  expect(read.headers['cache-control']).toBe('no-store');
  const audit = (await db.collection('tenants/a/auditLogs').get()).docs.map(d => d.data());
  expect(audit).toHaveLength(1);
  for (const result of [stored, saved.body, read.body, audit]) expect(JSON.stringify(result)).not.toContain(secret);
  expect(read.body).not.toHaveProperty('secret');
  expect(JSON.stringify(audit)).not.toContain(stored.secret.data);
});
it('permite administrador e plataforma; não confia no role superadmin do corpo/perfil', async () => {
  await post(body, 'member').expect(403);
  await post(body, 'admin').expect(200);
  await post({ ...body, expectedRevision: 1 }, 'platform').expect(200);
});
it('nega sessão ausente/inválida, outra empresa e membro revogado inclusive com perfil antigo admin', async () => {
  await request(app).post(path).send(body).expect(401);
  await post(body, 'invalid').expect(401);
  await db.doc('tenants/b').set({ ownerUid: 'other', status: 'active' });
  await post(body, 'admin', path.replace('/a/', '/b/')).expect(403);
  await db.doc('tenants/a/members/admin').set({ active: false, role: 'admin' });
  await post(body, 'admin').expect(403);
  await request(app).get(path).set('Authorization', 'Bearer member').expect(403);
  await db.doc('tenants/a').update({ status: 'inactive' });
  await post().expect(403);
});
it('valida campos e exige novo segredo se mudar o aplicativo', async () => {
  for (const invalid of [{ clientId: 'abc' }, { clientSecret: 'short' }, { clientSecret: '' }, { expectedRevision: -1 }, { tenantId: 'b' }, { clientSecret: secret+'\n' }])
    await post({ ...body, ...invalid } as any).expect(400);
  await post().expect(200);
  await post({ ...body, expectedRevision: 1, clientSecret: '', clientId: '987654321' }).expect(400);
  await post({ ...body, expectedRevision: 1, clientSecret: '' }).expect(200);
  const stored = (await db.doc('privateMarketplaceCredentials/a').get()).data()!;
  expect(openMarketplaceSecret(key, 'a', stored.secret)).toBe(secret);
  await post({ ...body, expectedRevision: 2, clientSecret: 'replacement-test-secret-12345' }).expect(200);
  expect(openMarketplaceSecret(key, 'a', (await db.doc('privateMarketplaceCredentials/a').get()).data()!.secret)).toBe('replacement-test-secret-12345');
});
it('revisão antiga não sobrescreve credencial e não duplica auditoria', async () => {
  await post().expect(200); await post().expect(409);
  expect((await db.collection('tenants/a/auditLogs').get()).size).toBe(1);
});
it('falha na auditoria aborta a gravação da credencial', async () => {
  const original = db.collection.bind(db);
  const spy = vi.spyOn(db, 'collection').mockImplementation(p => { if (p.endsWith('/auditLogs')) throw Error('unavailable'); return original(p); });
  try { await post().expect(503); } finally { spy.mockRestore(); }
  expect((await db.doc('privateMarketplaceCredentials/a').get()).exists).toBe(false);
});
it('cofre indisponível não grava nem aceita cadastro', async () => {
  const disabled = express(); disabled.use(express.json()); registerMarketplaceCredentialRoutes(disabled, db, verify, null);
  await request(disabled).post(path).set('Authorization', 'Bearer owner').send(body).expect(503);
  expect((await db.doc('privateMarketplaceCredentials/a').get()).exists).toBe(false);
});
it('bloqueia leitura e escrita direta no Firestore mesmo para plataforma e proprietário', async () => {
  await post().expect(200);
  for (const client of [rules.unauthenticatedContext(), rules.authenticatedContext('owner'), rules.authenticatedContext('platform', { superadmin: true })]) {
    for (const collection of ['privateMarketplaceCredentials', 'privateMarketplaceConnections', 'privateMarketplaceOAuthStates', 'privateMarketplaceOAuthAttempts']) {
      const target = doc(client.firestore(), `${collection}/a`);
      await assertFails(getDoc(target)); await assertFails(setDoc(target, { clientId: 'override' }));
    }
  }
});
it('rotas antigas não redirecionam nem fingem OAuth concluído', async () => {
  await request(app).get('/api/integrations/mercadolivre/auth').expect(409);
  const r = await request(app).get('/api/integrations/mercadolivre/callback?code=test-secret-code').expect(303);
  expect(r.headers.location).toBe('/?view=configuracoes&mercadolivre=invalid-state');
  expect(r.text).not.toContain('test-secret-code');
});
