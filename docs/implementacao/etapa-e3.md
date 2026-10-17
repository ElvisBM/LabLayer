# E3 — estoque por movimentos e execução

Base: `63f8f74` (E2 e evidências de regressão E0/E1). Implementação local em 17/10/2026. Esta etapa implementa o núcleo de estoque/produção e o mecanismo de corte conjunto E2/E3 por empresa. Não executa migração em dados reais, implantação, aprovação comercial E4 nem fechamento financeiro E5.

## Fluxo disponível na interface

Abrir **Estoque e produção — operações e migração**, no topo da aplicação. Antes do corte, as telas anteriores continuam funcionando. Depois do congelamento, a navegação de estoque, filamentos, insumos, agenda, perdas e painel usa o novo módulo; produtos usa o catálogo E2. Recarregar ou manter um navegador antigo não contorna as rules.

1. Conferir o backup/restauração e a classificação de todos os produtos legados no catálogo E2. Concluir ou reconciliar execuções antigas em andamento. Pausar os operadores para o corte.
2. O responsável pela empresa informa motivo e referência do backup e confirma **Iniciar corte e congelar legado**. A API recusa o corte se encontrar produção/solicitação legada com status `produzindo`.
3. Informar o físico e o valor total de cada filamento, insumo e variação de produto, inclusive zeros. Abertura é uma contagem explícita: não copia `stockKg`, `quantity` ou estoque inferido por nome/ficha. Erros de abertura podem ser corrigidos com ajuste identificado durante o congelamento.
4. Executar **Conferir abertura e conciliação**. Classificações ausentes, saldos sem cadastro, unidades incompatíveis e divergências impedem ativar. O responsável confirma fisicamente os saldos/valores e ativa o modelo novo.
5. Receber compras com quantidade, valor total atribuído e identificação única de documento/linha. O sistema impede repetir a mesma origem mesmo com nova chave de comando.
6. Escolher produto, variação/ficha e número de execuções. O plano fixa a receita e reserva materiais/insumos/componentes. A falta de saldo é erro explícito. Montagens mostram quantas unidades os componentes disponíveis permitem montar.
7. Concluir uma ou mais execuções do plano informando unidades boas/rejeitadas, tempo e consumo real de cada item, incluindo zeros deliberados. Informar custos reais de conversão e sua origem. A transação libera somente a reserva correspondente, consome o real e dá entrada nas unidades boas.
8. Reservar produto acabado para um pedido/venda existente, com vínculo conferido por ID. Expedir parte ou toda a reserva; o pagamento não é condição para expedir. Cancelar libera apenas a reserva restante.
9. Conferir movimentos, saldos, reservas, planos, expedições e horas. Divergências são exibidas; o botão de conferência nunca reescreve saldo automaticamente.

O novo cadastro de material começa com abertura zero auditada; a entrada física vem de compra/contagem. Novo produto ou variação criado pelo catálogo exige abertura explícita antes de fabricar/reservar. No piloto, preparar esses cadastros antes da ativação reduz interrupções.

## Contratos e autoridade

`shared/inventory/model.ts`: unidades, saldo, disponibilidade, custo médio, requisitos de receita e conciliação. `server/inventory.ts`: autorização, transações, comandos e verificação dos vínculos. `src/features/inventory/`: interface e leitura do estado da migração. O navegador não escreve saldo diretamente.

| Coleção no tenant | Autoridade e significado |
|---|---|
| `inventoryControl/state` | Fase `legacy` (ou documento ausente), `frozen`, `active`; versão, responsável e conferências |
| `stockBalances` | Projeção de físico, reservado, valor e versão por tipo/ID/variação |
| `stockEvents` | Evento imutável por comando, com deltas de físico/reservado/valor e versões anterior/posterior |
| `inventoryCommands` | Recibo e fingerprint para repetição segura; inacessível diretamente pelo cliente |
| `stockPurchases` | Origem de recebimento única, quantidade/valor e comando |
| `stockReservations` | Reserva ativa de plano ou pedido; quantidade restante, vínculo e versão |
| `stockPlans` | Receita fixada, execuções planejadas/restantes e saídas acumuladas |
| `stockRuns` | Execução imutável: consumo, valor de saída, boas/rejeitadas, tempo, conversão e perda |
| `stockPrinterUsage` | Segundos acumulados das execuções após o corte; não mistura horas legadas inferidas |
| `stockFulfillments` | Vínculo estável do pedido antigo ao produto/variação, alvo, reservado e expedido |
| `stockShipments` | Expedição imutável ligada a pedido/reserva, quantidade e custo de saída |
| `stockReversals` | Referência única do evento compensado |
| `auditLogs` | Auditoria escrita na mesma transação do efeito |

Leitura exige vínculo com empresa ativa. Compra, plano, execução, reserva, expedição e cancelamento são permitidos aos membros autenticados da empresa, seguindo o modelo operacional existente. Congelamento, abertura, ativação, cadastro de material, ajuste e estorno exigem o responsável (`ownerUid` e UID do tenant). Ator vem do token; identidade, permissões e empresa são verificadas dentro da transação. Regras negam escrita direta nas novas coleções, inclusive por proprietário/superadmin no navegador.

Endpoints:

- `POST /api/tenants/:tenantId/inventory/commands`: `{requestId, type, expectedVersion, payload}`; tipo define schema estrito. Campos extras são recusados.
- `GET /api/tenants/:tenantId/inventory/reconcile`: conferência consistente em transação, sem efeito físico.

Tipos: `freeze`, `open`, `activate`, `create-material`, `purchase`, `adjust`, `plan`, `complete`, `reserve-order`, `ship`, `cancel`, `reverse`. Versão esperada se refere ao controle de migração, saldo, plano, atendimento ou reserva, conforme o comando; criações exigem versão zero. A UI captura a versão ao selecionar a operação/item. Não substitui silenciosamente a versão após uma atualização remota.

Cada comando tem recibo por tenant. Mesma chave, conteúdo e ator retornam o resultado anterior; chave com conteúdo/ator diferente causa 409. Uma falha de conexão conserva a chave na interface para repetir. Recibo, projeções, evento, documentos operacionais e auditoria são atômicos; falha na auditoria aborta tudo. Uma nova chave também não conclui novamente um plano encerrado. Referências de pedido, material, receita e impressora precisam existir no tenant.

## Regras de quantidades, custo e execução

- Filamento: miligramas inteiros, apresentados/recebidos como gramas na interface; `0,4 g = 400 mg`. Produto/componente: unidades inteiras. Insumo: decimal na unidade cadastrada, até seis casas; não converter unidade automaticamente.
- Quantidades e valores são strings decimais, calculadas com a instância decimal isolada da E1. Entradas negativas, não finitas, notação exponencial e excesso de precisão são recusadas. Limite por quantidade/valor: `10^12`; contagens de execução/tempo seguem os limites inteiros da E2.
- `disponível = físico − reservado`. Reservar não altera físico nem valor. Reservas nunca podem superar o físico e a saída não pode usar reserva alheia.
- Entrada: `novo físico = físico + recebido`; `novo valor = valor + custo total recebido`. Custo médio é `valor / físico`. O valor da compra já deve incluir frete/despesas atribuídas àquela linha; não há rateio implícito de nota nesta etapa.
- Saída: `custo = valor × quantidade consumida / físico`, arredondado em 12 casas decimais de real. A última saída leva todo o valor restante, eliminando resíduos com saldo físico zero. O histórico conserva o valor efetivamente baixado.
- Plano reserva peso **total** da ficha por execução; suporte/purga não são somados novamente. Materiais repetidos na ficha são agregados pelo ID; insumos multiplicam quantidade por unidade boa prevista × rendimento × execuções. Uma execução tem uma variação de saída, vários materiais e uma única contagem de unidades boas.
- `boas + rejeitadas = rendimento × execuções concluídas`. Isso permite um plano de várias execuções terminar parcialmente sem supor que a reserva inteira foi consumida. Limite do plano: 1.000 execuções; limite de insumos/componentes distintos por operação: 40.
- A conclusão recebe todos os consumos reais da ficha, inclusive zero explícito, e libera a reserva planejada correspondente. Consumo acima da previsão exige disponibilidade adicional; consumo menor libera a diferença. Impressão com saída boa não pode ter consumo de filamento totalmente zero.
- Montagem baixa exatamente os componentes da ficha por unidade tentada, incluindo rejeitadas. Dez bases e seis tampas permitem seis conjuntos, nunca dezesseis acabados. A reserva/saída de componentes e a entrada do acabado acontecem juntas. Versões de componente são verificadas e montagem aninhada continua não suportada.
- Custo da execução = valor real dos materiais/insumos/componentes baixados + conversão confirmada (energia, trabalho, máquina/manutenção e outros). Todas as parcelas e sua origem são obrigatórias, incluindo zeros. **Conversão é informada e confirmada pelo operador; esta etapa não mede energia nem calcula automaticamente taxas de máquina/trabalho.** Não somar materiais novamente na conversão. A E1 continua intacta para estimativas; o custo realizado é identificado como `inventory-plus-confirmed-conversion`.
- Havendo unidades boas, todo o custo da execução é atribuído a elas, incluindo rejeitos parciais. Sem unidades boas, o custo inteiro é perda, sem entrada de valor em acabado. Rejeitos são registrados em `stockRuns`; não há segunda baixa na coleção legada de perdas. Essa política de absorção está explícita e testada.
- Impressora vem da ficha fixada; duração real é informada na execução. As horas após o corte são projeção dos segundos de `stockRuns`. Troca de impressora requer outra versão/plano; planejamento avançado de capacidade continua no backlog.
- Reimpressão é novo plano ligado a uma execução anterior do mesmo produto/variação, com nova reserva/consumo. Não reabre nem reescreve a execução falha.
- Expedição consome acabado reservado ao pedido e registra custo de saída. Atendimentos somam expedido + reservado sem superar a quantidade do pedido fixada no primeiro vínculo. Nomes não unem saldos. O registro comercial antigo não é reprecificado ou alterado por expedir.
- Cancelar plano parcialmente realizado libera apenas o restante. Não devolve material transformado. Estorno automático é limitado a compra/ajuste sem operação posterior no saldo e sem reserva, com confirmação física. Outros casos exigem ajuste compensatório de contagem/valor pelo responsável, com motivo e origem; não há uma ação que desfaça fisicamente uma impressão.

## Corte dos escritores antigos

A partir de `frozen`, as rules bloqueiam criação/alteração/exclusão nas coleções legadas de produtos, filamentos, insumos, produção, perdas/falhas, movimentos, vendas, transações e solicitações. O cadastro de impressoras continua editável; exclusão de impressora referenciada pelo modelo novo é bloqueada e horas antigas não recebem incrementos novos. Fornecedores, canais e configurações permanecem editáveis.

A API administrativa e o webhook recusam gravar solicitações antigas após o corte. O comando E1 não cria novos snapshots sobre produtos legados após o corte. Repetir um comando já concluído pode devolver seu recibo sem nova escrita. A checagem de fase participa da transação, evitando corrida com congelamento.

O catálogo E2 permanece disponível: editar/arquivar ficha não movimenta estoque nem muda plano já confirmado. Depois do corte, as antigas telas de orçamento, venda, financeiro e precificação ficam explicitamente bloqueadas, pois ainda não foram integradas ao novo modelo. **Por isso, não ativar o corte de uma empresa em produção que dependa desses fluxos antes de E4/E5.** O código de corte é entregue/testado agora; a liberação real é coordenada após homologação.

Pedidos/vendas existentes podem ser atendidos na E3 mediante vínculo manual conferido ao produto/variação. Criação comercial nova, proposta congelada, aprovação e criação automática de pedido pertencem à E4. Pendências legadas em fila devem ser conferidas e replanejadas explicitamente após a abertura; não há conversão automática da fila nem reconstrução de consumo passado.

## Conciliação, limites e recuperação

A conferência soma os deltas imutáveis e compara físico, reservado e valor com cada saldo. Também compara reservas com planos/atendimentos ativos, quantidades de pedidos com reservas/expedições, e segundos acumulados com execuções. Detecta referências órfãs, saldos inválidos e divergência de unidade. Não ajusta nada por nome, custo estimado ou receita atual.

A UI limita cada listagem a 500 registros, informa truncamento e mostra os 100 movimentos/versões recentes. A conferência de abertura exige até 500 registros por coleção cadastral/saldos; a conciliação até 10.000 por coleção de movimentos/execuções. Exceder os limites recusa o relatório/ativação, sem certificar uma amostra incompleta. Paginação operacional ampliada e processamento de grandes históricos são evolução necessária antes de escalar além desse recorte.

A API permite comandos com no máximo 40 itens de entrada e recusa mais de 81 projeções por evento; não divide uma operação física em commits parciais. Contenção se concentra nos itens/planos/pedidos afetados; a fase do tenant é lida, não incrementada em toda operação. Operações concorrentes sobre saldo escasso são resolvidas pelo Firestore e disponibilidade real.

Não há retorno automático de `active` para `legacy`: depois de fatos físicos novos, restaurar uma cópia antiga apagaria a operação. Preservar eventos/recibos, congelar acesso externamente se necessário e corrigir para frente com ajustes rastreáveis. Antes de qualquer ativação real, executar backup/restauração em cópia, conferir fila/itens/unidades, ensaiar o corte, homologar contenção com Firestore real e liberar cliente, servidor e rules compatíveis. Um texto de referência ao backup no comando é declaração do operador, não verificação automática do arquivo.

## Qualidade

Os testes E0/E1/E2 permanecem na suíte acumulada. Casos E3 cobrem matemática decimal, conservação de valor, reservas sem baixa, disponibilidade, precisão, consumo acima do previsto, conclusão parcial, perda total, reimpressão, montagem, expedição parcial, concorrência, idempotência, auditoria atômica, isolamento entre empresas, autorização, bloqueio dos escritores antigos e conciliação de vínculos/horas. Os testes de interface cobrem leitura da projeção, `0,4 g`, comando autenticado, repetição após falha de rede, confirmação do corte e ausência de custos reais presumidos.

### Casos numéricos de referência

| Caso testado | Resultado esperado |
|---|---|
| 1.000 mg a R$ 100 + compra de 1.000 mg a R$ 300; saída de 500 mg | Físico restante 1.500 mg, valor R$ 300, custo da saída R$ 100 |
| Três unidades com valor total R$ 1, retiradas individualmente | Soma das saídas exatamente R$ 1; saldo e valor finais zero |
| Dois planos disputam os últimos 400 mg | Apenas um reserva; o outro recebe indisponibilidade |
| Plano de duas execuções de 400 mg; conclusão de uma consumindo 450 mg | Reserva cai de 800 para 400 mg; físico cai somente 450 mg |
| Consumo de 450 mg a R$ 0,01/mg + 18 insumos a R$ 0,50 + R$ 4 de conversão; nove boas e uma rejeitada | Custo total R$ 17,50 atribuído às nove boas |
| Mesmo custo com zero boas e dez rejeitadas | Perda de R$ 17,50, sem entrada de acabado ou valor fictício |
| Dez bases e seis tampas, uma de cada por montagem | Seis acabados, quatro bases e zero tampas restantes |
| Dez acabados valendo R$ 20; reservar cinco e expedir dois | Físico oito, reservado três, valor R$ 16; custo expedido R$ 4 |

### Gate final — 17/10/2026

Comando executado com Node 22/Java 21: `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" caffeinate -i npx --yes --package=node@22 -c 'npm run quality'`. Finalizou com **código 0**, após os últimos ajustes de interface. [Saída integral](./evidencias-e3-quality.txt).

| Verificação | Resultado |
|---|---|
| TypeScript | Aprovado |
| Unitários/interface | 106 testes, 12 arquivos; 3,28 s |
| Integração Express + Firestore demo | 92 testes, 7 arquivos; 53,21 s |
| Total acumulado | 198 testes aprovados: 158 anteriores + 40 novos E3 |
| Build | Aprovado; aviso preexistente de bundle acima de 500 kB |
| Auditoria de produção | Aprovada pelo critério E0: 0 altos/críticos; 1 baixo e 8 moderados remanescentes |
| Regressão | Nenhum arquivo de teste anterior alterado; nenhum caso removido, ignorado ou marcado para execução exclusiva |
| Diff | Conferido, sem erros de whitespace; `scripts/` preexistente permanece fora do commit |

Os três casos novos de concorrência usam o orçamento explícito do emulador já documentado na E2. Os demais mantêm os limites existentes; não houve relaxamento de testes para fechar a etapa. Dois gates completos passaram durante o fechamento, além da rodada focal de desenvolvimento.

Nenhum teste usa produção. Nenhum push, deploy ou corte real foi executado. Aprovação local comprova os cenários automatizados, não substitui homologação de uso, migração em cópia ou concorrência no Firestore real. A próxima etapa de implementação é E4; a ativação em produção continua condicionada ao conjunto funcional e ao piloto.
