# Publicação isolada das visualizações de orçamento — 21/10/2026

Base: `261885c9d9e37b611da9e709ca758b87770e9f16` (main remoto). Foram comparados por SHA-256 os 32 arquivos de frontend/configuração pública com o servidor: todos iguais à base. O `server.ts` no servidor difere da base e será preservado integralmente.

A entrega transporta apenas os trechos de interface B19/B20: Lista simplificada, 2 caixas, 3 caixas, busca por cliente, filtros compartilhados e identificação de preço pendente na lista. Não transporta as alterações de cálculo, autenticação, banco, estoque e usuários da branch de estabilização. Não modifica dados comerciais, regras Firebase, configurações secretas ou dependências.

Validação desta base isolada: instalação pelo lockfile em Node 22, TypeScript, três testes da tela com banco simulado e build de produção. O build mantém o aviso preexistente de bundle acima de 500 kB. Comando de teste: `npx vitest run --config vitest.release.config.ts`. A regressão de 332 testes do B20 foi executada anteriormente na branch de estabilização, e não representa homologação do restante dessa branch na base publicada.

A publicação usa SSH com o usuário existente de implantação e a chave de host já conhecida. Antes da troca, cria um arquivo tar de `dist` e do fonte da tela em `~/deploy-backups/`. Os novos assets com hash são copiados antes do `index.html`, substituído por rename no mesmo diretório. Assets antigos permanecem disponíveis para abas abertas. O servidor e PM2 não são reiniciados. O fonte da tela é atualizado para permitir reconstruir essa versão.

Reversão: usar o backup da execução, restaurando o fonte da tela e o `index.html` anterior; os assets anteriores continuam presentes. Se houver necessidade de restaurar assets, extrair `dist/assets` do backup antes de substituir o índice. Não restaurar banco de dados: esta publicação não o altera.

Conferência após publicação: comparar hashes locais/remotos de índice, JS, CSS e fonte; abrir a instalação publicada com sessão existente; conferir as três opções, busca, filtros, quantidade de registros e ausência de erro de carregamento. Não gravar orçamentos durante o teste de visualização.
