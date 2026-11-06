import { registerMarketplaceDraftPhotoRoutes } from './marketplace-draft-photos';
import type { AssetStore } from './assets';
import type { Express, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { BusinessError, validId } from './session';
import { marketplaceAccess, marketplaceViewerAccess } from './marketplace-security';
import type { TokenLoader } from './marketplace-listings';
import { normalizeDraft, publicationPayload, type ListingDraft } from '../shared/marketplaces/drafts';
import { safeListingUrl } from '../shared/marketplaces/listings';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const now = () => new Date().toISOString();
const uncertain = 'Não foi possível confirmar a publicação. Confira o Mercado Livre antes de tentar novamente; a LabLayer não criará outro anúncio automaticamente.';
const categoryGroups = [
  { id: 'all', label: 'Presentes, casa e utilidades', roots: ['MLB1574', 'MLB12404', 'MLB1368', 'MLB1132', 'MLB1500', 'MLB1499', 'MLB263532', 'MLB1071', 'MLB1000', 'MLB5726'] },
  { id: 'gifts', label: 'Presentes e lembrancinhas', roots: ['MLB12404', 'MLB1574', 'MLB1368'] },
  { id: 'home', label: 'Casa, decoração e utilidades', roots: ['MLB1574', 'MLB1500', 'MLB263532'] },
  { id: 'craft3d', label: 'Artesanato e produtos feitos em 3D', roots: ['MLB1368', 'MLB1499', 'MLB263532', 'MLB1500', 'MLB1574', 'MLB1132'] },
  { id: 'toys', label: 'Brinquedos, hobbies e miniaturas', roots: ['MLB1132'] },
  { id: 'pets', label: 'Acessórios para pets', roots: ['MLB1071'] },
  { id: 'electronics', label: 'Acessórios eletrônicos', roots: ['MLB1000', 'MLB5726', 'MLB1499'] },
];
const categorySuggestions: Record<string, string[]> = {
  all: ['natal', 'lembrancinhas', 'chaveiros', 'decoração', 'miniaturas', 'artesanato', 'organizador', 'vasos', 'utensílios'],
  gifts: ['natal', 'lembrancinhas', 'caixas de presente', 'chaveiros', 'decoração de festa'],
  home: ['decoração', 'velas', 'vasos', 'organizadores', 'cozinha', 'suportes'],
  craft3d: ['artesanato', 'miniaturas', 'decoração', 'chaveiros', 'organizadores', 'suportes'],
  toys: ['miniaturas', 'modelismo', 'brinquedos'],
  pets: ['cães', 'gatos', 'aquários', 'suportes'],
  electronics: ['suportes', 'acessórios', 'organizadores'],
};
const publicDraft = (id: string, d: any): ListingDraft => ({ id, data: d.data, revision: d.revision, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt,
  ...(d.itemId ? { itemId: d.itemId } : {}), ...(d.itemUrl ? { itemUrl: d.itemUrl } : {}), ...(d.remoteStatus ? { remoteStatus: d.remoteStatus } : {}), ...(d.message ? { message: d.message } : {}) });
const input = (b: unknown) => { try { return normalizeDraft(b); } catch (e) { throw new BusinessError(400, (e as Error).message); } };

export function registerMarketplaceDraftRoutes(app: Express, db: Firestore | null, verify: (token: string) => Promise<DecodedIdToken>,
  loadToken: TokenLoader, invalidate: () => void, fetcher: typeof fetch = fetch, photoStore?: AssetStore | null) {
  const base = '/api/tenants/:tenantId/listing-drafts';
  const root = (tenant: string) => db!.collection(`privateMarketplaceDrafts/${tenant}/items`);
  let categoryDump: Record<string, any> | null = null;
  let categoryDumpLoadedAt = 0;
  let categoryDumpPromise: Promise<Record<string, any>> | null = null;
  async function loadCategoryDump() {
    if (categoryDump && Date.now() - categoryDumpLoadedAt < 12 * 60 * 60 * 1000) return categoryDump;
    if (categoryDumpPromise) return categoryDumpPromise;
    categoryDumpPromise = (async () => {
      const response = await fetcher('https://api.mercadolibre.com/sites/MLB/categories/all', {
        headers: { Accept: 'application/json', 'User-Agent': 'LabLayer/1.0' },
        redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new BusinessError(502, 'Não foi possível carregar as categorias oficiais do Mercado Livre. Tente novamente em instantes.');
      const result = await response.json() as Record<string, any>;
      if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length < 100) throw new BusinessError(502, 'A lista oficial de categorias do Mercado Livre veio incompleta. Tente novamente em instantes.');
      categoryDump = result;
      categoryDumpLoadedAt = Date.now();
      return result;
    })().finally(() => { categoryDumpPromise = null; });
    return categoryDumpPromise;
  }
  async function context(req: Request, manage = false, human = false) {
    if (!db) throw new BusinessError(503, 'Serviço indisponível.');
    const tenant = req.params.tenantId;
    if (!validId(tenant)) throw new BusinessError(400, 'Empresa inválida.');
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new BusinessError(401, 'Autenticação necessária.');
    let identity: DecodedIdToken | undefined;
    const keyRef = token.startsWith('ll_drafts_') ? db.doc(`privateMarketplaceDraftKeys/${hash(token)}`) : null;
    if (keyRef && human) throw new BusinessError(403, 'Esta chave só gerencia rascunhos. Aprovação e publicação exigem um administrador na LabLayer.');
    if (!keyRef) {
      try { identity = await verify(token); if (!validId(identity.uid)) throw Error(); }
      catch { throw new BusinessError(401, 'Sessão inválida.'); }
    }
    let actor = '';
    async function access(tx: Transaction) {
      if (keyRef) {
        const key = (await tx.get(keyRef)).data();
        if (!key || key.active !== true || (key.expiresAt && key.expiresAt <= now())) throw new BusinessError(401, 'Chave inválida ou revogada.');
        if (key.tenantId !== tenant || !key.scopes?.includes(manage ? 'listing-drafts:write' : 'listing-drafts:read')) throw new BusinessError(403, 'Chave sem acesso a esta operação.');
        if (!validId(key.createdBy)) throw new BusinessError(403, 'Responsável pela chave inválido.');
        await marketplaceAccess(db!, tx, tenant, { uid: key.createdBy }, true);
        actor = `key:${key.id}`;
      } else {
        await (manage ? marketplaceAccess(db!, tx, tenant, identity!, true) : marketplaceViewerAccess(db!, tx, tenant, identity!));
        actor = identity!.uid;
      }
    }
    await db.runTransaction(access);
    return { tenant, identity, access, actor, key: !!keyRef };
  }
  registerMarketplaceDraftPhotoRoutes(app, db, req => context(req, true), photoStore);
  function audit(tx: Transaction, c: { tenant: string; actor: string }, operation: string, id: string, revision: number) {
    tx.create(db!.collection(`tenants/${c.tenant}/auditLogs`).doc(), { operation: `marketplace.draft.${operation}`, actor: c.actor,
      draftId: id, revision, provider: 'mercadolivre', createdAt: now() });
  }
  const fail = (res: Response, e: unknown) => res.status(e instanceof BusinessError ? e.status : 502)
    .json({ error: e instanceof BusinessError ? e.message : 'Não foi possível concluir. Atualize para conferir o resultado.' });
  app.get(base, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const c = await context(req);
      let canManage = c.key;
      const after = req.query.after;
      if (after !== undefined && (typeof after !== 'string' || !/^[a-f0-9]{64}$/.test(after))) throw new BusinessError(400, 'Cursor inválido.');
      const result = await db!.runTransaction(async tx => {
        await c.access(tx);
        let query = root(c.tenant).orderBy('__name__').limit(101);
        if (after) query = query.startAfter(after);
        return tx.get(query);
      });
      if (!c.key) {
        try { await db!.runTransaction(tx => marketplaceAccess(db!, tx, c.tenant, c.identity!, true)); canManage = true; }
        catch (e) { if (!(e instanceof BusinessError && e.status === 403)) throw e; }
      }
      return res.json({ drafts: result.docs.slice(0,100).map(d => publicDraft(d.id, d.data())), canManage,
        nextCursor: result.size > 100 ? result.docs[99].id : null });
    } catch (e) { return fail(res, e); }
  });
  app.get(`${base}/categories`, async (req, res) => {
    res.set('Cache-Control', 'private, max-age=300');
    try {
      await context(req);
      const groupId = typeof req.query.group === 'string' ? req.query.group : 'all';
      const group = categoryGroups.find(item => item.id === groupId);
      if (!group) throw new BusinessError(400, 'Grupo de categorias inválido.');
      const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const currentId = typeof req.query.id === 'string' && /^MLB\d{1,12}$/.test(req.query.id) ? req.query.id : '';
      const tree = await loadCategoryDump();
      const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const candidates = Object.values(tree).flatMap((value: any) => {
        const path = value?.path_from_root;
        if (value?.settings?.listing_allowed !== true || (Array.isArray(value.children_categories) && value.children_categories.length > 0) || !Array.isArray(path) || !path.length || !group.roots.includes(path[0]?.id)) return [];
        return [{ id: value.id, name: value.name, path: path.map((part: any) => part.name).join(' › '), rootId: path[0].id }];
      });
      const normalizedQuery = normalize(query);
      const tokens = normalizedQuery.split(/\s+/).filter(token => token.length > 1);
      const ranked = candidates.map(category => {
        const path = normalize(category.path);
        const score = tokens.reduce((sum, token) => sum + (path.includes(token) ? 1 : 0), 0);
        return { category, score };
      });
      let matches = query
        ? ranked.filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.category.path.localeCompare(b.category.path, 'pt-BR')).map(item => item.category)
        : ranked.filter(item => categorySuggestions[group.id].some(term => normalize(item.category.path).includes(normalize(term))))
            .sort((a, b) => a.category.path.localeCompare(b.category.path, 'pt-BR')).map(item => item.category);
      const total = matches.length;
      matches = matches.slice(0, 100);
      let selected = null;
      if (currentId && tree[currentId]?.settings?.listing_allowed === true) {
        const value = tree[currentId];
        selected = { id: value.id, name: value.name, path: value.path_from_root.map((part: any) => part.name).join(' › ') };
      }
      return res.json({ groups: categoryGroups.map(({ id, label }) => ({ id, label })), categories: matches, total, hasMore: total > matches.length, selected });
    } catch (e) { return fail(res, e); }
  });
  app.post(base, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const c = await context(req, true), data = input(req.body), ref = root(c.tenant).doc(hash(data.externalId));
      let created = false;
      const result = await db!.runTransaction(async tx => {
        await c.access(tx);
        const old = (await tx.get(ref)).data();
        if (old) {
          if (JSON.stringify(old.data) !== JSON.stringify(data) && hash(JSON.stringify(input(old.data))) !== hash(JSON.stringify(data)))
            throw new BusinessError(409, 'Referência já cadastrada com outros dados. Abra o rascunho e envie a revisão atual para alterá-lo.');
          return old;
        }
        const draft = { data, tenantId: c.tenant, status: 'draft', revision: 1, createdAt: now(), updatedAt: now(), createdBy: c.actor };
        tx.create(ref, draft); audit(tx, c, 'created', ref.id, 1); created = true; return draft;
      });
      return res.status(created ? 201 : 200).json(publicDraft(ref.id, result));
    } catch (e) { return fail(res, e); }
  });
  app.get(`${base}/:draftId`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const c = await context(req), ref = draftRef(c.tenant, req.params.draftId);
      const d = await db!.runTransaction(async tx => { await c.access(tx); return (await tx.get(ref)).data(); });
      if (!d) throw new BusinessError(404, 'Rascunho não encontrado.');
      return res.json(publicDraft(ref.id, d));
    } catch (e) { return fail(res,e); }
  });
  function draftRef(tenant: string, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new BusinessError(400, 'Rascunho inválido.');
    return root(tenant).doc(id);
  }
  function checkRevision(d: any, revision: unknown) {
    if (!d) throw new BusinessError(404, 'Rascunho não encontrado.');
    if (!Number.isSafeInteger(revision) || revision !== d.revision) throw new BusinessError(409, 'O rascunho mudou. Atualize e confira antes de continuar.');
  }
  app.post(`${base}/:draftId/save`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const c = await context(req, true), ref = draftRef(c.tenant, req.params.draftId), data = input(req.body?.data);
      if (Object.keys(req.body).some(k => !['revision','data'].includes(k))) throw new BusinessError(400, 'Alteração inválida.');
      const result = await db!.runTransaction(async tx => {
        await c.access(tx); const d = (await tx.get(ref)).data(); checkRevision(d, req.body.revision);
        if (!['draft','approved'].includes(d!.status) || d!.itemId) throw new BusinessError(409, 'Rascunho já enviado para publicação. Confira o resultado no Mercado Livre.');
        if (data.externalId !== d!.data.externalId) throw new BusinessError(400, 'A referência do rascunho não pode mudar.');
        const patch = { data, status: 'draft', approval: null, revision: d!.revision + 1, updatedAt: now(), message: '' };
        tx.update(ref, patch); audit(tx, c, 'updated', ref.id, patch.revision); return { ...d, ...patch };
      });
      return res.json(publicDraft(ref.id, result));
    } catch (e) { return fail(res,e); }
  });
  app.post(`${base}/:draftId/actions`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let locked: DocumentReference | undefined, attempt: string | undefined, sent = false;
    let knownItem: string | undefined;
    try {
      const c = await context(req, true, true), ref = draftRef(c.tenant, req.params.draftId), body = req.body;
      if (!body || Object.keys(body).some(k => !['action','revision'].includes(k)) || !['approve','publish','complete'].includes(body.action)) throw new BusinessError(400, 'Ação inválida.');
      const d = (await ref.get()).data(); checkRevision(d, body.revision);
      if (body.action === 'publish' && d!.status === 'published') return res.json(publicDraft(ref.id, d));
      if (body.action === 'approve' && !['draft','approved'].includes(d!.status)) throw new BusinessError(409, 'Este rascunho já foi enviado para publicação.');
      if (body.action === 'publish' && d!.status !== 'approved') throw new BusinessError(409, 'Aprove a revisão atual antes de publicar.');
      if (body.action === 'complete' && (!['attention','publishing'].includes(d!.status) || !d!.itemId || d!.leaseUntil > Date.now())) throw new BusinessError(409, 'Aguarde ou confira o anúncio diretamente no Mercado Livre.');
      const loaded = await loadToken(c.tenant, c.identity!, false);
      const sellerId = String(loaded.context.connection.userId);
      if (!/^\d+$/.test(sellerId)) throw new BusinessError(409, 'Conta do Mercado Livre inválida.');
      async function access(tx: Transaction) {
        await c.access(tx);
        const current = (await tx.get(db!.doc(`privateMarketplaceConnections/${c.tenant}`))).data();
        const creds = (await tx.get(db!.doc(`privateMarketplaceCredentials/${c.tenant}`))).data();
        if (current?.status !== 'connected' || String(current.userId) !== sellerId || current.connectedAt !== loaded.context.connection.connectedAt ||
          creds?.revision !== loaded.context.creds.revision || current.credentialRevision !== creds?.revision) throw new BusinessError(409, 'A conexão mudou. Atualize e aprove novamente.');
      }
      const connectionStamp = hash(JSON.stringify([sellerId, loaded.context.connection.connectedAt, loaded.context.creds.revision]));
      async function remote(path: string, init: RequestInit = {}) {
        return fetcher(`https://api.mercadolibre.com${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${loaded.accessToken}`, 'Content-Type': 'application/json' } });
      }
      async function providerError(r: globalThis.Response) {
        const v = await r.json().catch(() => ({}));
        const clean = (value: unknown, max = 240) => typeof value === 'string'
          ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
          : '';
        const causes = Array.isArray(v?.cause) ? v.cause.filter((cause: unknown) => cause && typeof cause === 'object') : [];
        const blocking = causes.filter((cause: any) => cause.type === 'error');
        const selected = (blocking.length ? blocking : causes).slice(0, 5);
        const details = selected.map((cause: any) => {
          const code = clean(typeof cause.code === 'number' ? String(cause.code) : cause.code, 100);
          const references = Array.isArray(cause.references)
            ? cause.references.map((value: unknown) => clean(value, 80)).filter(Boolean).slice(0, 3).join(', ')
            : '';
          const message = clean(cause.message);
          return [code, references ? `(${references})` : '', message].filter(Boolean).join(' — ');
        }).filter(Boolean);
        const providerCode = clean(v?.error, 100);
        const providerMessage = clean(v?.message, 240);
        const fallback = [providerCode, providerMessage].filter(Boolean).join(' — ') || `HTTP ${r.status}`;
        const reason = details.length ? details.join('; ') : fallback;
        return new BusinessError(422, `O Mercado Livre recusou os dados. Motivo: ${reason}. Revise o campo indicado e valide novamente.`);
      }
      if (body.action === 'approve') {
        const profile = await remote('/users/me');
        if (!profile.ok) throw new BusinessError(502, 'Não foi possível conferir a conta do Mercado Livre.');
        const seller = await profile.json();
        if (String(seller.id) !== sellerId) throw new BusinessError(403, 'Conta do Mercado Livre divergente.');
        let payload: ReturnType<typeof publicationPayload>;
        try { payload = publicationPayload(input(d!.data), (seller.tags || []).includes('user_product_seller')); }
        catch (e) { if (e instanceof BusinessError) throw e; throw new BusinessError(400, (e as Error).message); }
        const validation = await remote('/items/validate', { method: 'POST', body: JSON.stringify(payload) });
        if (!validation.ok) throw await providerError(validation);
        const result = await db!.runTransaction(async tx => {
          await access(tx); const current = (await tx.get(ref)).data(); checkRevision(current, body.revision);
          if (!['draft','approved'].includes(current!.status)) throw new BusinessError(409, 'Rascunho já enviado.');
          const patch = { status: 'approved', approval: { revision: d!.revision, actor: c.actor, at: now(), connectionStamp, payload }, updatedAt: now(), message: '' };
          tx.update(ref, patch); audit(tx, c, 'approved', ref.id, d!.revision); return { ...current, ...patch };
        });
        return res.json(publicDraft(ref.id, result));
      }
      if (d!.approval?.revision !== d!.revision || d!.approval?.connectionStamp !== connectionStamp) throw new BusinessError(409, 'A conta ou a revisão mudou. Revise e aprove novamente antes de publicar.');
      attempt = randomUUID();
      await db!.runTransaction(async tx => {
        await access(tx); const current = (await tx.get(ref)).data(); checkRevision(current, body.revision);
        if (current!.status !== d!.status || current!.leaseUntil > Date.now()) throw new BusinessError(409, 'Há uma publicação em andamento. Atualize para conferir.');
        tx.update(ref, { status: 'publishing', attempt, leaseUntil: Date.now() + 180000, updatedAt: now(), message: 'Enviando ao Mercado Livre…' });
        audit(tx, c, 'publishing', ref.id, d!.revision);
      });
      locked = ref; knownItem = d!.itemId;
      await db!.runTransaction(access);
      if (!knownItem) {
        // Persist the intent before creating. Ambiguous results must never retry POST /items.
        sent = true;
        const created = await remote('/items', { method: 'POST', body: JSON.stringify(d!.approval.payload) });
        if (!created.ok) {
          if (created.status >= 400 && created.status < 500 && ![408,429].includes(created.status)) { sent = false; throw await providerError(created); }
          throw new BusinessError(502, uncertain);
        }
        const item = await created.json();
        if (!/^MLB\d+$/.test(item.id) || String(item.seller_id) !== sellerId) throw new BusinessError(502, uncertain);
        knownItem = item.id;
        // Save the returned id before the separate description request, so recovery never creates a duplicate.
        await ref.update({ itemId: knownItem, itemUrl: safeListingUrl(item.permalink, 'mercadolivre.com.br'), remoteStatus: item.status || 'unknown', updatedAt: now() });
      }
      const currentItem = await remote(`/items/${knownItem}`);
      if (!currentItem.ok) throw new BusinessError(502, uncertain);
      const item = await currentItem.json();
      if (item.id !== knownItem || String(item.seller_id) !== sellerId) throw new BusinessError(403, 'Anúncio não pertence à conta aprovada.');
      const description = await remote(`/items/${knownItem}/description`);
      const oldDescription = description.ok ? await description.json() : null;
      if (!description.ok && description.status !== 404) throw new BusinessError(502, 'Anúncio criado; não foi possível conferir a descrição. Use Concluir publicação.');
      if (oldDescription?.plain_text !== d!.data.description) {
        await db!.runTransaction(access);
        const updated = await remote(`/items/${knownItem}/description`, { method: description.status === 404 ? 'POST' : 'PUT', body: JSON.stringify({ plain_text: d!.data.description }) });
        if (!updated.ok) throw new BusinessError(502, 'Anúncio criado; a descrição ainda precisa ser concluída. Use Concluir publicação.');
      }
      const confirmed = await remote(`/items/${knownItem}/description`);
      if (!confirmed.ok || (await confirmed.json()).plain_text !== d!.data.description) throw new BusinessError(502, 'Anúncio criado; confirme a descrição usando Concluir publicação.');
      const result = await db!.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (current?.attempt !== attempt) throw new BusinessError(409, 'Publicação em conferência. Atualize.');
        const patch = { status: 'published', leaseUntil: 0, updatedAt: now(), message: 'Anúncio e descrição confirmados no Mercado Livre.', itemId: knownItem!,
          itemUrl: safeListingUrl(item.permalink, 'mercadolivre.com.br'), remoteStatus: item.status || 'unknown' };
        tx.update(ref, patch); audit(tx,c,'published',ref.id,d!.revision); return { ...current, ...patch };
      });
      locked = undefined; invalidate(); await db!.runTransaction(access);
      return res.json(publicDraft(ref.id,result));
    } catch (e) {
      if (locked) await db!.runTransaction(async tx => {
        const current = (await tx.get(locked!)).data();
        if (current?.attempt !== attempt) return;
        const ambiguous = sent || !!knownItem || !!current.itemId;
        tx.update(locked!, { status: ambiguous ? 'attention' : 'draft', approval: ambiguous ? current.approval : null, leaseUntil: 0, updatedAt: now(),
          ...(knownItem ? { itemId: knownItem } : {}), message: ambiguous ? (knownItem ? 'Anúncio criado. Use Concluir publicação para conferir e completar a descrição, sem criar outro anúncio.' : uncertain) : (e instanceof BusinessError ? e.message : 'Publicação não enviada. Revise e aprove novamente.') });
      }).catch(() => {});
      if (locked) invalidate();
      return fail(res, e);
    }
  });
}
