import {it,expect} from 'vitest';
import {salesSummary} from '../../server/assistant-sales-intake';
const text='2 pote de ração de cachorro, Barbara Guarderia, aprovado para produzir\n\nCada 49,90, Nome: Emerson e Yuri Aberto\n\nEntregar 07/11\n\nhttps://makerworld.com/pt/models/594793-tilted-holder-for-dog-bowl?from=search#profileId-516672';
const day='2026-11-03';
it('prepara o resumo dos potes e reaproveita a mensagem após confirmação curta',()=>{
 const r=salesSummary(text,day);
 expect(r?.draft).toEqual({title:'pote de ração de cachorro',customerName:'Barbara Guarderia',quantity:2,provisionalQuantity:false,description:text});
 expect(r?.stage).toEqual({status:'fila-producao',unitPrice:49.9,quotedPrice:99.8,deliveryDate:'2026-11-07'});
 expect(salesSummary(text+'\n\nPergunta do assistente:\nÉ um único pedido?\n\nResposta do vendedor:\nSim',day)).toEqual(r);
});
it('não mistura pedidos, consultas ou negações; uma data vencida fica em aberto',()=>{
 for(const s of [text.replace('aprovado','não aprovado'),text.replace('Barbara','ORC-032 Barbara'),text+'\n1 vaso azul',text.replace('aprovado','aprovado?')])expect(salesSummary(s,day)).toBeNull();
 expect(salesSummary(text.replace('07/11','01/11'),day)?.stage.deliveryDate).toBe('');
 expect(salesSummary(text.replace('Cada 49,90','Total 49,90'),day)?.stage.quotedPrice).toBe(49.9);
});
