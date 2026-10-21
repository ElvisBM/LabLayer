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
import { AssistantChat } from "../../src/features/assistant/Assistant";
vi.mock("../../src/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
const fake = vi.fn();
const reply = (body: any, ok = true) => ({ ok, json: async () => body });
beforeEach(() => {
  window.location.hash = "a".repeat(43);
  fake.mockReset();
  vi.stubGlobal("fetch", fake);
  fake.mockImplementation(async (path: string) => {
    if (path === "/api/assistant")
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
    if(path==='/api/assistant') return reply({company:'Empresa',seller:'Vendas',mode:'ai',requests:[]});
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
    if (path === '/api/assistant') return reply({ ...state, requests: [{id:'manual', title:'Manual da equipe', quantity:2}], nextCursor:'manual' });
    if (path === '/api/assistant?cursor=manual') return reply({ ...state, requests: [{id:'outro', title:'Outro atendimento', quantity:3}], nextCursor:null });
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
    if(path==='/api/assistant') return reply({company:'Empresa',seller:'Equipe',mode:'ai',requestScope:'tenant',requests:[]});
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
  fake.mockImplementation(async(path:string)=>reply(path==='/api/assistant'?{company:'Empresa',seller:'Equipe',requests:[]}:{draft:null,action:{intent:'clarify'},message:'Informe o cliente'}));
  render(<AssistantChat/>);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'Como está?'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  await screen.findByText('Informe o cliente');
  expect(screen.queryByRole('button',{name:'Cadastrar no LabLayer'})).toBeNull();
});
