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

## Blocos complementares

- B13: implementado e validado; arquivos próprios, referências autenticadas e migração explícita de mídia incorporada.
- B14: implementado e validado; registro de envio da versão emitida e confirmação verificável da lista de espera (DV35).
- B11: homologação real e corte coordenado; dependem da identificação da empresa/ambiente e dos documentos reais.

Escala maior (paginação/agregações) e atualização das dependências remanescentes devem ser avaliadas com compatibilidade e volume real. Os limites atuais recusam resultados parciais e continuam explícitos. Novos agentes, importação assistida, marketplaces, portal de aprovação e PDF elaborado permanecem evoluções posteriores.

## B13 — arquivos próprios e migração de mídia

Arquivos novos podem ser enviados nos rascunhos de orçamento e no editor de ficha: PNG, JPEG, WebP, PDF, STL e 3MF, até 10 MiB. São recebidos pela API autenticada, armazenados como objetos imutáveis e referenciados por `asset:<id>`; URLs HTTPS externas continuam aceitas. O documento de negócio contém somente a referência, sem base64. O servidor recusa referências privadas inexistentes na empresa ao salvar ficha/rascunho.

- Upload: `POST /api/tenants/:tenantId/assets/upload`, corpo binário; download: `GET /api/tenants/:tenantId/assets/:id/download`. O token é enviado em header e nunca incorporado ao link. Download é attachment com `nosniff` e `private, no-store`.
- Metadados incluem nome, MIME, tamanho e SHA-256. A identidade depende do conteúdo/nome/MIME e o objeto usa caminho por empresa; retry não duplica. Download confere tamanho/hash antes de devolver bytes. Não há exclusão de arquivos referenciados.
- Storage e Firestore não têm transação conjunta. Primeiro grava-se o objeto com precondição de inexistência; depois metadados e auditoria transacionais, com nova verificação de acesso. Falha deixa no máximo objeto órfão reutilizável pelo retry, sem anunciar upload confirmado. Limpeza futura de órfãos exige conferir referências; não apagar por idade sem análise.
- O backend usa `FIREBASE_STORAGE_BUCKET` e a identidade de serviço configurada. Sem storage disponível, responde erro explícito. **Antes de ativar:** aplicar/revisar `storage.rules` (cliente sem acesso direto), IAM sem leitura pública e permissões mínimas do servidor. Rules permissivas sobrepostas concedem acesso; não basta adicionar um deny específico a um allow global. O arquivo entregue é deny-all para clientes, compatível com acesso novo exclusivamente pela API. Não foi aplicado ao bucket real.
- Validação de assinatura/formato não substitui antivírus nem valida a geometria de STL/3MF. Nenhum conteúdo é executado ou extraído pelo servidor; arquivos são baixados como anexos.

### Migração explícita

Na ficha, a opção de migração procura `products/{id}.imageUrl` e `files[].url` incorporados. No orçamento com solicitação de origem, procura `customRequests/{id}.referenceImageUrl` e `quoteMediaImageUrl`. O responsável confere a prévia e importa cada arquivo. A operação exige hash da origem e o reconfere na confirmação: mudança concorrente impede publicar o vínculo. `assetMigrations` registra origem, hash, arquivo, ator e data. O documento antigo é preservado; a nova referência entra no rascunho e só passa à ficha/proposta ao salvar/emitir. Histórico e valores antigos não são reescritos.

Conteúdos não suportados ou base64 malformado são recusados, sem migração silenciosa. A migração não busca URLs remotas nem copia arquivos de terceiros automaticamente. Importar históricos de outras estruturas exige mapeamento explícito. Backup operacional deve agora incluir os objetos do bucket e seus metadados, além de Firestore/Auth/configurações; o ensaio E0 continua sendo de Firestore isolado.

### Qualidade B13

Sete testes de integração exercitam API/Firestore com adaptador de objetos isolado: upload/retry, download/hash, isolamento/rules, limites/formato, falhas de storage/auditoria, migração e vínculo no orçamento. Três testes de interface verificam upload autenticado, ausência de sucesso fictício e download privado. O adaptador real do bucket e suas permissões dependem de homologação; nenhum teste enviou arquivo para um bucket real. Barreira integral aprovada: **293 testes** (152 unitários/interface e 141 de integração), tipos, build e auditoria de produção. Os 283 casos anteriores passaram. [Evidência B13](./evidencias-b13-quality.txt).

## B14 — envio de propostas e lista de espera

`record-send` registra destinatário, canal, evidência, data/hora efetiva e versão emitida. Data do registro e ator vêm do servidor. O envio informado precisa estar entre emissão e validade; versão substituída não pode ser registrada como vigente. O comando conserva preço, snapshot e aprovação e não aciona mensagens externas. Registros imutáveis em `quotes/{id}/dispatches` têm recibo idempotente, versão otimista e auditoria atômica; rules negam escrita direta. A interface mostra os 100 envios mais recentes, com aviso se houver mais. O registro comprova o que o operador informou, não a entrega/leitura autenticada pelo cliente.

No repositório irmão **SiteLabLayer**, a DV35 passou a exigir confirmação positiva da gravação, mesmo requestId e recibo. O Apps Script usa lock e deduplicação; falha de rede/negócio não é anunciada como sucesso. O script e o site precisam ser publicados de forma coordenada, conferindo colunas H–J da planilha, permissões e leitura da resposta no navegador. Não foi enviado cadastro real. Ver [documentação do site](../../../SiteLabLayer/README.md). As seis verificações automatizadas e tipos/build/auditoria de produção do site passaram; a árvore de produção do site tem zero alertas, com alertas remanescentes nas ferramentas de desenvolvimento.

### Qualidade B14

Barreira integral do LabLayer aprovada: **296 testes** (153 unitários/interface e 143 de integração), tipos, build e auditoria de produção; os 293 casos anteriores passaram. [Log B14](./evidencias-b14-quality.txt). A DV35 foi commitada no SiteLabLayer em `39d99d7`. Casos novos verificam envio da versão correta, data/fuso, identidade, retry, rules e atomicidade em falha de auditoria. A interface também traduz a situação de crédito excedente como “reembolso pendente”.

## Pendências para encerrar o plano

| Item | Estado após os complementos |
|---|---|
| Revisão após produção, devolução, troca e crédito | Implementados por comandos explícitos B12; validar política/destinos com a empresa piloto |
| Upload próprio e migração de mídia incorporada | Implementados B13; homologar bucket, IAM, rules e backup dos objetos |
| Registro de envio de proposta | Implementado B14; envio externo continua manual |
| DV35 — confirmação da lista de espera | Corrigida localmente no SiteLabLayer; publicação do Apps Script/site e ensaio real pendentes |
| B11 — piloto, legado, abertura e implantação | Pendente; precisa de empresa/ambiente, documentos e aceite operacional |
| Escala além dos limites publicados | Paginação/agregações maiores continuam no backlog; relatórios rejeitam truncamento |
| Dependências e desempenho | B15: produção sem alertas; sete na árvore de desenvolvimento. Bundle grande segue para B16; [evidências](./dependencias-b15.md) |
| Agentes, CSV assistido, marketplaces, portal e PDF | Evolução posterior ao piloto reconciliado |

Os totais de testes certificam os cenários automatizados cobertos. Não equivalem a dados reais conciliados, storage publicado, integração Google Sheets homologada ou produção liberada.
