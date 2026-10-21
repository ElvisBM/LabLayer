# Assistente IA — contrato de integração e conferência do n8n

## Estado conferido em 21/10/2026

O usuário recuperou o acesso ao n8n e autorizou sua utilização para continuar a integração do assistente. Login conferido pelo navegador. Credencial de login não armazenada neste documento, no repositório ou em scripts.

- Instalação: https://n8n.lablayer.com.br/ — versão exibida **2.26.4**.
- Um workflow listado: **Whatsapp Encomendas e Orcamentos LabLayer**, ID `IgH0E3hD739uBBWE`, publicado.
- Nós visíveis: Webhook WhatsApp → Normalizar Solicitação → Criar Solicitação no LabLayer.
- A página Credentials mostra **Add first credential**: nenhuma conexão cadastrada visível para a conta.
- API disponível no menu Settings → n8n API; nenhuma chave listada. Nenhuma chave criada nesta conferência.
- Automação existente preservada. Não foram executados seus nós, alterados parâmetros ou publicados workflows.
- A chave Gemini do ambiente do LabLayer havia sido conferida como não configurada na entrega anterior.

**Pendência atual:** escolher o provedor e cadastrar sua credencial API no n8n. Acesso ao painel foi resolvido; a conexão de IA ainda não foi configurada. Não confundir login do n8n, assinatura de aplicativo de IA e credencial API do provedor.

## Fluxo preparado para implementação

LabLayer autenticará o link do vendedor e a empresa, verificará propriedade dos anexos e limites, e chamará um workflow separado. O n8n somente interpretará a solicitação e devolverá uma proposta de dados. Não receberá credenciais administrativas, acesso ao Firestore ou permissão para alterar preço, estoque, status ou financeiro.

Sequência de nós planejada:

1. **Webhook Assistente IA**: POST, autenticação Header Auth com segredo específico servidor→n8n; resposta apenas ao término. Endpoint separado do WhatsApp.
2. **Validar entrada**: versão de esquema, identificador, tamanho do texto, número/tamanho/tipos dos anexos. Rejeitar payload inválido antes da IA.
3. **Interpretar pedido**: provedor pendente. Texto, imagens e áudio tratados como dados, nunca instruções para executar ferramentas. Conservar transcrição quando houver áudio; sinalizar ambiguidades e informações ausentes.
4. **Normalizar resposta**: somente campos permitidos, quantidade desconhecida explícita; nenhuma inferência de preço ou aprovação.
5. **Responder ao LabLayer**: JSON com o identificador de correlação. O servidor valida novamente, o vendedor confere a proposta e a gravação segue as regras existentes.

O formato final e os codecs suportados serão fechados com o provedor escolhido. Não enviar URLs arbitrárias para o workflow baixar: somente bytes de anexos já conferidos e pertencentes ao link. Não transmitir o token do vendedor, chave administrativa do LabLayer ou histórico de outros clientes.

## Proposta de contrato, ainda não implementada

Entrada: `schemaVersion`, `requestId`, `message`, `attachments` (MIME e bytes codificados dos arquivos autorizados). Identificadores internos de tenant e vendedor permanecem no LabLayer.

Resposta: `schemaVersion`, `requestId`, `suggestion` (título, cliente, descrição, quantidade inteira ou null), `transcript` quando aplicável, `warnings` para dúvidas. Limites e campos permitidos serão impostos pelo servidor, inclusive se a IA descumprir o esquema. Cliente não decide a empresa por conteúdo da mensagem.

Preparar o rascunho não significa cadastrar ou aprovar. Informar sucesso somente após persistência do pedido e anexos; reenvio conserva identificador para não duplicar. Falha/timeout da IA deixa o texto e os anexos disponíveis no modo guiado, com aviso explícito, sem fingir interpretação realizada.

## Controles antes de ativar

- Credencial do provedor armazenada no n8n; segredo do webhook no gerenciador de credenciais do n8n e ambiente privado do servidor. Nenhum segredo em JSON exportado, código ou navegador.
- Workflow sem salvamento de conteúdo de execuções manuais/sucesso/falha e sem progresso persistido, salvo uma necessidade operacional explicitamente revisada. Auditoria no LabLayer apenas de metadados necessários.
- Limite de tamanho combinado considerando codificação base64 e payload do n8n; timeout; cotas por link e empresa; controle de tentativas para conter consumo de IA.
- Testes sintéticos primeiro: texto, imagem, áudio, quantidade ausente, medida diferente de quantidade, ambiguidade, prompt injection, resposta fora do esquema, falha de provedor, quota, segredo ausente/incorreto, link revogado e isolamento entre empresas.
- Publicar/ativar somente após credenciais, validação ponta a ponta e regressão. O modo guiado publicado permanece funcionando até lá.

Referências oficiais consultadas: [Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [Configuração de workflow](https://docs.n8n.io/workflows/settings/), [Autenticação da API](https://docs.n8n.io/api/authentication/).
