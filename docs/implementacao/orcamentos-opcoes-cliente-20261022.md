# Opções de preço e mensagem para cliente — 22/10/2026

Publicado em https://app.lablayer.com.br/. Escopo: cadastrar os três preços informados, mostrar as opções no aplicativo e no assistente, permitir copiar o texto para enviar ao cliente. Os demais exemplos da mensagem são referências de formato, não novos pedidos.

## Regras implementadas

- `customerQuote`: nome do produto, tamanho opcional e de 1 a 5 opções de quantidade exata, preço unitário e prazo opcional em dias. Não representa desconto automático para qualquer quantidade intermediária.
- Quantidades inteiras, positivas e únicas; preço não negativo com até duas casas decimais. Prazo inteiro de 1 a 3650 dias ou `null`. Validação no formulário, no formatador/API e nas regras Firestore; regras mantêm o escopo de acesso anterior.
- Total de cada opção: centavos do preço unitário × quantidade, evitando resíduos de ponto flutuante. Formato brasileiro de moeda.
- `quotedPrice` permanece o total para a quantidade pedida. Ao salvar opções, é obrigatório existir uma opção correspondente à quantidade do pedido; o preço total deriva dessa opção. Não somar alternativas comerciais.
- Peso informado em `productionWeightGrams`, independente da alocação de filamento. Horas em `productionTimeHours`. Não se inventa material, custo monetário, margem ou preço calculado a partir desses dados incompletos.
- O texto para copiar contém apenas nome, tamanho, quantidades, preços, totais e prazos. Custos, horas, peso, contatos e notas internas não entram na mensagem.
- Visualização e cópia na lista, nos cartões de 2/3 colunas, na edição e na lista/detalhe do bot. Falha de clipboard orienta cópia manual. Copiar não envia mensagem, não altera status e não preenche data de envio.
- API do bot projeta explicitamente os campos comerciais apenas em links com atendimento compartilhado. Links individuais mantêm o acesso anterior. Revogação, tenant e demais permissões continuam aplicáveis.
- Pedidos legados sem `customerQuote` continuam com o valor simples existente, sem criar opções ou prazos inferidos.

## Cadastro realizado

| Pedido | Tamanho | Opções registradas | Prazo | Total atual |
| --- | --- | --- | --- | --- |
| ORC-001 Zalma | 5 cm | 1 × R$ 22,00; 10 × R$ 14,50 = R$ 145,00 | 2 dias | R$ 145,00 / 10 un |
| ORC-005 ProFaby | 15 cm + base de 4 cm | 1 × R$ 189,99 | 4 dias | R$ 189,99 / 1 un |
| ORC-011 Daniella, chaveiro de casa | 6 cm | 1 × R$ 24,99; 10 × R$ 16,60 = R$ 166,00 | 1 dia para 1; 2 dias para 10 | R$ 24,99 / 1 un |

Produção informada respectivamente: 10 g/1 h, 140 g/14 h, 14 g/2 h. ProFaby substitui o briefing anterior de 12 cm; os 4 cm da base são conservados literalmente, sem concluir que são altura. Prazo não foi convertido para dias úteis ou data de calendário, pois isso não foi informado.

Os três documentos existentes passaram de `aguardando-orcamento` para `orcado`, em uma transação com verificação de que não foram modificados entre leitura e escrita. Descrição atualizada sem manter as antigas afirmações de valor/prazo desconhecido. As referências das imagens, datas de envio/aprovação/pagamento, demais campos e os outros 24 documentos foram preservados. Não houve encomenda, venda, baixa de estoque ou comunicação com cliente.

## Qualidade e publicação

- 48 testes unitários/UI passaram em cada checkout: formatação, totais em centavos, opções inválidas, sucesso/falha de cópia, listagem, salvamento e ordenação existente.
- 26 testes de integração passaram em cada checkout: isolamento do tenant/link, projeção comercial, formato das opções e atualização de status em lote. As regras finais foram novamente testadas no release depois de reforçar duplicidade/centavos (6 testes).
- TypeScript passou em ambos. Build de produção do release passou; alerta preexistente de bundle maior que 500 kB.
- Apenas suítes afetadas executadas; não foi executada a suíte completa do LabLayer.
- Publicação inclui a ordenação pendente de 21/10 (finalizados por último). Frontend e servidor reiniciados; `/api/health` respondeu `ok` e o hash do HTML público corresponde ao build local.
- Conferência no navegador: filtro Orçado exibiu os três pedidos com preços, tamanho, totais e prazos; cópia exibiu confirmação; a lista administrativa também exibiu os blocos comerciais. Evidência local: `../evidencias-publicacao/orcamentos-precos-bot-20261022.png` a partir da pasta pai do repositório.
- As alterações foram aplicadas por patches nos dois checkouts, preservando as diferenças das fórmulas e regras da estabilização E0–E5. Não copiar o arquivo inteiro do release sobre a branch estabilizada.

## Operação e recuperação

Release operacional: `/home/lablayer/releases/customer-quotes-20261022/` no servidor. Scripts de publicação e importação guardados nessa pasta. Backup anterior do aplicativo: `/home/lablayer/deploy-backups/customer-quotes-20261022-before.tar.gz`. Backup privado dos 27 pedidos antes da atualização: `/home/lablayer/deploy-backups/customer-quotes-20261022-data.json` (permissão 0600). Não colocar backup com dados de clientes em repositório público.

Ruleset publicado: `1c9ae895-29f6-4f2c-8ab3-f06ac6d6cb3e`; anterior: `1d24d141-7bd5-4fb7-834f-9d6c9b45ba94`. Para reverter código, restaurar arquivos e HTML do backup e reiniciar `lablayer-app`. Não reverter as regras enquanto houver documentos com os novos campos, pois isso bloquearia edições desses pedidos. Reversão de dados deve restaurar apenas os três alvos após conferir alterações posteriores, nunca sobrescrever os 27 documentos indiscriminadamente.

Hash SHA-256 do HTML publicado: `68e843358e5edec59e1d6c2add0905d3132be439ba77cc4a543068bdffd4f269`.
