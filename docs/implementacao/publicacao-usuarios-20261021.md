# Publicação de Usuários e reativação da empresa — 21/10/2026

## Resultado

Publicado em `https://app.lablayer.com.br/` após autorização explícita do usuário para publicar e ativar a empresa que utiliza com `elvisbmartins@gmail.com`. O tenant `5byAJZJsXDhUKYtdYKpqIaTzaUQ2`, que contém as **27 solicitações**, mudou somente de `inactive` para `active`. Perfil, vínculo, propriedade e conteúdo dos pedidos foram preservados. A empresa própria vazia do Elvis não foi alterada.

O menu **Usuários** foi conferido na sessão autenticada do Elvis, com nome, e-mail, Operador/Administrador e senha inicial. O papel global é apresentado como **Administrador da plataforma**. Nenhuma conta nova de terceiro foi criada; o cadastro fica disponível para o usuário preencher. Login de uma identidade recém-criada permanece uma conferência operacional a realizar quando existir uma conta real autorizada para isso.

## Código e configuração

- Base publicada: `457f531`; ajuste do rótulo de administrador global: **`0b4e78d`**, branch remota `release/users-b21`.
- Transporte isolado sobre a base de produção. Não houve merge/push em `main` nem deploy integral E0–E5. Foram preservadas as chaves administrativas por tenant já existentes no servidor.
- Dependências instaladas na VPS antes da troca: auditoria de produção com **zero vulnerabilidades**. Node `22.22.2`; PM2 `lablayer-app` online.
- Regras ativas do banco nomeado: `projects/lablayer-493220/rulesets/7fe01835-1934-4c8e-bc17-8fd97a5a6e31`.
- A credencial de runtime não possui permissão de publicação de regras. A publicação usou a sessão administrativa Google Cloud já autenticada do usuário. Nenhuma permissão IAM foi ampliada. A compilação retornou somente quatro avisos no helper legado não utilizado `isValidTenant`; nenhum erro.
- Confirmadas por consulta IAM as permissões existentes de criação/leitura/atualização de usuários Firebase Auth e criação/atualização de documentos Firestore da credencial de runtime.

## Evidências

1. `GET /api/health`: HTTP 200 e `status: ok`; rotas de sessão e criação sem token retornaram 401.
2. Sessão existente renovada pela API do servidor; menu carregou empresa correta, formulário e permissões de administrador global.
3. Tela de encomendas: **27 solicitações**, sendo 17 aguardando orçamento e 10 orçadas. Busca `ORC-`: **13 de 27**, incluindo Zalma com 10 unidades.
4. Comparação canônica antes/depois dos 27 documentos: hash idêntico. Perfil do Elvis também idêntico. Resultado salvo na VPS em `/home/lablayer/releases/users-b21-457f531/verification.json`.
5. Release final: **40 testes** (12 unitários/interface e 28 integração), tipos/build aprovados, zero vulnerabilidades de produção. Log em `release/users-b21:docs/implementacao/evidencias-users-release-quality.txt`.
6. Estabilização: barreira integral anterior com **346 testes**, seguida de TypeScript, **180 testes unitários/interface** e **12 testes de integração de equipe** aprovados após o ajuste do rótulo. [Log de integração complementar](./evidencias-b21-admin-label-integration.txt).
7. Captura local da interface: `/Users/PCNOTES/Workspace/3D/lablayer/evidencias-publicacao/usuarios-20261021.png`. Mantida fora do Git por conter os e-mails da equipe.

Hashes SHA-256 conferidos na VPS e, para o HTML, também pela URL pública:

| Arquivo | SHA-256 |
|---|---|
| `dist/index.html` | `130b236e27a044a24bcfd944f3a1c6c81c60c81c5d5514a509ab8fce9bc6ac2f` |
| `server.ts` | `1c00c0b39845187b5f570bf65f2e7495bc44da0a88f6685286bf92faebfcd417` |
| `server/team.ts` | `b2edfce7da8f8ce688847bdd91e31e4556ccf87f61306bd11d976840ad611cd3` |
| `firestore.rules` | `f8d6720a700383254299b5a5b80c4486ab42145378fcb3630dfa61788789f5cf` |

## Backup e reversão

- Aplicação anterior completa, incluindo suas dependências: `/var/www/lablayer/app-before-users-b21-457f531`, restrita ao usuário do serviço.
- Snapshot adicional sem dependências: `/home/lablayer/deploy-backups/users-b21-457f531-app-before.tar.gz`, SHA-256 `18d36b974fbe7aa23c27e82532e8f7c1967fc4dca648356673871cc79dc16117`, modo 600.
- Estado anterior da empresa/perfil, hash dos pedidos e regras: `/home/lablayer/deploy-backups/users-b21-457f531-state.json`, modo 600. Nunca publicar esse arquivo.
- Ruleset anterior: `projects/lablayer-493220/rulesets/ed754734-9ca0-492a-8500-780c7d5c4126`.
- Reativação auditada em `tenants/5byAJZJsXDhUKYtdYKpqIaTzaUQ2/auditLogs/users-b21-reactivation-457f531`, atribuída ao usuário solicitante e vinculada à release.
- Artefatos e script de publicação em `/home/lablayer/releases/users-b21-457f531/`. `.env.production`, `.env.local` e scripts operacionais existentes foram preservados sem exposição de segredos. Assets anteriores foram mantidos para abas abertas.

Para reversão da aplicação, parar o processo, preservar a pasta atual como evidência e recolocar a pasta anterior no caminho `/var/www/lablayer/app`; restaurar o ruleset anterior com uma sessão administrativa e recarregar o PM2 usando `ecosystem.config.cjs`. Conferir health, sessão e documentos. A reativação foi autorizada separadamente e não deve ser desfeita automaticamente. Não excluir contas ou vínculos criados após a publicação como parte de rollback.
