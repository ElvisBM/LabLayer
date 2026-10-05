# E0 — Proteção dos dados e contratos

## B01: provisionamento, isolamento e recuperação

**Regra corrigida (DV27):** o navegador não cria/edita perfis nem concede empresa, papel ou plano. `POST /api/session` verifica o ID token Firebase com checagem de revogação e cria empresa free/perfil em uma transação. O corpo não concede privilégios. Repetição preserva empresa e plano; membro mantém vínculo; vínculo órfão ou empresa inativa produz erro, sem assumir outra empresa.

Superadmin passa a depender da custom claim `superadmin: true` emitida por administração confiável do Firebase Auth. Email e `users.role` não conferem esse acesso. O dono legítimo mantém acesso à operação e alteração de nome da empresa; plano/status só podem ser alterados por claim administrativa. Perfis legados sem vínculo só são reparados para a própria empresa do UID, verificando propriedade.

**Recuperação:** `server/tenant-backup.ts` exporta a árvore da empresa, coleções desconhecidas/subcoleções e perfis vinculados, com páginas por ID. Também visita subcoleções cujos documentos pais estão ausentes. Tipos Timestamp, referência, bytes e GeoPoint têm serialização explícita. A restauração é exclusiva de emulador local com projeto `demo-*`, usa criação sem sobrescrita e exige destino vazio para os documentos. Falha entre lotes exige limpar a cópia local e repetir; não há promessa de restauração atômica de toda a base.

O ensaio usa 515 documentos sintéticos, mais do que o limite antigo de 500, e compara todos os caminhos/valores após restaurar. Outra empresa permanece intocada. A ferramenta não é backup global do Firebase: não inclui arquivos do Storage, Firebase Auth, índices, rules ou coleções globais de integrações. Uma cópia consistente exige pausar todos os escritores durante a exportação.

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
| 1 ensaio de backup | 515 documentos exportados/restaurados com igualdade integral |
| TypeScript e build | Compilação sem erro; aviso preexistente sobre tamanho do bundle registrado |

## Cuidados de implantação obrigatórios

Não ativar somente as rules nem somente a interface. Antes de liberar: conferir a versão/rules implantadas, reconciliar vínculos atuais (as rules antigas permitiam autoconcessão), atribuir a claim ao administrador legítimo por canal confiável, verificar Firebase Admin/Auth no servidor e ensaiar login de dono/membro. Implantar servidor, interface e rules coordenadamente em manutenção; exigir atualização de sessões antigas. Não inferir superadmin de papel legado potencialmente adulterado.

Essas verificações de produção permanecem pendentes. Não houve acesso a credenciais, dados reais ou implantação. Os testes de `/api/session` usam verificador injetado; integração real Firebase Auth e configuração do serviço precisam de homologação no ambiente de teste da implantação.

Uma auditoria de dependências detectou alertas na árvore instalada. Eles não foram tratados como teste de negócio aprovado; revisão de dependências fica registrada para conclusão da E0, antes de liberação.
