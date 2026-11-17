import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import legacyConfig from '../firebase-applet-config.json';

const requiredKeys = ['projectId', 'appId', 'apiKey', 'authDomain', 'firestoreDatabaseId', 'storageBucket'] as const;
const optionalKeys = ['messagingSenderId', 'measurementId'] as const;
export type ClientFirebaseConfig = Record<typeof requiredKeys[number], string> & Partial<Record<typeof optionalKeys[number], string>>;
export type DeploymentEnvironment = { environment: 'production' | 'homologation'; config: ClientFirebaseConfig };

function readJson(file: string, label: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${label}: arquivo ausente, ilegível ou JSON inválido.`); }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateClientConfig(value: unknown): ClientFirebaseConfig {
  if (!object(value) || Object.keys(value).some(key => ![...requiredKeys, ...optionalKeys].includes(key as any))) {
    throw new Error('Configuração do cliente deve conter somente campos públicos Firebase permitidos; não use uma conta de serviço.');
  }
  const config: Record<string, string> = {};
  for (const key of [...requiredKeys, ...optionalKeys]) {
    const item = value[key];
    if (item === undefined && optionalKeys.includes(key as any)) continue;
    if (typeof item !== 'string' || (requiredKeys.includes(key as any) && !item.trim()) || item !== item.trim()) {
      throw new Error(`Configuração pública Firebase: campo ${key} inválido.`);
    }
    config[key] = item;
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId)
    || !/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(config.authDomain)
    || !/^[a-z0-9][a-z0-9._-]+[a-z0-9]$/.test(config.storageBucket)
    || !/^(\(default\)|[a-zA-Z0-9_-]+)$/.test(config.firestoreDatabaseId)) {
    throw new Error('Configuração pública Firebase: projeto, domínio, banco ou bucket inválido.');
  }
  return config as ClientFirebaseConfig;
}

export function loadDeploymentEnvironment(env: NodeJS.ProcessEnv, root = process.cwd()): DeploymentEnvironment {
  const environment = env.LABLAYER_ENV?.trim() || 'production';
  if (environment !== 'production' && environment !== 'homologation') throw new Error('LABLAYER_ENV deve ser production ou homologation.');
  const file = env.LABLAYER_FIREBASE_CONFIG_FILE?.trim();
  if (environment === 'production') {
    if (file) throw new Error('Configuração Firebase alternativa exige LABLAYER_ENV=homologation.');
    return { environment, config: validateClientConfig(legacyConfig) };
  }
  if (!file) throw new Error('Homologação exige LABLAYER_FIREBASE_CONFIG_FILE explícito.');
  const config = validateClientConfig(readJson(path.resolve(root, file), 'Configuração pública Firebase'));
  if (config.projectId === legacyConfig.projectId || config.storageBucket === legacyConfig.storageBucket || config.authDomain === legacyConfig.authDomain) {
    throw new Error('Homologação exige projeto, bucket e domínio Auth separados da configuração de produção conhecida.');
  }
  return { environment, config };
}

export function deploymentManifest(deployment: DeploymentEnvironment) {
  const { environment, config } = deployment;
  return {
    schemaVersion: 1, environment, projectId: config.projectId,
    firestoreDatabaseId: config.firestoreDatabaseId, storageBucket: config.storageBucket,
    authDomain: config.authDomain,
    configHash: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
  };
}

export function validateRuntimeIdentity(deployment: DeploymentEnvironment, env: NodeJS.ProcessEnv, account: unknown, manifest?: unknown) {
  const { config } = deployment;
  if (deployment.environment !== 'homologation') throw new Error('Esta conferência exige LABLAYER_ENV=homologation.');
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST || env.STORAGE_EMULATOR_HOST) {
    throw new Error('Homologação real não pode usar endereços de emulador. Execute testes isolados pela barreira quality.');
  }
  if (env.FIRESTORE_DATABASE_ID !== config.firestoreDatabaseId || env.FIREBASE_STORAGE_BUCKET !== config.storageBucket) {
    throw new Error('Servidor e cliente divergem: configure FIRESTORE_DATABASE_ID e FIREBASE_STORAGE_BUCKET explicitamente.');
  }
  if (!object(account) || account.project_id !== config.projectId || account.type !== 'service_account'
    || typeof account.client_email !== 'string' || !account.client_email.endsWith('.iam.gserviceaccount.com')
    || typeof account.private_key !== 'string' || !account.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('Conta de serviço inválida ou pertencente a outro projeto.');
  }
  if (manifest !== undefined) {
    const expected = deploymentManifest(deployment);
    if (!object(manifest) || Object.entries(expected).some(([key, value]) => manifest[key] !== value)) {
      throw new Error('Build do cliente não corresponde à configuração de homologação do servidor. Refaça o build com o mesmo ambiente.');
    }
  }
}

// Offline: reads only explicit local files; never initializes an SDK or connects to Firebase.
export function checkHomologation(env: NodeJS.ProcessEnv, root = process.cwd(), requireBuild = true): DeploymentEnvironment {
  const deployment = loadDeploymentEnvironment(env, root);
  if (deployment.environment !== 'homologation') throw new Error('Esta conferência exige LABLAYER_ENV=homologation.');
  let account: unknown;
  if (env.FIREBASE_SERVICE_ACCOUNT && env.FIREBASE_SERVICE_ACCOUNT_FILE) throw new Error('Defina apenas uma origem para a conta de serviço.');
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
    catch { throw new Error('Conta de serviço: JSON inválido.'); }
  } else if (env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    account = readJson(path.resolve(root, env.FIREBASE_SERVICE_ACCOUNT_FILE), 'Conta de serviço');
  } else {
    throw new Error('Homologação exige uma conta de serviço explicitamente configurada.');
  }
  const manifest = requireBuild ? readJson(path.join(root, 'dist/lablayer-environment.json'), 'Manifesto do build') : undefined;
  validateRuntimeIdentity(deployment, env, account, manifest);
  return deployment;
}
