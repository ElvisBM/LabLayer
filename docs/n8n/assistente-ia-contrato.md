# Assistente IA — integração LabLayer / n8n / OpenAI

## Atualização de atendimento compartilhado

A configuração mais recente e os resultados de ativação estão em [Atendimento compartilhado e Luna](../implementacao/assistente-compartilhado-20261021.md). A implementação abaixo documenta a integração original; o modelo de interpretação passa a `gpt-6-luna`, sem raciocínio adicional.

## Implementação de 21/10/2026

A conexão `OpenAI — LabLayer Bot` foi conferida no n8n com `Connection tested successfully`. A chave permanece no gerenciador de credenciais do n8n. Nenhuma chave do provedor é necessária no ambiente do LabLayer, no código, no workflow exportado ou no navegador do vendedor.

Workflow separado: **LabLayer — Assistente IA v1**, ID `qcfswpWqCsxJUtCd`. O workflow preexistente **Whatsapp Encomendas e Orcamentos LabLayer** (`IgH0E3hD739uBBWE`) foi preservado. A ativação do assistente por empresa é controlada no servidor; publicação do workflow, isoladamente, não habilita os vendedores. **Estado atual: workflow publicado e IA habilitada para a empresa de Elvis após testes reais aprovados com saldo. Atendimento compartilhado ativo; modo manual continua disponível.**

## Responsabilidades e autenticação

1. O vendedor usa o link exclusivo já existente. O LabLayer verifica validade, empresa ativa, anexos pertencentes ao link e cotas.
2. O servidor prepara uma autorização aleatória de 256 bits, de uso único, válida por 30 segundos. Apenas essa autorização segue ao webhook `POST /webhook/lablayer-assistant-ai-v1`.
3. O workflow troca a autorização em `POST /api/internal/assistant-ai/exchange`. A troca consome o ticket antes de qualquer operação assíncrona e revalida o acesso. Ticket inválido, vencido ou repetido retorna 403. Sem troca válida, o fluxo para antes de chamar OpenAI.
4. A troca retorna somente o pedido atual, bytes dos anexos e identificador de correlação. Não transmite token do vendedor, identidade de empresa, histórico de clientes, credenciais administrativas ou acesso ao Firestore.
5. O n8n transcreve um áudio quando presente e solicita extração estruturada do pedido. O servidor valida a resposta e revalida o acesso novamente antes de devolver a proposta.
6. O vendedor confere e edita os campos. Somente `Cadastrar no LabLayer` persiste a solicitação usando as regras e idempotência existentes. IA não calcula preço, aprova pedido nem movimenta estoque.

A autorização efêmera substitui o Header Auth estático previsto inicialmente. Evita uma segunda credencial permanente entre serviços e limita cada autorização a um único pedido. Tickets ficam em memória, com no máximo 20 pendentes; reinício invalida todos. Esta versão suporta **um processo PM2**, como a instalação atual. Antes de usar múltiplas instâncias, mover a troca para armazenamento compartilhado com consumo atômico e expiração.

## Modelos e dados

- Interpretação: `gpt-6-luna`, `reasoning.effort: none`, Responses API, `store:false`, saída estrita JSON Schema, até 1.800 tokens de saída, sem ferramentas.
- Transcrição: `gpt-transcribe`, endpoint `/v1/audio/transcriptions`, idioma português. Modelo corrente conferido na documentação; modelos legados de transcrição possuem descontinuação anunciada.
- Até 6 anexos, 8 MiB combinados para interpretação; upload normal continua aceitando 10 MiB por arquivo.
- Imagens PNG/JPEG/WebP. Um áudio MP3/M4A/WAV/WebM por interpretação. OGG e múltiplos áudios permanecem anexados para a equipe, com aviso de modo guiado.
- Transcrição até 1.200 caracteres; acima desse limite a interpretação falha de forma explícita e conserva o áudio para conferência manual.
- Texto e imagens são tratados como dados não confiáveis, nunca como instruções executáveis. Não há download de URL fornecida pelo vendedor.
- Sem quantidade explícita ou diante de ambiguidade: quantidade `null` na IA → 1 unidade provisória no LabLayer. Medidas, telefones e quantidade de objetos na foto não devem virar quantidade solicitada; conferência humana continua obrigatória.
- A descrição e a transcrição exibidas são editáveis/conferíveis antes do cadastro; áudio original continua anexado. O texto original fica preservado em `sourceMessage`.

## Limites e falhas

- 30 interpretações por link/dia e 300 por empresa/dia (UTC), persistidas em Firestore e cobradas antes da chamada, inclusive em tentativa com erro.
- Uma interpretação simultânea por link. Timeout de 90 segundos; chamadas HTTP a cada etapa da OpenAI limitadas a 45 segundos.
- Resposta do workflow limitada a 64 KiB, com correlação e campos permitidos conferidos. Redirecionamentos no servidor são recusados e a URL é restrita ao domínio do n8n da instalação.
- Falha, indisponibilidade, conteúdo inválido ou anexos fora dos limites: preenchimento guiado com aviso. Nunca anunciar interpretação ou cadastro como concluídos quando não ocorreram.
- Checkbox `Preencher manualmente, sem usar IA` permite seguir sem consumir a API.
- Link revogado durante a interpretação não recebe proposta nem sucesso em fallback.
- n8n: salvar execuções com sucesso, erro, manuais e progresso = **Do not save**; sem workflow de erro com transmissão de conteúdo; timeout 1 minuto e 30 segundos. Importação pelo editor não conservou todas as configurações do JSON, por isso foram conferidas e ajustadas na interface.

## Configuração e operação

`LABLAYER_ASSISTANT_N8N_URL=https://n8n.lablayer.com.br/webhook/lablayer-assistant-ai-v1`

`LABLAYER_ASSISTANT_AI_TENANTS` contém os IDs permitidos separados por vírgula. Na publicação inicial, restringir à empresa sintética de QA; liberar a empresa real somente após validação ponta a ponta. Sem URL, modo guiado. Sem lista, todas as empresas válidas podem usar a IA — manter lista explícita em produção.

Gerador sem segredos: `node scripts/n8n/build-assistant-workflow.mjs DESTINO_JSON ID_DA_CREDENCIAL`. A credencial é vinculada pelo ID; seu valor nunca é exportado. Após importar, conferir Settings e salvar antes de publicar.

A API usa o saldo e os limites da conta OpenAI configurada no n8n. As cotas de requisições do LabLayer reduzem abuso, mas não substituem alertas de gastos e limites do provedor.

## Verificação

Cobertura nova: resposta estruturada, unidade provisória, campos indevidos, resposta excessiva, uso único e expiração de tickets, domínio permitido, revogação, cotas por empresa/vendedor, concorrência, anexos próprios, integridade de arquivo, modo manual e falha externa. Teste de interface exige conferência antes da persistência e mostra transcrição.

Resultados finais e situação da publicação: consultar `docs/implementacao/assistente-ia-20261021.md`.

Referências oficiais: [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Transcrição](https://developers.openai.com/api/docs/guides/speech-to-text), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [n8n HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/), [n8n workflow settings](https://docs.n8n.io/workflows/settings/).
