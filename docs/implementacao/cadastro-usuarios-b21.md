# B21 — cadastro de usuários com senha inicial

## Entrega e estado

O menu **Usuários** complementa o B18 com cadastro de nome, e-mail, tipo de acesso (Operador ou Administrador) e senha inicial. A lista passa a exibir nome, e-mail e papel. O cadastro cria uma identidade Firebase Authentication e a vincula à empresa atual. Não representa uma transferência de propriedade.

**Atualização: publicada e empresa reativada em 21/10/2026; ver [registro de publicação](./publicacao-usuarios-20261021.md).** A descrição abaixo registra a divergência encontrada antes da autorização. A conferência de produção encontrou uma divergência que exige escolha do responsável: a conta `elvisbmartins@gmail.com` está vinculada à empresa de `brincamentelab@empresa.com`, marcada como `inactive`, com 27 solicitações. A empresa própria do Elvis está `active` e vazia. Nenhum vínculo, status de empresa ou dado comercial foi alterado nesta entrega. Publicar o novo provisionamento de sessão sem resolver essa situação bloquearia a sessão atual com “Empresa inativa”. A decisão foi solicitada ao usuário.

## Regras de negócio

- O proprietário da empresa ou administrador global autenticado da plataforma pode gerenciar usuários. O Administrador de uma empresa pode executar as operações comerciais/financeiras de seu papel, mas não conceder acesso a terceiros. Operador não é um perfil somente leitura.
- A empresa precisa existir e estar ativa. A autorização é reavaliada dentro das transações; o tenant vem da rota autenticada, não de um campo livre do formulário.
- Nome obrigatório, até 100 caracteres; e-mail normalizado para minúsculas, até 254; senha de 12 a 128 caracteres. A política adicional do Firebase continua aplicável.
- Somente `member` e `admin` podem ser atribuídos. O cadastro nunca aceita `owner`, `superadmin`, UID ou tenant adicional no corpo.
- E-mail já existente é recusado com orientação para o fluxo de solicitação/aprovação B18. Não troca a senha existente nem vincula automaticamente essa identidade.
- Senha vai somente ao Firebase Authentication pela API do servidor. Não é gravada em perfil, vínculo, operação, auditoria ou logs da aplicação. O formulário usa campo mascarado, memória temporária e limpa o valor após sucesso; não utiliza armazenamento local.
- Não há envio automático de e-mail. O usuário criado entra com o e-mail e a senha inicial. Troca obrigatória de senha no primeiro login e convites por e-mail permanecem fora deste bloco.
- A conta já nasce vinculada à empresa escolhida; não precisa selecionar o tenant no primeiro login. O fluxo B18 continua disponível para contas existentes.

## Contrato e recuperação

`POST /api/tenants/:tenantId/team/create-user`, Bearer Firebase ID token verificado com checagem de revogação. Corpo: `requestId` UUID, `name`, `email`, `role`, `password`. Retorno bem-sucedido: `{ status: 'created', uid }`. Falhas: 400 validação, 401 autenticação, 403 autorização/empresa, 409 conflito, 503 indisponibilidade/retomada.

Firebase Auth e Firestore não compartilham transação. A operação reserva um UID estável derivado de empresa, autor e requestId em `tenants/{tenantId}/userCreations/{requestId}`; cria a identidade **desabilitada**; grava perfil, dois vínculos e auditoria atomicamente; só então habilita o login e registra conclusão. A reserva possui lease de dois minutos e identificador de execução para impedir uma chamada antiga de liberar a reserva de outra.

Falha intermediária permite retomada com o mesmo requestId e dados. Não se exclui automaticamente uma identidade parcialmente criada e não se redefine sua senha. Se a aplicação for fechada durante falha parcial, a retomada administrativa pode exigir recuperar o requestId da operação no servidor. O formulário preserva o requestId durante retry e bloqueia alteração da senha daquela tentativa; “Iniciar outro cadastro” inicia outra operação. Não anuncia falha de cadastro quando somente a atualização da lista falha.

Vínculos revogados durante o processo não são reativados por retry. A conta pode existir no Auth sem acesso ao tenant até a conclusão; falha antes do vínculo a mantém desabilitada. `userCreations` não aceita leitura ou escrita direta pelo cliente. A auditoria usa `team.user-linked` e `team.user-created`, sem senha.

## Verificação

Regressão integral E0–E5 e complementos pelo comando `npm run quality`, Node 22/Java 21, Firestore local `demo-lablayer-test`. **346 testes aprovados**: 180 unitários/interface e 166 integração, TypeScript/build aprovados e zero vulnerabilidades de produção. [Evidência final](./evidencias-b21-quality.txt). B21 adiciona testes de formulário, papéis, isolamento, conta existente, idempotência, concorrência, falha transacional, ativação interrompida, revogação, operações internas e administrador global. O adaptador Auth é simulado nos testes de falhas; nenhuma conta real de terceiro foi criada e o login de um usuário novo em produção ainda precisa de conferência operacional após publicação.

## Preparação da versão compatível com produção

Uma versão separada foi preparada sobre `release/quote-view-modes`, preservando as chaves administrativas por tenant já presentes no servidor. Ela inclui B18/B21, provisionamento de sessão no servidor, bloqueio de alterações de perfil/permissões pelo navegador e regras de papéis compatíveis com os formulários legados. As dependências foram alinhadas às versões corrigidas da estabilização; não publicar somente o JavaScript do menu sobre as regras antigas.

A versão de compatibilidade mantém temporariamente o papel global legado, lido pelo servidor de um perfil que o navegador não pode alterar. A estabilização usa a claim `superadmin === true`. Essa diferença está isolada no adaptador da release; não conceder claims nem alterar perfis arbitrariamente para contornar a divergência de empresa.

Após a escolha da empresa: registrar a correção de vínculo/status estritamente autorizada, salvar backup de regras e aplicação, publicar servidor/regras/interface/dependências em conjunto, conferir sessão e menu, verificar as 27 solicitações e validar acesso/remoção com uma conta controlada. Não acionar o deploy integral de `main`: há alterações de servidor em produção que precisam ser preservadas. A preparação da release não substitui essa validação operacional.

Release de compatibilidade preparada no commit `457f531`, branch local `release/users-b21`: 39 testes específicos, tipos/build e auditoria de produção aprovados. A publicação posterior e o ajuste de identificação do administrador global estão registrados no documento de publicação.
