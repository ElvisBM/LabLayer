import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerAssistantRoutes } from '../../server/assistant';
const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'assistant-workflow-test');
const db = getFirestore(firebase), app = express(); app.use(express.json());
const interpret = vi.fn(async () => ({ draft: null, action: { intent: 'lookup' as const, query: 'ORC 11', note: '', question: '' }, transcript: '', warnings: [] }));
registerAssistantRoutes(app, db, async uid => ({ uid } as any), null, { interpret });
let tenant: string, token: string, key: string;
const message = 'ORC 11 Pago pode Produzir ,\n5 com nome: Viviane Rodriguero\n5 com nome: Daniella Maglio Löw';
const body = () => ({ operationId: randomUUID(), message, attachments: [], conversation: true });
const call = (value: any) => request(app).post('/api/assistant/draft').set('Authorization', `Bearer ${token}`).send(value);
const record = () => db.doc(`tenants/${tenant}/customRequests/manual`);
const notes = () => db.collection(`tenants/${tenant}/assistantRequests/manual/notes`);
beforeEach(async () => {
  tenant = `workflow-${randomUUID()}`;
  await db.doc(`tenants/${tenant}`).set({ ownerUid: tenant, status: 'active', assistantSharedRequests: true, assistantWorkflowUpdates: true });
  const r = await request(app).post(`/api/tenants/${tenant}/assistant-links`).set('Authorization', `Bearer ${tenant}`).send({ name: 'Equipe' });
  token = r.body.token; key = r.body.id;
  await record().set({ title: 'ORC-011 — Daniella', status: 'orcado', requestedQuantity: 1, quotedPrice: 24.99, description: 'Descrição original', customerQuote: { name: 'Chaveiro', size: '6 cm', options: [{ quantity: 10, unitPrice: 16.6, deliveryDays: 2 }] } });
  await db.doc(`tenants/${tenant}/customRequests/other`).set({ title: 'ORC-110 — Outro', status: 'orcado' });
  interpret.mockClear();
});
afterAll(async () => { await db.terminate(); await deleteApp(firebase); });
it('comando explícito atualiza status, opção e histórico atomicamente sem IA ou estoque', async () => {
  const r = await call(body()).expect(200);
  expect(r.body.updatedRequestId).toBe('manual'); expect(interpret).not.toHaveBeenCalled();
  expect((await record().get()).data()).toMatchObject({ status: 'fila-producao', requestedQuantity: 10, quotedPrice: 166, description: 'Descrição original', paidAt: expect.any(String) });
  const n = (await notes().get()).docs[0].data();
  expect(n).toMatchObject({ message, kind: 'workflow-update', paymentReported: true, seller: 'Equipe' });
  expect(n.personalization).toHaveLength(2);
  expect((await db.doc(`tenants/${tenant}/customRequests/other`).get()).data()?.status).toBe('orcado');
  expect((await db.collection(`tenants/${tenant}/inventoryMovements`).get()).empty).toBe(true);
  const detail = await request(app).get('/api/assistant/requests/manual').set('Authorization', `Bearer ${token}`).expect(200);
  expect(detail.body.notes[0].changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'status', after: 'fila-producao' })]));
  expect(detail.body.notes[0]).not.toHaveProperty('linkId');
});
it('retry não duplica histórico, pagamento ou efeito; payload diferente com mesmo ID é recusado', async () => {
  const input = body(); const first = await call(input).expect(200);
  await record().update({ status: 'produzindo' });
  const again = await call(input).expect(200); expect(again.body).toEqual(first.body);
  expect((await record().get()).data()?.status).toBe('produzindo');
  expect((await notes().get()).size).toBe(1);
  await call({ ...input, message: 'ORC 11 pode produzir' }).expect(409);
});
it('nega link restrito, revogado, empresa sem permissão e migração em andamento', async () => {
  await db.doc(`tenants/${tenant}`).update({ assistantSharedRequests: false });
  await call(body()).expect(409);
  await db.doc(`tenants/${tenant}`).update({ assistantSharedRequests: true, assistantWorkflowUpdates: false });
  await call(body()).expect(403);
  await db.doc(`tenants/${tenant}`).update({ assistantWorkflowUpdates: true });
  await db.doc(`tenants/${tenant}/inventoryControl/state`).set({ phase: 'frozen' });
  await call(body()).expect(409);
  await db.doc(`assistantLinks/${key}`).update({ active: false }); await call(body()).expect(403);
  expect((await notes().get()).empty).toBe(true); expect((await record().get()).data()?.status).toBe('orcado');
});
it.each(['finalizado', 'produzindo', 'aguardando-orcamento'])('não regride nem libera status %s', async status => {
  await record().update({ status }); await call(body()).expect(409);
  expect((await notes().get()).empty).toBe(true);
});
it('quantidade sem preço, duplicidade de código e falha de auditoria não deixam alteração parcial', async () => {
  await record().update({ customerQuote: null }); await call(body()).expect(409);
  const simple = { ...body(), message: 'ORC 11 pago pode produzir' };
  await db.doc(`tenants/${tenant}/customRequests/duplicate`).set({ title: 'ORC-11 — Duplicado' });
  await call(simple).expect(409); await db.doc(`tenants/${tenant}/customRequests/duplicate`).delete();
  const original = db.collection.bind(db);
  const spy = vi.spyOn(db, 'collection').mockImplementation(p => { if (p.endsWith('/auditLogs')) throw Error('offline'); return original(p); });
  try { await call(simple).expect(503); } finally { spy.mockRestore(); }
  expect((await notes().get()).empty).toBe(true); expect((await record().get()).data()?.status).toBe('orcado');
});
it('pergunta continua só consulta e encontra ORC 11 pelo código com zeros', async () => {
  const r = await call({ ...body(), message: 'ORC 11 está pago? Pode produzir?' }).expect(200);
  expect(r.body.updatedRequestId).toBeUndefined(); expect(r.body.candidates).toHaveLength(1);
  expect(r.body.candidates[0].id).toBe('manual'); expect((await notes().get()).empty).toBe(true);
});
