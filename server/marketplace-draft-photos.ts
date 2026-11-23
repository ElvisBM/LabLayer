import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';
import sharp, { type OutputInfo } from 'sharp';
import { BusinessError } from './session';
import type { AssetStore } from './assets';
import { createLocalAssetStore } from './local-assets';
const MAX_BYTES = 10 * 1024 * 1024;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type PhotoAccess = { tenant: string; actor: string; access(tx: Transaction): Promise<void> };
const types: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const output = (id: string, data: any) => ({ id, url: `https://app.lablayer.com.br/api/listing-photos/${id}.jpg`,
  mime: 'image/jpeg', size: data.size, width: data.width, height: data.height });

/** Converts an image to a clean JPEG (no EXIF), stores it once per tenant and returns its public listing URL. */
export async function storeListingPhoto(db: Firestore, store: AssetStore, c: PhotoAccess, mime: string, bytes: Buffer) {
  if (!types[mime]) throw new BusinessError(415, 'Use JPEG, PNG ou WebP.');
  if (!bytes.length) throw new BusinessError(400, 'Envie uma imagem no corpo da requisição.');
  if (bytes.length > MAX_BYTES) throw new BusinessError(413, 'A foto deve ter no máximo 10 MiB.');
  const dedupRef = db.doc(`privateMarketplaceDraftPhotoHashes/${sha(c.tenant + ':' + mime + ':' + sha(bytes))}`);
  const existing = await db.runTransaction(async tx => { await c.access(tx); return (await tx.get(dedupRef)).data(); });
  if (existing) return { photo: output(existing.id,existing), created: false };
  let converted: { data: Buffer; info: OutputInfo };
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== types[mime] || (metadata.pages ?? 1) !== 1) throw Error();
    converted = await image.rotate().resize(2560,2560,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'})
      .jpeg({quality:92,mozjpeg:true}).toBuffer({resolveWithObject:true});
  } catch { throw new BusinessError(422, 'Imagem inválida. Use JPEG, PNG ou WebP estático, até 40 megapixels.'); }
  // The generated JPEG contains only decoded pixels, with EXIF/location metadata removed.
  const path = `tenants/${c.tenant}/managed-assets/${sha(converted.data)}`;
  await db.runTransaction(c.access);
  await store.put(path,converted.data,'image/jpeg');
  return await db.runTransaction(async tx => {
    await c.access(tx); const prior = (await tx.get(dedupRef)).data();
    if (prior) return { photo: output(prior.id,prior), created: false };
    const id = randomBytes(32).toString('hex'), createdAt = new Date().toISOString();
    const data = { id, tenantId:c.tenant, path, mime:'image/jpeg', size:converted.data.length,
      width:converted.info.width, height:converted.info.height, active:true, createdAt, createdBy:c.actor };
    tx.create(db!.doc(`privateMarketplaceDraftPhotos/${id}`),data); tx.create(dedupRef,data);
    tx.create(db!.collection(`tenants/${c.tenant}/auditLogs`).doc(),{operation:'marketplace.draft.photo-uploaded',actor:c.actor,photoId:id,createdAt});
    return { photo: output(id,data), created: true };
  });
}

export function registerMarketplaceDraftPhotoRoutes(app: Express, db: Firestore | null,
  authorize: (req: Request) => Promise<PhotoAccess>,
  store: AssetStore | null = process.env.LABLAYER_ASSET_DIR ? createLocalAssetStore(process.env.LABLAYER_ASSET_DIR) : null) {
  const fail = (res: Response, error: unknown) => res.status(error instanceof BusinessError ? error.status : 503)
    .json({ error: error instanceof BusinessError ? error.message : 'Não foi possível salvar a foto. Tente novamente; o mesmo arquivo não será duplicado.' });
  const parse = express.raw({ type: Object.keys(types), limit: MAX_BYTES, inflate: false });
  app.post('/api/tenants/:tenantId/listing-drafts/photos', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.locals.photoAccess = await authorize(req);
      if (!store) throw new BusinessError(503, 'Armazenamento de imagens indisponível.');
      const mime = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
      if (!mime || !types[mime]) throw new BusinessError(415, 'Envie o arquivo como corpo binário com Content-Type image/jpeg, image/png ou image/webp.');
      res.locals.photoMime = mime;
      parse(req, res, (error?: any) => {
        if (error) return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: error.type === 'entity.too.large' ? 'A foto deve ter no máximo 10 MiB.' : 'Não foi possível ler a imagem. Envie o arquivo binário sem compressão HTTP.' });
        next();
      });
    } catch (e) { return fail(res,e); }
  }, async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const c = res.locals.photoAccess as PhotoAccess, mime = res.locals.photoMime as string;
      if (!db || !store) throw new BusinessError(503, 'Armazenamento indisponível.');
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new BusinessError(400, 'Envie uma imagem no corpo da requisição.');
      const { photo, created } = await storeListingPhoto(db, store, c, mime, req.body);
      return res.status(created ? 201 : 200).json(photo);
    } catch (e) { return fail(res,e); }
  });
  // These unguessable URLs are intentionally readable by images/marketplace crawlers, without an API key.
  app.get('/api/listing-photos/:filename',async(req,res)=>{
    try {
      if (!db || !store) return res.status(503).end();
      const match = /^([a-f0-9]{64})\.jpg$/.exec(req.params.filename);
      if (!match) return res.status(404).end();
      const data = (await db.doc(`privateMarketplaceDraftPhotos/${match[1]}`).get()).data();
      if (!data?.active) return res.status(404).end();
      const bytes = await store.get(data.path);
      res.set({'Content-Type':'image/jpeg','Content-Length':String(bytes.length),'X-Content-Type-Options':'nosniff',
        'Content-Disposition':`inline; filename="${match[1]}.jpg"`,'Cache-Control':'public, max-age=86400',
        'Content-Security-Policy':"default-src 'none'",'Referrer-Policy':'no-referrer'});
      return res.send(bytes);
    } catch { return res.status(503).end(); }
  });
}
