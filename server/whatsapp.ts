import { createHash, timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { BusinessError, validId } from './session';
import { isRecord, normalizeCustomRequest } from './admin-contract';
import { writeAdminDocument } from './admin-writes';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function registerWhatsAppIngress(app: Express, db: Firestore | null, env: NodeJS.ProcessEnv,
  keys: Array<{ id: string; tokenHash: string; tenantId: string; actor: string; active?: boolean; scopes?: string[] }>,
  prepare: (input: { tenantId: string; docId: string; collectionName: string; payload: Record<string, any>; mode: 'create' | 'patch' }) => Promise<Record<string, any>>) {
  app.post('/api/public/tenants/:tenantId/custom-requests/whatsapp', async (req, res) => {
    try {
      const { tenantId } = req.params;
      if (!validId(tenantId)) throw new BusinessError(400, 'tenantId inválido.');
      const token = req.get('x-lablayer-webhook-token') || req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1] || '';
      const scoped = keys.find(key => key.active !== false && key.tenantId === tenantId && key.scopes?.includes('customRequests:ingest') && token && key.tokenHash === hash(token));
      const configuredToken = env.WHATSAPP_INGEST_TOKEN?.trim();
      const configuredTenant = env.WHATSAPP_TENANT_ID?.trim();
      if ((!configuredToken || !configuredTenant) && !keys.some(key => key.active !== false && key.scopes?.includes('customRequests:ingest'))) {
        throw new BusinessError(503, 'Entrada WhatsApp sem credencial vinculada a empresa.');
      }
      const legacyAccess = token && configuredToken && tenantId === configuredTenant && timingSafeEqual(Buffer.from(hash(token)), Buffer.from(hash(configuredToken)));
      if (!scoped && !legacyAccess) throw new BusinessError(401, 'Credencial inválida para esta empresa.');
      if (!db) throw new BusinessError(503, 'Banco de dados não disponível.');
      if (!isRecord(req.body)) throw new BusinessError(400, 'Body inválido.');
      const { eventId, ...raw } = req.body;
      if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 300) throw new BusinessError(400, 'eventId estável da mensagem é obrigatório.');
      const allowed = ['title', 'name', 'description', 'observation', 'observacao', 'notes', 'customerName', 'customerPhone',
        'sourceMessage', 'requestedQuantity', 'referenceImageUrl', 'quoteMediaUrl', 'referenceImageBase64', 'referenceImageDataUrl', 'type', 'status', 'productionTimeHours'];
      for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new BusinessError(400, `Campo não permitido na entrada: ${key}.`);
      if ((raw.status !== undefined && raw.status !== 'aguardando-orcamento') || (raw.type !== undefined && raw.type !== 'orcamento') || (raw.productionTimeHours !== undefined && raw.productionTimeHours !== 0)) {
        throw new BusinessError(400, 'Entrada WhatsApp cria somente solicitação aguardando orçamento.');
      }
      const normalized = normalizeCustomRequest(raw, 'create');
      if (!normalized.title) normalized.title = `Solicitação WhatsApp${normalized.customerName ? ` - ${normalized.customerName}` : ''}`.slice(0, 150);
      if (!normalized.description) normalized.description = normalized.sourceMessage || '';
      normalized.sourceChannel = 'whatsapp';
      const id = `wa-${hash(eventId.trim())}`;
      const fingerprint = hash(stable(normalized));
      const tenant = await db.doc(`tenants/${tenantId}`).get();
      if (!tenant.exists) throw new BusinessError(404, 'Empresa não encontrada.');
      if (tenant.data()?.status === 'inactive') throw new BusinessError(403, 'Empresa inativa.');
      const previous = await db.doc(`tenants/${tenantId}/webhookReceipts/${id}`).get();
      if (previous.exists) {
        if (previous.data()?.fingerprint !== fingerprint) throw new BusinessError(409, 'Evento já recebido com conteúdo diferente.');
        if (!(await db.doc(`tenants/${tenantId}/customRequests/${id}`).get()).exists) throw new BusinessError(409, 'Solicitação original não está mais disponível.');
        return res.status(200).json({ success: true, id, tenantId, duplicate: true });
      }
      const payload = await prepare({ tenantId, docId: id, collectionName: 'customRequests', payload: normalized, mode: 'create' });
      await writeAdminDocument(db, { tenantId, collection: 'customRequests', id, payload, mode: 'create',
        actor: scoped?.actor ?? 'whatsapp-ingest', keyId: scoped?.id ?? 'whatsapp-bound-token', receipt: { id, fingerprint } });
      return res.status(201).json({ success: true, id, tenantId });
    } catch (error) {
      if (error instanceof BusinessError) return res.status(error.status).json({ error: error.message });
      console.error('Falha na entrada WhatsApp:', error);
      return res.status(500).json({ error: 'Não foi possível salvar a solicitação.' });
    }
  });
}
