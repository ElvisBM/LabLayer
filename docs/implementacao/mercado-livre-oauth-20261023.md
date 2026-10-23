# Conexão da conta Mercado Livre

O cadastro de App ID e Client Secret já existia, mas faltava iniciar e concluir a autorização da conta. A integração agora oferece **Conectar Mercado Livre** em **Configurações > Integrações**, utilizando as credenciais protegidas da empresa. Após o consentimento, o retorno abre a mesma área e mostra o nome e o ID da conta confirmados pela API. Conectar não publica anúncios, não importa vendas e não movimenta estoque.

## Uso

1. Atualizar a página do LabLayer e abrir Configurações > Integrações > Mercado Livre.
2. Com as credenciais já salvas, clicar em Conectar Mercado Livre. Alterações não salvas precisam ser salvas antes de conectar.
3. Entrar na conta de vendedor desejada e autorizar o aplicativo no domínio oficial do Mercado Livre.
4. Conferir a identificação da loja no retorno ao LabLayer. O botão Verificar conexão consulta novamente a conta; Reconectar permite uma nova autorização.

Redirect cadastrado no aplicativo: `https://app.lablayer.com.br/api/integrations/mercadolivre/callback`. Precisa coincidir exatamente com o usado no fluxo. O aplicativo usa autorização por código com PKCE S256, troca de código no servidor e consulta `/users/me`, conforme a [documentação de autorização](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao) e a [consulta de usuários](https://developers.mercadolivre.com.br/pt_br/consulta-de-usuarios).

## Segurança e consistência

- `POST /api/tenants/:tenantId/integrations/mercadolivre/connect` exige sessão Firebase, empresa ativa, proprietário/administrador ou administrador da plataforma e a revisão atual das credenciais. O retorno contém somente a URL oficial de autorização.
- State de 256 bits, com expiração de 10 minutos, é armazenado pelo hash em coleção privada. Cookie `__Host-lablayer-ml-oauth` é Secure, HttpOnly, SameSite=Lax e vincula a tentativa ao navegador. O verificador PKCE fica criptografado; state e código nunca escolhem a empresa por parâmetro do navegador.
- Callback consome a tentativa antes da chamada externa, valida cookie, expiração, última tentativa da empresa, revisão das credenciais e permissão atual. Repete a conferência antes do commit. Revogação de administrador e remoção do privilégio de plataforma são respeitadas. Cancelamento e falhas consomem a tentativa; iniciar novamente é seguro.
- Tokens só são persistidos depois de confirmar que `/users/me` corresponde ao vendedor do token. Token e refresh token usam AES-256-GCM, com contexto distinto por empresa e finalidade. A mesma chave protegida do cofre existente é preservada. Tokens, segredo, código e respostas brutas do provedor não vão à interface nem à auditoria.
- Conexão e auditoria são gravadas atomicamente. Falha de auditoria impede anunciar sucesso. Um parâmetro `mercadolivre=connected` na URL não simula conexão: a interface depende dos metadados autenticados do servidor.
- Coleções privadas: `privateMarketplaceConnections`, `privateMarketplaceOAuthStates` e `privateMarketplaceOAuthAttempts`; sem acesso pelo SDK cliente, inclusive para proprietário e administrador da plataforma. Nenhuma alteração de regras Firestore é necessária.
- Salvar novamente as credenciais incrementa a revisão e exige reconexão. O segredo vazio mantém a credencial anterior; a interface informa que o campo não será preenchido de volta.
- Endpoints do provedor e destino de retorno são fixos. Não há redirect arbitrário. Chamadas externas usam timeout de 15 segundos e recusam redirecionamentos HTTP.

## Renovação de acesso

`POST /api/tenants/:tenantId/integrations/mercadolivre/check` verifica a identidade da loja. Se o acesso venceu, renova primeiro e persiste o novo refresh token antes da consulta da loja. Uma falha temporária nessa consulta não perde o token recém-rotacionado.

A renovação tem exclusão mútua no Firestore. Refresh token é de uso único: verificações concorrentes não podem renová-lo duas vezes. Timeout, falha incerta ou operação abandonada exigem reconexão em vez de reutilizar o token. A renovação nesta etapa ocorre ao verificar a conexão; não existe agendamento de sincronização ou renovação em segundo plano. As futuras rotinas de catálogo/vendas deverão usar o mesmo controle de renovação.

## Testes e publicação

- 12 testes unitários de interface e chave: conexão, revisão salva, domínio de destino, credenciais não salvas, permissão, falha, troca de empresa, cancelamento, confirmação pelo servidor e verificação de acesso.
- 27 testes de integração no emulador Firestore: autenticação/empresa, PKCE/cookie/state, replay, expiração, revisão concorrente, revogação, isolamento, retorno do provedor, identidade da conta, criptografia, auditoria atômica, regras privadas, renovação e concorrência de refresh.
- TypeScript e build do release verificados. Testes externos usam provedor simulado e não consomem autorização real do vendedor.
- Publicação inclui os três módulos `server/marketplace-credentials.ts`, `server/marketplace-security.ts`, `server/marketplace-oauth.ts` e `dist`. Não modifica `server.ts`, bot, estoque, chave de criptografia ou credenciais salvas.

A confirmação da autorização real depende do consentimento do titular no Mercado Livre. Credenciais salvas e botão disponível não significam conta conectada. Em erro `invalid_client`, revisar App ID/Client Secret; em `invalid_grant`, revisar redirect e reiniciar a autorização; em cancelamento ou tentativa expirada, clicar em Conectar novamente.

## Reversão

Restaurar o módulo de credenciais e o build anteriores e reiniciar o serviço. Preservar a chave, todas as coleções privadas e os registros de auditoria. O backend anterior volta a mostrar autorização pendente e não utiliza tokens. Não restaurar dados antigos por cima de uma conexão ou credencial mais recente.


## Conferência da publicação em 23/10/2026

Release `30f7813` publicado. Backup anterior em `/home/lablayer/deploy-backups/ml-oauth-30f7813`. Processo reiniciado e online; hashes de `server.ts` e do módulo do bot permanecem iguais aos anteriores. Build servido: `index-kpqIQDqz.js`, CSS `index-DBI7MLHx.css`; assets antigos preservados para abas já abertas.

HTTPS confirmou página e assets 200, callback inválido retornando à tela de configurações sem simular sucesso, e endpoints credentials/connect/check retornando 401 sem sessão. A credencial existente permanece na revisão 2, sem substituição durante o deploy. Ainda não houve autorização real do vendedor: o consentimento deve ser realizado pelo usuário no Mercado Livre.

Paridade no repositório principal: TypeScript e os mesmos 12 testes unitários passaram. A alteração de navegação foi aplicada isoladamente, preservando o carregamento de telas existente no ramo principal.
