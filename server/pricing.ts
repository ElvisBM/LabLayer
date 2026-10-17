import type { Express } from 'express';
import { requireLegacyInventory } from './inventory';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { BusinessError, validId } from './session';
import { calculateChannelPrice, calculateVariationUnitCostBreakdown, normalizePricingSettings, type LegacyTargetType } from '../src/utils/pricing';
import { PricingError } from '../shared/pricing/engine';

export function registerPricingRoutes(app: Express, db: Firestore | null, verify: (token: string) => Promise<DecodedIdToken>) {
  app.post('/api/tenants/:tenantId/products/:productId/pricing-snapshots', async (req, res) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    let identity: DecodedIdToken;
    try { identity = await verify(token); } catch { return res.status(401).json({ error: 'Sessão inválida.' }); }
    try {
      const { tenantId, productId } = req.params;
      const body = req.body;
      if (!validId(identity.uid) || !validId(tenantId) || !validId(productId) || !body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(k => !['requestId', 'variationId', 'channelId', 'targetType', 'targetValue', 'includeAffiliate'].includes(k)) ||
          ![body.requestId, body.variationId, body.channelId].every(validId) ||
          !['profit', 'margin', 'markup', 'custom'].includes(body.targetType) ||
          typeof body.targetValue !== 'number' || !Number.isFinite(body.targetValue) || body.targetValue < 0 ||
          (body.includeAffiliate !== undefined && typeof body.includeAffiliate !== 'boolean')) throw new BusinessError(400, 'Solicitação de cálculo inválida.');
      const command = { variationId: body.variationId, channelId: body.channelId, targetType: body.targetType, targetValue: body.targetValue, includeAffiliate: body.includeAffiliate ?? false };
      const fingerprint = createHash('sha256').update(JSON.stringify({ ...command, actorUid: identity.uid })).digest('hex');
      const productRef = db.doc(`tenants/${tenantId}/products/${productId}`);
      const snapshotRef = productRef.collection('pricingSnapshots').doc(body.requestId);
      const response = await db.runTransaction(async tx => {
        const tenant = await tx.get(db.doc(`tenants/${tenantId}`));
        const profile = await tx.get(db.doc(`users/${identity.uid}`));
        if (!tenant.exists || tenant.data()?.status === 'inactive' || !((identity.uid === tenantId && tenant.data()?.ownerUid === identity.uid) || profile.data()?.tenantId === tenantId)) throw new BusinessError(403, 'Empresa sem acesso.');
        const existing = await tx.get(snapshotRef);
        if (existing.exists) {
          if (existing.data()?.fingerprint !== fingerprint) throw new BusinessError(409, 'Identificador já utilizado com outro conteúdo.');
          return { repeated: true, snapshot: existing.data() };
        }
        const productDoc = await tx.get(productRef);
        await requireLegacyInventory(db, tx, tenantId);
        if (!productDoc.exists) throw new BusinessError(404, 'Produto não encontrado.');
        const product = productDoc.data()!;
        if (product.status === 'inativo') throw new BusinessError(409, 'Produto arquivado.');
        const variation = (product.variations ?? []).find((v: any) => v.id === command.variationId);
        if (!variation) throw new BusinessError(400, 'Variação não encontrada.');
        const channelDoc = await tx.get(db.doc(`tenants/${tenantId}/marketplaces/${command.channelId}`));
        if (!channelDoc.exists) throw new BusinessError(400, 'Canal não encontrado.');
        const materials = Array.isArray(variation.materials) ? variation.materials : [];
        const wastes = Array.isArray(product.wastes) ? product.wastes : [];
        const usages = Array.isArray(product.supplyUsages) ? product.supplyUsages : [];
        const readReferences = async (collection: string, values: unknown[]) => {
          const ids = [...new Set(values.filter(v => v !== undefined && v !== ''))];
          if (ids.length > 100 || ids.some(id => !validId(id))) throw new BusinessError(422, 'Referências de custo inválidas ou excessivas.');
          const docs = await Promise.all(ids.map(id => tx.get(db.doc(`tenants/${tenantId}/${collection}/${id}`))));
          return docs.filter(d => d.exists).map(d => ({ ...d.data(), id: d.id }));
        };
        const filaments = await readReferences('filaments', [variation.filamentId, ...materials.map(m => m.filamentId), ...wastes.filter(w => w.includeInCost).map(w => w.filamentId)]);
        const supplies = await readReferences('supplies', usages.map(u => u.supplyId));
        const printers = await readReferences('printers', [variation.printerId]);
        const settingsDoc = await tx.get(db.doc(`tenants/${tenantId}/settings/pricing`));
        const energyDoc = await tx.get(db.doc(`tenants/${tenantId}/settings/printer`));
        const input = { variation, fixedCost: product.fixedCost ?? 0,
          filaments, supplies, printers,
          supplyUsages: product.supplyUsages ?? [], wastes: product.wastes ?? [],
          pricingSettings: normalizePricingSettings(settingsDoc.data()), energyPrice: Number(energyDoc.data()?.energyPrice ?? 0.95) };
        const breakdown = calculateVariationUnitCostBreakdown(input);
        if (!breakdown.complete) throw new BusinessError(422, breakdown.issues.join(' '));
        const channel = channelDoc.data()!;
        const calculation = calculateChannelPrice(breakdown.totalDecimal, channel, command.targetType as LegacyTargetType, command.targetValue, command.includeAffiliate);
        const entry = { id: body.requestId, savedAt: new Date().toISOString(), ...command,
          variationLabel: `${variation.color ?? 'Padrão'} (${variation.material ?? 'Material'})`, channelName: channel.name ?? 'Canal',
          suggestedPrice: calculation.finalPrice, cost: calculation.cost, profit: calculation.netProfit, margin: calculation.realMargin };
        // Freeze inputs actually used, not unrelated catalogues or credentials.
        const usedFilaments = new Set([variation.filamentId, ...(variation.materials ?? []).map((m: any) => m.filamentId), ...(product.wastes ?? []).filter((w: any) => w.includeInCost).map((w: any) => w.filamentId)]);
        const usedSupplies = new Set(input.supplyUsages.map((u: any) => u.supplyId));
        const snapshot = { ...entry, actorUid: identity.uid, fingerprint, calculationVersion: breakdown.calculationVersion,
          pricingVersion: calculation.result.calculationVersion, costKind: 'legacy-estimate',
          inputs: { ...input, filaments: input.filaments.filter(f => usedFilaments.has(f.id)), supplies: input.supplies.filter(s => usedSupplies.has(s.id)), printers: input.printers.filter(p => p.id === variation.printerId), channel },
          breakdown, commercialInput: calculation.input, commercialResult: calculation.result };
        tx.create(snapshotRef, snapshot);
        tx.update(productRef, { latestSuggestedPrice: entry });
        tx.create(db.collection(`tenants/${tenantId}/auditLogs`).doc(), { actor: identity.uid, action: 'pricing.snapshot.create', productId, snapshotId: snapshotRef.id, createdAt: entry.savedAt });
        return { repeated: false, snapshot };
      });
      return res.status(response.repeated ? 200 : 201).json(response);
    } catch (error) {
      if (error instanceof BusinessError) return res.status(error.status).json({ error: error.message });
      if (error instanceof PricingError) return res.status(422).json({ error: error.message });
      console.error('Falha no cálculo de preço:', error);
      return res.status(503).json({ error: 'Não foi possível calcular e salvar o preço.' });
    }
  });
}
