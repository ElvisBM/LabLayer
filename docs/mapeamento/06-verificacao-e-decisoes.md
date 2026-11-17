# Verificação e decisões para homologar o LabLayer

O objetivo desta etapa foi obter uma descrição verificável do sistema. A análise encontrou divergências suficientes para impedir uma declaração de que todos os cálculos existentes estão corretos. Este documento delimita o que foi confirmado e o que falta para essa homologação.

## Evidências locais

| Verificação | Resultado | Alcance |
|---|---|---|
| `npm run lint` na aplicação | Passou | Executa TypeScript sem emissão; não valida comportamento de negócio |
| `npm test` original | Código de saída 1: nenhum arquivo de teste encontrado | Vitest configurado, sem suíte existente no checkout inicial |
| Caracterização dos cálculos | 24 de 24 cenários confirmados | Código puro real, entradas sintéticas; inclui defeitos reproduzidos |
| `npm run build` no site | Passou | TypeScript e Vite; aviso de base Browserslist desatualizada, sem envio de formulário |
| Referências da documentação | Links locais conferidos, sem arquivo ausente ou linha fora do arquivo | Verificação estrutural de caminhos; não é teste visual de todas as telas |
| Inspeção de regras e rotas | Concluída por leitura estática | Não confirma regras implantadas nem disponibilidade externa |

Arquivos de apoio: [script de caracterização](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/mapeamento/verificar-calculos.mjs), [resultados completos](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/mapeamento/resultados-calculos.json).

O [manifesto de fontes](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/mapeamento/fontes-auditadas.json) registra 42 arquivos da base local com SHA-256 e os commits da aplicação e do site. Permite verificar se os arquivos de referência mudaram depois da auditoria; não contém configurações secretas nem dados de clientes.

Para reproduzir a partir da pasta da aplicação:

```sh
node docs/mapeamento/verificar-calculos.mjs
```

Com `--salvar`, atualiza somente `docs/mapeamento/resultados-calculos.json`. O script usa TypeScript já instalado para extrair funções por AST e executá-las em um contexto isolado. Não importa o servidor, não monta componentes React, não acessa credenciais e não se conecta ao banco. Interrompe com erro se uma função-alvo desaparecer ou se o comportamento divergir das expectativas registradas.

Esses casos são de **caracterização da versão atual**. Após corrigir uma regra, a expectativa correspondente deve mudar para a política aprovada; não se deve conservar um defeito apenas para manter a caracterização passando.

## Cenários reproduzidos

| Caso | Evidência |
|---|---|
| C01 | Decomposição do custo completo: 5,628 por unidade |
| C02 | Mesmo cenário: simulador 2,478 e valores sugeridos 3,528 por omissão de parcelas |
| C03 | Desperdício adicional não dividido pelo rendimento |
| C04 | Falha zero normaliza para 5; horas zero para 160 |
| C05 | Material legado usa custo manual por grama |
| C06 | Frota tem precedência sobre custo horário manual |
| C07 | Impressora selecionada inativa continua no cálculo |
| C08 | Vida útil zero usa 10.000 h no motor |
| C09 | Material sem preço e sem fallback pode ter custo zero |
| C10 | Orçamento de manutenção da máquina não altera custo |
| C11 | Metas de lucro, margem, markup, manual e margem inviável |
| C12 | Sugestão do catálogo 12,38; API 12,39 por arredondamento |
| C13 | PATCH parcial de solicitação produz defaults e createdAt undefined |
| C14 | Alias de observação permanece junto com description |
| C15 | Ator de log vem do header ou api-token |
| C16 | Ficha com peso e zero peças consome um lote |
| C17 | 11 peças com rendimento 10 contam dois lotes |
| C18 | Desperdício excluído do preço continua no consumo |
| C19 | 10 bases e 6 tampas viram 16 na precedência de mesas |
| C20 | Conversão por mesas zera purga e pode perder 0,4 g por precisão |
| C21 | Diferença de datas atravessa meia-noite; fim anterior retorna zero |
| C22 | Tela de impressoras zera custo com vida útil zero, diferente do motor |
| C23 | Compras de 1 kg a 100 + 3 kg a 80 → média 85 |
| C24 | API sem variações tem sugestão escalar 22 e preço resolvido indisponível |

## Decisões de negócio pendentes

Estas perguntas estão registradas para a sessão de revisão; não impedem a entrega do mapeamento atual.

| Decisão | O que precisamos fixar | Por que muda o sistema |
|---|---|---|
| DB01 | Peso e tempo da ficha representam uma unidade, uma mesa, um lote padrão ou uma execução real? | Define divisor do custo e base de estoque |
| DB02 | O que é produto completo quando há base, tampa, cores alternativas e várias unidades de cada parte? | Define montagem, saldo de componentes e rendimento |
| DB03 | Quando há reserva e quando há consumo físico: aprovação, início ou conclusão? | Separa disponibilidade de saldo físico |
| DB04 | `fixedCost` é por peça, lote, pedido, setup ou pós-processamento? | Evita multiplicação ou rateio incorreto |
| DB05 | Purga e desperdício representam lote ou peça? Podem estar nos dois campos? | Evita perda omitida e dupla contagem |
| DB06 | Taxa de falha é contingência comercial ou estimativa de tentativas/reimpressão? | Define acréscimo simples ou custo por rendimento esperado |
| DB07 | Custo de material é média histórica, média móvel, lote consumido ou reposição? | Define custo atual e estabilidade de resultado passado |
| DB08 | Manutenção, energia e depreciação entram no custo gerencial, despesa do período ou reconciliação entre ambos? | Evita dupla contagem no financeiro |
| DB09 | Mão de obra, modelagem, embalagem, acabamento, tributos e frete são cobrados em que unidade? | Define composição de custo e preço; hoje não têm modelagem completa |
| DB10 | Taxa fixa de canal é por pedido ou por item? Afiliado e pagamento acumulam percentuais? | Define denominador e distribuição das taxas |
| DB11 | Qual política de margem mínima, desconto, arredondamento e validade da proposta? | Define autorização de preço e aceite |
| DB12 | Quem pode aprovar, alterar preço, consumir estoque e estornar? | Define papéis de usuário e de agente |
| DB13 | Aprovação exige sinal? Há versões, recusa, expiração, cancelamento e pagamento parcial? | Define máquina de estados da solicitação |
| DB14 | Financeiro precisa separar competência, previsto e realizado? Qual data define cada visão? | Define DRE, recebimentos e saldo |
| DB15 | Produtos podem ser excluídos após uso? Como corrigir produção, falha, devolução e inventário? | Define histórico e estorno, preservando rastreabilidade |
| DB16 | Qual oferta comercial vale: free/pro/enterprise ou trial e entrada a 9,90? | Alinha site, acesso, faturamento e indicadores SaaS |

Sugestão para a revisão: usar um pedido real representativo, uma produção multicolorida, um produto com componentes e uma compra com reposição. Registrar premissas e resultados esperados manualmente antes de alterar o código.

## Critérios propostos para futura homologação

1. O mesmo conjunto de entradas gera custo e preço iguais em catálogo, simulador, orçamento e API, dentro de uma política explícita de centavos.
2. Uma aprovação referencia exatamente a versão e o preço aceitos; repetir a operação não cria outra produção ou cobrança.
3. Saldo inicial + entradas − saídas + ajustes reconcilia com saldo final de materiais, insumos e produtos. Venda e estorno respeitam o evento definido.
4. Orçamento e ficha técnica não movimentam fisicamente estoque. Execuções registram materiais, unidades boas, perdas e tempo reais.
5. Venda preserva custo, taxas e preço do momento; alterações futuras dos cadastros não reescrevem margem passada.
6. Fluxo realizado considera recebimentos/pagamentos confirmados; projeção e DRE reconciliam com suas fontes sem duplicações.
7. API e interface aceitam o mesmo schema e os mesmos comandos. Campos de autorização não podem ser editados pelo próprio usuário.
8. Importação e agentes mostram prévia, origem e resultado por item; repetição do mesmo evento não duplica documentos.

Esses critérios são propostas para o trabalho seguinte, não funcionalidades existentes nem regras aprovadas nesta entrega.

## Limites e validações ainda necessárias

- Conferir a revisão efetivamente implantada, regras Firestore/Storage ativas e configuração do banco, sem assumir equivalência com o checkout.
- Conciliar dados reais com estoque físico e comprovantes de compras/vendas. Não é possível quantificar prejuízo ou corrigir saldos apenas pela inspeção do código.
- Exercitar o fluxo completo em ambiente de teste: novas solicitações, aprovações, produção, vendas, falhas, estornos e concorrência entre usuários.
- Testar regras no emulador e rotas com banco isolado, incluindo campos criados pela API e edição posterior na interface.
- Validar conectores e tratamento de retry, assinatura e mídia por provedor; nenhuma conexão externa foi exercitada aqui.
- Medir volume, latência e tamanho de documentos antes de definir metas de desempenho.

O mapeamento cobre as regras e cálculos identificáveis nos arquivos examinados. Regras praticadas fora do sistema e dados existentes em produção dependem dessa validação operacional complementar.
