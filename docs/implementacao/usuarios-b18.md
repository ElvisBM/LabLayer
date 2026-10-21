# B18 — usuários e acesso à mesma empresa

## Problema e entrega

A versão publicada não oferece gerenciamento de membros. O menu **Usuários e empresa** foi implementado localmente para que cada pessoa use sua própria conta e solicite acesso à empresa do proprietário. Essa entrega não altera automaticamente vínculos existentes e ainda não foi implantada.

O cadastro de solicitações comerciais no aplicativo publicado é uma operação separada desta entrega. Os arquivos de entrada e a conferência dos pedidos ficam no diretório local `orcamentos-recebidos`, fora do repositório. Salvar uma ficha nesse diretório não significa cadastrá-la na aplicação.

## Fluxo e regras

1. O proprietário consulta o ID da empresa no menu e fornece esse ID à pessoa desejada.
2. A pessoa entra com sua própria conta, verifica seu e-mail e solicita acesso pelo ID. A identidade e o e-mail vêm do token autenticado, nunca de campos fornecidos pelo cliente. A solicitação pendente não concede acesso.
3. Somente o proprietário aprova ou recusa. Pode conceder **Operador** (`member`) ou **Administrador** (`admin`); não pode transferir propriedade ou conceder superadmin por esse fluxo. Administradores possuem também as permissões comerciais/financeiras previstas nas etapas anteriores; operadores não são usuários somente de leitura.
4. Após aprovação, a pessoa atualiza a lista e seleciona explicitamente a empresa. O aplicativo recarrega para renovar os dados e a sessão. A troca preserva os dados da empresa anterior, mas alterações de formulário ainda não salvas podem ser perdidas; há aviso antes do botão.
5. O proprietário pode remover um membro mediante confirmação na interface. O comando invalida os vínculos e, se necessário, redefine o perfil para a empresa própria do usuário. O próximo provisionamento cria essa empresa caso ela ainda não exista. Histórico e registros comerciais são preservados.

O menu apresenta conta, empresa atual, ID completo e empresas disponíveis. A lista de pessoas e as solicitações pendentes são exclusivas do proprietário. Contas sem e-mail verificado têm ações explícitas para enviar o link Firebase e atualizar o token após confirmar; nenhum e-mail é enviado automaticamente.

## Contratos e persistência

| Rota | Comportamento |
|---|---|
| `GET /api/team/companies` | Lista empresa própria, empresa atual legada e vínculos ativos; informa conta e empresa atual |
| `GET /api/tenants/:tenantId/team` | Identifica empresa; somente proprietário recebe membros e solicitações |
| `POST /api/team/request-access` | Solicita acesso; repetição enquanto pendente conserva revisão e não duplica auditoria |
| `POST /api/tenants/:tenantId/team/:uid/decision` | Aprova/recusa com papel permitido e revisão esperada |
| `POST /api/tenants/:tenantId/team/:uid/revoke` | Remove vínculo ativo com revisão esperada; proprietário protegido |
| `POST /api/team/select-company` | Seleciona empresa própria, aprovada ou vínculo legado atual; papel derivado no servidor |

Vínculos ficam em `tenants/{tenantId}/members/{uid}` e no índice espelhado `users/{uid}/memberships/{tenantId}`. Solicitações ficam em `tenants/{tenantId}/accessRequests/{uid}`. Seleção atual continua em `users/{uid}.tenantId/tenantRole`, preservando os contratos E0–E5. As duas cópias do vínculo, a decisão e a auditoria são gravadas na mesma transação. Revogação também altera o perfil ativo nessa transação, quando aplicável.

Rules negam acesso direto de clientes às três novas coleções. Os comandos verificam autenticação, empresa ativa, propriedade, campos permitidos e revisão; não aceitam elevação arbitrária de papel. Conflitos pedem atualização da lista; falha de auditoria não deixa concessão parcial. A autorização depende dos documentos do servidor, sem nova claim de membro no token.

Compatibilidade: usuários legados vinculados à empresa atual continuam listados e podem ser removidos. Não há migração implícita de dados de outra empresa. A listagem recusa mais de 100 vínculos por pessoa ou mais de 200 documentos em cada consulta de membros, perfis legados e solicitações; paginação permanece evolução posterior. Convites por e-mail, mudança de papel de membro ativo e transferência de propriedade não fazem parte deste bloco.

## Qualidade — 21/10/2026

Barreira integral `npm run quality` aprovada: **329 testes**, sendo 175 unitários/interface e 154 de integração. Os 314 testes anteriores foram preservados; B18 acrescenta quatro testes de interface e onze de integração. TypeScript e build aprovados; auditoria de dependências de produção com zero vulnerabilidades. Evidência: [log B18](./evidencias-b18-quality.txt).

Os testes cobrem isolamento entre empresas, proprietário e membros legados, e-mail verificado, campos injetados, idempotência, aprovação sem seleção automática, troca com dados preservados, revogação e rules, proteção do proprietário, revisão obsoleta, empresa inativa, concorrência entre aprovação/recusa e rollback em falha de auditoria. A interface cobre aprovação com papel/revisão, ausência de gestão para não proprietário, confirmação de remoção, falha sem sucesso fictício e verificação de e-mail apenas por ação do usuário.

Execução em Node 22/Java 21, Firestore emulado `demo-lablayer-test`. Firebase Auth real e e-mails reais não foram usados nos testes. Os avisos de descoberta de metadados no emulador não impediram a barreira; não são evidência de homologação de credenciais reais.

## Publicação e conferência operacional pendentes

Implementação, testes e commit locais não disponibilizam o menu no site. A instalação publicada ainda utiliza a versão anterior às etapas de estabilização. Antes de publicar o conjunto, executar o [roteiro de piloto](./piloto-e5.md) e a [conferência B17](./homologacao-b17.md): backup/restauração, reconciliação de vínculos legados e propriedade, Auth real, configuração do servidor, cliente, Firestore rules e Storage/IAM quando aplicável. Não acionar deploy automático apenas para tornar este menu visível sem conferir as demais mudanças acumuladas.

Na homologação, usar duas contas controladas: solicitar, aprovar como operador, selecionar a empresa, verificar a mesma solicitação comercial, voltar à empresa própria e revogar. Repetir a conferência de permissões com administrador e testar e-mail de verificação. Validar que outro tenant não lê os dados, e que a revogação bloqueia novas operações. Nenhum acesso de terceiros foi concedido na instalação real durante esta implementação.

## Complemento B21

O [B21](./cadastro-usuarios-b21.md) acrescenta cadastro direto com senha inicial, exibição de nome e gestão por administrador global autenticado, além do proprietário. Esta atualização substitui a restrição exclusivamente ao proprietário descrita acima; administradores comuns de tenant continuam sem poder conceder acesso. Publicação permanece pendente da escolha da empresa ativa.
