# Contrato proposto de cálculo e estoque

Status: proposta técnica de 5 de outubro de 2026 para orientar implementação e homologação. Não altera o funcionamento atual. Complementa o [catálogo das fórmulas existentes](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/mapeamento/02-calculos.md). As decisões abaixo tornam explícitas unidades e eventos; registros legados ambíguos precisam de revisão antes da conversão.

## Separar as quatro unidades de negócio

| Unidade | Significado proposto | Exemplo |
|---|---|---|
| Produto e variação | Identidade vendável e ficha de fabricação versionada | Chaveiro azul com sua receita |
| Mesa ou execução | Trabalho de uma impressora, com consumo total, duração e saídas previstas/reais | Uma mesa de 10 chaveiros |
| Unidade boa | Produto aprovado para estoque/venda | 9 chaveiros bons e 1 refugo |
| Pedido | Compromisso comercial com itens, quantidades, embalagem/frete e taxas próprias | 30 chaveiros para um cliente |

Cadastro de produto descreve como produzir. Não prova que houve fabricação e não dá baixa de material. Quantidade em estoque resulta de operações realizadas. Quantidade prevista da mesa define rateio de estimativa; quantidade boa realizada define rateio do custo efetivo.

## Entradas mínimas do novo motor

| Grupo | Campos e regras propostas |
|---|---|
| Identidade | tenant, moeda BRL, recipeVersion, pricingPolicyVersion e calculationVersion |
| Material por mesa | materialId e peso total em g, com decomposição opcional entre peça, suporte e purga |
| Máquina por mesa | printerId ou perfil manual explicitamente selecionado; potência em W, duração em minutos, valor e vida útil em horas |
| Produção | Quantidades inteiras não negativas por saída; unidades boas previstas maiores que zero para calcular unitário |
| Trabalho | Minutos de setup por mesa/lote, minutos de acabamento por unidade e custo horário |
| Insumos | Quantidade por unidade e unidade de medida definida; referência ao cadastro e preço utilizado |
| Despesas adicionais | Valor e incidência obrigatória: por unidade, mesa/lote ou pedido |
| Risco | Modo explícito: nenhum, reserva adicional ou rendimento esperado; base elegível identificada |
| Canal | Percentuais, base de incidência, taxa fixa por item ou pedido; versão e vigência |
| Meta | Margem sobre receita bruta, lucro absoluto, markup sobre custo ou preço manual |

Cada parâmetro guarda origem: cadastro e revisão, entrada manual ou conversão legada confirmada. Ausente não significa zero. Zero é válido para parcelas deliberadamente gratuitas ou desativadas; preço de material desconhecido deixa a estimativa incompleta. Não substituir silenciosamente impressora ausente por média da frota. É possível salvar rascunho incompleto, mas não emitir uma proposta apresentada como calculada e completa.

No modo “peso total do fatiador”, o total já inclui o que o operador marcou como incluído. Não somar novamente suporte/purga. No modo de parcelas, exigir que a soma reconcilie com o total. Guardar a escolha na receita e no orçamento.

## Fórmulas de custo recomendadas

Para uma mesa `b`, seja `h_b = minutos_b / 60`.

```text
material_b = soma(pesoTotalGramas_i / 1000 × custoKg_i)
energia_b = potenciaWatts_b / 1000 × h_b × tarifaKWh
depreciacao_b = valorDepreciavel_b / vidaUtilHoras_b × h_b
manutencao_b = reservaManutencaoPorHora_b × h_b
rateioOperacional_b = despesasCompartilhadasPorHora × h_b
setup_b = minutosSetup_b / 60 × valorHoraTrabalho
baseImpressao_b = material_b + energia_b + depreciacao_b
                 + manutencao_b + rateioOperacional_b + setup_b
```

`valorDepreciavel` começa com custo de aquisição; eventual valor residual é evolução opcional. Vida útil deve ser maior que zero quando houver depreciação. O orçamento de manutenção da máquina e a despesa compartilhada são parcelas diferentes; migração deve retirar manutenção do rateio compartilhado se ela já entrar na máquina. Despesas compartilhadas são divididas pelas horas produtivas da mesma população de recursos que recebe o rateio.

```text
acabamento = unidadesBoasPlanejadas × minutosManuaisPorUnidade / 60 × valorHora
insumos = soma(unidadesBoasPlanejadas × quantidadePorUnidade × custoUnitario)
custoEstimadoProducao = soma(baseImpressao_b + contingencia_b)
                       + acabamento + insumos + adicionaisDeProducao
custoPedido = custoEstimadoProducaoAlocadoAoPedido + despesasExclusivasDoPedido
```

Quando toda a produção atende ao pedido, o custo alocado é igual ao custo de produção. Se houver excedente para estoque, ratear a execução pelas unidades boas previstas e alocar ao pedido apenas sua quantidade; a parcela excedente permanece identificada como estoque previsto. Uma cobrança mínima de lote é política comercial separada. O exemplo abaixo não tem excedente.

Embalagem individual é insumo por unidade; caixa coletiva é despesa por pedido. Modelagem exclusiva pode ser despesa por pedido; reutilizável pode ter rateio explicitamente configurado. Frete líquido pago pela operação é despesa do pedido. Se cobrado separadamente do cliente, sua receita, custo e incidência de taxas precisam aparecer separadamente; não contar o mesmo frete duas vezes.

### Política de falhas

Recomendação inicial: preservar a intenção de **reserva adicional** em novos orçamentos, mas dar esse nome e tornar sua base visível. Não transformar automaticamente os 5% existentes em probabilidade estatística de falha.

| Modo | Expressão | Premissa |
|---|---|---|
| Nenhum | `contingencia = 0` | Sem proteção comercial adicional |
| Reserva adicional | `contingencia = baseElegivel × r` | Acréscimo comercial sobre custos escolhidos |
| Rendimento esperado | `custoElegivelAjustado = baseElegivel / (1-f)` | Falhas repetem essa base de custo e f é fração esperada de tentativas perdidas |

O modo de rendimento esperado fica desabilitado até confirmar semântica e elegibilidade na homologação. Para ele, exigir `0 <= f < 1`. Embalagem posterior à aprovação de qualidade e frete não são custos que se repetem necessariamente em uma impressão falha. Setup pode ou não se repetir: a política deve indicar isso.

Purga prevista e suporte já contados no peso não são automaticamente “falha”. A reserva serve a perdas imprevistas. Na produção realizada, contabilizar material e tempo efetivamente consumidos, inclusive execuções malsucedidas; **não adicionar novamente reserva estimada ao custo real**. Quando não houver unidades boas, registrar perda e custo do trabalho sem divisão por zero.

### Quantidades e lotes incompletos

`ceil(quantidadePedida / capacidadeDaMesa)` fornece número de execuções, não o consumo exato. Uma última mesa parcial pode manter tempo, setup e purga quase constantes. O usuário deve confirmar seu peso/tempo ou escolher uma estimativa conservadora de mesa cheia, claramente identificada. Não multiplicar linearmente um custo unitário sem verificar essas premissas.

Excesso produzido permanece em estoque; não aumenta silenciosamente a quantidade faturada. Custo da execução é distribuído por todas as unidades boas produzidas, e a regra comercial de cobrar um lote mínimo aparece como despesa/preço mínimo explícito.

## Produto composto e montagem

Cada variação composta declara a quantidade necessária de cada componente. Montáveis = menor valor inteiro de `disponivelComponente / quantidadeNecessaria`, considerando reservas. Dez bases e seis tampas permitem montar seis unidades quando cada produto exige uma de cada. Esses seis ainda são **montáveis**, não estoque acabado, até registrar a montagem que consome componentes e dá entrada nos produtos.

Não inferir montagem por nome de objeto ou somar componentes como produtos. A primeira versão pode suportar uma variação de saída por execução e montagem explícita. Mesas mistas com saídas comerciais diferentes exigem rateio documentado cuja soma feche o custo; ficam fora do fluxo automático inicial.

## Formação de preço

Para um pedido, `C` é custo total coberto pelo preço, `F` é soma de taxas fixas com suas incidências, `t` é soma de percentuais sobre a mesma base bruta, `m` é margem alvo sobre essa base, `L` é lucro alvo e `k` é multiplicador sobre C.

```text
Margem sobre faturamento: P = (C + F) / (1 - t - m)
Lucro absoluto:           P = (C + F + L) / (1 - t)
Markup sobre custo:       P = (C × k + F) / (1 - t)
Preço manual:             P = preçoInformado
Lucro gerencial:          P - taxasCalculadas(P) - C
Margem gerencial:         lucroGerencial / P
```

Recusar denominador não positivo; mostrar meta inviável. Taxas percentuais só podem ser somadas quando compartilham a mesma base. Faixas, mínimos, tetos, taxas por item e bases diferentes devem ser funções explícitas do canal, ou permanecer como valor manual validado. Taxas, tributos e comissão de afiliados são parâmetros informados e versionados, sem presumir alíquota de uma plataforma ou regime fiscal.

Não chamar a margem gerencial desse pedido de lucro líquido contábil da empresa. Custos omitidos aparecem como pendências; resultado após taxas não equivale a dinheiro recebido.

Desconto altera a receita, não o custo da produção: `precoFinal = precoAntesDoDesconto - desconto`. Recalcular taxas e margem sobre o valor efetivamente cobrado e suas bases contratuais. Não aplicar desconto percentual novamente a um preço já líquido; preço final negativo é inválido e preço zero não tem margem percentual definida. Alterar desconto em proposta emitida exige nova versão.

## Precisão e arredondamento

Proposta: quantidades físicas normalizadas em miligramas inteiros, duração em segundos inteiros e contagens de unidades inteiras. A interface continua usando g, kg, horas e minutos. Valores monetários intermediários usam aritmética decimal com precisão explícita; snapshots serializam decimais como strings. Preços cobrados e recebimentos usam centavos inteiros.

A biblioteca decimal será escolhida na implementação e ficará encapsulada no motor. Não multiplicar indiscriminadamente os dados legados para converter unidades: confirmar o significado original antes da migração.

Arredondar na fronteira comercial. Calcular preço necessário, arredondar para centavo e conferir novamente margem com as taxas efetivamente arredondadas; subir centavos, dentro de uma busca limitada, se necessário para atingir a meta. Preço manual pode ficar abaixo da meta mediante aviso e permissão definidos, sem alterar a margem informada.

O total do pedido é autoritativo. Distribuir centavos residuais entre linhas/unidades de forma determinística quando necessário. O custo unitário analítico pode ter mais casas; não calcular o total multiplicando um custo já truncado para exibição.

## Exemplo proposto de homologação

Premissas sintéticas, próprias do LabLayer: 10 unidades boas previstas em uma mesa; 150 g totais a R$ 100/kg, sendo 120 g de peça, 20 g de suporte e 10 g de purga; 2 h; potência média 100 W; energia R$ 1/kWh; impressora R$ 2.000/10.000 h; manutenção R$ 0,10/h; rateio compartilhado R$ 0,50/h; preparação 15 min a R$ 20/h; acabamento 3 min por unidade a R$ 20/h; insumo R$ 0,50 por unidade; caixa do pedido R$ 2; frete da operação R$ 3.

| Parcela | Valor |
|---|---:|
| Material | R$ 15,00 |
| Energia | R$ 0,20 |
| Depreciação | R$ 0,40 |
| Manutenção | R$ 0,20 |
| Rateio operacional | R$ 1,00 |
| Preparação | R$ 5,00 |
| Base de impressão | R$ 21,80 |
| Reserva adicional de 5% sobre essa base | R$ 1,09 |
| Acabamento das 10 unidades | R$ 10,00 |
| Insumos das 10 unidades | R$ 5,00 |
| Caixa e frete do pedido | R$ 5,00 |
| Custo estimado total coberto pelo preço | **R$ 42,89** |

Com comissão de 10%, taxa fixa de R$ 2 por pedido e margem alvo de 20%, preço teórico = `44,89 / 0,70 = 64,128571…`. Preço proposto R$ 64,13; comissão arredondada R$ 6,41; taxas totais R$ 8,41; lucro gerencial R$ 12,83; margem aproximadamente 20,0062%.

Dividir 64,13 por 10 dá 6,413. Se for necessário distribuir valores inteiros em centavos, três unidades de R$ 6,42 e sete de R$ 6,41 fecham o total. Apresentar somente “10 × R$ 6,41” perderia R$ 0,03.

O exemplo foi conferido localmente com aritmética decimal independente. Ainda não representa saída do motor do LabLayer, que não foi alterado nesta etapa.

## Contrato de estoque recomendado

```text
fisicoFinal = fisicoInicial + entradas - saidas + ajustesAssinados
reservadoFinal = reservadoInicial + novasReservas - liberacoes - reservasConsumidas
disponivel = fisico - reservado
```

Compra recebida entra no saldo físico. Aprovação comercial cria compromisso, mas não prova consumo. Confirmar plano pode reservar materiais; concluir cada execução registra consumo real, libera sua reserva e dá entrada somente em unidades boas. Consumo acima da reserva deve validar disponibilidade adicional; não pode usar material reservado para outro pedido. Divergências devem ser resolvidas por ajuste explícito com motivo.

Expedição retira produtos acabados e libera sua reserva. Confirmar recebimento é operação financeira separada. Cancelar antes de execução libera reserva; após consumo exige tratamento explícito de produto em processo, saldo acabado, perda ou devolução. Excluir cadastro nunca devolve material fisicamente transformado.

Movimentos são imutáveis. Correção cria movimento compensatório ligado ao original. Um comando grava saldo, reserva, movimento, estado e auditoria atomicamente; repetir a mesma chave e payload retorna o resultado original. Mesma chave com payload diferente é conflito.

### Custo do material após a transição

Recomendação de escopo inicial: média móvel ponderada a partir do saldo de abertura validado. `novoCustoMedio = (valorSaldoAnterior + custoEntrada) / (quantidadeAnterior + quantidadeEntrada)`. Saída carrega o custo médio daquele momento, preservado no movimento. Exemplo: saldo 2 kg a 100 e entrada 1 kg a 130 → 3 kg a 110. Ajuste apenas de preço, devolução ou correção de compra exige evento de valor explícito; não reescreve movimento anterior.

O histórico atual usa média de todas as compras e não comprova custo móvel passado. Não reconstruir o passado como se essa política sempre tivesse existido. Saldo e valor de abertura precisam de origem e indicação de pendência quando não confirmados.

## Aceite mínimo do contrato

Usar o mesmo conjunto de casos no motor, API e telas. Incluir custo zero válido, preço ausente, porcentagem inviável, material indisponível, lote parcial, multicolorido, produto composto, produção sem unidades boas, taxa por pedido com várias unidades, desconto, devolução e repetição concorrente. Aprovar as regras de lote, falhas e abertura de estoque antes de ativar a nova versão para dados reais.
