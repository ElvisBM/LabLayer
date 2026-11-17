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

it('aprovação com quantidade e entrega é transacional e idempotente', async () => {
  const input = { ...body(), message: 'ORC-011 Aprovado, 1 quantidade, entregar dia 08/11/2026.' };
  const first = await call(input).expect(200);
  expect(first.body.updatedRequestId).toBe('manual');
  expect(interpret).not.toHaveBeenCalled();
  expect((await record().get()).data()).toMatchObject({ status: 'fila-producao', requestedQuantity: 1, requestedDeliveryDate: '2026-11-08' });
  expect((await record().get()).data()).not.toHaveProperty('paidAt');
  await call(input).expect(200);
  expect((await notes().get()).size).toBe(1);
});

const statusCall = (value: any, id = 'manual') => request(app).post(`/api/assistant/requests/${id}/status`).set('Authorization', `Bearer ${token}`).send(value);
const statusBody = (extra: any = {}) => ({ operationId: randomUUID(), status: 'produzindo', expectedStatus: 'fila-producao', expectedUpdatedAt: null, deliveryDate: '2026-11-08', ...extra });
it('seletor inicia e finaliza com auditoria e datas, sem movimentar estoque ou pagamento', async () => {
  await record().update({ status: 'fila-producao' });
  const started = await statusCall(statusBody()).expect(200);
  expect(started.body.request).toMatchObject({ status: 'produzindo', requestedDeliveryDate: '2026-11-08' });
  expect((await record().get()).data()).toMatchObject({ status: 'produzindo', startedAt: expect.any(String) });
  const completed = await statusCall(statusBody({ status: 'finalizado', expectedStatus: 'produzindo', expectedUpdatedAt: started.body.request.updatedAt, deliveryDate: undefined })).expect(200);
  expect(completed.body.request.status).toBe('finalizado');
  expect((await record().get()).data()?.completedAt).toEqual(expect.any(String));
  expect((await notes().get()).size).toBe(2);
  expect((await db.collection(`tenants/${tenant}/auditLogs`).where('operation','==','assistant.status-updated').get()).size).toBe(2);
  expect((await db.collection(`tenants/${tenant}/inventoryMovements`).get()).empty).toBe(true);
  expect((await record().get()).data()).not.toHaveProperty('paidAt');
});
it('retry retorna status atual sem repetir histórico e recusa o mesmo ID com conteúdo diferente', async () => {
  await record().update({ status: 'fila-producao' });
  const input = statusBody();
  await statusCall(input).expect(200);
  await record().update({ status: 'finalizado', updatedAt: '2026-11-09T12:00:00Z' });
  const retry = await statusCall(input).expect(200);
  expect(retry.body.request.status).toBe('finalizado');
  expect((await notes().get()).size).toBe(1);
  await statusCall({ ...input, deliveryDate: '2026-11-10' }).expect(409);
});
it('conflito de versão, regressão e aprovação fora do formulário são recusados sem escrita', async () => {
  await record().update({ status: 'fila-producao', updatedAt: '2026-10-28T12:00:00Z' });
  await statusCall(statusBody()).expect(409);
  await statusCall(statusBody({ status: 'orcado', expectedUpdatedAt: '2026-10-28T12:00:00Z' })).expect(409);
  await record().update({ status: 'orcado' });
  await statusCall(statusBody({ status: 'fila-producao', expectedStatus: 'orcado', expectedUpdatedAt: '2026-10-28T12:00:00Z' })).expect(409);
  expect((await notes().get()).empty).toBe(true);
});
it('status respeita acesso, permissão, revogação e migração', async () => {
  await record().update({ status: 'fila-producao' });
  await db.doc(`tenants/${tenant}`).update({ assistantWorkflowUpdates: false });
  await statusCall(statusBody()).expect(403);
  await db.doc(`tenants/${tenant}`).update({ assistantWorkflowUpdates: true, assistantSharedRequests: false });
  await statusCall(statusBody()).expect(404);
  await db.doc(`tenants/${tenant}`).update({ assistantSharedRequests: true });
  await db.doc(`tenants/${tenant}/inventoryControl/state`).set({ phase: 'frozen' });
  await statusCall(statusBody()).expect(409);
  await db.doc(`assistantLinks/${key}`).update({ active: false });
  await statusCall(statusBody()).expect(403);
  expect((await notes().get()).empty).toBe(true);
});
it.each([undefined, '2026-02-30', 'ontem'])('início exige data real: %s', async deliveryDate => {
  await record().update({ status: 'fila-producao' });
  await statusCall(statusBody({ deliveryDate })).expect(409);
  expect((await record().get()).data()?.status).toBe('fila-producao');
});
it('falha de auditoria reverte status e histórico na mesma transação', async () => {
  await record().update({ status: 'fila-producao' });
  const original = db.collection.bind(db);
  const spy = vi.spyOn(db, 'collection').mockImplementation(p => { if (p.endsWith('/auditLogs')) throw Error('offline'); return original(p); });
  try { await statusCall(statusBody()).expect(503); } finally { spy.mockRestore(); }
  expect((await record().get()).data()?.status).toBe('fila-producao'); expect((await notes().get()).empty).toBe(true);
});
it('aguardando orçamento exige preço antes de avançar', async () => {
  await record().update({ status: 'aguardando-orcamento', quotedPrice: 0, customerQuote: null });
  const input = statusBody({ status: 'orcado', expectedStatus: 'aguardando-orcamento', deliveryDate: undefined });
  await statusCall(input).expect(409);
  await record().update({ quotedPrice: 30 });
  await statusCall({ ...input, operationId: randomUUID() }).expect(200);
  expect((await record().get()).data()?.status).toBe('orcado');
});

it.each(['aguardando-orcamento','orcado','fila-producao','produzindo'])('cancela %s sem apagar orçamento, pagamento ou arquivos; retry não duplica', async status=>{
 await record().update({status,paidAt:'2026-10-20T12:00:00Z'});
 const before=(await record().get()).data()!;
 const input=statusBody({status:'cancelado',expectedStatus:status,deliveryDate:undefined});
 const result=await statusCall(input).expect(200);
 expect(result.body.request.status).toBe('cancelado');
 expect((await record().get()).data()).toEqual({...before,status:'cancelado',updatedAt:expect.any(String)});
 await statusCall(input).expect(200);expect((await notes().get()).size).toBe(1);
 expect((await notes().get()).docs[0].data().changes).toContainEqual({field:'status',before:status,after:'cancelado'});
 const list=await request(app).get('/api/assistant?status=cancelado').set('Authorization',`Bearer ${token}`).expect(200);
 expect(list.body.requests.map((r:any)=>r.id)).toEqual(['manual']);
 const active=await request(app).get('/api/assistant?status=active').set('Authorization',`Bearer ${token}`).expect(200);
 expect(active.body.requests.some((r:any)=>r.id==='manual')).toBe(false);
 expect((await db.collection(`tenants/${tenant}/inventoryMovements`).get()).empty).toBe(true);
 await call({...body(),message:'ORC 11 pago pode produzir'}).expect(409);
});
it.each(['cancelado','finalizado'])('permite corrigir a etapa %s mediante confirmação',async status=>{
 await record().update({status});
 await statusCall(statusBody({status,expectedStatus:status,deliveryDate:undefined})).expect(409);
 await statusCall(statusBody({status:'orcado',expectedStatus:status,deliveryDate:undefined,quantity:2,quotedPrice:45})).expect(200);
 expect((await record().get()).data()).toMatchObject({status:'orcado',quotedPrice:45,requestedQuantity:2});
});

it('confirma quantidade e total junto com Orçado; recusas e reenvio não duplicam alterações', async () => {
  await record().update({ status: 'aguardando-orcamento', quotedPrice: 0 });
  const info = db.doc(`tenants/${tenant}/assistantRequests/manual`);
  await info.set({ provisionalQuantity: true });
  const input = statusBody({ status: 'orcado', expectedStatus: 'aguardando-orcamento', deliveryDate: undefined, quantity: 3, quotedPrice: 98.75 });
  for (const invalid of [{ quantity: 0 }, { quantity: 1.5 }, { quotedPrice: -1 }, { quotedPrice: 5.012 }, { quantity: 10 }, { quotedPrice: undefined }]) {
    await statusCall({ ...input, ...invalid }).expect(409);
  }
  expect((await record().get()).data()?.status).toBe('aguardando-orcamento');
  expect((await notes().get()).empty).toBe(true);
  const result = await statusCall(input).expect(200);
  expect((await info.get()).get('provisionalQuantity')).toBe(false);
  expect(result.body.request).toMatchObject({ status: 'orcado', quantity: 3, quotedPrice: 98.75 });
  expect((await record().get()).data()).toMatchObject({ requestedQuantity: 3, provisionalQuantity: false, quotedPrice: 98.75 });
  await statusCall(input).expect(200);
  await statusCall({ ...input, quotedPrice: 130 }).expect(409);
  expect((await notes().get()).size).toBe(1);
  expect(result.body.note.changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'requestedQuantity', after: 3 }), expect.objectContaining({ field: 'quotedPrice', after: 98.75 })]));
});

it('reconhece faixas em texto para pedido existente e só grava todas após a confirmação', async () => {
  await record().update({ customerQuote: null });
  const text = 'Enviar para o orçamento ORC 11 os valores informados: 1 unidade por 16,50; 10 unidades por 14,50; 20 unidades por 12,50; 50 unidades por 10,50.';
  const preview = await call({ ...body(), message: text }).expect(200);
  expect(preview.body).toMatchObject({ draft: null, selectedRequestId: 'manual', action: { intent: 'quoteTiers', note: text } });
  expect(interpret).not.toHaveBeenCalled();
  expect((await record().get()).get('customerQuote')).toBeNull();
  const input = statusBody({ status: 'orcado', expectedStatus: 'orcado', deliveryDate: undefined, tierMessage: text, quantity: 10, quotedPrice: 145 });
  await statusCall({ ...input, quotedPrice: 14.5 }).expect(409);
  await statusCall({ ...input, tierMessage: text.replace('ORC 11', 'ORC 110') }).expect(409);
  const saved = await statusCall(input).expect(200);
  expect(saved.body.request.customerQuote.options.map((o:any)=>[o.quantity,o.unitPrice])).toEqual([[1,16.5],[10,14.5],[20,12.5],[50,10.5]]);
  expect((await record().get()).data()).toMatchObject({ status: 'orcado', requestedQuantity: 10, quotedPrice: 145 });
  await statusCall(input).expect(200);
  expect((await notes().get()).size).toBe(1);
});

it('usa o pedido aberto para valor e detalhe; só a confirmação grava total e histórico', async () => {
  await record().update({status:'aguardando-orcamento',requestedQuantity:2,quotedPrice:null,customerQuote:null});
  const message = 'Valor R$94,90 e sim é desmontado';
  const preview = await call({...body(),requestId:'manual',message}).expect(200);
  expect(preview.body).toMatchObject({selectedRequestId:'manual',action:{intent:'quotePrice',note:message}});
  expect((await record().get()).get('status')).toBe('aguardando-orcamento');
  const extra = await call({...body(),requestId:'manual',message:'Adicionar uma referência de cor azul'}).expect(200);
  expect(extra.body).toMatchObject({selectedRequestId:'manual',action:{intent:'update'}});
  expect(interpret).not.toHaveBeenCalled();
  const save=statusBody({expectedStatus:'aguardando-orcamento',status:'orcado',quantity:2,quoteMessage:message,quotedPrice:94.90,priceBasis:'total',deliveryDate:undefined});
  await statusCall({...save,priceBasis:'unit'}).expect(422);
  await statusCall(save).expect(200); await statusCall(save).expect(200);
  expect((await record().get()).data()).toMatchObject({status:'orcado',requestedQuantity:2,quotedPrice:94.9});
  expect((await notes().get()).docs.map(d=>d.get('message'))).toEqual([message]);
});

it('permite ir direto do orçamento pendente para a fila como presente, com entrega e sem pagamento', async()=>{
 await record().update({status:'aguardando-orcamento',quotedPrice:0});
 const input=statusBody({status:'fila-producao',expectedStatus:'aguardando-orcamento',quantity:3,quotedPrice:0,gift:true});
 await statusCall({...input,deliveryDate:undefined}).expect(409);
 await statusCall({...input,gift:false}).expect(409);
 await statusCall(input).expect(200);
 expect((await record().get()).data()).toMatchObject({status:'fila-producao',requestedQuantity:3,quotedPrice:0,isGift:true,requestedDeliveryDate:input.deliveryDate});
 expect((await record().get()).data()).not.toHaveProperty('paidAt');
});

it('uma aprovação simples de um pedido pendente abre a confirmação da fila sem exigir a etapa Orçado',async()=>{
 await record().update({status:'aguardando-orcamento',quotedPrice:0});
 const result=await call({...body(),message:'ORC 11 pode produzir'}).expect(200);
 expect(result.body).toMatchObject({selectedRequestId:'manual',action:{intent:'queueReview'}});
 expect((await record().get()).get('status')).toBe('aguardando-orcamento');
});
