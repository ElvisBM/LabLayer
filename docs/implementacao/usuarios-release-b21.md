# Release B21 — usuários sobre a instalação publicada

**Preparada e testada, não publicada.** Base: `1879949`, release/quote-view-modes. Aguardando escolha da empresa: Elvis está vinculado ao tenant inativo com 27 solicitações; sua empresa própria está ativa e vazia. Nenhum vínculo, status ou pedido real foi alterado.

## Conteúdo

Menu Usuários com nome, e-mail, Operador/Administrador e senha inicial; criação Auth desabilitada, vínculo transacional e habilitação posterior. Idempotência, lease, auditoria sem senha e recuperação de falhas. Senha não é persistida no LabLayer e retry nunca a redefine. Conta existente segue solicitação/aprovação B18; há seleção de empresa e remoção de acesso.

Provisionamento de sessão no servidor e bloqueio de alterações diretas em perfil/tenant/papéis. Empresa inativa bloqueia sessão e dados comerciais. Proprietário e administrador global autenticado gerenciam acessos; administradores de tenant não concedem acesso. O adaptador desta release preserva o papel global legado lido pelo servidor em perfil imutável pelo cliente. Nunca deriva esse papel de e-mail ou corpo da requisição; a estabilização usa claim autenticada.

Operador acessa dados e cria/edita solicitações pendentes; administrador também aprova e registra financeiro/configurações. Cliente não escreve vínculos, operações internas ou auditoria.

Preservadas as chaves administrativas por tenant já existentes na VPS. Hash do server.ts anterior: `b622747591821f6b98e76dc8e54b58774bc18be307cee873afda857d66fcee2a`. Dependências alinhadas às versões corrigidas da estabilização. Tipos opcionais Product.createdAt e Printer.usedHours corrigem quatro erros TypeScript existentes, sem alteração de execução.

## Validação

`npm run quality`, Node 22/Java 21: **39 testes** (12 unitários/interface + 27 integração), tipos e build aprovados, **zero vulnerabilidades de produção**. Log: [evidência](./evidencias-users-release-quality.txt). O bundle legado mantém aviso de tamanho acima de 500 kB.

Testes cobrem três visualizações dos orçamentos, sessão, formulário, falhas e regras de acesso. Auth é simulado nos testes de falhas; nenhuma identidade real de terceiro foi criada. Login real com conta controlada permanece conferência operacional após publicação.

## Handoff de publicação

1. Aguardar escolha do usuário e registrar somente a correção de vínculo/status autorizada. Não migrar pedidos ou transferir propriedade implicitamente.
2. Conferir hashes e salvar snapshot de servidor, fontes, dist, package/lock e dependências; preparar dependências novas antes da troca. Preservar .env.production e credenciais externas.
3. Regras anteriores salvas na VPS em `/home/lablayer/deploy-backups/users-before-rules.json`; ruleset observado: `projects/lablayer-493220/rulesets/ed754734-9ca0-492a-8500-780c7d5c4126`.
4. Publicar servidor, regras do banco nomeado e interface em conjunto. Não publicar só o menu sobre regras antigas. Não disparar workflow de main sem reconciliar as alterações do servidor em produção.
5. Conferir health, sessão, menu, empresa, 27 solicitações e três visualizações; usar conta controlada para conferir login, papel e remoção. Não criar conta de terceiro não especificada.
6. Em falha, restaurar snapshot da aplicação/dependências e ruleset anterior, recarregar PM2 e conferir sessão. Não excluir identidades ou vínculos automaticamente no rollback.

Esta release de compatibilidade não publica as demais etapas E0–E5.
