import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { checkHomologation, deploymentManifest, loadDeploymentEnvironment, validateClientConfig, validateRuntimeIdentity } from '../../server/deployment-environment';
import legacyConfig from '../../firebase-applet-config.json';
import { createApp } from '../../server';

let root: string;
const config = {
  projectId: 'demo-lablayer-staging', appId: 'fixture-app', apiKey: 'fixture-public-key',
  authDomain: 'demo-lablayer-staging.firebaseapp.com', firestoreDatabaseId: '(default)',
  storageBucket: 'demo-lablayer-staging.firebasestorage.app',
};
const account = {
  type: 'service_account', project_id: config.projectId,
  client_email: `fixture@${config.projectId}.iam.gserviceaccount.com`,
  private_key: '-----BEGIN PRIVATE KEY-----\nfixture-not-a-real-key\n-----END PRIVATE KEY-----',
};
let env: NodeJS.ProcessEnv;
function writeConfig(value: unknown = config) { writeFileSync(path.join(root, 'client.json'), JSON.stringify(value)); }
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'lablayer-env-'));
  env = { LABLAYER_ENV: 'homologation', LABLAYER_FIREBASE_CONFIG_FILE: 'client.json',
    FIRESTORE_DATABASE_ID: config.firestoreDatabaseId, FIREBASE_STORAGE_BUCKET: config.storageBucket,
    FIREBASE_SERVICE_ACCOUNT_FILE: 'account.json' };
  writeConfig();
  writeFileSync(path.join(root, 'account.json'), JSON.stringify(account));
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist/lablayer-environment.json'), JSON.stringify(deploymentManifest(loadDeploymentEnvironment(env, root))));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('preserva configuração atual quando não há ambiente alternativo', () => {
  expect(loadDeploymentEnvironment({}, root)).toEqual({ environment: 'production', config: legacyConfig });
});
it('não aceita ambiente desconhecido nem arquivo alternativo sem homologation', () => {
  expect(() => loadDeploymentEnvironment({ LABLAYER_ENV: 'stagin' }, root)).toThrow('LABLAYER_ENV');
  expect(() => loadDeploymentEnvironment({ LABLAYER_FIREBASE_CONFIG_FILE: 'client.json' }, root)).toThrow('homologation');
  expect(() => checkHomologation({}, root)).toThrow('homologation');
});
it('homologação sem arquivo explícito não recai no projeto de produção', () => {
  delete env.LABLAYER_FIREBASE_CONFIG_FILE;
  expect(() => loadDeploymentEnvironment(env, root)).toThrow('explícito');
});
it('arquivo inexistente ou inválido falha sem revelar conteúdo', () => {
  writeFileSync(path.join(root, 'client.json'), 'private-key-sensitive-fixture');
  expect(() => loadDeploymentEnvironment(env, root)).toThrow('JSON inválido');
  expect(() => loadDeploymentEnvironment(env, root)).not.toThrow('private-key-sensitive-fixture');
  rmSync(path.join(root, 'client.json'));
  expect(() => loadDeploymentEnvironment(env, root)).toThrow('ausente');
});
it('recusa projeto, bucket ou domínio Auth de produção na homologação', () => {
  for (const key of ['projectId', 'storageBucket', 'authDomain'] as const) {
    writeConfig({ ...config, [key]: legacyConfig[key] });
    expect(() => loadDeploymentEnvironment(env, root)).toThrow('separados');
  }
});
it('configuração pública precisa ser completa e não pode conter segredos', () => {
  const { storageBucket, ...incomplete } = config;
  expect(() => validateClientConfig(incomplete)).toThrow('storageBucket');
  expect(() => validateClientConfig({ ...config, private_key: account.private_key })).toThrow('campos públicos');
  expect(() => validateClientConfig({ ...config, authDomain: 'https://example.com/' })).toThrow('inválido');
});
it('confere build e runtime sem contatar Firebase nem exigir chave real no ensaio', () => {
  const deployment = checkHomologation(env, root);
  expect(deployment.config).toEqual(config);
  expect(JSON.stringify(deploymentManifest(deployment))).not.toContain(config.apiKey);
  expect(JSON.stringify(deploymentManifest(deployment))).not.toContain('private_key');
});
it('recusa banco/bucket ausentes ou diferentes no servidor', () => {
  for (const key of ['FIRESTORE_DATABASE_ID', 'FIREBASE_STORAGE_BUCKET']) {
    expect(() => checkHomologation({ ...env, [key]: undefined }, root)).toThrow('divergem');
    expect(() => checkHomologation({ ...env, [key]: 'other' }, root)).toThrow('divergem');
  }
});
it('recusa conta de serviço ausente, ambígua ou de outro projeto', () => {
  expect(() => checkHomologation({ ...env, FIREBASE_SERVICE_ACCOUNT_FILE: undefined }, root)).toThrow('explicitamente');
  expect(() => checkHomologation({ ...env, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(account) }, root)).toThrow('uma origem');
  writeFileSync(path.join(root, 'account.json'), JSON.stringify({ ...account, project_id: legacyConfig.projectId }));
  expect(() => checkHomologation(env, root)).toThrow('outro projeto');
});
it('aceita conta inline explicitamente configurada e não imprime dados dela', () => {
  expect(checkHomologation({ ...env, FIREBASE_SERVICE_ACCOUNT_FILE: undefined, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(account) }, root).config).toEqual(config);
  expect(() => checkHomologation({ ...env, FIREBASE_SERVICE_ACCOUNT_FILE: undefined, FIREBASE_SERVICE_ACCOUNT: 'secret-invalid-json' }, root)).toThrow('Conta de serviço: JSON inválido');
});
it('recusa build de produção, antigo ou sem manifesto', () => {
  writeFileSync(path.join(root, 'dist/lablayer-environment.json'), JSON.stringify(deploymentManifest(loadDeploymentEnvironment({}, root))));
  expect(() => checkHomologation(env, root)).toThrow('Build do cliente');
  const deployment = loadDeploymentEnvironment(env, root);
  expect(() => validateRuntimeIdentity(deployment, env, account, { ...deploymentManifest(deployment), configHash: 'outdated' })).toThrow('Build do cliente');
  rmSync(path.join(root, 'dist/lablayer-environment.json'));
  expect(() => checkHomologation(env, root)).toThrow('Manifesto do build');
  expect(checkHomologation(env, root, false).config).toEqual(config);
});
it('recusa emuladores na conferência de homologação real', () => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST']) {
    expect(() => checkHomologation({ ...env, [key]: '127.0.0.1:9999' }, root)).toThrow('emulador');
  }
});
it('servidor recusa homologação incompleta antes de inicializar SDK ou abrir banco', async () => {
  await expect(createApp({ env: { LABLAYER_ENV: 'homologation' } })).rejects.toThrow('LABLAYER_FIREBASE_CONFIG_FILE');
  await expect(createApp({ env: { LABLAYER_ENV: 'stagin' } })).rejects.toThrow('LABLAYER_ENV');
});
