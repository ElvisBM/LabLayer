import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { exportTenant, restoreTenantToEmulator } from '../server/tenant-backup';

const { values } = parseArgs({ options: {
  mode: { type: 'string' }, project: { type: 'string' }, database: { type: 'string' },
  tenant: { type: 'string' }, file: { type: 'string' }, 'writes-paused': { type: 'boolean' },
} });
if (!values.file) throw Error('--file é obrigatório.');
if (values.mode === 'restore-emulator') {
  console.log(await restoreTenantToEmulator(JSON.parse(readFileSync(values.file, 'utf8')), values.project));
} else if (values.mode === 'export') {
  if (!values.project || !values.database || !values.tenant || !values['writes-paused']) {
    throw Error('Exportação exige --project, --database, --tenant e --writes-paused. Pause todos os escritores para obter cópia consistente.');
  }
  const app = initializeApp({ projectId: values.project, credential: applicationDefault() });
  const db = getFirestore(app, values.database);
  try {
    const backup = await exportTenant(db, values.tenant, values.project);
    writeFileSync(values.file, JSON.stringify(backup, null, 2), { mode: 0o600, flag: 'wx' });
    console.log({ documents: backup.documents.length, file: values.file });
  } finally { await db.terminate(); await deleteApp(app); }
} else throw Error('--mode deve ser export ou restore-emulator.');
