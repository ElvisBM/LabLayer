# MCP do Mercado Livre (2026-11-23)

Servidor MCP (Model Context Protocol) dentro da própria LabLayer para o Claude operar a conta do Mercado Livre conectada à empresa: conta e configurações, anúncios, vendas, perguntas e mensagens pós-venda.

- Endpoint: `POST https://app.lablayer.com.br/api/mcp` (Streamable HTTP, sem sessão, respostas JSON). `GET`/`DELETE` retornam 405.
- Código: `server/mcp-mercadolivre.ts`. Reaproveita o carregador de token da integração (`connectionToken` em `server/marketplace-oauth.ts`): mesma criptografia, renovação com lease e checagem de conexão. Nenhum token do Mercado Livre sai do servidor.
- Desligar sem deploy de código: `LABLAYER_MCP_ENABLED=false` no `.env.production` + `pm2 reload`.

## Autenticação

`Authorization: Bearer ll_mcp_…`. A chave é exclusiva de uma empresa, age em nome do administrador que a criou e fica salva apenas como SHA-256 em `privateMcpKeys/{sha256}` (coleção sem acesso para clientes Firestore). A cada chamada o servidor revalida: chave ativa e não expirada, empresa ativa, acesso do responsável (admin/dono/superadmin) e conexão do Mercado Livre. Limite de 120 chamadas por minuto por chave.

Escopos: `mercadolivre:read` (consultas) e `mercadolivre:write` (alterações). Chave com `--read-only` não altera nada.

### Criar, listar e revogar chaves (na VPS)

```bash
cd /var/www/lablayer/app
export GOOGLE_APPLICATION_CREDENTIALS=/var/www/lablayer/shared/firebase-service-account.json
DB=$(grep ^FIRESTORE_DATABASE_ID .env.production | cut -d= -f2 | tr -d '"')
npx tsx tools/mcp-key.ts create --database "$DB" --tenant <tenantId> --uid <uid do admin> --label "Claude" --days 180
npx tsx tools/mcp-key.ts list   --database "$DB" --tenant <tenantId>
npx tsx tools/mcp-key.ts revoke --database "$DB" --id <id>
```

A chave aparece uma única vez. Não salve no repositório (ele é público).

## Conectar o Claude

Claude Code:

```bash
claude mcp add --transport http lablayer-ml https://app.lablayer.com.br/api/mcp --header "Authorization: Bearer ll_mcp_..."
```

Claude Desktop (`claude_desktop_config.json`), via `mcp-remote`:

```json
{ "mcpServers": { "lablayer-ml": { "command": "npx", "args": ["mcp-remote", "https://app.lablayer.com.br/api/mcp", "--header", "Authorization:${LABLAYER_MCP}"],
  "env": { "LABLAYER_MCP": "Bearer ll_mcp_..." } } } }
```

claude.ai / app Claude (conector personalizado, OAuth): em Configurações > Conectores > Adicionar conector personalizado, informe `https://app.lablayer.com.br/api/mcp`. O Claude registra o cliente sozinho e abre a página de consentimento da LabLayer, onde você cola a chave `ll_mcp_…` uma vez.

### OAuth (`server/mcp-oauth.ts`)

- Metadados: `/.well-known/oauth-protected-resource/api/mcp` e `/.well-known/oauth-authorization-server`; endpoints em `/api/oauth/{authorize,token,register,revoke}`. O 401 do `/api/mcp` traz `resource_metadata` no `WWW-Authenticate`.
- PKCE S256 obrigatório, registro dinâmico de clientes, código de uso único (5 min), access token de 1 h e refresh token de 30 dias com rotação. Tudo salvo por SHA-256 em `privateMcpOAuthCodes`/`privateMcpOAuthTokens`; clientes em `privateMcpOAuthClients`.
- Os tokens ficam presos à chave usada no consentimento: revogar ou expirar a chave corta na hora o acesso e o refresh. Cada autorização gera `marketplace.mcp.oauth.authorized` na auditoria.
- `LABLAYER_PUBLIC_URL` (padrão `https://app.lablayer.com.br`) define o emissor.

## Ferramentas

Leitura: `ml_conta`, `ml_preferencias_envio`, `ml_listar_anuncios`, `ml_ver_anuncio`, `ml_listar_rascunhos`, `ml_listar_vendas`, `ml_ver_venda`, `ml_listar_perguntas`, `ml_mensagens_venda`, `ml_reclamacoes`.

Escrita (marcadas `destructiveHint`, exigem `mercadolivre:write`, auditadas em `tenants/{tenant}/auditLogs` como `marketplace.mcp.*` com `actor: mcp:{id}` e `onBehalfOf`):

| Ferramenta | O que faz | Bloqueios locais |
|---|---|---|
| `ml_alterar_preco` | preço do anúncio ou de uma variação | só ativo/pausado; promoção ativa |
| `ml_alterar_estoque` | estoque do anúncio ou de uma variação | variação obrigatória quando houver |
| `ml_alterar_titulo` | título (até 60) | catálogo, anúncio com vendas |
| `ml_alterar_descricao` | substitui descrição (texto simples) | |
| `ml_pausar_anuncio` / `ml_reativar_anuncio` | status | reativar exige estoque |
| `ml_responder_pergunta` | resposta pública | só pergunta pendente da conta |
| `ml_enviar_mensagem_venda` | mensagem pós-venda (até 350) | só venda da conta |

Toda escrita confere que o anúncio/venda pertence ao vendedor conectado, relê o estado depois e informa `confirmado`. Variações são enviadas com todos os ids (exigência da API para não apagar as demais). Aprovação e publicação de rascunhos continuam exclusivas da tela Anúncios. A lista de anúncios da tela tem cache de 60 s; use Atualizar após mudanças pelo MCP.

## Testes

`tests/integration/mcp-oauth.test.ts` (fluxo OAuth completo, PKCE, código único, rotação de refresh, revogação pela chave, redirect e recurso inválidos) e `tests/integration/mcp-mercadolivre.test.ts` (emulador): autenticação/revogação, perda de acesso, leitura sem escrita, chave somente leitura, preço/estoque com auditoria, variações, vendedor diferente e resposta a pergunta.
