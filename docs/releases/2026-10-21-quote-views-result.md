# Publicação das visualizações — 21/10/2026

Autorização: usuário solicitou publicar após aprovar Lista simplificada, 2 caixas e 3 caixas. Resultado: **publicadas e conferidas em https://app.lablayer.com.br/**.

## Escopo publicado

Release `f34d8dd`, branch remota `release/quote-view-modes`, baseada no main remoto `261885c9d9e37b611da9e709ca758b87770e9f16`. Transportados somente os trechos de interface B19/B20 para a base de produção: três visualizações, busca por cliente, filtros compartilhados e indicação de valor pendente na lista.

Os 32 arquivos de frontend/configuração pública comparados no servidor eram idênticos à base remota. O backend `server.ts` no servidor tinha alteração própria; foi preservado, com hash igual antes/depois. Não foram publicados E0–E5/B12–B18, novas regras Firebase, menu de usuários, migrações ou alterações de cálculo. Esta publicação não encerra a homologação do núcleo estabilizado.

## Validação

- Branch estabilizada B20: 332 testes, tipos/build e auditoria de produção já aprovados.
- Release isolada com o lockfile da produção: `npm ci`, TypeScript, três testes da tela com banco simulado e build aprovados. O aviso de bundle acima de 500 kB permanece nesta base; B16 não foi transportado.
- Servidor: checksums do índice, JS, CSS e fonte iguais ao pacote local. Backend permaneceu com SHA-256 `b622747591821f6b98e76dc8e54b58774bc18be307cee873afda857d66fcee2a`.
- HTTP público: índice, JS e CSS responderam 200 e os respectivos hashes conferiram com o build local.
- Navegador autenticado: recarga, abertura de Encomendas e Orçamentos, lista com `13 de 27 solicitações` ao buscar `ORC-`; todos os treze pedidos identificados, com dez unidades no primeiro e uma nos outros doze. Alternância para duas e três caixas preservou busca e contagem. Console consultado sem erros. Nenhuma gravação comercial executada na conferência.
- Evidência visual local: `orcamentos-recebidos/evidencia-lista-publicada.jpg`, fora do repositório por conter dados de clientes.

## Implantação e reversão

Deploy direto por SSH com o usuário de implantação existente e verificação estrita de chave de host. A falha histórica do workflow automático ocorria na permissão de sincronização; esse workflow não foi acionado nem alterado. O release foi enviado para a branch remota específica; **main não foi atualizado**. Antes de uma futura publicação automática de main, reconciliar essa branch e preservar as alterações próprias do servidor.

Backup verificado: `/home/lablayer/deploy-backups/views-20261021-f34d8dd-before.tar.gz`, com `dist` completo anterior e o fonte da tela. SHA-256: `cb4c43565eaa9aec795d36f9b4f7e5f831753ced14cc66f6e550d7ef8a3daa14`. Arquivo restrito ao usuário de implantação. Pacote aplicado: `/home/lablayer/releases/views-20261021-f34d8dd/release.tar.gz`, SHA-256 `b0055c5891ce95b01b694a7329e096dfe292e61d44180ef86a0e84e5e2d44044`.

Assets novos copiados antes de substituir atomicamente `dist/index.html`; assets antigos mantidos para abas abertas. Fonte da tela atualizado. Sem restart do servidor, mudanças de credenciais, permissões de usuários ou operações no banco. O backup é do frontend, não um backup de Firestore/Auth/Storage.

Para reverter, extrair o backup em diretório temporário, conferir o índice anterior (SHA-256 `155f512c1d10d8b0b3b60f74664ccee324d8f91dedf9abfa6e19aed14d5657eb`), repor assets se necessário e substituir índice/fonte por rename. Não restaurar banco para reverter esta entrega.

Índice publicado: `938411be7f55d79f13b6ed2ae56510e81c7a835b5383028c3e535cffd8e57185`.
JS `/assets/index-DWEAyW6_.js`: `e4ccab12f4ba95b367d3abea9f01409d0d3b1655c12fe977ccaa726eb687e561`.
CSS `/assets/index-B8YyZb-3.css`: `517f67bb6aa1e5e2cd0b91ed4ca6544b42bb1d15a6f6022a357e49cb2b3766f1`.
