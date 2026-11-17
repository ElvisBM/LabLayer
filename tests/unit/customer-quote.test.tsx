// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { formatCustomerQuote, optionTotal, publicCustomerQuote, validCustomerQuote } from '../../shared/requests/quote';
import { CustomerQuotePreview } from '../../src/features/requests/CustomerQuote';
const quote = {name:'Chaveiro Zalma NFC',size:'5 cm',options:[{quantity:1,unitPrice:22,deliveryDays:2},{quantity:10,unitPrice:14.5,deliveryDays:2}]};
afterEach(cleanup);
it('formata opções exatas com prazo e dinheiro brasileiro sem inventar desconto por faixa',()=>{
 expect(formatCustomerQuote(quote)).toBe('Orçamento — Chaveiro Zalma NFC\n5 cm\n• 1 unidade: R$ 22,00\n  Prazo de entrega: 2 dias.\n• 10 unidades: R$ 14,50 por unidade — Total: R$ 145,00\n  Prazo de entrega: 2 dias.');
 expect(optionTotal({quantity:10,unitPrice:16.6,deliveryDays:2})).toBe(166);
 expect(optionTotal({quantity:15,unitPrice:107.92,deliveryDays:null})).toBe(1618.8);
});
it('nome e preço bastam; tamanho e prazo ausentes não são inventados',()=>{
 expect(formatCustomerQuote({name:'Bonequinha ProFaby',size:'',options:[{quantity:1,unitPrice:189.99,deliveryDays:null}]})).toBe('Orçamento — Bonequinha ProFaby\n• 1 unidade: R$ 189,99');
});
it('projeção não leva informações internas, descrição ou contato para a mensagem',()=>{
 const projected=publicCustomerQuote({...quote,weight:10,cost:7,options:quote.options.map(o=>({...o,internal:'segredo'}))});
 expect(projected).toEqual(quote);
 expect(formatCustomerQuote(projected!)).not.toMatch(/segredo|custo|peso|produção/);
});
it.each([[],[{quantity:0,unitPrice:22,deliveryDays:2}],[{quantity:1,unitPrice:-1,deliveryDays:2}],[{quantity:1,unitPrice:1.001,deliveryDays:2}],[{quantity:1,unitPrice:Infinity,deliveryDays:2}],[{quantity:1,unitPrice:22,deliveryDays:0}],[quote.options[0],quote.options[0]]].map(options => ({ options })))('não renderiza orçamento inválido: %j',({options})=>{
 const invalid={...quote,options}; expect(validCustomerQuote(invalid)).toBe(false);expect(publicCustomerQuote(invalid)).toBeNull();expect(formatCustomerQuote(invalid)).toBe('');
});
it('copia o mesmo texto exibido sem salvar nem marcar como enviado',async()=>{
 const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 render(<CustomerQuotePreview quote={quote}/>);fireEvent.click(screen.getByRole('button',{name:'Copiar orçamento'}));
 await screen.findByText('Orçamento copiado!');expect(writeText).toHaveBeenCalledWith(formatCustomerQuote(quote));
});
it('falha de clipboard oferece cópia manual sem anunciar sucesso',async()=>{
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockRejectedValue(new Error('denied'))}});
 render(<CustomerQuotePreview quote={quote}/>);fireEvent.click(screen.getByRole('button',{name:'Copiar orçamento'}));
 await screen.findByText(/Selecione o texto acima/);expect(screen.queryByText('Orçamento copiado!')).toBeNull();
});
