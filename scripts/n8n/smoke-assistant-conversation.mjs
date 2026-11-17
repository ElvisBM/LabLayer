// Runs only against the isolated tenant created by smoke-assistant-ai.mjs prepare.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire('/var/www/lablayer/app/package.json');
const {initializeApp,cert}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
initializeApp({credential:cert(JSON.parse(readFileSync('/var/www/lablayer/shared/firebase-service-account.json','utf8')))});
const db=getFirestore(undefined,'ai-studio-914d19ee-caef-46d9-9cf8-561cc915d716');
const tenant='assistant-ai-smoke-20261021',dir='/home/lablayer/releases/assistant-ai-20261021';
const token=readFileSync(`${dir}/smoke-token.txt`,'utf8');
const company=db.doc(`tenants/${tenant}`);
if(!(await company.get()).exists)throw Error('Isolated fixture missing');
await company.update({assistantSharedRequests:true});
const base=`tenants/${tenant}/customRequests`;
for(const [id,title] of [['ORC-QA-001','Chaveiro QA'],['ORC-QA-002','Boneco QA']]) await db.doc(`${base}/${id}`).set({title,customerName:'Cliente QA Sintetico',requestedQuantity:10,status:'orcado',quotedPrice:80,description:'Referência sintética azul',createdAt:new Date().toISOString()});
const results=[];
const call=async(path,body)=>{
 const r=await fetch('https://app.lablayer.com.br'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(100000)});
 const data=await r.json();if(!r.ok)throw Error(`HTTP ${r.status}: ${data.error}`);return data;
};
function check(name,passed,extra={}){results.push({name,passed,...extra});console.log(JSON.stringify({name,passed}));writeFileSync('/home/lablayer/releases/assistant-conversation-20261021/smoke-results.json',JSON.stringify(results,null,2));if(!passed)throw Error(name);}
const tests=[
 ['criação','Novo orçamento: cliente QA Novo, 7 chaveiros verdes, 4cm.','create'],
 ['consulta específica','Qual o valor e situação do ORC-QA-001?','lookup'],
 ['consulta ambígua','Como estão os pedidos do Cliente QA Sintetico?','lookup'],
 ['pedido inexistente','Qual o valor do pedido do Cliente InexistenteXYZ?','lookup'],
 ['solicitar atualização do andamento','Tem alguma atualização do pedido ORC-QA-001?','lookup'],
 ['complemento','Acrescente ao pedido ORC-QA-001: cliente confirmou a cor verde e quer 20 unidades.','update'],
 ['contexto selecionado','E o valor?','lookup'],
 ['referência ausente','Qual o status do pedido?','clarify'],
];
let note='';
for(const [name,message,intent] of tests){
 const r=await call('/api/assistant/draft',{conversation:true,message,...(name==='contexto selecionado'?{requestId:'ORC-QA-001'}:{})});
 check(name,r.action?.intent===intent&&(intent==='create'?r.draft?.quantity===7:r.draft===null),{intent:r.action?.intent,candidates:r.candidates?.length});
 if(name==='consulta específica'||name==='contexto selecionado')check(name+' identifica',r.candidates?.length===1&&r.candidates[0].id==='ORC-QA-001');
 if(name==='consulta ambígua')check('ambiguidade preservada',r.candidates?.length===2);
 if(name==='pedido inexistente')check('não inventa cadastro',r.candidates?.length===0);
 if(intent==='update')note=r.action.note;
}
check('interpretação não grava', (await db.collection(base).get()).size===2&&(await db.collection(`tenants/${tenant}/assistantRequests/ORC-QA-001/notes`).get()).empty);
const payload={operationId:randomUUID(),message:note,attachments:[]};
await call('/api/assistant/requests/ORC-QA-001/notes',payload);await call('/api/assistant/requests/ORC-QA-001/notes',payload);
const detail=await call('/api/assistant/requests/ORC-QA-001');
check('confirmação idempotente e valores reais',detail.notes.length===1&&detail.notes[0].message===note&&detail.quantity===10&&detail.quotedPrice===80&&detail.status==='orcado');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const rows=await db.collection('tenants/5byAJZJsXDhUKYtdYKpqIaTzaUQ2/customRequests').get();
const digest=createHash('sha256').update(JSON.stringify(canonical(rows.docs.map(d=>({id:d.id,data:d.data()})).sort((a,b)=>a.id.localeCompare(b.id))))).digest('hex');
check('orçamentos reais preservados',digest===JSON.parse(readFileSync(`${dir}/before.json`,'utf8')).digest,{count:rows.size});
