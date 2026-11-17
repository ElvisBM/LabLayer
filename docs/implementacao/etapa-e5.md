# E5 — recebimentos e conciliação gerencial

Atualização posterior: os [complementos B12–B14](./fechamento-plano.md) acrescentam devolução física, crédito/dispensa comercial, revisão após fatos físicos, arquivos privados e registro de envio. As limitações descritas abaixo retratam o fechamento original desta etapa; a homologação real permanece pendente.

Base: `274f08a` (E4). Implementação local em **20/10/2026**. O plano original permanece em `docs/mapeamento/07-plano-de-correcao.md`. Esta entrega implementa os comandos financeiros, a comparação estimado/realizado e o ensaio integrado isolado. **Não representa homologação de uma empresa real nem liberação em produção.** O roteiro dessa liberação está em [piloto-e5.md](./piloto-e5.md).

## Uso e contrato de negócio

Abrir **Financeiro e conciliação**, no topo da aplicação. Após o corte E3, Painel e Financeiro usam esse mesmo módulo. Antes da ativação, o novo módulo pode ser consultado, mas seus comandos financeiros são bloqueados. O financeiro histórico permanece apenas para empresas ainda no modelo legado.

1. **Pedido aprovado:** gera expectativa comercial/a receber; não cria dinheiro nem presume pagamento pelo status de produção. O total e o custo estimado continuam vindo da versão E4 aceita.
2. **Recebimento:** registrar valor bruto, taxa efetivamente retida, data/hora efetiva e documento único, incluindo parcela/linha. O bruto abate a dívida; bruto menos taxa é a entrada líquida. Taxa zero deve ser explícita. Parcelas não podem superar o saldo do pedido.
3. **Conta prevista:** descrição, categoria, valor, vencimento e origem. Não afeta caixa. Material exige vínculo ao evento de compra E3 e valor original arredondado para centavos, independentemente do saldo atual. Uma compra não recebe duas contas ativas.
4. **Pagamento:** baixar parte ou todo o saldo da conta com data efetiva e documento de débito. Não é inferido do vencimento, recebimento de material nem cadastro de máquina/insumo.
5. **Reembolso:** registrar bruto devolvido e eventual taxa restituída pelo intermediário. Não devolver uma taxa mantém seu custo no caixa. Não altera produção/expedição. Pedido com valor ainda recebido não pode ser cancelado; primeiro reembolsar ou estornar conforme o fato real.
6. **Estorno:** evento compensatório, com referência ao original, data efetiva e motivo; nunca apaga o lançamento. A mesma origem só é estornada uma vez. Dependências impedem estornar um recebimento cujo reembolso ainda não foi revertido. A data do estorno não pode anteceder seu original.
7. **Conferência final do pedido:** exige estoque e financeiro conciliados, todas as unidades expedidas, recebimento integral e ausência de produção vinculada ativa. O responsável informa as despesas adicionais reais e confirma todas as taxas, sem repetir parcelas já absorvidas no estoque. Gera snapshot imutável da conferência.
8. **Reabertura:** motivo explícito permite revisar lançamentos/despesas; a conferência antiga permanece preservada e visível. O resultado vigente volta a pendente até nova conferência. Pedido conferido não admite novos lançamentos nem novos planos vinculados antes da reabertura.

Cancelamento comercial com consumo/expedição continua bloqueado pela E4. Reembolso financeiro **não é devolução física**, e não deve ser usado para simular retorno de produto ou filamento. Devolução após expedição, troca e revisão comercial após produção exigem um fluxo compensatório físico específico, ainda fora desta entrega. Não há restauração automática de saldo anterior.

Enquanto o pedido permanece ativo, o reembolso reabre seu saldo a receber; não reduz silenciosamente o preço aceito. Cancelamento permitido encerra essa expectativa. Abatimento comercial ou crédito após expedição exige o fluxo específico ainda pendente, e não deve ser representado por nova baixa fictícia ou edição direta da proposta.

## Cálculos, datas e significado das telas

| Visão | Fonte / data | Cálculo e limite |
|---|---|---|
| Pedidos aprovados, bruto | `salesOrders.createdAt` | Soma dos preços aprovados no mês; não é dinheiro recebido nem receita contábil reconhecida |
| Cancelamentos | `salesOrders.cancelledAt` | Mostrados no mês do cancelamento; não apagam aprovação de mês anterior |
| Caixa realizado | `financeEvents.effectiveAt` | Recebido bruto − reembolsado − taxas líquidas − pagamentos; estornos compensam suas parcelas |
| A receber/a pagar | Projeções atuais e eventos acumulados | Pendências de todos os pedidos/contas ativos; não integram caixa realizado |
| Compras recebidas | `stockPurchases.receivedAt` | Soma do valor imutável do evento; estornos aparecem separadamente pela data de `stockReversals.createdAt` |
| Estimado por pedido | Snapshot E4 aprovado | Custo e taxas preservados; não recalcula proposta com dados atuais |
| Custo realizado confirmado | Saídas E3 + perdas totais vinculadas + adicional confirmado | `Σ custo das expedições + Σ lossCost das execuções vinculadas + despesa adicional real` |
| Resultado gerencial do pedido | Conferência vigente, `closedAt` | Preço aprovado − taxas efetivas líquidas − custo realizado confirmado |
| Diferença de custo | Estimado e realizado do mesmo pedido | Realizado − estimado; mostra diferença, sem forçar equivalência |

Todas as visões mensais usam **America/Sao_Paulo**. API recebe instantes com fuso explícito, persiste UTC e registra separadamente a data de gravação do servidor. A interface solicita horário **UTC−03:00**; a API também aceita outros offsets explícitos. Data de vencimento é dia de calendário, sem convertê-lo em evento financeiro. Caixa futuro é recusado (tolerância de cinco minutos para relógio); previsão deve ser uma conta. Recebimento de pedido canônico não pode anteceder sua criação. Datas inválidas e valores com frações de centavo são recusados.

Valores de caixa são inteiros em centavos, até 1.000.000.000 por comando. Entradas em reais aceitam vírgula ou ponto, até duas casas, sem agrupamento ambíguo. Agregados fora da faixa segura de inteiros são recusados. Custos operacionais mantêm a precisão decimal E3 de até 12 casas: arredondar o custo unitário antes da retirada mudaria o resultado. A interface apresenta moeda com duas casas; API/snapshots conservam a precisão de custo.

**Não é saldo bancário:** a tela mostra a movimentação líquida registrada; não presume saldo de abertura nem extratos não informados. **Não é DRE/lucro líquido da empresa:** energia, manutenção e trabalho pagos aparecem no caixa, mas não são subtraídos novamente do resultado do pedido que já absorveu conversão no estoque. Despesas adicionais por pedido são confirmação manual com origem. A distribuição automática de faturas entre execução, estoque, depreciação e despesa de período não foi implementada; não se declara conciliação contábil automática.

O resultado mensal de pedidos considera **conferências vigentes**. Reabrir uma conferência retira o resultado corrente desse conjunto até nova conferência; não reescreve seu snapshot anterior. O histórico preservado fica na memória de conferência. Não deve ser utilizado como demonstração contábil histórica fechada.

Custos antigos desconhecidos e versões ausentes não são preenchidos com zero. Legado não é migrado implicitamente; as telas avisam esse recorte. Custo realizado fica `null`/pendente até expedição completa e conferência. Abertura E3 foi declarada pelo operador; sua confiabilidade real depende do piloto, não apenas da consistência matemática.

## Produção, perdas e alertas

O valor expedido já contém o custo médio dos materiais, insumos, componentes e conversão registrados pela E3. Rejeição parcial está absorvida no custo das unidades boas e não é somada novamente. Falha total (`lossCost`) não entra no estoque de acabado: quando vinculada ao pedido, entra uma vez em seu custo realizado, inclusive se houve reimpressão posterior. Produção não vinculada permanece no histórico operacional e não é atribuída por nome ou inferência.

Excedentes de lote permanecem no estoque. Por isso, estimativa de lote inteiro e custo efetivamente expedido podem divergir legitimamente. A memória mostra custo de execuções, perda total, custo expedido, despesas finais e quantidades de cada atendimento. Não soma toda a produção ao custo de venda e também à expedição.

Ranking usa `productId/variationId`; avulso usa orçamento/item. Nomes iguais não unem produtos. Ranking representa os itens aprovados no mês, bruto; cancelamentos estão em indicador separado. Horas de impressora vêm de `stockPrinterUsage.seconds`, após o corte, sem inventar uso anterior. `operacional` é o único estado que admite novo plano; `manutenção`, `inativa` e situação não informada são indisponíveis. Não há previsão automática de manutenção ou afirmação de precisão do histórico legado.

## Autoridade, API e reconciliação

`shared/finance/model.ts` define valores, datas, projeções e relatório puro. `server/finance.ts` autentica, consulta as fontes e executa transações. `src/features/finance/FinancePage.tsx` apresenta o relatório retornado pela API e os formulários. A interface não recalcula outro conjunto de indicadores a partir de coleções distintas.

- `GET /api/tenants/:tenantId/finance/report?month=YYYY-MM`: leitura consistente, inclui conciliação E3 e divergências financeiras, sem corrigir dados.
- `POST /api/tenants/:tenantId/finance/commands`: `{requestId, type, expectedVersion, payload}`.
- Tipos: `receive`, `refund`, `pay`, `reverse`, `create-payable`, `cancel-payable`, `close-order`, `reopen-order`.
- Membro da empresa ativa pode consultar. Proprietário ou administrador do vínculo empresarial protegido pode registrar operações. Ator vem do token; campos extras, totais forjados e identidade enviada no corpo são recusados.

| Coleção | Autoridade |
|---|---|
| `financeEvents` | Evento de caixa imutável, parcelas, líquido, referência, instante efetivo e data de registro |
| `financeAccounts` | Projeção financeira do pedido e estado da conferência; não substitui a proposta aceita |
| `payables` | Obrigação prevista, origem, vencimento e projeção de pagamentos |
| `financeReversals` | Vínculo único de estorno ao evento original |
| `orderClosures` | Snapshot imutável de cada conferência, estimado/realizado e origem |
| `financeActions` / `auditLogs` | Ação, parâmetros, responsável, motivo e resultado na mesma transação |
| `financeCommands` | Recibo idempotente por chave/conteúdo/ator; leitura direta negada |
| `financeSources` | Unicidade de referência por namespace caixa/conta; normaliza caixa, Unicode e espaços |
| `financePurchaseLinks` | Vínculo da compra E3 a uma conta; protegido no servidor |

Rules negam toda mutação direta dessas coleções, inclusive ao proprietário no navegador. Mesma chave/conteúdo/ator retorna o recibo; outra chave não duplica documento de caixa. Conta/recebimento concorrente confere versão e saldo na transação. Interface preserva a chave após erro de conexão. Evento, projeção, situação de pagamento do pedido, referência única, recibo e auditoria gravam juntos; falha na auditoria aborta tudo.

Cancelar pedido confere sua conta financeira; estornar compra E3 confere conta vinculada. A conta precisa estar cancelada, com pagamentos compensados, antes do estorno físico permitido pela E3. O estorno financeiro não apaga o recebimento físico e o físico não apaga pagamento.

A conciliação compara projeções com eventos, vínculos de estorno, quantidades expedidas com atendimento, preço com proposta aceita, custo com conferência preservada e compra com evento original. Em seguida combina o resultado com a conciliação de saldo/reserva/execução E3. Divergências bloqueiam conferência final; não são reescritas como correção automática. Pendências normais de expedição ou conferência são distintas de divergências.

Limites de leitura: até 500 pedidos e impressoras, até 10.000 documentos nas coleções financeiras/eventos; os limites cadastrais E3 de abertura também se aplicam. Exceder o limite rejeita o relatório, sem certificar amostra. Este desenho é apropriado ao piloto; paginação por período/empresa e agregações incrementais deverão preceder escala maior. O relatório faz leituras transacionais completas e deve ser atualizado sob demanda, não por polling frequente.

## Evidências e liberação

A suíte nova inclui unidades monetárias, datas/fuso, pendências sem caixa, compras imutáveis, diferença estimado/realizado, ausência de dupla contagem, perda total, ranking por ID, estornos/dependências, concorrência, idempotência, autorização/rules, auditoria atômica, falha/retorno de conexão e jornada integrada com estoque conciliado. Os testes E0–E4 permanecem inalterados.

**Barreira completa aprovada em 20/10/2026:** `npm run quality`, com Node 22 e Java 21, terminou com código 0. Foram **274 testes aprovados**: 147 unitários/interface em 16 arquivos e 127 de integração em 9 arquivos. Os 240 testes E0–E4 foram preservados; a E5 adicionou 34 casos (18 unitários/interface e 16 de integração). TypeScript, build e auditoria de produção também passaram. Permanecem 1 alerta baixo e 8 moderados, nenhum alto/crítico na árvore de produção, e o aviso de bundle acima de 500 kB. Log completo: [evidências E5](./evidencias-e5-quality.txt).

Não foi acessada empresa real, aplicado deploy, enviado push nem executada movimentação real. O piloto automatizado demonstra conservação e coerência no emulador; a liberação operacional permanece pendente da conferência humana descrita no [roteiro do piloto](./piloto-e5.md).

### Dependências corrigidas durante a validação

A primeira barreira passou nos testes/build, mas falhou na auditoria de produção com dois pacotes de severidade alta: Vite e follow-redirects. A atualização foi restrita ao lockfile: **Vite 6.4.3 → 6.4.4** e **follow-redirects 1.16.0 → 1.16.1**, sem migração de versão principal, alteração de faixas no manifesto ou uso de `audit fix --force`. A barreira integral foi repetida após essas correções e o ajuste final da visão de cancelamentos por data.

Referências verificadas em 20/10/2026: [advisory Vite/launch-editor](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [follow-redirects — cabeçalhos em redirecionamentos](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8) e [follow-redirects — tratamento de cabeçalhos sensíveis](https://github.com/advisories/GHSA-8r9p-f939-6h3c). A remoção dos alertas altos de produção não equivale a auditoria sem alertas na árvore inteira de desenvolvimento.
