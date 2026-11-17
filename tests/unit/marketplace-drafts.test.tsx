// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MarketplaceDrafts } from '../../src/features/integrations/MarketplaceDrafts';
import { normalizeDraft, publicationPayload } from '../../shared/marketplaces/drafts';
const mock=vi.hoisted(()=>({call:vi.fn(),upload:vi.fn()}));
vi.mock('../../src/features/integrations/draft-photo-upload',()=>({uploadDraftPhoto:(...args:any[])=>mock.upload(...args)}));
vi.mock('../../src/features/catalog/client',()=>({catalogRequest:(...args:any[])=>mock.call(...args)}));
const data=normalizeDraft({externalId:'teste-1',title:'Chaveiro',description:'PLA',price:15,quantity:2,pictures:['https://example.com/foto.jpg'],categoryId:'MLB123'});
const draft={id:'a'.repeat(64),data,revision:1,status:'draft',createdAt:'2026-10-29',updatedAt:'2026-10-29'};
const user={getIdToken:vi.fn()};
afterEach(()=>{cleanup();mock.call.mockReset();mock.upload.mockReset();});
// Responde às consultas de apoio (categorias, envio, tarifas) e usa a fila para listagem e ações do rascunho.
function api(queue:any[],extra:Record<string,any>={}){
  mock.call.mockImplementation(async(_u:unknown,path:string)=>{
    const route=(k:string)=>path.includes(k);
    if(route('/shipping-preferences'))return extra.shipping??{modes:['me2'],logisticType:'drop_off',logistics:['drop_off']};
    if(route('/categories?'))return extra.categories??{categories:[{id:'MLB123',name:'Chaveiros',path:'Casa › Chaveiros'}],selected:{id:'MLB123',name:'Chaveiros',path:'Casa › Chaveiros'},total:1,hasMore:false};
    if(route('/category-attributes'))return extra.attributes??{attributes:[]};
    if(route('/category-suggestion'))return extra.suggestion??{suggestion:null};
    if(route('/cost-estimate'))return extra.estimate??{price:15,saleFee:1.8,listingFee:0,shippingCost:0,net:13.2,netPercent:88,listingTypeName:'Clássico',shippingMessage:''};
    if(!queue.length)throw Error('Chamada inesperada: '+path);
    const next=queue.shift();if(next instanceof Error)throw next;return next;
  });
}
const actionBodies=()=>mock.call.mock.calls.filter(c=>c[2]!==undefined).map(c=>c[2]);
const enabled=async(name:string)=>{const b=await screen.findByRole('button',{name}) as HTMLButtonElement;await waitFor(()=>expect(b.disabled).toBe(false));return b;};

it('valida dados, rejeita campos de publicação e aceita rascunho incompleto',()=>{
  expect(()=>normalizeDraft({...data,status:'approved'})).toThrow('Campo não permitido');
  for(const pictures of [['http://example.com/a.jpg'],['https://127.0.0.1/x'],['javascript:alert(1)']])expect(()=>normalizeDraft({...data,pictures})).toThrow();
  expect(()=>normalizeDraft({...data,price:1.001})).toThrow();
  expect(()=>publicationPayload(normalizeDraft({...data,categoryId:''}),true)).toThrow();
  expect(publicationPayload(data,true)).toHaveProperty('family_name','Chaveiro');
});
it('aprovação não publica, exige confirmação inline e mostra sucesso local',async()=>{
  api([{drafts:[draft],canManage:true,nextCursor:null},{...draft,status:'approved'},{...draft,status:'published',itemId:'MLB900'}]);
  render(<MarketplaceDrafts user={user} tenant="a"/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));
  fireEvent.click(await enabled('Validar e aprovar rascunho'));
  await screen.findByText(/Aprovado. O anúncio só/);
  expect(actionBodies().at(-1)).toEqual({action:'approve',revision:1});
  fireEvent.click(await enabled('Publicar no Mercado Livre'));
  const confirm=screen.getByRole('group',{name:'Confirmar publicação'});expect(within(confirm).getByText(/R\$\s*15,00/)).toBeTruthy();
  expect(actionBodies()).toHaveLength(1);
  fireEvent.click(within(confirm).getByRole('button',{name:'Confirmar publicação'}));
  await screen.findByText('Anúncio e descrição enviados ao Mercado Livre.');
  expect(actionBodies().at(-1)).toEqual({action:'publish',revision:1});
});
it('alterações bloqueiam aprovação/publicação até salvar; leitor não aprova',async()=>{
  api([{drafts:[draft],canManage:true,nextCursor:null}]);render(<MarketplaceDrafts user={user} tenant="a"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));await enabled('Validar e aprovar rascunho');
  fireEvent.change(screen.getByLabelText('Preço (R$)'),{target:{value:'19'}});
  expect((screen.getByRole('button',{name:'Validar e aprovar rascunho'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Salvar as alterações')).toBeTruthy();
  cleanup();api([{drafts:[draft],canManage:false,nextCursor:null}]);render(<MarketplaceDrafts user={user} tenant="a"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));expect(screen.queryByRole('button',{name:'Validar e aprovar rascunho'})).toBeNull();
  expect(screen.getByLabelText('Título / nome do produto').matches(':disabled')).toBe(true);
});
it('erro de publicação atualiza estado e oferece conclusão sem publicar novamente',async()=>{
  api([{drafts:[{...draft,status:'approved'}],canManage:true,nextCursor:null},Error('Descrição pendente'),{...draft,status:'attention',itemId:'MLB900'}]);render(<MarketplaceDrafts user={user} tenant="a"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));fireEvent.click(await enabled('Publicar no Mercado Livre'));
  fireEvent.click(screen.getByRole('button',{name:'Confirmar publicação'}));await screen.findByRole('button',{name:'Concluir publicação'});
  expect(screen.queryByRole('button',{name:'Publicar no Mercado Livre'})).toBeNull();
  expect(screen.getAllByRole('alert').map(a=>a.textContent).join(' ')).toContain('Descrição pendente');
});
it('envia foto, mostra prévia e pede salvar antes de aprovar',async()=>{
 const url='https://app.lablayer.com.br/api/listing-photos/'+'b'.repeat(64)+'.jpg';
 api([{drafts:[draft],canManage:true,nextCursor:null},{...draft,revision:2,data:{...data,pictures:[...data.pictures,url]}}]);mock.upload.mockResolvedValue(url);
 render(<MarketplaceDrafts user={user} tenant="a"/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));
 fireEvent.change(screen.getByLabelText('Enviar fotos'),{target:{files:[new File(['image'],'foto.png',{type:'image/png'})]}});
 await screen.findByText(/Fotos enviadas à LabLayer/);expect(screen.getByAltText('Foto 2 do anúncio').getAttribute('src')).toBe(url);
 expect((screen.getByRole('button',{name:'Validar e aprovar rascunho'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Salvar alterações'}));await screen.findByText(/Rascunho atualizado. Revise/);
 expect(actionBodies().at(-1).data.pictures).toContain(url);
});
it('falha parcial preserva as fotos enviadas e mostra o erro junto às ações',async()=>{
 const url='https://app.lablayer.com.br/api/listing-photos/'+'c'.repeat(64)+'.jpg';
 api([{drafts:[draft],canManage:true,nextCursor:null}]);mock.upload.mockResolvedValueOnce(url).mockRejectedValueOnce(Error('Imagem inválida'));
 render(<MarketplaceDrafts user={user} tenant="a"/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));
 fireEvent.change(screen.getByLabelText('Enviar fotos'),{target:{files:[new File(['1'],'1.png',{type:'image/png'}),new File(['2'],'2.png',{type:'image/png'})]}});
 expect((await screen.findByRole('alert')).textContent).toContain('Imagem inválida');expect(screen.getByAltText('Foto 2 do anúncio').getAttribute('src')).toBe(url);
 expect(screen.getByText(/1 foto\(s\) enviada/)).toBeTruthy();
});
it('define capa, prazo de produção e garantia como condições de venda',async()=>{
 const second='https://example.com/segunda.jpg';
 api([{drafts:[{...draft,data:{...data,pictures:[...data.pictures,second]}}],canManage:true,nextCursor:null},{...draft,revision:2}]);
 render(<MarketplaceDrafts user={user} tenant="a"/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));
 fireEvent.click(screen.getByRole('button',{name:'Usar foto 2 como capa'}));
 expect(screen.getByAltText('Foto 1 do anúncio').getAttribute('src')).toBe(second);
 fireEvent.change(screen.getByLabelText(/Prazo de produção/),{target:{value:'3 dias'}});
 fireEvent.change(screen.getByLabelText('Garantia'),{target:{value:'seller:30 dias'}});
 fireEvent.click(screen.getByRole('button',{name:'Salvar alterações'}));await waitFor(()=>expect(actionBodies()).toHaveLength(1));
 const saved=actionBodies()[0].data;
 expect(saved.pictures[0]).toBe(second);
 expect(saved.saleTerms).toEqual(expect.arrayContaining([{id:'MANUFACTURING_TIME',value_name:'3 dias'},{id:'WARRANTY_TYPE',value_name:'Garantia do vendedor'},{id:'WARRANTY_TIME',value_name:'30 dias'}]));
 expect(()=>normalizeDraft(saved)).not.toThrow();
});
it('aplica a categoria sugerida e exige os atributos obrigatórios dela',async()=>{
 api([{drafts:[{...draft,data:{...data,categoryId:''}}],canManage:true,nextCursor:null}],{
  suggestion:{suggestion:{id:'MLB777',name:'Enfeites',path:'Casa › Natal › Enfeites'}},
  categories:{categories:[],selected:{id:'MLB777',name:'Enfeites',path:'Casa › Natal › Enfeites'},total:0},
  attributes:{attributes:[{id:'MATERIAL',name:'Material',valueType:'string',maxLength:100,hint:'',values:[]}]}});
 render(<MarketplaceDrafts user={user} tenant="a"/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));
 fireEvent.click(await screen.findByRole('button',{name:'Aplicar sugestão'},{timeout:2000}));
 const material=await screen.findByLabelText('Material (obrigatório)');
 expect(screen.getByText(/Preencha: Material/)).toBeTruthy();
 fireEvent.change(material,{target:{value:'PLA'}});
 expect(screen.queryByText(/Preencha: Material/)).toBeNull();
 expect(screen.getByText('Atributos obrigatórios completos')).toBeTruthy();
});
it('aprova e publica direto no card da lista, com confirmação antes de publicar',async()=>{
  api([{drafts:[draft],canManage:true,nextCursor:null},{...draft,status:'approved'},{...draft,status:'published',itemId:'MLB901'}]);
  render(<MarketplaceDrafts user={user} tenant="a"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Aprovar'}));
  await screen.findByText('Aprovado. Confira e clique em Publicar.');
  expect(actionBodies().at(-1)).toEqual({action:'approve',revision:1});
  fireEvent.click(screen.getByRole('button',{name:'Publicar'}));
  expect(actionBodies()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Confirmar publicação'}));
  await screen.findByText('Publicado no Mercado Livre (MLB901).');
  expect(actionBodies().at(-1)).toEqual({action:'publish',revision:1});
  expect(screen.queryByRole('button',{name:'Aprovar'})).toBeNull();
});
it('card mostra o erro do Mercado Livre e leitor não vê os botões rápidos',async()=>{
  api([{drafts:[draft],canManage:true,nextCursor:null},Error('O Mercado Livre recusou os dados.'),draft]);
  render(<MarketplaceDrafts user={user} tenant="a"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Aprovar'}));
  await screen.findByText('O Mercado Livre recusou os dados.');
  cleanup(); api([{drafts:[draft],canManage:false,nextCursor:null}]);
  render(<MarketplaceDrafts user={user} tenant="a"/>);
  await screen.findByRole('button',{name:'Revisar rascunho'});
  expect(screen.queryByRole('button',{name:'Aprovar'})).toBeNull();
});
