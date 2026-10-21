# Piloto E5 — evidência isolada e roteiro de homologação

Data de referência: 20/10/2026. Este documento distingue o cenário automatizado executado em `demo-lablayer-test` de um piloto real ainda **não executado**. Nenhum número abaixo representa cliente, venda ou pagamento real.

## Cenário automatizado de referência

Teste: `tests/integration/finance.test.ts`, caso **jornada completa fecha quantidade, material, custo, preço, taxas, recebimento e caixa**. O teste prepara cadastros, executa congelamento/abertura/ativação E3 e percorre rascunho, prévia, emissão e aprovação E4 por API. Não injeta saldos finais para fazer a conciliação passar.

| Fato | Valor esperado |
|---|---|
| Pedido | 5 unidades, preço aprovado R$ 51,00 |
| Estimativa | Custo R$ 32,20; taxas R$ 8,60; versão aceita preservada |
| Execução | 10 unidades tentadas, 9 boas, 1 rejeitada, 7.000 segundos |
| Consumo | 450 mg de filamento, 18 insumos; conversão confirmada R$ 4,00 |
| Custo da execução | R$ 17,50, absorvido nas 9 unidades boas |
| Expedição | 5 unidades, custo `17,50 × 5 / 9 = 9,722222222222` |
| Estoque final de acabado | 4 unidades, valor `7,777777777778`; custo expedido + saldo = R$ 17,50 |
| Estoque final de filamento | 9.550 mg |
| Recebimento | Bruto R$ 51,00, taxa real R$ 2,00, líquido R$ 49,00 |
| Adicional confirmado do pedido | R$ 2,00, separado do estoque e das taxas |
| Custo realizado confirmado | `11,722222222222` |
| Diferença de custo | Realizado − estimado = `−20,477777777778` |
| Resultado gerencial do pedido | `51 − 2 − 11,722222222222 = 37,277777777778` |
| Pagamento independente de energia | R$ 10,00 no caixa; não descontado novamente do resultado do pedido |
| Movimento líquido de caixa | R$ 39,00; não é saldo bancário |
| Conciliação | Sem divergências; atendimento expedido 5, reservado 0; sem pendências do pedido |

Os valores de filamento e insumo são fixtures para provar fórmulas/conservação, não referências de preço de mercado. Custo operacional mantém 12 casas; valores de caixa usam centavos inteiros. Arredondar o custo unitário antes de multiplicar a retirada produziria outra quantia e é deliberadamente evitado.

Outro caso executa falha total, registra perda R$ 17,50, reimprime e expede. O custo final inclui a perda uma vez e passa a `29,222222222222`. Casos separados cobrem falta de material, concorrência, recebimento parcial, taxa não devolvida, cancelamento antes de consumo, estorno de compra vinculado ao financeiro e retorno de conexão sem duplicidade.

## Roteiro para empresa real — pendente

A [preparação B17](./homologacao-b17.md) agora permite build separado e conferência offline de identidades. Ela foi testada somente com fixtures; todos os passos reais abaixo continuam pendentes.

| Passo | Evidência necessária | Estado |
|---|---|---|
| Selecionar empresa, responsável e pedido representativo | Identificação do piloto e do operador | Pendente |
| Backup e restauração ensaiada em cópia isolada | Referência verificável, contagens e restauração conferidas | Pendente |
| Classificar legado e conferir abertura | Unidades, quantidades, valores, pendências antigas e fila de produção | Pendente |
| Homologar servidor, cliente, rules e autenticação reais em ambiente separado | Acessos corretos; operador sem permissão não registra financeiro | Pendente |
| Conferir pedido e ficha técnica | Pesos incluem suporte/purga uma vez; tarifas/origens e lote explícitos | Pendente |
| Executar produção e registrar medições reais | Consumo, boas/rejeitadas, tempo e conversão documentados | Pendente |
| Separar e expedir | Quantidade, saldo e custo de saída conciliados | Pendente |
| Conferir recebimento e pagamentos com documentos reais | Bruto, taxas, líquido, parcela, fuso e data efetiva | Pendente |
| Conferir adicional sem dupla contagem | Energia/manutenção/material já absorvidos identificados; origem das parcelas adicionais | Pendente |
| Fechar pedido e revisar divergências | Preço, taxas, estimado/realizado, perdas, estoque e caixa explicados | Pendente |
| Aceite de expansão | Responsável registra conclusão e ausência de divergência inexplicada | Pendente |

Não declarar piloto aprovado apenas porque o relatório técnico está consistente. A conciliação confirma coerência entre registros; não autentica um extrato nem verifica fisicamente o estoque. Se houver divergência, preservar eventos/recibos e investigar a origem; não restaurar banco antigo depois de fatos novos para tentar “zerar” diferenças.

Para ampliar a ativação, anexar o resultado real a este roteiro, identificar as diferenças justificadas e os critérios ainda abertos. Nenhuma automação de implantação ou ativação de empresa foi adicionada pela E5.
