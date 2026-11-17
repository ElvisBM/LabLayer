// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ writes: vi.fn(), commit: vi.fn(), requests: [] as any[] }));
vi.mock('../../src/firebase', () => ({ db: {} }));
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ tenantId: 'a' }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_: unknown, path: string) => ({ path }), doc: (_: unknown, path: string, id?: string) => ({ path: id ? `${path}/${id}` : path }),
  writeBatch: () => ({ update: state.writes, commit: state.commit }),
  onSnapshot: (ref: { path: string }, callback: any) => {
    callback({ docs: ref.path.endsWith('/customRequests') ? state.requests.map(({ id, ...data }) => ({ id, data: () => data })) : [], exists: () => false });
    return () => {};
  }, updateDoc: state.writes, addDoc: state.writes, deleteDoc: state.writes,
}));
import { EncomendasOrcamentos } from '../../src/views/EncomendasOrcamentos';

beforeEach(() => {
  state.writes.mockReset();
  state.commit.mockReset().mockResolvedValue(undefined);
  state.requests = [
    { id: 'pending', title: 'Chaveiro NFC', customerName: 'Cliente Aurora', description: 'Quantidade provisória: 1 unidade; quantidade final a confirmar.', type: 'orcamento', status: 'aguardando-orcamento', requestedQuantity: 1, quotedPrice: 0, filaments: [], productionTimeHours: 0, createdAt: '2026-10-21T12:00:00Z' },
    { id: 'quoted', title: 'Organizador', customerName: 'Cliente Boreal', description: 'Descrição completa do organizador.', type: 'orcamento', status: 'orcado', requestedQuantity: 10, quotedPrice: 125.5, filaments: [], productionTimeHours: 2, createdAt: '2026-10-20T12:00:00Z' },
  ];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(cleanup);

it('lista mostra quantidade e preço registrado, distinguindo orçamento pendente de preço zero', () => {
  render(<EncomendasOrcamentos />);
  fireEvent.click(screen.getByRole('button', { name: 'Lista simplificada' }));
  const table = screen.getByRole('table', { name: /Lista simplificada/ });
  expect(within(table).getByText('1 un')).toBeTruthy();
  expect(within(table).getByText('10 un')).toBeTruthy();
  expect(within(table).getByText('A calcular')).toBeTruthy();
  expect(within(table).getByText('R$ 125.50')).toBeTruthy();
  expect(within(table).queryByText('R$ 0.00')).toBeNull();
  expect(within(table).queryByText(state.requests[0].description)).toBeNull();
  expect(state.writes).not.toHaveBeenCalled();
});

it('busca por cliente e filtro de status são preservados ao alternar lista, duas e três caixas, incluindo resultado vazio', () => {
  render(<EncomendasOrcamentos />);
  fireEvent.change(screen.getByPlaceholderText('Buscar solicitação...'), { target: { value: ' boreal ' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por status' }), { target: { value: 'orcado' } });
  expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
  expect(screen.queryByText('Chaveiro NFC')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '2 caixas' }));
  expect(screen.getByRole('heading', { name: 'Organizador' })).toBeTruthy();
  expect(screen.getByText('Descrição completa do organizador.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '3 caixas' }));
  expect(screen.getByRole('button', { name: '3 caixas' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '2 caixas' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('heading', { name: 'Organizador' })).toBeTruthy();
  expect(screen.queryByText('Chaveiro NFC')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
  fireEvent.click(screen.getByRole('button', { name: 'Lista simplificada' }));
  expect(screen.getByRole('button', { name: 'Lista simplificada' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
  fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por status' }), { target: { value: 'finalizado' } });
  expect(screen.getByText('Nenhuma encomenda ou orçamento encontrado com os filtros atuais.')).toBeTruthy();
  expect(state.writes).not.toHaveBeenCalled();
});

it('abrir detalhes recupera o descritivo integral e quantidade sem salvar nem recalcular o registro persistido', () => {
  render(<EncomendasOrcamentos />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhes de Chaveiro NFC' }));
  expect(screen.getByRole('heading', { name: 'Editar Solicitação' })).toBeTruthy();
  expect(screen.getByDisplayValue(state.requests[0].description)).toBeTruthy();
  expect(screen.getByDisplayValue('Cliente Aurora')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Atualizar' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('heading', { name: 'Editar Solicitação' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Pedidos' }).getAttribute('aria-pressed')).toBe('true');
  expect(state.writes).not.toHaveBeenCalled();
});

for (const mode of ['Lista simplificada', '2 caixas', '3 caixas']) {
  it(`nome abre tela exclusiva e Voltar preserva busca, filtro e visualização: ${mode}`, () => {
    render(<EncomendasOrcamentos />);
    fireEvent.change(screen.getByPlaceholderText('Buscar solicitação...'), { target: { value: 'boreal' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por status' }), { target: { value: 'orcado' } });
    fireEvent.click(screen.getByRole('button', { name: mode }));
    fireEvent.click(screen.getByRole('button', { name: 'Organizador' }));
    expect(screen.getByRole('region', { name: 'Detalhes da solicitação' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Editar Solicitação' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByPlaceholderText('Buscar solicitação...')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Visualização das solicitações' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Encomendas e Orçamentos' })).toBeNull();
    expect(screen.getByDisplayValue('125.5')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('Cliente Boreal'), { target: { value: 'Rascunho não salvo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para orçamentos' }));
    expect(screen.queryByRole('region', { name: 'Detalhes da solicitação' })).toBeNull();
    expect(screen.getByDisplayValue('boreal')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Filtrar por status' }) as HTMLSelectElement).value).toBe('orcado');
    expect(screen.getByRole('button', { name: mode }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Organizador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Organizador' }));
    expect(screen.getByDisplayValue('Cliente Boreal')).toBeTruthy();
    expect(state.writes).not.toHaveBeenCalled();
  });
}

it('nova solicitação também abre tela própria e permite voltar sem criar registro', () => {
  render(<EncomendasOrcamentos />);
  fireEvent.click(screen.getByRole('button', { name: 'Nova Solicitação' }));
  expect(screen.getByRole('heading', { name: 'Nova Solicitação' })).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Voltar para orçamentos' }));
  expect(screen.getByRole('button', { name: 'Pedidos' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nova Solicitação' }));
  expect(state.writes).not.toHaveBeenCalled();
});

it('altera somente selecionados em commit único sem recalcular preços ou quantidade', async () => {
  render(<EncomendasOrcamentos />);
  fireEvent.click(screen.getByRole('checkbox', {name:'Selecionar Chaveiro NFC'}));
  fireEvent.change(screen.getByRole('combobox', {name:'Novo status em lote'}), {target:{value:'orcado'}});
  fireEvent.click(screen.getByRole('button', {name:'Alterar status de 1 selecionado(s)'}));
  await waitFor(()=>expect(state.commit).toHaveBeenCalledTimes(1));
  expect(state.writes).toHaveBeenCalledTimes(1);
  expect(state.writes.mock.calls[0][0].path).toBe('tenants/a/customRequests/pending');
  expect(Object.keys(state.writes.mock.calls[0][1]).sort()).toEqual(['status','updatedAt']);
  expect(state.writes.mock.calls[0][1].status).toBe('orcado');
  await waitFor(()=>expect(screen.getByText('0 selecionado(s)')).toBeTruthy());
});
it('selecionar todos respeita filtro; trocar filtro limpa seleção e caixas preservam a seleção', () => {
  render(<EncomendasOrcamentos />);
  fireEvent.change(screen.getByPlaceholderText('Buscar solicitação...'), {target:{value:'Boreal'}});
  fireEvent.click(screen.getByRole('checkbox', {name:'Selecionar todos os resultados'}));
  expect(screen.getByText('1 selecionado(s)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'2 caixas'}));
  expect((screen.getByRole('checkbox', {name:'Selecionar Organizador'}) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByRole('combobox', {name:'Filtrar por status'}), {target:{value:'finalizado'}});
  expect(screen.getByText('0 selecionado(s)')).toBeTruthy();
  expect(state.commit).not.toHaveBeenCalled();
});
it('erro mantém seleção para repetir e bloqueia duplo envio durante salvamento', async()=>{
  let reject!: (reason: Error)=>void;
  state.commit.mockImplementation(()=>new Promise((_resolve, rejectPromise)=>{reject=rejectPromise}));
  render(<EncomendasOrcamentos />);
  fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar todos os resultados'}));
  fireEvent.click(screen.getByRole('button',{name:'Alterar status de 2 selecionado(s)'}));
  expect((screen.getByRole('button',{name:'Salvando…'}) as HTMLButtonElement).disabled).toBe(true);
  reject(Error('permission denied'));
  await screen.findByRole('button',{name:'Alterar status de 2 selecionado(s)'});
  expect(state.commit).toHaveBeenCalledTimes(1);
  expect(screen.getByText('2 selecionado(s)')).toBeTruthy();
});
it('cabeçalhos ordenam sem salvar, preservam seleção e mantêm finalizados no fim em ambos sentidos',()=>{
 state.requests.push({...state.requests[0],id:'done',title:'A finalizado',status:'finalizado',requestedQuantity:100,updatedAt:'2030-01-01T00:00:00Z'});
 render(<EncomendasOrcamentos/>);
 fireEvent.click(screen.getByRole('button',{name:'Lista simplificada'}));
 const titles=()=>within(screen.getByRole('table')).getAllByRole('row').slice(1).map(row=>within(row).getByRole('rowheader').textContent);
 expect(titles().at(-1)).toContain('A finalizado');
 fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Chaveiro NFC'}));
 fireEvent.click(screen.getByRole('button',{name:'Ordenar por Quantidade'}));
 expect(titles()[0]).toContain('Chaveiro');expect(titles().at(-1)).toContain('A finalizado');
 fireEvent.click(screen.getByRole('button',{name:'Ordenar por Quantidade'}));
 expect(titles()[0]).toContain('Organizador');expect(titles().at(-1)).toContain('A finalizado');
 expect(screen.getByRole('columnheader',{name:/Quantidade/}).getAttribute('aria-sort')).toBe('descending');
 expect((screen.getByRole('checkbox',{name:'Selecionar Chaveiro NFC'}) as HTMLInputElement).checked).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'2 caixas'}));
 expect(screen.getAllByRole('heading',{level:3}).map(x=>x.textContent)).toEqual(['Organizador','Chaveiro NFC','A finalizado']);
 fireEvent.click(screen.getByRole('button',{name:/^Organizador$/}));
 fireEvent.click(screen.getByRole('button',{name:'Voltar para orçamentos'}));
 expect((screen.getByRole('combobox',{name:'Ordenar orçamentos por'}) as HTMLSelectElement).value).toBe('requestedQuantity');
 expect(state.commit).not.toHaveBeenCalled();expect(state.writes).not.toHaveBeenCalled();
});

it('exibe orçamento por quantidade em todos os modos e salva o total da opção selecionada',async()=>{
 state.requests[1].customerQuote={name:'Chaveiro 6cm',size:'6 cm',options:[{quantity:1,unitPrice:24.99,deliveryDays:1},{quantity:10,unitPrice:16.6,deliveryDays:2}]};
 state.requests[1].quotedPrice=166;
 render(<EncomendasOrcamentos/>);
 for(const mode of ['Lista simplificada','2 caixas','3 caixas']){
  fireEvent.click(screen.getByRole('button',{name:mode}));expect(screen.getByRole('region',{name:'Orçamento para o cliente'}).textContent).toContain('Total: R$ 166,00');
 }
 fireEvent.click(screen.getByRole('button',{name:'Organizador'}));
 fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));
 await waitFor(()=>expect(state.writes).toHaveBeenCalledTimes(1));
 expect(state.writes.mock.calls[0][1]).toMatchObject({quotedPrice:166,customerQuote:state.requests[1].customerQuote});
});

it('pedidos usa o resumo do bot e mostra o número independente do título, inclusive na busca e nos detalhes', () => {
 state.requests[1].code='ORC-002'; state.requests[1].requestedDeliveryDate='2026-11-08';
 render(<EncomendasOrcamentos/>);
 expect(screen.getByRole('button',{name:'Pedidos'}).getAttribute('aria-pressed')).toBe('true');
 expect(screen.getByText('ORC-002')).toBeTruthy();
 expect(screen.queryByText('Descrição completa do organizador.')).toBeNull();
 expect(screen.getByText('08/11/2026')).toBeTruthy();
 fireEvent.change(screen.getByPlaceholderText('Buscar solicitação...'),{target:{value:'ORC 2'}});
 expect(screen.getByRole('status').textContent).toBe('1 de 2 solicitações');
 for(const mode of ['Pedidos','Lista simplificada','2 caixas','3 caixas']) {
  fireEvent.click(screen.getByRole('button',{name:mode})); expect(screen.getByText('ORC-002')).toBeTruthy();
 }
 fireEvent.click(screen.getByRole('button',{name:/ORC-002.*Organizador/}));
 expect(screen.getByText('ORC-002 · Organizador')).toBeTruthy();
 expect(state.writes).not.toHaveBeenCalled();
});
