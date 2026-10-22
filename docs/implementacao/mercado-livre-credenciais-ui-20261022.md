# Cadastro de credenciais Mercado Livre pela interface

Entrega de M0 em 22/10/2026: administradores cadastram App ID e Client Secret em **Configurações > Integrações > Mercado Livre**. Salvar não autoriza a conta do vendedor: o estado é “Credenciais salvas — autorização pendente”. Não há publicação de anúncios ou movimentação de estoque.

## Comportamento

- O App ID é lido da configuração da empresa; o ID informado para a empresa do usuário é `2379102902840747`.
- O segredo é digitado em campo de senha e apagado do formulário após a tentativa. Nunca é preenchido por leitura do servidor, salvo em localStorage ou devolvido pela API.
- Em edição, segredo vazio preserva o anterior somente se o App ID não mudar. Novo App ID exige novo segredo.
- Trocar empresa desmonta o formulário e descarta seu estado. Erros de gravação exigem recarregar para confirmar a versão atual antes de tentar novamente.
- Credenciais ainda não foram validadas contra o Mercado Livre. Não reutilizar o antigo callback que simulava sucesso: as duas rotas legadas agora retornam HTTP 409 até a entrega do OAuth seguro.

## Acesso e armazenamento

`GET/POST /api/tenants/:tenantId/integrations/mercadolivre/credentials` exige token Firebase verificado pelo backend. Autoriza proprietário pelo `ownerUid`, administrador vinculado à empresa ou administrador da plataforma. Vínculo explícito revogado ou rebaixado prevalece sobre o papel antigo de administrador no perfil. Empresa inativa é recusada.

O segredo usa AES-256-GCM com nonce aleatório e contexto autenticado contendo empresa e provedor. É gravado na coleção raiz privada `privateMarketplaceCredentials/{tenantId}`, sem permissões de leitura ou escrita pelo SDK cliente. A resposta contém apenas App ID, presença de segredo, revisão, data, disponibilidade do cofre e estado pendente. Cabeçalho `Cache-Control: no-store`.

Credencial e auditoria são gravadas na mesma transação. `expectedRevision` impede uma sessão antiga de sobrescrever a configuração. Logs de auditoria contêm ator, operação, revisão e indicador de substituição, sem segredo nem ciphertext. Erros inesperados não registram corpo da requisição nem payload de exceção.

A chave de 32 bytes fica fora da aplicação em `/home/lablayer/private-config/marketplace-credentials.key`, arquivo `0600`. O caminho é configurado por `LABLAYER_MARKETPLACE_KEY_FILE`, persistido em `.env.production` e no ambiente PM2. O diretório `shared` não é gravável pelo usuário do serviço; por isso foi usado o diretório privado no home desse usuário. Chave ausente, tamanho incorreto ou permissão para grupo/outros desabilita a escrita. Preservar essa chave e seu backup protegido: trocar ou perder a chave torna os segredos anteriores ilegíveis. Rotação de chave requer recriptografia coordenada e não faz parte desta entrega.

As regras efetivamente publicadas no banco nomeado foram consultadas pela API Firebase Rules: o hash coincide com o arquivo de regras do release (`01c7fcaef63914083dda6b9a8a63f4d04f55be9d7dab5c7dbec71c1a6fa41f04`). Não há autorização para a nova coleção raiz. Nenhuma alteração de regras é necessária nesta entrega. O perfil da conta solicitante foi conferido: está vinculado à empresa correta e possui papel de administrador da plataforma reconhecido pelo adaptador de produção.

## Qualidade

- Release: TypeScript e build passaram; aviso já existente de tamanho do bundle.
- 6 testes unitários: formulário, permissões na interface, falha, troca de empresa, chave de arquivo e integridade criptográfica.
- 9 testes com emulador Firestore: criptografia por tenant; autorização; sessão inválida; empresa alheia/inativa; membro revogado; validação; preservação/rotação do segredo; revisão; auditoria atômica; indisponibilidade do cofre; bloqueio do SDK cliente; bloqueio do OAuth antigo.
- Ramo de estabilização: TypeScript e os 9 testes unitários selecionados passaram, incluindo a proteção E0 das telas alteradas.
- Não foi executada a suíte inteira nem realizado consentimento externo. Testes usam credenciais fictícias em projeto emulado `demo-lablayer-test`.

## Publicação e reversão

Publicar a partir do checkout de release, preservando os módulos e dados de produção. Entrega: `server.ts`, novo módulo `server/marketplace-credentials.ts` e build `dist`. Criar a chave protegida somente se inexistente; nunca substituí-la durante redeploy. Inicializar apenas o App ID e revisão zero da empresa se não existir configuração; não cadastrar o segredo recebido anteriormente no chat.

Guardar cópia dos arquivos anteriores antes do corte. Em falha, restaurar backend e frontend e reiniciar o processo. Preservar chave e coleção de credenciais mesmo em rollback; não apagar uma credencial eventualmente cadastrada pelo usuário. O rollback ao backend anterior também reintroduz seu callback incompleto, portanto exige manter a autorização externa suspensa.

Próxima etapa: OAuth com `state`, sessão/tenant, troca de código, armazenamento de tokens, renovação e consulta somente de leitura para confirmar a identidade da loja.

## Conferência da publicação

Release funcional `e79b649` publicado em 22/10/2026. Backup anterior em `/home/lablayer/deploy-backups/ml-credentials-e79b649`, incluindo cópia protegida da chave. A primeira tentativa parou antes da troca de código por falta de permissão de escrita no diretório shared; a segunda utilizou o caminho privado acima e concluiu. App ID inicializado na empresa sem segredo, com auditoria. Processo online após reinício e configuração PM2 persistida.

Verificação HTTPS: página inicial 200; endpoint de credenciais sem sessão 401; antigas rotas auth/callback 409 sem redirecionamento. Bundle `index-5H2vCA15.js` contém o formulário publicado. Chave de 32 bytes legível pelo serviço e sem permissão para grupo/outros. Não foi realizado cadastro de segredo real nem login em nome do usuário durante a validação.
