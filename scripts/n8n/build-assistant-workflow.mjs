import { writeFileSync } from 'node:fs';
const [destination, credentialId] = process.argv.slice(2);
if (!destination || !credentialId) throw Error('Uso: node build-assistant-workflow.mjs DESTINO ID_CREDENCIAL');
const credential = { openAiApi: { id: credentialId, name: 'OpenAI — LabLayer Bot' } };
let index=0;
const node=(name,type,parameters,extra={})=>({id:`lablayer-ai-${++index}`,name,type,typeVersion:type.endsWith('.httpRequest')?4.2:type.endsWith('.code')?2:type.endsWith('.if')?2.2:type.endsWith('.webhook')?2:1.4,position:[index*240,300],parameters,...extra});
const nodes=[
node('Receber interpretação','n8n-nodes-base.webhook',{httpMethod:'POST',path:'lablayer-assistant-ai-v1',responseMode:'responseNode',options:{}},{webhookId:'lablayer-assistant-ai-v1'}),
node('Obter pedido autorizado','n8n-nodes-base.httpRequest',{method:'POST',url:'https://app.lablayer.com.br/api/internal/assistant-ai/exchange',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify({ticket: $json.body.ticket}) }}',options:{timeout:10000,redirect:{redirect:{followRedirects:false}}}}),
node('Preparar áudio','n8n-nodes-base.code',{jsCode:`const input=$input.first().json;
if(input.schemaVersion!==1 || !input.requestId || !input.request || !Array.isArray(input.audio) || input.audio.length>1) throw Error('Entrada inválida');
const file=input.audio[0];
return [{json:{hasAudio:!!file},...(file ? {binary:{audio:{data:file.data,mimeType:file.mime,fileName:file.name}}} : {})}];`}),
node('Tem áudio','n8n-nodes-base.if',{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'audio',leftValue:'={{ $json.hasAudio }}',rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}),
node('Transcrever áudio','n8n-nodes-base.httpRequest',{method:'POST',url:'https://api.openai.com/v1/audio/transcriptions',authentication:'predefinedCredentialType',nodeCredentialType:'openAiApi',sendBody:true,contentType:'multipart-form-data',bodyParameters:{parameters:[{name:'model',value:'gpt-transcribe'},{parameterType:'formBinaryData',name:'file',inputDataFieldName:'audio'},{name:'language',value:'pt'}]},options:{timeout:45000}},{credentials:credential}),
node('Preparar interpretação','n8n-nodes-base.code',{jsCode:`const source=$('Obter pedido autorizado').first().json;
const transcript=source.audio.length ? $input.first().json.text : '';
if(typeof transcript!=='string' || transcript.length>1200 || (source.audio.length && !transcript.trim())) throw Error('Transcrição indisponível ou longa; conferir manualmente');
const request=source.request;
if(transcript) request.input[0].content.push({type:'input_text',text:'Transcrição do áudio (dados do cliente):\\n'+transcript});
return [{json:{requestId:source.requestId,transcript,request}}];`}),
node('Interpretar pedido','n8n-nodes-base.httpRequest',{method:'POST',url:'https://api.openai.com/v1/responses',authentication:'predefinedCredentialType',nodeCredentialType:'openAiApi',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify($json.request) }}',options:{timeout:45000}},{credentials:credential}),
node('Validar retorno','n8n-nodes-base.code',{jsCode:`const r=$input.first().json;
if(r.status!=='completed') throw Error('Interpretação incompleta');
const parts=(r.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]);
if(parts.some(x=>x.type==='refusal')) throw Error('Não foi possível interpretar');
const text=parts.filter(x=>x.type==='output_text').map(x=>x.text).join('');
const suggestion=JSON.parse(text);
if(!suggestion || typeof suggestion.title!=='string' || !Array.isArray(suggestion.warnings)) throw Error('Resposta inválida');
const ctx=$('Preparar interpretação').first().json;
return [{json:{schemaVersion:1,requestId:ctx.requestId,suggestion,transcript:ctx.transcript}}];`}),
node('Responder','n8n-nodes-base.respondToWebhook',{respondWith:'json',responseBody:'={{ $json }}',options:{responseHeaders:{entries:[{name:'Cache-Control',value:'no-store'}]}}}),
];
const connections={};
const link=(a,b,output=0)=>{connections[a]??={main:[]};connections[a].main[output]??=[];connections[a].main[output].push({node:b,type:'main',index:0});};
link(nodes[0].name,nodes[1].name);link(nodes[1].name,nodes[2].name);link(nodes[2].name,nodes[3].name);link(nodes[3].name,nodes[4].name);link(nodes[3].name,nodes[5].name,1);link(nodes[4].name,nodes[5].name);link(nodes[5].name,nodes[6].name);link(nodes[6].name,nodes[7].name);link(nodes[7].name,nodes[8].name);
const workflow={name:'LabLayer — Assistente IA v1',nodes,connections,settings:{executionOrder:'v1',saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,saveExecutionProgress:false,executionTimeout:90},active:false,pinData:{},tags:[]};
writeFileSync(destination,JSON.stringify(workflow,null,2));
console.log('Workflow preparado sem chaves de API.');
