import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerAssistantRoutes } from '../../server/assistant';
const firebase=initializeApp({projectId:'demo-lablayer-test'},'assistant-ai-test');
const db=getFirestore(firebase), app=express(), files=new Map<string,Buffer>();
app.use(express.json());
const interpret=vi.fn();
registerAssistantRoutes(app,db,async(uid)=>({uid}) as any,{put:async(p,b)=>{files.set(p,b)},get:async(p)=>files.get(p)!},{interpret});
let tenant:string,token:string,key:string;
const call=(body:any,secret=token)=>request(app).post('/api/assistant/draft').set('Authorization',`Bearer ${secret}`).send(body);
const draft={title:'Boneca ProFaby',customerName:'Faby',description:'Boneca loira 12cm',quantity:1,provisionalQuantity:true};
beforeEach(async()=>{
 tenant=`ai-${randomUUID()}`;
 await db.doc(`tenants/${tenant}`).set({ownerUid:tenant,status:'active'});
 const r=await request(app).post(`/api/tenants/${tenant}/assistant-links`).set('Authorization',`Bearer ${tenant}`).send({name:'Vendas'}).expect(200);
 token=r.body.token;key=r.body.id;interpret.mockReset();interpret.mockResolvedValue({draft,transcript:'',warnings:['Confirmar quantidade']});
});
afterAll(async()=>{await db.terminate();await deleteApp(firebase)});
it('IA apenas prepara rascunho, cobra cota, não grava pedido, preço ou estoque',async()=>{
 const r=await call({message:'Boneca ProFaby loira 12cm'}).expect(200);
 expect(r.body.mode).toBe('ai');expect(r.body.draft).toEqual(draft);
 expect((await db.doc(`assistantLinks/${key}`).get()).data()?.aiCount).toBe(1);
 expect((await db.collection(`tenants/${tenant}/customRequests`).get()).empty).toBe(true);
 expect(interpret.mock.calls[0][0]).toEqual({message:'Boneca ProFaby loira 12cm',attachments:[]});
});
it('falha externa retorna modo guiado explícito sem cadastrar e manual não consome IA',async()=>{
 interpret.mockRejectedValue(Error('provider unavailable'));
 const r=await call({message:'12cm'}).expect(200); expect(r.body.mode).toBe('guided');expect(r.body.message).toContain('não concluiu');
 interpret.mockClear();await call({message:'10 unidades',guided:true}).expect(200);expect(interpret).not.toHaveBeenCalled();
 expect((await db.doc(`assistantLinks/${key}`).get()).data()?.aiCount).toBe(1);
});
it('limita consumo persistente por vendedor e por empresa',async()=>{
 await db.doc(`assistantLinks/${key}`).update({aiDay:new Date().toISOString().slice(0,10),aiCount:30});
 await call({message:'Pedido'}).expect(429);expect(interpret).not.toHaveBeenCalled();
 await db.doc(`assistantLinks/${key}`).update({aiCount:0});
 await db.doc(`assistantAiQuotas/${createHash('sha256').update(tenant).digest('hex')}`).set({day:new Date().toISOString().slice(0,10),count:300});
 await call({message:'Pedido'}).expect(429);expect(interpret).not.toHaveBeenCalled();
});
it('não envia anexo de outro link à IA, nem acessa URLs do cliente',async()=>{
 await call({message:'Pedido',attachments:['a'.repeat(64)]}).expect(422);
 await call({message:'Pedido',url:'https://example.com/image'}).expect(422);expect(interpret).not.toHaveBeenCalled();
});
it('anexo próprio é conferido e transmitido por bytes, sem identificadores internos',async()=>{
 const bytes=Buffer.from('89504e470d0a1a0a01020304','hex');
 const u=await request(app).post('/api/assistant/assets').set('Authorization',`Bearer ${token}`).set('Content-Type','application/octet-stream').set('X-File-Name','logo.png').set('X-File-Type','image/png').send(bytes).expect(200);
 await call({message:'Logo 10 unidades',attachments:[u.body.id]}).expect(200);
 expect(interpret.mock.calls[0][0].attachments).toEqual([{name:'logo.png',mime:'image/png',data:bytes.toString('base64')}]);
 expect(JSON.stringify(interpret.mock.calls[0][0])).not.toContain(tenant);
 const meta=(await db.doc(`tenants/${tenant}/assets/${u.body.id}`).get()).data()!;files.set(meta.path,Buffer.from('corrupto'));
 await call({message:'Logo',attachments:[u.body.id]}).expect(503);
});
it('revogação durante a interpretação bloqueia retorno e novas chamadas',async()=>{
 interpret.mockImplementation(async()=>{await db.doc(`assistantLinks/${key}`).update({active:false});return {draft,transcript:'',warnings:[]}});
 await call({message:'Pedido'}).expect(403);await call({message:'Pedido'}).expect(403);expect(interpret).toHaveBeenCalledTimes(1);
});
it('rejeita chamadas simultâneas do mesmo vendedor',async()=>{
 let release:()=>void;const gate=new Promise<void>(r=>{release=r});
 let started:()=>void;const ready=new Promise<void>(r=>{started=r});
 interpret.mockImplementation(async()=>{started();await gate;return {draft,transcript:'',warnings:[]}});
 const first=call({message:'Pedido'}).then(r=>r);await ready;
 await call({message:'Pedido'}).expect(429);release!();expect((await first).status).toBe(200);
});

const actionResult = (intent: string, query = '', note = '') => ({draft:null,action:{intent,query,note,question:''},transcript:'',warnings:[]});
it('consulta somente pedidos autorizados e não cria rascunho nem modifica dados', async()=>{
 await db.doc(`tenants/${tenant}`).update({assistantSharedRequests:true});
 await db.doc(`tenants/${tenant}/customRequests/ORC-013`).set({title:'Botom NFC',customerName:'Arte Santista',requestedQuantity:5,status:'orcado',quotedPrice:80});
 await db.doc(`tenants/outra/customRequests/ORC-013`).set({title:'Segredo',customerName:'Arte Santista'});
 interpret.mockResolvedValue(actionResult('lookup','ORC-013'));
 const result=await call({message:'Como está o ORC-013?',conversation:true}).expect(200);
 expect(result.body.draft).toBeNull();expect(result.body.candidates).toHaveLength(1);
 expect(result.body.candidates[0]).toMatchObject({id:'ORC-013',title:'Botom NFC',status:'orcado'});
 expect(JSON.stringify(interpret.mock.calls[0][0])).not.toContain('quotedPrice');
 expect((await db.collection(`tenants/${tenant}/customRequests`).get()).size).toBe(1);
 const detail=await request(app).get('/api/assistant/requests/ORC-013').set('Authorization',`Bearer ${token}`).expect(200);
 expect(detail.body.quotedPrice).toBe(80);
});
it('consulta de link restrito não revela pedidos de outros vendedores nem aceita contexto alheio',async()=>{
 await db.doc(`tenants/${tenant}/customRequests/secret`).set({title:'Pedido Zalma',customerName:'Zalma'});
 interpret.mockResolvedValue(actionResult('lookup','Zalma'));
 const result=await call({message:'Como está Zalma?',conversation:true}).expect(200);
 expect(result.body.candidates).toEqual([]);
 await call({message:'Qual valor?',conversation:true,requestId:'secret'}).expect(404);
 expect(interpret).toHaveBeenCalledTimes(1);
});
it('complemento com múltiplos resultados exige seleção e não escreve até confirmação explícita',async()=>{
 await db.doc(`tenants/${tenant}`).update({assistantSharedRequests:true});
 for(const id of ['a','b']) await db.doc(`tenants/${tenant}/customRequests/${id}`).set({title:'Chaveiro',customerName:'Zalma',requestedQuantity:10,status:'aguardando-orcamento'});
 interpret.mockResolvedValue(actionResult('update','Zalma','Cliente pediu 20 unidades azuis.'));
 const result=await call({message:'Zalma quer 20 azuis',conversation:true}).expect(200);
 expect(result.body.candidates).toHaveLength(2);
 expect((await db.collection(`tenants/${tenant}/assistantRequests/a/notes`).get()).empty).toBe(true);
 const payload={operationId:randomUUID(),message:result.body.action.note,attachments:[]};
 for(let i=0;i<2;i++) await request(app).post('/api/assistant/requests/a/notes').set('Authorization',`Bearer ${token}`).send(payload).expect(200);
 expect((await db.collection(`tenants/${tenant}/assistantRequests/a/notes`).get()).size).toBe(1);
 expect((await db.doc(`tenants/${tenant}/customRequests/a`).get()).data()?.requestedQuantity).toBe(10);
});
it('usa contexto selecionado e referência explícita prevalece; perguntas sem referência pedem esclarecimento',async()=>{
 await db.doc(`tenants/${tenant}`).update({assistantSharedRequests:true});
 await db.doc(`tenants/${tenant}/customRequests/a`).set({title:'Primeiro'});
 await db.doc(`tenants/${tenant}/customRequests/b`).set({title:'Segundo'});
 interpret.mockResolvedValue(actionResult('lookup'));
 let r=await call({message:'E o valor?',conversation:true,requestId:'a'}).expect(200);
 expect(r.body.candidates[0].id).toBe('a');
 interpret.mockResolvedValue(actionResult('lookup','Segundo'));
 r=await call({message:'E o segundo?',conversation:true,requestId:'a'}).expect(200);
 expect(r.body.candidates[0].id).toBe('b');
 interpret.mockResolvedValue(actionResult('lookup'));
 r=await call({message:'Como está?',conversation:true}).expect(200);
 expect(r.body.action.intent).toBe('clarify');expect(r.body.draft).toBeNull();
});
it('falha de IA ou resposta sem intenção nunca converte consulta em novo orçamento',async()=>{
 interpret.mockRejectedValue(Error('offline'));
 let r=await call({message:'Qual valor?',conversation:true}).expect(200);
 expect(r.body.draft).toBeNull();expect(r.body.action.intent).toBe('clarify');
 interpret.mockResolvedValue({draft,transcript:'',warnings:[]});
 r=await call({message:'Qual valor?',conversation:true}).expect(200);expect(r.body.draft).toBeNull();
 r=await call({message:'Boneco 12cm',conversation:true,guided:true}).expect(200);expect(r.body.draft).toBeTruthy();
});

const productionRecord = () => db.doc(`tenants/${tenant}/customRequests/approved`);
const productionNotes = () => db.collection(`tenants/${tenant}/assistantRequests/approved/notes`);
async function approvalSetup(patch: any = {}) {
 await db.doc(`tenants/${tenant}`).update({assistantSharedRequests:true,assistantWorkflowUpdates:true});
 await productionRecord().set({title:'ORC-002 — Papel e Rosa',customerName:'Maria',status:'orcado',requestedQuantity:1,quotedPrice:28.9,
  description:'Descrição preservada',customerQuote:{name:'Chaveiro',size:'6 cm',options:[{quantity:1,unitPrice:28.9,deliveryDays:null},{quantity:10,unitPrice:22.5,deliveryDays:2}]} });
 const message='A Maria fechou as dez peças, entrega em 8 de novembro de 2026. Pode seguir!';
 interpret.mockResolvedValue({...actionResult('approve','Maria'),action:{intent:'approve',query:'Maria',note:'',question:'',approval:{quantity:10,deliveryDate:'2026-11-08',paid:false,personalization:[],evidence:message,...patch}}});
 return {operationId:randomUUID(),message,attachments:[],conversation:true};
}
it('aprovação natural executa quantidade, preço e entrega atomicamente; retry dispensa IA', async () => {
 const input=await approvalSetup();
 const aiResult=await interpret.getMockImplementation()!(); interpret.mockResolvedValue({...aiResult,transcript:'Observação em áudio'});
 const first=await call(input).expect(200);
 expect(first.body.transcript).toBe('Observação em áudio');
 expect(first.body.updatedRequestId).toBe('approved');
 expect((await productionRecord().get()).data()).toMatchObject({status:'fila-producao',requestedQuantity:10,quotedPrice:225,requestedDeliveryDate:'2026-11-08',description:'Descrição preservada'});
 expect((await productionRecord().get()).data()).not.toHaveProperty('paidAt');
 expect((await productionNotes().get()).docs[0].data()).toMatchObject({message:input.message,interpretation:'ai',paymentReported:false});
 await productionRecord().update({status:'produzindo'});
 interpret.mockRejectedValue(Error('não deveria chamar'));
 const retry=await call(input).expect(200);expect(retry.body).toEqual(first.body);
 expect(interpret).toHaveBeenCalledTimes(1);expect((await productionNotes().get()).size).toBe(1);
 await call({...input,message:'outro texto'}).expect(409);expect(interpret).toHaveBeenCalledTimes(1);
 expect((await productionRecord().get()).data()?.status).toBe('produzindo');
});
it('código explícito prevalece sobre pedido selecionado e pagamento explícito é registrado', async () => {
 const input=await approvalSetup({paid:true});
 const message='O ORC 2 está fechado e pago, pode seguir com dez peças';
 interpret.mockResolvedValue({...actionResult('approve','ORC-002'),action:{intent:'approve',query:'ORC-002',note:'',question:'',approval:{quantity:10,deliveryDate:null,paid:true,evidence:message,personalization:[]}}});
 await db.doc(`tenants/${tenant}/customRequests/selected`).set({title:'ORC-003',status:'orcado'});
 const result=await call({...input,message,requestId:'selected'}).expect(200);
 expect(result.body.updatedRequestId).toBe('approved');
 expect((await productionRecord().get()).data()?.paidAt).toEqual(expect.any(String));
 expect((await db.doc(`tenants/${tenant}/customRequests/selected`).get()).data()?.status).toBe('orcado');
});
it('aprovação do pedido selecionado pode omitir quantidade, prazo e referência', async () => {
 const input=await approvalSetup();const message='Cliente fechou, pode seguir com esse orçamento';
 interpret.mockResolvedValue({...actionResult('approve'),action:{intent:'approve',query:'',note:'',question:'',approval:{quantity:null,deliveryDate:null,paid:false,evidence:message,personalization:[]}}});
 await call({...input,message}).expect(200).then(r=>expect(r.body.action.intent).toBe('clarify'));
 expect((await productionNotes().get()).empty).toBe(true);
 await call({...input,message,requestId:'approved',operationId:randomUUID()}).expect(200);
 expect((await productionRecord().get()).data()).toMatchObject({status:'fila-producao',requestedQuantity:1,quotedPrice:28.9});
});
it.each(['duplicate','missing-price','disabled','frozen','changed-state','evidence','wrong-code','restricted'])('aprovação IA recusa %s sem gravação parcial', async kind => {
 const input=await approvalSetup();
 if(kind==='duplicate') await db.doc(`tenants/${tenant}/customRequests/duplicate`).set({title:'Outro da Maria',customerName:'Maria',status:'orcado'});
 if(kind==='missing-price') await productionRecord().update({customerQuote:null});
 if(kind==='disabled') await db.doc(`tenants/${tenant}`).update({assistantWorkflowUpdates:false});
 if(kind==='frozen') await db.doc(`tenants/${tenant}/inventoryControl/state`).set({phase:'frozen'});
 if(kind==='changed-state') interpret.mockImplementation(async()=>{
  await productionRecord().update({status:'finalizado'});
  return {...actionResult('approve','Maria'),action:{intent:'approve',query:'Maria',note:'',question:'',approval:{quantity:10,deliveryDate:null,paid:false,evidence:input.message,personalization:[]}}};
 });
 if(kind==='evidence') input.message='Veja aprovação no anexo';
 if(kind==='wrong-code') interpret.mockResolvedValue({...actionResult('approve','ORC-999'),action:{intent:'approve',query:'ORC-999',note:'',question:'',approval:{quantity:10,deliveryDate:null,paid:false,evidence:input.message,personalization:[]}}});
 if(kind==='restricted') await db.doc(`tenants/${tenant}`).update({assistantSharedRequests:false});
 // Sem total para a quantidade aprovada, o assistente pede conferência (200 + approvalReview)
 // em vez de recusar com 409; nos dois casos nada é gravado.
 const expected=['evidence','wrong-code'].includes(kind)?422:kind==='disabled'?403:kind==='missing-price'?200:409;
 const response=await call(input).expect(expected);
 if(kind==='missing-price') expect(response.body.action.intent).toBe('approvalReview');
 const row=(await productionRecord().get()).data()!;
 expect(row.status).toBe(kind==='changed-state'?'finalizado':'orcado');
 expect(row.requestedQuantity).toBe(1);expect(row).not.toHaveProperty('requestedDeliveryDate');
 expect((await productionNotes().get()).empty).toBe(true);
 expect((await db.collection(`assistantLinks/${key}/messageUpdates`).get()).empty).toBe(true);
});
it('dúvida, warnings e cliente antigo sem operationId pedem conferência sem aprovar', async () => {
 const input=await approvalSetup();
 const result=await interpret.getMockImplementation()!();
 interpret.mockResolvedValue({...result,warnings:['Confirme se são dez ou doze unidades.']});
 await call(input).expect(200).then(r=>expect(r.body.action.intent).toBe('clarify'));
 interpret.mockResolvedValue(result);
 await call({...input,operationId:undefined}).expect(200).then(r=>expect(r.body.action.intent).toBe('clarify'));
 expect((await productionRecord().get()).data()?.status).toBe('orcado');
});

it('código sozinho seleciona pedido único sem IA, consumo de cota ou escrita', async()=>{
 await db.doc(`tenants/${tenant}`).update({assistantSharedRequests:true});
 await db.doc(`tenants/${tenant}/customRequests/direct`).set({title:'ORC-008 Chaveiro',status:'orcado',requestedQuantity:1,quotedPrice:25.9});
 const result=await call({message:'ORC-008',conversation:true}).expect(200);
 expect(result.body.selectedRequestId).toBe('direct');
 expect(result.body.action.intent).toBe('lookup');
 expect(interpret).not.toHaveBeenCalled();
 expect((await db.doc(`assistantLinks/${key}`).get()).data()?.aiCount||0).toBe(0);
 expect((await db.collection(`tenants/${tenant}/assistantRequests/direct/notes`).get()).empty).toBe(true);
 await call({message:'ORC-008',conversation:true,attachments:['a'.repeat(64)]}).expect(422);
});
it('código duplicado ou fora do acesso não seleciona silenciosamente um pedido',async()=>{
 await db.doc(`tenants/${tenant}/customRequests/hidden`).set({title:'ORC-008',status:'orcado'});
 let result=await call({message:'ORC-008',conversation:true}).expect(200);
 expect(result.body.candidates).toEqual([]);expect(result.body.selectedRequestId).toBeUndefined();
 await db.doc(`tenants/${tenant}`).update({assistantSharedRequests:true});
 await db.doc(`tenants/${tenant}/customRequests/duplicate`).set({title:'ORC-008',status:'orcado'});
 result=await call({message:'ORC-008',conversation:true}).expect(200);
 expect(result.body.candidates).toHaveLength(2);expect(result.body.selectedRequestId).toBeUndefined();
 expect(interpret).not.toHaveBeenCalled();
});

it('prepara um relato de venda aprovado sem buscar pedido existente nem gravar antes da confirmação', async()=>{
 await db.doc(`tenants/${tenant}`).update({assistantWorkflowUpdates:true});
 const r=await call({conversation:true,operationId:randomUUID(),message:'2 potes, Cliente: Barbara, aprovado para produzir\nCada 49,90, Nome: Emerson e Yuri Aberto\nEntregar 07/11/2099',attachments:[]}).expect(200);
 expect(r.body).toMatchObject({draft:{customerName:'Barbara',quantity:2},initialStage:{status:'fila-producao',quotedPrice:99.8,unitPrice:49.9,deliveryDate:'2099-11-07'}});
 expect(interpret).not.toHaveBeenCalled();
 expect((await db.collection(`tenants/${tenant}/customRequests`).get()).empty).toBe(true);
});
