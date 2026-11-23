import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerMarketplaceOAuthRoutes } from '../../server/marketplace-oauth';
import { sealMarketplaceSecret } from '../../server/marketplace-security';
import { registerMercadoLivreMcp, hashMcpKey } from '../../server/mcp-mercadolivre';

const firebase = initializeApp({ projectId: 'demo-lablayer-test' }, 'mcp-tests');
const db = getFirestore(firebase), key = randomBytes(32), remote = vi.fn<typeof fetch>();
const app = express(); app.use(express.json());
const loadToken = registerMarketplaceOAuthRoutes(app, db, async () => { throw Error(); }, key, remote);
registerMercadoLivreMcp(app, db, loadToken, { claims: async () => ({}), fetcher: remote, rateLimitPerMinute: 1000 });
const readKey = 'll_mcp_' + 'r'.repeat(43), writeKey = 'll_mcp_' + 'w'.repeat(43);
const respond = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
let item: any;
const rpc = (method: string, params: any = {}, token = writeKey) => request(app).post('/api/mcp')
  .set('Authorization', `Bearer ${token}`).set('Accept', 'application/json, text/event-stream')
  .send({ jsonrpc: '2.0', id: 1, method, params });
const call = async (name: string, args: any = {}, token = writeKey) => {
  const r = await rpc('tools/call', { name, arguments: args }, token).expect(200);
  const result = r.body.result;
  return { error: !!result.isError, text: result.content[0].text as string, json: () => JSON.parse(result.content[0].text) };
};
const writes = () => remote.mock.calls.filter(([, init]) => init?.method === 'PUT' || init?.method === 'POST');

beforeEach(async () => {
  await fetch('http://127.0.0.1:8088/emulator/v1/projects/demo-lablayer-test/databases/(default)/documents', { method: 'DELETE' });
  await db.doc('tenants/a').set({ ownerUid: 'owner', status: 'active' });
  await db.doc('users/member').set({ tenantId: 'a', tenantRole: 'member' });
  await db.doc('privateMarketplaceCredentials/a').set({ clientId: '1234', revision: 2, secret: sealMarketplaceSecret(key, 'a', 'test-client-secret') });
  await db.doc('privateMarketplaceConnections/a').set({ status: 'connected', userId: '123', nickname: 'LOJA', clientId: '1234', credentialRevision: 2, connectedAt: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), tokens: sealMarketplaceSecret(key, 'a:oauth', JSON.stringify({ accessToken: 'test-access', refreshToken: 'test-refresh' })) });
  await db.doc(`privateMcpKeys/${hashMcpKey(writeKey)}`).set({ id: 'aaaaaaaaaaaa', tenantId: 'a', createdBy: 'owner', scopes: ['mercadolivre:read', 'mercadolivre:write'], active: true });
  await db.doc(`privateMcpKeys/${hashMcpKey(readKey)}`).set({ id: 'bbbbbbbbbbbb', tenantId: 'a', createdBy: 'owner', scopes: ['mercadolivre:read'], active: true });
  item = { id: 'MLB1', seller_id: 123, title: 'Peça original', status: 'active', price: 29.9, currency_id: 'BRL', available_quantity: 7, sold_quantity: 0, permalink: 'https://produto.mercadolivre.com.br/MLB1' };
  remote.mockReset().mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.includes('/users/me')) return respond({ id: 123, nickname: 'LOJA' });
    if (u.includes('/items/search')) return respond({ results: ['MLB1'], paging: { total: 1 } });
    if (u.includes('/items?ids=')) return respond([{ code: 200, body: item }]);
    if (u.includes('/orders/search')) return respond({ results: [{ id: 9, status: 'paid', seller: { id: 123 }, buyer: { id: 5, nickname: 'COMPRADOR' }, order_items: [] }], paging: { total: 1 } });
    if (u.includes('/questions/77')) return respond({ id: 77, seller_id: 123, status: 'UNANSWERED', item_id: 'MLB1' });
    if (u.endsWith('/answers')) return respond({ id: 77, status: 'ANSWERED' });
    if (u.includes('/items/MLB1')) { if (init?.method === 'PUT') Object.assign(item, JSON.parse(init.body as string)); return respond(item); }
    return respond({ message: 'not found' }, 404);
  });
});
afterAll(async () => { await db.terminate(); await deleteApp(firebase); });

it('exige chave MCP ativa da empresa', async () => {
  await request(app).post('/api/mcp').send({}).expect(401);
  await rpc('tools/list', {}, 'll_mcp_' + 'x'.repeat(43)).expect(401);
  await db.doc(`privateMcpKeys/${hashMcpKey(writeKey)}`).update({ active: false });
  await rpc('tools/list').expect(401);
  await db.doc(`privateMcpKeys/${hashMcpKey(readKey)}`).update({ createdBy: 'outsider' });
  await rpc('tools/list', {}, readKey).expect(403);
  await request(app).get('/api/mcp').expect(405);
});

it('lista ferramentas e lê conta, anúncios e vendas sem gravar nada', async () => {
  const list = await rpc('tools/list').expect(200);
  const names = list.body.result.tools.map((t: any) => t.name);
  expect(names).toEqual(expect.arrayContaining(['ml_conta', 'ml_listar_anuncios', 'ml_alterar_preco', 'ml_listar_vendas', 'ml_responder_pergunta']));
  expect(list.body.result.tools.find((t: any) => t.name === 'ml_alterar_preco').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  expect((await call('ml_conta', {}, readKey)).json()).toMatchObject({ apelido: 'LOJA', escopos_da_chave: ['mercadolivre:read'] });
  expect((await call('ml_listar_anuncios', { status: 'active' }, readKey)).json().anuncios[0]).toMatchObject({ id: 'MLB1', preco: 29.9, estoque: 7 });
  expect((await call('ml_listar_vendas', {}, readKey)).json().vendas[0]).toMatchObject({ id: 9, comprador: { apelido: 'COMPRADOR' } });
  expect(writes()).toHaveLength(0);
  expect(remote.mock.calls.every(([, init]) => (init?.headers as any).Authorization === 'Bearer test-access')).toBe(true);
});

it('altera preço e estoque com confirmação e auditoria; chave somente leitura é recusada', async () => {
  const denied = await call('ml_alterar_preco', { item_id: 'MLB1', preco: 35 }, readKey);
  expect(denied).toMatchObject({ error: true }); expect(denied.text).toContain('somente leitura'); expect(writes()).toHaveLength(0);
  expect((await call('ml_alterar_preco', { item_id: 'MLB1', preco: 35.5 })).json()).toMatchObject({ confirmado: true, anuncio: { preco: 35.5 } });
  expect((await call('ml_alterar_estoque', { item_id: 'MLB1', quantidade: 3 })).json()).toMatchObject({ confirmado: true, anuncio: { estoque: 3 } });
  expect(writes().map(([, init]) => JSON.parse(init!.body as string))).toEqual([{ price: 35.5 }, { available_quantity: 3 }]);
  const audits = (await db.collection('tenants/a/auditLogs').get()).docs.map(d => d.data());
  expect(audits.map(a => a.operation)).toEqual(expect.arrayContaining(['marketplace.mcp.listing.price', 'marketplace.mcp.listing.stock']));
  expect(audits.find(a => a.operation === 'marketplace.mcp.listing.price')).toMatchObject({ actor: 'mcp:aaaaaaaaaaaa', onBehalfOf: 'owner', before: { price: 29.9 } });
  expect(JSON.stringify(audits)).not.toContain('test-access');
});

it('bloqueia anúncio de outro vendedor, variação sem id e validações de entrada', async () => {
  item.seller_id = 999;
  expect((await call('ml_alterar_preco', { item_id: 'MLB1', preco: 10 })).text).toContain('não pertence');
  item.seller_id = 123; item.variations = [{ id: 1, available_quantity: 2 }, { id: 2, available_quantity: 4 }];
  expect((await call('ml_alterar_estoque', { item_id: 'MLB1', quantidade: 5 })).text).toContain('variacao_id');
  expect((await call('ml_alterar_preco', { item_id: 'MLB1', preco: 10.123 })).error).toBe(true);
  expect(writes()).toHaveLength(0);
  await call('ml_alterar_estoque', { item_id: 'MLB1', quantidade: 5, variacao_id: '2' });
  expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ variations: [{ id: 1 }, { id: 2, available_quantity: 5 }] });
});

it('responde pergunta pendente da própria conta', async () => {
  expect((await call('ml_responder_pergunta', { question_id: '77', resposta: 'Olá! Temos sim.' })).json()).toMatchObject({ respondida: true });
  expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ question_id: 77, text: 'Olá! Temos sim.' });
});

it('dono que perdeu acesso não opera pela chave', async () => {
  await db.doc('tenants/a').update({ status: 'inactive' });
  await rpc('tools/list').expect(403);
});
