# Regras e fluxos existentes no LabLayer

As regras abaixo descrevem a implementação atual. Os efeitos informados são específicos do caminho indicado: salvar pela tela e salvar pela API não executam necessariamente as mesmas operações.

## Acesso e empresa

| Regra | Comportamento implementado | Fonte |
|---|---|---|
| AC01 | Login por email e senha via Firebase. Identificador sem `@` recebe o sufixo `@empresa.com`. Redefinição exige email completo. Não há cadastro público de conta nessa tela. | [Login:13](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Login.tsx:13) |
| AC02 | Na primeira autenticação, cria `users/{uid}` com `tenantId=uid`, `tenantRole=owner` e papel `admin`, salvo administrador global. Empresa nova recebe plano `free` e estado `active`. | [AuthContext:25](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/contexts/AuthContext.tsx:25) |
| AC03 | Perfil já existente pode apontar para outra empresa; ausência de vínculo usa o UID como fallback. Falha de inicialização também usa UID. | [AuthContext:44](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/contexts/AuthContext.tsx:44) |
| AC04 | Administrador global é identificado por email fixo no código ou `role=superadmin`. A tela global altera plano e situação de empresas. | [SuperAdmin:23](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/SuperAdmin.tsx:23) |
| AC05 | A aplicação exige usuário autenticado, mas não consulta situação ou plano da empresa para bloquear módulos. Não há expiração automática de trial nem cobrança implementada nos arquivos examinados. | [App:47](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/App.tsx:47) |

## Fornecedores e compras de filamentos

| Regra | Comportamento implementado | Fonte |
|---|---|---|
| FO01 | Fornecedor tem nome, telefone, endereço, observação e estado ativo/inativo. Pode ser editado ou excluído sem verificar compras associadas. | [Fornecedores:58](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Fornecedores.tsx:58) |
| FI01 | Filamento identifica material, marca, linha, cor, diâmetro e histórico de compras. Compra informa kg, R$/kg, data, loja e fornecedor. | [Filamentos:9](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Filamentos.tsx:9) |
| FI02 | O histórico considerado contém compras com quantidade maior que zero. Registro legado sem histórico válido usa `initialStockKg`, ou `stockKg` quando o primeiro não existe. | [Filamentos:160](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Filamentos.tsx:160) |
| FI03 | Ao salvar, soma todas as compras, calcula preço médio ponderado, grava total comprado em `initialStockKg` e saldo em `stockKg`. A compra mais recente determina data, loja e fornecedor no nível principal. | [Filamentos:378](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Filamentos.tsx:378) |
| FI04 | O saldo mostrado é calculado como compras menos consumo inferido dos produtos, limitado a zero; não é apenas uma leitura de `stockKg`. | [Filamentos:262](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Filamentos.tsx:262) |
| FI05 | O botão de conciliação regrava `stockKg` com essa conta. O botão de recalcular compras também atualiza histórico, total comprado, custo médio e metadados. Não registra movimentos individuais. | [Filamentos:497](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Filamentos.tsx:497) |
| FI06 | Exclusão pela tela é bloqueada quando produtos carregados indicam consumo positivo do filamento. Não verifica agenda, solicitações ou perdas independentes. A API não replica essa proteção. | [Filamentos:465](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Filamentos.tsx:465) |
| FI07 | Fornecedores inativos continuam disponíveis, identificados como inativos; nomes antigos sem ID são mantidos como histórico. | [Filamentos:324](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Filamentos.tsx:324) |

Filtrar filamentos por data usa a data principal, normalmente a compra mais recente. Os totais gerais são calculados sobre a coleção inteira, não sobre a lista filtrada. Não existe custo por lote consumido, FIFO ou média móvel aplicada na data da produção; a média considera todo o histórico disponível.

## Insumos e impressoras

| Regra | Comportamento implementado | Fonte |
|---|---|---|
| IN01 | Insumo registra nome, categoria, quantidade atual, unidade livre, custo unitário, mínimo e data de compra. Editar substitui esses valores; não cria histórico de aquisição. | [Insumos:50](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Insumos.tsx:50) |
| IN02 | Item em baixa quando `quantity <= minStock`. O indicador “Valor Total Gasto” multiplica saldo atual por custo unitário. | [Insumos:117](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Insumos.tsx:117) |
| IN03 | Exclusão não verifica vínculo com fichas de produto; um insumo ausente passa a contribuir com custo zero no motor. | [Insumos:93](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Insumos.tsx:93) |
| IM01 | Impressora tem aquisição, vida útil em horas, orçamento de manutenção, consumo energético, data de compra e estado `operacional`, `manutenção` ou `inativa`. | [Impressoras:7](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Impressoras.tsx:7) |
| IM02 | Tarifa energética é única por empresa, em `settings/printer`. Manutenção mensal usada no custo é configurada no simulador, em `settings/pricing`. | [Impressoras:60](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Impressoras.tsx:60) |
| IM03 | Excluir impressora não verifica produtos relacionados. O motor pode passar a usar média da frota ou valor manual. | [Impressoras:113](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Impressoras.tsx:113) |
| IM04 | `usedHours` é exibido e pode ser reduzido ao excluir produto; não foi localizado incremento equivalente ao salvar produto ou concluir agenda. | [Produtos:1096](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1096) |

## Produtos e ficha de fabricação

Fonte principal: [Produtos:364](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:364), [salvamento:865](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:865), [custo e estoque:1439](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1439).

| Regra | Comportamento implementado |
|---|---|
| PR01 | Tipos de registro: `produto`, `encomenda`, `orcamento`. Estados: `ativo`, `inativo`, `desenvolvimento`. Novo registro começa em desenvolvimento. Esses tipos não criam `customRequests`. |
| PR02 | Produto reúne SKU base, categoria, imagem, custo fixo, ficha técnica, variações, arquivos, desperdícios, insumos e mesas de produção. |
| PR03 | Cada variação pode conter vários materiais, peso, purga, tempo, rendimento, impressora, custo manual e preços por canal. A ficha técnica é descritiva; preenchimento, camada, suporte e dimensões não calculam consumo automaticamente. |
| PR04 | Mesas explicitam início/fim, horas, número de produtos e kg de cada filamento. Quando presentes, geram a primeira variação com pesos e horas somados e rendimento igual ao total de produtos. As demais variações permanecem. |
| PR05 | Abrir edição prioriza variações oriundas da agenda e prepara mesas. Se não houver mesas próprias, procura ordem concluída pelo nome do produto; caso contrário, reconstrói mesas a partir de materiais. Sem qualquer mesa, cria uma mesa inicial. |
| PR06 | Salvar regrava o estoque de produtos a partir de `getProductStockInfo`. Essa função prioriza mesas próprias ou reconstruídas; não representa um saldo descontado por vendas. |
| PR07 | Consumo de filamentos é inferido da ficha. Criar produto baixa esse consumo; editar aplica a diferença entre ficha antiga e nova. Isso ocorre também com tipo orçamento e estado desenvolvimento. Não há condição de aprovação ou produção efetiva. |
| PR08 | Insumos são baixados pela quantidade por produto multiplicada pelo total de produtos calculado. A edição aplica diferença. Saldo insuficiente é truncado para zero, sem bloquear o salvamento. |
| PR09 | Produto e baixas de filamentos/insumos são escritos em um batch. Os saldos vêm do estado carregado no navegador, sem releitura transacional para detectar concorrência. |
| PR10 | Purga gera registro em `losses` somente ao criar produto, para materiais cadastrados e purga positiva. Editar a purga não sincroniza esses registros. `wastes` não gera o mesmo log automaticamente. |
| PR11 | Excluir produto devolve todo consumo inferido de filamentos e insumos e apaga perdas ligadas a `productId`. Pode reduzir horas da impressora fora do batch. Não distingue material já transformado, vendido ou perdido. |
| PR12 | A lista mostra faixa de custo e sugestão automática de venda; preço de canal salvo e positivo tem precedência para valor de venda exibido. O último preço do simulador não é, por si só, aplicado a `channelPrices`. |
| PR13 | Arquivos guardam nome, tipo, versão e URL. Tipos declarados: STL, GCODE, 3MF, STEP e PDF. Não há leitura de geometria ou parser de fatiador que derive peso e tempo desses arquivos. |

O cálculo de montagem por partes existe, mas seu caminho normal é interceptado pela reconstrução de mesas a partir desses mesmos materiais. O exemplo “10 bases e 6 tampas” retorna 16 produtos no cenário reproduzido, e não 6 conjuntos. Ver C19 e a explicação no catálogo de cálculos.

## Orçamentos e encomendas

Fonte: [EncomendasOrcamentos:10](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EncomendasOrcamentos.tsx:10), [prévia:227](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EncomendasOrcamentos.tsx:227), [salvar:336](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EncomendasOrcamentos.tsx:336).

| Regra | Comportamento implementado |
|---|---|
| OR01 | Solicitação tem título, descrição, tipo, status, origem manual/WhatsApp, cliente, telefone, mensagem original, quantidade, horas, impressora e filamentos. Não existe entidade própria de cliente. |
| OR02 | Estados permitidos: aguardando orçamento, orçado, fila de produção, produzindo e finalizado. O formulário permite escolher o estado diretamente; não impõe sequência nem pré-condições por etapa. |
| OR03 | Datas de envio, aprovação, pagamento, início e conclusão são campos manuais independentes. Aprovação não registra identidade de aprovador, aceite do cliente, versão aceita ou autenticação do cliente. |
| OR04 | Só calcula prévia se houver material com peso positivo e tempo maior que zero. O motor usa rendimento 1, custo fixo 0 e não recebe insumos, desperdícios separados ou taxas de canal. |
| OR05 | O cálculo trata peso e tempo informados como custo de uma unidade e multiplica a sugestão pela quantidade pedida. Os rótulos não esclarecem suficientemente essa unidade de referência. |
| OR06 | Valor orçado pode ser manual. Ao salvar, zero usa a sugestão automática por causa do operador `||`. Quantidade é limitada a pelo menos 1, mas não é arredondada para inteiro. |
| OR07 | Upload pela tela lê imagem até 1 MiB e guarda data URL no próprio registro. Não usa o upload do servidor. Há dois campos de imagem e um link adicional de mídia. |
| OR08 | Salvar/excluir afeta apenas `customRequests`. Não reserva material, não cria produto, produção, venda, conta a receber ou transação. |
| OR09 | Busca da tela considera título e descrição; ordenação usa atualização ou criação decrescente. Contadores de status consideram todas as solicitações. |

Não foram encontrados estados de recusado, cancelado, expirado, revisão solicitada ou pagamento parcial; também não há validade do orçamento, desconto estruturado, parcelas, aprovação por link ou geração/envio automático de proposta.

## Agenda de produção

Fonte: [AgendaProducao:149](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/AgendaProducao.tsx:149), [ações:475](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/AgendaProducao.tsx:475).

| Regra | Comportamento implementado |
|---|---|
| AG01 | Ordem tem nome de produto, vínculo opcional por ID, link do modelo, notas e mesas. Cada mesa tem horário, duração, produtos previstos e consumo em kg. Não identifica uma impressora específica. |
| AG02 | Nova ordem começa em `fila`; iniciar muda para `produzindo`; concluir muda para `concluida` e registra `completedAt`. Alterar estado não exige cronologia validada no servidor. |
| AG03 | Fila aberta inclui tudo que não está concluído; horas planejadas somam todas as mesas dessas ordens. Calendário agrupa pelo dia de início e não modela ocupação contínua ou conflitos entre máquinas. |
| AG04 | Concluir procura produto por ID, depois por nome normalizado. Soma quantidades das mesas ao `stock`; agrega mesas e uma variação `agenda-{id}`. Sem produto correspondente, cria produto ativo com esse estoque e SKU gerado. |
| AG05 | Produto e conclusão da ordem são gravados em um batch, mas sem guarda transacional contra dupla conclusão. A variação é deduplicada pelo ID da ordem; a soma de estoque não tem a mesma proteção. |
| AG06 | Conclusão não baixa `filaments.stockKg`, não baixa insumos, não gera perdas, não incrementa horas da impressora e não atualiza solicitações. O consumo poderá aparecer nas telas que o inferem das variações criadas. |
| AG07 | Ordem antiga sem `tables` vira uma única mesa a partir dos campos legados. `tablesCount` e `totalHours` não são usados para multiplicar essa mesa no normalizador. |
| AG08 | Editar ou excluir ordem já concluída não desfaz nem reconcilia o produto originado. Novo produto criado não recebe de volta um vínculo obrigatório na ordem. |

## Canais e formação de preço

Fonte: [Marketplaces:7](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Marketplaces.tsx:7), [Precificacao:110](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Precificacao.tsx:110), [ValoresSugeridos:284](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/ValoresSugeridos.tsx:284).

| Regra | Comportamento implementado |
|---|---|
| PC01 | Canal registra comissão percentual, taxa fixa, frete médio, comissão de afiliado, prazo de pagamento e estado. Afiliado e prazo são exibidos, mas não entram nos cálculos localizados. |
| PC02 | Simulador exige produto e canal; seleciona variação. Metas: lucro em reais, margem percentual, multiplicador de markup ou preço manual. Compara os canais e ordena por margem. Não filtra canais inativos. |
| PC03 | Salvar sugestão acrescenta histórico no produto, limitado aos 50 mais recentes, e atualiza `latestSuggestedPrice`. Não altera `channelPrices`. |
| PC04 | Valores sugeridos usa a primeira variação e multiplicador fixo 2,2. Salvar valor manual positivo escreve Venda Direta na primeira variação e o último preço sugerido. |
| PC05 | Recalcular todos percorre todos os produtos, não apenas os visíveis no filtro. Pode sobrescrever Venda Direta, recalcula entradas antigas do histórico e atualiza o último preço. Faz gravações sequenciais; não é operação atômica do conjunto. |
| PC06 | Preços dentro da variação usam nome de canal e taxa percentual própria. Não há vínculo obrigatório ou sincronização com o cadastro de marketplaces. |

## Vendas e resultado financeiro

Fonte: [Vendas:84](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Vendas.tsx:84), [Financeiro:127](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Financeiro.tsx:127).

| Regra | Comportamento implementado |
|---|---|
| VE01 | Nova venda exige produto e canal selecionados; registra quantidade, valor total vendido, taxas totais, cliente e estado `pago`, `produzindo` ou `enviado`. |
| VE02 | Custo usa `product.cost × quantity`. O editor de produtos não preenche `cost`; ausência resulta em zero. Valor vendido e taxas não são multiplicados pela quantidade. |
| VE03 | Pedido guarda nomes de produto e canal, sem `productId`, `variationId` ou `channelId`. Número manual é aleatório de cinco dígitos, sem verificação de unicidade. |
| VE04 | Criar venda não baixa estoque, não gera produção e não gera transação financeira. Não existe cancelamento ou estorno implementado nessa tela. |
| VE05 | Detalhes e listagem existem. Importação CSV é apenas modal; sincronização usa atraso simulado e aviso. Campo de busca não está ligado a filtro. |
| FN01 | Transação manual tem entrada/saída, categoria, valor, data e pago/pendente. Ambos os estados entram nas somas de caixa e despesas. |
| FN02 | Fluxo de caixa usa transações manuais e compras derivadas de cadastros. Não inclui automaticamente o valor das vendas. |
| FN03 | DRE usa valores de vendas, despesas por categorias selecionadas e custos gravados nos pedidos. Categorias fora da lista de mapeamento não entram automaticamente no resultado. |
| FN04 | Datas são filtradas por prefixo textual de mês. Vendas, impressoras e insumos podem entrar por data própria OU criação, inclusive em meses diferentes. |
| FN05 | Compra de insumo é inferida pelo saldo atual multiplicado pelo custo. Compra de filamento usa histórico; legado usa quantidade inicial ou saldo. Aquisição de impressora entra como investimento. |

## Perdas e indicadores

| Regra | Comportamento implementado | Fonte |
|---|---|---|
| PE01 | Controle de perdas lista registros por data, filtra tipo e soma peso/custo. Excluir log não devolve estoque nem altera ficha do produto. Não há formulário de criação manual nessa tela. | [ControlePerdas:21](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/ControlePerdas.tsx:21) |
| ES01 | Estoque inteligente alerta produtos ativos com saldo até o mínimo; padrão 5 unidades. Filamentos usam `stockKg` e padrão 0,5 kg. Mínimo zero é substituído pelo padrão. | [EstoqueInteligente:31](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EstoqueInteligente.tsx:31) |
| ES02 | Essa tela não considera reserva, pedidos abertos, prazo de fornecedor ou consumo projetado. Insumos têm alerta na própria tela. | [EstoqueInteligente:7](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EstoqueInteligente.tsx:7) |
| DA01 | Painel soma vendas e lucro de todo o histórico, estoque de produtos ativos, número de cadastros de insumos e filamentos recalculados. Rankings agregam por nomes, não por IDs. | [Dashboard:109](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Dashboard.tsx:109) |
| DA02 | Impressoras ativas no painel exigem `online` ou `imprimindo`, estados diferentes do cadastro e das regras Firestore. | [Dashboard:143](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Dashboard.tsx:143) |

## Matriz de efeitos entre módulos

| Ação | Produtos | Filamentos e insumos | Perdas | Agenda | Vendas e financeiro |
|---|---|---|---|---|---|
| Salvar solicitação | Não | Não | Não | Não | Não |
| Marcar solicitação aprovada/paga | Não | Não | Não | Não | Não |
| Criar produto pela tela | Cria e deriva estoque | Baixa consumo inferido | Registra purga | Não | Não |
| Editar produto pela tela | Regrava ficha e estoque | Aplica diferença | Não sincroniza purga | Não | Não |
| Excluir produto pela tela | Exclui | Devolve consumo inferido | Exclui por produto | Não | Não |
| Concluir agenda | Cria/atualiza e soma estoque | Não grava baixa | Não | Conclui | Não |
| Registrar venda manual | Não baixa estoque | Não | Não | Não | Cria pedido; não cria recebimento |
| Excluir perda | Não | Não | Exclui log | Não | Não |
| CRUD pela API | Apenas documento escolhido | Sem efeitos derivados | Auditoria separada | Sem orquestração | Sem orquestração |
