import { beforeAll, beforeEach, afterAll, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
let env: RulesTestEnvironment;
const client = (uid: string) => env.authenticatedContext(uid).firestore();
const quote = { title: 'Pedido', type: 'orcamento', status: 'aguardando-orcamento', requestedQuantity: 1, productionTimeHours: 0, filaments: [], updatedAt: '2026-10-21' };
const transaction = { date: '2026-10-21', description: 'Teste', type: 'entrada', category: 'Teste', amount: 10, status: 'pago', createdAt: '2026-10-21' };
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'demo-lablayer-test', firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'tenants/a'), { ownerUid: 'a', status: 'active', createdAt: '2026-10-21' });
    for (const [uid, role] of [['a', 'owner'], ['member', 'member'], ['admin', 'admin']]) await setDoc(doc(db, `users/${uid}`), { tenantId: 'a', tenantRole: role, role: 'user' });
    await setDoc(doc(db, 'tenants/a/customRequests/existing'), quote);
  });
});
afterAll(async () => env.cleanup());
it('perfil não permite autoelevação, troca de tenant, exclusão nem provisionamento direto', async () => {
  await assertFails(updateDoc(doc(client('member'), 'users/member'), { role: 'superadmin' }));
  await assertFails(updateDoc(doc(client('member'), 'users/member'), { tenantId: 'other', tenantRole: 'owner' }));
  await assertFails(deleteDoc(doc(client('member'), 'users/member')));
  await assertFails(setDoc(doc(client('new'), 'users/new'), { tenantId: 'a', tenantRole: 'admin' }));
});
it('membro lê a mesma lista e cria solicitação pendente, mas não aprova nem exclui orçamento', async () => {
  const db = client('member');
  await assertSucceeds(getDoc(doc(db, 'tenants/a/customRequests/existing')));
  await assertSucceeds(setDoc(doc(db, 'tenants/a/customRequests/new'), quote));
  await assertFails(updateDoc(doc(db, 'tenants/a/customRequests/existing'), { status: 'fila-producao', approvedAt: '2026-10-21' }));
  await assertFails(deleteDoc(doc(db, 'tenants/a/customRequests/existing')));
  await assertFails(setDoc(doc(db, 'tenants/a/customRequests/forged'), { ...quote, approvedAt: '2026-10-21' }));
});
it('administrador aprova orçamento e registra financeiro; membro não altera financeiro ou configuração', async () => {
  await assertSucceeds(updateDoc(doc(client('admin'), 'tenants/a/customRequests/existing'), { status: 'fila-producao', approvedAt: '2026-10-21' }));
  await assertSucceeds(setDoc(doc(client('admin'), 'tenants/a/transactions/admin'), transaction));
  await assertFails(setDoc(doc(client('member'), 'tenants/a/transactions/member'), transaction));
  await assertFails(setDoc(doc(client('member'), 'tenants/a/settings/general'), { name: 'Changed' }));
  await assertSucceeds(setDoc(doc(client('admin'), 'tenants/a/settings/general'), { name: 'Changed' }));
});
it('outro tenant e empresa inativa não dão acesso aos pedidos', async () => {
  await assertFails(getDoc(doc(client('outsider'), 'tenants/a/customRequests/existing')));
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'tenants/a'), { status: 'inactive' }));
  await assertFails(getDoc(doc(client('member'), 'tenants/a/customRequests/existing')));
});
it('e-mail de Elvis sozinho não transforma usuário em administrador global', async () => {
  await assertFails(getDoc(doc(env.authenticatedContext('outsider', { email: 'elvisbmartins@gmail.com' }).firestore(), 'users/admin')));
});
