# E1 — cálculos verificáveis

## B04 — motor puro

`shared/pricing/engine.ts` implementa o contrato proposto, versão `lablayer-cost-v1` e formação comercial `lablayer-price-v1`. Decimal.js 10.6.0 fica encapsulada, com contexto isolado de 40 algarismos significativos e arredondamento HALF_UP. Intermediários são strings decimais; pesos são miligramas inteiros, durações segundos e preços finais centavos seguros. O motor não acessa Firebase e não modifica registros históricos.

Custos discriminam material total (com reconciliação opcional entre peça/suporte/purga), energia em W/kWh, depreciação, manutenção, despesas compartilhadas, setup, acabamento, insumos e adicionais por unidade, execução ou pedido. A reserva tem base explícita e não entra em custo realizado. Execuções malsucedidas entram no custo efetivo; zero unidades boas gera perda identificada, sem custo unitário fictício. O excedente fica separado do custo alocado ao pedido. A última mesa deve vir explícita ou declarada conservadora; o motor não inventa peso/tempo de mesa parcial.

Preço suporta margem, lucro absoluto, markup e manual; taxas percentuais apenas sobre a mesma base bruta, fixas por unidade/pedido. Cada taxa arredonda separadamente; a meta é conferida após arredondamento e pode exigir centavos adicionais. Desconto preserva custo e recalcula resultado; margem com receita zero é nula. Rateio de centavos é determinístico e conserva o total. Limites de listas, números e iterações evitam execução ilimitada. Taxas por faixas/bases diferentes, rendimento esperado e múltiplos SKUs na mesma execução continuam fora do contrato inicial.

## Evidências

`tests/fixtures/pricing.ts` transcreve o exemplo independente do contrato. `tests/unit/pricing-engine.test.ts` confere todas as parcelas de R$ 42,89, preço R$ 64,13, comissão R$ 6,41 e lucro R$ 12,83. Inclui 0,4 g, preço desconhecido versus zero, purga sem duplicação, excedente, múltiplas execuções, falha real, incidências, metadados, entradas inválidas, descontos, denominador inviável e uma varredura de 45 combinações de custo/taxa/margem com identidades contábeis.

B04 introduz a biblioteca e seus testes. A integração nas telas e API é B05; não interpretar a existência do motor como migração automática de fichas legadas. Sem acesso ou alteração de dados reais.

Gate B04: 102 testes aprovados (55 unitários/componentes + 47 integração), TypeScript, build e auditoria de produção aprovados. Permanecem 1 alerta baixo e 8 moderados na árvore de produção e o aviso de bundle grande, conforme E0.
