# TikTok Shop no LabLayer

Pesquisa de viabilidade e plano de integração, conferidos em 23/10/2026.

É viável centralizar produtos à venda, edição, ativação/desativação, pedidos e estoque do TikTok Shop no LabLayer. A liberação depende da loja brasileira, aplicativo e permissões concedidas no Partner Center. A conta do usuário ainda não foi autorizada nem homologada nesta investigação. O cadastro de produtos e a operação da loja são a primeira entrega proposta; publicidade paga é um módulo separado.

## Situação do LabLayer

O código atual já tem a etiqueta TikTok Shop no menu Anúncios, mas mostra integração pendente. Não há conector TikTok no backend inspecionado. Mercado Livre tem OAuth, consulta e ações próprias; esses padrões podem orientar a nova integração, porém os contratos não são intercambiáveis.

Pontos a reutilizar: autenticação por tenant, credenciais protegidas no servidor, autorização administrativa para alterações, auditoria, revisão antes do envio e tratamento de resultado incerto. Pontos a acrescentar: credenciais e tokens próprios do TikTok, assinatura, identificação da loja/depósito, estados de moderação, categorias e atributos, SKUs remotos e processamento persistente de eventos.

O catálogo local ainda precisa de um perfil de publicação por canal: categorias externas, atributos obrigatórios, fotos de venda, peso/dimensões da embalagem, preço por canal, unidade comercial e vínculo SKU/depósito. Os módulos novos de catálogo/estoque da branch principal não devem ser presumidos ativos em produção: validar a migração antes de sincronizar saldos.

## Modelos de anúncio e venda

| Modelo | O que significa | Entrega proposta |
| --- | --- | --- |
| Produto na loja | Ficha com título, fotos, descrição, preço, variantes e disponibilidade | Primeira integração, no menu Anúncios |
| Produto com variantes | Mesmo produto com SKUs distintos, por exemplo cor e tamanho | Após produto simples, com vínculo por SKU e estoque |
| Kit físico | Uma unidade comercial contendo várias peças | Definir SKU do kit e consumo de componentes; validar categoria e campos da loja |
| Personalizado ou sob encomenda | Exige prazo de fabricação e condições aceitas pelo canal | Fora do primeiro piloto; não assumir disponibilidade brasileira de recursos de pré-venda ou made-to-order anunciados para outros mercados |
| Vídeo/foto com produto vinculado | Conteúdo que leva à ficha de produto | Fase posterior; confirmar APIs, identidade/autorização e disponibilidade brasileira |
| Live com produtos | Venda ligada a uma transmissão | Fase posterior; transmissão e elegibilidade não decorrem da autorização de catálogo |
| Campanha paga | Investimento em divulgação da loja/produtos | Outro conector: TikTok API for Business e conta de anúncios |

Para mídia paga, a documentação diferencia Video Shopping Ads, LIVE Shopping Ads e Product Shopping Ads e direciona a criação de Shop Ads ao GMV Max. A API for Business lista criação e atualização de campanhas GMV Max. Portanto, é tecnicamente uma evolução possível, mas não deve ser prometida como consequência de conectar a loja. [TikTok Shop Ads](https://ads.tiktok.com/resources/help/article/set-up-tiktok-shopping?lang=en), [API for Business](https://business-api.tiktok.com/gateway/docs/index?doc_id=1751454172429314).

## Operações confirmadas e limites

| Função | Evidência oficial | Aplicação no LabLayer |
| --- | --- | --- |
| Criar produtos | Guias de integração contemplam criação por API e APIs de produtos | Formulário próprio; payload e versão efetiva a conferir no API Reference da aplicação BR |
| Listar produtos/SKUs | Search Products | Acrescentar linhas com tag TikTok Shop, paginação e reconciliação |
| Editar | Edit Product e Partial Edit Product | Enviar somente campos intencionalmente alterados; preço/estoque omitidos permanecem como estão |
| Publicar/reativar | Activate Products, v202309, POST `/product/202309/products/activate` | Pode passar para PENDING; só mostrar ativo após aprovação |
| Despublicar | Deactivate Products, v202309, POST `/product/202309/products/deactivate` | Ocultar produto ativo; não confundir com apagar definitivamente |
| Atualizar estoque | Update Inventory, POST `/product/202309/products/{product_id}/inventory/update` | Saldo por SKU e depósito, tratando erros de cada linha |
| Pedidos | Order List, Order Detail e Order Status Webhook | Importação, reserva, pagamento, cancelamento e expedição |

Fontes: [integração e produtos](https://partner.tiktokshop.com/docv2/page/affiliate-integration), [Search Products](https://partner.tiktokshop.com/docv2/page/search-products-202309), [edição parcial](https://partner.tiktokshop.com/docv2/page/price-and-inventory-is-optional-when-editing-products), [ativação](https://partner.tiktokshop.com/docv2/page/activate-products-202309), [desativação](https://partner.tiktokshop.com/docv2/page/deactivate-products), [estoque](https://partner.tiktokshop.com/docv2/page/update-inventory), [pedidos](https://partner.tiktokshop.com/docv2/page/order-api-overview).

Os escopos exibidos nas referências consultadas incluem `seller.product.basic` para ativação/desativação e `seller.product.write` para inventário. A matriz completa de leitura, criação, pedidos, logística e eventos será registrada por endpoint no console; não inferir acesso de escrita pelo nome de um escopo ou apenas pelo sucesso do OAuth.

A documentação mostra respostas com `code: 0` e erros dentro de `data.errors`. O conector deve inspecionar esses erros por produto/SKU/depósito e confirmar o estado remoto. Um lote parcialmente recusado não pode aparecer como concluído integralmente. [Update Inventory](https://partner.tiktokshop.com/docv2/page/update-inventory).

As versões são por operação. Não fixar todo o conector em 202309 nem copiar contratos antigos `/api/products/...` como se fossem os atuais. A referência de criação integral não foi entregue pelo navegador textual em todas as URLs públicas; o formulário proposto abaixo é uma especificação do LabLayer, não um payload homologado. [Versionamento](https://partner.tiktokshop.com/docv2/page/api-versioning).

## Acessos necessários

1. Loja brasileira ativa no Seller Center, com responsável apto a autorizar aplicativos e depósitos de envio/devolução configurados.
2. Conta de desenvolvedor no [TikTok Shop Partner Center](https://partner.tiktokshop.com/), para o mercado e tipo de vendedor corretos.
3. Aplicativo com API habilitada, App Key, App Secret, identificação/link de autorização do serviço e permissões necessárias.
4. Redirect HTTPS e endpoint de webhooks implementados; autorização da loja, troca/renovação de tokens e consulta das lojas autorizadas.
5. Identificação de `shop_id`, `shop_cipher`, depósitos, scopes realmente concedidos, categorias disponíveis e acesso de produção.

Para apenas a própria loja, avaliar **Seller in-house developer / custom app**. Para o LabLayer atender outras empresas vendedoras, avaliar **Connector**, com revisão aplicável. Custom não implica dispensa universal de revisão; o próprio Partner Center determina exigências conforme categoria, mercado e escala. A categoria escolhida não pode ser alterada depois. [Categoria do app](https://partner.tiktokshop.com/docv2/page/hulvi36o), [revisão](https://partner.tiktokshop.com/docv2/page/app-review-process).

A criação do app configura mercado, tipo de vendedor, scopes, redirect e webhook. O fluxo de vendedor é distinto de creator/afiliado. Tokens e assinatura devem ficar no backend; não reutilizar os tokens ou a assinatura do Mercado Livre. [Criação e autorização do app](https://partner.us.tiktokshop.com/docv2/page/create-your-app).

Proposta de endpoints LabLayer, **ainda não implementados**:

- Callback: `https://app.lablayer.com.br/api/integrations/tiktokshop/callback`
- Webhook: `https://app.lablayer.com.br/api/integrations/tiktokshop/webhook`

A tela Configurações deverá permitir cadastrar App Key/Secret, conectar, verificar e reconectar a loja, seguindo a experiência já usada no Mercado Livre. Não será necessário editar `.env` para o cadastro pelo usuário.

## Ficha de publicação proposta

| Grupo | Campos a preparar |
| --- | --- |
| Identidade | Produto local, SKU único por variante, nome comercial e unidade vendida |
| Conteúdo | Título em português, descrição, fotos escolhidas para divulgação e vídeo opcional |
| Categoria | Categoria final do TikTok, atributos, marca ou enquadramento aceito para sem marca |
| Variantes | Cor/tamanho/modelo, SKU local e depois `product_id`/`sku_id` remoto |
| Venda | Preço BRL por SKU; taxas, margem e campanhas tratados por canal |
| Disponibilidade | Quantidade física vendável, depósito e vínculo ao estoque local |
| Expedição | Peso e dimensões da embalagem pronta, origem/devolução e logística |
| Condicionais | Certificações, identificação do produto e outros campos exigidos pela categoria/loja |

Consultar regras e atributos da categoria antes de liberar a publicação. Dimensões obrigatórias variam por categoria/mercado. Para embalagem, pesar o produto embalado; os gramas de filamento do orçamento não representam o peso de expedição. O formato exato de imagens, limites e campos fiscais será validado no contrato BR da loja. [Regras de categoria](https://partner.tiktokshop.com/docv2/page/new-property-added-to-get-category-rules-api-to-indicate-whether-package-dimension-is-mandatory), [atributos para publicação](https://partner.tiktokshop.com/docv2/page/recommend-required-product-properties-202609).

Exemplo de piloto proposto: um organizador ou chaveiro padrão, pronto, com fotos próprias e estoque conferido. Um kit de dez chaveiros deve ter unidade comercial explícita; não transformar automaticamente a tabela de preços de orçamento em variantes. Não publicar fotos de conversas ou artes personalizadas de clientes automaticamente.

## Pedidos, estoque e operação brasileira

A documentação de pedidos prevê reserva quando a compra é criada, inclusive antes do pagamento. O LabLayer deve importar uma única vez, reservar disponibilidade e tratar cancelamentos e expedição por estado. O pagamento não deve baixar novamente a mesma quantidade. Webhooks duplicados/fora de ordem exigem deduplicação e consulta autoritativa. [Order API overview](https://partner.tiktokshop.com/docv2/page/order-api-overview).

Proposta: `disponível = máximo(0, físico utilizável − reservas − margem de segurança)`. Kits consomem componentes; estoque em depósitos distintos não deve ser somado duas vezes. A atualização dos canais passa por fila persistente com retentativa, versão e conciliação. Uma sincronização assíncrona reduz, mas não elimina, a corrida de venda da última unidade; usar cotas conservadoras no piloto.

O fluxo BR tem `need_upload_invoice`, Upload Invoice e evento de status da nota, além de particularidades no endereço do depósito. A operação precisa atender à etapa de nota quando exigida. Enviar uma nota à plataforma não significa emitir NF-e; definir de onde virá o documento fiscal antes de habilitar expedição completa. [Fluxo brasileiro](https://partner.tiktokshop.com/docv2/page/br-market-updated-api-workflow-to-support-order-invoice-and-warehouse).

## Sequência de implementação

| Etapa | Entrega | Critério para seguir |
| --- | --- | --- |
| T0 Acesso | Identificar loja/app BR, tipo de desenvolvedor, scopes, revisão e logística | Autorização válida e loja identificada com leitura real; pendências explícitas |
| T1 Conexão e consulta | Credenciais pela tela, OAuth/assinatura, renovação, importar anúncios existentes | Testes de isolamento/revogação; contagens e SKUs reconciliados |
| T2 Catálogo e publicação | Ficha por canal, mídia, regras, criação, edição, ativação e pausa | Um produto piloto aprovado e operações conferidas; sem duplicação em timeout |
| T3 Vendas e estoque | Eventos, pedido normalizado, reservas, cancelamento, saldo entre canais | Mesma venda/webhook não baixa duas vezes; estoque inicial conciliado e filas recuperáveis |
| T4 Expedição e financeiro | Nota, etiqueta/rastreio, devoluções e conciliação | Pedido piloto percorre fluxo aplicável à loja BR |
| T5 Conteúdo e mídia paga | Recursos de vídeo/afiliados e API for Business conforme elegibilidade | Autorizações separadas, orçamento definido e ações auditadas |

Construir cada etapa no backend TypeScript existente. n8n pode enviar avisos e resumos; reserva, baixa e decisões de saldo permanecem no domínio transacional do LabLayer. Cada etapa terá testes unitários, de contrato e integração, além do teste autorizado na loja/ambiente disponível. Disponibilidade de Development Shop para o mercado será conferida no portal, sem presumir sandbox BR.

Próxima ação concreta: abrir o Partner Center com o titular da loja e conferir se já existe app próprio. Registrar mercado BR, app/service ID, tipo de app, permissões e eventual revisão. Depois implementar T1 com cadastro de credenciais pela tela. Nesta pesquisa não foi criada conexão, enviado anúncio, alterado estoque ou iniciado gasto publicitário.
