# E1 — cálculos verificáveis

## B04 — motor puro

`shared/pricing/engine.ts` implementa o contrato proposto, versão `lablayer-cost-v1` e formação comercial `lablayer-price-v1`. Decimal.js 10.6.0 fica encapsulada, com contexto isolado de 40 algarismos significativos e arredondamento HALF_UP. Intermediários são strings decimais; pesos são miligramas inteiros, durações segundos e preços finais centavos seguros. O motor não acessa Firebase e não modifica registros históricos.

Custos discriminam material total (com reconciliação opcional entre peça/suporte/purga), energia em W/kWh, depreciação, manutenção, despesas compartilhadas, setup, acabamento, insumos e adicionais por unidade, execução ou pedido. A reserva tem base explícita e não entra em custo realizado. Execuções malsucedidas entram no custo efetivo; zero unidades boas gera perda identificada, sem custo unitário fictício. O excedente fica separado do custo alocado ao pedido. A última mesa deve vir explícita ou declarada conservadora; o motor não inventa peso/tempo de mesa parcial.

Preço suporta margem, lucro absoluto, markup e manual; taxas percentuais apenas sobre a mesma base bruta, fixas por unidade/pedido. Cada taxa arredonda separadamente; a meta é conferida após arredondamento e pode exigir centavos adicionais. Desconto preserva custo e recalcula resultado; margem com receita zero é nula. Rateio de centavos é determinístico e conserva o total. Limites de listas, números e iterações evitam execução ilimitada. Taxas por faixas/bases diferentes, rendimento esperado e múltiplos SKUs na mesma execução continuam fora do contrato inicial.

## Evidências

`tests/fixtures/pricing.ts` transcreve o exemplo independente do contrato. `tests/unit/pricing-engine.test.ts` confere todas as parcelas de R$ 42,89, preço R$ 64,13, comissão R$ 6,41 e lucro R$ 12,83. Inclui 0,4 g, preço desconhecido versus zero, purga sem duplicação, excedente, múltiplas execuções, falha real, incidências, metadados, entradas inválidas, descontos, denominador inviável e uma varredura de 45 combinações de custo/taxa/margem com identidades contábeis.

B04 introduz a biblioteca e seus testes. A integração nas telas e API é B05; não interpretar a existência do motor como migração automática de fichas legadas. Sem acesso ou alteração de dados reais.

Gate B04: 102 testes aprovados (55 unitários/componentes + 47 integração), TypeScript, build e auditoria de produção aprovados. Permanecem 1 alerta baixo e 8 moderados na árvore de produção e o aviso de bundle grande, conforme E0.

## B05 — consumidores e preservação de evidências

O catálogo, Valores Sugeridos, simulador e API passam a chamar a mesma função de compatibilidade decimal (`legacy-compatible-v2`), com material/tempo, insumos e perdas marcadas. O simulador deixou de omitir insumos/perdas; Valores Sugeridos deixou de omitir perdas. Custo simples com filamento vinculado usa seu preço cadastrado. Reserva e energia iguais a zero são preservadas; rateio mensal positivo sem horas, rendimento inválido, referências/preços ausentes e impressora indisponível são pendências. Não há média automática da frota. Sem máquina é necessário custo manual explícito, inclusive quando for zero.

As sugestões comerciais utilizam `lablayer-price-v1`. Não arredondam custo antes de aplicar markup nem o unitário antes de obter o total. A meta deve sobreviver ao arredondamento: no exemplo legado C=5,628, markup 2,2 requer R$ 12,39 (R$ 12,38 não atinge o multiplicador); para dez unidades, o total autoritativo é R$ 123,82. O simulador trata meta inviável como erro, exibe margem indefinida em receita zero e oferece seleção explícita de comissão de afiliados sobre a base bruta. Canal inativo não gera nova sugestão.

O custo de catálogo usa as variações salvas. Mesas recuperadas por nome na agenda não substituem silenciosamente a receita para precificação. O formulário de orçamento legado indica pesos/tempo **por unidade**, chama sua estimativa de preliminar e explicita parcelas omitidas. Mantém o preço informado ao reabrir, incluindo zero; não altera automaticamente uma proposta antiga. A versão canônica de orçamento por execuções/lotes ainda depende da E2/E4.

Vendas novas exigem custo total confirmado pelo operador (`costSource=manual-confirmed`); não usam `product.cost || 0`. Valores em centavos, quantidade inteira e resultado informado são validados. A criação no Firestore exige essa origem e identidade preço − taxas − custo. Histórico de vendas anterior não foi reavaliado: a tela informa que custos antigos zerados precisam de conferência. Isto não substitui custo realizado por movimentos de estoque nem conciliação financeira, que continuam E3/E5.

### Gravação de preço no servidor

`POST /api/tenants/:tenantId/products/:productId/pricing-snapshots` exige Firebase ID token, vínculo com empresa ativa, produto não arquivado, variação e canal válidos. Recebe somente requestId, variationId, channelId, targetType, targetValue e includeAffiliate. Não aceita preço, custo ou ator do cliente. O servidor lê as referências usadas pela receita (até 100 por classe, sem carregar toda a frota/catálogo), recalcula e grava snapshot, ponteiro atual e auditoria na mesma transação. Credenciais administrativas genéricas não substituem o ID token nessa rota.

O snapshot preserva entradas utilizadas, decomposição decimal, cálculo comercial, versões e ator. Repetição da chave com mesmo comando/ator devolve o original mesmo que o custo cadastrado tenha mudado; chave reutilizada com outro conteúdo gera 409. A interface mantém a chave após erro para permitir repetição segura. Novas simulações com intenção de novo preço usam nova chave. O histórico anterior permanece intacto. Regras negam criação/alteração/exclusão de snapshots e alteração do ponteiro por clientes; Venda Direta continua salvando preço manual na variação, sem se apresentar como cálculo validado.

A API administrativa conserva o envelope `apiComputedPricing`: inclui versão, `pricingComplete` e pendências; custos/sugestões incompletos retornam `null`, não zero. Essa diferença de contrato precisa ser observada por consumidores da API. Custos unitários analíticos deixam de ser truncados a duas casas.

### Limite explícito da transição

**Não houve migração de ficha, estoque ou histórico para o novo modelo canônico.** A compatibilidade ainda mantém fixos/perdas por unidade, reserva sobre o subtotal e manutenção mensal compartilhada; não adivinha incidência nem soma novamente manutenção individual. Esses pressupostos são exibidos no simulador. O motor `lablayer-cost-v1` está coberto por testes, mas sua ativação em fichas confirmadas depende da modelagem e migração coordenadas E2/E3. Não afirmar que todos os cálculos de estoque/financeiro estão corrigidos por este pacote.

### Conferência e implantação

Testes de tela verificam custo R$ 5,63, sugestão R$ 12,39, pendência de material/insumo, meta impossível e custo manual obrigatório. Integração exercita o Express real com Firestore local, cálculo API/consumidor, snapshots concorrentes, histórico de 50 entradas preservado, alteração posterior de custo, falsificação, isolamento de tenant e regras.

Servidor, cliente e rules devem ser liberados juntos: clientes antigos não podem mais criar snapshot nem vendas com custo presumido. Usar os pré-requisitos de homologação/backup da E0. Não houve push/deploy nem acesso a dados de produção. Para rollback da interface, conservar as regras de imutabilidade; não reabrir gravação arbitrária de snapshots.

Gate B05: **123 testes aprovados** (69 unitários/componentes + 54 integração), TypeScript, build e auditoria de produção aprovados com Node 22/Java 21. Bundle 1.086,28 kB (gzip 262,83 kB); permanece o aviso de tamanho. Auditoria de produção mantém 1 alerta baixo e 8 moderados, sem altos/críticos. Diretório não rastreado `scripts/` preservado.
