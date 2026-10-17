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
| E5 | Recebimentos, conciliação financeira e liberação do piloto | Pendente |

**Fechamento local da E0:** 76 testes aprovados (29 unitários/componentes e 47 de integração), tipos e build aprovados, 0 alertas altos/críticos na árvore de produção. O ensaio final de restauração cobre 516 documentos e recusa destino com subcoleções órfãs. Ver [evidências e limites](./etapa-e0.md) e [auditoria de dependências](./dependencias-e0.json).

**Antes de implantação:** reconciliar vínculos legados, preparar a claim administrativa e homologar login/provisionamento com Firebase Auth real em ambiente separado; executar backup e liberação coordenada do servidor, cliente e rules. Não executar o fluxo de deploy automático para essa versão sem essas condições. Alertas remanescentes e bundle grande estão registrados, não ocultados por alteração do threshold de testes.

B05 validado com 69 testes unitários/componentes e 54 de integração, tipos, build e auditoria de produção. O motor canônico está implementado e testado; dados existentes usam compatibilidade identificada, sem migração implícita.

**Fechamento local da preparação E2:** 158 testes aprovados (89 unitários/interface e 69 de integração), tipos e build aprovados, auditoria de produção sem alertas altos/críticos; permanecem 1 baixo e 8 moderados. O novo caminho aparece em Produtos → Catálogo e fichas e não movimenta estoque. O editor operacional antigo permanece até o corte conjunto E2/E3. Ver [escopo entregue, limites e evidências](./etapa-e2.md).

**Fechamento local da E3 — 17/10/2026:** 198 testes aprovados (106 unitários/interface e 92 de integração), tipos/build/auditoria aprovados; nenhum teste E0/E1/E2 foi alterado ou removido nesta etapa. Movimentos, reservas e execução são transacionais, com custo médio, idempotência e conciliação. O acesso aparece em **Estoque e produção — operações e migração**. O mecanismo de congelamento/abertura/ativação por empresa está implementado e testado, sem ativar empresas reais. Custos de conversão realizados exigem confirmação do operador; a interface não os presume a partir da estimativa. Ver [regras, limites, corte e evidências E3](./etapa-e3.md).

**Fechamento local da E4 — 17/10/2026:** 240 testes aprovados (129 unitários/interface e 111 de integração), tipos/build/auditoria aprovados. Os 198 testes E0–E3 foram preservados sem alteração; 42 casos foram adicionados (23 unitários/interface e 19 de integração). A jornada permite orçamento avulso ou por ficha, prévia no servidor, emissão congelada, aprovação interna rastreável, pedido único e atendimento por estoque/fabricação E3. O acesso aparece em **Orçamentos e pedidos**. Propostas não movimentam estoque; pedidos não inventam pagamentos. Ver [contratos, cálculos, limites e evidências E4](./etapa-e4.md).

Próxima etapa: **E5**, recebimentos e reconciliação financeira, tratamento dos impactos após consumo/expedição e liberação do piloto. O corte substitui as telas comerciais antigas pela E4; o financeiro antigo permanece bloqueado. Não liberar o núcleo em produção antes da homologação coordenada e da reconciliação E5. A auditoria ainda registra 1 alerta baixo e 8 moderados na árvore de produção, sem altos/críticos; o build mantém aviso de bundle grande.

O diretório `scripts/` já existia como não rastreado e não participa destes commits.
