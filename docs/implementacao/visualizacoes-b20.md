# B20 — lista, duas caixas e três caixas

Complemento da [lista B19](./lista-solicitacoes-b19.md). A tela Encomendas e Orçamentos oferece **Lista simplificada**, **2 caixas** e **3 caixas**. Lista é o padrão ao abrir a tela. A seleção permanece durante a navegação na própria tela; não é uma preferência persistida no banco.

As três opções usam os mesmos registros, busca por título/descrição/cliente, filtro de status e ordenação. Alternar não grava dados nem altera orçamento, quantidades, status, cálculos ou estoque. O descritivo integral continua acessível no editor e nos cartões.

Em telas a partir de 768 px, duas caixas mostram duas colunas. Três caixas usam duas colunas intermediárias e três a partir de 1280 px. Telas menores usam uma coluna para preservar legibilidade. Indicadores internos dos cartões usam duas colunas, com quatro apenas no modo duas caixas em telas a partir de 1536 px. Mensagem de resultado vazio ocupa toda a grade. O seletor pode quebrar linha e informa a opção ativa com `aria-pressed`.

## Conferência

A prévia isolada usa o componente e estilos reais com três registros demonstrativos e gravações bloqueadas. Conferidas visualmente três colunas e, após alternar, duas colunas com o terceiro cartão na próxima linha. O teste de filtros B19 foi ampliado para passar pelas três opções, conferir seleção exclusiva, manter resultados e não efetuar gravações.

Barreira completa: **332 testes** (178 unitários/interface e 154 de integração), TypeScript, build e auditoria de produção sem vulnerabilidades. [Log B20](./evidencias-b20-quality.txt). Os testes de E0–E5 e complementos continuam incluídos.

Implementação local, sem deploy. A publicação permanece sujeita à homologação e liberação coordenada do conjunto acumulado, conforme [roteiro do piloto](./piloto-e5.md). Não foram modificados registros comerciais nem o fluxo canônico E4 neste bloco.
