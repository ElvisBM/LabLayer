import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { registerMarketplaceOAuthRoutes } from '../../server/marketplace-oauth';
import { sealMarketplaceSecret } from '../../server/marketplace-security';
import { registerMercadoLivreMcp, hashMcpKey } from '../../server/mcp-mercadolivre';
import type { AssetStore } from '../../server/assets';

const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'mcp-listing-tests');
const db = getFirestore(firebase), key = randomBytes(32), remote = vi.fn<typeof fetch>();
const files = new Map<string, Buffer>();
const store: AssetStore = { async put(p, b) { files.set(p, b); }, async get(p) { return files.get(p)!; } };
const app = express(); app.use(express.json());
const loadToken = registerMarketplaceOAuthRoutes(app, db, async () => { throw Error(); }, key, remote);
registerMercadoLivreMcp(app, db, loadToken, { claims: async () => ({}), fetcher: remote, rateLimitPerMinute: 1000, photoStore: store, publicUrl: 'https://app.example.com' });
const writeKey = 'll_mcp_' + 'w'.repeat(43), readKey = 'll_mcp_' + 'r'.repeat(43);
const respond = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
const call = async (name: string, args: any = {}, token = writeKey) => {
  const r = await request(app).post('/api/mcp').set('Authorization', `Bearer ${token}`).set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).expect(200);
  const result = r.body.result;
  return { error: !!result.isError, content: result.content, text: result.content[0].text as string, json: () => JSON.parse(result.content[0].text) };
};
const posts = (path: string) => remote.mock.calls.filter(([u, init]) => init?.method === 'POST' && new URL(String(u)).pathname === path);
let validation: { status: number; body: any }, create: { status: number; body: any };

beforeEach(async () => {
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents', { method: 'DELETE' });
  files.clear();
  await db.doc('tenants/a').set({ ownerUid: 'owner', status: 'active' });
  await db.doc('privateMarketplaceCredentials/a').set({ clientId: '1234', revision: 2, secret: sealMarketplaceSecret(key, 'a', 'test-client-secret') });
  await db.doc('privateMarketplaceConnections/a').set({ status: 'connected', userId: '123', nickname: 'LOJA', clientId: '1234', credentialRevision: 2, connectedAt: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), tokens: sealMarketplaceSecret(key, 'a:oauth', JSON.stringify({ accessToken: 'test-access', refreshToken: 'test-refresh' })) });
  await db.doc(`privateMcpKeys/${hashMcpKey(writeKey)}`).set({ id: 'aaaaaaaaaaaa', tenantId: 'a', createdBy: 'owner', scopes: ['mercadolivre:read', 'mercadolivre:write'], active: true });
  await db.doc(`privateMcpKeys/${hashMcpKey(readKey)}`).set({ id: 'bbbbbbbbbbbb', tenantId: 'a', createdBy: 'owner', scopes: ['mercadolivre:read'], active: true });
  validation = { status: 204, body: null }; create = { status: 201, body: { id: 'MLB55', seller_id: 123, status: 'active', permalink: 'https://produto.mercadolivre.com.br/MLB55' } };
  remote.mockReset().mockImplementation(async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === '/users/me') return respond({ id: 123, nickname: 'LOJA', tags: [] });
    if (u.pathname === '/users/123/shipping_preferences') return respond({ modes: ['me2', 'not_specified'] });
    if (u.pathname === '/sites/MLB/domain_discovery/search') return respond([{ domain_name: 'Vasos', category_id: 'MLB1637', attributes: [{ id: 'BRAND', value_name: 'X' }] }]);
    if (u.pathname === '/categories/MLB1637') return respond({ id: 'MLB1637', path_from_root: [{ name: 'Casa' }, { name: 'Vasos' }], settings: { listing_allowed: true, max_pictures_per_item: 12 }, children_categories: [] });
    if (u.pathname === '/categories/MLB1637/attributes') return respond([
      { id: 'BRAND', name: 'Marca', value_type: 'string', tags: { required: true } },
      { id: 'COLOR', name: 'Cor', value_type: 'list', tags: { new_required: true }, values: [{ id: '52049', name: 'Preto' }] },
      { id: 'HEIGHT', name: 'Altura', value_type: 'number_unit', tags: {}, allowed_units: [{ id: 'cm', name: 'cm' }] },
      { id: 'ITEM_CONDITION', name: 'Condição', tags: { hidden: true } }]);
    if (u.pathname === '/items/validate') return new Response(validation.body ? JSON.stringify(validation.body) : null, { status: validation.status });
    if (u.pathname === '/sites/MLB/listing_prices') return respond({ listing_type_id: 'gold_special', sale_fee_amount: 7.5 });
    if (u.pathname === '/items' && init?.method === 'POST') return respond(create.body, create.status);
    if (u.pathname === '/items/MLB55/description') return respond({ plain_text: 'ok' }, 201);
    return respond({ message: 'not found' }, 404);
  });
});
afterAll(async () => { await db.terminate(); await deleteApp(firebase); });

const png = () => sharp({ create: { width: 800, height: 600, channels: 3, background: '#c33' } }).png().toBuffer();
async function uploadBatch() {
  const link = (await call('ml_link_fotos')).json();
  const path = new URL(link.link).pathname;
  const page = await request(app).get(path).expect(200);
  expect(page.text).toContain('Fotos do anúncio');
  await request(app).post(path).set('Content-Type', 'image/png').send(await png()).expect(201);
  return { lote: link.lote as string, path };
}
const listing = (extra: any = {}) => ({ titulo: 'Vaso decorativo 3D', categoria: 'MLB1637', preco: 49.9, estoque: 10, descricao: 'Vaso em PLA.',
  atributos: [{ id: 'BRAND', valor: 'MR Encantare' }, { id: 'COLOR', valor_id: '52049' }], ...extra });

it('sugere categoria e lista a ficha técnica obrigatória de forma compacta', async () => {
  expect((await call('ml_buscar_categoria', { texto: 'vaso 3d' }, readKey)).json().categorias[0])
    .toMatchObject({ categoria: 'MLB1637', caminho: 'Casa > Vasos', permite_anuncio: true });
  const attrs = (await call('ml_atributos_categoria', { categoria: 'MLB1637' }, readKey)).json();
  expect(attrs.obrigatorios.map((a: any) => a.id)).toEqual(['BRAND', 'COLOR']);
  expect(attrs.obrigatorios[1].valores).toEqual(['52049=Preto']);
  expect(attrs.outros).toEqual(['HEIGHT (Altura)']);
});

it('recebe fotos pelo link, mostra miniaturas e recusa link inválido ou expirado', async () => {
  expect((await call('ml_link_fotos', {}, readKey)).text).toContain('somente leitura');
  const { lote, path } = await uploadBatch();
  await request(app).post(path).set('Content-Type', 'image/png').send(await png()).expect(201); // same file: no duplicate
  const seen = await call('ml_ver_fotos', { lote });
  expect(JSON.parse(seen.content[0].text)).toMatchObject({ total: 1 });
  expect(seen.content[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  await request(app).post(path.replace(/\.[\w-]+$/, '.' + 'x'.repeat(43))).set('Content-Type', 'image/png').send(await png()).expect(404);
  await db.doc(`privateMcpPhotoBatches/${lote}`).update({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  await request(app).post(path).set('Content-Type', 'image/png').send(await png()).expect(410);
});

it('valida sem criar e publica uma única vez com auditoria e rascunho na LabLayer', async () => {
  const { lote } = await uploadBatch();
  const check = (await call('ml_publicar_anuncio', listing({ lote, apenas_validar: true }))).json();
  expect(check).toMatchObject({ valido: true, tarifa_venda: 7.5, repasse_sem_frete: 42.4, fotos: 1 });
  expect(posts('/items')).toHaveLength(0);
  const sent = JSON.parse(posts('/items/validate')[0][1]!.body as string);
  expect(sent).toMatchObject({ title: 'Vaso decorativo 3D', category_id: 'MLB1637', price: 49.9, currency_id: 'BRL', listing_type_id: 'gold_special',
    attributes: [{ id: 'BRAND', value_name: 'MR Encantare' }, { id: 'COLOR', value_id: '52049' }] });
  expect(sent.pictures[0].source).toMatch(/^https:\/\/app\.lablayer\.com\.br\/api\/listing-photos\/[a-f0-9]{64}\.jpg$/);

  const done = (await call('ml_publicar_anuncio', listing({ lote }))).json();
  expect(done).toMatchObject({ publicado: true, anuncio: 'MLB55', link: 'https://produto.mercadolivre.com.br/MLB55' });
  expect(JSON.parse(posts('/items/MLB55/description')[0][1]!.body as string)).toEqual({ plain_text: 'Vaso em PLA.' });
  const again = (await call('ml_publicar_anuncio', listing({ lote }))).json();
  expect(again).toMatchObject({ publicado: true, ja_existia: true, anuncio: 'MLB55' });
  expect(posts('/items')).toHaveLength(1);
  const draft = (await db.doc(`privateMarketplaceDrafts/a/items/${done.rascunho_id}`).get()).data();
  expect(draft).toMatchObject({ status: 'published', itemId: 'MLB55', createdBy: 'mcp:aaaaaaaaaaaa', approval: { revision: 1 } });
  const audits = (await db.collection('tenants/a/auditLogs').get()).docs.map(d => d.data());
  expect(audits.find(a => a.operation === 'marketplace.mcp.listing.create')).toMatchObject({ itemId: 'MLB55', ok: true, actor: 'mcp:aaaaaaaaaaaa' });
});

it('devolve os erros do Mercado Livre sem publicar e marca resposta ambígua para conferência', async () => {
  validation = { status: 400, body: { message: 'Validation error', cause: [{ type: 'error', code: 'item.attributes.missing_required', message: 'The attributes [MODEL] are required' }] } };
  const bad = (await call('ml_publicar_anuncio', listing({ fotos: ['https://img.example.com/a.jpg'] }))).json();
  expect(bad.valido).toBe(false); expect(bad.erros[0]).toContain('MODEL');
  expect(posts('/items')).toHaveLength(0);
  validation = { status: 204, body: null }; create = { status: 500, body: {} };
  const unclear = await call('ml_publicar_anuncio', listing({ fotos: ['https://img.example.com/a.jpg'], referencia: 'vaso-1' }));
  expect(unclear.error).toBe(true); expect(unclear.text).toContain('Não foi possível confirmar');
  const retry = await call('ml_publicar_anuncio', listing({ fotos: ['https://img.example.com/a.jpg'], referencia: 'vaso-1' }));
  expect(retry.text).toContain('já foi enviado');
  expect(posts('/items')).toHaveLength(1);
  expect((await call('ml_publicar_anuncio', listing({ fotos: ['f'.repeat(64)] }))).text).toContain('não encontrada');
});
