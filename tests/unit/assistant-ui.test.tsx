// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AssistantChat, RequestTimeline } from "../../src/features/assistant/AssistantChat";
vi.mock("../../src/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
const fake = vi.fn();
const reply = (body: any, ok = true) => ({ ok, json: async () => body });
beforeEach(() => {
  window.location.hash = "a".repeat(43);
  fake.mockReset();
  vi.stubGlobal("fetch", fake);
  fake.mockImplementation(async (path: string) => {
    if ((path === "/api/assistant?summary=true" || path === "/api/assistant?status=active"))
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
it('abre somente o resumo uma vez em StrictMode e busca pedidos ao abrir a lista', async () => {
  fake.mockImplementation(async path => {
    if (path === '/api/assistant?summary=true') return reply({ company: 'Empresa', seller: 'Equipe', requestScope: 'tenant', requests: [] });
    if (path === '/api/assistant?status=active') return reply({ company: 'Empresa', seller: 'Equipe', requestScope: 'tenant', requests: [{ id: 'a', title: 'Pedido carregado sob demanda', quantity: 1 }] });
    throw Error(path);
  });
  render(<React.StrictMode><AssistantChat /></React.StrictMode>);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'), { target: { value: 'Uma mensagem ainda não enviada' } });
  expect(fake.mock.calls.map(c => c[0])).toEqual(['/api/assistant?summary=true']);
  fireEvent.click(screen.getByRole('button', { name: 'Todos os pedidos' }));
  await screen.findByText('Pedido carregado sob demanda');
  expect(fake.mock.calls.map(c => c[0])).toEqual(['/api/assistant?summary=true', '/api/assistant?status=active']);
});
it('comando explícito confirmado pelo servidor abre a fila e a linha do tempo sem criar orçamento', async () => {
  fake.mockImplementation(async (path: string) => {
    if ((path === '/api/assistant?summary=true' || path === '/api/assistant?status=active')) return reply({ company: 'Empresa', seller: 'Equipe', requests: [] });
    if (path === '/api/assistant/draft') return reply({ updatedRequestId: 'manual', message: 'Pedido encaminhado para a fila de produção.' });
    if (path === '/api/assistant/requests/manual') return reply({ id: 'manual', title: 'ORC-011', status: 'fila-producao', quantity: 10, notes: [{ id: 'event', createdAt: '2026-10-22T12:00:00Z', kind: 'workflow-update', seller: 'Equipe', message: '5 Viviane Rodriguero; 5 Daniella Maglio Löw', changes: [{ field: 'status', before: 'orcado', after: 'fila-producao' }] }] });
    throw Error('Unexpected path');
  });
  render(<AssistantChat />);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'), { target: { value: 'ORC 11 pago pode produzir' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  expect(await screen.findByRole('heading', {name:'ORC-011'})).toBeTruthy();
  await screen.findByRole('region', { name: 'Linha do tempo do orçamento' });
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
    if((path==='/api/assistant?summary=true' || path==='/api/assistant?status=active')) return reply({company:'Empresa',seller:'Vendas',mode:'ai',requests:[]});
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
    if ((path === '/api/assistant?summary=true' || path === '/api/assistant?status=active')) return reply({ ...state, requests: [{id:'manual', title:'Manual da equipe', quantity:2}], nextCursor:'manual' });
    if (path === '/api/assistant?status=active&cursor=manual') return reply({ ...state, requests: [{id:'outro', title:'Outro atendimento', quantity:3}], nextCursor:null });
    if (path === '/api/assistant/requests/outro') return reply({ id:'outro',title:'Outro atendimento',quantity:3,description:'Azul',attachments:[],notes:[] });
    throw Error('Unexpected path');
  });
  render(<AssistantChat />);
  fireEvent.click(await screen.findByRole('button', {name:'Todos os pedidos'}));
  await screen.findByText('Manual da equipe');
  fireEvent.click(screen.getByRole('button', {name:'Carregar mais pedidos'}));
  fireEvent.click(await screen.findByRole('button', {name:/Outro atendimento/}));
  await screen.findByRole('region', {name:'Arquivos do pedido'});
  fireEvent.click(screen.getByText('Descrição do pedido'));
  await screen.findByText('Azul');
  expect(screen.getByLabelText('Criar, consultar ou atualizar um pedido')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Voltar aos pedidos'}));
  expect(await screen.findByText('Manual da equipe')).toBeTruthy();
});

it('consulta exibe dados reais e prepara complemento sem salvar até confirmar, preservando contexto', async()=>{
  let intent='lookup';
  fake.mockImplementation(async(path:string, options:any)=>{
    if((path==='/api/assistant?summary=true' || path==='/api/assistant?status=active')) return reply({company:'Empresa',seller:'Equipe',mode:'ai',requestScope:'tenant',requests:[]});
    if(path==='/api/assistant/draft') return reply({draft:null,action:{intent,note:'Cor azul confirmada'},candidates:[{id:'p1',title:'Chaveiro Zalma',customerName:'Zalma',status:'orcado'}],message:'Escolha o pedido'});
    if(path==='/api/assistant/requests/p1') return reply({id:'p1',title:'Chaveiro Zalma',customerName:'Zalma',quantity:10,status:'orcado',quotedPrice:80,description:'Descrição salva',notes:[]});
    if(path==='/api/assistant/requests/p1/notes') return reply({message:'Complemento salvo'});
    throw Error('Unexpected path');
  });
  render(<AssistantChat/>);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'Qual valor Zalma?'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  fireEvent.click(await screen.findByRole('button',{name:/Chaveiro Zalma/}));
  await screen.findByText(/80,00/);
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
  fake.mockImplementation(async(path:string)=>reply((path==='/api/assistant?summary=true' || path==='/api/assistant?status=active')?{company:'Empresa',seller:'Equipe',requests:[]}:{draft:null,action:{intent:'clarify'},message:'Informe o cliente'}));
  render(<AssistantChat/>);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'Como está?'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  await screen.findByText('Informe o cliente');
  expect(screen.queryByRole('button',{name:'Cadastrar no LabLayer'})).toBeNull();
});
it('lista inicia aguardando e orçado; mudança de filtro reinicia paginação e preserva escolha ao voltar',async()=>{
 fake.mockImplementation(async(path:string)=>{
   const state={company:'Empresa',seller:'Equipe',requestScope:'tenant',requests:[]};
   if((path==='/api/assistant?summary=true' || path==='/api/assistant?status=active'))return reply({...state,requests:[{id:'a',title:'Pendente',quantity:1,status:'aguardando-orcamento'}],nextCursor:'a'});
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
 await screen.findByRole('region', {name:'Arquivos do pedido'});
 fireEvent.click(screen.getByText('Descrição do pedido'));
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
 expect(fake.mock.calls.every(c=>['/api/assistant?summary=true','/api/assistant?status=active'].includes(c[0]))).toBe(true);
});

const approvalQuestion = 'Você autoriza a produção do chaveiro adicional mostrado como referência na foto?';
const originalRequest = 'ORC-008 pago, produzir e adicionar um outro chaveiro modelo na foto enviada';
function clarificationReplies(question = approvalQuestion) {
  fake.mockImplementation(async (path: string) => {
    if ((path === '/api/assistant?summary=true' || path === '/api/assistant?status=active')) return reply({ company: 'Empresa', seller: 'Equipe', mode: 'ai', requests: [] });
    if (path === '/api/assistant/assets') return reply({ id: 'photo', name: 'chaveiro.png', mime: 'image/png' });
    if (path === '/api/assistant/draft') return reply({ draft: null, action: { intent: 'clarify' }, message: question });
    throw Error(`Unexpected path: ${path}`);
  });
}
async function askForApproval() {
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'), { target: { value: originalRequest } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  await screen.findByText(approvalQuestion);
}

it('mostra pedido e pergunta em mensagens separadas, confirma com contexto e anexo, sem duplicar no reenvio', async () => {
  clarificationReplies();
  const { container } = render(<AssistantChat />);
  await screen.findByLabelText('Criar, consultar ou atualizar um pedido');
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['image'], 'chaveiro.png', { type: 'image/png' })] } });
  await screen.findByText('✓ chaveiro.png');
  await askForApproval();
  const log = screen.getByRole('log');
  expect(within(log).getByText(originalRequest)).toBeTruthy();
  expect(within(log).getByText(approvalQuestion)).toBeTruthy();
  expect((screen.getByLabelText('Sua resposta') as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByText(/Olá! Você pode criar/)).toBeNull();
  expect(fake.mock.calls.filter(c => c[0] === '/api/assistant/draft')).toHaveLength(1);
  fake.mockRejectedValue(Error('Conexão perdida'));
  fireEvent.click(within(log).getByRole('button', { name: 'Sim, confirmar' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Atualização concluída')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reenviar a mesma mensagem' }));
  await waitFor(() => expect(fake.mock.calls.filter(c => c[0] === '/api/assistant/draft')).toHaveLength(3));
  const calls = fake.mock.calls.filter(c => c[0] === '/api/assistant/draft');
  const confirmed = JSON.parse(calls[1][1].body);
  expect(confirmed.message).toContain(originalRequest);
  expect(confirmed.message).toContain(approvalQuestion);
  expect(confirmed.message).toContain('Resposta do vendedor:\nSim, confirmo e autorizo');
  expect(confirmed.attachments).toEqual(['photo']);
  expect(calls[2][1].body).toBe(calls[1][1].body);
  expect(within(log).getAllByText('Sim, confirmo e autorizo o que foi perguntado acima.')).toHaveLength(1);
});

it('corrigir foca a resposta e não aprova; cancelamento limpa a pendência sem chamar a API', async () => {
  clarificationReplies();
  render(<AssistantChat />);
  await askForApproval();
  fireEvent.click(screen.getByRole('button', { name: 'Quero corrigir' }));
  const input = screen.getByLabelText('Sua resposta');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'Não autorizo. Só quero consultar o preço.' } });
  expect((screen.getByRole('button', { name: 'Sim, confirmar' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));
  await waitFor(() => expect(fake.mock.calls.filter(c => c[0] === '/api/assistant/draft')).toHaveLength(2));
  await screen.findByRole('button', { name: 'Cancelar solicitação' });
  const calls = fake.mock.calls.filter(c => c[0] === '/api/assistant/draft');
  expect(JSON.parse(calls[1][1].body).message).toContain('Resposta do vendedor:\nNão autorizo. Só quero consultar o preço.');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar solicitação' }));
  await screen.findByText('Solicitação cancelada. Você pode enviar uma nova mensagem.');
  expect(screen.queryByRole('button', { name: 'Sim, confirmar' })).toBeNull();
  expect(fake.mock.calls.filter(c => c[0] === '/api/assistant/draft')).toHaveLength(2);
  expect((screen.getByLabelText('Criar, consultar ou atualizar um pedido') as HTMLTextAreaElement).value).toBe('');
});

it.each(['Qual a quantidade do chaveiro adicional?', 'Você confirma 10 ou 20 unidades?', 'Você autoriza a produção? Qual a quantidade?'])(
  'pergunta aberta ou ambígua exige resposta escrita: %s', async question => {
    clarificationReplies(question);
    render(<AssistantChat />);
    fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'), { target: { value: originalRequest } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    await screen.findByText(question);
    expect(screen.queryByRole('button', { name: 'Sim, confirmar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Responder pergunta' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Sua resposta'));
    expect((screen.getByRole('button', { name: 'Enviar resposta' }) as HTMLButtonElement).disabled).toBe(true);
  },
);

it('sucesso continua visível se a atualização da tela falhar, sem oferecer novo envio da aprovação', async () => {
  clarificationReplies();
  render(<AssistantChat />);
  await askForApproval();
  fake.mockImplementation(async path => {
    if (path === '/api/assistant/draft') return reply({ updatedRequestId: 'orc8', message: 'Pedido encaminhado para a fila de produção.' });
    throw Error('Falha ao carregar pedido');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sim, confirmar' }));
  await screen.findByText('Atualização concluída');
  await screen.findByText('Falha ao carregar pedido');
  expect(within(screen.getByRole('status', { name: 'Confirmação de atualização' })).getByText('Pedido atualizado com sucesso')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sim, confirmar' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reenviar a mesma mensagem' })).toBeNull();
  expect(within(screen.getByRole('log')).getByText(originalRequest)).toBeTruthy();
});

it('cadastro usa o texto original mesmo depois de limpar o campo e permite recuperá-lo para edição', async () => {
  render(<AssistantChat />);
  fireEvent.change(await screen.findByLabelText('Criar, consultar ou atualizar um pedido'), { target: { value: 'Boneco 12 cm para Maria' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Editar mensagem' }));
  expect((screen.getByLabelText('Criar, consultar ou atualizar um pedido') as HTMLTextAreaElement).value).toBe('Boneco 12 cm para Maria');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar no LabLayer' }));
  await screen.findByRole('alert');
  expect(JSON.parse(fake.mock.calls.find(c => c[0] === '/api/assistant/requests')![1].body).message).toBe('Boneco 12 cm para Maria');
});

it('atalhos preenchem e focam a conversa sem enviar; Enter no desktop envia e Shift+Enter preserva a quebra', async () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  render(<AssistantChat />);
  fireEvent.click(await screen.findByRole('button', { name: /Novo orçamento/ }));
  const input = screen.getByLabelText('Criar, consultar ou atualizar um pedido');
  expect(document.activeElement).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('Criar novo orçamento para ');
  expect(fake.mock.calls.filter(c => c[0] === '/api/assistant/draft')).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(fake.mock.calls.filter(c => c[0] === '/api/assistant/draft')).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText('Confira antes de cadastrar');
  expect(fake.mock.calls.filter(c => c[0] === '/api/assistant/draft')).toHaveLength(1);
});

it('busca ignora acentos e informa que resultados são parciais quando há paginação', async () => {
  fake.mockResolvedValue(reply({ company: 'Empresa', requestScope: 'tenant', requests: [{ id: '1', title: 'ORC-008 Chaveiro', customerName: 'Álvaro', quantity: 10, status: 'orcado' }, { id: '2', title: 'Boneco', customerName: 'Maria', quantity: 1 }], nextCursor: '2' }));
  render(<AssistantChat />);
  fireEvent.click(await screen.findByRole('button', { name: 'Todos os pedidos' }));
  fireEvent.change(await screen.findByLabelText('Buscar pedido ou cliente'), { target: { value: 'alvaro' } });
  expect(screen.getByText('ORC-008 — Chaveiro')).toBeTruthy();
  expect(screen.queryByText('Boneco')).toBeNull();
  expect(screen.getByText(/A busca inclui os pedidos carregados/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Buscar pedido ou cliente'), { target: { value: 'inexistente' } });
  expect(screen.getByText('Nenhum pedido encontrado neste filtro.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Carregar mais pedidos' })).toBeTruthy();
});

it('aprovação pelo cartão exige conferência e preserva envio e data no retry', async () => {
  const order = { id: 'x', title: 'ORC-008', customerName: 'Álvaro', quantity: 10, status: 'orcado', notes: [] };
  let attempts = 0;
  fake.mockImplementation(async path => {
    if (path.startsWith('/api/assistant?')) return reply({ company: 'Empresa', requestScope: 'tenant', workflowUpdates: true, requests: [order] });
    if (path === '/api/assistant/requests/x') return reply(order);
    if (path === '/api/assistant/draft') {
      if (++attempts === 1) throw Error('Conexão perdida');
      return reply({ updatedRequestId: 'x', message: 'Aprovação registrada.' });
    }
    throw Error(path);
  });
  render(<AssistantChat />);
  fireEvent.click(await screen.findByRole('button', { name: 'Todos os pedidos' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar produção' }));
  await screen.findByRole('heading', { name: 'Confirmar aprovação' });
  expect(screen.getByRole('form', {name:'Confirmar aprovação'}).closest('article')).toBeTruthy();
  expect(screen.queryByRole('region',{name:'Orçamento do pedido'})).toBeNull();
  expect(attempts).toBe(0);
  fireEvent.change(screen.getByLabelText('Prazo a partir de hoje (dias)'), { target: { value: '7' } });
  expect((screen.getByLabelText('Data de entrega') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  fireEvent.change(screen.getByLabelText('Data de entrega'), { target: { value: '2026-11-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e salvar' }));
  await screen.findByText('Conexão perdida');
  expect((screen.getByLabelText('Data de entrega') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reenviar a mesma aprovação' }));
  await screen.findByText('Confirmação: Aprovação registrada.');
  const calls = fake.mock.calls.filter(c => c[0] === '/api/assistant/draft');
  expect(JSON.parse(calls[0][1].body)).toMatchObject({ requestId: 'x', message: 'Aprovado; 10 unidades; entregar dia 04/11/2026', attachments: [] });
  expect(calls[1][1].body).toBe(calls[0][1].body);
});

it('detalhe mantém abas e separa orçamento, arquivos e histórico sem inventar envio', async () => {
  const quote = { name: 'Chaveiro NFC', size: '5 cm', options: [{ quantity: 10, unitPrice: 8, deliveryDays: 7 }] };
  fake.mockImplementation(async path => {
    if (path.startsWith('/api/assistant?')) return reply({ company: 'Empresa', requestScope: 'tenant', requests: [{ id: 'x', title: 'ORC-008 Chaveiro', quantity: 10, status: 'orcado' }] });
    if (path === '/api/assistant/requests/x') return reply({ id: 'x', title: 'ORC-008 Chaveiro', quantity: 10, status: 'orcado', customerQuote: quote, notes: [], createdAt: '2026-10-22T12:00:00Z' });
    throw Error(path);
  });
  const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  render(<AssistantChat />);
  fireEvent.click(await screen.findByRole('button', { name: 'Todos os pedidos' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir pedido' }));
  await screen.findByRole('region', { name: 'Orçamento do pedido' });
  expect(screen.getByRole('region', { name: 'Arquivos do pedido' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Histórico do pedido' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Todos os pedidos' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByText('Orçamento enviado')).toBeNull();
  expect(screen.getByText('Pedido criado')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copiar texto' }));
  await screen.findByText('Orçamento copiado!'); expect(copy.mock.calls[0][0]).toContain('80,00');
  const chooseFile = vi.spyOn(HTMLInputElement.prototype, 'click');
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' })); expect(chooseFile).toHaveBeenCalled(); chooseFile.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Conversar' }));
  expect(screen.queryByRole('region', { name: 'Arquivos do pedido' })).toBeNull();
});
it('seletor confirma e reenvia status sem modificar o cartão antes da resposta', async () => {
  let tries = 0;
  const order = { id: 'x', title: 'ORC-008', status: 'produzindo', quantity: 10, updatedAt: '2026-10-28T12:00:00Z' };
  fake.mockImplementation(async path => {
    if (path.startsWith('/api/assistant?')) return reply({ company: 'Empresa', requestScope: 'tenant', workflowUpdates: true, requests: [order] });
    if (path.endsWith('/status')) { if (++tries === 1) throw Error('Conexão perdida'); return reply({ message: 'Status atualizado com sucesso.', request: { status: 'finalizado', updatedAt: '2026-10-28T13:00:00Z' }, note: { id: 'n' } }); }
    throw Error(path);
  });
  render(<AssistantChat />); fireEvent.click(await screen.findByRole('button', { name: 'Todos os pedidos' }));
  fireEvent.change(await screen.findByLabelText('Filtrar pedidos por status'), { target: { value: 'all' } });
  await waitFor(() => expect((screen.getByLabelText('Filtrar pedidos por status') as HTMLSelectElement).value).toBe('all'));
  fireEvent.change(screen.getByLabelText('Atualizar status de ORC-008'), { target: { value: 'finalizado' } });
  expect(tries).toBe(0);
  expect(screen.getByRole('form', {name:'Confirmar mudança de status'}).closest('article')).toBe(screen.getByLabelText('Atualizar status de ORC-008').closest('article'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar status' })); await screen.findByText('Conexão perdida');
  expect((screen.getByLabelText('Atualizar status de ORC-008') as HTMLSelectElement).value).toBe('produzindo');
  fireEvent.click(screen.getByRole('button', { name: 'Reenviar a mesma atualização' })); await screen.findByText('Status atualizado com sucesso.');
  expect((screen.getByLabelText('Atualizar status de ORC-008') as HTMLSelectElement).value).toBe('finalizado');
  expect(within(screen.getByRole('status',{name:'Confirmação de atualização'})).getByText('Status atual: Finalizado. A alteração foi salva no histórico.')).toBeTruthy();
  const calls = fake.mock.calls.filter(c => c[0].endsWith('/status')); expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({ expectedStatus: 'produzindo', expectedUpdatedAt: order.updatedAt });
});

it('mantém ORC único e imagem na conversa seguinte sem pedir seleção novamente', async () => {
  const order={id:'orc8',title:'ORC-008 Chaveiro',customerName:'Álvaro',quantity:1,status:'orcado',quotedPrice:25.9,notes:[]};
  let calls=0;
  fake.mockImplementation(async (path:string) => {
    if(path.startsWith('/api/assistant?')) return reply({company:'Empresa',seller:'Equipe',mode:'ai',requests:[]});
    if(path==='/api/assistant/assets') return reply({id:'photo',name:'novo-chaveiro.png',mime:'image/png'});
    if(path==='/api/assistant/requests/orc8') return reply(order);
    if(path==='/api/assistant/draft') return reply({draft:null,action:{intent:++calls===1?'lookup':'update',note:'Incluir a imagem no pedido para produção'},selectedRequestId:'orc8',candidates:[order],message:'Pedido localizado.'});
    if(path.endsWith('/notes')) return reply({message:'Imagem salva no pedido.'});
    throw Error(path);
  });
  const {container}=render(<AssistantChat/>);
  await screen.findByLabelText('Criar, consultar ou atualizar um pedido');
  fireEvent.change(container.querySelector('input[type=file]')!,{target:{files:[new File(['image'],'novo-chaveiro.png',{type:'image/png'})]}});
  await screen.findByText('✓ novo-chaveiro.png');
  fireEvent.change(screen.getByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'ORC-008'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  await screen.findByRole('region',{name:'Pedido da conversa'});
  expect(screen.queryByRole('region',{name:'Selecionar pedido'})).toBeNull();
  expect(screen.getByText('Ainda não foi salva no pedido.')).toBeTruthy();
  expect(screen.queryByRole('status', {name:'Confirmação de atualização'})).toBeNull();
  expect(screen.getByText('✓ novo-chaveiro.png')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Criar, consultar ou atualizar um pedido'),{target:{value:'Incluir no pedido para produção'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  await screen.findByLabelText('Confira o complemento');
  const payload=JSON.parse(fake.mock.calls.filter(c=>c[0]==='/api/assistant/draft')[1][1].body);
  expect(payload).toMatchObject({requestId:'orc8',attachments:['photo'],message:'Incluir no pedido para produção'});
  expect(fake.mock.calls.filter(c=>c[0].endsWith('/notes'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Confirmar complemento'}));
  await screen.findByText('Imagem salva no pedido.');
  const receipt=screen.getByRole('status',{name:'Confirmação de atualização'});
  expect(within(receipt).getByText('Pedido atualizado com sucesso')).toBeTruthy();
  expect(within(receipt).getByText('ORC-008')).toBeTruthy();
  expect(within(receipt).getByText('Atualização salva no histórico. 1 anexo salvo no pedido.')).toBeTruthy();
  fireEvent.click(within(receipt).getByRole('button',{name:'Entendi'}));
  expect(screen.queryByRole('status',{name:'Confirmação de atualização'})).toBeNull();
  expect(JSON.parse(fake.mock.calls.find(c=>c[0].endsWith('/notes'))![1].body).attachments).toEqual(['photo']);
  expect(screen.queryByText('✓ novo-chaveiro.png')).toBeNull();
});

it('anexa imagem ao pedido selecionado sem nova interpretação e preserva confirmação no retry', async () => {
  const order={id:'orc8',title:'ORC-008',quantity:1,status:'orcado',notes:[]};
  fake.mockImplementation(async (path:string) => {
    if(path.startsWith('/api/assistant?')) return reply({company:'Empresa',requests:[order]});
    if(path==='/api/assistant/assets') return reply({id:'photo',name:'referencia.png',mime:'image/png'});
    if(path==='/api/assistant/requests/orc8') return reply(order);
    if(path.endsWith('/notes')) throw Error('Conexão perdida');
    throw Error(path);
  });
  const {container}=render(<AssistantChat/>);
  fireEvent.click(await screen.findByRole('button',{name:'Meus pedidos'}));
  fireEvent.click(await screen.findByRole('button',{name:'Abrir pedido'}));
  await screen.findByRole('region',{name:'Arquivos do pedido'});
  fireEvent.change(container.querySelector('input[type=file]')!,{target:{files:[new File(['image'],'referencia.png',{type:'image/png'})]}});
  fireEvent.click(await screen.findByRole('button',{name:'Anexar ao pedido'}));
  fireEvent.click(screen.getByRole('button',{name:'Confirmar complemento'}));
  await screen.findByRole('alert');
  expect(screen.queryByRole('status',{name:'Confirmação de atualização'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Reenviar o mesmo complemento'}));
  await waitFor(()=>expect(fake.mock.calls.filter(c=>c[0].endsWith('/notes'))).toHaveLength(2));
  const notes=fake.mock.calls.filter(c=>c[0].endsWith('/notes'));
  expect(notes[1][1].body).toBe(notes[0][1].body);
  expect(fake.mock.calls.some(c=>c[0]==='/api/assistant/draft')).toBe(false);
});

it('cancelamento é confirmado no próprio cartão e só então sai dos pedidos ativos', async()=>{
 const order={id:'x',title:'ORC-008 errado',status:'aguardando-orcamento',quantity:1,updatedAt:'2026-10-28T12:00:00Z'};
 fake.mockImplementation(async(path:string)=>{
  if(path.startsWith('/api/assistant?'))return reply({company:'Empresa',requestScope:'tenant',workflowUpdates:true,requests:[order]});
  if(path.endsWith('/status'))return reply({message:'Status atualizado com sucesso.',request:{status:'cancelado',updatedAt:'2026-10-28T13:00:00Z'},note:{id:'cancel'}});
  throw Error(path);
 });
 const scroll=vi.fn();const original=HTMLElement.prototype.scrollIntoView;HTMLElement.prototype.scrollIntoView=scroll;
 try {
  render(<AssistantChat/>);fireEvent.click(await screen.findByRole('button',{name:'Todos os pedidos'}));
  const select=await screen.findByLabelText('Atualizar status de ORC-008');
  fireEvent.change(select,{target:{value:'cancelado'}});
  expect(screen.getByRole('form',{name:'Confirmar mudança de status'}).closest('article')).toBe(select.closest('article'));
  expect(scroll).not.toHaveBeenCalled();
  expect(fake.mock.calls.some(c=>c[0].endsWith('/status'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Manter pedido'}));
  expect(screen.queryByRole('form',{name:'Confirmar mudança de status'})).toBeNull();
  fireEvent.change(select,{target:{value:'cancelado'}});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar cancelamento'}));
  await screen.findByText('Status atual: Cancelado. A alteração foi salva no histórico.');
  expect(screen.queryByLabelText('Atualizar status de ORC-008')).toBeNull();
  expect(JSON.parse(fake.mock.calls.find(c=>c[0].endsWith('/status'))![1].body)).toMatchObject({status:'cancelado',expectedStatus:'aguardando-orcamento',expectedUpdatedAt:order.updatedAt});
  expect(within(screen.getByLabelText('Filtrar pedidos por status')).getByRole('option',{name:'Cancelado'})).toBeTruthy();
 } finally {HTMLElement.prototype.scrollIntoView=original;}
});

it('mostra a lista e feedback de carregamento antes da resposta e preserva cartões ao retornar', async () => {
 let finish!: (v:any)=>void;
 fake.mockImplementation(async path => {
   if(path.includes('summary=true')) return reply({company:'Empresa',requestScope:'tenant',requests:[]});
   return new Promise(resolve=>{finish=resolve;});
 });
 render(<AssistantChat/>); fireEvent.click(await screen.findByRole('button',{name:'Todos os pedidos'}));
 expect(screen.getByRole('heading',{name:'Pedidos'})).toBeTruthy(); expect(screen.getByText('Carregando pedidos…')).toBeTruthy();
 finish(reply({company:'Empresa',requestScope:'tenant',requests:[{id:'one',title:'Pedido já carregado',quantity:1,status:'orcado'}]}));
 await screen.findByText('Pedido já carregado');
 fireEvent.click(screen.getByRole('button',{name:'Conversar'})); fireEvent.click(screen.getByRole('button',{name:'Todos os pedidos'}));
 expect(screen.getByText('Pedido já carregado')).toBeTruthy(); expect(screen.getByText('Carregando pedidos…')).toBeTruthy();
 finish(reply({company:'Empresa',requestScope:'tenant',requests:[]})); await waitFor(()=>expect(screen.queryByText('Carregando pedidos…')).toBeNull());
});

it('mantém ORC e número antes do nome na lista e no detalhe, mesmo com nome comercial diferente', async()=>{
 const order={id:'medals',title:'Medalhas personalizadas',code:'ORC-015',requestNumber:15,customerQuote:{name:'Medalhas CAMPEÃ',options:[{quantity:3,unitPrice:10}]},quantity:3,status:'orcado',notes:[]};
 fake.mockImplementation(async path=>path.includes('/requests/medals')?reply(order):reply({company:'Empresa',requestScope:'tenant',requests:path.includes('summary')?[]:[order]}));
 render(<AssistantChat/>);fireEvent.click(await screen.findByRole('button',{name:'Todos os pedidos'}));
 await screen.findByRole('heading',{name:'ORC-015 — Medalhas personalizadas'});
 fireEvent.click(screen.getByRole('button',{name:'Abrir pedido'}));await screen.findByRole('heading',{name:'ORC-015 — Medalhas CAMPEÃ'});
});

it('abre a aba em ordem crescente e inverte pela seta sem recarregar uma lista completa', async () => {
  const requests = [{ id: 'a', title: 'ORC-1001 Poster' }, { id: 'b', title: 'Antigo' }, { id: 'c', title: 'Placa', requestNumber: 9 }];
  fake.mockResolvedValue(reply({ company: 'Empresa', requestScope: 'tenant', requests }));
  render(<AssistantChat />);
  const openList = () => fireEvent.click(screen.getByRole('button', { name: 'Todos os pedidos' }));
  await screen.findByRole('button', { name: 'Todos os pedidos' });
  openList();
  const titles = () => screen.getAllByRole('heading', { level: 3 }).map(e => e.textContent);
  const button = await screen.findByRole('button', { name: /Mudar para ordem decrescente/ });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  expect(titles()).toEqual(['ORC-009 — Placa', 'ORC-1001 — Poster', 'Antigo']);
  const calls = fake.mock.calls.length;
  fireEvent.click(button);
  expect(titles()).toEqual(['ORC-1001 — Poster', 'ORC-009 — Placa', 'Antigo']);
  expect(fake.mock.calls).toHaveLength(calls);
  fireEvent.click(screen.getByRole('button', { name: 'Conversar' }));
  openList();
  await waitFor(() => expect(titles()[0]).toBe('ORC-009 — Placa'));
});

it('permite cadastrar quantidade e total no cartão e só marca Orçado ao confirmar', async () => {
  const order = { id: 'p', title: 'Placa', code: 'ORC-039', quantity: 1, status: 'aguardando-orcamento', quotedPrice: null };
  fake.mockImplementation(async (path: string) => path.endsWith('/status')
    ? reply({ request: { quantity: 3, quotedPrice: 98.75, status: 'orcado' }, note: { id: 'n' }, message: 'Salvo.' })
    : reply({ company: 'Empresa', requestScope: 'tenant', workflowUpdates: true, requests: [order] }));
  render(<AssistantChat />);
  fireEvent.click(await screen.findByRole('button', { name: 'Todos os pedidos' }));
  const select = await screen.findByLabelText('Atualizar status de ORC-039');
  fireEvent.change(select, { target: { value: 'orcado' } });
  const form = within(screen.getByRole('form', { name: 'Confirmar mudança de status' }));
  fireEvent.change(form.getByLabelText('Quantidade'), { target: { value: '3' } });
  fireEvent.change(form.getByLabelText('Valor total do orçamento (R$)'), { target: { value: '98,75' } });
  expect(fake.mock.calls.some(c => c[0].endsWith('/status'))).toBe(false);
  fireEvent.click(form.getByRole('button', { name: 'Confirmar status' }));
  await screen.findByText('Status atual: Orçado. A alteração foi salva no histórico.');
  expect(JSON.parse(fake.mock.calls.find(c => c[0].endsWith('/status'))![1].body)).toMatchObject({ quantity: 3, quotedPrice: 98.75 });
  expect(select.closest('article')?.textContent).toMatch(/3 unidades/);
});
