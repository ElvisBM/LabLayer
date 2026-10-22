# Atualização de produção pelo bot e linha do tempo

## Problema e comportamento entregue

O bot classificava atualizações como complementos, sem alterar status. A tela interna só montava o histórico quando o ID começava com `bot-`, ocultando complementos de solicitações importadas/manuais. A pesquisa textual também não tratava `ORC 11` como equivalente exato de `ORC-011`.

Agora um comando explícito como `ORC 11 Pago pode Produzir` atualiza um único pedido autorizado para `fila-producao` e acrescenta uma entrada imutável ao histórico. O texto original, autor do atendimento, data, mudanças antes/depois e anexos são preservados. A linha do tempo é visível no bot e nos detalhes internos de qualquer orçamento, independentemente do formato do ID. Complementos antigos continuam visíveis; a descrição original não é sobrescrita.

O cliente fornece `operationId` em `/api/assistant/draft`. Comando reconhecido é executado deterministicamente antes de chamar a IA; a resposta inclui `updatedRequestId` apenas após o commit. O nome histórico dessa rota não significa que toda chamada permaneça somente leitura: a nova operação explícita, identificada e habilitada por empresa, pode escrever. Clientes antigos sem `operationId` continuam no fluxo de interpretação sem escrita automática.

## Regras de negócio

- `ORC 11`, `ORC-011` e `ORC11` identificam o mesmo código; `ORC-110` é distinto. Código duplicado, não encontrado ou busca acima de 1.000 candidatos impede a operação. Um pedido selecionado permite comando sem código.
- A gramática aceita liberação explícita para produção, opcionalmente precedida de “pago”, “pagamento confirmado” ou “aprovado”. Perguntas, negações, condicionais e múltiplos códigos não são executados automaticamente. Outras mensagens permanecem no fluxo de consulta/complemento com conferência.
- Não se usa texto extraído de imagem, transcrição ou resposta da IA para autorizar mudança de status. Este caminho usa somente o texto enviado no campo da conversa.
- Apenas `orcado` ou `fila-producao` podem receber o comando. Não reabre finalizado nem regride um pedido em produção.
- Autorização informa `approvedAt` se ausente; declaração explícita de pagamento informa `paidAt` se ausente. Datas existentes são preservadas. A linha do tempo esclarece que pagamento foi informado pelo atendimento, sem conciliação bancária, transação financeira ou alteração de estoque.
- Linhas `5 com nome: Pessoa` preservam a grafia e a quantidade. A soma atualiza a quantidade solicitada somente quando existe opção comercial para aquele lote. O total usa a opção já cadastrada e aritmética de centavos. Sem preço correspondente, recusa toda a operação para evitar quantidade/preço incoerentes. Nome iniciado com número é tratado como ambíguo e segue para conferência.
- Histórico e anexos continuam sujeitos ao limite existente de 100 entradas por pedido e seis anexos por envio.

## Isolamento e consistência

Ativação por empresa: `assistantWorkflowUpdates: true`. Link precisa estar ativo, não expirado e vinculado a empresa ativa. A consulta e a escrita obedecem ao compartilhamento já configurado: link restrito só alcança seus próprios pedidos. `inventoryControl/state` ausente/`legacy` é obrigatório; fases `frozen`/`active` exigem o novo módulo E3/E4, impedindo escrita concorrente pelo legado.

Uma transação grava pedido, nota em `assistantRequests/{requestId}/notes`, auditoria e recibo em `assistantLinks/{key}/messageUpdates/{operationId}`. Falha de auditoria aborta o conjunto. Retry idêntico retorna o recibo sem repetir pagamento ou nota, mesmo se o pedido já avançou depois. Mesmo ID com conteúdo diferente retorna 409. Revogação é conferida antes de devolver o recibo.

O formulário mantém payload e identificador em uma falha de rede para reenviar o mesmo comando. Erros definitivos de validação/autorização liberam a edição. Após sucesso, recarrega o pedido e a lista; filtros padrão continuam mostrando apenas aguardando orçamento/orçado, então um pedido encaminhado sai desse filtro e aparece em Fila de produção.

## ORC-011

O usuário confirmou 10 peças: 5 com **Viviane Rodriguero** e 5 com **Daniella Maglio Löw**. O segundo número 5 antes de Daniella era repetição. A solicitação existente estava `orcado`, com quantidade 1 e sem notas; possui opção de 10 unidades a R$ 16,60, total R$ 166,00. Correção auditada aplicada com esses dados confirmados, preservando descrição, imagens, opções comerciais e referências técnicas.

## Validação

- Release: TypeScript e build passaram; 43 testes unitários selecionados do bot e tela de orçamentos passaram.
- Emulador Firestore: 40 testes dos módulos de assistente, IA e novo fluxo passaram, incluindo isolamento, revogação, idempotência, preço sem opção, estado finalizado, migração e falha atômica.
- Nenhuma chamada paga de IA foi necessária para esses testes. Sem mudanças no workflow n8n ou na credencial do provedor.
- Publicação deve incluir `server/assistant.ts`, `shared/assistant/workflow.ts` e build `dist`, preservando o módulo de credenciais Mercado Livre publicado anteriormente.
- Ativar somente a empresa solicitante e registrar a correção do ORC-011 com backup anterior e conferência de que os demais pedidos não mudaram.

## Reversão

Desabilitar `assistantWorkflowUpdates` interrompe novos comandos operacionais. Restaurar os arquivos do release anterior e reiniciar o processo se necessário; não excluir notas, recibos ou auditoria. Uma correção de dados após uso real exige comparar a versão atual e registrar evento compensatório, nunca restaurar cegamente o backup sobre atualizações posteriores.


## Publicação e conferência em produção — 22/10/2026

- Código publicado no commit `94d2196`, com bundle `index-CqgR_XtS.js` e CSS `index-BB8sIUMx.css`. Processo reiniciado com sucesso; `server.ts` e o módulo de credenciais Mercado Livre foram preservados.
- HTTPS: página e bundle retornaram 200; assistente e credenciais Mercado Livre sem autenticação retornaram 401, conforme esperado.
- Ativação restrita à empresa solicitante. Correção do ORC-011 executada pela mesma rota transacional do bot, com identificação de manutenção “Correção autorizada por Elvis no chat”; o link temporário foi revogado ao final.
- Conferência às 22:15:42 UTC: status `fila-producao`, quantidade 10, total R$ 166,00, pagamento informado, uma entrada de atualização com 5 Viviane Rodriguero e 5 Daniella Maglio Löw. Reenvio idêntico não duplicou a entrada. Descrição e opções comerciais preservadas; os outros 26 pedidos não foram alterados.
- Backup protegido: `/home/lablayer/deploy-backups/bot-timeline-94d2196/orc011-before.json`. Evidência posterior no mesmo diretório: `orc011-after-evidence.json`. Esses arquivos permanecem no servidor, fora do repositório.
- Paridade no repositório principal: TypeScript e 34 testes unitários selecionados passaram. A tela principal recebeu apenas a alteração necessária para mostrar o histórico em todos os IDs, preservando as evoluções locais existentes.
