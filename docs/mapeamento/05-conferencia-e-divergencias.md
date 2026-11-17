# Conferência da documentação e divergências

Este registro preserva os problemas observados durante o mapeamento. A ordem agrupa dependências de confiança nos dados; não é um roadmap aprovado nem uma estimativa de esforço. As indicações de melhoria são propostas para a próxima análise.

## Documentação existente versus implementação

| Referência existente | O que confere | Divergência ou ressalva |
|---|---|---|
| [README da aplicação](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/README.md) | Aplicação React/Vite e comando de desenvolvimento existem | Continua como boilerplate do AI Studio; não descreve regras, tenant, dependências administrativas, produção e custos |
| [Blueprint de dados](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/firebase-blueprint.json) | Parte das entidades e nomes de coleções permanece | Produto declara `cost` e `suggestedPrice`; editor usa `fixedCost` e custo calculado. Variação usa `printTimeMinutes` no blueprint, mas `printTimeHours` no código. Filamento declara `costPerKg`, código usa `pricePerKg`. Impressora declara vida em meses, código usa horas. Produção antiga tem prioridade, máquina e estados pendente/pausada; agenda atual usa mesas e estado fila. Não cobre solicitações, insumos, fornecedores e perdas do modelo atual |
| [API administrativa](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/admin-api.md) | Headers, rotas principais, coleções, filtros e defaults de criação simples existem | Não descreve limites de busca/exportação, enriquecimento de preço, ausência de efeitos de negócio, sobrescrita no POST fixo ou incompatibilidade com rules |
| Exemplo `settings/pricing.markup=2.2` da API | Campo pode ser armazenado pela API | Nenhum consumidor do preço sugerido lê esse campo; multiplicador está fixo no código |
| Promessa de PATCH parcial | Merge existe para documento | Normalizador de solicitações preenche campos não enviados, violando preservação parcial; pode ainda gerar undefined |
| Promessa de upload de imagem | Há implementação Storage | Sem bucket, mantém data URL; UI armazena diretamente; tamanho de payload não está alinhado |
| Auditoria por ator | Header é lido | Ator da chave individual não é usado; o header pode atribuir outro nome. Auditoria não cobre todas as telas |
| [Workflow WhatsApp](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/n8n/whatsapp-orcamentos.workflow.json) | Normaliza evento e chama rota existente | Tenant fixo, sem deduplicação, sem orçamento automático, sem aprovação ou resposta ao cliente |
| [Site e planos](/Users/PCNOTES/Workspace/3D/lablayer/SiteLabLayer/src/App.tsx:70) | Cadastros, agenda e simulador anunciados existem | Site anuncia trial de 1 mês e planos desde R$ 9,90; aplicação inicializa free e MRR usa 97/297. Não há trial/cobrança conectados |
| [README do site](/Users/PCNOTES/Workspace/3D/lablayer/SiteLabLayer/README.md) | Procedimento para lista de espera corresponde ao script | Site também tem fallback de URL; sucesso exibido não comprova gravação na planilha |
| Metadados e artefatos auxiliares | Arquivos existem | `metadata.json` ainda nomeia “Sass 3D”; relatórios de engenharia em output são de outro contexto e não validam números do LabLayer |

O blueprint antigo ajuda a explicar por que Vendas ainda lê `product.cost`; não comprova que o campo continue sendo mantido. Nenhum documento antigo foi reescrito para ocultar divergências.

## Custo e preço

| ID | Constatação e evidência | Consequência | Direção de melhoria proposta |
|---|---|---|---|
| DV01 | Simulador não passa insumos/perdas; Valores Sugeridos não passa perdas. [Precificacao:110](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Precificacao.tsx:110), C02 | Mesmo produto recebe custos diferentes | Contrato único de entrada e teste de equivalência entre consumidores |
| DV02 | Venda usa campo `cost` ausente do editor. [Vendas:96](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Vendas.tsx:96) | Custo pode ser zero e lucro inflado | Persistir custo e premissas da venda a partir da versão aprovada da ficha |
| DV03 | `wastes` entra inteiro por unidade; fixedCost também. [pricing:177](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/utils/pricing.ts:177), C03 | Custo do lote pode ser multiplicado pelo rendimento | Definir custos por lote, unidade e pedido antes de alterar fórmula |
| DV04 | Orçamento usa rendimento 1 e multiplica quantidade. [Encomendas:251](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EncomendasOrcamentos.tsx:251) | Peso/tempo de lote informado como unidade distorce orçamento | Definir entrada por lote e unidades boas, ou rotular e validar entrada unitária |
| DV05 | Zero em taxa de falha vira 5%; energia zero pode voltar a 0,95. [pricing:76](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/utils/pricing.ts:76), C04 | Configuração não é respeitada | Separar ausência, zero válido e valor inválido |
| DV06 | Catálogo e API arredondam em momentos diferentes. [server:431](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:431), C12 | Centavos divergentes entre integrações e tela | Política única de precisão e arredondamento final |
| DV07 | Material legado usa valor manual; impressora usa fallback de frota; vida zero difere na tela e no motor. C05–C09/C22 | Fallbacks ocultam cadastro incompleto e alteram custo | Tornar premissas visíveis e validar campos indispensáveis |
| DV08 | Afiliado não entra no cálculo; inteligência do produto ignora taxa fixa e frete. [Produtos:1689](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1689) | Margens de telas diferentes não são comparáveis | Modelo único de despesas por unidade/pedido/canal |
| DV09 | Recalcular preços reescreve valores do histórico e Venda Direta. [ValoresSugeridos:339](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/ValoresSugeridos.tsx:339) | Perda de referência da decisão original | Histórico imutável; recálculo gera nova versão com premissas |
| DV10 | Markup 2,2 fixo; preço mínimo/agressivo sem proteção completa de denominador. [Precificacao:189](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Precificacao.tsx:189) | Configuração esperada sem efeito; números inválidos | Centralizar parâmetro e regra de inviabilidade |

## Estoque e produção

| ID | Constatação e evidência | Consequência | Direção de melhoria proposta |
|---|---|---|---|
| DV11 | Cadastro de produto baixa material sem produção, inclusive orçamento/desenvolvimento. [Produtos:968](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:968) | Ficha técnica é confundida com execução física | Separar receita, lote planejado, reserva e consumo realizado |
| DV12 | Concluir agenda soma produto, mas não grava baixa dos materiais. [Agenda:552](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/AgendaProducao.tsx:552) | Saldo persistido e saldo inferido divergem | Um comando de conclusão grava produção, consumo e estoque juntos |
| DV13 | Venda não baixa estoque nem gera recebimento. [Vendas:119](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Vendas.tsx:119) | Disponibilidade e caixa não acompanham vendas | Definir evento de reserva/expedição e vínculo financeiro |
| DV14 | Excluir produto devolve consumo; excluir ordem concluída não desfaz produção. [Produtos:1076](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1076) | Material transformado pode reaparecer como disponível | Arquivamento de cadastro; estorno físico explícito por evento |
| DV15 | Mesas derivadas de componentes precedem montagem por menor quantidade. [Produtos:1439](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1439), C19 | 10 bases e 6 tampas podem virar 16 produtos | Modelar quantidades de componentes por conjunto e produto acabado |
| DV16 | Conversão material→mesa→variação descarta purga, arredonda g e pode duplicar semântica de variações. [Produtos:1563](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1563), C20 | Editar ficha pode mudar custos e devolver material | Migração explícita e representação sem perda de informação |
| DV17 | Saldo é limitado a zero e batches usam saldos do navegador. [Produtos:1031](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1031) | Falta fica oculta; concorrência pode perder atualizações | Transação com saldo atual e política de insuficiência |
| DV18 | Conclusão não possui guarda transacional contra repetição. [Agenda:559](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/AgendaProducao.tsx:559) | Repetições podem aumentar estoque mais de uma vez | Idempotência por evento de conclusão |
| DV19 | Purga só cria log no primeiro cadastro; horas são reduzidas sem incremento correspondente. [Produtos:1000](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1000) | Perdas e uso da máquina não reconciliam | Eventos de execução e perda independentes da edição da ficha |
| DV20 | Agenda sem máquina, reserva ou conflito de capacidade. [Agenda:24](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/AgendaProducao.tsx:24) | Fila visual não garante prazo viável | Planejamento por recurso após estabilizar duração e lote |

## Financeiro e jornada

| ID | Constatação e evidência | Consequência | Direção de melhoria proposta |
|---|---|---|---|
| DV21 | Compra de insumo calculada com quantidade restante. [Financeiro:189](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Financeiro.tsx:189) | Despesa histórica muda com consumo | Registrar documento de compra e movimentos separados |
| DV22 | Pago e pendente entram juntos no fluxo; vendas não viram entradas. [Financeiro:224](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Financeiro.tsx:224) | “Saldo atual” não corresponde a dinheiro confirmado | Separar previsto, realizado e saldo inicial |
| DV23 | Filtro por data OU criação pode incluir em meses diferentes; taxas manuais fora das categorias DRE são omitidas. [Financeiro:152](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Financeiro.tsx:152) | Competência e despesas inconsistentes | Data de referência explícita e mapeamento completo de categorias |
| DV24 | Resultado caixa subtrai compras/investimentos do lucro; custo completo pode duplicar energia/manutenção. [Financeiro:214](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Financeiro.tsx:214) | Resultado financeiro sem reconciliação | Definir regime gerencial e ponte entre custo, despesa e caixa |
| DV25 | Aprovação e pagamento são datas manuais sem efeito externo. [Encomendas:343](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EncomendasOrcamentos.tsx:343) | Jornada depende de recadastro e controle humano | Solicitação→versão de proposta→aceite→ordem→recebimento com IDs |
| DV26 | Estados de impressora divergentes no painel; planos e preços divergentes no site. [Dashboard:146](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Dashboard.tsx:146) | Indicadores e oferta não refletem o mesmo contrato | Enum e catálogo comercial únicos |

## API, acesso e crescimento

| ID | Constatação e evidência | Consequência | Direção de melhoria proposta |
|---|---|---|---|
| DV27 | Usuário pode alterar campos que concedem tenant e papel global. [firestore.rules:320](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/firestore.rules:320) | Integridade entre empresas comprometida se implantado assim | Proteger campos de autorização e testar regras no emulador antes de expandir acesso |
| DV28 | API genérica ignora validadores e efeitos das telas; updatedAt extra conflita com rules. [server:166](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:166) | Agentes podem gravar documentos que depois não editam na UI | Schema compartilhado e comandos de negócio no servidor |
| DV29 | PATCH de solicitação injeta defaults/undefined; aliases permanecem. C13/C14 | Edição parcial pode falhar ou apagar conteúdo | Normalização específica de criação e patch; preservar campos ausentes |
| DV30 | POST com ID sobrescreve; auditoria posterior e ator via header. [server:939](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:939), C15 | Repetição e falha geram resultados ambíguos | Criação com conflito, chave idempotente, log atômico e ator autenticado |
| DV31 | WhatsApp com autenticação condicional e sem deduplicação; Woo global e sem proteção própria. [server:1180](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:1180) | Entradas externas podem duplicar ou misturar dados | Credenciais por tenant, autenticação obrigatória e ID externo |
| DV32 | Conectores e CSV incompletos; configurações não persistem credenciais. [Configuracoes:122](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Configuracoes.tsx:122) | Interface comunica capacidade ainda ausente | Identificar estado real e entregar fluxo completo por conector |
| DV33 | Telas assinam coleções inteiras; API filtra janela de 5.000 e exporta até 500 sem cursor. [server:833](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:833) | Risco de custo/latência e resultados incompletos ao crescer | Paginação, filtros no banco e projeções adequadas; medir com dados representativos |
| DV34 | Histórico/mesas/mídias crescem dentro de documentos e recálculos não são divididos em lotes controlados. [Produtos:949](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:949) | Risco de limite de documento/escrita e contenção | Arquivos no Storage e eventos em coleções próprias; validar limites no ambiente alvo |
| DV35 | Lista de espera anuncia sucesso sem confirmação do script. [Site App:122](/Users/PCNOTES/Workspace/3D/lablayer/SiteLabLayer/src/App.tsx:122) | Lead pode acreditar que entrou sem gravação | Resposta verificável e tratamento de falha de negócio |

DV33/DV34 são riscos estruturais inferidos do código, sem benchmark de latência, tamanho ou volume. Não foram inventados limites de capacidade ou número de usuários suportados.

## Dependências para a próxima discussão

Primeiro, definir a unidade de fabricação e uma conta de custo consistente; em paralelo, resolver o contrato entre API, permissões e telas. Depois, separar cadastro de produto de movimento físico e conciliar saldo. Com essas bases, conectar orçamento, aprovação, produção, venda e recebimento. A automação por agentes deve operar esses comandos de negócio, preservando versões e evitando repetir operações.

Essa sequência é recomendação de produto derivada das dependências encontradas. A priorização final de gargalos, esforço, migração e entregas fica para a próxima etapa solicitada.
