# API Administrativa do LabLayer

API protegida por token para acessar os dados do tenant sem expor a chave do Firebase.

Hoje o `ADMIN_API_TOKEN` é um token técnico e não fica vinculado sozinho a um usuário específico.
Para auditoria, envie também o header `x-lablayer-admin-actor` com o nome, email ou identificador da sessão que está fazendo a alteração.

## Autenticação

Configure a variável:

```env
ADMIN_API_TOKEN="seu_token_admin_aqui"
```

Envie o token em um destes formatos:

```http
x-lablayer-admin-token: seu_token_admin_aqui
```

ou

```http
Authorization: Bearer seu_token_admin_aqui
```

Header opcional recomendado para auditoria:

```http
x-lablayer-admin-actor: elvisbmartins@gmail.com
```

## Endpoints

### Health

```bash
curl https://app.lablayer.com.br/api/admin/health \
  -H "x-lablayer-admin-token: SEU_TOKEN"
```

### Tenant

```bash
curl https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID \
  -H "x-lablayer-admin-token: SEU_TOKEN"
```

### Listar uma coleção

```bash
curl "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/products?limit=50" \
  -H "x-lablayer-admin-token: SEU_TOKEN"
```

Filtros suportados:

- `q`
  busca geral por texto
- `name`
  busca por nome em `products`
- `color`
  busca por cor em `filaments`
- `title`
  busca por título em `customRequests`

Exemplos:

```bash
curl "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/products?name=chaveiro&limit=20" \
  -H "x-lablayer-admin-token: SEU_TOKEN"

curl "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/filaments?color=azul&limit=20" \
  -H "x-lablayer-admin-token: SEU_TOKEN"

curl "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/customRequests?title=pudim&limit=20" \
  -H "x-lablayer-admin-token: SEU_TOKEN"
```

### Criar um documento

```bash
curl -X POST "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/products" \
  -H "Content-Type: application/json" \
  -H "x-lablayer-admin-token: SEU_TOKEN" \
  -d '{
    "name": "Produto API",
    "category": "decoracao",
    "stock": 10
  }'
```

### Criar orçamento simples em `customRequests`

Você pode criar um orçamento só com nome e observação. A API completa o restante com defaults:

- `type`: `orcamento`
- `status`: `aguardando-orcamento`
- `requestedQuantity`: `1`
- `productionTimeHours`: `0`
- `filaments`: `[]`

```bash
curl -X POST "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/customRequests" \
  -H "Content-Type: application/json" \
  -H "x-lablayer-admin-token: SEU_TOKEN" \
  -d '{
    "title": "Chaveiros para SR Pudim",
    "observation": "Ele quer chaveiro de 5 cm na cor azul e manda a imagem da marca depois"
  }'
```

Também aceita `observacao`, `notes` ou `description`.

### Criar com ID fixo

```bash
curl -X POST "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/settings" \
  -H "Content-Type: application/json" \
  -H "x-lablayer-admin-token: SEU_TOKEN" \
  -d '{
    "id": "pricing",
    "markup": 2.2
  }'
```

### Ler um documento

```bash
curl https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/products/ID_DO_DOCUMENTO \
  -H "x-lablayer-admin-token: SEU_TOKEN"
```

### Substituir um documento inteiro

```bash
curl -X PUT "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/products/ID_DO_DOCUMENTO" \
  -H "Content-Type: application/json" \
  -H "x-lablayer-admin-token: SEU_TOKEN" \
  -d '{
    "name": "Produto Atualizado",
    "category": "decoracao",
    "stock": 25
  }'
```

### Atualizar parcialmente

```bash
curl -X PATCH "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/products/ID_DO_DOCUMENTO" \
  -H "Content-Type: application/json" \
  -H "x-lablayer-admin-token: SEU_TOKEN" \
  -d '{
    "stock": 12,
    "status": "ativo"
  }'
```

### Excluir um documento

```bash
curl -X DELETE "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/products/ID_DO_DOCUMENTO" \
  -H "x-lablayer-admin-token: SEU_TOKEN"
```

### Ler histórico de alterações

```bash
curl "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/audit-logs?limit=100" \
  -H "x-lablayer-admin-token: SEU_TOKEN"
```

### Exportar várias coleções

```bash
curl "https://app.lablayer.com.br/api/admin/tenants/SEU_TENANT_ID/export?collections=products,filaments,orders&limit=100" \
  -H "x-lablayer-admin-token: SEU_TOKEN"
```

## Coleções permitidas

- `products`
- `filaments`
- `printers`
- `supplies`
- `orders`
- `transactions`
- `marketplaces`
- `productionOrders`
- `customRequests`
- `losses`
- `suppliers`
- `inventoryMovements`
- `failures`
- `settings`

## Operações suportadas

- `GET` leitura de tenant, coleção, documento e exportação
- `POST` criação de documentos
- `PUT` substituição completa de documentos
- `PATCH` atualização parcial
- `DELETE` exclusão

## Histórico de alterações

As operações de `POST`, `PUT`, `PATCH` e `DELETE` geram auditoria em:

- `tenants/{tenantId}/auditLogs`

Cada item guarda:

- `actor`
- `action`
- `collectionName`
- `docId`
- `createdAt`
- `changedFields`

O campo `changedFields` salva apenas o que mudou, no formato:

```json
{
  "stock": {
    "before": 10,
    "after": 12
  },
  "status": {
    "before": "ativo",
    "after": "inativo"
  }
}
```
