import { expect,it } from 'vitest';
import { deliveryCalendar,saoPauloDay } from '../../server/assistant-calendar';
import {openAiRequest, checkCalendarResult, aiProductionCommand, type AiResult} from '../../server/assistant-ai';
const today='2026-11-03';
const q='Você confirma a aprovação do orçamento e qual é a data correta? O dia 20 deste mês (novembro de 2026) já passou.';
const chat='Aprovo o pedido para entrega dia 20\n\nPergunta do assistente:\n'+q+'\n\nResposta do vendedor:\nNovembro de 2026';
it('calcula a data usando o dia civil de São Paulo e as mensagens do vendedor',()=>{
 expect(saoPauloDay(new Date('2026-11-04T01:30:00Z'))).toBe(today);
 expect(deliveryCalendar(chat,today)).toMatchObject({iso:'2026-11-20',state:'future'});
 expect(deliveryCalendar('entregar dia 20','2026-11-20')?.state).toBe('today');
 expect(deliveryCalendar('entregar dia 20','2026-11-21')?.state).toBe('past');
 expect(deliveryCalendar('entregar dia 31 de novembro',today)?.state).toBe('invalid');
 expect(deliveryCalendar('entregar dia 29 de fevereiro de 2028',today)?.state).toBe('future');
 for(const text of ['2 unidades','pago dia 20','entrega dia 20 ou 21','entregar dia 20 do próximo mês'])expect(deliveryCalendar(text,today)).toBeNull();
});
it('orienta o modelo, corrige a alegação da captura e não cria aprovação',()=>{
 expect(openAiRequest({message:chat,conversation:true,attachments:[]},today).instructions).toContain('20/11/2026 (2026-11-20), data futura');
 const result:AiResult={draft:null,transcript:'',warnings:[],action:{intent:'clarify',query:'',note:'',question:q}};
 const answer=checkCalendarResult(result,chat,today);
 expect(answer.action?.intent).toBe('clarify');expect(answer.action?.question).toContain('20/11/2026');expect(answer.action?.question).not.toMatch(/passou|data correta/);
 const approve={intent:'approve' as const,query:'',note:'',question:'',approval:{quantity:null,deliveryDate:'2026-10-20',evidence:'confirma a aprovação',personalization:[],paid:false}};
 expect(checkCalendarResult({...result,action:approve},chat,today).action?.intent).toBe('clarify');
 expect(()=>aiProductionCommand(approve,chat)).toThrow(/texto enviado/);
});

it('a resposta que chega do provedor passa pela correção inclusive com as duas imagens anexadas',async()=>{
 const {N8nAssistantAi}=await import('../../server/assistant-ai');
 const day=saoPauloDay(); const message='A entrega é dia '+Number(day.slice(-2))+' deste mês';
 const files=['a','b'].map(name=>({name,mime:'image/png',data:'example'}));
 const ai=new N8nAssistantAi('https://n8n.lablayer.com.br/webhook/test',async(_url,opts)=>{
   const {ticket}=JSON.parse(String(opts!.body));const payload=await ai.exchange(ticket);
   expect(payload.request.input[0].content.filter((b:any)=>b.type==='input_image')).toHaveLength(2);
   return new Response(JSON.stringify({schemaVersion:1,requestId:payload.requestId,transcript:'',suggestion:{title:'',description:'',customerName:'',quantity:null,warnings:[],intent:'clarify',query:'',note:'',question:q}}));
 });
 const answer=await ai.interpret({message,attachments:files,conversation:true},async()=>{});
 expect(answer.action?.question).toContain(day.split('-').reverse().join('/'));
 expect(answer.action?.question).not.toContain('já passou');
});
