# E4 — orçamento, aprovação e pedido

Base: `7e14251` (E3). Implementação local em 17/10/2026. O plano original permanece em `docs/mapeamento/07-plano-de-correcao.md`; este documento registra os contratos implementados. Nenhuma migração, implantação, push ou escrita em dados reais faz parte desta etapa.

## Jornada entregue

Abrir **Orçamentos e pedidos**, no topo da aplicação. Após o corte E3, os atalhos de encomendas, vendas e precificação passam a abrir este módulo. O financeiro continua reservado à E5. Antes do corte é possível preparar propostas; aprovação requer estoque E3 ativo.

1. Criar solicitação/rascunho com cliente, contato, descrição, referência visual HTTPS, quantidade e itens de catálogo ou avulsos. Pode referenciar uma solicitação legada existente. A peça avulsa tem custo unitário confirmado e origem explícita; não cria produto nem movimenta estoque.
2. Para catálogo, selecionar produto, variação e ficha publicada. Informar tarifas de produção, despesas por pedido, taxas, meta e desconto. Campos financeiros vazios podem permanecer no rascunho, mas impedem prévia/emissão; zero deve ser informado deliberadamente.
3. Salvar com motivo e calcular a prévia no servidor. Conferir custos abertos, política de lote/excedentes, parcelas comerciais, resultado e centavos por item/unidade. Taxas percentuais e margem usam frações (`0,10 = 10%`); markup usa **fator** (`1,30 = custo + 30%`), conforme E1.
4. Definir validade e emitir a versão conferida. O servidor recalcula e compara a impressão digital da prévia. Se estoque, máquina, ficha/dados ou política relevante mudaram, exige nova conferência. A emissão preserva entradas, fontes, receitas, resultados, autor e datas em documento imutável.
5. O proprietário ou administrador da empresa registra o aceite informado externamente: quem informou, canal e evidência. Identidade e data do registro vêm do servidor. Não representa assinatura/autenticação do cliente. Aprovação cria um único pedido; repetir o comando ou aprovar novamente a mesma versão retorna esse pedido.
6. Cada item tem um atendimento. Produto de catálogo conserva produto/variação/versão; peça avulsa fica aguardando vínculo explícito a uma ficha E2. Esse vínculo operacional não altera os termos nem o preço aceito.
7. Reservar produto disponível e/ou planejar fabricação da falta. Material insuficiente impede o plano, sem apagar o pedido nem criar reserva fictícia. Executar produção, reserva de acabado e expedição pelos comandos E3. Não há recebimento financeiro automático ou sinal obrigatório presumido.
8. Recusa, expiração, revisão e cancelamento têm motivo/evento. Editar uma proposta emitida abre rascunho e invalida sua versão anterior para aprovação; versões antigas permanecem consultáveis, identificadas como substituídas. Proposta vencida não pode ser aprovada, mesmo que sua projeção ainda diga `issued`.

## Autoridade e persistência

| Documento por empresa | Significado |
|---|---|
| `quotes/{id}` | Rascunho/dados comerciais, revisão otimista, estado e ponteiro para versão vigente |
| `quotes/{id}/versions/{id}` | Proposta emitida imutável com entradas, cálculo E1, receitas, alocações em centavos, validade e origem |
| `quoteEvents/{requestId}` | Evento imutável com ação, estado anterior/novo, revisão, ator, instante e dados da ação |
| `quoteCommands/{requestId}` | Recibo idempotente por conteúdo/ator/orçamento; leitura direta negada |
| `salesOrders/{quoteId}` | Pedido canônico único, versão aprovada, total, aceite informado e situação comercial/pagamento |
| `orderTargets/{id}` | Item de atendimento, quantidade, ficha fixada, produto ou pendência de vínculo |
| `auditLogs/quote-{requestId}` | Auditoria atômica com o evento, estado e recibo |

`orders` continua sendo a coleção histórica. Os novos pedidos usam `salesOrders`, protegida desde sua criação por rules que negam toda escrita direta, inclusive antes do corte E3. Não ficam expostos às permissões de edição legadas. O atendimento E3 resolve primeiro o alvo canônico; para pedidos históricos mantém a compatibilidade anterior. IDs dos alvos derivam de orçamento + item, com verificação de colisão.

Endpoints autenticados:

- `POST /api/tenants/:tenantId/quotes/:quoteId/preview`: `{expectedRevision}`; calcula o rascunho salvo sem produzir efeitos.
- `POST /api/tenants/:tenantId/quotes/:quoteId/commands`: `{requestId, type, expectedRevision, payload}`.
- Tipos: `save-draft`, `issue`, `approve`, `decline`, `expire`, `cancel`, `bind-custom`, `cancel-order`.

Schemas recusam campos extras. Autor, empresa autorizada, datas e totais não são recebidos como autoridade do navegador. Membros podem preparar/emitir/encerrar propostas; aprovação, vínculo posterior de avulso e cancelamento de pedido exigem proprietário ou `tenantRole: admin` no vínculo protegido da empresa. A claim global não substitui vínculo empresarial. Todas as leituras precedem a gravação transacional. Falha na auditoria aborta a operação inteira. A interface conserva a chave do comando após erro de rede.

## Cálculos e origem dos custos

O módulo `server/quote-cost.ts` adapta dados canônicos para `shared/pricing/engine.ts`; não cria outro motor de preço. `shared/quotes/model.ts` valida o contrato e distribui os centavos comerciais entre itens.

- Impressão: execuções = teto(quantidade pedida / rendimento da ficha). Peso total já inclui suporte e purga. Tempos, preparação, acabamento e insumos vêm da ficha fixada. Potência = consumo cadastrado em kWh/h × 1.000 W; depreciação = aquisição / vida útil × horas. Vida útil zero ou valor ausente bloqueiam a prévia.
- Filamento: custo médio do estoque em R$/mg × 1.000.000 = R$/kg. Insumo: valor do saldo / quantidade na unidade cadastrada. Havendo saldo positivo, esse custo médio prevalece. Sem saldo/custo médio disponível, é obrigatória uma tarifa de referência com origem. Não se presume custo zero a partir de cadastro incompleto.
- Montagem: componentes são estimados pelas fichas de impressão fixadas, considerando a quantidade total necessária. Não imprime novamente no cálculo do conjunto; soma o custo estimado desses componentes ao trabalho/insumos da montagem. Montagem aninhada permanece não suportada. Estoque real dos componentes será valorizado pela média E3 na execução; estimativa e realizado são distintos.
- **Lote inteiro:** custo comercial do item = custo de toda a produção estimada. **Unidades do pedido:** custo comercial = parcela proporcional às unidades pedidas, com custo do excedente explicitamente mostrado. O motor preserva as duas parcelas. Esta escolha vale também para lotes de componentes; não há agrupar lotes entre linhas diferentes silenciosamente.
- Avulso: quantidade × custo unitário informado e confirmado. A prévia identifica a origem manual. Uma ficha posterior não reprecifica a proposta aceita.
- Custo comercial base = soma dos custos escolhidos por item + despesa do pedido, uma vez. Taxas por unidade multiplicam a quantidade total; taxa por pedido incide uma vez; percentual incide sobre o preço bruto. Meta e desconto usam integralmente a E1, com arredondamento de cada taxa em centavos e alerta quando o desconto deixa de cumprir a meta. Preço manual com resultado negativo é mostrado explicitamente.
- Total final é rateado proporcionalmente ao custo de cada linha, usando maior resto e desempate pela ordem dos itens. Se todos os custos forem zero, usa a quantidade como peso. Os unitários mostram os dois valores possíveis, separados por um centavo, cuja soma fecha exatamente o total. É uma alocação do preço global; não oferece preços/metas individuais independentes por item.

### Exemplos de referência automatizados

| Caso | Resultado |
|---|---|
| Lote de 10, pedido de 5; material 4 + energia 0,20 + depreciação 2 + manutenção 2 + rateio 4 + preparação 3 + acabamento 2 + insumos 10 | Lote R$ 27,20; parcela pedida R$ 13,60; excedente R$ 13,60 |
| 3 avulsos × R$ 10 + despesa de R$ 5; taxa 10% + R$ 1/pedido + R$ 0,50/unidade; margem 20% | R$ 53,58 antes do desconto. R$ 53,57 não cumpre a margem após arredondar a taxa |
| Mesmo caso com R$ 1 de desconto | Total R$ 52,58; taxas R$ 7,76; alerta de meta não atendida |
| Total de 10.001 centavos, custos relativos 10 e 20 | Itens de 3.334 e 6.667 centavos; unitários reconciliam sem perder centavos |
| Cinco conjuntos com dois componentes impressos cada | Um lote de dez componentes R$ 27,20 + acabamento do conjunto R$ 1 = R$ 28,20 |

## Atendimento, revisão e efeitos físicos

Aprovação não reserva material nem produto. `stockFulfillments` continua controlando quantidade reservada/expedida. Uma reserva nova verifica produto exato e saldo disponível, e não ultrapassa a quantidade aprovada. Expedição verifica que o pedido canônico continua ativo. O plano pode trazer `orderId` do alvo canônico: fixa ficha/produto e grava esse vínculo também em `stockRuns`.

Para fabricar a falta, o limite considera a quantidade do pedido, o maior entre unidades já produzidas para ele e unidades reservadas/expedidas, além das unidades ainda previstas em planos ativos. Arredonda a falta por rendimento. Planos concorrentes serializam a versão do alvo e não duplicam a mesma cobertura. Rejeitos reduzem a cobertura boa e podem exigir novo plano; excedente de lote permanece no estoque comum.

O planejamento deve primeiro separar o estoque disponível. O botão de fabricação não decide sozinho consumir produto pronto; essa escolha permanece explícita. Os planos vinculados registram destinação, mas a E3 mantém estoque comum, sem rastrear unidades por lote. Se produto fabricado para um pedido for destinado a outro, a reposição exige conferência operacional e planejamento explícito no módulo E3; a E4 não tenta deduzir a origem física de cada unidade. Reserva de acabado continua sendo a garantia de disponibilidade.

Termos aceitos não podem ser editados. Para revisão comercial, o responsável cancela o pedido conferido e cria outro orçamento com `replacesOrderId`. O cancelamento exige ausência de reserva/expedição e de plano ativo ou execução parcial/concluída. Primeiro cancelar apenas reservas e planos sem consumo usando E3. Não restaura material transformado e não desfaz expedição. Devoluções, revisão após fatos físicos, recebimentos/reembolsos e reconciliação financeira continuam pendentes de tratamento específico na E5; nesses casos o cancelamento simples falha explicitamente.

## Limites e homologação

Até 20 linhas, 100.000 unidades comerciais, 500 execuções por item/componente, 250 referências lidas por cálculo e 700 kB por snapshot. Tarifas de referência: até 50. Validade futura de até 366 dias. UI: 500 registros por coleção e 100 versões recentes; informa truncamento e bloqueia planejamento rápido se as listas estiverem incompletas. O histórico de planos por alvo tem limite de 500 e falha sem usar amostra parcial. Paginação ampliada segue no backlog.

Não inclui envio automático por mensagem/e-mail, portal de aceite, PDF comercial, integração com marketplaces/slicers, recebimentos, conciliação contábil ou gestão de devoluções. A E4 disponibiliza a proposta na aplicação com seu histórico e memória de cálculo; canais externos continuam manuais. Novos materiais/produtos precisam da abertura E3 explícita antes de fabricar/reservar. Uma peça avulsa pode ser aprovada sem ficha e permanecer aguardando preparação.

Antes de liberar em produção: homologar a jornada com empresa piloto, identidade/permissões reais e Firestore real; ensaiar backup/corte/restauração e liberar servidor, cliente e rules compatíveis. Não avançar para uso financeiro operacional até a E5 e sua reconciliação. Testes locais não comprovam implantação ou operação real.

## Qualidade

A barreira de aceite é `npm run quality` com Node 22 e Java 21: tipos, todos os testes E0–E4, build e auditoria de produção. Novos casos cobrem contratos/valores ausentes, fórmulas e arredondamento, fontes, montagem, snapshot congelado, concorrência/idempotência, autorização, expiração/revisão, peça avulsa, atendimento por estoque/fabricação, cancelamento seguro, isolamento, rules e rollback por falha na auditoria. A jornada integrada usa abertura E3 real no emulador e concilia o estoque após fabricar/expedir.

Barreira completa aprovada em 17/10/2026: **240 testes** — 129 unitários/interface em 14 arquivos e 111 de integração em 8 arquivos. Foram acrescentados 42 casos E4 (23 unitários/interface e 19 de integração); os 198 casos E0–E3 permanecem inalterados. TypeScript e build aprovados. Auditoria de produção: 0 altos/críticos, 1 baixo e 8 moderados remanescentes, com dependências inalteradas. O build mantém o aviso de bundle acima de 500 kB; não se alterou o limite para ocultá-lo.

Evidência integral: [evidencias-e4-quality.txt](./evidencias-e4-quality.txt). Comando executado na raiz do repositório:

```sh
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" caffeinate -i npx --yes --package=node@22 -c 'npm run quality'
```

O emulador usou exclusivamente `demo-lablayer-test` em `127.0.0.1:8088`, protegido pelo guard existente. Os testes de contenção mantêm o timeout específico já documentado na E3; nenhum limite de sucesso foi relaxado. Não houve execução em Firebase real. A revisão do diff confirmou ausência de alterações nos testes anteriores e preservação do diretório preexistente `scripts/` fora do commit.
