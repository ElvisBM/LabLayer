# Execução da estabilização

Referência de partida: commit `0fd3cbe`; auditoria e plano preservados no commit `ee8f69d`. Branch de implementação: `fix/estabilizacao-e0`. Os documentos de mapeamento representam a versão original; este diretório registra mudanças e evidências posteriores.

## Regra de avanço

Cada bloco deve ter comportamento esperado, testes de negócio e qualidade, revisão do diff e commit próprio. Executar `npm run quality` com Node 22 e Java 21 antes do commit: TypeScript, testes unitários/interface, testes de integração no Firestore local, build e auditoria de dependências de produção (bloqueia severidade alta/crítica). Uma falha impede concluir o bloco ou avançar de etapa. Passar em testes locais não equivale a homologação de produção ou auditoria sem vulnerabilidades.

Os testes usam exclusivamente `demo-lablayer-test` em `127.0.0.1:8088`. O guard de integração recusa outros ambientes. O runner não carrega o `.env` nem a configuração Firebase da aplicação. `createApp` recebe banco/verificador de identidade por injeção; importar o servidor não lê credenciais nem abre serviços.

O CI de branches/PR executa a mesma barreira. O workflow de implantação existente passou a exigir testes antes do envio ao servidor. Nenhum push, implantação ou acesso a dados reais foi executado nesta implementação.

## Andamento

| Bloco | Escopo | Estado |
|---|---|---|
| E0.1/E0.2 — B01 | Ambiente isolado, ensaio de backup/restauração, provisionamento e acesso | Implementado; evidências em [E0](./etapa-e0.md) |
| E0.3/E0.4 — B02 | PATCH, schemas, criação com conflito, auditoria e entradas externas | Implementado e validado: 66 testes acumulados, tipos e build |
| E0.5/E0.6 — B03 | Histórico, arquivamento e comunicação de recursos incompletos | Implementado e validado: 75 testes acumulados, tipos e build |
| E1/B04 | Motor decimal versionado e contrato comercial | Implementado; 102 testes acumulados e gate completo aprovados; [E1](./etapa-e1.md) |
| E1/B05 | Cálculos compartilhados, pendências, snapshots no servidor e custo confirmado | Implementado; 123 testes acumulados, tipos/build/auditoria aprovados; [E1](./etapa-e1.md) |
| E2/B06 — preparação | Catálogo, variações, fichas versionadas, componentes e revisão do legado | Implementado; 158 testes acumulados e gate completo aprovados em 17/10/2026; [E2](./etapa-e2.md). Ativação operacional depende da E3 |
| E3/B07–B08 | Movimentos, custo médio, reservas, execução, montagem, expedição, conciliação e corte dos escritores antigos | Implementado localmente; 198 testes acumulados e gate completo aprovados; [E3](./etapa-e3.md). Ativação real pendente de homologação |
| E4/B09 | Propostas imutáveis, cálculo conferido, aprovação informada, pedido e atendimento E3 | Implementado localmente; 240 testes acumulados e gate completo aprovados; [E4](./etapa-e4.md). Homologação real pendente |
| E5 | Recebimentos, conciliação financeira e preparação do piloto | Implementado localmente; 274 testes acumulados e gate completo aprovados; [E5](./etapa-e5.md). Liberação do piloto real pendente |

**Fechamento local da E0:** 76 testes aprovados (29 unitários/componentes e 47 de integração), tipos e build aprovados, 0 alertas altos/críticos na árvore de produção. O ensaio final de restauração cobre 516 documentos e recusa destino com subcoleções órfãs. Ver [evidências e limites](./etapa-e0.md) e [auditoria de dependências](./dependencias-e0.json).

**Antes de implantação:** reconciliar vínculos legados, preparar a claim administrativa e homologar login/provisionamento com Firebase Auth real em ambiente separado; executar backup e liberação coordenada do servidor, cliente e rules. Não executar o fluxo de deploy automático para essa versão sem essas condições. Alertas remanescentes e bundle grande estão registrados, não ocultados por alteração do threshold de testes.

B05 validado com 69 testes unitários/componentes e 54 de integração, tipos, build e auditoria de produção. O motor canônico está implementado e testado; dados existentes usam compatibilidade identificada, sem migração implícita.

**Fechamento local da preparação E2:** 158 testes aprovados (89 unitários/interface e 69 de integração), tipos e build aprovados, auditoria de produção sem alertas altos/críticos; permanecem 1 baixo e 8 moderados. O novo caminho aparece em Produtos → Catálogo e fichas e não movimenta estoque. O editor operacional antigo permanece até o corte conjunto E2/E3. Ver [escopo entregue, limites e evidências](./etapa-e2.md).

**Fechamento local da E3 — 17/10/2026:** 198 testes aprovados (106 unitários/interface e 92 de integração), tipos/build/auditoria aprovados; nenhum teste E0/E1/E2 foi alterado ou removido nesta etapa. Movimentos, reservas e execução são transacionais, com custo médio, idempotência e conciliação. O acesso aparece em **Estoque e produção — operações e migração**. O mecanismo de congelamento/abertura/ativação por empresa está implementado e testado, sem ativar empresas reais. Custos de conversão realizados exigem confirmação do operador; a interface não os presume a partir da estimativa. Ver [regras, limites, corte e evidências E3](./etapa-e3.md).

**Fechamento local da E4 — 17/10/2026:** 240 testes aprovados (129 unitários/interface e 111 de integração), tipos/build/auditoria aprovados. Os 198 testes E0–E3 foram preservados sem alteração; 42 casos foram adicionados (23 unitários/interface e 19 de integração). A jornada permite orçamento avulso ou por ficha, prévia no servidor, emissão congelada, aprovação interna rastreável, pedido único e atendimento por estoque/fabricação E3. O acesso aparece em **Orçamentos e pedidos**. Propostas não movimentam estoque; pedidos não inventam pagamentos. Ver [contratos, cálculos, limites e evidências E4](./etapa-e4.md).

**Fechamento local da E5 — 20/10/2026:** 274 testes aprovados (147 unitários/interface e 127 de integração), tipos/build/auditoria aprovados. Os 240 testes E0–E4 foram preservados sem alteração; 34 casos foram adicionados. Recebimentos, taxas efetivas, reembolsos, contas a pagar, pagamentos e estornos têm registros imutáveis, proteção contra duplicação e conciliação. A conferência final compara custo estimado com custo realizado e mantém valores desconhecidos como pendentes. O acesso aparece em **Financeiro e conciliação** após o corte operacional E3. Ver [regras e limites E5](./etapa-e5.md) e [log da barreira](./evidencias-e5-quality.txt).

Próximo passo: **homologação real e liberação coordenada do piloto**, seguindo o [roteiro E5](./piloto-e5.md). O financeiro legado continua bloqueado; o novo fluxo integra pedidos E4 e estoque E3. Reembolso financeiro não simula devolução física, revisão de pedido já consumido/expedido ou nota de crédito. Não liberar o núcleo em produção antes de backup/restauração, validação de Auth/servidor/cliente/rules e reconciliação com documentos reais. A auditoria de produção registra 1 alerta baixo e 8 moderados, sem altos/críticos, após correções pontuais de Vite e follow-redirects; o build mantém aviso de bundle grande. O relatório é gerencial e não substitui conciliação bancária ou DRE contábil.

O diretório `scripts/` já existia como não rastreado e não participa destes commits.

## Complementos após E5

B12 implementado localmente: devoluções físicas, trocas por reposição, acordos de crédito/dispensa e revisão após produção. Barreira completa aprovada com 283 testes. O bloqueio geral descrito acima para fatos físicos foi substituído pelos comandos explícitos descritos no [fechamento das lacunas](./fechamento-plano.md). Piloto real continua pendente.

B13 implementado localmente: upload privado, download autenticado e migração explícita de mídia incorporada. Barreira completa aprovada com 293 testes; storage real/rules/IAM ainda exigem homologação. Ver [fechamento das lacunas](./fechamento-plano.md).

B14 implementado localmente: registro de envio de versão emitida, evidência e histórico. Barreira acumulada aprovada com **296 testes**. DV35 corrigida no repositório SiteLabLayer (`39d99d7`), com seis testes e build/auditoria de produção aprovados. O [fechamento das lacunas](./fechamento-plano.md) lista entregas, critérios e pendências de homologação.

B15 validado em 21/10/2026: **296 testes preservados**, SDK/Admin e ferramentas atualizados. Auditoria de produção agora **zero alertas**; árvore completa ainda registra sete. Esta evidência substitui a contagem histórica de nove alertas de produção acima. Ver [dependências B15](./dependencias-b15.md).

B16 validado em 21/10/2026: **301 testes**, navegação carregada sob demanda e recuperação de falhas de tela. JS inicial reduzido de 1.190,36 para 714,69 kB (cerca de 40%), sem arquivos acima de 500 kB. Ver [desempenho B16](./desempenho-b16.md).
