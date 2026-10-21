import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { changeRequestStatuses } from '../../src/features/requests/bulk-status';
let env: RulesTestEnvironment;
const quote={title:'Pedido QA',type:'orcamento',status:'aguardando-orcamento',requestedQuantity:10,productionTimeHours:0,filaments:[],quotedPrice:80,updatedAt:'2026-10-21'};
beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-lablayer-test',firestore:{host:'127.0.0.1',port:8088,rules:readFileSync('firestore.rules','utf8')}})});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'tenants/a'),{ownerUid:'a',status:'active'});
  await setDoc(doc(db,'users/member'),{tenantId:'a',tenantRole:'member',role:'user'});
  for(const id of ['one','two','untouched'])await setDoc(doc(db,`tenants/a/customRequests/${id}`),quote);
 });
});
afterAll(async()=>env.cleanup());
it('lote autorizado muda só status/data e preserva valores e itens não selecionados',async()=>{
 const db=env.authenticatedContext('a').firestore();
 await assertSucceeds(changeRequestStatuses(db as any,'a',['one','two'],'orcado'));
 for(const id of ['one','two'])expect((await getDoc(doc(db,`tenants/a/customRequests/${id}`))).data()).toMatchObject({...quote,status:'orcado',updatedAt:expect.any(String)});
 expect((await getDoc(doc(db,'tenants/a/customRequests/untouched'))).data()).toEqual(quote);
});
it('documento inexistente ou outro tenant impedem todo o lote',async()=>{
 const db=env.authenticatedContext('a').firestore();
 await assertFails(changeRequestStatuses(db as any,'a',['one','missing'],'orcado'));
 expect((await getDoc(doc(db,'tenants/a/customRequests/one'))).data()).toEqual(quote);
 await assertFails(changeRequestStatuses(env.authenticatedContext('outsider').firestore() as any,'a',['one','two'],'orcado'));
});
it('rejeita status inválido, ids duplicados e lote excessivo antes de escrever',async()=>{
 const db=env.authenticatedContext('a').firestore();
 for(const [ids,status] of [[['one'],'invalid'],[['one','one'],'orcado'],[Array.from({length:101},(_,i)=>String(i)),'orcado'],[[],'orcado']] as any)
   await expect(changeRequestStatuses(db as any,'a',ids,status)).rejects.toThrow('Selecione');
 expect((await getDoc(doc(db,'tenants/a/customRequests/one'))).data()).toEqual(quote);
});
it('finaliza lote misto de pedidos antigos com observation preservando a observação',async()=>{
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'tenants/a/customRequests/legacy'),{...quote,observation:'Observação histórica do cliente'}));
 const db=env.authenticatedContext('a').firestore();
 await assertSucceeds(changeRequestStatuses(db as any,'a',['one','legacy'],'finalizado'));
 expect((await getDoc(doc(db,'tenants/a/customRequests/one'))).data()?.status).toBe('finalizado');
 expect((await getDoc(doc(db,'tenants/a/customRequests/legacy'))).data()).toMatchObject({status:'finalizado',observation:'Observação histórica do cliente',requestedQuantity:10,quotedPrice:80});
});
it('compatibilidade não aceita observação inválida nem campos desconhecidos',async()=>{
 const db=env.authenticatedContext('a').firestore();
 for(const extra of [{observation:42},{observation:'x'.repeat(5001)},{unknownField:'não permitido'}]){
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'tenants/a/customRequests/invalid'),{...quote,...extra}));
  await assertFails(changeRequestStatuses(db as any,'a',['one','invalid'],'finalizado'));
  expect((await getDoc(doc(db,'tenants/a/customRequests/one'))).data()).toEqual(quote);
 }
});
