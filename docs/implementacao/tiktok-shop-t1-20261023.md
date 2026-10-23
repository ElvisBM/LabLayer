# TikTok Shop — T1: conexão e consulta

Implementação de 23/10/2026, seguindo o [plano de viabilidade](tiktok-shop-viabilidade-20261023.md). A etapa entrega cadastro de aplicativo por empresa, autorização de vendedor, escolha explícita da loja brasileira, renovação de acesso e consulta no menu Anúncios. Não cria, edita ou desativa produtos remotos; não importa pedidos nem altera estoque.

## Configuração pelo administrador

1. No TikTok Shop Partner Center ROW, configurar o aplicativo para a loja brasileira, habilitando API e os escopos `seller.authorization.info` (Shop Authorized Information) e `seller.product.basic` (Product Basic). A disponibilidade depende da modalidade e aprovação do aplicativo.
2. Cadastrar exatamente o redirect `https://app.lablayer.com.br/api/integrations/tiktokshop/callback`.
3. No LabLayer, Configurações → Integrações (APIs) → TikTok Shop: preencher App Key, App Secret e Service ID. Service ID é o parâmetro `service_id` do link de autorização de vendedor mostrado no Partner Center; não confundir com App Key, Shop ID ou conta de anúncios.
4. Salvar, clicar em Conectar TikTok Shop e autorizar no domínio oficial. Ao retornar, selecionar a loja da empresa e clicar em Usar esta loja, mesmo quando há somente uma opção.
5. Abrir Anúncios e filtrar TikTok Shop. Verificar conexão permite atualizar a lista de lojas autorizadas. Salvar novamente as credenciais invalida a conexão anterior e requer nova autorização.

O App Secret deixa de aparecer no campo após salvar, intencionalmente. A tela mostra “Segredo cadastrado”; campo vazio preserva o segredo somente se App Key não mudou. Nunca cadastrar segredo em descrição de orçamento ou enviar por chat. Nenhum acesso a `.env` é necessário para o administrador.

## Contrato da API LabLayer

Base: `/api/tenants/:tenantId/integrations/tiktokshop`. Rotas da base exigem Firebase Bearer token, empresa ativa e pertencimento vigente. Administradores configuram; membros ativos podem consultar anúncios. Superadministrador é reconferido no perfil persistido. Todas as respostas usam `Cache-Control: no-store`.

| Método / sufixo | Entrada | Resultado |
| --- | --- | --- |
| GET `/credentials` | — | Metadados, revisão, presença de segredo, estado e lojas sem cipher/tokens |
| POST `/credentials` | `appKey`, `appSecret`, `serviceId`, `expectedRevision` | Salva com CAS, criptografia e auditoria atômica |
| POST `/connect` | `expectedRevision` | URL de consentimento ROW e cookie seguro |
| POST `/select-shop` | `shopId`, `connectionId` | Reconsulta lojas do TikTok e vincula apenas uma loja BR autorizada |
| POST `/check` | `{}` | Confere autorização, renova token quando necessário e atualiza lojas |
| GET `/listings` | `?refresh=1` opcional | Anúncios normalizados e cobertura da consulta |

Callback público: GET `/api/integrations/tiktokshop/callback?code=...&state=...`. Não recebe tenant do cliente. Retorna 303 para Configurações; erros não ecoam código/segredo/resposta do provedor. Não há endpoint de webhook nesta entrega; a URL proposta no plano ainda não deve ser cadastrada como operacional.

Estados: `not-connected`, `select-shop`, `connected`, `reconnect-required`. `connected` confirma autorização e seleção de loja; não significa que escrita em anúncios ou sincronização de estoque estejam habilitadas. Sem conexão, `/listings` retorna `total: null`, `complete: false`, evitando apresentar ausência de autorização como zero produtos.

## Implementação e proteção

- `server/tiktok-client.ts`: hosts fixos, timeout de 15 segundos, redirects recusados, GET token/get e token/refresh, HMAC-SHA256, validação de identidade de vendedor `user_type=0`. Expirações são Unix timestamps absolutos em segundos, convertidos para milissegundos.
- Assinatura exclui `sign` e `access_token`, ordena parâmetros, concatena caminho/parâmetros/corpo e encapsula com App Secret. O corpo assinado é exatamente o corpo enviado. Access token segue apenas no header `x-tts-access-token` nas APIs de negócio.
- `server/tiktok.ts`: registro aditivo via `registerMarketplaceCredentialRoutes`, sem alteração do bootstrap e módulos do bot. Coleções privadas `privateTikTokCredentials`, `privateTikTokConnections`, `privateTikTokOAuthStates`, `privateTikTokOAuthAttempts` não têm acesso SDK do cliente, inclusive proprietário e superadministrador.
- Segredos/tokens usam AES-256-GCM, IV aleatório e AAD distinto por plataforma, empresa e finalidade; chave protegida já usada pelo cofre de marketplaces. Nenhum segredo, token ou cipher é enviado à tela ou auditoria. Não registrar URLs de troca/renovação de token, pois a API do TikTok exige segredo na query.
- Consentimento usa 256 bits de aleatoriedade, hash persistido, validade de 10 minutos, cookie `__Host-`, Secure, HttpOnly, SameSite=Lax; tentativa única e somente a mais recente por empresa. Permissões e revisão são verificadas antes da troca e antes do commit.
- Renovação sob lease transacional; falha incerta exige reconexão, sem repetir automaticamente refresh antigo. Tokens renovados são persistidos antes de consultar a loja. Mudanças de empresa, credencial, identidade ou conexão interrompem a resposta.
- Configuração, autorização, seleção, verificação e renovação deixam auditoria sem credenciais. Mutações remotas de produtos não estão expostas.

## Consulta de produtos

API externa `POST /product/202309/products/search`, páginas de 100, até 10 páginas, orçamento de 25 segundos entre páginas (uma chamada pode levar até mais 15 segundos). Cache de 60 segundos por empresa/conexão/revisão/loja, consultas simultâneas agrupadas e nova checagem de acesso antes da resposta. Cache/processamentos limitados a 100 entradas. Falha da plataforma gera erro; não é convertida em catálogo vazio. Paginação repetida, limite ou contagem divergente retornam cobertura parcial explícita. IDs continuam strings para preservar inteiros de 64 bits.

A consulta combina Mercado Livre e TikTok na tela, com falhas independentes e filtro por plataforma/status. TikTok não mostra botões de edição/publicação nesta fase. Search Products não entrega foto/link completo; esta etapa deixa esses campos vazios, sem inventar URL ou consultar detalhes de todos os itens.

Preço: exibir somente se todos os SKUs têm mesmo `sale_price` e moeda válida. Variações com preços diferentes aparecem como preço indisponível, explicadas na tela. Quantidade: somar pares únicos SKU/depósito válidos; dado ausente, duplicado ou inválido resulta em indisponível, nunca zero presumido. É a quantidade informada pelo canal, sem consolidação no estoque local.

## Validação e limites de homologação

Testes direcionados cobrem assinatura com vetor oficial, bytes do JSON, não vazamento de erros, criptografia por finalidade/tenant, permissões, CAS, segredo preservado, consentimento/browser/expiração/replay, troca concorrente de configuração, usuário de tipo incorreto, lojas estrangeiras, seleção explícita, refresh concorrente e incerto, persistência de tokens antes de falha, paginação/cache e revogação. Testes de interface cobrem segredo, navegação restrita, troca de empresa e independência dos canais. Regressão de credenciais/OAuth/listagem/ações do Mercado Livre incluída. Coleções privadas verificadas pelas regras reais no emulador.

Resultado local: 41 testes unitários/UI e 63 testes de integração/regras passaram (104 ao todo). TypeScript e build de produção aprovados. O build mantém o aviso de bundle principal acima de 500 kB, já presente antes desta etapa.

Ainda falta homologação com App Key/App Secret/Service ID reais e consentimento do vendedor: confirmar escopos efetivamente liberados, loja BR, primeira listagem e renovação. Não houve consulta à conta TikTok nem publicação real de produto nesta entrega. QA autenticado por navegador não foi executado; validação por testes de UI e HTTP/servidor.

## Referências oficiais conferidas

- [Authorization overview](https://partner.tiktokshop.com/docv2/page/authorization-overview-202407): domains, Service ID, grant types e expiração absoluta.
- [Sign your API request](https://partner.tiktokshop.com/docv2/page/sign-your-api-request): algoritmo e vetor oficial usado no teste unitário.
- [Get Authorized Shops](https://partner.tiktokshop.com/docv2/page/get-authorized-shops-202309): `seller.authorization.info`, lojas e cipher.
- [Search Products](https://partner.tiktokshop.com/docv2/page/search-products-202309): `seller.product.basic`, paginação, SKUs, preços e inventário.

Próxima etapa T2: homologar a conexão, adicionar perfil de publicação por canal, validar categorias/atributos/imagens/SKUs e criar rascunho com confirmação antes de publicar. Pedidos/webhooks/estoque seguem como T3, com idempotência e reconciliação.

## Publicação e conferência no servidor

Publicado em 23/10/2026 às 18:48 UTC (15:48 Brasília). Commit principal `04835d0`; release `ec804b4`. Backup em `/home/lablayer/deploy-backups/tiktok-ec804b4`. Implantação limitada aos módulos TikTok, registro em marketplace-credentials, normalização compartilhada e build; bootstrap, bot e dados existentes preservados. Assets antigos preservados para sessões abertas.

- Página pública HTTP 200; bundle `/assets/index-Cdr8Eqxk.js` contém a nova configuração TikTok.
- Credenciais/listagens sem autenticação: HTTP 401, `no-store`. Callback sem state: HTTP 303 para erro controlado, sem dados do provedor.
- Diagnóstico interno somente de leitura para a empresa do administrador: configuração HTTP 200, armazenamento protegido pronto, `hasSecret=false`, `not-connected`; anúncios TikTok sem conexão retornam `total=null`.
- Regressão real somente de leitura do Mercado Livre: 44 anúncios, 8 ativos, 35 pausados e 1 encerrado, 44 links/fotos; detalhes de cada estado com HTTP 200 e capacidades mantidas. Nenhuma ação comercial enviada.
- Hash SHA-256 do index publicado: `5e2dfbc9ad206627d1fabb22f131b33382994fcf0a2b99f13c8f4f748628a9b9`; módulos conferidos contra o pacote local.

A homologação externa do TikTok continua pendente das credenciais e autorização. Este resultado não afirma que a loja TikTok já esteja conectada.
