import { registerMarketplaceListingActions } from './marketplace-listing-actions';
import type { Express } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { BusinessError, validId } from './session';
import { marketplaceAccess, marketplaceViewerAccess } from './marketplace-security';
import { normalizeMLListing, type ListingResult } from '../shared/marketplaces/listings';

export type TokenLoader = (tenant: string, actor: DecodedIdToken, viewer: boolean) => Promise<{
  accessToken: string; context: { creds: any; connection: any };
}>;

// Listing projection and administrator actions; no local inventory writes.
export function registerMarketplaceListingRoutes(app: Express, db: Firestore | null,
  verify: (token: string) => Promise<DecodedIdToken>, loadToken: TokenLoader, fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { at: number; result: ListingResult }>();
  const pending = new Map<string, Promise<ListingResult>>();
  let generation = 0;
  registerMarketplaceListingActions(app, db, verify, loadToken, () => { generation++; cache.clear(); pending.clear(); }, fetcher);
  app.get('/api/tenants/:tenantId/marketplace-listings', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) throw new BusinessError(401, 'Autenticação necessária.');
      let actor: DecodedIdToken;
      try { actor = await verify(token); if (!validId(actor.uid)) throw Error(); }
      catch { throw new BusinessError(401, 'Sessão inválida.'); }
      const tenant = req.params.tenantId;
      if (!validId(tenant)) throw new BusinessError(400, 'Empresa inválida.');
      if (!db) throw new BusinessError(503, 'Consulta indisponível.');
      const { context, accessToken } = await loadToken(tenant, actor, true);
      const startedGeneration = generation;
      const sellerId = String(context.connection.userId);
      if (!/^[1-9]\d{0,19}$/.test(sellerId)) throw Error();
      const cacheKey = JSON.stringify([tenant, sellerId, context.connection.connectedAt, context.creds.revision]);
      async function get(path: string) {
        const response = await fetcher(`https://api.mercadolibre.com${path}`, {
          headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000), redirect: 'error',
        });
        if (!response.ok) throw new BusinessError(502, 'O Mercado Livre não respondeu à consulta. Atualize ou verifique a conexão em Configurações.');
        return response.json();
      }
      async function collect(): Promise<ListingResult> {
        const ids = new Set<string>();
        let total = 0, offset = 0;
        // Offset API has a 1,000-result ceiling. Report partial coverage explicitly above it.
        do {
          const page = await get(`/users/${sellerId}/items/search?limit=100&offset=${offset}`);
          if (!Array.isArray(page.results) || !Number.isSafeInteger(page.paging?.total) || page.paging.total < 0) throw Error();
          total = page.paging.total;
          for (const id of page.results) {
            if (typeof id !== 'string' || !/^MLB\d+$/.test(id)) throw Error();
            ids.add(id);
          }
          offset += page.results.length;
          if (!page.results.length) break;
        } while (offset < total && offset < 1000);
        const all = [...ids], items = new Array(all.length);
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(6, all.length) }, async () => {
          while (cursor < all.length) {
            const index = cursor++, id = all[index];
            const item = await get(`/items/${id}?include_attributes=all`);
            if (item.id !== id || String(item.seller_id) !== sellerId) throw Error();
            items[index] = normalizeMLListing(item);
          }
        }));
        const rank = (status: string) => status === 'active' ? 0 : status === 'closed' ? 2 : 1;
        items.sort((a, b) => rank(a.status) - rank(b.status) || a.title.localeCompare(b.title, 'pt-BR'));
        return { listings: items, total, complete: items.length === total, fetchedAt: new Date().toISOString(), seller: String(context.connection.nickname || sellerId) };
      }
      const saved = cache.get(cacheKey);
      let result: ListingResult;
      if (req.query.refresh !== '1' && saved && Date.now() - saved.at < 60000) result = saved.result;
      else {
        let work = pending.get(cacheKey);
        if (!work) {
          work = collect(); pending.set(cacheKey, work);
          work.then(value => {
            // Bound process memory across companies and connection revisions.
            if (cache.size >= 100) cache.delete(cache.keys().next().value!);
            if (generation === startedGeneration) cache.set(cacheKey, { at: Date.now(), result: value });
          }).finally(() => { if (pending.get(cacheKey) === work) pending.delete(cacheKey); }).catch(() => {});
        }
        result = await work;
      }
      // A revoked membership or replaced connection cannot receive in-flight or cached data.
      await db.runTransaction(async tx => {
        await marketplaceViewerAccess(db, tx, tenant, actor);
        const current = (await tx.get(db.doc(`privateMarketplaceConnections/${tenant}`))).data();
        const creds = (await tx.get(db.doc(`privateMarketplaceCredentials/${tenant}`))).data();
        if (current?.status !== 'connected' || current?.connectedAt !== context.connection.connectedAt || current?.userId !== sellerId ||
            creds?.revision !== context.creds.revision || current?.credentialRevision !== creds?.revision)
          throw new BusinessError(409, 'Conexão alterada. Recarregue a lista.');
      });
      if (generation !== startedGeneration) throw new BusinessError(409, 'Anúncio alterado durante a consulta. Atualize novamente.');
      let canManage = false;
      try { await db.runTransaction(tx => marketplaceAccess(db, tx, tenant, actor, true)); canManage = true; }
      catch (e) { if (!(e instanceof BusinessError && e.status === 403)) throw e; }
      return res.json({ ...result, canManage });
    } catch (error) {
      return res.status(error instanceof BusinessError ? error.status : 502).json({
        error: error instanceof BusinessError ? error.message : 'Não foi possível consultar os anúncios. Tente atualizar novamente.',
      });
    }
  });
}
