# API Administrativa do LabLayer — contrato E0

Contrato do código na branch de estabilização. Confirmar versão implantada antes de utilizar. As mudanças E0 restringem escrita genérica para preservar histórico e estoque.

## Autenticação e escopo

`ADMIN_API_TOKEN` é uma credencial técnica global. Chaves individuais em `LABLAYER_API_KEYS_JSON` são vinculadas a uma empresa e guardadas pelo hash SHA-256:

```json
[{"id":"integracao-01","tokenHash":"HASH_SHA256_HEXADECIMAL_64_CARACTERES","tenantId":"EMPRESA","actor":"integracao-01","active":true,"scopes":["customRequests:write","customRequests:ingest"]}]
```

Sem `scopes`, uma chave individual tem somente leitura. Escopos de escrita aceitos: `customRequests:write`, `suppliers:write`, `marketplaces:write`, `settings:write`. `customRequests:ingest` permite a entrada WhatsApp. Token técnico não contorna restrições de domínio.

Enviar `Authorization: Bearer TOKEN` ou `x-lablayer-admin-token: TOKEN`. Ator e keyId vêm da credencial autenticada. `x-lablayer-admin-actor` não é usado como autoridade. Empresa ausente retorna 404; inativa, 403.

## Leitura

- `GET /api/health`: disponibilidade HTTP, sem verificar Firebase.
- `GET /api/admin/health`: estado da API e banco configurado.
- `GET /api/admin/docs?format=markdown`: este contrato.
- `GET /api/admin/tenants/:tenantId`: empresa.
- `GET /api/admin/tenants/:tenantId/:collection`: lista, `limit` de 1 a 500.
- `GET /api/admin/tenants/:tenantId/:collection/:id`: documento.
- `GET /api/admin/tenants/:tenantId/audit-logs?limit=100`: últimas alterações.

Coleções legíveis: products, filaments, printers, supplies, orders, transactions, marketplaces, productionOrders, customRequests, losses, suppliers, inventoryMovements, failures e settings.

Filtros de listagem existentes continuam com janela máxima de 5.000 documentos antes do filtro local; não são busca completa em grandes bases. Valores calculados de produtos ainda usam o motor legado, pendente da E1.

## Escrita permitida

| Operação | Regra |
|---|---|
| POST na coleção | Cria; `id` opcional. ID existente retorna 409 e não sobrescreve. Usar ID estável nas tentativas de uma mesma criação |
| PATCH no documento | Só campos enviados; preserva todos os omitidos; array enviado substitui aquele array |
| PUT no documento | Substituição explícita, com validação integral e preservação de createdAt |
| DELETE | Suspenso (403); preservar histórico e usar arquivamento onde disponível |

POST/PUT/PATCH são permitidos somente em `customRequests`, `suppliers`, `marketplaces` e settings conhecidos. Produtos, filamentos, insumos, execução, vendas, perdas e movimentação precisam de comandos de negócio; escrita genérica nesses domínios retorna 403 até a etapa correspondente. Cadastros pela interface permanecem disponíveis conforme as regras do módulo.

Cada escrita valida o documento final e grava alteração + auditoria em uma transação. `createdAt` não muda em atualização; `updatedAt` é atribuído pelo servidor. Body inválido, campo desconhecido, número negativo/não finito, quantidade fracionada ou referência de outra empresa retorna 400. Números JSON devem ser números, não strings.

### Solicitações

Criação mínima:

```json
{"id":"solicitacao-001","title":"Chaveiros azuis","description":"50 unidades com logo"}
```

Somente na criação/PUT, campos omitidos recebem defaults de rascunho: type `orcamento`, status `aguardando-orcamento`, sourceChannel `manual`, quantidade 1, tempo 0, filamentos vazios e preços 0. Zero no rascunho significa entrada inicial, não custo homologado. A E1 tratará completude do cálculo.

Aliases aceitos: `name`→`title`; `observation`/`observacao`/`notes`→`description`; `referenceImageBase64`/`referenceImageDataUrl`→`referenceImageUrl`; equivalentes `quoteMediaImage*`→`quoteMediaImageUrl`. São removidos antes de persistir. Campo canônico explícito prevalece, inclusive vazio.

Exemplo de PATCH que mantém título, filamentos, preço e quantidade:

```json
{"status":"orcado"}
```

Status legados aceitos: aguardando-orcamento, orcado, fila-producao, produzindo, finalizado. Alterar status não cria produção/pagamento; os eventos de negócio serão entregues na E4. `filaments` tem até 50 itens: `filamentId`, `weightGrams` e opcionais `id`, `filamentName`. `printerId` e filamentos devem existir na mesma empresa.

Imagem via URL ou data URL permanece suportada; com Storage configurado, o servidor salva o arquivo e persiste a URL. Sem Storage, data URL pequena permanece inline. Limite do body JSON: 100 KB; multipart não é suportado. Upload não é transacional com Firestore: falha posterior pode deixar arquivo sem referência, a tratar na evolução de mídia. Campos de imagem ausentes no PATCH permanecem intactos.

### Outros cadastros

Fornecedores: name obrigatório; phone, address, notes e status opcionais. Canais: name obrigatório; commissionPercent, fixedFee, averageShipping, affiliateCommission, payoutDays e status opcionais. `updatedAt` desses cadastros é aceito também pelas rules do cliente.

Settings aceitos: `printer` (energyPrice) e `pricing` (failureRate, maintenancePerMonth, monthlyUsageHours, markup). A presença de `markup` no cadastro ainda não altera o multiplicador fixo do motor legado; E1 corrigirá essa divergência.

## Exportação paginada

`GET /api/admin/tenants/:tenantId/export?collections=products,filaments&limit=100`

Resposta: collections, nextCursors por coleção, hasMore e completeBackup=false. Para continuar, enviar `cursors` como JSON codificado na query. Na próxima chamada, selecionar em `collections` somente coleções que ainda têm cursor, para não repetir as já concluídas. Ordenação por ID; cada página tem no máximo 500 documentos por coleção. Alterações concorrentes não formam snapshot consistente.

Esse endpoint exporta coleções conhecidas, não subcoleções, empresa, perfis ou arquivos. Para cópia da árvore operacional e ensaio de restauração, consultar [E0](implementacao/etapa-e0.md) e `tools/tenant-backup.ts`.

## Entrada WhatsApp

`POST /api/public/tenants/:tenantId/custom-requests/whatsapp`

Exige chave com `customRequests:ingest` vinculada à empresa, ou **ambos** `WHATSAPP_INGEST_TOKEN` e `WHATSAPP_TENANT_ID` no servidor. Header `x-lablayer-webhook-token` ou Bearer. Sem configuração, 503; credencial/empresa incompatível, 401.

```json
{"eventId":"ID_ORIGINAL_DA_MENSAGEM","title":"Chaveiros azuis","customerName":"Cliente","requestedQuantity":10,"sourceMessage":"Gostaria de um orçamento"}
```

eventId estável é obrigatório. Mesma empresa/evento/conteúdo retorna o mesmo ID; conteúdo diferente retorna 409. Solicitação, recibo e auditoria são gravados juntos. Retransmissão após edição da solicitação não desfaz a edição. Somente rascunho aguardando orçamento; a entrada não aprova, cobra ou confirma pagamento.

O workflow n8n do repositório exige empresa, token e ID da mensagem. Ele ainda confirma recebimento do webhook antes da execução seguinte; monitorar falhas no n8n. Atualizar workflow/configuração junto da API. Não foi publicado automaticamente.

Rotas antigas de Mercado Livre, Shopee, Shopify e WooCommerce retornam 501: integração incompleta e sem sincronização. Nenhuma chamada externa ou gravação global é executada.

## Auditoria

`tenants/{tenantId}/auditLogs`: actor, keyId, action, collectionName, docId, createdAt e changedFields `{campo: {before, after}}`. Falha da transação não deixa alteração sem auditoria. Não representa ainda auditoria de todas as telas legadas.
