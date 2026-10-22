// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AssistantChat, RequestTimeline } from "../../src/features/assistant/Assistant";
vi.mock("../../src/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
const fake = vi.fn();
const reply = (body: any, ok = true) => ({ ok, json: async () => body });
beforeEach(() => {
  window.location.hash = "a".repeat(43);
  fake.mockReset();
  vi.stubGlobal("fetch", fake);
  fake.mockImplementation(async (path: string) => {
    if (path === "/api/assistant?status=active")
      return reply({ company: "Empresa", seller: "Vendedor", requests: [] });
    if (path === "/api/assistant/draft")
      return reply({
        draft: {
          title: "Boneco 12 cm",
          customerName: "",
          description: "Boneco 12 cm",
          quantity: 1,
          provisionalQuantity: true,
        },
        message: "Confira os dados.",
      });
    if (path === "/api/assistant/requests") throw Error("Conexão perdida");
    throw Error("Unexpected path");
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('comando explícito confirmado pelo servidor abre a fila e a linha do tempo sem criar orçamento', async () => {
  fake.mockImplementation(async (path: string) => {
    if (path === '/api/assistant?status=active') return reply({ company: 'Empresa', seller: 'Equipe', requests: [] });
    if (path === '/api/assistant/draft') return reply({ updatedRequestId: 'manual', message: 'Pedido encaminhado para a fila de produção.' });
    if (path === '/api/assistant/requests/manual') return reply({ id: 'manual', title: 'ORC-011', status: 'fila-producao', quantity: 10, notes: [{ id: 'event', createdAt: '2026-10-22T12:00:00Z', kind: 'workflow-update', seller: 'Equipe', message: '5 Viviane Rodriguero; 5 Daniella Maglio Löw', changes: [{ field: 'status', before: 'orcado', after: 'fila-producao' }] }] });
    throw Error('Unexpected path');
  });
  render(<AssistantChat />);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'), { target: { value: 'ORC 11 pago pode produzir' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  expect(await screen.findByText('ORC-011')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Linha do tempo do orçamento' })).toBeTruthy();
  expect(screen.getByText('5 Viviane Rodriguero; 5 Daniella Maglio Löw')).toBeTruthy();
  expect(JSON.parse(fake.mock.calls.find(c => c[0] === '/api/assistant/draft')![1].body).operationId).toBeTruthy();
  expect(fake.mock.calls.some(c => c[0] === '/api/assistant/requests')).toBe(false);
});
it('falha de rede reenvia o mesmo comando com o mesmo identificador', async () => {
  render(<AssistantChat />);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'), { target: { value: 'ORC 11 pago pode produzir' } });
  fake.mockRejectedValue(Error('Conexão perdida'));
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  await screen.findByText('Conexão perdida');
  fireEvent.click(screen.getByRole('button', { name: 'Reenviar a mesma mensagem' }));
  await waitFor(() => expect(fake.mock.calls.filter(c => c[0] === '/api/assistant/draft')).toHaveLength(2));
  const calls = fake.mock.calls.filter(c => c[0] === '/api/assistant/draft');
  expect(calls[1][1].body).toBe(calls[0][1].body);
});
it('timeline apresenta complementos antigos e eventos novos sem descartar o texto', () => {
  render(<RequestTimeline notes={[{ id: 'old', message: 'Cor azul', createdAt: '2026-10-20T12:00:00Z' }, { id: 'new', kind: 'workflow-update', message: 'Nome com acento: Löw', createdAt: '2026-10-22T12:00:00Z', paymentReported: true, changes: [] }]} load={async () => new Blob()} />);
  expect(screen.getByText('Cor azul')).toBeTruthy(); expect(screen.getByText('Nome com acento: Löw')).toBeTruthy();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});
it("exige conferência, não anuncia sucesso com falha e reenvia exatamente o mesmo pedido", async () => {
  render(<AssistantChat />);
  fireEvent.change(await screen.findByLabelText("Criar, consultar ou atualizar um pedido"), {
    target: { value: "Boneco 12 cm" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
  await screen.findByText("Confira antes de cadastrar");
  expect(screen.getByText(/1 unidade provisória/)).toBeTruthy();
  expect(fake.mock.calls.some((c) => c[0] === "/api/assistant/requests")).toBe(
    false,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Cadastrar no LabLayer" }),
  );
  await screen.findByText("Conexão perdida");
  expect(screen.queryByText(/Solicitação cadastrada/)).toBeNull();
  const first = fake.mock.calls.find(
    (c) => c[0] === "/api/assistant/requests",
  )![1].body;
  fireEvent.click(
    screen.getByRole("button", { name: "Reenviar o mesmo pedido" }),
  );
  await waitFor(() =>
    expect(
      fake.mock.calls.filter((c) => c[0] === "/api/assistant/requests"),
    ).toHaveLength(2),
  );
  expect(
    fake.mock.calls.filter((c) => c[0] === "/api/assistant/requests")[1][1]
      .body,
  ).toBe(first);
});
it("link revogado apresenta erro de acesso sem formulário de envio", async () => {
  fake.mockResolvedValue(reply({ error: "Link revogado" }, false));
  render(<AssistantChat />);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Criar, consultar ou atualizar um pedido")).toBeNull();
});
it("envia anexos para interpretar, mostra a transcrição e exige confirmação antes de persistir", async () => {
  fake.mockImplementation(async(path:string)=>{
    if(path==='/api/assistant?status=active') return reply({company:'Empresa',seller:'Vendas',mode:'ai',requests:[]});
    if(path==='/api/assistant/draft') return reply({draft:{title:'Chaveiro',customerName:'Teste',description:'Azul',quantity:10,provisionalQuantity:false},transcript:'Dez chaveiros azuis',message:'Confira a sugestão',mode:'ai'});
    throw Error('Unexpected path');
  });
  render(<AssistantChat />);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'Quero dez chaveiros'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  await screen.findByText('Transcrição do áudio — confira');
  expect(screen.getByText('Dez chaveiros azuis')).toBeTruthy();
  const body=JSON.parse(fake.mock.calls.find(c=>c[0]==='/api/assistant/draft')![1].body);
  expect(body).toMatchObject({attachments:[],guided:false});
  expect(fake.mock.calls.some(c=>c[0]==='/api/assistant/requests')).toBe(false);
});

it('lista pedidos da empresa, carrega outra página e abre pedido de outro atendimento', async () => {
  fake.mockImplementation(async (path: string) => {
    const state = { company: 'Empresa', seller: 'Equipe', requestScope: 'tenant', mode: 'guided' };
    if (path === '/api/assistant?status=active') return reply({ ...state, requests: [{id:'manual', title:'Manual da equipe', quantity:2}], nextCursor:'manual' });
    if (path === '/api/assistant?status=active&cursor=manual') return reply({ ...state, requests: [{id:'outro', title:'Outro atendimento', quantity:3}], nextCursor:null });
    if (path === '/api/assistant/requests/outro') return reply({ id:'outro',title:'Outro atendimento',quantity:3,description:'Azul',attachments:[],notes:[] });
    throw Error('Unexpected path');
  });
  render(<AssistantChat />);
  fireEvent.click(await screen.findByRole('button', {name:'Todos os pedidos'}));
  await screen.findByText('Manual da equipe');
  fireEvent.click(screen.getByRole('button', {name:'Carregar mais pedidos'}));
  fireEvent.click(await screen.findByRole('button', {name:/Outro atendimento/}));
  await screen.findByText('Azul');
  expect(screen.getByLabelText('Criar, consultar ou atualizar um pedido')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Voltar aos pedidos'}));
  expect(screen.getByText('Manual da equipe')).toBeTruthy();
});

it('consulta exibe dados reais e prepara complemento sem salvar até confirmar, preservando contexto', async()=>{
  let intent='lookup';
  fake.mockImplementation(async(path:string, options:any)=>{
    if(path==='/api/assistant?status=active') return reply({company:'Empresa',seller:'Equipe',mode:'ai',requestScope:'tenant',requests:[]});
    if(path==='/api/assistant/draft') return reply({draft:null,action:{intent,note:'Cor azul confirmada'},candidates:[{id:'p1',title:'Chaveiro Zalma',customerName:'Zalma',status:'orcado'}],message:'Escolha o pedido'});
    if(path==='/api/assistant/requests/p1') return reply({id:'p1',title:'Chaveiro Zalma',customerName:'Zalma',quantity:10,status:'orcado',quotedPrice:80,description:'Descrição salva',notes:[]});
    if(path==='/api/assistant/requests/p1/notes') return reply({message:'Complemento salvo'});
    throw Error('Unexpected path');
  });
  render(<AssistantChat/>);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'Qual valor Zalma?'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  fireEvent.click(await screen.findByRole('button',{name:/Chaveiro Zalma/}));
  await screen.findByText(/Valor do orçamento:.*80,00/);
  expect(screen.queryByText('Confira antes de cadastrar')).toBeNull();
  intent='update';
  fireEvent.change(screen.getByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'A cor será azul'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  fireEvent.click(await screen.findByRole('button',{name:/Chaveiro Zalma/}));
  await screen.findByLabelText('Confira o complemento');
  expect(fake.mock.calls.filter(c=>c[0].endsWith('/notes'))).toHaveLength(0);
  const calls=fake.mock.calls.filter(c=>c[0]==='/api/assistant/draft');
  expect(JSON.parse(calls[1][1].body).requestId).toBe('p1');
  fireEvent.click(screen.getByRole('button',{name:'Confirmar complemento'}));
  await screen.findByText('Complemento salvo');
  expect(JSON.parse(fake.mock.calls.find(c=>c[0].endsWith('/notes'))![1].body).message).toBe('Cor azul confirmada');
});
it('pedido inexistente ou falha de interpretação mantém conversa sem botão de cadastro',async()=>{
  fake.mockImplementation(async(path:string)=>reply(path==='/api/assistant?status=active'?{company:'Empresa',seller:'Equipe',requests:[]}:{draft:null,action:{intent:'clarify'},message:'Informe o cliente'}));
  render(<AssistantChat/>);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'Como está?'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  await screen.findByText('Informe o cliente');
  expect(screen.queryByRole('button',{name:'Cadastrar no LabLayer'})).toBeNull();
});
it('lista inicia aguardando e orçado; mudança de filtro reinicia paginação e preserva escolha ao voltar',async()=>{
 fake.mockImplementation(async(path:string)=>{
   const state={company:'Empresa',seller:'Equipe',requestScope:'tenant',requests:[]};
   if(path==='/api/assistant?status=active')return reply({...state,requests:[{id:'a',title:'Pendente',quantity:1,status:'aguardando-orcamento'}],nextCursor:'a'});
   if(path==='/api/assistant?status=finalizado')return reply({...state,requests:[{id:'b',title:'Concluído',quantity:1,status:'finalizado'}],nextCursor:null});
   if(path==='/api/assistant/requests/b')return reply({id:'b',title:'Concluído',quantity:1,status:'finalizado',description:'Entregue',notes:[]});
   throw Error(path);
 });
 render(<AssistantChat/>);
 fireEvent.click(await screen.findByRole('button',{name:'Todos os pedidos'}));
 const filter=await screen.findByRole('combobox',{name:'Filtrar pedidos por status'});
 expect((filter as HTMLSelectElement).value).toBe('active');
 fireEvent.change(filter,{target:{value:'finalizado'}});
 fireEvent.click(await screen.findByRole('button',{name:/Concluído/}));
 await screen.findByText('Entregue');
 fireEvent.click(screen.getByRole('button',{name:'Voltar aos pedidos'}));
 expect((screen.getByRole('combobox',{name:'Filtrar pedidos por status'}) as HTMLSelectElement).value).toBe('finalizado');
 expect(screen.queryByText('Pendente')).toBeNull();
 expect(screen.queryByRole('button',{name:'Carregar mais pedidos'})).toBeNull();
});

it('lista do bot mostra opções e copia sem abrir pedido nem enviar mensagem',async()=>{
 const customerQuote={name:'Bonequinha ProFaby',size:'15 cm + base de 4 cm',options:[{quantity:1,unitPrice:189.99,deliveryDays:4}]};
 const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
 fake.mockResolvedValue(reply({company:'Empresa',seller:'Equipe',requestScope:'tenant',requests:[{id:'x',title:'ProFaby',quantity:1,status:'orcado',customerQuote}]}));
 render(<AssistantChat/>);fireEvent.click(await screen.findByRole('button',{name:'Todos os pedidos'}));
 fireEvent.click(await screen.findByRole('button',{name:'Copiar orçamento'}));await screen.findByText('Orçamento copiado!');
 expect(copy.mock.calls[0][0]).toContain('Prazo de entrega: 4 dias.');expect(copy.mock.calls[0][0]).toContain('R$ 189,99');
 expect(fake.mock.calls.every(c=>c[0]==='/api/assistant?status=active')).toBe(true);
});
