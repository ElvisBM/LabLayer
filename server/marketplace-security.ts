import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { BusinessError } from './session';

export function loadMarketplaceKey(path: string): Buffer | null {
  try {
    const mode = statSync(path).mode;
    const key = readFileSync(path);
    return !(mode & 0o077) && key.length === 32 ? key : null;
  } catch { return null; }
}

export function sealMarketplaceSecret(key: Buffer, tenant: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`mercadolivre:${tenant}:v1`));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function openMarketplaceSecret(key: Buffer, tenant: string, envelope: ReturnType<typeof sealMarketplaceSecret>) {
  if (envelope.version !== 1) throw Error('Unsupported credential version');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`mercadolivre:${tenant}:v1`));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
}

export async function marketplaceAccess(db: Firestore, tx: Transaction, tenant: string, identity: { uid: string; superadmin?: boolean }, recheckPlatform = false) {
    const company = (await tx.get(db.doc(`tenants/${tenant}`))).data();
    const profile = (await tx.get(db.doc(`users/${identity.uid}`))).data();
    const member = await tx.get(db.doc(`tenants/${tenant}/members/${identity.uid}`));
    const owner = company?.ownerUid === identity.uid;
    const admin = profile?.tenantId === tenant && (member.exists
      ? member.data()?.active === true && member.data()?.role === 'admin'
      : profile?.tenantRole === 'admin');
    if (!company || company.status === 'inactive' || !(owner || admin || (identity.superadmin === true && (!recheckPlatform || profile?.role === 'superadmin'))))
      throw new BusinessError(403, 'Somente administradores da empresa podem configurar esta integração.');
  }
