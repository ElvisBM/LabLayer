# Correção: lote para Finalizado recusado em pedidos antigos

A regra `isValidCustomRequest` rejeitava o campo histórico `observation`, presente em 13 dos 27 pedidos reais. Mesmo um update de apenas `status`/`updatedAt` valida o documento resultante completo. Assim, um pedido antigo em um lote causava `PERMISSION_DENIED` e impedia a gravação de todos.

A causa foi reproduzida antes da correção no emulador e no banco publicado, com identidade Firebase de teste e tenant isolados: lote misto (normal + observation) recusado com HTTP 403. Os testes anteriores só usavam documentos sem o campo legado e não capturaram essa incompatibilidade.

Correção de duas linhas nas regras: permitir `observation` opcional, obrigatoriamente string de até 5.000 caracteres. Todos os valores encontrados nos pedidos existentes são strings de até 815 caracteres. Nenhuma observação foi removida, nenhuma função de autorização foi modificada, nenhum status real foi alterado. Outros campos desconhecidos e observações inválidas continuam sendo recusados.

Validação: 10 testes direcionados de lote/permissões aprovados. Novo teste finaliza lote misto preservando observação, quantidade e preço; outro recusa tipo inválido, tamanho excessivo e campo desconhecido, preservando atomicidade. Sem build de frontend, pois nenhum código da aplicação mudou.

Publicação limitada ao banco nomeado `ai-studio-914d19ee-caef-46d9-9cf8-561cc915d716`. Ruleset anterior: `projects/lablayer-493220/rulesets/7fe01835-1934-4c8e-bc17-8fd97a5a6e31`. A fonte anterior foi conferida como idêntica à release local antes da alteração; compilação pela API de regras antes de ativar. A versão principal mantém suas próprias regras de autorização e recebe apenas a compatibilidade do campo.

## Resultado publicado

Código `4fd45fb`. Ruleset ativo: `projects/lablayer-493220/rulesets/1d24d141-7bd5-4fb7-834f-9d6c9b45ba94`. Fonte anterior copiada na VPS em `/home/lablayer/deploy-backups/firestore-before-legacy-status-20261021.rules`; rollback possível apontando a release do banco nomeado ao ruleset anterior.

Verificação com Firebase ID token de usuário QA, REST `documents:commit` e exatamente os dois campos do lote da interface: **antes HTTP 403, depois HTTP 200**, ambos documentados nos JSONs `evidencias/status-legado-antes-20261021.json` e `evidencias/status-legado-depois-20261021.json`. Dois pedidos sintéticos finalizaram, mantendo observação, preço e quantidade. O hash dos 27 pedidos reais permaneceu idêntico. Tenant e identidade QA removidos após a conferência. Usuário pode repetir sua seleção; nenhuma finalização real foi feita pelo agente.
