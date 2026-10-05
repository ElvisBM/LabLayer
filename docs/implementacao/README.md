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
| E1/B05 | Integração de consumidores e snapshots | Em implementação |
| E2–E5 | Produtos, estoque, orçamento e conciliação | Pendente |

**Fechamento local da E0:** 76 testes aprovados (29 unitários/componentes e 47 de integração), tipos e build aprovados, 0 alertas altos/críticos na árvore de produção. O ensaio final de restauração cobre 516 documentos e recusa destino com subcoleções órfãs. Ver [evidências e limites](./etapa-e0.md) e [auditoria de dependências](./dependencias-e0.json).

**Antes de implantação:** reconciliar vínculos legados, preparar a claim administrativa e homologar login/provisionamento com Firebase Auth real em ambiente separado; executar backup e liberação coordenada do servidor, cliente e rules. Não executar o fluxo de deploy automático para essa versão sem essas condições. Alertas remanescentes e bundle grande estão registrados, não ocultados por alteração do threshold de testes.

B04 validado com 55 testes unitários/componentes e 47 de integração, tipos, build e auditoria de produção. O próximo bloco B05 conecta consumidores, elimina divergências e preserva a identificação dos dados legados.

O diretório `scripts/` já existia como não rastreado e não participa destes commits.
