# Referências externas para evolução do LabLayer

Consulta realizada em 5 de outubro de 2026. Foram examinadas páginas públicas das quatro plataformas indicadas e, quando disponíveis, suas explicações de cálculo. Não foram testadas áreas autenticadas, integrações pagas ou dados privados. Recursos anunciados são identificados como anúncios; a presença de uma descrição não comprova a execução do fluxo.

As referências ajudam a desenhar a experiência e a identificar parcelas de custo. A política de cálculo do LabLayer será definida e testada com suas próprias premissas.

## Comparação e aproveitamento

| Referência | Observado nas páginas públicas | Aproveitar agora no LabLayer | Ideias para depois |
|---|---|---|---|
| [Cálculo3D](https://www.calculo3d.com.br/) | Formulário por grupos de material, energia/tempo e trabalho; aceita vírgula ou ponto; mostra parcelas do resultado. Marketplaces aparecem como recurso futuro. | Formulário curto, unidades visíveis, entrada numérica brasileira e mensagens de validação por campo. | Simulador público simplificado para aquisição de clientes. |
| [Calc3D](https://calc3d.com.br/#calculadora) | Entrada separada de horas manuais e horas de impressão, quantidade, composição do custo e resultado por peça/lote. A página anuncia histórico/PDF com cadastro e operação comercial no PRO. | Separar preparação/acabamento de máquina; mostrar total do pedido e valor unitário juntos; explicar parcelas. | Cenários predefinidos e documento comercial com marca. |
| [3DPCC](https://3dprintingcostcalculator.com/pt) | Campos de trabalho, componentes e embalagem, além de material/tempo/máquina. Exibe opções de preço e anuncia gestão de clientes, pedidos, reservas, multimaterial e lote. | Insumos e embalagem visíveis; parâmetros reutilizáveis da impressora; histórico do orçamento com premissas. | Várias estratégias comerciais, portal do cliente e tecnologias de impressão adicionais. |
| [Calculadora 3D BR](https://calculadora3dbr.com.br/) e [calculadora pública](https://calculadora3dbr.com.br/calculadora-impressao-3d) | Apresenta jornada produto→canal→venda→resultado; calculadora discrimina material, energia, máquina, perda e taxas. | Unir custo e resultado da venda; cadastro de canal reutilizável; explicar efeito das taxas no preço. | Simulação comparativa e relatórios gerenciais mais amplos. |

A seleção “agora/depois” é recomendação para o LabLayer, não afirmação de que as plataformas de referência implementam cada proposta dessa coluna.

## Cuidados com a interpretação dos cálculos

**Margem e markup precisam de nomes diferentes.** A interface pública do Calc3D apresenta um controle de lucro sobre custo; sua [metodologia](https://calc3d.com.br/metodologia-calculo-impressao-3d) explica a formação por markup. No LabLayer, a proposta é mostrar separadamente multiplicador sobre custo e margem sobre faturamento, com a base sempre explícita.

**Reserva e falha estatística são modelos distintos.** A metodologia do Calc3D descreve uma reserva no subtotal. A [explicação da Calculadora 3D BR](https://calculadora3dbr.com.br/calculadora-impressao-3d) apresenta divisão pelo rendimento restante. Ambas exigem definição de quais custos estão sujeitos à repetição; o LabLayer não deve trocar uma pela outra silenciosamente.

**A fórmula do preço precisa corresponder à base da margem.** Um [guia da Calculadora 3D BR](https://calculadora3dbr.com.br/como-precificar-impressao-3d) aplica divisões sucessivas por um menos a taxa e por um menos a margem. Minha verificação algébrica: para custo 10, taxa de 10% e meta de 20%, essa expressão produz 13,8889 e margem de 18% sobre o preço bruto. Se a meta é 20% sobre esse preço, a expressão apropriada para essas premissas é `10 / (1 − 0,10 − 0,20) = 14,2857`. Isso é uma distinção entre bases de margem; não é uma auditoria do código da calculadora.

**Tempo humano não acompanha automaticamente tempo da máquina.** A proposta para o LabLayer é registrar os minutos de preparação, acabamento e montagem e seu custo horário. Uma impressão de 8 horas não implica 8 horas de trabalho humano.

**Tarifas externas não serão importadas como verdades fixas.** Consumo elétrico, custo do material, vida útil, taxas e margens serão parâmetros da operação. IVA, planos, recursos PRO e valores promocionais dessas páginas não serão transplantados para as regras locais.

## Decisões de experiência propostas

| Decisão para LabLayer | Aplicação concreta | Condição para entrega |
|---|---|---|
| Explicar a unidade de entrada | “Consumo total desta mesa”, “Unidades boas previstas”, “Minutos de preparação do lote” | Contrato de lote validado |
| Mostrar custo aberto | Material, energia, máquina, trabalho, insumos, perdas e despesas do pedido | Mesmo resultado em interface e servidor |
| Separar simular e efetivar | Editar ficha não movimenta saldo; produção e compra têm ações explícitas | Livro de movimentos e comandos transacionais |
| Manter uma proposta comercial estável | Versão enviada não muda quando preço do filamento muda | Versões imutáveis e snapshot do cálculo |
| Evitar recadastro | Aprovação gera pedido vinculado; planejamento usa a ficha aprovada | Fluxo de estados e IDs estáveis |
| Informar insuficiência com ação clara | Mostrar material faltante e permitir ajustar plano ou registrar compra | Saldo físico e reserva separados |

O [plano de execução](/Users/PCNOTES/Workspace/3D/lablayer/LabLayer/docs/mapeamento/07-plano-de-correcao.md) usa essas ideias apenas quando contribuem para corrigir o núcleo atual.
