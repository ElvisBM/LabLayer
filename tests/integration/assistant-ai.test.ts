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
