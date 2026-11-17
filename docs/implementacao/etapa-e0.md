# E0 — Proteção dos dados e contratos

## B01: provisionamento, isolamento e recuperação

**Regra corrigida (DV27):** o navegador não cria/edita perfis nem concede empresa, papel ou plano. `POST /api/session` verifica o ID token Firebase com checagem de revogação e cria empresa free/perfil em uma transação. O corpo não concede privilégios. Repetição preserva empresa e plano; membro mantém vínculo; vínculo órfão ou empresa inativa produz erro, sem assumir outra empresa.

Superadmin passa a depender da custom claim `superadmin: true` emitida por administração confiável do Firebase Auth. Email e `users.role` não conferem esse acesso. O dono legítimo mantém acesso à operação e alteração de nome da empresa; plano/status só podem ser alterados por claim administrativa. Perfis legados sem vínculo só são reparados para a própria empresa do UID, verificando propriedade.

**Recuperação:** `server/tenant-backup.ts` exporta a árvore da empresa, coleções desconhecidas/subcoleções e perfis vinculados, com páginas por ID. Também visita subcoleções cujos documentos pais estão ausentes. Tipos Timestamp, referência, bytes e GeoPoint têm serialização explícita. A restauração é exclusiva de emulador local com projeto `demo-*`, usa criação sem sobrescrita e exige destino vazio para os documentos. Falha entre lotes exige limpar a cópia local e repetir; não há promessa de restauração atômica de toda a base.

O ensaio final usa 516 documentos sintéticos, mais do que o limite antigo de 500, e compara todos os caminhos/valores após restaurar, inclusive subcoleção de perfil. Outra empresa permanece intocada. A ferramenta recusa destino que contenha subcoleções mesmo se o documento pai estiver ausente. Não é backup global do Firebase: não inclui arquivos do Storage, Firebase Auth, índices, rules ou coleções globais de integrações. Uma cópia consistente exige pausar todos os escritores durante a exportação.

Ferramenta operacional, a executar apenas no ambiente escolhido e após pausa de escrita:

```sh
npx tsx tools/tenant-backup.ts --mode export --project PROJETO --database BANCO --tenant EMPRESA --file backups/empresa.json --writes-paused
```

Usa Application Default Credentials; não colocar credenciais no comando ou no repositório. Arquivo novo com permissão 0600; não sobrescreve backup existente. Nenhuma exportação real foi executada nesta etapa.

Para ensaio local, iniciar o emulador, definir `FIRESTORE_EMULATOR_HOST=127.0.0.1:8088` e executar:

```sh
npx tsx tools/tenant-backup.ts --mode restore-emulator --project demo-lablayer-test --file backups/empresa.json
```

## Evidências B01

| Verificação | Resultado esperado |
|---|---|
| 7 testes unitários de sessão/IDs | Importação sem Firebase; indisponibilidade explícita; IDs inválidos rejeitados |
| 3 testes de interface de autenticação | Empresa vem do servidor; erro não concede acesso; resposta tardia após logout é descartada |
| 16 testes de integração de acesso/provisionamento | Isolamento, privilégios, dono/membro, criação concorrente, vínculo legado e sessão autenticada |
| 2 testes de backup/recuperação após revisão final | 516 documentos exportados/restaurados com igualdade integral; projeto real e destino não vazio rejeitados |
| TypeScript e build | Compilação sem erro; aviso preexistente sobre tamanho do bundle registrado |

## Cuidados de implantação obrigatórios

Não ativar somente as rules nem somente a interface. Antes de liberar: conferir a versão/rules implantadas, reconciliar vínculos atuais (as rules antigas permitiam autoconcessão), atribuir a claim ao administrador legítimo por canal confiável, verificar Firebase Admin/Auth no servidor e ensaiar login de dono/membro. Implantar servidor, interface e rules coordenadamente em manutenção; exigir atualização de sessões antigas. Não inferir superadmin de papel legado potencialmente adulterado.

Essas verificações de produção permanecem pendentes. Não houve acesso a credenciais, dados reais ou implantação. Os testes de `/api/session` usam verificador injetado; integração real Firebase Auth e configuração do serviço precisam de homologação no ambiente de teste da implantação.

Uma auditoria de dependências detectou alertas na árvore instalada. O tratamento e as pendências estão no fechamento abaixo.

## B02: contrato de entrada, concorrência e auditoria

DV28–DV31: normalização separada entre criação e PATCH; aliases removidos; esquema explícito e referências verificadas na mesma empresa. PATCH conserva campos omitidos, inclusive imagens, preço zero e arrays; números inválidos são rejeitados em vez de convertidos silenciosamente. CreatedAt é imutável. POST com ID existente retorna 409, incluindo duas criações concorrentes.

Toda mutação administrativa permitida grava documento e auditoria na mesma transação. Ator vem da chave autenticada. A API mantém leitura dos domínios existentes, mas restringe escrita a solicitações, fornecedores, canais e settings conhecidos. Operações genéricas de estoque/produção/venda e DELETE estão suspensas até os respectivos comandos; não há bypass pelo token técnico. Chaves individuais precisam de escopo explícito para escrita.

WhatsApp exige credencial por empresa e ID estável da mensagem; criação, recibo e auditoria são atômicos. Retransmissão conserva o documento; conflito de conteúdo retorna 409. Só permite solicitação inicial, sem aprovação/pagamento por mensagem. O workflow de referência foi atualizado, sem publicação no n8n. Conectores incompletos retornam 501, eliminando gravação global e sincronização sem autenticação.

DV33: exportação de coleções recebe cursores por ID, sem limite total de 500 quando o cliente percorre as páginas. Continua explicitamente diferente do backup recursivo de B01.

Testes adicionais: contrato puro, workflow n8n executado com dados sintéticos, API HTTP real com emulador, PATCH concorrente, criação concorrente, falha de auditoria sem gravação, referências entre empresas, permissões das chaves, compatibilidade API→rules de cliente, exportação de 505 registros e duplicação concorrente de mensagem.

A caracterização dos 24 casos da auditoria agora lê o commit original por `git show`; é evidência histórica, não aprovação do código novo. C13–C15 têm regressões com a expectativa corrigida em `tests/`. O contrato atualizado está em [API administrativa](../admin-api.md).

## B03: preservação e funcionalidades disponíveis

DV09/DV14: a ação de exclusão de produto passa a arquivar usando status `inativo`. Mantém ID, ficha, histórico, perdas, horas e saldos. A reativação usa o status do cadastro. O cálculo legado de consumo ainda considera essas fichas; não filtrar produtos inativos desse cálculo antes da migração E2/E3.

Rules bloqueiam DELETE de produto e modificação do array histórico `pricingHistory`. Salvar sugestão na calculadora grava uma nova subcoleção `products/{id}/pricingSnapshots` e atualiza o resumo em um batch: registros novos não podem ser editados/apagados e os 50 registros legados não são truncados. `actorUid` é conferido pelas rules e `calculationVersion=legacy-ui` deixa explícito que ainda se trata do motor antigo. O recálculo em massa que alterava preços/histórico foi retirado. E1 ainda precisa conferir o cálculo e tornar a emissão autoritativa no servidor.

Um cliente antigo não pode apagar produto com devolução em batch, nem reduzir separadamente `usedHours` da impressora. Horas existentes ficam preservadas até o comando de execução da E3. Produção concluída não pode ser atualizada, reaberta ou excluída pelo cliente. Repetir o batch de conclusão falha inteiro e não duplica a entrada; isso é uma proteção temporária, não substitui o comando idempotente da E3. Correção de execução concluída precisará de evento compensatório.

DV32: configurações mostram os quatro conectores como em desenvolvimento e deixam de solicitar credenciais sem persistência. Vendas mantém cadastro manual e informa a indisponibilidade de CSV/sincronização; não oferece processamento fictício. Rotas já foram suspensas em B02.

Testes adicionais executam as funções usadas pela interface contra as rules reais: arquivamento repetido, tentativa de batch destrutivo, horas preservadas, nova sugestão com 50 registros antigos, imutabilidade, ator, acesso entre empresas, proteção de execução concluída e repetição de conclusão. Testes de componentes verificam a comunicação e ausência de ações enganosas.

## Fechamento local e pendências

Execução final: Node 22.23.3, Java 21, Vitest 4.1.11, Vite 6.4.3, Firestore Emulator 1.22.0. Comando `npm run quality`: **exit 0**, 29 testes unitários/componentes + 47 testes de integração, TypeScript e build sem erros. Nenhum teste foi ignorado. A verificação de diff não encontrou erros de whitespace. A auditoria histórica do commit original permanece com 24 casos confirmados, separada da aprovação das regras corrigidas.

O QA usa o fluxo oficial de [testes de rules com emulador](https://firebase.google.com/docs/rules/unit-tests), com SDK cliente para avaliar as rules e Admin SDK somente para preparar/verificar fixtures sintéticas. Testes de HTTP exercitam a aplicação Express, com banco real emulado; validação do ID token é injetada nesses testes. Não houve teste de credencial real, navegador contra produção, volume de produção ou integração externa.

Atualizações compatíveis do lockfile removeram alertas, incluindo o crítico inicial. Overrides específicos usam `@grpc/grpc-js=1.14.5` no Firestore cliente e `qs=6.16.0`; a suíte de emulador/HTTP foi repetida integralmente com essas versões. Não foi usado `npm audit fix --force` nem downgrade do Firebase. Node 22 foi registrado em `.nvmrc` e engines; CI e deploy usam esse runtime.

O gate adicional `npm run audit:production` falha para severidade alta/crítica. Resultado final: **0 altos/críticos em produção**, mas ainda 8 pacotes com alerta moderado e 1 baixo. A árvore completa contém 7 altos, 10 moderados e 1 baixo; os altos restantes estão na ferramenta Firebase CLI e dependências de desenvolvimento. As contagens incluem propagação de um advisory por vários pacotes. Relatório sanitizado em [dependencias-e0.json](./dependencias-e0.json). Esses avisos não foram classificados como resolvidos; atualizar SDK Admin/CLI exige avaliação própria de compatibilidade. O comando geral `npm audit` ainda retorna 1.

Permanece o aviso de bundle JS acima de 500 kB (aproximadamente 1,05 MB antes de gzip). Otimização de carregamento fica na evolução de desempenho; não altera a aprovação funcional da E0.

**Limite da entrega:** E0 implementada e validada localmente. A liberação em produção continua condicionada ao procedimento acima e à revisão dos alertas remanescentes. E1 ainda não começou; divergências de custos, unidade/lote e modelo de estoque não foram apresentadas como corrigidas por estes testes.
