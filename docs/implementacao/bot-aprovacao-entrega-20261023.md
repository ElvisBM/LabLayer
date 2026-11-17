# Aprovação com quantidade e entrega pelo bot — 23/10/2026

A mensagem `ORC-002 Aprovado, 1 quantidade, entregar dia 08/11/2026.` não correspondia à gramática operacional, que exigia liberação como “pode produzir”. O parser agora reconhece esse formato explícito de aprovação, quantidade e entrega, antes da interpretação por IA. Aceita quantidade/unidade/peça, valida datas reais no calendário e mantém a recusa de perguntas, negações, condicionais e múltiplos códigos.

O fluxo transacional existente registra `fila-producao`, `approvedAt` e `requestedDeliveryDate` (data civil ISO), preservando o texto integral na linha do tempo. Aprovação não declara pagamento. Alteração de quantidade continua exigindo opção comercial cadastrada. Autorização, isolamento, auditoria e recibos idempotentes permanecem no mesmo caminho.

## Publicação e correção

Publicado somente `shared/assistant/workflow.ts`, após confirmar a paridade da versão anterior no servidor, com reinício de `lablayer-app`. Interface e demais módulos de produção preservados.

Backup do módulo e dos 27 pedidos: `/home/lablayer/deploy-backups/approval-20261023/`, protegido no servidor. Script de conferência e evidência: `/home/lablayer/releases/approval-20261023/`.

A mensagem original informada pelo usuário foi reaplicada pela API publicada do bot com o acesso existente e um identificador de operação novo. Reenvio idêntico retornou o mesmo recibo. Conferência direta no banco confirmou:

- ORC-002: `fila-producao`, quantidade 1, R$ 28,90, entrega `2026-11-08`.
- Uma única nota operacional com a mensagem original; pagamento preservado.
- Descrição, imagens, opções comerciais e demais campos preservados.
- Outros 26 pedidos integralmente iguais ao backup anterior.

## Validação e limites

TypeScript, build e 27 testes unitários selecionados passaram. Incluído teste de integração para aprovação, entrega e retry. A execução do emulador Firestore foi tentada, mas não iniciou por ausência de Java; esse teste de integração não está verificado. A gravação e a idempotência da mensagem real foram verificadas na API publicada e diretamente no banco, sem chamada de IA.

A data solicitada é registrada no pedido e na linha do tempo; este ajuste não implementa agendamento automático de impressoras. Reversão do comportamento: restaurar o módulo salvo e reiniciar o processo. Não restaurar o backup completo dos pedidos sobre alterações posteriores; correções de dados exigem evento compensatório.


Validação posterior: a execução do emulador foi concluída durante a evolução de [aprovação por IA](bot-aprovacao-ia-20261023.md), usando o Java já instalado através do PATH. O teste de integração da mensagem original também passou nessa rodada.
