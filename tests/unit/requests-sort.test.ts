import { expect, it } from 'vitest';
import { compareRequests, REQUEST_SORT_OPTIONS } from '../../src/features/requests/sort';
const rows = [
 {id:'done1',title:'A finalizado',customerName:'Ana',status:'finalizado',requestedQuantity:1,quotedPrice:1,updatedAt:'2030-01-01'},
 {id:'active2',title:'Pedido 10',customerName:'Érica',status:'orcado',requestedQuantity:10,quotedPrice:100,updatedAt:'2026-02-01'},
 {id:'done2',title:'Z finalizado',customerName:'Zilda',status:'finalizado',requestedQuantity:100,quotedPrice:1000,updatedAt:'2020-01-01'},
 {id:'active1',title:'Pedido 2',customerName:'Ana',status:'aguardando-orcamento',requestedQuantity:2,quotedPrice:0,createdAt:'2026-01-01'},
];
for (const field of REQUEST_SORT_OPTIONS.map(x=>x.value)) for (const direction of ['asc','desc'] as const)
 it(`finalizados sempre no fim: ${field} ${direction}`,()=>{
  const result=[...rows].sort((a,b)=>compareRequests(a,b,field,direction));
  expect(result.slice(0,2).every(r=>r.status!=='finalizado')).toBe(true);
  expect(result.slice(2).every(r=>r.status==='finalizado')).toBe(true);
 });
it('ordena texto com números naturais, quantidades numéricas, datas e mantém valor a calcular no fim do grupo',()=>{
 const ids=(field:any,direction:any)=>[...rows].sort((a,b)=>compareRequests(a,b,field,direction)).map(r=>r.id);
 expect(ids('title','asc')).toEqual(['active1','active2','done1','done2']);
 expect(ids('requestedQuantity','desc')).toEqual(['active2','active1','done2','done1']);
 expect(ids('updatedAt','desc')).toEqual(['active2','active1','done1','done2']);
 expect(ids('quotedPrice','asc')).toEqual(['active2','active1','done1','done2']);
 expect(ids('quotedPrice','desc')).toEqual(['active2','active1','done2','done1']);
});
it('valores ausentes ficam no fim do grupo e empates são determinísticos',()=>{
 const a={id:'a',title:'Árvore',status:'orcado',quotedPrice:0},b={id:'b',title:'arvore',status:'orcado'},c={id:'c',title:'Z',status:'orcado',quotedPrice:20};
 expect(compareRequests(a,b,'title','desc')).toBeLessThan(0);
 expect([b,c,a].sort((a,b)=>compareRequests(a,b,'quotedPrice','asc')).map(r=>r.id)).toEqual(['a','c','b']);
 expect([b,c,a].sort((a,b)=>compareRequests(a,b,'quotedPrice','desc')).map(r=>r.id)).toEqual(['c','a','b']);
});
