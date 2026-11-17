# Orçamentos: tela de detalhes e retorno — 21/10/2026

## Comportamento

O nome da solicitação abre uma tela exclusiva dentro do módulo Encomendas e Orçamentos, nas visualizações Lista simplificada, 2 caixas e 3 caixas. O atalho Detalhes/editar utiliza a mesma tela. O formulário não é mais exibido acima da listagem. Nova Solicitação também ocupa sua própria tela.

O botão **Voltar para orçamentos** retorna à listagem mantendo busca, filtro de status, modo de visualização e posição vertical. O foco retorna ao título para navegação por teclado. Abrir a solicitação posiciona o foco no cabeçalho dos detalhes. Os nomes têm alvo de toque com altura mínima de 44 px.

Voltar e Cancelar descartam o rascunho sem gravar; Atualizar/Salvar continuam sendo as ações explícitas de gravação. Abrir/voltar não grava dados nem dispara alterações de estoque ou aprovação. O retorno é feito pelo botão da aplicação; não foi introduzida uma rota compartilhável nem integração com o histórico do navegador.

## Validação

- Testes de interface cobrem títulos clicáveis nos três modos, tela exclusiva, restauração de busca/filtro/modo/foco, rascunho descartado, valor registrado preservado e ausência de escrita ao navegar.
- Abertura pelo atalho Detalhes e criação/cancelamento continuam cobertas.
- Release de produção: `npm run quality`, 44 testes (16 unitários/UI e 28 integração), TypeScript, build e auditoria de produção sem vulnerabilidades.
- Estabilização E0–E5: `npm run quality`, 350 testes (184 unitários/UI e 166 integração), TypeScript, build e auditoria de produção sem vulnerabilidades.
- A alteração equivalente foi aplicada na branch de estabilização preservando suas fórmulas e validações específicas de E0–E5.

## Publicação

Publicação restrita à tela e aos assets compilados da branch `release/users-b21`. Backend, regras Firestore, contas e registros comerciais não fazem parte desta alteração. Assets anteriores são preservados para abas abertas. O index é substituído após copiar os assets, com backup do estado anterior.

### Evidência técnica

- Commit funcional da release: `d5bf5dd`.
- Backup anterior: `/home/lablayer/deploy-backups/quote-details-d5bf5dd-before.tar.gz`.
- Assets publicados: `index-Ch2dnjx2.js` e `index-DH7KQ3Om.css`.
- SHA-256 do index publicado: `d929cd80c84f0098d8e02fc74d792078af2d46666d1052bff050b3c540003cfd`.
- HTML público comparado byte a byte com o build e `/api/health` retornando `status: ok`.
- Hashes do servidor, módulo de usuários e regras Firestore permanecem iguais aos anteriores.
- Rollback: restaurar `dist/index.html` e `src/views/EncomendasOrcamentos.tsx` do backup no diretório da aplicação; assets antigos permanecem disponíveis.

### Verificação visual em produção

Sessão autenticada existente: abertura de ORC-001 pelo nome em lista a 390×844 e em 3 caixas a 1366×900. Confirmados tela exclusiva, botão Voltar, foco no cabeçalho e retorno com busca `ORC-001`, status Aguardando orçamento e modo selecionado preservados. Nenhuma ação Salvar/Atualizar foi acionada em produção. Ao concluir, busca/filtro foram limpos, modo Lista restaurado e viewport de teste removido; 27 de 27 registros disponíveis.

Evidências locais fora do Git: `../evidencias-publicacao/orcamento-detalhes-mobile-20261021.png` e `../evidencias-publicacao/orcamento-detalhes-desktop-20261021.png`.
