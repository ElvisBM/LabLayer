import { requireAssets } from './assets';
import type { Express, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { BusinessError, validId } from './session';
import {
  CatalogError,
  id,
  integer,
  record,
  textValue,
  validateCatalog,
  validateRecipe,
  inspectLegacyProduct,
  recipeHead,
} from '../shared/catalog/model';

const canonical = (value: any): string =>
  JSON.stringify(
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? value.map((v) => JSON.parse(canonical(v)))
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, JSON.parse(canonical(value[k]))]),
          )
      : value,
  );

export function registerCatalogRoutes(
  app: Express,
  db: Firestore | null,
  verify: (token: string) => Promise<DecodedIdToken>,
) {
  async function authorized(tx: Transaction, tenantId: string, uid: string) {
    const tenant = await tx.get(db!.doc(`tenants/${tenantId}`)),
      profile = await tx.get(db!.doc(`users/${uid}`));
    if (
      !tenant.exists ||
      tenant.data()?.status === 'inactive' ||
      !(
        (tenantId === uid && tenant.data()?.ownerUid === uid) ||
        profile.data()?.tenantId === tenantId
      )
    )
      throw new BusinessError(403, 'Empresa sem acesso.');
  }
  const handler =
    (run: (req: Request, uid: string) => Promise<any>) => async (req: Request, res: Response) => {
      if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
      let identity: DecodedIdToken;
      try {
        identity = await verify(token);
      } catch {
        return res.status(401).json({ error: 'Sessão inválida.' });
      }
      try {
        if (!validId(identity.uid) || !validId(req.params.tenantId))
          throw new BusinessError(400, 'Identidade inválida.');
        id(req.params.itemId);
        return res.json(await run(req, identity.uid));
      } catch (error) {
        if (error instanceof BusinessError)
          return res.status(error.status).json({ error: error.message });
        if (error instanceof CatalogError) return res.status(422).json({ error: error.message });
        console.error('Falha no catálogo:', error);
        return res
          .status(503)
          .json({ error: 'Não foi possível concluir. Tente novamente com a mesma solicitação.' });
      }
    };
  app.get(
    '/api/tenants/:tenantId/catalog/:itemId/legacy-review',
    handler(async (req, uid) => {
      const { tenantId, itemId } = req.params;
      return db!.runTransaction(async (tx) => {
        await authorized(tx, tenantId, uid);
        const source = await tx.get(db!.doc(`tenants/${tenantId}/products/${itemId}`));
        if (!source.exists) throw new BusinessError(404, 'Registro legado não encontrado.');
        const raw = source.data()!;
        const text = (v: unknown) => (typeof v === 'string' ? v : '');
        const candidate = {
          name: text(raw.name),
          baseSku: text(raw.baseSku),
          productType: text(raw.productType),
          status: text(raw.status),
          variations: (Array.isArray(raw.variations) ? raw.variations : [])
            .slice(0, 50)
            .map((v: any) => ({
              id: text(v?.id),
              color: text(v?.color),
              material: text(v?.material),
              skuSuffix: text(v?.skuSuffix),
            })),
        };
        return {
          productId: itemId,
          updateTime: `${source.updateTime!.seconds}:${source.updateTime!.nanoseconds}`,
          source: candidate,
          review: inspectLegacyProduct(raw),
        };
      });
    }),
  );

  async function execute(req: Request, uid: string, operation: 'catalog.save' | 'recipe.save') {
    const { tenantId, itemId } = req.params;
    const body = record(
      req.body,
      operation === 'catalog.save'
        ? ['requestId', 'expectedRevision', 'data', 'legacySource']
        : ['requestId', 'expectedRevision', 'variationId', 'expectedRecipeVersion', 'recipe'],
      'Comando',
    );
    const requestId = id(body.requestId),
      expectedRevision = integer(body.expectedRevision, 'Revisão esperada');
    const value =
      operation === 'catalog.save' ? validateCatalog(body.data) : validateRecipe(body.recipe);
    const variationId = operation === 'recipe.save' ? id(body.variationId) : null;
    if (operation === 'recipe.save' && body.expectedRecipeVersion !== null)
      id(body.expectedRecipeVersion);
    let legacySource: { productId: string; updateTime: string; reason: string } | null = null;
    if (operation === 'catalog.save' && body.legacySource !== null) {
      const source = record(body.legacySource, ['productId', 'updateTime', 'reason'], 'Origem');
      legacySource = {
        productId: id(source.productId),
        updateTime: textValue(source.updateTime, 'Versão da origem'),
        reason: textValue(source.reason, 'Motivo da classificação', 500),
      };
      if (legacySource.productId !== itemId)
        throw new CatalogError('Mantenha o ID do registro de origem.');
    }
    const fingerprint = createHash('sha256')
      .update(
        canonical({
          operation,
          itemId,
          uid,
          expectedRevision,
          value,
          variationId,
          legacySource,
          expectedRecipeVersion: body.expectedRecipeVersion ?? null,
        }),
      )
      .digest('hex');
    const root = `tenants/${tenantId}`;
    const itemRef = db!.doc(`${root}/catalogItems/${itemId}`),
      receiptRef = db!.doc(`${root}/catalogCommands/${requestId}`);
    return db!.runTransaction(async (tx) => {
      await authorized(tx, tenantId, uid);
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data()?.fingerprint !== fingerprint)
          throw new BusinessError(409, 'Solicitação já utilizada com outro conteúdo.');
        return { ...receipt.data()!.result, repeated: true };
      }
      const currentDoc = await tx.get(itemRef),
        current = currentDoc.data();
      if ((current?.revision ?? 0) !== expectedRevision)
        throw new BusinessError(
          409,
          'Cadastro alterado por outra pessoa. Recarregue antes de salvar.',
        );
      const now = new Date().toISOString();
      let result: Record<string, any>;
      if (operation === 'catalog.save') {
        const data = validateCatalog(value);
        if (current) {
          if (legacySource !== null) throw new CatalogError('A origem existente é imutável.');
          if (current.kind !== data.kind)
            throw new CatalogError(
              'Classificação existente é imutável; arquive e registre a correção separadamente.',
            );
          if (current.variants.some((v: any) => !data.variants.some((n) => n.id === v.id)))
            throw new CatalogError(
              'Variações não podem ser removidas ou trocar de ID; use arquivamento.',
            );
        }
        let sourceRecord = current?.legacySource ?? null;
        if (!current) {
          const legacy = await tx.get(db!.doc(`${root}/products/${itemId}`));
          if (legacy.exists !== (legacySource !== null))
            throw new CatalogError('Registro legado exige revisão explícita da origem.');
          if (legacySource) {
            if (
              `${legacy.updateTime!.seconds}:${legacy.updateTime!.nanoseconds}` !==
              legacySource.updateTime
            )
              throw new BusinessError(409, 'Origem legada mudou durante a revisão. Recarregue.');
            const old = legacy.data()!;
            const variants = Array.isArray(old.variations) ? old.variations : [];
            const stableIds = variants
              .map((v: any) => v?.id)
              .filter((v: unknown) => {
                try {
                  id(v);
                  return true;
                } catch {
                  return false;
                }
              });
            if (
              data.kind === 'product' &&
              stableIds.some((v) => !data.variants.some((n) => n.id === v))
            )
              throw new CatalogError('Preserve os IDs das variações legadas válidas.');
            sourceRecord = {
              ...legacySource,
              productType: typeof old.productType === 'string' ? old.productType : null,
              review: inspectLegacyProduct(old),
            };
          }
        }
        if (data.kind === 'request-reference') {
          const requestDoc = await tx.get(db!.doc(`${root}/customRequests/${data.requestId}`));
          if (!requestDoc.exists)
            throw new CatalogError('Solicitação vinculada não existe nesta empresa.');
        }
        const item = {
          ...data,
          schemaVersion: 'catalog-v1',
          revision: expectedRevision + 1,
          recipeHeads: current?.recipeHeads ?? {},
          legacySource: sourceRecord,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          actorUid: uid,
        };
        tx.set(itemRef, item);
        tx.create(itemRef.collection('versions').doc(String(item.revision)), item);
        result = { itemId, revision: item.revision };
      } else {
        if (!current || current.kind !== 'product' || current.status !== 'active')
          throw new CatalogError('Produto ativo é obrigatório para preparar receita.');
        if (!current.variants.some((v: any) => v.id === variationId && v.status === 'active'))
          throw new CatalogError('Variação ativa não encontrada.');
        const previousId = recipeHead(current.recipeHeads, variationId!);
        if (previousId !== body.expectedRecipeVersion)
          throw new BusinessError(409, 'Receita alterada por outra pessoa. Recarregue.');
        const previous = previousId
          ? await tx.get(itemRef.collection('recipes').doc(previousId))
          : null;
        const recipe = validateRecipe(value);
        const requireReference = async (collection: string, referenceId: string) => {
          const doc = await tx.get(db!.doc(`${root}/${collection}/${referenceId}`));
          if (!doc.exists)
            throw new CatalogError(`Referência ausente: ${collection}/${referenceId}.`);
          return doc.data()!;
        };
        await requireAssets(
          async (path) => (await tx.get(db!.doc(`${root}/${path}`))).data(),
          recipe.files.map((f) => f.url),
        );
        if (recipe.kind === 'print') {
          const printer = await requireReference('printers', recipe.printerId);
          if (printer.status === 'inativa' || printer.status === 'manutenção')
            throw new CatalogError('Impressora indisponível.');
          for (const material of recipe.materials)
            await requireReference('filaments', material.filamentId);
        }
        for (const supply of recipe.supplies) {
          const source = await requireReference('supplies', supply.supplyId);
          if (source.unit !== supply.unit)
            throw new CatalogError(
              'Unidade do insumo diverge do cadastro. Não converter automaticamente.',
            );
        }
        for (const component of recipe.components) {
          if (component.productId === itemId && component.variationId === variationId)
            throw new CatalogError('Produto não pode ser componente de si mesmo.');
          const componentItem = await requireReference('catalogItems', component.productId);
          const version = await tx.get(
            db!.doc(
              `${root}/catalogItems/${component.productId}/recipes/${component.recipeVersion}`,
            ),
          );
          if (
            componentItem.status !== 'active' ||
            !componentItem.variants.some(
              (v: any) => v.id === component.variationId && v.status === 'active',
            ) ||
            !version.exists ||
            version.data()?.variationId !== component.variationId ||
            version.data()?.recipe.kind !== 'print'
          )
            throw new CatalogError(
              'Componente deve referenciar uma variação ativa com versão de impressão existente; montagem aninhada não é suportada.',
            );
        }
        const snapshot = {
          recipe,
          variationId,
          version: (previous?.data()?.version ?? 0) + 1,
          previousVersion: previousId,
          schemaVersion: 'recipe-v1',
          catalogRevision: expectedRevision,
          productId: itemId,
          createdAt: now,
          actorUid: uid,
        };
        tx.create(itemRef.collection('recipes').doc(requestId), snapshot);
        tx.update(itemRef, { recipeHeads: { ...current.recipeHeads, [variationId!]: requestId } });
        result = { itemId, variationId, recipeVersion: requestId, version: snapshot.version };
      }
      tx.create(receiptRef, { fingerprint, result, createdAt: now, actorUid: uid });
      tx.create(db!.collection(`${root}/auditLogs`).doc(), {
        action: operation,
        ...result,
        actor: uid,
        createdAt: now,
      });
      return { ...result, repeated: false };
    });
  }
  app.post(
    '/api/tenants/:tenantId/catalog/:itemId',
    handler((req, uid) => execute(req, uid, 'catalog.save')),
  );
  app.post(
    '/api/tenants/:tenantId/catalog/:itemId/recipes',
    handler((req, uid) => execute(req, uid, 'recipe.save')),
  );
}
