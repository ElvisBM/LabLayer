# Upload de fotos dos anúncios — 29/10/2026

Publicada a rota `POST /api/tenants/:tenantId/listing-drafts/photos`, autenticada pela mesma chave de rascunhos ou sessão de administrador. Corpo binário JPEG, PNG ou WebP de até 10 MiB. Autorização ocorre antes da leitura do corpo e é revalidada antes de gravar e expor o arquivo. Imagens inválidas, animadas ou acima de 40 megapixels são rejeitadas. Sharp reorienta, limita a 2560 px, aplica fundo branco à transparência e salva JPEG qualidade 92 sem EXIF/GPS.

Armazenamento usa `LABLAYER_ASSET_DIR`, já configurado e persistente, fora da árvore de aplicação. Links públicos com 256 bits aleatórios em `/api/listing-photos/{id}.jpg` permitem leitura pelo Mercado Livre sem API key. Metadados e índices de deduplicação ficam em coleções privadas de raiz, sem acesso Firestore do cliente. Upload repetido para a mesma empresa retorna o mesmo link; concorrência é resolvida em transação. Não modifica rascunhos, aprovações ou anúncios automaticamente.

Tela de revisão ganha seleção múltipla de fotos, feedback ao lado do envio, prévias imediatas e remoção de referências. Upload parcial preserva os sucessos. É necessário salvar para anexar as URLs ao rascunho; esse salvamento invalida aprovação anterior, conforme o contrato existente.

Documentação de integração: `../api/anuncios.md`. Arquivo de instruções em `../../../acessos-anuncios/LEIA-ME.txt` atualizado; chave existente preservada. Não houve alteração de regras Firestore, dependências ou configuração Nginx (limite existente de 25 MiB comporta o contrato de 10 MiB).

Validações: 8 testes de unidade/interface e 16 de integração, typecheck e build da base exata de produção. Cobrem upload binário, conteúdo/tipo/tamanho inválido, revogação durante gravação, isolamento da empresa, falta de permissão, retorno idempotente, concorrência e leitura pública do JPEG. Rascunhos e fluxo anterior de aprovação/publicação também passaram.

Release `listing-photos-20261029`, 11 arquivos conferidos, 98 fontes preservadas. Backup: `/home/lablayer/deploy-backups/listing-photos-20261029`. Teste HTTP autenticado em produção com pixels sintéticos: 201 no primeiro upload, 200 no retry com mesmo link, GET público 200; upload anônimo 401 e outra empresa 403. Imagem de teste e metadados removidos depois da conferência, sem criar rascunhos nem anúncios reais. Evidência: `evidencias/anuncios-upload-fotos-20261029.json`.
