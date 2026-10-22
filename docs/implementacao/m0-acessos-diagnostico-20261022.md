# M0 Acessos e diagnóstico dos marketplaces

Data: 22/10/2026. Status: **diagnóstico interno realizado; acessos externos pendentes**. Este documento acompanha o [plano de marketplaces](./plano-marketplaces-20261022.md). M0 ainda não está concluído: falta validar as contas por chamadas autenticadas somente de leitura.

## Atualização de configuração do Mercado Livre

Às 20:37:51 UTC de 22/10/2026, o App ID `2379102902840747`, informado pelo proprietário, foi gravado em `ML_CLIENT_ID` no arquivo `/var/www/lablayer/app/.env.production`. O identificador ainda não foi conferido no DevCenter. O usuário cadastrará o novo `ML_CLIENT_SECRET` diretamente no servidor; nenhum segredo enviado na conversa foi aplicado.

A gravação alterou somente `ML_CLIENT_ID`, com comparação contra alteração concorrente, substituição atômica e permissão `0600`. Cópia anterior protegida em `/home/lablayer/deploy-backups/m0-ml-clientid-20261022T203751Z/env.production.before`. Leitura posterior confirmou o ID e a preservação das demais configurações. Nenhum processo foi reiniciado: o valor está salvo para carregamento futuro, não ativado no processo atual.

Cadastrar o segredo não conclui a conexão. Antes de recarregar a configuração e iniciar OAuth, corrigir o callback conforme a seção Mercado Livre abaixo. Os resultados de credenciais vazias nas seções seguintes são a fotografia do diagnóstico anterior a esta gravação.

## Resultado por canal

| Canal | Evidência na LabLayer publicada | Conta e aplicativo externo | Decisão M0 |
| --- | --- | --- | --- |
| Mercado Livre | Cadastro de taxas ativo; credenciais vazias; callback incompleto; nenhum vínculo operacional encontrado no tenant | Titular, seller ID, país, app ID, permissões e logística pendentes | Pendente de acesso e implementação segura da autorização |
| Shopee | Partner ID e Partner Key vazios; início de autorização é uma simulação | Loja BR, categoria do app, aprovação, assinatura e contratos de produto/estoque pendentes | Pendente de acesso ao Open Platform; não homologada |
| TikTok Shop | Nenhum conector identificado; variáveis convencionais de app/token ausentes | Mercado BR, app, categoria, permissões e lojas autorizadas pendentes | Pendente de acesso ao Partner Center; não homologada |

Ausência de credenciais na LabLayer não comprova ausência de aplicativos nos portais dos fornecedores ou em outros serviços. Nenhum token de marketplace foi encontrado no escopo inspecionado; não houve tentativa de renovação nem chamada autenticada aos fornecedores.

## Evidências de produção

Conferência em 22/10/2026 às 20:26:57 UTC (17:26:57 em São Paulo), via SSH e consultas somente de leitura ao Firestore. Empresa vinculada à conta indicada pelo usuário; banco nomeado usado pelo servidor. Segredos foram usados apenas em memória para autenticar a leitura, sem inclusão nos resultados.

| Verificação | Resultado |
| --- | --- |
| Processo `lablayer-app` | Online |
| `APP_URL` do processo | Corresponde a `https://app.lablayer.com.br` |
| `ML_CLIENT_ID`, `ML_CLIENT_SECRET` | Vazios em `.env.production` e ausentes/vazios no processo e descendentes |
| `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` | Vazios em `.env.production` e ausentes/vazios no processo e descendentes |
| Variáveis convencionais de access/refresh token ML, access token Shopee, app key/secret/token TikTok | Ausentes/vazias no processo e descendentes; não constitui busca em todo o servidor |
| `inventoryControl/state` | Documento ausente; E3 interpreta ausência como `legacy` |
| `products` | 133 documentos legados |
| `customRequests` | 27 solicitações de orçamento |
| `catalogItems`, `stockBalances`, `stockEvents`, `salesOrders`, `channelConnections` | Zero documentos em cada coleção |

As contagens são de documentos, não de unidades físicas disponíveis. Saldo zero em `stockBalances` não significa ausência de estoque físico: o novo livro de estoque não foi aberto. Nenhum saldo deve ser publicado a partir dessas contagens.

A inspeção anterior das subcoleções do mesmo tenant encontrou `marketplaces` com um cadastro Mercado Livre contendo comissão, tarifa fixa, frete médio, comissão de afiliado, prazo de repasse e status `ativo`. Esse status pertence à configuração comercial, não à autorização OAuth. `settings` contém configuração de energia da impressora. Não foram encontrados campos de conexão nos dados da empresa nem coleções raiz com nomes de integração/configuração.

## Versões e diferença entre código e produção

Bases locais antes deste registro: `fix/estabilizacao-e0` em `9df5251`; checkout `release/users-b21` em `8ff6586`.

| Arquivo | Produção | Ramo de estabilização |
| --- | --- | --- |
| `server.ts` | SHA256 `b758b202c629c95b9635b6a374e64cfe14f15bc4d6e4983521b93d0cf94456a0` | SHA256 `6fc98b178f1b2adda8e6157e4f0ad846d36b0e4fe5c9743c801386df159abcd4` |
| `server/inventory.ts` | Ausente | Presente |
| `shared/catalog/model.ts` | Igual ao ramo de estabilização | SHA256 `48ebeef4cc9c4e281378a84c18334b7fe83f5ac10c87918e1bc4e44cc3984811` |
| `shared/pricing/engine.ts` | Igual ao ramo de estabilização | SHA256 `e9dae1d0c19383c14ee629268994c4ba24095e3c12f3ed5094cd54b3c5514eda` |
| Arquivo local `firestore.rules` | SHA256 `01c7fcaef63914083dda6b9a8a63f4d04f55be9d7dab5c7dbec71c1a6fa41f04` | SHA256 `efd65b5efb738c3bc33b0e7d52adb37d27c57d7b6424cccd18beb7b1ef98134e` |
| `package-lock.json` | Igual ao ramo de estabilização | SHA256 `96fd25f95a7d916a66305eaafeed791053e65988fbd8d43802ceeaf65ad2baa2` |

O hash das regras refere-se ao arquivo no servidor, **não certifica as regras efetivamente implantadas no serviço Firestore**. Conferir o ruleset ativo é pendência de M1. Arquivos de catálogo/cálculo iguais também não comprovam que todas as rotas e telas E0–E5 estejam publicadas.

No checkout de publicação, cujo `server.ts` coincide com produção:

- `server.ts:1319`: início OAuth do ML usa Client ID, sem vínculo de sessão/tenant por `state` nesse handler.
- `server.ts:1331`: callback registra o código recebido e redireciona com `status=ml_success`; não troca, persiste ou renova tokens e não consulta o vendedor.
- `src/views/Configuracoes.tsx`: rótulo “Desconectado” fixo, sem diagnóstico real.
- `server.ts:1342`: autorização Shopee retorna simulação.

No ramo de estabilização, `server.ts:821` bloqueia as integrações antigas com HTTP 501. M1 deve consolidar os ramos preservando bot, imagens, usuários e orçamentos recentes; publicar integralmente um deles sobre o outro não é uma estratégia de migração.

## Acessos e verificações para concluir M0

### Mercado Livre

1. Abrir o [DevCenter](https://developers.mercadolivre.com.br/devcenter) na conta proprietária da empresa e verificar se já existe aplicativo. Registrar identificador, titular, situação e unidade de negócio sem copiar segredos para a documentação.
2. Verificar separação entre aplicações Mercado Livre e Mercado Pago e permissões de usuários, publicação/sincronização e vendas/envios. Confirmar leitura, escrita necessária para as fases posteriores e acesso offline. Registrar PKCE se habilitado.
3. Preparar callback HTTPS estático. Candidato compatível com a rota existente: `https://app.lablayer.com.br/api/integrations/mercadolivre/callback`. **Não iniciar autorização para essa rota enquanto ela continuar incompleta.** Implementar troca e armazenamento protegido, `state` vinculado a sessão/tenant e remoção do log de código antes do consentimento.
4. Após autorização segura, consultar `GET /users/me`, conferir vendedor e país e inspecionar configuração do aplicativo. Ler anúncios e capacidades de logística para distinguir estoque próprio, Full e multiorigem/User Products. Registrar resultados saneados e horário.

O guia oficial exige correspondência do redirect URI e recomenda controle de sessão por `state`; também descreve refresh token substituído a cada uso. A existência do app não prova autorização da loja. Fontes: [guia in-house](https://developers.mercadolivre.com.br/devcenter/desenvolvimento-in-house) e [autenticação](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao).

### Shopee

1. Abrir o [Open Platform](https://open.shopee.com/), verificar Partner/App existente, titular, tipo de integração, região, ambiente e autorização da loja.
2. Conferir no API Reference acessível à conta o contrato vigente de identificação da loja, listagem/detalhe de pedidos, criação de produto, variações, imagens, preços e estoque. Registrar versão, permissões e restrições por operação; os nomes candidatos do plano ainda não são contratos homologados.
3. Com a autorização disponível, executar consulta de identificação da loja e listagem limitada de pedidos/produtos, sem persistir dados pessoais no relatório. Não ativar Push Mechanism até existir receptor durável.

O guia público de registro continuou retornando 403 à ferramenta de pesquisa nesta rodada. Isso limita a consulta documental; não comprova recusa de acesso à conta. O [guia oficial de pedidos](https://seller.br.shopee.cn/edu/article/16185) confirma listagem e configuração de notificações no Console > App Management > Push Mechanism. Os contratos de escrita seguem pendentes.

### TikTok Shop

1. Abrir o [Partner Center](https://partner.tiktokshop.com/), confirmar o enquadramento do aplicativo para a operação das próprias lojas, mercado BR e permissões liberadas.
2. Após autorização, consultar **Get Authorized Shops** e comparar a identidade com Seller Center; conferir produtos, depósito, logística e situação de acesso a dados fiscais necessários à operação.
3. Registrar as versões efetivamente disponíveis no app para produtos, pedidos e estoque. Conferir o caminho de nota fiscal/expedição antes de liberar venda integrada.

A documentação orienta validar a loja por Get Authorized Shops ([orientação oficial de onboarding](https://partner.tiktokshop.com/docv2/page/affiliate-integration)). Para o Brasil, conferir `need_upload_invoice` no [fluxo fiscal e de depósitos](https://partner.tiktokshop.com/docv2/page/br-market-updated-api-workflow-to-support-order-invoice-and-warehouse) e as limitações por categoria do app no [comunicado sobre dados de compradores](https://partner.tiktokshop.com/docv2/page/pgd9hfyy). Esses documentos não certificam as permissões desta conta.

## Registro de homologação por loja

Preencher com evidência observada, sem tokens, assinaturas, códigos OAuth, documentos fiscais ou dados pessoais de compradores:

| Campo | Mercado Livre | Shopee | TikTok Shop |
| --- | --- | --- | --- |
| Identidade da loja e país conferidos | Pendente | Pendente | Pendente |
| Aplicativo, titular e ambiente conferidos | Pendente | Pendente | Pendente |
| Permissões e validade da autorização | Pendente | Pendente | Pendente |
| Consulta autenticada de identidade | Não executada | Não executada | Não executada |
| Leitura limitada de anúncios/produtos | Não executada | Não executada | Não executada |
| Leitura limitada de pedidos | Não executada | Não executada | Não executada |
| Logística, depósito e estoque de terceiros | Pendente | Pendente | Pendente |
| Contratos para escrita futura | Conta a validar | Referência oficial a conferir | Conta a validar |
| Resultado | Pendente | Pendente | Pendente |

Um HTTP 200 isolado não conclui o teste: validar código de negócio do provedor, schema, identidade da loja, região e permissões. Uma lista vazia pode ser sucesso de leitura; não prova permissão de escrita. Se a conta não tiver acesso, registrar motivo e decisão de manter o canal desativado ou avaliar alternativa.

## Pendências e próximos passos

| Pendência | Responsável pela próxima ação | Dependência |
| --- | --- | --- |
| Informar apps existentes e disponibilizar portais autenticados | Proprietário das contas | Conferir acessos externos |
| Confirmar lojas BR, anúncios existentes, Full/estoque próprio/sob encomenda | Proprietário das contas | Escolher contratos e piloto |
| Implementar autorização segura e diagnóstico de conexão | Desenvolvimento | Antes de conectar ML na LabLayer; não usar callback atual |
| Validar contratos restritos da Shopee | Desenvolvimento com acesso ao console | Decidir viabilidade de M5 |
| Executar e registrar leituras autenticadas por loja | Desenvolvimento após autorização | Encerramento M0 |
| Conferir regras Firestore implantadas e ensaiar migração E2/E3 | Desenvolvimento e responsável pelos saldos | M1, antes de escrever estoque externo |

Perguntas de acesso e operação foram enviadas ao usuário. Na inspeção das abas disponíveis ao agente havia somente LabLayer; nenhum portal de marketplace estava disponível para conferência autenticada.

## Qualidade e limites desta entrega

Verificados: processo publicado, presença de configuração sem revelar valores, hashes dos arquivos, estado de migração e contagens por coleção. Resultado coerente entre código publicado e dados legados. Revisar links locais e `git diff --check` antes do commit.

Esta entrega altera documentação, não runtime. Não houve implantação, criação de aplicativo, renovação de token, anúncio, pedido, movimentação de estoque ou envio ao cliente. Não foram executadas as suítes E0–E5: não houve mudança funcional a testar. A regressão de consolidação continua obrigatória em M1.

## Cadastro pela interface disponibilizado

Atualização posterior ao diagnóstico: [cadastro protegido de credenciais ML pela interface](./mercado-livre-credenciais-ui-20261022.md) publicado. O proprietário não precisa editar `.env`: administradores cadastram o segredo em Configurações > Integrações > Mercado Livre. O App ID está preenchido na empresa. O callback simulado foi bloqueado, e o cofre por tenant está preparado; autorização OAuth e consultas à loja continuam pendentes. As tabelas anteriores representam a fotografia anterior à publicação.
