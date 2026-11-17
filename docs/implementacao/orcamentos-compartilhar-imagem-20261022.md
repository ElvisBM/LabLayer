# Imagem junto ao orçamento — 22/10/2026

Publicado no aplicativo e no assistente. Blocos de orçamento comercial passam a mostrar uma imagem, priorizando `quoteMediaImageUrl` e usando `referenceImageUrl` quando não houver prévia. A imagem continua privada: o frontend busca o arquivo autenticado e utiliza URL temporária local. No bot, o servidor retorna somente o identificador opaco da imagem do pedido em atendimento compartilhado; o download continua validando tenant, link e vínculo com o pedido. Não houve alteração de regras, preços ou dados de pedidos.

## Ações

- Ampliar: imagem abre pelo link para sua versão completa; permite utilizar os recursos de imagem do navegador.
- Compartilhar imagem e texto: disponível quando Web Share aceita arquivos; chama o compartilhamento nativo com o arquivo e somente o texto comercial. O usuário escolhe destino e envio. Cancelar não anuncia sucesso nem dispara outro canal.
- Copiar imagem e texto: disponível para PNG com ClipboardItem e clipboard.write. Grava imagem PNG e texto simples no mesmo item. O aplicativo que recebe pode escolher apenas um formato; a interface orienta copiar o texto separadamente se necessário.
- Baixar imagem: sempre disponível após carregar o arquivo; preserva PNG/JPEG/WebP. Para JPEG/WebP ou navegadores sem clipboard de imagens, compartilhamento/download continuam disponíveis.
- Copiar orçamento: mantém a ação anterior, somente texto comercial. Peso, horas e notas internas não entram no compartilhamento.

As URLs temporárias são revogadas ao desmontar ou trocar de imagem/contexto. Falhas de carregamento e permissão apresentam mensagem; nenhuma imagem anterior permanece visível enquanto outra é carregada. O navegador só recebe bytes depois da autorização existente do endpoint.

## Validação

- 38 testes unitários/UI passaram em ambos os checkouts: imagem, cópia com dados binários e texto, falha/ausência de clipboard, cancelamento de compartilhamento, acesso negado, troca de imagem, formatação comercial, lista e bot.
- 20 testes de integração do assistente passaram no release, incluindo a prioridade da prévia e o isolamento existente de anexos por pedido/empresa. TypeScript passou em ambos; build de produção passou (alerta já existente sobre tamanho do bundle).
- No bot publicado, ORC-009 exibiu a prévia Arkangel de 1448 × 1086, os quatro preços e as ações. Clique em Copiar imagem e texto retornou confirmação do navegador. Não foi realizado envio para aplicativo/cliente externo; a interpretação dos formatos pelo destino depende desse aplicativo.
- Evidência local na pasta pai do repositório: `evidencias-publicacao/orcamento-imagem-copiar-20261022.png`.
- HTML público corresponde ao build: SHA-256 `c9fff28e91426cce05a25f42b69f258057e1fbd5e33a5920525586f3e22ab6ba`; health respondeu `ok` após reinício.

Release operacional: `/home/lablayer/releases/quote-image-sharing-20261022/`. Backup anterior: `/home/lablayer/deploy-backups/quote-image-sharing-20261022-before.tar.gz`. Para rollback, restaurar arquivos existentes e dist desse backup e reiniciar `lablayer-app`; nenhum dado de pedido ou regras precisa ser revertido. Diferenças do checkout estabilizado preservadas por patch.
