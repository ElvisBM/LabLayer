# B15 — atualização de dependências

Validado em 21/10/2026, antes de avançar ao próximo bloco. Nenhum cálculo, contrato comercial ou documento real foi alterado.

## Alterações e compatibilidade

Firebase Admin passou de 13.10.0 (resolução anterior) para 14.5.0; manifesto exige ^14.5.0. Node 22 já era exigido pelo projeto e pelo CI. A versão 14 remove namespace legado, InstanceID e tipos antigos de mensagens, que não são usados neste repositório. Imports modulares de Auth, Firestore e Storage foram preservados. Firestore passou a 9.3.1 e Storage a 8.4.0. A validação de integração usa Firestore local; Auth real e o adaptador do bucket ainda exigem homologação.

Atualizações compatíveis do lockfile incluem firebase-tools 15.34.0, tsx 4.23.15, esbuild e transitivas. Não se usou `npm audit fix --force`, downgrade do CLI ou override artificial de pacote sem correção. Reproduzir com Node 22, `npm ci` e `npm run quality` (Java 21 para o emulador).

## Resultado da auditoria

| Árvore | Antes | Depois |
|---|---|---|
| Produção LabLayer | 9: 1 baixo, 8 moderados | **0** |
| Completa LabLayer | 18: 1 baixo, 10 moderados, 7 altos | **7: 4 moderados, 3 altos** |
| Produção SiteLabLayer | 0 | **0** |
| Completa SiteLabLayer | 12: 1 baixo, 2 moderados, 9 altos | **7: 2 moderados, 5 altos** |

Contagens são do npm audit na data da execução; incluem dependências afetadas por transitivas, não necessariamente sete falhas distintas. Evidências: [antes](./dependencias-b15-before.json), [depois](./dependencias-b15-after.json) e [barreira completa](./evidencias-b15-quality.txt). Não declarar a árvore completa livre de vulnerabilidades.

No LabLayer restam firebase-tools/chokidar/braces e transitivas de PubSub, OpenTelemetry, gaxios e uuid do ambiente de desenvolvimento. O advisory de braces não informa versão corrigida; o pacote processa padrões glob das ferramentas. Não expor CLI/emuladores à rede pública ou fornecer padrões não confiáveis a essas ferramentas. Acompanhar versões corrigidas e repetir audit/quality antes de adotar. No site permanecem cadeias de Tailwind 3, glob e seletores; migrar a Tailwind 4 requer validação visual específica e não foi imposto por uma sugestão automática do audit.

## Qualidade

**296 testes preservados e aprovados**: 153 unitários/interface em 17 arquivos e 143 de integração em 11 arquivos. TypeScript, build e auditoria de produção aprovados. Nenhum teste anterior foi removido, relaxado ou alterado. Avisos de metadata do SDK durante encerramento do emulador não produziram falha; nenhuma credencial de produção foi usada nos testes.

Site: seis testes, TypeScript, build e auditoria de produção aprovados. Build permanece com JS 251,59 kB (gzip 77,93 kB). Evidência e alteração do lockfile estão no repositório irmão.

O bundle principal do LabLayer ainda tem 1.190,36 kB (gzip 291,28 kB) e avisa sobre tamanho. Esse ponto segue para B16. Homologação real, backup completo e implantação continuam pendentes.

## Referências de compatibilidade

- [Firebase Admin 14.0 — mudanças incompatíveis](https://github.com/firebase/firebase-admin-node/releases/tag/v14.0.0)
- [Firebase Admin 14.5](https://github.com/firebase/firebase-admin-node/releases/tag/v14.5.0)
- [Advisory braces, sem versão corrigida publicada](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
