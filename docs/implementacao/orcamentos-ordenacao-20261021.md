# Ordenação dos orçamentos

A lista permite clicar nos cabeçalhos Solicitação, Cliente, Quantidade, Status e Orçamento. Primeiro clique seleciona ordem crescente; novo clique inverte. Cabeçalho exibe seta e `aria-sort`. O seletor “Ordenar por” também oferece última atualização e data de criação, com botão para inverter direção; funciona na lista e nos cartões. Padrão: última atualização decrescente, usando criação quando atualização está ausente.

Regra prioritária: finalizados sempre depois dos demais, independentemente do campo/direção. Dentro de cada grupo aplica-se a ordenação escolhida. Quantidades e valores usam comparação numérica, textos usam português com números naturais (Pedido 2 antes de Pedido 10), status segue as etapas do fluxo. Valores ausentes ficam ao fim do seu grupo; preço zero aguardando orçamento é “A calcular”, e não um preço emitido. Empates usam ID para estabilidade.

Estado de ordenação permanece ao alternar visualização, abrir detalhes e voltar. Não limpa a seleção em lote nem grava dados no banco. Filtros e busca continuam aplicados antes da ordenação. A mudança é exclusiva de apresentação em Encomendas e Orçamentos; regras de gravação, bot e cálculos não mudam.

Validação: 27 testes direcionados de comparação e UI, TypeScript e build. Os testes cobrem todos os sete campos em ambas as direções com finalizados, valores numéricos, datas, ausências, empates, cabeçalhos, seleção, cartões e retorno do detalhe. Aviso de tamanho de bundle já existente permanece.

## Estado da entrega

Implementação da release: `df7432e`. 27 testes e TypeScript aprovados também no repositório principal. Pacote construído em `/tmp/lablayer-sort-release.tar.gz`; script de publicação `/tmp/lablayer-sort-publish.sh` com checagem dos hashes anteriores, backup e troca atômica do índice.

**Publicação pendente.** O acesso SSH à VPS falhou com reset e, na última tentativa com timeout explícito, autenticou por chave mas não abriu sessão de comando e encerrou com `server not responding`. O processo de upload bloqueado foi encerrado; o script de publicação não foi executado. Não houve troca do HTML nem alterações nos pedidos. O endpoint público `/api/health` segue retornando `status: ok`. Retomar somente após restabelecer a sessão SSH e conferir novamente os hashes da versão publicada. Não afirmar que a ordenação já está disponível no site.
