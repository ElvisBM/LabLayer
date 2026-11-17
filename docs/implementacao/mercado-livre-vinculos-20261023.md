# Conferência de anúncios e vínculos Mercado Livre

Em 23/10/2026, a conta **CHGACDFBE12458** possui **44 anúncios retornados pela API**: **8 ativos, 35 pausados e 1 encerrado**. No LabLayer existem **133 produtos legados** e **zero registros de vínculo em channelListings**. Não foram encontrados campos de vínculo ML nos registros de produtos inspecionados. A conexão OAuth está funcionando, mas não estabelece associação entre os catálogos.

## Identificadores e correspondências

- Nenhum dos 44 anúncios possui SELLER_SKU ou seller_custom_field preenchido nos campos consultados. Foram conferidas também as três variações do anúncio Nossa Senhora e os 41 User Products associados; nenhum SKU preenchido foi encontrado nesses recursos.
- No LabLayer, **131 de 133 produtos não têm SKU base**. Os dois códigos preenchidos são distintos. As 132 variações locais não têm sufixo de SKU preenchido. A ausência de sufixo não é, isoladamente, um erro para produto sem variantes comercialmente distintas.
- Há **126 produtos em desenvolvimento, 6 ativos e 1 inativo** no cadastro local. Esse estado não foi alterado nem usado para filtrar a conferência.
- Correspondências por nome são apenas candidatas: exigem conferir modelo, cor, material, medidas e composição dos kits antes de vincular.

| Anúncio no Mercado Livre | Candidato no LabLayer |
| --- | --- |
| Medusa, Agua Viva Articulado Sensorial (MLB4706928521) | Medusa Articulada |
| Vaso Concha Decorativo (MLB6833962060) | Vaso Concha |
| Nossa Senhora Aparecida Fé, Amor E Delicadeza (MLB4706909983) | Nossa Senhora Aparecida |
| Abajur Castelo Encantado 3d  Luminária Decorativa Led (MLB4706909855) | Castelo |

## Agrupamentos que afetam o estoque

Foram encontrados **4 User Products referenciados por mais de um anúncio**. Há dois anúncios ativos do castelo/luminária compartilhando o mesmo User Product (além de um encerrado). Nossa Senhora também tem referências compartilhadas entre um anúncio com variações e anúncios individuais por cor. Isso não comprova duplicação indevida de anúncios; indica que a integração precisa preservar o agrupamento remoto para não contar estoque físico em dobro.

A estrutura do Mercado Livre permite múltiplas condições de venda relacionadas ao mesmo User Product e coexistência de anúncios antigos com variações. A integração deve mapear item, variação quando houver e User Product. [Documentação de User Products e preço por variação](https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/preco-variacao).

## Próximo passo recomendado

1. Criar uma área de conferência dos anúncios existentes, começando pelos 8 ativos. Exibir candidatos sem confirmá-los automaticamente pelo título.
2. Identificar o produto/variante local de cada anúncio e definir SKU estável, incluindo composição e quantidade dos kits. Resolver divergências de status e especificações na revisão.
3. Gravar os vínculos confirmados sem duplicar produtos ou reativar os 35 anúncios pausados.
4. Antes de ativar estoque, conferir saldos físicos, compartilhamento de User Products e a migração do livro de estoque prevista no plano. Contagens de registros não são saldos vendáveis.

Nenhum produto, anúncio, vínculo, preço ou estoque foi modificado nessa conferência. O escopo cobre a conta conectada e a empresa atual; não comprova ausência de integrações externas em outros sistemas.

## Evidências e método reproduzível

Consulta de anúncios paginada sem filtro de status, com 44 IDs únicos para total 44 informado pela API. Todos os 44 detalhes e os 41 User Products responderam 200; identificação do vendedor conferida. Firestore consultado diretamente no banco nomeado usado por produção, na empresa vinculada ao usuário. Capturas em 2026-10-23T17:23:48.020Z e 2026-10-23T17:25:02.408Z (UTC).

- [Snapshot minimizado](evidencias/mercadolivre-vinculos-20261023/snapshot.json): apenas campos necessários à conferência, sem chaves ou tokens.
- [Notebook de conferência](evidencias/mercadolivre-vinculos-20261023/auditoria.ipynb): cálculos executados sobre o snapshot.
- [Busca oficial de itens](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas): consulta por vendedor e SKUs.
