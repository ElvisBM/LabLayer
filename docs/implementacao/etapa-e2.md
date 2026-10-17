# E2 — catálogo e fichas versionadas

Implementação local iniciada em 5–6 de outubro de 2026, com conferência de fechamento em 17 de outubro. Base: E1 (`2e6bde6`). A etapa entrega o caminho de **preparação** de produtos/receitas, com interface, comandos autenticados, versões e diagnóstico do legado. A ativação operacional permanece conjunta com E3, como definido no plano: não desligar a baixa antiga enquanto não existirem abertura reconciliada e comandos de produção.

## Como conferir

Na lista de **Produtos**, abrir **Catálogo e fichas**. A faixa informa que o estoque e a precificação operacional ainda usam os registros anteriores.

1. Criar um cadastro com nome, SKU, descrição e variações. Cada variação recebe ID estável. Alterações criam revisão de cadastro; variações existentes podem ser arquivadas, não removidas/trocadas de ID.
2. Preparar receita de impressão: saída única, unidades boas por execução, duração em segundos, impressora, material por execução, preparação, acabamento e insumos por unidade. Escolher peso total já incluindo suporte/purga ou parcelas que devem reconciliar exatamente.
3. Salvar uma nova versão e conferir o histórico. Reabrir 0,4 g com 0,1 g de purga preserva 400 mg e 100 mg; não há truncamento para zero nem duplicação da purga.
4. Para montagem, selecionar produtos/variações e quantidade necessária por unidade acabada. O vínculo fixa a versão da receita de cada componente. A versão inicial admite componentes impressos; não admite montagem aninhada nem autorreferência.
5. Para registros antigos, abrir **Revisar**, conferir pendências, registrar motivo e confirmar classificação. Pesos e tempos mostrados no diagnóstico são candidatos, não uma conversão aprovada. Nenhuma receita, pedido ou movimentação é criada automaticamente.
6. Para orçamento/encomenda antigo, classificar como referência e escolher uma solicitação já existente. O vínculo não copia dados para um novo pedido nem transfere saldo.
7. Arquivar pelo formulário do cadastro/variação. Histórico e vínculos permanecem; arquivamento não devolve material.

## Arquitetura e transição

`shared/catalog/model.ts` reúne contratos e validações independentes de React/Firebase. `server/catalog.ts` executa os comandos e `src/features/catalog/` apresenta os formulários. O acesso aparece na tela de Produtos, sem substituir o editor operacional legado neste pacote.

O catálogo preparado fica em `tenants/{tenant}/catalogItems/{productId}`. Essa separação é deliberada: alterar o documento `products` legado ainda altera leituras de consumo inferidas pela ficha/nome. Usar o mesmo documento antes da E3 misturaria modelos incompatíveis. Na revisão do legado, o ID do produto é preservado; novos produtos recebem ID próprio. Não são criadas cópias na coleção operacional `products`.

| Estrutura | Conteúdo / autoridade |
|---|---|
| `catalogItems/{id}` | Dados comerciais, classificação, variações, revisão atual, ponteiros de receitas e origem revisada |
| `catalogItems/{id}/versions/{revision}` | Revisão integral e imutável do cadastro |
| `catalogItems/{id}/recipes/{recipeVersion}` | Receita imutável, produto/variação por ID, revisão do cadastro, versão anterior, ator e data |
| `catalogCommands/{requestId}` | Resultado e impressão digital do comando para repetição segura; sem acesso direto pelo cliente |
| `auditLogs` | Evento gravado na mesma transação do cadastro/receita |

Clientes autenticados da empresa podem ler o catálogo e versões. Escritas, exclusões e alterações de histórico são negadas pelas rules; somente comandos autenticados do servidor escrevem. Empresa inativa, identidade inválida e acesso entre empresas são recusados. A API administrativa genérica não ganha acesso de escrita a essas coleções.

Comandos:

- `GET /api/tenants/:tenantId/catalog/:itemId/legacy-review`: devolve dados comerciais candidatos, diagnóstico e timestamp exato da origem, incluindo nanossegundos.
- `POST /api/tenants/:tenantId/catalog/:itemId`: recebe requestId, expectedRevision, data e legacySource (nulo para novo cadastro/edição). Origem antiga exige ID correspondente, timestamp atual e motivo.
- `POST /api/tenants/:tenantId/catalog/:itemId/recipes`: recebe requestId, expectedRevision, variationId, expectedRecipeVersion e recipe.

O ator vem do ID token; tenantId da URL é conferido contra vínculo/propriedade. Campos desconhecidos, inclusive estoque/preço/ator enviados no cadastro, são rejeitados. Receita valida referências existentes na empresa, impressora disponível e unidade de insumo igual ao cadastro. Não exige saldo disponível para preparar uma ficha: disponibilidade física pertence à E3.

Mesma chave e mesmo comando/ator retornam o resultado anterior. Chave reutilizada com outro conteúdo, revisão de cadastro obsoleta ou receita revisada por outro operador causam 409. O cliente conserva a chave após falha de conexão. Transações gravam documento, versão, recibo e auditoria juntos. Uma falha na auditoria não deixa cadastro parcialmente salvo.

## Regras de negócio e medidas

- Quantidades de saída/componentes são inteiras; massa é normalizada em miligramas e duração em segundos. Conversões que exigiriam arredondamento são recusadas. Campos decimais aceitam vírgula ou ponto, sem separador de milhar; não adivinham se `1.234` significava milhar.
- Na entrada em gramas, `0,4` é 400 mg. Na entrada em kg, `0,0004` também é 400 mg. Campos de peso reabertos usam a conversão exata; não há `toFixed(3)` sobre kg.
- Peso em parcelas exige `peça + suporte + purga = total`. Modo total não aceita parcelas adicionais. Material, insumo e componente têm identificações explícitas; não se usa nome para associar saídas.
- `montáveis = min(floor((físico − reservado) / quantidadeNecessária))`. Dez bases e seis tampas permitem seis montagens; duas tampas reservadas reduzem para quatro. Saldo ausente produz pendência, não zero conhecido. Calcular montáveis não gera estoque acabado.
- Renomear cadastro não modifica IDs ou referências das receitas. Revisar um componente não reescreve a versão fixada numa montagem. Arquivamento preserva documentos; novos vínculos exigem itens ativos.
- Diagnóstico legado preserva peso, purga e suporte separadamente quando conhecidos, indica ausência e recusa conversões inexatas. Não agrupa por nome, não deduz rendimento, não reconstrói consumo, não abre saldo e não copia orçamento para venda. Diagnóstico limita a 50 variações/materiais e avisa sobre excedentes.
- Arquivos novos são referências HTTPS sem credenciais na URL, até dez por receita. Não incorporar bytes/data URLs. Links não garantem imutabilidade do conteúdo externo; upload/migração de arquivos antigos e gestão avançada do armazenamento continuam fora deste pacote. Arquivos legados incorporados são sinalizados e preservados.

## Cobertura da etapa e condições da E3

| Item do plano | Entregue na preparação E2 | Ativação operacional |
|---|---|---|
| E2.1 — cadastro/receita/execução separados | Cadastro e receita novos não escrevem nenhuma coleção operacional | E3 desliga os escritores legados e entrega comandos de execução |
| E2.2 — componentes por ID | BOM versionada e cálculo de montáveis com reservas | E3 liga saldos físicos e registra montagem, substituindo inferências antigas |
| E2.3 — versões | Revisões imutáveis e referências de versão em receitas/componentes | E3/E4 usam essas referências na produção e proposta |
| E2.4 — unidades | Conversões exatas, peso total/parcelas e reabertura sem perda | Migração de cada receita requer conferência das ambiguidades |
| E2.5 — tipologia | Produto ou referência a solicitação com origem/motivo auditados | Corte operacional elimina tipos sobrepostos após revisão |
| E2.6 — preservação e identidade | IDs de produto/variação, arquivamento e versões fixadas | Exigência de IDs em novas execuções/vendas será aplicada nos comandos E3/E4; histórico antigo não recebe vínculos inferidos por nome |

**O editor legado, a agenda e relatórios antigos não foram migrados nesta etapa.** Ainda contêm inferências documentadas na auditoria. Preparar uma ficha não certifica estoque, não recalcula preços operacionais e não homologa o legado. Para ativar: reconciliar origem/IDs, conferir saldos de abertura, disponibilizar movimentos/reservas/produção, mudar as leituras para o modelo novo e bloquear os escritores antigos no mesmo corte por empresa. Não liberar o novo consumo isoladamente.

## Qualidade e rastreabilidade

A suíte inclui validações puras de unidades, reconciliação de massa, rendimento, classificação e BOM; testes de interface de cadastro, receitas, pendências e repetição de requisição; integração com Express e Firestore local para concorrência, idempotência, isolamento de tenant, regras de histórico e aborto após falha de auditoria. Compara dez coleções operacionais antes/depois de cadastrar, revisar, renomear e arquivar: produtos, filamentos, insumos, impressoras, perdas, produção, vendas, solicitações, movimentos e transações permanecem iguais.

Foram adicionados os tipos oficiais de React/React DOM à checagem TypeScript. Isso revelou um campo `createdAt` lido mas ausente da interface `Product`, corrigido sem alterar o comportamento.

Na conferência de 17/10, os 158 testes e o build passaram, mas a auditoria bloqueou o gate por `proxy-addr@2.0.7`. O lockfile foi atualizado pontualmente para `2.0.8`, versão corrigida indicada no [aviso do mantenedor](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), sem atualização de versão principal do Express ou Firebase. A validação completa passou novamente com esse lockfile.

Houve timeouts de contenção no emulador, inclusive em teste pré-existente de provisionamento. A documentação do Firebase informa diferenças nas transações e demora na liberação de locks: [limitações do emulador](https://firebase.google.com/docs/emulator-suite/connect_firestore#transactions). Os oito testes que provocam concorrência no mesmo documento usam orçamento explícito de 240 s para acomodar locks e tentativas do SDK; testes comuns e hooks mantêm 30 s. Nenhuma asserção foi removida, concorrência não foi serializada por um mock e o código de produção não recebe um bloqueio artificial. Testes locais não substituem a homologação de contenção no Firestore real.

Uma rodada anterior também apresentou timeout no ensaio de backup, sem causa confirmada. Em 17/10, a suíte completa de integração passou em 48,45 s, incluindo esse ensaio, sem alterar seu limite de 30 s. A execução local usou `caffeinate -i` para impedir suspensão por inatividade durante o processo; isso não comprova que suspensão tenha causado a falha anterior.

A implantação continua exigindo cliente, servidor e rules compatíveis e os pré-requisitos de backup/homologação da E0. Não houve push, deploy, abertura de estoque ou acesso a dados reais. O diretório preexistente `scripts/` não faz parte da entrega.

### Resultado do gate final — 17/10/2026

Comando: `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" caffeinate -i npx --yes --package=node@22 -c 'npm run quality'`, concluído com código 0.

| Verificação | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | Aprovado |
| Unitários e interface | 89 testes, 10 arquivos aprovados |
| Integração real com emulador demo | 69 testes, 6 arquivos aprovados; 48,83 s |
| Total acumulado | 158 testes aprovados; 35 adicionais sobre a E1 |
| Build de produção | Aprovado; permanece aviso de bundle acima de 500 kB |
| Auditoria de dependências de produção | 0 altos/críticos; 1 baixo e 8 moderados remanescentes |
| Conferência do diff | Sem erros de whitespace; alterações limitadas à preparação E2, testes, tipos React e correção pontual de dependência |

O resultado fecha o pacote local de preparação E2. Não equivale à migração operacional E2/E3, à homologação no Firebase real ou a uma auditoria sem alertas. A árvore completa de desenvolvimento ainda apresenta 7 alertas altos; o critério de bloqueio de dependências permanece restrito à árvore de produção, conforme E0.
