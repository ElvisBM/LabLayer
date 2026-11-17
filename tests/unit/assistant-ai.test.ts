import { expect, it, vi } from 'vitest';
import { N8nAssistantAi, openAiRequest, validateAiResponse, aiProductionCommand } from '../../server/assistant-ai';
const input={message:'Boneca 12cm',attachments:[]};
const suggestion={title:'Boneca',customerName:'',description:'12cm',quantity:null,warnings:['Confirmar quantidade']};
const output=(requestId='id')=>({schemaVersion:1,requestId,suggestion,transcript:''});
it('quantidade ausente vira uma unidade provisória; rejeita medidas, campos extras e dados excessivos',()=>{
 expect(validateAiResponse(output(),'id').draft).toMatchObject({quantity:1,provisionalQuantity:true});
 for(const quantity of [-1,0,1.2,'12',100001,undefined]) expect(()=>validateAiResponse({...output(),suggestion:{...suggestion,quantity}},'id')).toThrow();
 expect(()=>validateAiResponse({...output(),suggestion:{...suggestion,quotedPrice:10}},'id')).toThrow();
 expect(()=>validateAiResponse(output(),'outro')).toThrow();
 expect(()=>validateAiResponse({...output(),transcript:'x'.repeat(1201)},'id')).toThrow();
});
it('pedido à OpenAI usa esquema estrito, sem armazenamento nem ferramentas e não inclui áudio na visão',()=>{
 const r=openAiRequest({...input,attachments:[{name:'x.png',mime:'image/png',data:'image'},{name:'x.wav',mime:'audio/wav',data:'audio'}]});
 expect(r.model).toBe("gpt-6-luna"); expect(r.reasoning.effort).toBe("none"); expect(r.store).toBe(false); expect(r.text.format.strict).toBe(true); expect(r).not.toHaveProperty('tools');
 expect(JSON.stringify(r)).toContain('data:image/png;base64,image'); expect(JSON.stringify(r)).not.toContain('base64,audio');
});
it('ticket é de uso único, opaco, e autorização é revalidada ao trocar e retornar',async()=>{
 const authorize=vi.fn(async()=>{}); let ai:N8nAssistantAi;
 ai=new N8nAssistantAi('https://n8n.lablayer.com.br/webhook/test',async(_url,opts)=>{
  const body=JSON.parse(opts!.body as string); expect(Object.keys(body)).toEqual(['ticket']);
  const exchanged=await ai.exchange(body.ticket);
  expect(exchanged).not.toHaveProperty('tenantId'); expect(exchanged).not.toHaveProperty('token');
  await expect(ai.exchange(body.ticket)).rejects.toThrow();
  return new Response(JSON.stringify(output(exchanged.requestId)));
 });
 expect((await ai.interpret(input,authorize)).draft.quantity).toBe(1); expect(authorize).toHaveBeenCalledTimes(2);
});
it('ticket vencido, fluxo sem troca, domínio arbitrário e revogação falham fechados',async()=>{
 expect(()=>new N8nAssistantAi('https://example.com/webhook/test')).toThrow();
 let clock=0, ai:N8nAssistantAi;
 ai=new N8nAssistantAi('https://n8n.lablayer.com.br/webhook/test',async(_url,opts)=>{
  const {ticket}=JSON.parse(opts!.body as string); clock=31000; await expect(ai.exchange(ticket)).rejects.toThrow();
  return new Response('{}');
 },()=>clock);
 await expect(ai.interpret(input,async()=>{})).rejects.toThrow();
 const missing=new N8nAssistantAi('https://n8n.lablayer.com.br/webhook/test',async()=>new Response('{}'));
 await expect(missing.interpret(input,async()=>{})).rejects.toThrow();
 let revoked:N8nAssistantAi;
 revoked=new N8nAssistantAi('https://n8n.lablayer.com.br/webhook/test',async(_url,opts)=>{
  const {ticket}=JSON.parse(opts!.body as string); await revoked.exchange(ticket); return new Response('{}');
 });
 await expect(revoked.interpret(input,async()=>{throw Error('revogado')})).rejects.toThrow('revogado');
});
it('limita resposta, falhas não vazam segredo e tickets são eliminados ao falhar',async()=>{
 let ticket='',ai:N8nAssistantAi;
 ai=new N8nAssistantAi('https://n8n.lablayer.com.br/webhook/test',async(_url,opts)=>{
  ticket=JSON.parse(opts!.body as string).ticket; await ai.exchange(ticket); return new Response('x'.repeat(65537));
 });
 await expect(ai.interpret(input,async()=>{})).rejects.toThrow('Resposta excessiva'); await expect(ai.exchange(ticket)).rejects.toThrow();
});
it('contrato conversacional separa consulta, complemento e criação; rejeita intenção inválida',()=>{
 const r=openAiRequest({...input,conversation:true,selectedRequest:true});
 expect(r.text.format.schema.required).toContain('intent');
 const s={...suggestion,title:'',description:'',intent:'lookup',query:'ORC-013',note:'',question:''};
 expect(validateAiResponse({...output(),suggestion:s},'id',true)).toMatchObject({draft:null,action:{intent:'lookup',query:'ORC-013'}});
 for(const patch of [{intent:'delete'},{note:'x'.repeat(2001)},{query:'x'.repeat(151)},{intent:'update',note:''}])
   expect(()=>validateAiResponse({...output(),suggestion:{...s,...patch}},'id',true)).toThrow();
 expect(()=>validateAiResponse(output(),'id',true)).toThrow();
 expect(validateAiResponse({...output(),suggestion:{...suggestion,intent:'create',query:'',note:'',question:''}},'id',true).draft?.quantity).toBe(1);
});

const approval = { quantity: 10, deliveryDate: '2026-11-08', paid: false, evidence: 'a Maria fechou as dez peças', personalization: [] };
const approvalSuggestion = () => ({ title:'', customerName:'', description:'', quantity:null, warnings:[], intent:'approve', query:'Maria', note:'', question:'', approval });
it('aceita aprovação estruturada com campos estritos e preserva ausência de pagamento', () => {
 const value = validateAiResponse({...output(), suggestion:approvalSuggestion()}, 'id', true);
 expect(value).toMatchObject({draft:null, action:{intent:'approve', approval}});
 expect(openAiRequest({...input,conversation:true}).text.format.schema.properties).toHaveProperty('approval');
});
it.each([{quantity:0},{quantity:1.2},{quantity:100001},{deliveryDate:'2026-02-30'},{deliveryDate:'08/11/2026'},{paid:'sim'},{evidence:''},{personalization:[{name:'Maria',quantity:9}]},{quotedPrice:10}])('rejeita aprovação malformada: %j', patch => {
 expect(() => validateAiResponse({...output(),suggestion:{...approvalSuggestion(),approval:{...approval,...patch}}},'id',true)).toThrow();
});
it('não aceita aprovação ausente nem escondida em intenção de consulta', () => {
 expect(() => validateAiResponse({...output(),suggestion:{...approvalSuggestion(),approval:null}},'id',true)).toThrow();
 expect(() => validateAiResponse({...output(),suggestion:{...approvalSuggestion(),intent:'lookup'}},'id',true)).toThrow();
});

it('vincula a interpretação ao texto do vendedor e impede referências inventadas', () => {
 const action = validateAiResponse({...output(),suggestion:approvalSuggestion()},'id',true).action!;
 expect(aiProductionCommand(action, 'a Maria fechou as dez peças')).toMatchObject({query:'Maria',command:{code:null,quantity:10,paid:false}});
 expect(() => aiProductionCommand(action, 'Veja o áudio anexo')).toThrow(/texto enviado/);
 expect(() => aiProductionCommand({...action,query:'ORC-002'}, 'a Maria fechou as dez peças')).toThrow(/código/);
 expect(() => aiProductionCommand({...action,query:'João'}, 'a Maria fechou as dez peças')).toThrow(/referência/);
 expect(() => aiProductionCommand({...action,query:'Mar'}, 'a Maria fechou as dez peças')).toThrow(/referência/);
 expect(() => aiProductionCommand(action, 'ORC 2 e ORC 3: a Maria fechou as dez peças')).toThrow(/um orçamento/);
 expect(aiProductionCommand({...action,query:'ORC 2'}, 'ORC-002: a Maria fechou as dez peças').command.code).toBe('2');
});
