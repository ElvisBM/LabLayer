# Fechamento das lacunas após E5

Referência: E5 `1be130f`. Este complemento não declara encerrado o B11: piloto real, classificação do legado, abertura conferida, Auth real, backup do ambiente completo e implantação coordenada continuam pendentes. Nenhuma operação real foi executada.

## B12 — pós-venda e revisão após fatos físicos

- Devolução física exige expedição canônica, quantidade inteira ainda não devolvida, versão do atendimento, confirmação do recebimento e motivo. Apenas o responsável pela empresa pode registrar. Pedido conferido exige reabertura prévia.
- **Estoque utilizável**: retorna produto acabado pelo custo histórico proporcional da expedição, sem restaurar filamento, insumos, horas ou ficha antiga. Cada parcela usa a diferença entre alocações cumulativas arredondadas em 12 casas; devolver tudo conserva exatamente o custo original.
- **Descarte confirmado**: registra recebimento físico e descarte sem adicionar saldo/valor. O custo continua no resultado do pedido. Não existe quarentena implícita: somente confirmar descarte quando ele ocorreu; itens aguardando inspeção não devem ser declarados utilizáveis.
- A devolução reduz a entrega líquida e reabre a necessidade de atendimento. Troca usa reserva/expedição de reposição ou fabricação explícita; uma expedição não pode ser devolvida além de sua quantidade mesmo sob concorrência.
- **Acordo comercial**: proprietário/administrador registra crédito total vigente e dispensa total por item, informante, evidência e motivo. Não altera snapshot/preço/quantidade originalmente aprovados. Pode corrigir um acordo por novo registro com totais explícitos; histórico permanece imutável.
- Reservas e planos restantes precisam ser cancelados antes do acordo. Produção já realizada permanece registrada e seus produtos permanecem em estoque; não há reversão de material transformado. A dispensa não pode incluir unidades ainda entregues ao cliente: devolver fisicamente primeiro quando aplicável. Crédito sem devolução é permitido, com dispensa zero e justificativa comercial.
- Valor vigente = preço aprovado − crédito vigente. A receber = máximo(0, vigente − recebido líquido de reembolsos). A reembolsar = máximo(0, recebido líquido − vigente). Crédito não cria movimento de caixa; reembolso é outro comando comprovado.
- Custo expedido líquido = custo histórico de todas as expedições − valor efetivamente recuperado em estoque. Reposição acrescenta seu próprio custo; descarte não reduz custo. Resultado confirmado usa valor comercial vigente, taxas efetivas, custo expedido líquido, perdas totais e despesas adicionais conferidas.
- Conferência final exige atendimento líquido igual às unidades ainda devidas, ausência de produção ativa, recebimento igual ao valor vigente e conciliação técnica. Pedido totalmente dispensado pode encerrar com custo expedido zero; produção boa não expedida permanece no estoque, perdas totais continuam no pedido.
- Nova proposta pode referenciar pedido cancelado ou já conferido após os acordos. É um novo escopo comercial: não transfere pagamento, estoque ou consumo automaticamente. O operador precisa revisar o escopo para não cobrar novamente o que foi mantido no pedido anterior.
- As coleções `stockReturns` e `orderAmendments` são imutáveis por comandos do servidor; rules negam mutações diretas. Há recibos idempotentes, controle de versão e auditoria atômica. A conciliação verifica custo/quantidade/destino/origem das devoluções e cadeia de créditos/dispensas.

A interface disponibiliza as operações e históricos em **Financeiro e conciliação**. Reposição segue em **Orçamentos e pedidos** / **Estoque e produção**. O relatório de aprovações continua bruto, e créditos são apurados pela data de cada acordo; não reescreve a receita originalmente aprovada.

### Qualidade B12

Barreira integral aprovada em 20/10/2026: **283 testes** (149 unitários/interface e 134 de integração), TypeScript, build e auditoria de produção. Os 274 casos anteriores passaram; nove casos foram adicionados. Evidência: [log B12](./evidencias-b12-quality.txt). Permanecem os nove alertas baixos/moderados de produção e o aviso de bundle grande. Novos casos cobrem devolução parcial, descarte/troca, retorno cumulativo, concorrência, crédito/reembolso, revisão após produção, correção de acordo, permissões, rules, falha de auditoria e interface.

## Demais blocos em execução

- B13: arquivos próprios, referências autenticadas e migração explícita de mídia incorporada.
- B14: registro de envio da versão emitida e confirmação verificável da lista de espera (DV35).
- B11: homologação real e corte coordenado; dependem da identificação da empresa/ambiente e dos documentos reais.

Escala maior (paginação/agregações) e atualização das dependências remanescentes devem ser avaliadas com compatibilidade e volume real. Os limites atuais recusam resultados parciais e continuam explícitos. Novos agentes, importação assistida, marketplaces, portal de aprovação e PDF elaborado permanecem evoluções posteriores.
