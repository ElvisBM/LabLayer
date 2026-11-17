# Dados e permissões do LabLayer

O armazenamento é documental. A interface usa Firebase diretamente; o servidor usa Firebase Admin. Os tipos TypeScript descrevem formatos esperados, mas não são um contrato de validação executado sobre todos os documentos.

## Estrutura e responsabilidade

| Coleção | Unidade de registro | Campos e estruturas de negócio | Escritores localizados |
|---|---|---|---|
| `users` | Usuário autenticado | email, role, tenantId, tenantRole, createdAt | Inicialização de autenticação |
| `tenants` | Empresa | ownerUid, ownerEmail, companyName, plan, status, createdAt | Autenticação; administrador global |
| `products` | Produto/ficha, também rotulado encomenda ou orçamento | name, baseSku, category, productType, status, fixedCost, stock, imageUrl, technicalSheet, variations, productionTables, supplyUsages, wastes, files, pricingHistory, latestSuggestedPrice | Produtos; conclusão da agenda; simulador; valores sugeridos; API |
| `filaments` | Material/cor com compras agregadas | material, color, colorHex, brand, lineType, diameter, pricePerKg, stockKg, initialStockKg, purchaseDate, store, supplierId, purchaseHistory | Filamentos; edição/exclusão de produtos; API |
| `supplies` | Insumo com saldo atual | name, category, quantity, unit, costPerUnit, minStock, purchaseDate, createdAt | Insumos; produtos; API |
| `printers` | Impressora | name, model, acquisitionCost, lifespanHours, maintenanceBudget, powerConsumption, usedHours, purchaseDate, status | Impressoras; exclusão de produtos; API |
| `suppliers` | Fornecedor | name, phone, address, notes, status | Fornecedores; API |
| `marketplaces` | Canal e parâmetros | name, commissionPercent, fixedFee, averageShipping, affiliateCommission, payoutDays, status | Canais; API |
| `customRequests` | Solicitação de orçamento ou encomenda | title, description, type, status, sourceChannel, customerName/Phone, sourceMessage, requestedQuantity, productionTimeHours, printerId, filaments, mídias, custos/preços, datas dos marcos | Solicitações; API; webhook WhatsApp |
| `productionOrders` | Ordem com mesas | productName, productId opcional, modelUrl, status, tables, notes, createdAt, completedAt; campos legados | Agenda; API |
| `orders` | Venda simplificada de um produto | orderNumber, date, productName, channelName, cliente, status, quantity, soldPrice, fees, realCost, realProfit | Vendas; API |
| `transactions` | Lançamento financeiro manual | date, description, type, category, amount, status | Financeiro; API |
| `losses` | Registro de perda | date, type, weightGrams, filamentId, filamentName, cost, notes, productId/variationId opcionais | Criação/exclusão de produto; exclusão na tela de perdas; API |
| `inventoryMovements` | Movimento declarado | date, filamentId, filamentName, type, amount, reason, createdAt | API; há validador, mas não produtor/consumidor operacional nas telas |
| `failures` | Falha declarada | date, productName, printerName, type, materialLost, timeLost, financialLoss, createdAt | API; não ligada ao percentual de falha ou ao painel de perdas |
| `settings` | Documento de configuração | `printer.energyPrice`; `pricing.failureRate`, `maintenancePerMonth`, `monthlyUsageHours` | Impressoras; simulador; API |
| `auditLogs` | Alteração pela API administrativa | actor, action, collectionName, docId, createdAt, changedFields | Servidor, após gravação do documento |
| `integrations_woo_orders` | Payload bruto de pedido WooCommerce | Payload externo e lablayer_synced_at | Webhook; coleção global, fora de tenants |

As coleções de negócio, de `products` a `auditLogs`, ficam sob `tenants/{tenantId}`. `users`, `tenants` e `integrations_woo_orders` ficam na raiz. Fontes: [interfaces de produtos](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/src/views/Produtos.tsx:72), [coleções da API](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/server.ts:106), [regras Firestore](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/firestore.rules:1).

## Estruturas internas importantes

| Estrutura | Campos essenciais | Semântica atual |
|---|---|---|
| `variations[]` | id, skuSuffix, color, material, materials, weightGrams, printTimeHours, quantityPerPrint, filamentId, printerId, materialCostPerGram, printerCostPerHour, channelPrices | Mistura receita de fabricação, produção informada e preço de venda |
| `materials[]` | id, filamentId, weightGrams, purgeGrams, objectName, pieces, printTimeHours, startTime, endTime | Peso por impressão no custo; pieces também influencia consumo inferido e estoque |
| `productionTables[]` | id, tableName, scheduledAt, startAt, endAt, hours, productsCount, filaments | Mesas incorporadas ao produto; agenda tem estrutura semelhante, sem os mesmos campos de início/fim |
| `productionTables[].filaments[]` | id, filamentId, filamentName, quantityKg | Consumo total declarado da mesa; contador legado pode existir |
| `supplyUsages[]` | id, supplyId, supplyName, quantityPerProduct, unit | Consumo por produto completo |
| `wastes[]` | id, filamentId, weightGrams, includeInCost, notes | Sempre consome estoque; opcionalmente entra no custo, inteiro por unidade |
| `channelPrices[]` | channel, price, feePercentage | Nome livre de canal, não chave obrigatória de marketplace |
| `purchaseHistory[]` | id, quantityKg, pricePerKg, purchaseDate, store, supplierId | Compras editáveis dentro do filamento |
| `pricingHistory[]` | id, savedAt, variationId, variationLabel, channelId/Name, targetType/Value, suggestedPrice, cost, profit, margin | Até 50 registros no simulador; recalculáveis posteriormente |

Não existe entidade separada de lote, reserva, cliente, aprovação, recebimento, conta a pagar, item de pedido, devolução ou versão de orçamento. Ausência no modelo local não comprova ausência de processos manuais externos.

## Relações e integridade

- Filamentos e impressoras são referenciados por ID nas variações; filamentos também em mesas, solicitações e perdas.
- Produtos referenciam insumos por ID e arquivos por URL. A agenda usa ID opcional e fallback por nome.
- Vendas persistem apenas nomes de produto/canal. Renomear um cadastro não atualiza pedidos anteriores; nomes iguais se agregam no painel.
- Aprovação, produção e venda não compartilham uma cadeia obrigatória de IDs. Datas e estados de uma solicitação não são prova de execução nas outras coleções.
- Não há validação geral de referências existentes, unicidade de SKU ou número de pedido, nem exclusão em cascata uniforme. A proteção contra excluir filamento é específica da tela.
- Há sobreposição de conceitos: `products.productType=orcamento` e `customRequests.type=orcamento` são registros independentes, com efeitos diferentes sobre estoque.

## Validações Firestore

Fonte: [validadores:78](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/firestore.rules:78), [permissões:320](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/firestore.rules:320).

“Número positivo” no nome da função significa **maior ou igual a zero**. Não exige inteiro. Campos adicionais são proibidos quando há `hasOnlyAllowedFields`; produtos e settings são exceções relevantes.

| Entidade | Exigências principais | Limites e lacunas |
|---|---|---|
| Produto | name e status; nome 1–100; SKU até 50 | Não valida números, arrays internos ou tipo do produto; não restringe lista total de campos |
| Filamento | material, color, pricePerKg, stockKg; números não negativos | Material até 50, cor até 100, loja/fornecedor até 100; histórico interno não validado; `minStockKg` não consta na lista permitida |
| Insumo | name, quantity, unit, costPerUnit, createdAt | Nome até 100, unidade até 20; quantity/cost não negativos; mínimo e categoria não recebem validação completa |
| Impressora | nome, modelo, aquisição, vida útil, manutenção, potência, createdAt | Nome até 100; vida útil zero é permitida; status limitado a três valores; números não negativos |
| Fornecedor | name | Nome até 100, telefone 30, endereço 300, notas 500; status ativo/inativo |
| Marketplace | name e createdAt | Nome até 50; taxas não negativas, mas comissão não limitada a 100%; payoutDays não exige inteiro |
| Venda | Todos os campos financeiros essenciais, nomes, estado e createdAt | Quantidade pode ser zero/fração; lucro pode ser negativo; não exige lucro = preço − taxas − custo |
| Transação | Todos os campos declarados | Descrição até 200, categoria até 50, valor não negativo, estado pago/pendente |
| Produção | productName, status, createdAt | Nome até 100; notas 500; modelo URL 500; arrays precisam apenas ser listas; não valida valores das mesas |
| Solicitação | title, type, status, requestedQuantity, productionTimeHours, filaments, updatedAt | Título 150, descrição 5000, mensagem 10000, cliente 150, telefone 50; quantidade zero permitida nas regras, embora tela normalize para 1; listas internas não validadas |
| Perda | date, type, weightGrams, filamentId, filamentName, cost | Peso/custo não negativos; notas 500; não valida vínculo com consumo real |
| Movimento | date, filamentId/Name, type, amount, reason, createdAt | entrada/saida/ajuste; amount não negativo; unidade não explicitada no contrato |
| Falha | Todos os campos declarados | materialLost/timeLost/financialLoss não negativos; unidade de materialLost não especificada |
| Settings | Acesso de membro | Sem schema de valores |

Na atualização, várias coleções preservam `createdAt`; produtos, filamentos, fornecedores e solicitações fazem essa exigência apenas quando o documento anterior já tem a data. Datas são strings, geralmente sem validação de formato ou sequência.

O validador `isValidTenant` existe, mas não é chamado pelas permissões de criação/atualização de tenant. Portanto, suas restrições declaradas não são as restrições efetivas dessas operações.

## Controle de acesso efetivo

Um membro é o usuário cujo UID coincide com o tenant ou cujo perfil `users/{uid}.tenantId` aponta para ele. Esse membro pode ler, criar, atualizar e excluir os registros das coleções operacionais, sujeito aos validadores. `tenantRole` não separa leitor, operador, aprovador ou financeiro. O administrador global pode listar e alterar tenants, mas as regras das subcoleções não concedem automaticamente acesso global fora da condição de membro.

**Divergência crítica de autorização no código local:** o próprio usuário pode criar/atualizar seu documento `users` sem proteger `role` e `tenantId`. Esses mesmos campos concedem acesso de membro e administrador. Isso permite alteração indevida de privilégios se essas regras estiverem implantadas. A leitura estática confirma a combinação permissiva; não foi feito teste de exploração em produção.

O estado `inactive`/`past_due` do tenant não participa da condição de membro. O dono também pode alterar campos do tenant mantendo ownerUid e createdAt, sem restrição específica a plano/status nessa regra. O efeito de “inativar empresa” na administração não é um bloqueio de uso implementado.

## Compatibilidade entre API e navegador

A API usa Admin SDK e não aplica os validadores Firestore aqui descritos. Ela acrescenta `updatedAt` a qualquer coleção. Esse campo não está na lista permitida de impressoras, filamentos, fornecedores, insumos, canais, vendas, transações, produção, perdas, movimentos e falhas. Um documento criado ou alterado pela API pode ser lido, mas sua edição normal pelo navegador pode ser recusada porque o campo extra continua no documento resultante.

Solicitações permitem `updatedAt`, porém a normalização da API preserva aliases como `observation`, `observacao`, `notes` e `name`; esses campos não são permitidos no documento de solicitação pelas regras. É outra incompatibilidade entre o contrato divulgado e a edição posterior pela tela.

Não há regra de leitura de `auditLogs` pelo navegador; a leitura implementada é via API administrativa. A auditoria não cobre as gravações diretas das telas nem o webhook de WhatsApp.
