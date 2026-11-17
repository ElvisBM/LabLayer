# Painel de orçamentos com resumo de pedidos — 03/11/2026

A visualização inicial de Encomendas e Orçamentos agora usa cartões compactos inspirados na lista do bot: número ORC em destaque, título, cliente, quantidade, status, total, entrega combinada e ações Abrir pedido/Copiar orçamento. Descrição técnica, custos, filamentos, imagens e histórico continuam acessíveis ao abrir o pedido. As opções comerciais ficam recolhidas e seu conteúdo só é montado ao expandir.

Os contadores grandes foram substituídos por filtros compactos de status. A alteração em lote aparece após selecionar pedidos. As visualizações de tabela e de duas/três caixas foram preservadas como alternativas. Número visível também nessas visualizações e no cabeçalho dos detalhes. A busca reconhece ORC 2, ORC-002 e 002 pela numeração já cadastrada.

O número usa o mesmo helper do bot, com prioridade para code/requestNumber e compatibilidade com títulos/IDs antigos. Consulta somente leitura encontrou 45 registros, dos quais 31 têm número reconhecível e 14 não têm numeração cadastrada (13 finalizados e um orçado). Estes últimos são sinalizados como “Sem número atribuído”. Nenhuma migração ou renumeração foi feita.

Validação: TypeScript e 30 testes de lista, busca, número, ordenação, seleção em lote e navegação passaram. Conferência visual do novo cartão com dados sintéticos em navegador separado. Build da release isolada passou. Página, JS, CSS e health check publicados retornaram 200/ok. Nenhuma escrita de pedidos foi executada.

Publicação restrita a src/views/EncomendasOrcamentos.tsx, novo src/features/requests/PlatformOrderCard.tsx e build de frontend produzido sobre os demais fontes atuais do servidor. Alterações locais preexistentes de cálculo de preço não foram incluídas. Configuração de build da release usa import de vite em vez de vitest/config, pois o ambiente de publicação não instala Vitest; configuração da aplicação preservada.

Release: /home/lablayer/releases/panel-layout-20261103/. Backup do fonte e dist anteriores: /home/lablayer/deploy-backups/panel-layout-20261103/before.tar.gz. Assets anteriores foram mantidos para abas abertas. Bundle inicial index-DhobhCAi.js e CSS index-BpY6gG6L.css. Backend, credenciais e banco preservados.

Para reversão visual, restaurar o fonte e o dist do backup após conferir alterações posteriores. Não restaurar dados de pedidos.
