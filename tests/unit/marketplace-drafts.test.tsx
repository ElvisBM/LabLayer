// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MarketplaceDrafts } from '../../src/features/integrations/MarketplaceDrafts';
import { normalizeDraft, publicationPayload } from '../../shared/marketplaces/drafts';
const mock=vi.hoisted(()=>({call:vi.fn(),upload:vi.fn()}));
vi.mock('../../src/features/integrations/draft-photo-upload',()=>({uploadDraftPhoto:(...args:any[])=>mock.upload(...args)}));
vi.mock('../../src/features/catalog/client',()=>({catalogRequest:(...args:any[])=>mock.call(...args)}));
const data=normalizeDraft({externalId:'teste-1',title:'Chaveiro',description:'PLA',price:15,quantity:2,pictures:['https://example.com/foto.jpg'],categoryId:'MLB123'});
const draft={id:'a'.repeat(64),data,revision:1,status:'draft',createdAt:'2026-10-29',updatedAt:'2026-10-29'};
const user={getIdToken:vi.fn()};
afterEach(()=>{cleanup();mock.call.mockReset();mock.upload.mockReset();});
it('valida dados, rejeita campos de publicação e aceita rascunho incompleto',()=>{
  expect(()=>normalizeDraft({...data,status:'approved'})).toThrow('Campo não permitido');
  for(const pictures of [['http://example.com/a.jpg'],['https://127.0.0.1/x'],['javascript:alert(1)']])expect(()=>normalizeDraft({...data,pictures})).toThrow();
  expect(()=>normalizeDraft({...data,price:1.001})).toThrow();
  expect(()=>publicationPayload(normalizeDraft({...data,categoryId:''}),true)).toThrow();
  expect(publicationPayload(data,true)).toHaveProperty('family_name','Chaveiro');
});
it('aprovação não publica, exige confirmação inline e mostra sucesso local',async()=>{
  mock.call.mockResolvedValueOnce({drafts:[draft],canManage:true,nextCursor:null});
  render(<MarketplaceDrafts user={user} tenant="a"/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));
  mock.call.mockResolvedValueOnce({...draft,status:'approved'});fireEvent.click(screen.getByRole('button',{name:'Validar e aprovar rascunho'}));
  await screen.findByText(/Aprovado. O anúncio só/);
  expect(mock.call.mock.calls.at(-1)?.[2]).toEqual({action:'approve',revision:1});
  fireEvent.click(screen.getByRole('button',{name:'Publicar no Mercado Livre'}));
  const confirm=screen.getByRole('group',{name:'Confirmar publicação'});expect(within(confirm).getByText(/R\$\s*15,00/)).toBeTruthy();
  expect(mock.call).toHaveBeenCalledTimes(2);
  mock.call.mockResolvedValueOnce({...draft,status:'published',itemId:'MLB900'});fireEvent.click(within(confirm).getByRole('button',{name:'Confirmar publicação'}));
  await screen.findByText('Anúncio e descrição enviados ao Mercado Livre.');
});
it('alterações bloqueiam aprovação/publicação até salvar; leitor não aprova',async()=>{
  mock.call.mockResolvedValue({drafts:[draft],canManage:true,nextCursor:null});render(<MarketplaceDrafts user={user} tenant="a"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));fireEvent.change(screen.getByLabelText('Preço (R$)'),{target:{value:'19'}});
  expect((screen.getByRole('button',{name:'Validar e aprovar rascunho'}) as HTMLButtonElement).disabled).toBe(true);
  cleanup();mock.call.mockResolvedValue({drafts:[draft],canManage:false,nextCursor:null});render(<MarketplaceDrafts user={user} tenant="a"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));expect(screen.queryByRole('button',{name:'Validar e aprovar rascunho'})).toBeNull();
});
it('erro de publicação atualiza estado e oferece conclusão sem publicar novamente',async()=>{
  mock.call.mockResolvedValueOnce({drafts:[{...draft,status:'approved'}],canManage:true,nextCursor:null});render(<MarketplaceDrafts user={user} tenant="a"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));fireEvent.click(screen.getByRole('button',{name:'Publicar no Mercado Livre'}));
  mock.call.mockRejectedValueOnce(Error('Descrição pendente')).mockResolvedValueOnce({...draft,status:'attention',itemId:'MLB900'});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar publicação'}));await screen.findByRole('button',{name:'Concluir publicação'});
  expect(screen.queryByRole('button',{name:'Publicar no Mercado Livre'})).toBeNull();expect(screen.getByRole('alert').textContent).toContain('Descrição pendente');
});

it('envia foto, mostra prévia e pede salvar antes de aprovar',async()=>{
 const url='https://app.lablayer.com.br/api/listing-photos/'+'b'.repeat(64)+'.jpg';
 mock.call.mockResolvedValueOnce({drafts:[draft],canManage:true,nextCursor:null});mock.upload.mockResolvedValue(url);
 render(<MarketplaceDrafts user={user} tenant="a"/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));
 fireEvent.change(screen.getByLabelText('Enviar fotos'),{target:{files:[new File(['image'],'foto.png',{type:'image/png'})]}});
 await screen.findByText(/Fotos enviadas à LabLayer/);expect(screen.getByAltText('Foto 2 do anúncio').getAttribute('src')).toBe(url);
 expect((screen.getByRole('button',{name:'Validar e aprovar rascunho'}) as HTMLButtonElement).disabled).toBe(true);
 mock.call.mockResolvedValueOnce({...draft,revision:2,data:{...data,pictures:[...data.pictures,url]}});
 fireEvent.click(screen.getByRole('button',{name:'Salvar alterações'}));await screen.findByText(/Rascunho atualizado. Revise/);
 expect(mock.call.mock.calls.at(-1)?.[2].data.pictures).toContain(url);
});
it('falha parcial preserva as fotos enviadas e mostra o erro junto às ações',async()=>{
 const url='https://app.lablayer.com.br/api/listing-photos/'+'c'.repeat(64)+'.jpg';
 mock.call.mockResolvedValueOnce({drafts:[draft],canManage:true,nextCursor:null});mock.upload.mockResolvedValueOnce(url).mockRejectedValueOnce(Error('Imagem inválida'));
 render(<MarketplaceDrafts user={user} tenant="a"/>);fireEvent.click(await screen.findByRole('button',{name:'Revisar rascunho'}));
 fireEvent.change(screen.getByLabelText('Enviar fotos'),{target:{files:[new File(['1'],'1.png',{type:'image/png'}),new File(['2'],'2.png',{type:'image/png'})]}});
 expect((await screen.findByRole('alert')).textContent).toContain('Imagem inválida');expect(screen.getByAltText('Foto 2 do anúncio').getAttribute('src')).toBe(url);
 expect(screen.getByText(/1 foto\(s\) enviada/)).toBeTruthy();
});
