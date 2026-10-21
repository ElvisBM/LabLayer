# B19 — lista simplificada de encomendas e orçamentos

## Comportamento

A tela **Encomendas e Orçamentos** abre em lista, com opção de alternar para os cartões completos. Cada linha mostra solicitação, tipo, cliente, quantidade, status, valor do orçamento e botão **Detalhes**. O botão abre o editor existente com o descritivo integral. Alternar visualizações, pesquisar e abrir detalhes não gravam mudanças no banco; a gravação continua dependendo de Salvar/Atualizar.

Busca e filtro de status são compartilhados entre as duas visualizações e permanecem ao alternar. A busca passa a considerar também o nome do cliente, além de título e descrição. A tela informa quantos registros correspondem aos filtros e apresenta mensagem quando o resultado é vazio. A ordenação existente por atualização/criação foi preservada.

Um orçamento em **Aguardando orçamento**, sem preço ou com preço zero, mostra **A calcular** na lista. Outros registros sem valor mostram **Não informado**; valores informados continuam sendo exibidos sem recálculo ou mudança do documento. A lista não confirma preços, aprova propostas, modifica quantidades ou movimenta estoque. Quantidade ausente/não positiva aparece como **A confirmar**, sem assumir uma unidade para exibição. As observações de quantidade provisória continuam no descritivo integral.

O layout usa tabela com cabeçalhos e nomes acessíveis dos botões, além de rolagem horizontal em telas estreitas. A opção escolhida dura enquanto a tela estiver montada; ao reabrir, o padrão é lista. Não há mudança de schema, rules ou API neste bloco.

## Qualidade e limites

Três testes de interface cobrem: quantidade e valor persistidos com distinção de cálculo pendente; busca por cliente/filtro mantidos entre lista e cartões, inclusive resultado vazio; abertura/cancelamento dos detalhes com descrição completa e ausência de gravações. A prévia visual isolada usa o componente real e estilos do aplicativo, com dados demonstrativos e operações de banco bloqueadas. Foram conferidos tabela, alternância de cartões e abertura do editor.

A barreira completa, incluindo regressão E0–E5/B12–B18, está registrada em [evidências B19](./evidencias-b19-quality.txt): **332 testes** (178 unitários/interface e 154 de integração), TypeScript, build e auditoria de produção sem vulnerabilidades.

## Cadastro comercial e publicação

Em operação separada no aplicativo publicado, o usuário autorizou uma unidade provisória para solicitações sem quantidade. Os 12 registros restantes foram cadastrados como **Aguardando orçamento**, com quantidade provisória e cálculo pendente explícitos na descrição. O lote de 13 registros foi conferido após recarregar a aplicação: 12 com uma unidade e o anterior com dez. Dados e evidências de clientes permanecem fora do repositório em `orcamentos-recebidos`. Anexos na instalação publicada continuam pendentes por limitações do upload legado; fontes originais locais foram preservadas.

O cadastro real não publica esta alteração de interface. A lista é uma entrega local; publicação continua sujeita à conferência do conjunto acumulado, backup e homologação descritos em [B17](./homologacao-b17.md) e no [roteiro do piloto](./piloto-e5.md). A mudança se aplica à tela legada de solicitações. Após ativação operacional E3, a navegação encaminha para Orçamentos e pedidos E4; esse fluxo canônico não foi modificado por B19.
