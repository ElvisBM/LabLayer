# Assistente com IA — entrega e evidências (21/10/2026)

## Mudança

O assistente passa a oferecer interpretação de texto e fotos e transcrição de um áudio por pedido, utilizando a credencial OpenAI já cadastrada no n8n. O vendedor confere a proposta e confirma o cadastro. Cadastro, anexos, idempotência, isolamento de empresa, preços, estoque e aprovação continuam sob as regras do LabLayer.

Contrato, limites, arquitetura e operação: [referência n8n](../n8n/assistente-ia-contrato.md).

## Qualidade

Versão compatível com produção: TypeScript, **29 testes unitários/UI + 53 de integração (82)**, build e auditoria de produção aprovados (zero vulnerabilidades). Uma tentativa concorrente das suítes sofreu timeout na preparação do ambiente; a execução isolada acima passou integralmente. Aviso existente de bundle acima de 500 kB permanece.

Regressão E0–E5 e validação real: em andamento; não considerar esta revisão como aprovação da ativação para vendedores.

## Publicação controlada

Workflow n8n `qcfswpWqCsxJUtCd` publicado com uso único por ticket, credencial vinculada, sem persistência de conteúdo de execuções e timeout de 90 segundos. Nenhum pedido real é criado pelos testes.

Pacote no servidor: `/home/lablayer/releases/assistant-ai-20261021/`. Backup previsto: `/home/lablayer/deploy-backups/assistant-ai-20261021-before.tar.gz`. Liberar inicialmente apenas `assistant-ai-smoke-20261021` na lista de empresas habilitadas. Ativação real somente após testes de texto, quantidade ausente, imagem, áudio e preservação dos pedidos existentes.

Rollback: restaurar os arquivos e `.env.production` do backup, recarregar `lablayer-app`; o fluxo volta ao modo guiado. O workflow n8n não possui acesso de gravação ao banco do LabLayer.
