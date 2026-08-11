# API Administrativa do LabLayer

API protegida por token para acessar os dados do tenant sem expor a chave do Firebase.

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
