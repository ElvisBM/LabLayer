# B17 — configuração explícita de homologação

A preparação local foi implementada sem criar projeto, ler credenciais reais, publicar código ou ativar empresas. A execução do piloto B11 continua dependendo da identificação da empresa, ambiente separado e documentos reais.

## Lacuna corrigida

O cliente sempre usava `firebase-applet-config.json`, mesmo se o backend apontasse para outro ambiente. Agora o build aceita uma configuração pública completa para homologação, selecionada explicitamente. Sem configuração alternativa, o build mantém os mesmos dados públicos do arquivo original.

- `LABLAYER_ENV=homologation` exige `LABLAYER_FIREBASE_CONFIG_FILE`. Ausência, JSON inválido ou campo obrigatório faltando interrompem o build; não se mesclam valores com produção.
- Projeto, domínio Auth e bucket precisam diferir da configuração de produção conhecida no repositório. Isso confere identificadores, não propriedade, DNS ou permissões reais.
- O arquivo do cliente aceita somente campos públicos Firebase. Uma conta de serviço ou campo extra como `private_key` é recusado. O build não define mais `process.env.GEMINI_API_KEY` para o navegador; não havia consumidor ativo desse valor.
- O build gera `dist/lablayer-environment.json` com ambiente, projeto, banco, bucket, domínio e hash da configuração pública. Não inclui chave privada, e-mail da conta de serviço ou API key.
- Em homologação, o servidor exige banco e bucket explícitos e iguais aos do cliente, além de conta de serviço do mesmo projeto. Recusa uma conta de serviço ambígua (arquivo e JSON inline simultâneos), emuladores configurados e SDK já inicializado para outro projeto.
- Com `NODE_ENV=production` (execução do build), o servidor também exige o manifesto do build correspondente. Falha de inicialização do Admin interrompe a partida. Em desenvolvimento com Vite, não exige um build prévio.
- `npm run check:homologation` executa a mesma conferência local incluindo manifesto, sem inicializar SDK, acessar rede ou abrir banco. Resultado `configuracao-local-consistente` **não comprova autenticação, IAM ou piloto aprovado**. A chave pode ter formato plausível e ainda ser inválida, revogada ou sem permissões; isso só é conferido no ambiente real.

As proteções novas são opt-in para homologação. Não substituir os identificadores reais no arquivo versionado nem reaproveitar o processo PM2/host/caminho de produção. Os testes E0–E5 continuam isolados por injeção de banco e seus guards próprios.

## Preparação para o ambiente identificado

1. Identificar projeto Firebase separado, tenant/empresa piloto, responsável, URL de homologação, banco e bucket. Configurar conta de serviço desse projeto pelo gerenciador de segredos ou arquivo fora do repositório; não enviar a chave pelo chat.
2. Obter a configuração **pública do aplicativo Web** desse projeto e salvá-la fora do repositório. Incluir `projectId`, `appId`, `apiKey`, `authDomain`, `firestoreDatabaseId` e `storageBucket`; opcionalmente `messagingSenderId` e `measurementId`. Não usar JSON de conta de serviço nesse arquivo.
3. Preparar arquivo de ambiente próprio, fora do deploy atual. Exemplo de estrutura (substituir todos os identificadores):

```dotenv
LABLAYER_ENV=homologation
LABLAYER_FIREBASE_CONFIG_FILE=/caminho/seguro/firebase-client-homologation.json
FIRESTORE_DATABASE_ID=(default)
FIREBASE_STORAGE_BUCKET=bucket-exclusivo-de-homologacao
FIREBASE_SERVICE_ACCOUNT_FILE=/caminho/seguro/firebase-service-account-homologation.json
NODE_ENV=production
PORT=3100
```

Usar **Node 22**, instalar pelo lockfile e executar a barreira completa antes de empacotar. Java 21 é necessário apenas para os testes no emulador. As variáveis usadas no build devem ser as mesmas do processo servidor. Exemplo a executar no checkout/caminho separado de homologação, com os caminhos reais:

```bash
npm ci
npm run quality
node --env-file=/caminho/seguro/lablayer-homologation.env node_modules/vite/bin/vite.js build
node --env-file=/caminho/seguro/lablayer-homologation.env --import tsx tools/check-homologation.ts
node --env-file=/caminho/seguro/lablayer-homologation.env --import tsx server.ts
```

A barreira executada antes do build alternativo não usa as credenciais de homologação. O `--env-file` carrega explicitamente o ambiente tanto no build quanto na conferência/servidor; não presumir que `npm start` carrega `.env.production` sozinho. Se as variáveis já estiverem no ambiente do processo, `npm run check:homologation` é equivalente ao comando de conferência. Variáveis do shell têm precedência; eliminar valores herdados conflitantes.

O exemplo não configura proxy/TLS/domínio, IAM, Auth, Firestore rules ou Storage rules. A porta e o processo de homologação precisam ficar isolados do ambiente real de operação. O workflow atual de Hostinger continua apontando para produção; não usá-lo para criar homologação. Nenhuma execução de SSH, push ou deploy foi feita neste bloco.

## Conferência operacional ainda pendente

Aplicar o [roteiro do piloto E5](./piloto-e5.md), incluindo:

- Login/provisionamento com Auth real, empresa correta e recusa de usuário sem permissão.
- Firestore rules e isolamento entre empresas, comandos autenticados e ausência de escrita direta nos eventos.
- Bucket privado: upload/download pela API, recusa de acesso público, IAM mínimo, migração de mídia conferida e backup/restauração dos objetos junto dos metadados.
- Backup de Firestore, Auth/configurações e Storage, com restauração em destino isolado conferida.
- Catálogo, abertura de estoque, orçamento aprovado, produção/expedição, recebimentos, perdas/devoluções e conciliação com documentos reais.
- Publicação coordenada do site/Apps Script e confirmação de recibo/linha sem duplicidade, em ensaio autorizado separado.

O ensaio E0 de backup cobre Firestore isolado; não afirmar que cobre Auth e objetos. A redução do bundle B16 não resolve limites de relatórios em grandes volumes: medir o piloto antes de dimensionar paginação/agregações.

## Evidências locais

Treze novos testes verificam configuração padrão, opt-in, recusa de dados incompletos/segredos/produção, igualdade de banco/bucket/conta/build, emuladores e bloqueio da inicialização insegura. Um build alternativo com projeto fictício confirmou que o JS contém a configuração fictícia e não o identificador do projeto de produção. A CLI local aceitou a fixture consistente e recusou divergência com código de saída 1. A fixture usa chave deliberadamente inválida para provar que a conferência é offline; nunca foi enviada ao SDK.

[Ensaio de build e CLI](./evidencias-b17-smoke.txt). Autenticação e operações reais continuam **não executadas**.

Barreira integral aprovada em 21/10/2026: **314 testes** (171 unitários/interface em 19 arquivos e 143 de integração em 11 arquivos), TypeScript, build e auditoria de produção com zero alertas. Todos os 301 testes anteriores passaram sem alteração. Build padrão final também aberto no navegador: login renderizado sem erros/avisos no console consultado, sem inserir credenciais. [Log B17](./evidencias-b17-quality.txt).
