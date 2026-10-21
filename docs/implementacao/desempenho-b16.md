# B16 — carregamento por tela

As 21 telas autenticadas passam a ser carregadas sob demanda. Login, navegação e contexto de autenticação permanecem na entrada. O SDK Firebase fica em um arquivo compartilhado, permitindo cache independente do código de tela. O limite de aviso do Vite permanece em 500 kB.

## Comportamento

- A fase operacional continua escolhendo entre legado e fluxo canônico; os atalhos antigos levam a produtos, orçamento, estoque e financeiro canônicos após o corte E3.
- Durante download da tela, há indicação acessível de carregamento. Não se anuncia sucesso de operação por download concluído.
- Falha do módulo/renderização preserva o menu e oferece recarga manual, com aviso sobre campos não salvos. Não há reload automático, reenvio de comando ou repetição de pagamento. Outra opção do menu pode ser acessada. Um módulo cujo download falhou exige recarga completa para nova tentativa.
- Mudança de empresa/fase/tela reinicia a fronteira de recuperação e desmonta a tela anterior. Listagem/editor legado conservam o identificador do produto em estado do App.

## Medição do build

| Métrica | B15 | B16 |
|---|---|---|
| JS inicial (entrada + imports estáticos/preload) | 1.190,36 kB | 714,69 kB |
| JS inicial gzip, soma dos arquivos | 291,28 kB | aproximadamente 187,11 kB |
| Maior arquivo JS | 1.190,36 kB | 471,82 kB |
| Aviso de arquivo acima de 500 kB | Sim | Não |

A redução inicial é de aproximadamente **40% sem compressão** e **36% com gzip**. Inclui Firebase (471,82 kB) e entrada (242,87 kB); não comparar somente a entrada de 242,87 kB com todo o bundle antigo. Telas autenticadas e dependências específicas são transferidas ao serem abertas. Isso não significa redução de 40% no tempo de resposta ou no total transferido ao visitar todas as telas. Não houve benchmark de rede real, consulta Firestore ou carga concorrente.

Evidência de arquivos e inspeção de login no navegador: [build B16](./evidencias-b16-build.json). Login renderizado pelo build final via preview local, sem erros/avisos no console consultado; não foram inseridas credenciais. Paginação/agregações além dos limites publicados continuam pendentes de volume e medição do piloto.

## Verificação

Cinco casos novos em `tests/unit/navigation-ui.test.tsx` cobrem seleção de telas após o corte, preservação de lista/editor legado, autenticação/fase incerta, carregamento assíncrono e falha de módulo com recuperação para outra tela. Os casos de navegação isolam dados/identidade com mocks; os testes de domínio e integração existentes continuam cobrindo operações reais no emulador. A validação autenticada no ambiente separado permanece no roteiro do piloto.

Barreira integral aprovada em 21/10/2026: **301 testes** (158 unitários/interface em 18 arquivos e 143 de integração em 11 arquivos), TypeScript, build e auditoria de produção sem alertas. Os 296 testes anteriores passaram sem alteração. [Log completo](./evidencias-b16-quality.txt).
