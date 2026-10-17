import { CONTENTION_TIMEOUT_MS } from '../contention-timeout';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../../server';
import { provisionSession } from '../../server/session';

let rules: RulesTestEnvironment;
const adminApp = initializeApp({ projectId: 'demo-lablayer-test' }, 'access-test');
const db = getFirestore(adminApp);
const identity = (uid: string, extras = {}) => ({ uid, email: `${uid}@example.test`, ...extras } as DecodedIdToken);
const tenant = (uid: string) => ({ ownerUid: uid, companyName: uid, plan: 'free', status: 'active', createdAt: '2026-01-01' });
beforeAll(async () => {
  rules = await initializeTestEnvironment({ projectId: 'demo-lablayer-test', firestore: {
    host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8'),
  } });
});
beforeEach(async () => {
  await rules.clearFirestore();
  await db.doc('tenants/owner').set(tenant('owner'));
  await db.doc('users/owner').set({ tenantId: 'owner', role: 'admin', tenantRole: 'owner' });
  await db.doc('tenants/other').set(tenant('other'));
  await db.doc('users/member').set({ tenantId: 'owner', role: 'admin', tenantRole: 'member' });
  await db.doc('tenants/owner/products/p').set({ name: 'Peça', status: 'ativo' });
});
afterAll(async () => { await rules.cleanup(); await db.terminate(); await deleteApp(adminApp); });

describe('E0.2 isolamento e privilégios nas rules reais', () => {
  it('dono e membro leem a própria operação', async () => {
    for (const uid of ['owner', 'member']) await assertSucceeds(getDoc(doc(rules.authenticatedContext(uid).firestore(), 'tenants/owner/products/p')));
  });
  it('nega acesso anônimo e entre empresas', async () => {
    await assertFails(getDoc(doc(rules.unauthenticatedContext().firestore(), 'tenants/owner/products/p')));
    await assertFails(getDoc(doc(rules.authenticatedContext('other').firestore(), 'tenants/owner/products/p')));
  });
  it.each(['role', 'tenantId', 'tenantRole'])('não permite alterar %s do próprio perfil', async field => {
    await assertFails(updateDoc(doc(rules.authenticatedContext('owner').firestore(), 'users/owner'), { [field]: 'superadmin' }));
  });
  it('não permite criar perfil privilegiado ou empresa pelo navegador', async () => {
    const client = rules.authenticatedContext('new').firestore();
    await assertFails(setDoc(doc(client, 'users/new'), { tenantId: 'other', role: 'superadmin' }));
    await assertFails(setDoc(doc(client, 'tenants/new'), tenant('new')));
  });
  it('papel legado e email não concedem superadmin', async () => {
    await db.doc('users/owner').update({ role: 'superadmin' });
    const client = rules.authenticatedContext('owner', { email: 'elvisbmartins@gmail.com' }).firestore();
    await assertFails(updateDoc(doc(client, 'tenants/other'), { plan: 'enterprise' }));
  });
  it('dono altera nome, mas não plano, status, propriedade ou data', async () => {
    const ref = doc(rules.authenticatedContext('owner').firestore(), 'tenants/owner');
    await assertSucceeds(updateDoc(ref, { companyName: 'Novo nome' }));
    for (const payload of [{ plan: 'enterprise' }, { status: 'inactive' }, { ownerUid: 'other' }, { createdAt: 'amanhã' }]) {
      await assertFails(updateDoc(ref, payload));
    }
    await assertFails(deleteDoc(ref));
  });
  it('custom claim confiável administra plano/status, sem trocar dono', async () => {
    const ref = doc(rules.authenticatedContext('ops', { superadmin: true }).firestore(), 'tenants/owner');
    await assertSucceeds(updateDoc(ref, { plan: 'pro', status: 'active' }));
    await assertFails(updateDoc(ref, { ownerUid: 'ops' }));
  });
  it('empresa inativa perde acesso operacional mesmo sendo dono', async () => {
    await db.doc('tenants/owner').update({ status: 'inactive' });
    await assertFails(getDoc(doc(rules.authenticatedContext('owner').firestore(), 'tenants/owner/products/p')));
    await assertFails(updateDoc(doc(rules.authenticatedContext('owner').firestore(), 'tenants/owner'), { status: 'active' }));
  });
});

describe('E0.2 provisionamento confiável', () => {
  it('primeiro acesso concorrente cria uma empresa free e um perfil, sem sobrescrever', { timeout: CONTENTION_TIMEOUT_MS }, async () => {
    const results = await Promise.all([provisionSession(db, identity('new')), provisionSession(db, identity('new'))]);
    expect(results).toEqual([{ tenantId: 'new', isSuperAdmin: false }, { tenantId: 'new', isSuperAdmin: false }]);
    expect((await db.doc('tenants/new').get()).data()).toMatchObject({ ownerUid: 'new', plan: 'free' });
    await db.doc('tenants/new').update({ companyName: 'Preservada', plan: 'pro' });
    await provisionSession(db, identity('new'));
    expect((await db.doc('tenants/new').get()).data()).toMatchObject({ companyName: 'Preservada', plan: 'pro' });
  });
  it('membro mantém vínculo e não recebe empresa própria', async () => {
    expect(await provisionSession(db, identity('member'))).toEqual({ tenantId: 'owner', isSuperAdmin: false });
    expect((await db.doc('tenants/member').get()).exists).toBe(false);
  });
  it('não substitui vínculo inválido por empresa própria', async () => {
    await db.doc('users/member').update({ tenantId: 'missing' });
    await expect(provisionSession(db, identity('member'))).rejects.toMatchObject({ status: 409 });
    expect((await db.doc('tenants/member').get()).exists).toBe(false);
  });
  it('repara legado sem tenant somente para o dono autenticado', async () => {
    await db.doc('users/owner').set({ role: 'admin' });
    await provisionSession(db, identity('owner'));
    expect((await db.doc('users/owner').get()).data()).toMatchObject({ tenantId: 'owner', tenantRole: 'owner' });
  });
  it('nega inicialização de empresa inativa', async () => {
    await db.doc('tenants/owner').update({ status: 'inactive' });
    await expect(provisionSession(db, identity('owner'))).rejects.toMatchObject({ status: 403 });
  });
  it('endpoint exige token verificado e ignora privilégios no body', async () => {
    const app = await createApp({ database: db, env: {}, verifyIdToken: async token => {
      if (token !== 'valid') throw Error('invalid');
      return identity('new');
    } });
    await request(app).post('/api/session').expect(401);
    await request(app).post('/api/session').set('Authorization', 'Bearer invalid').expect(401);
    const response = await request(app).post('/api/session').set('Authorization', 'Bearer valid')
      .send({ tenantId: 'other', role: 'superadmin', plan: 'enterprise' }).expect(200);
    expect(response.body).toEqual({ tenantId: 'new', isSuperAdmin: false });
    expect((await db.doc('users/new').get()).data()?.role).toBe('admin');
  });
});
