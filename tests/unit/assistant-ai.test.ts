import { expect, it, vi } from 'vitest';
import { N8nAssistantAi, openAiRequest, validateAiResponse } from '../../server/assistant-ai';
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
 expect(r.store).toBe(false); expect(r.text.format.strict).toBe(true); expect(r).not.toHaveProperty('tools');
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
