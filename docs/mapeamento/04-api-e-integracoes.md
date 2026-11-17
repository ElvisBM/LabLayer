# API e integrações existentes no LabLayer

Esta referência descreve as rotas encontradas em `server.ts`, sem chamá-las em produção. A existência de uma rota não comprova que credenciais, implantação ou serviços externos estejam operacionais.

## API administrativa

Fonte: [server:632](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:632), [documentação existente](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/admin-api.md).

Autenticação por `x-lablayer-admin-token` ou `Authorization: Bearer`. Aceita token técnico global e chaves individuais configuradas por hash SHA-256, tenant, ator e estado. Chave individual ativa tem tenant validado contra o parâmetro da rota; token global tem alcance entre empresas. Sem nenhuma chave configurada, as rotas protegidas retornam 503; credencial inválida retorna 401; tenant divergente retorna 403.

O contexto da chave é colocado em `res.locals.apiAccess`, mas o ator registrado no log é resolvido separadamente pelo header `x-lablayer-admin-actor` ou pelo texto `api-token`. O ator declarado na chave individual não é usado pelo escritor de auditoria.

| Método e rota | Comportamento |
|---|---|
| `GET /api/health` | Resposta pública de saúde básica |
| `GET /api/admin/health` | Saúde administrativa, disponibilidade de db e coleções |
| `GET /api/admin/docs` | Lê o arquivo Markdown existente; `format=markdown` retorna texto, padrão retorna JSON com conteúdo |
| `GET /api/admin/tenants/:tenantId` | Documento principal da empresa; 404 se ausente |
| `GET /api/admin/tenants/:tenantId/export` | Exporta coleções permitidas, padrão todas; limite por coleção |
| `GET /api/admin/tenants/:tenantId/audit-logs` | Logs ordenados por createdAt decrescente |
| `GET /api/admin/tenants/:tenantId/:collectionName` | Lista; limite padrão 100, máximo 500 |
| `GET /api/admin/tenants/:tenantId/:collectionName/:docId` | Documento individual |
| `POST /api/admin/tenants/:tenantId/:collectionName` | Cria ID aleatório, ou usa ID fornecido; com ID existente sobrescreve usando `merge:false` |
| `PUT /api/admin/tenants/:tenantId/:collectionName/:docId` | Exige documento existente e substitui; preserva createdAt anterior quando não enviado |
| `PATCH /api/admin/tenants/:tenantId/:collectionName/:docId` | Exige existente; normaliza payload antes do merge; risco específico em customRequests |
| `DELETE /api/admin/tenants/:tenantId/:collectionName/:docId` | Exige existente; exclui apenas o documento alvo |

As 14 coleções permitidas são products, filaments, printers, supplies, orders, transactions, marketplaces, productionOrders, customRequests, losses, suppliers, inventoryMovements, failures e settings. Não há endpoint de aprovar orçamento, concluir produção, registrar consumo, estornar venda ou recalcular custo com validação de negócio no servidor.

### Busca e exportação

Fonte: [server:508](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:508), [server:811](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:811).

`q` busca texto; `name` filtra produtos, `color` filamentos e `title` solicitações. Normaliza acentos, caixa e espaços externos, usando correspondência parcial. Quando há filtro, carrega até 5.000 registros antes de filtrar e limitar a resposta; não há cursor, total global ou indicação de registros além dessa janela. Sem filtro, já limita a consulta. A exportação limita cada coleção a até 500, sem paginação, e não inclui `auditLogs` na lista padrão.

Leitura de produto acrescenta `apiComputedPricing`, com custo, sugestão, faixas e fonte do preço resolvido. Isso não é persistido automaticamente. Exportação retorna dados armazenados, sem enriquecimento. O cálculo usa os cadastros atuais e as variações persistidas; não faz a reconstrução de mesas que a tela de produtos executa.

Precedência de preço resolvido: preços positivos em `channelPrices`; depois sugestões calculadas de variações; depois último preço sugerido positivo; por fim indisponível. Sem variações, custo fixo pode gerar sugestão escalar, mas não preencher a faixa nem o preço resolvido. Cenário C24.

### Escrita e auditoria

Fonte: [server:897](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:897).

O corpo precisa ser objeto JSON; o ID do corpo é removido do conteúdo. A API não valida o schema completo de cada coleção, existência do tenant pai, referências ou transições. Preços fornecidos em solicitações são apenas normalizados, não recalculados pelo motor.

POST, PUT, PATCH e DELETE gravam log com diferenças de campos, usando comparação por JSON. Gravação do documento e do log são operações separadas. Se a auditoria falhar após a primeira escrita, o cliente recebe erro embora o registro possa ter sido alterado. Não há chave de idempotência ou controle de versão. POST com ID fixo usa ação “create” e compara com documento vazio mesmo ao sobrescrever algo existente.

**PATCH de solicitações não preserva a semântica parcial:** `normalizeCustomRequestPayload` preenche título vazio, arrays vazios, quantidade 1, preços zero e outros defaults antes do merge. Também pode produzir `createdAt: undefined`. A reprodução C13 confirma o payload; a resposta HTTP exata depende do SDK/configuração de serialização, não exercitados contra banco. Mesmo removendo o undefined, os defaults podem substituir conteúdo existente que não foi enviado.

### Imagens

Fonte: [server:260](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:260).

Aceita URL ou data URL nos pares `referenceImage*` e `quoteMediaImage*`, com aliases Base64/DataUrl. Para upload, o formato reconhecido é `data:image/...;base64,...`; base64 puro não satisfaz a expressão. O servidor salva no Storage e retorna URL com token quando há bucket disponível. Sem bucket, retorna o próprio data URL, diferentemente da promessa de upload incondicional na documentação antiga.

Aliases de imagem são removidos do payload final. O resolvedor prioriza Base64, DataUrl e URL, escolhendo a primeira string presente, mesmo vazia. Não há multipart. O servidor usa `express.json()` sem limite customizado; o limite efetivo do pacote deve ser considerado ao enviar imagens grandes. Esse limite não foi medido nesta auditoria. A tela, por sua vez, aceita arquivo de até 1 MiB e persiste base64 no Firestore; as duas rotas têm contratos de tamanho/armazenamento diferentes.

## WhatsApp e n8n

Fonte: [webhook:1180](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:1180), [workflow local](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/n8n/whatsapp-orcamentos.workflow.json).

Rota: `POST /api/public/tenants/:tenantId/custom-requests/whatsapp`.

O endpoint cria uma solicitação com origem WhatsApp; defaults são orçamento aguardando cálculo, quantidade 1, tempo zero, impressora vazia, filamentos vazios e custo/sugestão zero. Título e descrição têm fallbacks para cliente e mensagem. Não calcula orçamento nem interpreta mensagem com modelo de IA. Cada chamada gera novo ID. Não há deduplicação por ID de mensagem nem agrupamento por conversa.

O token de ingestão é exigido apenas se `WHATSAPP_INGEST_TOKEN` estiver configurado. Sem essa variável, a rota aceita gravação sem autenticação própria. O token é global, sem vínculo a um único tenant. Esses são comportamentos do código, não confirmação da configuração pública atual.

O workflow possui três nós: webhook, código de normalização e HTTP para LabLayer. Filtra ausência de remetente, grupos, status broadcast, mensagens próprias e eventos fora da lista. Extrai telefone, nome, texto/caption e URL de mídia. Define tenant fixo dentro do nó e envia título com trecho inicial da mensagem. Não preserva um identificador externo para evitar duplicação. Não envia resposta, proposta ou pedido de aprovação ao cliente.

Há suporte no código de servidor a aliases de imagem, porém o workflow envia apenas `referenceImageUrl`. Mídias de provedores podem exigir autenticação ou transformação; isso não foi validado externamente.

## Integrações comerciais

Fonte: [server:1295](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:1295), [Configuracoes](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Configuracoes.tsx:1), [Vendas:139](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Vendas.tsx:139).

| Integração | O que o código faz | O que ainda não foi implementado nesse caminho |
|---|---|---|
| Mercado Livre | Monta URL de autorização; callback lê/loga code e redireciona com status de sucesso | Troca por token, renovação, vínculo com tenant, ingestão de pedidos e sincronização de estoque/preço |
| Shopee | Verifica configuração e devolve texto de simulação | Assinatura, autorização efetiva, callback funcional, importação e gestão de anúncios |
| Shopify | Webhook loga corpo e retorna OK; formulário existe | Validação de assinatura, persistência em orders e salvamento de credenciais da tela |
| WooCommerce entrada | Persiste payload bruto em coleção global pelo ID externo | Validação de assinatura, separação de lojas/tenant, conversão em venda, custos e estoque |
| WooCommerce saída | Faz POST em products da loja configurada no servidor | Atualização por ID, deduplicação, vínculo com produto local, autenticação própria da rota e isolamento por tenant |
| Sincronização em Vendas | Timer e alerta para configurar tokens | Chamada de integração real ou persistência dos tokens digitados |
| Importação CSV | Exibe modal | Seleção/processamento de arquivo, mapeamento, validação e gravação |

O comentário da saída WooCommerce fala em criar/atualizar, mas o caminho executado é criação via POST. Repetir pode criar duplicatas externas. Nenhuma dessas rotas foi chamada durante o levantamento.

## Site e lista de espera

Fonte: [Site App:91](/Users/PCNOTES/Workspace/3D/lablayer/SiteLabLayer/src/App.tsx:91), [Apps Script](/Users/PCNOTES/Workspace/3D/lablayer/SiteLabLayer/google-apps-script/waitlist.gs:1).

O site envia nome, email, WhatsApp, empresa, origem e data para uma URL de Apps Script configurável, com fallback no código. O script acrescenta linha à aba Lista de Espera. Não deduplica contatos, cria conta, libera trial ou integra cobrança.

O navegador usa `mode:no-cors` e sinaliza sucesso quando fetch resolve, sem ler a confirmação de gravação. O script pode retornar `success:false` sem que a tela distinga esse caso. A integração foi inspecionada por código, sem submissão real.
