// Cria, lista e revoga chaves do MCP do Mercado Livre (privateMcpKeys/{sha256(chave)}).
// Rodar na VPS, a partir de /var/www/lablayer/app:
//   GOOGLE_APPLICATION_CREDENTIALS=/var/www/lablayer/shared/firebase-service-account.json \
//   npx tsx tools/mcp-key.ts create --database <id> --tenant <tenantId> --uid <uid do admin> [--read-only] [--days 180] [--label "Claude"]
//   ... list   --database <id> --tenant <tenantId>
//   ... revoke --database <id> --id <keyId>
// A chave aparece uma única vez na saída de `create`; somente o SHA-256 é salvo.
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { hashMcpKey } from '../server/mcp-mercadolivre';
import { marketplaceAccess } from '../server/marketplace-security';
import { validId } from '../server/session';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  database: { type: 'string' }, tenant: { type: 'string' }, uid: { type: 'string' }, id: { type: 'string' },
  'read-only': { type: 'boolean' }, days: { type: 'string' }, label: { type: 'string' },
} });
const command = positionals[0];
if (!values.database) throw Error('--database é obrigatório (FIRESTORE_DATABASE_ID do .env.production).');
const app = initializeApp({ credential: applicationDefault() });
const db = getFirestore(app, values.database);
const keys = db.collection('privateMcpKeys');
try {
  if (command === 'create') {
    const { tenant, uid } = values;
    if (!validId(tenant) || !validId(uid)) throw Error('Informe --tenant e --uid.');
    const days = Number(values.days ?? 180);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw Error('--days deve ser de 1 a 365.');
    const claims = (await getAuth(app).getUser(uid)).customClaims;
    // O criador precisa ser administrador da empresa (mesma regra das integrações).
    await db.runTransaction(tx => marketplaceAccess(db, tx, tenant, { uid, superadmin: claims?.superadmin === true }));
    const token = `ll_mcp_${randomBytes(32).toString('base64url')}`;
    const id = randomBytes(6).toString('hex');
    const createdAt = new Date().toISOString();
    const scopes = values['read-only'] ? ['mercadolivre:read'] : ['mercadolivre:read', 'mercadolivre:write'];
    await keys.doc(hashMcpKey(token)).create({ id, tenantId: tenant, createdBy: uid, scopes, active: true,
      label: (values.label ?? 'Claude MCP').slice(0, 80), createdAt, expiresAt: new Date(Date.now() + days * 86400000).toISOString() });
    await db.collection(`tenants/${tenant}/auditLogs`).add({ operation: 'marketplace.mcp.key.created', provider: 'mercadolivre', actor: uid, keyId: id, scopes, createdAt });
    console.log(JSON.stringify({ id, scopes, expiraEm: `${days} dias`, chave: token }, null, 2));
    console.error('Guarde a chave agora: ela não será exibida novamente.');
  } else if (command === 'list') {
    if (!validId(values.tenant)) throw Error('Informe --tenant.');
    const snap = await keys.where('tenantId', '==', values.tenant).get();
    console.table(snap.docs.map(d => { const k = d.data(); return { id: k.id, label: k.label, scopes: k.scopes.join(' '), active: k.active, createdBy: k.createdBy, expiresAt: k.expiresAt }; }));
  } else if (command === 'revoke') {
    if (!values.id || !/^[a-f0-9]{12}$/.test(values.id)) throw Error('Informe --id da chave (12 caracteres hex).');
    const snap = await keys.where('id', '==', values.id).get();
    if (snap.empty) throw Error('Chave não encontrada.');
    for (const doc of snap.docs) {
      await doc.ref.update({ active: false, revokedAt: new Date().toISOString() });
      await db.collection(`tenants/${doc.data().tenantId}/auditLogs`).add({ operation: 'marketplace.mcp.key.revoked', provider: 'mercadolivre', actor: 'cli', keyId: values.id, createdAt: new Date().toISOString() });
    }
    console.log(`Chave ${values.id} revogada.`);
  } else throw Error('Use: create | list | revoke');
} finally { await db.terminate(); await deleteApp(app); }
