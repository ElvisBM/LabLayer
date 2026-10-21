import { checkHomologation, deploymentManifest } from '../server/deployment-environment';

try {
  const deployment = checkHomologation(process.env);
  console.log(JSON.stringify({
    status: 'configuracao-local-consistente', ...deploymentManifest(deployment),
    next: 'Validar acesso, IAM, rules, backup e jornada real no ambiente identificado. Esta conferência não acessa serviços nem libera o piloto.',
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha na conferência de homologação.');
  process.exitCode = 1;
}
