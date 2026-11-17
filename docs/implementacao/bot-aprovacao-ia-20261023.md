# Aprovação em linguagem natural pelo bot — 23/10/2026

## Comportamento

O vendedor pode informar a aprovação com suas próprias palavras. A IA existente interpreta a intenção `approve`, identifica a referência do orçamento e extrai quantidade, entrega, pagamento explicitamente informado e distribuição de nomes quando presentes. Não é necessário memorizar uma frase de comando. O servidor resolve um único pedido autorizado, exige palavras inteiras na referência por nome, confere situação e opção de preço e grava pedido, histórico, auditoria e recibo na mesma transação.

Exemplos de intenção: “cliente fechou o ORC 2”, “a Maria aprovou dez unidades”, “pode seguir com esse orçamento” quando um pedido estiver selecionado. Referência explícita prevalece sobre o contexto selecionado. Se houver mais de um resultado, o vendedor deve selecionar o pedido correto e confirmar sem repetir a referência ambígua.

Aprovação sem quantidade ou data mantém os dados atuais. Quantidade provisória exige confirmação. Mudança de lote requer preço já cadastrado; o total é calculado pelo servidor a partir da opção existente, inclusive quando a quantidade já coincide e o total estava desatualizado. Aprovação não implica recebimento de pagamento. Entrega é registrada como data civil `requestedDeliveryDate`, sem agendamento automático de impressoras. Outras informações ficam preservadas na mensagem da linha do tempo.

Perguntas, negações, condicionais e dúvidas de quantidade/data seguem para consulta ou esclarecimento. A IA usa o sentido da mensagem, não uma lista fechada de frases. A interpretação inclui um trecho literal da autorização digitada; servidor recusa evidência ausente do texto, código inventado ou múltiplos códigos. Imagens e áudios continuam como anexos/complementos, mas não autorizam sozinhos a aprovação automática. Datas relativas usam a data de atendimento em America/Sao_Paulo.

## Implementação e consistência

`server/assistant-ai.ts`: esquema estrito estendido com `approval`, validação de campos, data real, limites e consistência da distribuição de quantidades. O prompt permite interpretação operacional limitada à aprovação e mantém a proibição de preços arbitrários, ferramentas e movimentos de estoque. Usada a integração n8n/OpenAI já existente e autorizada pelo usuário, sem nova chave nem alteração de credenciais/workflow.

`server/assistant.ts`: a intenção validada reutiliza a transação operacional existente. Confere habilitação por empresa, validade do link, isolamento de pedidos, fase de estoque legado, estado do pedido e anexos. Um recibo existente é consultado antes da IA; retry idêntico não consome outra interpretação nem duplica nota/efeito, mesmo após o pedido avançar de estado. Mesmo identificador com mensagem diferente é recusado. A resposta, incluindo transcrição, é preservada no recibo.

`shared/assistant/workflow.ts`: validação de data, quantidade e preço; quantidade provisória confirmada deixa de ser provisória. O atalho para comandos explícitos anteriores continua disponível, mas linhas adicionais não reconhecidas passam à IA para não descartar prazo ou instruções.

Documentação oficial consultada: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Validação

- TypeScript e build passaram.
- 51 testes unitários selecionados passaram.
- 53 testes de integração do assistente passaram no emulador Firestore. Utilizado o Java já instalado em `/opt/homebrew/opt/openjdk@21/bin` através do PATH, sem instalar dependências.
- Testes cobrem aprovação natural, quantidade/preço/data, contexto selecionado, referência explícita, autorização, concorrência de estado, fase de estoque, evidência, divergência de código, preço ausente, dúvidas e idempotência.

## Publicação

Publicados apenas `server/assistant.ts`, `server/assistant-ai.ts` e `shared/assistant/workflow.ts`, após comparar os hashes da base de produção e criar backup. Frontend publicado e outros módulos preservados. Reinício de `lablayer-app` concluído; `/api/health` respondeu `ok`.

Release e evidências privadas: `/home/lablayer/releases/ai-approval-20261023/`. Backup de código e pedidos: `/home/lablayer/deploy-backups/ai-approval-20261023/`.

A validação ponta a ponta usa pedido sintético temporário na empresa habilitada e acesso temporário revogado no encerramento. O script confere a igualdade integral dos pedidos reais antes/depois e remove o pedido sintético e suas notas. Auditoria e recibos do acesso revogado são preservados.

Validação ponta a ponta concluída com **14 cenários reais aprovados**, em `verification.json` e `verification-names.json`: fechamento natural, aprovação sem pagamento, pagamento explícito, contexto selecionado, referência por cliente, personalização, condição de pagamento, negativa, pergunta, quantidade sem opção, data inválida, múltiplos orçamentos e nome exato/semelhante. O reenvio da primeira aprovação também confirmou o mesmo recibo sem nova chamada de IA.

As duas rodadas confirmaram igualdade integral dos 27 pedidos reais, remoção dos pedidos sintéticos e revogação dos acessos temporários. Conferência adicional da referência exige palavras inteiras tanto no pedido encontrado quanto no texto original do vendedor, evitando aceitar um prefixo como se fosse outro nome.

Reversão de código: restaurar os três módulos do backup e reiniciar o processo. Não restaurar pedidos indiscriminadamente; atualizações reais posteriores exigem conferência e evento compensatório.
