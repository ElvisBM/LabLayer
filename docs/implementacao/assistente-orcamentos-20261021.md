# Assistente de recebimento de orçamentos — 21/10/2026

## Entrega e limite desta versão

Chat guiado em `/assistente#SEGREDO`, separado do login do sistema. Menu **Assistente** permite ao proprietário ou administrador da plataforma criar e revogar links por vendedor. Cada link vale por 90 dias e pode ser compartilhado com seu vendedor. Quem possuir o link terá o mesmo acesso; não é identificação individual forte.

Recebe texto, até seis fotos/áudios por envio, prepara título/cliente/quantidade para conferência, cadastra em **Encomendas e Orçamentos** com status `aguardando-orcamento`, lista os 100 pedidos mais recentes daquele link e permite adicionar complementos. Fotos e áudios originais ficam disponíveis para a equipe na tela de detalhes. Apenas o primeiro anexo de imagem ocupa o campo de referência; todos continuam no painel de anexos do assistente.

**Não há IA, transcrição ou leitura automática das imagens nesta versão.** O assistente usa um preparo determinístico explícito e o texto permanece integral. Áudio é anexado para escuta pela equipe; é necessário informar também um texto para cadastrar. Não calcula nem informa preços, aprova, reserva estoque ou movimenta financeiro. Consulta informa o status atual, não expõe custos, preço interno ou notas internas.

O n8n foi confirmado online em `https://n8n.lablayer.com.br/` (`/healthz` respondeu ok, proxy em `127.0.0.1:5679`). O usuário informou ter perdido a senha. A tela `/forgot-password` informa que envio de e-mail não está configurado. O usuário SSH `lablayer` não administra Docker e a chave disponível não autentica como root. Nenhum workflow, credencial ou usuário n8n foi modificado. Recuperar o administrador do servidor/n8n é a dependência da próxima etapa; não executar reset geral de usuários sem backup e avaliação de impacto.

## Regras e segurança

- Segredo aleatório de 256 bits; só SHA-256 fica no Firestore. O token completo é devolvido uma vez na criação, não aparece em listagens nem em auditoria. O fragmento da URL não chega ao servidor; APIs recebem o segredo por Authorization. Respostas são privadas e sem cache; página usa no-referrer e noindex.
- Link vinculado a tenant e vendedor no servidor; o corpo não aceita tenant, preço, status ou permissões. Revogação, validade e empresa ativa são conferidas em cada operação, dentro das transações de gravação.
- Dois links da mesma empresa não leem pedidos/anexos um do outro. A pessoa autenticada na empresa consulta anexos/complementos da equipe; membro revogado é bloqueado.
- Cada envio tem identificador estável + hash do conteúdo. Reenvios concorrentes criam um só pedido e auditoria; reutilização do identificador com conteúdo diferente retorna 409. Complementos seguem a mesma regra. No navegador, falha mantém o corpo enviado para repetição; recarregar a página encerra esse estado em memória — conferir Meus pedidos antes de iniciar outro envio após uma falha.
- Quantidade inteira de 1 a 100.000. Apenas número seguido de unidade/unidades/unid/peça(s) gera sugestão. Medidas e telefone não geram quantidade. Sem indicação: 1 unidade provisória, destacada no formulário e na descrição. Cliente identificado por `Cliente:` ou preenchido na conferência; ausente permanece em branco.
- Texto inicial até 4.000 caracteres, título 150, cliente 120, complemento 2.000. Até 100 complementos por pedido. Sem reconhecimento semântico: enviar um pedido por vez e conferir os dados.
- 30 links ativos por empresa; limite persistente de 100 novos pedidos e 50 MiB de uploads por link/dia UTC. Limite em memória de 120 operações por link/minuto, por processo. Não substitui proteção de borda contra abuso distribuído. Falha de armazenamento após reserva de quota pode consumir quota de upload sem publicar o anexo (comportamento conservador).
- Anexos até 10 MiB cada: PNG/JPEG/WebP e áudio MP3/M4A/WebM/OGG/WAV. Validação de extensão/MIME/assinatura, sem execução; não é antivírus nem validação completa de codec. Bytes preservados no armazenamento privado configurado, integridade conferida no download. O upload deve finalizar antes de vincular o arquivo ao pedido. Upload sem conclusão do cadastro pode deixar arquivo órfão; retenção/coleta é evolução posterior.
- Metadados separados: `assistantLinks/{hash}` com subcoleções requests/assets; `tenants/{tenant}/assistantRequests/{request}/notes`; anexos na coleção assets já existente e auditLogs. Sem mudanças nas regras Firestore: essas novas coleções são acessadas somente pelo backend; clientes Firebase não têm acesso direto.
- Integração com a fila atual `customRequests` (compatível com produção). Se `inventoryControl/state.phase` existe e não é `legacy`, novos pedidos são bloqueados para evitar registros invisíveis no fluxo novo E3/E5. A conexão do assistente com esse fluxo deve ser feita antes da migração da empresa. Consultas/complementos históricos continuam disponíveis.

## Rotas

Gerência autenticada: GET/POST `/api/tenants/:tenantId/assistant-links`, POST `.../:key/revoke`. Consulta interna: GET `/api/tenants/:tenantId/assistant-requests/:requestId`.

Acesso por link: GET `/api/assistant`; POST `/api/assistant/draft`; POST `/api/assistant/requests`; GET `/api/assistant/requests/:id`; POST `.../:id/notes`; POST `/api/assistant/assets` (binário, cabeçalhos X-File-Name e X-File-Type); GET `/api/assistant/assets/:id`.

Não foram criados webhooks públicos do n8n, nem fornecidas chaves administrativas ao navegador. O endpoint WhatsApp anterior não participa deste fluxo.

## Próxima etapa de IA/n8n

1. Recuperar o administrador do n8n preservando o volume/banco e conferir versão, workflows e tipos de credenciais existentes, sem exportar segredos.
2. Escolher/configurar provedor e orçamento de uso. Conectar interpretação, leitura de imagem e transcrição a um webhook autenticado servidor→n8n; impedir logs com segredos e definir retenção de execuções contendo dados dos pedidos.
3. Tratar a saída da IA como proposta de campos, nunca comando autorizado. Validar novamente no LabLayer, manter conferência do vendedor e gravar exclusivamente pelas rotas de negócio restritas.
4. Testar indisponibilidade, respostas inválidas, prompt injection nos anexos/textos, repetição, limite de custo e isolamento; só então ativar IA. Até lá, o modo guiado permanece funcional e é identificado como tal.

## Verificação e publicação

Testes de unidade/UI e integração com Firestore emulado cobrem quantidade, limites, campos proibidos, permissão de gerência, segredo não retornado na lista, isolamento de vendedor/empresa, anexos, falha de armazenamento, integridade, reenvio concorrente, complementos, status sem custos internos, revogação, expiração, tenant inativo, cotas e bloqueio após migração. As suítes preexistentes são executadas em ambas as bases.

Publicação utiliza o worktree de release compatível com produção, preservando a branch de estabilização E0–E5. Backup do código e índice antes da troca; assets publicados antes do índice, PM2 recarregado e saúde conferida. Nenhuma importação/duplicação dos 27 pedidos existentes faz parte desta entrega. Dados de produção e criação do link inicial são conferidos por script restrito, com segredo fora do Git.

### Resultado confirmado

- Release: `npm run quality` aprovado — 23 testes unitários/UI + 46 de integração = **69**; TypeScript, build e auditoria de produção com zero vulnerabilidades.
- Base E0–E5: `npm run quality` aprovado — 191 testes unitários/UI + 184 de integração = **375**; TypeScript, build e auditoria aprovados.
- Publicação em produção: `/api/health` OK; acesso sem credencial ao assistente retorna 401; link do vendedor e preparação de rascunho retornam 200.
- Conta verificada: elvisbmartins@gmail.com; empresa vinculada conferida. Primeiro link “Elvis — vendas” criado, válido até 19/01/2027, com auditoria. Segredo guardado fora do Git e entregue ao usuário.
- Snapshot anterior e posterior: **27 pedidos**, mesmo digest SHA-256 `11965d91f02b42a5540b1efaf655f9a99f2d927fed05c0defb8fff09dc5321aa`. Nenhum orçamento de teste foi cadastrado na empresa.
- Navegador: menu Assistente com link ativo, chat acessível, rascunho com 10 unidades + medida 12 cm interpretado como quantidade 10, largura de 390 px sem rolagem horizontal. Rascunho de teste descartado sem cadastro. Ajustado também o título da barra superior; lint, testes de UI/unidade e build repetidos para esse ajuste visual.
- Evidências: [chat mobile](evidencias/assistente-mobile-20261021.png), [conferência mobile](evidencias/assistente-conferencia-mobile-20261021.png).
- Backup: `/home/lablayer/deploy-backups/assistant-a9c8b82-before.tar.gz`; pacote e verificação em `/home/lablayer/releases/assistant-a9c8b82/`. Não houve alteração de regras Firestore, credenciais n8n ou configurações financeiras.

### Atualização: acesso ao n8n recuperado

Login confirmado em 21/10/2026 após o usuário recuperar o acesso. Versão 2.26.4, um workflow de WhatsApp publicado e nenhuma credencial de provedor cadastrada visível. O bloqueio de login foi resolvido; escolha e configuração da API de IA continuam pendentes. Conferência e desenho da integração: [contrato do assistente IA](../n8n/assistente-ia-contrato.md). Nenhuma alteração na automação de WhatsApp ou no modo guiado publicado.
