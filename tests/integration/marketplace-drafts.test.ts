import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import request from 'supertest';
import { registerMarketplaceDraftRoutes } from '../../server/marketplace-drafts';
const firebase = initializeApp({ projectId:'demo-lablayer-test' }, 'listing-drafts');
const db = getFirestore(firebase), remote = vi.fn<typeof fetch>();
const token = 'll_drafts_test-secret', hash = (s:string)=>createHash('sha256').update(s).digest('hex');
const objects = new Map<string,Buffer>();
const store = { put:vi.fn(async (path:string,bytes:Buffer)=>{objects.set(path,bytes);}), get:vi.fn(async(path:string)=>{ const bytes=objects.get(path);if(!bytes)throw Error();return bytes; }) };
const app = express(); app.use(express.json());
const creds={revision:1}, connection={status:'connected',userId:'123',connectedAt:'v1',credentialRevision:1};
registerMarketplaceDraftRoutes(app,db,async t=>{ if (!['owner','member'].includes(t)) throw Error(); return {uid:t} as any; },
  async()=>({accessToken:'private-provider-token',context:{creds,connection}}),vi.fn(),remote,store);
const base='/api/tenants/a/listing-drafts';
const data = { externalId:'produto-1',title:'Chaveiro personalizado',description:'Chaveiro em PLA.',price:25.9,quantity:5,pictures:['https://example.com/image.jpg'],categoryId:'MLB123',attributes:[{id:'BRAND',value_name:'LabLayer'}] };
const post=(path:string,body:any,auth=token)=>request(app).post(path).set('Authorization',`Bearer ${auth}`).send(body);
const get=(path=base,auth=token)=>request(app).get(path).set('Authorization',`Bearer ${auth}`);
const response=(body:any,status=200)=>new Response(JSON.stringify(body),{status});
let description:string|undefined, item:any, userProducts:boolean;
const creates=()=>remote.mock.calls.filter(([url,init])=>String(url).endsWith('/items')&&init?.method==='POST');
const act=(id:string,action:string,revision=1,auth='owner')=>post(`${base}/${id}/actions`,{action,revision},auth);
async function draft(){return (await post(base,data).expect(201)).body;}
beforeEach(async()=>{
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents',{method:'DELETE'});
  await db.doc('tenants/a').set({ownerUid:'owner',status:'active'});
  await db.doc('users/member').set({tenantId:'a',tenantRole:'member'});
  await db.doc(`privateMarketplaceDraftKeys/${hash(token)}`).set({id:'key1',active:true,tenantId:'a',createdBy:'owner',scopes:['listing-drafts:read','listing-drafts:write']});
  await db.doc('privateMarketplaceCredentials/a').set(creds); await db.doc('privateMarketplaceConnections/a').set(connection);
  objects.clear();store.put.mockClear();store.get.mockClear();
  description=undefined; userProducts=true; item={id:'MLB900',seller_id:123,status:'active',permalink:'https://produto.mercadolivre.com.br/MLB-900'};
  remote.mockReset().mockImplementation(async(url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/users/me') return response({id:123,tags:userProducts?['user_product_seller']:[]});
    if(path==='/items/validate')return response({});
    if(path==='/items')return response(item,201);
    if(path.endsWith('/description')){
      if(init?.method==='POST'||init?.method==='PUT') description=JSON.parse(init.body as string).plain_text;
      return description===undefined?response({},404):response({plain_text:description});
    }
    return response(item);
  });
});
afterAll(async()=>{await db.terminate();await deleteApp(firebase);});
it('chave cria rascunho idempotente, sem chamar Mercado Livre, e não publica nem aprova',async()=>{
  const d=await draft(); await post(base,data).expect(200);
  expect((await get()).body.drafts).toHaveLength(1); expect(d.status).toBe('draft');
  await act(d.id,'approve',1,token).expect(403); await act(d.id,'publish',1,token).expect(403);
  await post(base,{...data,status:'approved'}).expect(400); expect(remote).not.toHaveBeenCalled();
  const audit=(await db.collection('tenants/a/auditLogs').get()).docs[0].data(); expect(audit.actor).toBe('key:key1');
  expect(JSON.stringify(audit)).not.toContain(token);
});
it('bloqueia outra empresa, chave revogada, empresa inativa e usuário sem administração',async()=>{
  const d=await draft(); await get('/api/tenants/b/listing-drafts').expect(403); await get(base,'invalid').expect(401);
  await get(base,'member').expect(200); await act(d.id,'approve',1,'member').expect(403);
  await db.doc(`privateMarketplaceDraftKeys/${hash(token)}`).update({active:false}); await get().expect(401);
  await db.doc('tenants/a').update({status:'inactive'}); await get(base,'owner').expect(403); expect(remote).not.toHaveBeenCalled();
});
it('alteração exige revisão, preserva referência e remove aprovação',async()=>{
  const d=await draft(); await act(d.id,'approve').expect(200);
  await post(`${base}/${d.id}/save`,{revision:0,data}).expect(409);
  await post(`${base}/${d.id}/save`,{revision:1,data:{...data,externalId:'other'}}).expect(400);
  const r=await post(`${base}/${d.id}/save`,{revision:1,data:{...data,price:30}}).expect(200);
  expect(r.body).toMatchObject({revision:2,status:'draft',data:{price:30}});
  await act(d.id,'publish',2).expect(409); await act(d.id,'approve',1).expect(409); expect(creates()).toHaveLength(0);
  await post(base,data).expect(409);
});
it('valida no provedor, aprova separado e publica uma vez com descrição e auditoria',async()=>{
  const d=await draft(); await act(d.id,'publish').expect(409);
  await act(d.id,'approve').expect(200); expect(creates()).toHaveLength(0);
  const validations=remote.mock.calls.filter(([u])=>String(u).endsWith('/items/validate'));
  expect(JSON.parse(validations[0][1]!.body as string)).toMatchObject({family_name:data.title});
  expect(JSON.parse(validations[0][1]!.body as string)).not.toHaveProperty('title');
  const result=await act(d.id,'publish').expect(200); expect(result.body).toMatchObject({status:'published',itemId:'MLB900',remoteStatus:'active'});
  await act(d.id,'publish').expect(200); expect(creates()).toHaveLength(1); expect(description).toBe(data.description);
  await post(`${base}/${d.id}/save`,{revision:1,data}).expect(409);
  const audit=(await db.collection('tenants/a/auditLogs').get()).docs.map(x=>x.data().operation);
  expect(audit).toContain('marketplace.draft.published'); expect((await db.collection('tenants/a/products').get()).size).toBe(0);
});
it('conta sem User Products usa título; validação recusada mantém rascunho',async()=>{
  const d=await draft();userProducts=false;
  const original=remote.getMockImplementation()!;
  remote.mockImplementation(async(u,i)=>String(u).endsWith('/items/validate')?response({cause:[{code:'item.attributes.missing_required',message:'provider-token-secret'}]},400):original(u,i));
  const r=await act(d.id,'approve').expect(422);expect(r.body.error).toContain('item.attributes.missing_required');expect(JSON.stringify(r.body)).not.toContain('provider-token-secret');
  expect((await get(`${base}/${d.id}`)).body.status).toBe('draft');
  const validation=remote.mock.calls.find(([u])=>String(u).endsWith('/items/validate'))!;
  expect(JSON.parse(validation[1]!.body as string)).toHaveProperty('title',data.title);expect(creates()).toHaveLength(0);
});
it('bloqueia conexão trocada após aprovação e revogação durante a validação',async()=>{
  const d=await draft(); await act(d.id,'approve').expect(200);
  await db.doc('privateMarketplaceConnections/a').update({userId:'456'}); await act(d.id,'publish').expect(409); expect(creates()).toHaveLength(0);
  await db.doc('privateMarketplaceConnections/a').set(connection);
  const original=remote.getMockImplementation()!;
  remote.mockImplementation(async(u,i)=>{if(String(u).endsWith('/items/validate'))await db.doc('tenants/a').update({status:'inactive'});return original(u,i);});
  await act(d.id,'approve').expect(403);
});
it('duas publicações concorrentes só criam um anúncio',async()=>{
  const d=await draft();await act(d.id,'approve').expect(200);
  const r=await Promise.all([act(d.id,'publish'),act(d.id,'publish')]);
  expect(r.some(x=>x.status===200)).toBe(true);expect(creates()).toHaveLength(1);
});
it('timeout ao criar bloqueia reenvio mesmo após nova requisição',async()=>{
  const d=await draft();await act(d.id,'approve').expect(200);
  const original=remote.getMockImplementation()!;
  remote.mockImplementation(async(u,i)=>{if(String(u).endsWith('/items')&&i?.method==='POST')throw Error('timeout');return original(u,i);});
  await act(d.id,'publish').expect(502); expect((await get(`${base}/${d.id}`)).body.status).toBe('attention');
  await act(d.id,'publish').expect(409); await act(d.id,'complete').expect(409); expect(creates()).toHaveLength(1);
});
it('falha na descrição guarda item e conclui sem recriar',async()=>{
  const d=await draft();await act(d.id,'approve').expect(200);
  const original=remote.getMockImplementation()!;
  remote.mockImplementation(async(u,i)=>String(u).endsWith('/description')&&i?.method==='POST'?response({},503):original(u,i));
  await act(d.id,'publish').expect(502);expect((await get(`${base}/${d.id}`)).body).toMatchObject({status:'attention',itemId:'MLB900'});
  remote.mockImplementation(original);await act(d.id,'complete').expect(200);expect(creates()).toHaveLength(1);
});
it('rejeição explícita permite corrigir e exige nova aprovação',async()=>{
  const d=await draft();await act(d.id,'approve').expect(200);
  const original=remote.getMockImplementation()!;
  remote.mockImplementation(async(u,i)=>String(u).endsWith('/items')&&i?.method==='POST'?response({},400):original(u,i));
  await act(d.id,'publish').expect(422); expect((await get(`${base}/${d.id}`)).body.status).toBe('draft');await act(d.id,'publish').expect(409);
});
it('rascunho incompleto é aceito mas não pode ser aprovado',async()=>{
  const d=(await post(base,{...data,categoryId:'',pictures:[],price:0}).expect(201)).body;
  await act(d.id,'approve').expect(400); expect(creates()).toHaveLength(0);
});

const photo = async()=>sharp({create:{width:48,height:32,channels:4,background:{r:33,g:55,b:77,alpha:0.5}}}).png().toBuffer();
const upload = (bytes:Buffer,mime='image/png',auth=token,tenant='a')=>request(app).post(`/api/tenants/${tenant}/listing-drafts/photos`).set('Authorization',`Bearer ${auth}`).set('Content-Type',mime).send(bytes);
it('upload gera JPEG hospedado, link estável e pode ser anexado sem aprovar/publicar',async()=>{
 const bytes=await photo(), first=(await upload(bytes).expect(201)).body;
 expect(first).toMatchObject({mime:'image/jpeg',width:48,height:32});expect(first.url).toMatch(/^https:\/\/app\.lablayer\.com\.br\/api\/listing-photos\/[a-f0-9]{64}\.jpg$/);
 expect((await upload(bytes).expect(200)).body).toEqual(first);expect(objects.size).toBe(1);
 const r=await request(app).get(new URL(first.url).pathname).expect(200);
 expect(r.headers['content-type']).toContain('image/jpeg');expect(r.headers['x-content-type-options']).toBe('nosniff');
 const info=await sharp(r.body).metadata();expect(info.format).toBe('jpeg');expect(info.exif).toBeUndefined();
 const d=(await post(base,{...data,pictures:[first.url]}).expect(201)).body;
 expect(d.data.pictures).toEqual([first.url]);expect(d.status).toBe('draft');expect(remote).not.toHaveBeenCalled();
 expect((await db.collection('privateMarketplaceDraftPhotos').get()).size).toBe(1);
 expect((await db.collection('tenants/a/auditLogs').where('operation','==','marketplace.draft.photo-uploaded').get()).size).toBe(1);
});
it('upload valida autenticação, empresa, escopo e responsável antes de gravar',async()=>{
 const bytes=await photo();await upload(bytes,'image/png','invalid').expect(401);await upload(bytes,'image/png',token,'b').expect(403);await upload(bytes,'image/png','member').expect(403);
 await db.doc(`privateMarketplaceDraftKeys/${hash(token)}`).update({scopes:['listing-drafts:read']});await upload(bytes).expect(403);
 await db.doc(`privateMarketplaceDraftKeys/${hash(token)}`).update({active:false});await upload(bytes).expect(401);expect(store.put).not.toHaveBeenCalled();
});
it('upload rejeita HTML, SVG, conteúdo falso, tipo divergente e arquivos acima de 10 MiB',async()=>{
 await upload(Buffer.from('<svg/>'),'image/svg+xml').expect(415);await upload(Buffer.from('<html>bad</html>')).expect(422);
 await upload(await photo(),'image/jpeg').expect(422);await upload(Buffer.alloc(10*1024*1024+1)).expect(413);
 await upload(Buffer.alloc(0)).expect(400);expect(store.put).not.toHaveBeenCalled();
 await request(app).get('/api/listing-photos/not-a-photo.jpg').expect(404);await request(app).get('/api/listing-photos/'+'0'.repeat(64)+'.jpg').expect(404);
});
it('revogação durante gravação não expõe a imagem; retry recupera falha sem duplicar',async()=>{
 const bytes=await photo(), original=store.put.getMockImplementation()!;
 store.put.mockImplementationOnce(async(path,b)=>{await original(path,b);await db.doc(`privateMarketplaceDraftKeys/${hash(token)}`).update({active:false});});
 await upload(bytes).expect(401);expect((await db.collection('privateMarketplaceDraftPhotos').get()).size).toBe(0);
 await db.doc(`privateMarketplaceDraftKeys/${hash(token)}`).update({active:true});await upload(bytes).expect(201);expect(objects.size).toBe(1);
});
it('uploads simultâneos do mesmo conteúdo retornam o mesmo link',async()=>{
 const bytes=await photo(),results=await Promise.all([upload(bytes),upload(bytes)]);
 expect(results.every(r=>[200,201].includes(r.status))).toBe(true);expect(results[0].body.url).toBe(results[1].body.url);
 expect((await db.collection('privateMarketplaceDraftPhotos').get()).size).toBe(1);expect(objects.size).toBe(1);
});
