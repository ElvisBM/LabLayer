# Atendimento compartilhado e GPT-6 Luna — 21/10/2026

## Regras

Solicitação de Elvis: acesso ao bot sem login, protegido pelo link com token aleatório; todos os vendedores da mesma empresa podem cadastrar, consultar e complementar todos os pedidos, independentemente de quem os recebeu.

- O link existente usa 32 bytes aleatórios (256 bits) no fragmento da URL (`/assistente#...`). O banco armazena somente SHA-256 do token. Validade de 90 dias e revogação continuam disponíveis.
- `tenants/{tenantId}.assistantSharedRequests === true` habilita a consulta compartilhada para todos os links válidos da empresa. Empresas sem essa configuração conservam o comportamento restrito ao link.
- A lista compartilhada lê `customRequests` da própria empresa, incluindo pedidos manuais, registros antigos sem data e pedidos de outros vendedores. Paginação de 100 registros por ID, com cursor; nenhum limite total de 100 pedidos.
- O detalhe compartilhado usa os dados atuais: título, cliente, quantidade, descrição, status e preço orçado quando informado. Não retorna custos internos, margem ou identidade técnica do link.
- Qualquer vendedor com o link pode acrescentar informações e anexos a um pedido da empresa. O complemento registra o nome do acesso que o enviou; se a equipe usa o mesmo link, a autoria será “Equipe de vendas”. Envio idempotente e auditoria preservados.
- Anexos compartilhados exigem vínculo com o pedido consultado. Upload ainda não utilizado permanece privado ao link de origem. Arquivos de outra empresa continuam inacessíveis; não se torna possível reaproveitar o upload de outro vendedor em um novo cadastro.
- Links revogados/expirados e empresas inativas não recebem acesso, mesmo no modo compartilhado. Preços, aprovação e estoque continuam fora das ações de escrita do bot.
- A tela mostra “Todos os pedidos”, botão para carregar mais registros, valor já orçado e complementos da equipe. Não exige sessão Firebase para abrir o bot.

## Modelo

Interpretação alterada para `gpt-6-luna`, Responses API, `reasoning.effort: none`, esquema estrito, sem ferramentas, `store:false` e limite de 1.800 tokens de saída. O workflow recebe o modelo do servidor. Sem troca automática para modelo mais caro em caso de falha.

Tabela oficial consultada em 21/10/2026: Luna é o mais barato entre os modelos atuais destacados, US$ 0,10 por milhão de tokens de entrada e US$ 0,50 por milhão de saída no processamento Standard. Isto não significa que seja o mais barato de todo o catálogo legado. Entrada de imagem suportada. Áudio usa `gpt-transcribe` antes da interpretação; cotas continuam 30 interpretações por link/dia e 300 por empresa/dia (UTC).

Fontes: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [preços](https://developers.openai.com/api/docs/pricing), [migração](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra#migration-quickstart).

## Qualidade e publicação

Release compatível com produção: `npm run quality` passou, com TypeScript, 30 testes unitários/UI, 56 testes de integração, build e auditoria de produção (zero vulnerabilidades). Uma falha inicial detectou alteração indevida do detalhe em links restritos; corrigida preservando a asserção anterior. Aviso de bundle acima de 500 kB permanece.

Base E0–E5: TypeScript, **198 testes unitários/UI + 194 de integração (392)**, build e auditoria de produção aprovados, sem falhas nesta execução. Auditoria: zero vulnerabilidades. Execução unitária com `--maxWorkers=1 --testTimeout=30000 --hookTimeout=30000`; integração com `--testTimeout=120000 --hookTimeout=60000` para acomodar a lentidão local já observada na etapa anterior. Nenhuma asserção ou configuração versionada foi relaxada.

Testes reais com OpenAI/n8n aprovados: quantidade explícita (10 peças e 4 cm), medida sem quantidade (12 cm → 1 provisória), instrução indevida de aprovação ignorada, imagem azul com 7 peças e áudio português transcrito com 10 peças de 4 cm. Nenhum orçamento foi cadastrado pelos testes. Empresa sintética, link e anexos removidos ao encerrar.

Ativação final concluída e conferida: `requestScope: tenant`, `mode: ai`, 27 pedidos listados e todos os 14 anexos de referência acessíveis pelo link. Conteúdo dos 27 registros conservou o hash anterior; acesso sem token retorna 401. Navegador confirmou “Todos os pedidos”, abertura da bonequinha ProFaby com imagem e retorno à lista. O link existente foi mantido e identificado como “Equipe de vendas”. Formulário conferido também em viewport 390 × 844, sem corte horizontal; viewport original restaurado após a verificação.

Evidências: [smoke da IA](evidencias/assistente-luna-smoke-20261021.json), [verificação do compartilhamento](evidencias/assistente-compartilhado-20261021.json), [tela publicada](evidencias/assistente-compartilhado-ativo-20261021.png).

Código da release: `b2cb1f8`. Backup anterior: `/home/lablayer/deploy-backups/assistant-shared-20261021-before.tar.gz`. Arquivos operacionais: `/home/lablayer/releases/assistant-shared-20261021/`. Publicação inicial limitada à empresa sintética de QA; após os testes, habilitada apenas a empresa real na lista de IA.

Rollback do compartilhamento: restaurar `assistantSharedRequests` e nome do link a partir de `sharing-before.json` no diretório operacional. Rollback de aplicação: restaurar código, índice e ambiente do backup; reiniciar PM2 com ambiente limpo. Despublicar workflow se a IA precisar ser pausada. Nunca guardar a chave OpenAI ou o token público no Git.
