# Assistente com IA — entrega e evidências (21/10/2026)

> Atualização posterior: o usuário adicionou saldo; a IA foi validada e ativada com Luna e atendimento compartilhado. Consulte [a entrega atual](assistente-compartilhado-20261021.md). O relato abaixo preserva o diagnóstico da primeira tentativa.

## Mudança

O assistente passa a oferecer interpretação de texto e fotos e transcrição de um áudio por pedido, utilizando a credencial OpenAI já cadastrada no n8n. O vendedor confere a proposta e confirma o cadastro. Cadastro, anexos, idempotência, isolamento de empresa, preços, estoque e aprovação continuam sob as regras do LabLayer.

Contrato, limites, arquitetura e operação: [referência n8n](../n8n/assistente-ia-contrato.md).

## Qualidade

Versão compatível com produção: TypeScript, **29 testes unitários/UI + 53 de integração (82)**, build e auditoria de produção aprovados (zero vulnerabilidades). Uma tentativa concorrente das suítes sofreu timeout na preparação do ambiente; a execução isolada acima passou integralmente. Aviso existente de bundle acima de 500 kB permanece.

Base E0–E5: TypeScript, **197 testes unitários/UI e 191 testes de integração (388 distintos)**, build e auditoria de produção aprovados, considerando a repetição isolada do backup. Auditoria: zero vulnerabilidades. Unitários/UI executados com `--maxWorkers=1 --testTimeout=30000 --hookTimeout=30000` devido à pressão de recursos do computador, que provocou timeouts de 5 segundos em telas anteriores à mudança. A execução completa de integração passou em 190 testes e excedeu 30 segundos no teste E0.1 de backup; os dois testes desse arquivo passaram na repetição isolada com `--testTimeout=120000 --hookTimeout=60000` (18,44 segundos de testes). Nenhuma asserção, regra ou configuração versionada de timeout foi removida ou relaxada. A execução padrão única de `quality` não passou integralmente nesta máquina; os resultados aprovados acima correspondem às execuções explicitadas.

Validação real: bloqueada por créditos, conforme seção abaixo. Não considerar esta revisão como aprovação da ativação para vendedores.

## Resultado do teste real e bloqueio externo

O teste sintético percorreu webhook, troca da autorização, preparação de dados e chegou à OpenAI. A API retornou HTTP 429 com **“You have no credits remaining. Add credits to continue using the API”**. Isso é saldo esgotado, não erro de autenticação nem limite transitório de requisições. Credencial validada não comprova disponibilidade de créditos.

O LabLayer retornou `mode: guided` com aviso explícito, sem cadastrar pedido. Ticket inválido retornou 403. Os **27 pedidos reais** conservaram o mesmo hash de conteúdo. A empresa e o link sintéticos foram removidos ao encerrar; nenhum orçamento de QA foi criado.

Não foi possível concluir os testes reais de interpretação, imagem e áudio por falta de saldo. Não apresentar esses recursos como homologados ou ativos. O workflow foi **despublicado** (pausa reversível), as configurações de IA foram removidas do ambiente de produção e o serviço foi reiniciado com ambiente limpo. Saúde 200 e assistente existente em modo `guided` confirmados após o reinício.

Uma execução sintética de diagnóstico (ID 3) foi preservada no n8n para conferência do erro; contém dados fictícios e ticket já expirado/consumido, não contém chave OpenAI. O salvamento de falhas foi ativado somente para esse diagnóstico e depois restaurado para **Do not save**, mantendo os demais tipos de salvamento desativados.

Próximo passo externo: adicionar saldo em [Billing da OpenAI](https://platform.openai.com/settings/organization/billing). Nenhum crédito foi comprado. Após isso, republicar o fluxo, recriar empresa sintética, repetir testes de texto/imagem/áudio e somente então habilitar a empresa real na lista explícita. Não é necessário recriar a credencial se ela continuar válida.

## Publicação controlada

Workflow n8n `qcfswpWqCsxJUtCd` foi publicado temporariamente e depois despublicado. Configurado com uso único por ticket, credencial vinculada, sem persistência de conteúdo de execuções e timeout de 90 segundos. Nenhum pedido real é criado pelos testes.

Pacote no servidor: `/home/lablayer/releases/assistant-ai-20261021/`. Backup criado: `/home/lablayer/deploy-backups/assistant-ai-20261021-before.tar.gz`. Liberar inicialmente apenas `assistant-ai-smoke-20261021` na lista de empresas habilitadas. Ativação real somente após testes de texto, quantidade ausente, imagem, áudio e preservação dos pedidos existentes.

Rollback: restaurar os arquivos e `.env.production` do backup, recarregar `lablayer-app`; o fluxo volta ao modo guiado. O workflow n8n não possui acesso de gravação ao banco do LabLayer.
