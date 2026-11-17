# Catálogo de cálculos do LabLayer

As fórmulas descrevem o código vigente, inclusive suas limitações. Valores de exemplo são sintéticos. Nenhum preço, custo ou saldo real de cliente foi usado. A correção aritmética de uma fórmula não resolve, por si só, a definição de unidade, evento de consumo ou regime de custo.

## Unidades e valores padrão

| Campo | Unidade ou significado utilizado | Padrão e ressalva |
|---|---|---|
| `pricePerKg` | R$/kg | Cadastro ou média histórica de compras |
| `weightGrams`, `purgeGrams` | g por material da variação | Motor trata como peso por impressão, dividido pelo rendimento |
| `quantityKg`, `stockKg` | kg | Mesas convertem kg para g ao gerar variação |
| `printTimeHours` | h por impressão/lote | Dividido por `quantityPerPrint` no motor |
| `productionTimeHours` | h consideradas por unidade no orçamento | Rendimento forçado para 1 |
| `quantityPerPrint` | unidades por impressão | `max(1, Number(valor) || 1)`; aceita fração maior que 1 |
| `powerConsumption` | Multiplicador de energia por hora | Para a fórmula representar R$/h, deve ser potência média em kW, ou kWh consumidos em uma hora; o código comenta/rotula kWh |
| `energyPrice` | R$/kWh | 0,95 na maioria dos consumidores; zero frequentemente volta a 0,95 |
| `failureRate` | Percentual adicional sobre custo | 5%; normalizador troca zero por 5 |
| `maintenancePerMonth` | R$/mês | 150; zero é preservado |
| `monthlyUsageHours` | h/mês para rateio | 160; normalizador troca zero por 160 |
| `fixedCost` | R$/unidade na fórmula | Não dividido pelo rendimento |
| `quantityPerProduct` | Unidades do insumo por produto | Sem conversão entre unidades de medida |
| `soldPrice`, `fees`, `realCost` | R$ totais do pedido | Somados uma vez por pedido |
| Multiplicador sugerido | Relação preço/custo | 2,2 fixo em código; `settings/pricing.markup` não é consumido |

Fonte: [pricing:1](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/utils/pricing.ts:1), [orçamentos:227](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EncomendasOrcamentos.tsx:227).

## Custo por unidade

Fonte: [pricing:84](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/utils/pricing.ts:84). Nas fórmulas, `q` é rendimento, `h` é tempo, `E` é tarifa energética e `f` é taxa de falha em forma decimal.

| ID | Parcela | Fórmula vigente |
|---|---|---|
| CA01 | Material com lista de materiais | `M = Σ[(peso_g + purga_g) × preço_kg / 1000]` |
| CA02 | Material sem lista | `M = weightGrams × materialCostPerGram`; não consulta preço do filamento pelo `filamentId` |
| CA03 | Depreciação horária | `aquisição / max(1, Number(vidaÚtilHoras) || 10000)` |
| CA04 | Energia horária | `powerConsumption × E` |
| CA05 | Custo horário da máquina | `H = depreciação + energia` |
| CA06 | Rateio horário mensal | `O = maintenancePerMonth / monthlyUsageHours`, se horas > 0; senão 0 |
| CA07 | Tempo por unidade | `T = h × (H + O) / q` |
| CA08 | Material por unidade | `Mu = M / q` |
| CA09 | Insumos por unidade | `I = Σ(quantidadePorProduto × custoUnitárioAtual)` |
| CA10 | Desperdícios adicionais | `W = Σ(peso_g × preço_kg / 1000)` somente para `includeInCost=true` |
| CA11 | Parcela fixa combinada | `F = fixedCost + W` |
| CA12 | Subtotal unitário | `B = Mu + T + I + F` |
| CA13 | Adicional de falha | `A = B × max(0, failureRate) / 100` |
| CA14 | Total unitário | `C = B + A` |

Se um material da lista não encontra filamento, usa `materialCostPerGram` da variação como fallback; ausência desse valor equivale a zero. Insumo ou filamento de desperdício ausente contribui com zero. O motor não impede custos negativos ou não finitos em todas as entradas; converter com `Number(...) || 0` não constitui validação de domínio.

A impressora é resolvida nesta ordem: ID selecionado, mesmo inativo; média simples das impressoras cujo estado é diferente de `inativa`; se todas estiverem inativas, média de todas; sem frota, custo manual positivo; por fim, zero. Impressoras em manutenção entram na média. `maintenanceBudget` individual não participa da conta.

O percentual de falha é um acréscimo sobre **todo** o subtotal, inclusive insumos e fixos. Se a intenção for cobrir perda de rendimento de `f` tentativas, a relação matemática seria `B / (1-f)`, sob essa hipótese; essa não é a fórmula vigente nem uma política aprovada. Em `B=100` e `f=5%`, o código retorna 105; a hipótese de rendimento retornaria aproximadamente 105,2632.

### Exemplo completo reproduzido

Entradas: 100 g de material, 10 g de purga, filamento a R$ 100/kg, 2 h para 10 unidades, impressora de R$ 2.000 com vida de 10.000 h, potência 0,1 kW, energia R$ 1/kWh, manutenção R$ 160/mês em 160 h/mês, 2 insumos de R$ 0,50 por unidade, fixo R$ 1 e desperdício adicional de 20 g incluído no custo.

| Parcela | Resultado |
|---|---:|
| Material da impressão | R$ 11,00 |
| Material por unidade | R$ 1,10 |
| Máquina por hora | R$ 0,30 |
| Rateio mensal por hora | R$ 1,00 |
| Tempo por unidade | R$ 0,26 |
| Insumos por unidade | R$ 1,00 |
| Fixo + desperdício por unidade conforme código | R$ 3,00 |
| Subtotal | R$ 5,36 |
| Adicional de falha de 5% | R$ 0,268 |
| Total antes de arredondar | **R$ 5,628** |

O desperdício adicional de R$ 2 é aplicado inteiro a cada unidade. Se esses 20 g forem perda total do lote, a fórmula superestima a parcela. É necessário decidir se `wastes` representa lote ou unidade. Purga dentro de `materials`, por outro lado, é dividida pelo rendimento.

### Diferenças entre consumidores do motor

| Consumidor | Materiais e máquina | Insumos | `wastes` | Variação considerada |
|---|---|---|---|---|
| Catálogo de produtos | Sim | Sim | Sim | Pode reconstruir primeira variação a partir das mesas |
| Simulador de precificação | Sim | **Não repassa** | **Não repassa** | Variação persistida selecionada |
| Valores sugeridos | Sim | Sim | **Não repassa** | Primeira variação persistida para sugestão básica |
| API de leitura de produtos | Sim | Sim | Sim | Variações persistidas, sem reconstrução pelas mesas |
| Encomendas e orçamentos | Sim | Não modelado | Não modelado | Variação sintética, rendimento 1, fixo 0 |
| Vendas manuais | **Não usa o motor** | Não | Não | Campo `product.cost` |

No cenário acima, preservando a mesma variação, catálogo/motor completo retorna **5,628**; simulador **2,478**; valores sugeridos **3,528**. Esses resultados foram reproduzidos em C01/C02.

Fontes: [Produtos:1659](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1659), [Precificacao:110](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Precificacao.tsx:110), [ValoresSugeridos:177](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/ValoresSugeridos.tsx:177), [server:406](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:406).

## Preço e margem por canal

Fonte: [Precificacao:135](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Precificacao.tsx:135), [ValoresSugeridos:192](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/ValoresSugeridos.tsx:192).

Definições: `K = custo unitário + frete médio`, `t = comissão / 100`, `a = taxa fixa`, `L = lucro alvo em reais`, `m = margem alvo / 100`, `k = multiplicador de markup`, `P = preço final`.

| ID | Cálculo | Fórmula |
|---|---|---|
| PV01 | Lucro alvo | `P = (K + a + L) / (1-t)` |
| PV02 | Margem alvo | `P = (K + a) / (1-t-m)`; denominador não positivo retorna 0 |
| PV03 | Markup alvo | `P = (K × k + a) / (1-t)` |
| PV04 | Preço manual | `P = valor informado` |
| PV05 | Taxas | `P × t + a` |
| PV06 | Receita após taxas | `N = P - taxas` |
| PV07 | Lucro | `N - K` |
| PV08 | Margem real | `100 × lucro / P`, se P > 0; senão 0 |
| PV09 | Markup real mostrado | `N / K`, se K > 0; senão 0 |
| PV10 | Preço mínimo | `(K + a) / (1-t)` |
| PV11 | Sugestão direta | `C × 2,2` |

O markup 2,2 não é margem de 220%: sem taxas, seu lucro corresponde a aproximadamente 54,55% do preço. O simulador incorpora taxa fixa e frete médio por unidade de simulação; não distingue taxa por item e taxa por pedido de várias unidades. Afiliados, impostos, descontos, custo de pagamento e prazo de recebimento não têm parcelas próprias nessas fórmulas.

Preço “agressivo”: no modo lucro, usa metade do lucro alvo; no modo margem, metade da margem; no modo markup, usa `k-0,5` se `k>1`, caso contrário 1; no modo manual, usa margem de 10%. O preço principal é limitado a zero se negativo ou não finito. Mínimo e agressivo não recebem a mesma proteção, podendo resultar em infinito ou valores negativos quando o denominador é inválido.

Exemplo reproduzido com K=10, a=2 e t=10%: lucro alvo 5 → R$ 18,89; margem alvo 20% → R$ 17,14; markup 2,2 → R$ 26,67; manual 30 → R$ 30. Margem de 90% com taxa de 10% retorna zero por inviabilidade.

### Margem na inteligência do produto

Fonte: [Produtos:1677](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1677).

`taxa = preçoDoCanal × feePercentage/100`; `lucro = preço - custoUnitário - taxa`; `margem = 100 × lucro/preço`. Não inclui taxa fixa nem frete do cadastro de marketplaces. Alerta quando margem < 0 ou estritamente entre 0 e 20%; margem exatamente zero não aciona esses dois alertas. Média é aritmética entre combinações com preço positivo, sem ponderação por vendas.

## Orçamentos

Fonte: [EncomendasOrcamentos:227](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/EncomendasOrcamentos.tsx:227).

1. Calcula custo com pesos informados, tempo informado e rendimento 1.
2. Arredonda custo para duas casas: `Cu = round2(C)`.
3. `preçoUnitário = round2(Cu × 2,2)`.
4. `total = round2(preçoUnitário × max(1, quantidadePedida))`.

Sem material válido ou com tempo <= 0, as três saídas são zero. Não há abatimento por ganho de escala, número de mesas, compartilhamento de setup ou lote parcial. Se o usuário informar tempo e peso do lote inteiro, a multiplicação pela quantidade cobra esse lote repetidamente; a correção depende de definir e rotular explicitamente a base de entrada.

## Compras e consumo de filamentos

Fonte: [Filamentos:160](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Filamentos.tsx:160), [Produtos:822](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:822), [Dashboard:72](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Dashboard.tsx:72).

| ID | Cálculo | Fórmula |
|---|---|---|
| EF01 | Total comprado | `Q = Σ quantidadeKg` das compras positivas |
| EF02 | Valor comprado | `V = Σ quantidadeKg × preçoPorKgDaCompra` |
| EF03 | Preço médio | `V/Q`, se Q > 0; fallback ao preço cadastrado conforme função |
| EF04 | Lotes por material | `b = ceil(pieces / max(1, quantityPerPrint))` se pieces > 0; senão 1 |
| EF05 | Consumo de material | `(peso_g + purga_g) × b / 1000` |
| EF06 | Consumo legado | `weightGrams / 1000`, sempre um lote |
| EF07 | Consumo de desperdício | `weightGrams / 1000`, independentemente de `includeInCost` |
| EF08 | Saldo recalculado | `max(0, Q - Σ consumoDosProdutos)` |
| EF09 | Edição de produto | `delta = consumoNovo - consumoAntigo`; `saldoGravadoNovo = max(0, saldoGravadoAtual - delta)` |
| EF10 | Exclusão de produto | `saldoGravadoNovo = saldoGravadoAtual + consumoInferidoDoProduto` |
| EF11 | Valor consumido exibido | `consumoKg × preçoMédioAtual` |

Exemplo: compras 1 kg a 100 e 3 kg a 80 → 4 kg, R$ 340, média R$ 85/kg. Material de 100 g com rendimento 10 e 11 peças gera consumo de 200 g. Com zero peças, os mesmos 100 g ainda contam como um lote.

A base considera todos os produtos, independentemente de tipo e estado. Não desconta consumo pela exclusão de uma venda nem interpreta eventos de `inventoryMovements`. Truncar saldo negativo em zero elimina a diferença da falta; não comprova disponibilidade física.

## Estoque de produtos e insumos

Fonte: [Produtos:1439](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1439), [reconstrução:1563](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:1563).

**EP01 — ordem de precedência do estoque de produto:** usa mesas próprias; depois primeira ordem concluída encontrada por nome; depois mesas reconstruídas por `objectName` ou ID do material. Se houver mesas nesse processo, estoque é a soma de `productsCount`.

**EP02 — reconstrução:** materiais do mesmo nome de objeto usam máximo de peças e máximo de horas no grupo. Gramas viram kg com três casas decimais. Purga não é transferida para a mesa. Uma nova variação gerada dessas mesas define purga zero. Por isso 0,4 g pode virar 0 g, e purga antiga pode desaparecer ao editar/salvar.

**EP03 — caminho secundário de montagem:** sem mesas resolvidas, agrupa materiais por nome de objeto normalizado, soma peças de cada grupo e usa o menor grupo como conjuntos completos; excedente é grupo menos mínimo. Soma completos entre variações. Na prática, materiais já costumam gerar mesas antes desse trecho, alterando a semântica pretendida. C19 demonstra 10 bases + 6 tampas → 16 na prioridade de mesas, embora a interpretação de um kit de cada peça resultasse em 6.

**EP04 — fallback final:** sem mesas nem materiais com peças, usa `product.stock || 0`. Dashboard e Estoque Inteligente leem diretamente esse campo persistido, enquanto o catálogo pode recalcular.

**EP05 — conclusão da agenda:** `stockNovo = stockPersistido + Σ productsCount`. Mesas são combinadas por IDs; variação por ordem tem rendimento igual ao total produzido, ou 1 se não positivo. Não subtrai estoque por venda.

**EI01 — consumo de insumos:** `consumo = quantityPerProduct × estoqueCalculadoCompleto`. Edição e exclusão seguem diferença/devolução semelhante à de filamentos. Não há conversão entre kg, gramas, metros e unidades.

## Tempos de produção

Fonte: [Produtos:203](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:203), [Produtos:507](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:507), [Agenda:205](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/AgendaProducao.tsx:205).

| ID | Cálculo | Comportamento |
|---|---|---|
| TP01 | Diferença de datas completas | Minutos = arredondamento da diferença em milissegundos/60.000; fim <= início retorna 0 |
| TP02 | Horas derivadas | `round2(minutos/60)` |
| TP03 | Duração da mesa | Prefere diferença positiva início/fim; senão usa horas gravadas, convertidas em minutos arredondados |
| TP04 | Horários simples | Diferença HH:mm; negativa adiciona 24 h; horas com duas casas |
| TP05 | Variação por mesas | Soma duração de mesas uma vez por mesa; rendimento soma produtos |
| TP06 | Edição direta de materiais | Soma tempos por material; pode contar repetidamente uma impressão com vários materiais |
| TP07 | Agenda aberta | Soma horas das mesas de ordens não concluídas; não calcula capacidade por impressora |

O sistema mistura datas ISO UTC com campos locais `YYYY-MM-DDTHH:mm` e datas simples. Não há fuso da empresa modelado. Campos cronológicos não validam sequência completa entre envio, aprovação, pagamento e entrega.

## Vendas e indicadores financeiros

Fonte: [Vendas:96](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Vendas.tsx:96), [Financeiro:152](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Financeiro.tsx:152).

| ID | Indicador | Fórmula vigente |
|---|---|---|
| VF01 | Custo de venda manual | `(product.cost || 0) × quantity` |
| VF02 | Lucro gravado no pedido | `soldPrice - fees - realCost` |
| VF03 | Receita de vendas | `Σ soldPrice` |
| VF04 | Lucro total de vendas | `Σ realProfit` |
| VF05 | Ticket médio | Receita / número de pedidos; zero sem pedidos |
| FN01 | Receita bruta mensal | Soma `soldPrice` de pedidos que entram no filtro mensal |
| FN02 | Receita líquida | Receita bruta menos soma de `fees` |
| FN03 | Custos variáveis | Soma `realCost` + despesas Energia + Frete/Logística + Manutenção |
| FN04 | Margem de contribuição | Receita líquida menos custos variáveis |
| FN05 | Custos fixos | Despesas Aluguel/Infraestrutura + Software/Assinaturas + Pró-labore/Salário + Outros |
| FN06 | Lucro líquido mostrado | Margem de contribuição menos custos fixos |
| FN07 | Margem de lucro | 100 × lucro líquido / receita bruta, ou zero |
| FN08 | Compras de insumos | Soma `costPerUnit × quantityAtual` dos cadastros selecionados pelo mês |
| FN09 | Compras de filamentos | Soma kg × preço da compra do mês; fallback legado sem histórico |
| FN10 | Investimentos | Soma `acquisitionCost` das impressoras selecionadas pelo mês |
| FN11 | Resultado caixa na DRE | Lucro líquido − investimentos − compras de materiais |
| FN12 | Entradas no fluxo | Soma de transações manuais de entrada, pagas e pendentes |
| FN13 | Saídas no fluxo | Soma de transações manuais de saída, pagas e pendentes + compras de materiais + investimentos |
| FN14 | Saldo atual mostrado | Entradas − saídas do mês selecionado; não inclui saldo inicial |

São definições do software, não homologação contábil. “Resultado caixa” da DRE e “Saldo Atual” do fluxo têm bases diferentes. Uma venda de R$ 100 sem transação manual pode aumentar receita da DRE em R$ 100 e entrada do fluxo em R$ 0. Uma saída pendente de R$ 20 já reduz o saldo em R$ 20. Consumir 40 de 100 insumos a R$ 1 reduz a compra inferida de R$ 100 para R$ 60, embora a compra passada não tenha mudado.

Se o custo de venda passar a usar o motor completo, energia e rateio de manutenção poderão já estar embutidos; somá-los novamente em despesas exige uma política de reconciliação. Registrar manualmente compras já inferidas dos cadastros também pode duplicar saídas.

### Outros totais existentes

Fonte: [Dashboard:159](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Dashboard.tsx:159), [ControlePerdas:49](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/ControlePerdas.tsx:49), [SuperAdmin:72](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/SuperAdmin.tsx:72).

- Painel: receita e lucro de todos os pedidos; produtos = soma de `stock` dos ativos; insumos = quantidade de documentos, não de unidades.
- Top 5 produtos: agrupamento por nome, soma de quantidades e lucro, ordenação por lucro.
- Lucro médio por unidade no ranking de produtos: lucro agregado dividido pela quantidade vendida, ou zero se não positiva.
- Top 5 canais: agrupamento por nome, soma de receita menos taxas, ordenação por essa receita líquida de taxas. Não equivale a lucro.
- Margem no ranking de canais: 100 × lucro agregado / receita bruta agregada, ou zero se receita não positiva.
- Controle de perdas: soma de peso e custo já armazenados, dentro do filtro de tipo, sem filtro mensal.
- Purga ao criar produto: `purgaGramas × lotes × preçoKg/1000`; mantém o preço daquele momento no log.
- Valores sugeridos: totais da lista filtrada somam um custo e um preço por produto, sem multiplicar por estoque.
- MRR do administrador: soma dos planos de empresas `active`, com free=0, pro=97, enterprise=297. É estimativa por tabela fixa, sem confirmação de cobrança.

## Arredondamento e persistência

O motor não arredonda o total. O catálogo aplica 2,2 ao custo completo e só então usa duas casas. A API e orçamentos arredondam custo antes da multiplicação. No cenário C01: catálogo sugere **R$ 12,38**, API **R$ 12,39**. Não existe política central de centavos, distribuição de arredondamento por quantidade ou precisão para material.

O simulador salva preço sem arredondamento explícito; Valores Sugeridos arredonda preço, lucro, custo e margem em pontos diferentes. Recalcular histórico usa cadastros atuais e mantém entradas antigas, sem um snapshot completo das premissas originais. Resultados podem mudar quando se atualizam compras, energia, frota ou configurações.
