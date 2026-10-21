# Imagens dos orçamentos recebidos — 21/10/2026

## Causa e correção

Os 13 pedidos ORC-001 a ORC-013 foram cadastrados sem suas referências: o formulário anterior recusava arquivos acima de 1 MiB e incorporava base64 no documento Firestore. O bucket padrão configurado no backend retornou 404. O limite no proxy é 25 MB, não era o bloqueio.

A tela passa a enviar os bytes originais pelo módulo de arquivos privados E4 (`/api/tenants/:tenantId/assets/upload`, até 10 MiB). A release reutiliza esse módulo e seus modelos, sem ativar as demais rotas E0–E5. Um adaptador de disco persistente, configurado por `LABLAYER_ASSET_DIR`, guarda arquivos fora da raiz web; download requer autenticação e vínculo com empresa ativa. Membro explicitamente revogado é recusado. Referências `asset:<hash>` substituem base64 e a visualização busca os bytes com token, revoga URLs temporárias ao desmontar e permite ampliar a imagem.

Tipos oferecidos no formulário: PNG, JPEG e WebP. O envio mantém o original sem recortar ou comprimir. Salvar, Cancelar e Voltar ficam indisponíveis enquanto o envio está em andamento. Gravar o orçamento continua sendo uma ação explícita após o upload.

## Dados e operação

14 arquivos, 17.978.776 bytes: referência para cada um dos 13 orçamentos e Arte Santista no campo de mídia do ORC-013, confirmada pelo usuário como arte final do botom NFC. Snoopy permanece referência de construção. A importação é conferida por código único, SHA-256, backup e precondição de versão dos documentos; preços, quantidades e status são preservados. Textos sobre anexos pendentes são corrigidos.

Diretório de produção: `/home/lablayer/private-assets`, incluí-lo nos backups operacionais junto com Firestore. Não fica dentro de `dist` e não tem rota estática. Os metadados são gravados pelo servidor. Upload repetido com mesmo conteúdo/nome é idempotente. Arquivo enviado sem salvar o formulário pode permanecer sem vínculo, seguindo o comportamento do módulo E4; limpeza não faz parte desta correção.

## Validação

Release: `npm run quality`, 50 testes (18 unitários/UI e 32 integração), TypeScript/build e auditoria sem vulnerabilidades. Casos novos: upload original acima de 1 MB, hash/bytes, persistência após recriar adaptador, permissões de arquivo 0600, caminho inválido, colisão, repetição, empresa alheia/inativa, token inválido, vínculo revogado, MIME falso, SVG e tamanho acima de 10 MiB.

## Publicação e conferência

- Commit funcional da release: `7c939bb`.
- Regressão completa E0–E5: 356 testes (186 unitários/UI e 170 integração), TypeScript/build e auditoria sem vulnerabilidades.
- Backup do aplicativo: `/home/lablayer/deploy-backups/quote-images-code-before.tar.gz` (inclui configuração, acesso restrito).
- Backup dos registros antes dos anexos: `/home/lablayer/deploy-backups/quote-images-before.json` (acesso restrito).
- Verificação de importação: `/home/lablayer/releases/quote-images/verification.json`; 14 imagens/13 pedidos, 27 registros totais, bytes originais conferidos e demais campos preservados. Arte Santista reconciliada no descritivo do ORC-013.
- Index publicado SHA-256: `f534b1ac86696d05dbdac31fc0a8b6d0443292778b2b09bc4e15238ec112f158`.
- API pública saudável e download sem autenticação recusado (401). Regras Firestore e módulo de usuários mantidos.
- Browser autenticado: as 14 imagens renderizaram com dimensões naturais válidas, incluindo Zalma 3375×6000 e Arte Santista 1230×1236.
- A janela de saúde de publicação foi ajustada de 5 para até 30 segundos após uma reversão automática durante a inicialização. Nova publicação e leitura dos anexos concluídas.

Para recuperação, preservar/restaurar em conjunto a configuração `LABLAYER_ASSET_DIR`, `/home/lablayer/private-assets` e os documentos Firestore. A versão anterior do frontend não entende `asset:`; não reverter somente o frontend após anexar. Os backups anteriores permitem restauração coordenada, conferindo alterações posteriores antes de sobrescrever registros.

Evidência visual local: `../evidencias-publicacao/orcamentos-imagens-20261021.png`, mostrando as duas imagens dentro do botom. A automação confirmou a renderização, mas o teste de abrir a URL temporária `blob:` em outra aba foi bloqueado pela política do navegador de automação; essa navegação não foi validada automaticamente.
