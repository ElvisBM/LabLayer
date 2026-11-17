# Ações nos anúncios — 23/10/2026

## Comportamento

Em **Anúncios**, administradores da empresa passam a ter:

- **Publicar** nos anúncios pausados: reativa o mesmo anúncio no Mercado Livre, com preço e estoque atuais. Exige quantidade positiva e ausência de `out_of_stock`.
- **Despublicar** nos ativos: altera para `paused`, pausa reversível. Não exclui nem encerra permanentemente.
- **Editar**: página própria com Voltar, leitura remota atual e revisão antes de confirmar. Título e preço são enviados somente se alterados e permitidos pelo conector.

As ações mostram confirmação explícita antes de enviar ao Mercado Livre. Ao concluir, a lista é atualizada. Membros comuns continuam consultando, sem editar. Shopee e TikTok Shop permanecem pendentes de integração.

**Publicar aqui é reativar anúncios existentes**, não criar anúncio de um produto local. Encerrados exigem fluxo separado de republicação no Mercado Livre.

## Regras da edição

- Título: apenas anúncios ativos/pausados, sem vendas, sem vínculo User Product ou catálogo; 1–60 caracteres. Títulos de User Products podem ser herdados ou replicados, por isso ficam bloqueados neste editor inicial.
- Preço: positivo, até duas casas decimais, somente sem variações, sem desconto identificado por `original_price > price` e após consultar automatização. Automatização ativa ou pausada bloqueia edição; erro de consulta também bloqueia. 404 na consulta de automatização representa ausência de regra.
- Quantidade é somente leitura neste editor. Estoques multiorigem, Full e variantes exigem fluxo por depósito/variação e não são alterados por um `PUT` genérico.
- Fotos, descrição, variações, categoria e republicação de encerrados continuam pelo painel Mercado Livre nesta etapa.

Referências oficiais consultadas:

- [Sincronização e modificação](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-sincronizacao-de-publicacoes): restrições de campos e status.
- [Automatizações de preços](https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/automatizacoes-de-precos): consulta prévia e bloqueio de mudanças em itens automatizados.
- [User Products](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products): propagação de características entre anúncios relacionados.
- [Estoque multiorigem](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/gestao-de-estoque-multiorigem-user-products): atualização depende do tipo de localização.

## Backend e proteção de alterações

GET `/api/tenants/:tenantId/marketplace-listings/:itemId` retorna anúncio, revisão e capacidades. POST `.../:itemId/actions` aceita apenas `requestId`, `revision`, `action` e, para edição, `changes` com título/preço.

Verificação de token Firebase, administrador ativo, empresa ativa, conta conectada e propriedade do anúncio. Permissões/conexão revalidadas antes da escrita. Revisão calculada a partir do estado remoto; comparação novamente após lock evita sobrescrever alterações detectadas entre abertura e envio. A API `/items` não fornece transação conjunta com o Firestore: uma alteração externa após a última leitura ainda é possível.

Antes do PUT, grava intenção em `privateMarketplaceActions` e lock por vendedor/anúncio em `privateMarketplaceActionLocks`. Reenvio da mesma intenção não repete PUT; intenções diferentes com mesmo identificador são recusadas. Auditoria registra responsável, anúncio, ação e antes/depois dos campos alterados. Coleções privadas continuam negadas ao SDK cliente pelas regras existentes.

Depois do PUT, faz novo GET e só confirma quando todos os campos enviados correspondem ao estado remoto. Timeout, erro 5xx, warning silencioso ou divergência geram resultado incerto, sem retry automático; interface exige reabrir/conferir. Lock de dois minutos permanece após resultado incerto. Respostas de erro não expõem payloads do provedor ou tokens.

Cache e consultas em andamento são invalidados nas alterações para evitar recarregar estado anterior. Nenhuma ação movimenta estoque local, vincula catálogo ou modifica anúncios de outra plataforma.

## Qualidade

27 testes unitários/interface passaram (7 novos do editor; regressão da listagem, credenciais e chave). 49 testes de integração passaram (13 novos das ações, 36 de listagem/OAuth/credenciais). Cobertura inclui permissão, identidade do vendedor, estado/revisão, duplo clique, idempotência, invalidação de cache, restrições de edição, renovação de token, erros do provedor, resposta 200 sem efeito e timeout sem reenvio.

PUTs de teste usam provedor simulado e Firestore Emulator. Nenhum anúncio real é pausado, reativado ou editado para testar a implantação. A conferência de produção é somente GET.

## Publicação

Release `576732a`, publicada em 23/10/2026. Backup dos módulos anteriores e index: `/home/lablayer/deploy-backups/anuncios-actions-576732a`. Assets anteriores preservados. Nenhum módulo do bot foi incluído no pacote.

Build servido: `index-DYDqI6fz.js`, `index-Domu0QeO.css`; página e assets HTTP 200. Novas rotas GET de detalhe e POST de ação retornam 401 sem autenticação.

Diagnóstico interno somente leitura em **2026-10-23T18:11:13.807Z** confirmou 44 anúncios (8 ativos, 35 pausados, 1 encerrado), 44 links/imagens e `canManage: true` para o perfil administrador conferido. Amostras reais: ativo com pausa e preço habilitados; pausado com publicação e preço habilitados; encerrado com alterações bloqueadas. Títulos das amostras vinculadas a User Products ficaram corretamente bloqueados.

Após complemento da auditoria antes/depois e teste das duas coleções privadas, repetidos os 22 testes de ações/credenciais, todos aprovados. TypeScript conferido nas branches principal e release; build da release aprovado. A conferência autenticada visual no navegador de produção não foi realizada; PUT real depende da ação explícita do usuário na tela.
