# Rascunhos de anúncios — 29/10/2026

O envio por chave fica separado da aprovação e da publicação. Nova aba em Vendas → Anúncios → Rascunhos para revisar, acessível também em `/?view=anuncios&tab=rascunhos`.

A chave `ll_drafts_…` é exclusiva da empresa, aceita somente leitura/criação/edição de rascunhos e é armazenada no servidor apenas por SHA-256. Não é uma chave administrativa genérica e não autentica no Mercado Livre. Aprovação e publicação exigem sessão de administrador ativo; alterações invalidam a aprovação. O servidor revalida a empresa, o responsável pela chave e sua revogação em cada operação. Chaves e rascunhos ficam nas coleções privadas de raiz sem permissões para clientes Firestore.

## API

Base: `https://app.lablayer.com.br/api/tenants/{tenantId}/listing-drafts`. Autenticação: `Authorization: Bearer {chave}`. JSON UTF-8.

- `GET /`: lista até 100; `nextCursor` pode ser enviado como `?after=…`.
- `POST /`: cria. `externalId` identifica o produto de forma idempotente: repetição dos mesmos dados não duplica; dados diferentes retornam 409.
- `GET /{id}`: consulta o rascunho e sua revisão.
- `POST /{id}/save`: substitui os dados usando `{ "revision": 1, "data": { ... } }`; só aceita rascunhos ainda não enviados. Retorna nova revisão e exige nova aprovação.
- `POST /{id}/actions`: somente sessão humana de administrador; ações `approve`, `publish`, `complete`, sempre com `revision`. A chave recebe 403.

```json
{
  "externalId": "chaveiro-001",
  "title": "Chaveiro personalizado em impressão 3D",
  "description": "Descreva material, dimensões, conteúdo e personalização.",
  "price": 25.90,
  "quantity": 10,
  "pictures": ["https://seu-dominio.com/foto.jpg"],
  "categoryId": "",
  "condition": "new",
  "listingTypeId": "gold_special",
  "attributes": [{"id":"BRAND","value_name":"LabLayer"}],
  "saleTerms": [],
  "shipping": {"mode":"me2","local_pick_up":false,"free_shipping":false}
}
```

Fotos são URLs HTTPS públicas (até 12). Agora também podem ser hospedadas na LabLayer por `POST /listing-drafts/photos`; use o `url` retornado no rascunho. Consulte `../api/anuncios.md` para o contrato de upload binário. Um anúncio simples por rascunho; não inclui variações, catálogo existente, kits ou vínculos com estoque do ERP. Título até 60 caracteres, descrição até 5000. Categoria e atributos dependem do produto. É possível enviar rascunho incompleto e concluir na revisão; a aprovação exige preço positivo, categoria, foto e descrição, além da validação do Mercado Livre. Clássico = `gold_special`; Premium = `gold_pro`. Não copie a categoria de exemplo de outro produto.

## Publicação

`approve` consulta `/users/me` e `/items/validate`, sem criar anúncio; em contas com `user_product_seller`, usa `family_name` em lugar de `title`. Armazena o conteúdo aprovado, revisão e identidade da conexão. A confirmação humana de publicação registra intenção antes de `POST /items`. A descrição é enviada separadamente conforme o contrato do provedor. Sucesso só após leitura de confirmação; o estado do anúncio (ativo/pausado/em análise) permanece visível.

Uma resposta incerta ao criar bloqueia nova criação automática. Com item retornado, o ID é persistido antes da descrição e `complete` só confere/completa esse mesmo item. Sem ID confirmado, é necessário conferir o anúncio na conta Mercado Livre antes de qualquer recuperação administrativa. Não há reenvio automático após timeout ou reinício. Repetir publicação já confirmada não cria outro item.

## Verificação e implantação

19 testes de interface/unidade e 33 testes de integração relacionados passaram (incluindo 11 novos cenários de rascunhos). Cobrem isolamento, revogação, falta de permissão, revisão concorrente, invalidação da aprovação, validação do provedor, User Products, clique duplo, timeout, descrição pendente e criação idempotente. `tsc` e build da base de produção conferidos. Publicação real no Mercado Livre não foi executada: chamadas externas de escrita foram simuladas nos testes.

Pacote montado a partir das fontes em produção, com alterações pontuais. A produção não continha a tela de Anúncios embora já tivesse suas rotas de servidor; adicionados menu, carregamento sob demanda, editor existente e navegação por `?view=anuncios`. Não foi copiado o App local completo nem alterado o contrato administrativo legado. Não há alteração de regras Firestore nem novas dependências.

Referências oficiais consultadas:
- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos
- https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/preco-variacao
- https://developers.mercadolivre.com.br/pt_br/tendencias/validador-de-publicacoes

Arquivo com chave e exemplo de uso fica fora do repositório, em `../acessos-anuncios/`, com permissões 0600. Para revogar, um administrador do servidor pode marcar `active: false` no documento correspondente em `privateMarketplaceDraftKeys/{SHA256(chave)}`. Nenhum segredo é incluído neste documento ou nos logs de auditoria.

## Resultado em produção

Release `listing-drafts-20261029` publicada: 15 arquivos conferidos e 92 fontes preservadas. A primeira tentativa reverteu automaticamente por tempo de inicialização; a segunda, com janela maior de saúde, confirmou HTTP 200 e hashes. Backup válido: `/home/lablayer/deploy-backups/listing-drafts-20261029-retry`.

Chave criada e verificada: leitura 200, validação de escrita 400 para corpo inválido, outra empresa 403, aprovação/publicação por chave 403 e API administrativa 401. Zero rascunhos de teste criados em produção e zero anúncios reais publicados. Evidências em `evidencias/anuncios-rascunhos-publicacao-20261029.json`; captura da confirmação usa dados fictícios locais.
