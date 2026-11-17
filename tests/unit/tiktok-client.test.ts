import { expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signTikTok, sealTikTok, openTikTok, TikTokClient } from '../../server/tiktok-client';
import { normalizeTikTokListing } from '../../shared/marketplaces/tiktok';
it('matches official TikTok signing vector, ignores tokens and includes exact JSON bytes', () => {
  const q = { timestamp: '1623812664', app_key: '29a39d', sign: 'ignored', access_token: 'ignored' };
  expect(signTikTok('e59af819cc', '/authorization/202309/shops', q)).toBe('b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8');
  expect(signTikTok('e59af819cc', '/authorization/202309/shops', q, '{}')).not.toBe(signTikTok('e59af819cc', '/authorization/202309/shops', q, '{ }'));
});
it('encrypts by tenant and purpose and rejects tampering', () => {
  const key = randomBytes(32), value = sealTikTok(key, 'a:tokens', { access: 'private-test-token' });
  expect(JSON.stringify(value)).not.toContain('private-test-token'); expect(openTikTok(key, 'a:tokens', value).access).toBe('private-test-token');
  for (const p of ['b:tokens', 'a:credentials']) expect(() => openTikTok(key, p, value)).toThrow();
  expect(() => openTikTok(key, 'a:tokens', { ...value, tag: randomBytes(16).toString('base64') })).toThrow();
});
it('sends signed POST body, token only in header and prevents redirects', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: {} })));
  const api = new TikTokClient('test-key', 'test-secret', fetcher);
  await api.api('/product/202309/products/search', 'private-token', { shop_cipher: 'cipher', page_size: '100' }, {});
  const [raw, init] = fetcher.mock.calls[0], url = new URL(raw);
  expect(url.origin).toBe('https://open-api.tiktokglobalshop.com'); expect(raw).not.toContain('private-token');
  expect(init.headers['x-tts-access-token']).toBe('private-token'); expect(init.body).toBe('{}'); expect(init.redirect).toBe('error');
  expect(url.searchParams.get('sign')).toBe(signTikTok('test-secret', url.pathname, Object.fromEntries(url.searchParams), init.body));
});
it('does not leak provider payload, URL or secret on API/network errors', async () => {
  for (const fetcher of [vi.fn().mockRejectedValue(Error('secret-url')), vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 1, message: 'secret-url' })))]) {
    await expect(new TikTokClient('key', 'secret-url', fetcher).shops('token')).rejects.toThrow('TikTok Shop não confirmou');
  }
});
it('preserves IDs, sums independent warehouses, distinguishes absent data and variant prices', () => {
  const sku = { id: '9', price: { currency: 'BRL', sale_price: '19.90' }, inventory: [{ warehouse_id: '1', quantity: 3 }, { warehouse_id: '2', quantity: 5 }] };
  const product = { id: '1729592969712207008', title: 'Chaveiro', status: 'ACTIVATE', skus: [sku] };
  expect(normalizeTikTokListing(product)).toMatchObject({ id: product.id, price: 19.9, quantity: 8, status: 'active', url: null, thumbnail: null });
  expect(normalizeTikTokListing({ ...product, skus: [] })).toMatchObject({ price: null, quantity: null });
  expect(normalizeTikTokListing({ ...product, skus: [sku, { ...sku, id: '10', price: { currency: 'BRL', sale_price: '25.00' } }] }).price).toBeNull();
  expect(normalizeTikTokListing({ ...product, skus: [sku, sku] }).quantity).toBeNull();
  expect(() => normalizeTikTokListing({ ...product, id: 1729592969712207008 })).toThrow();
});
it('token endpoint uses absolute expiration and requires seller identity', async () => {
  const now = Math.floor(Date.now() / 1000), data = { access_token: 'a', refresh_token: 'r', user_type: 0, open_id: 'seller', access_token_expire_in: now + 1000, refresh_token_expire_in: now + 10000 };
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ code: 0, data })));
  const api = new TikTokClient('key', 'test-secret', fetcher);
  const result = await api.token('test-auth-code'); expect(result.expiresAt).toBe(data.access_token_expire_in * 1000);
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('grant_type')).toBe('authorized_code');
  data.user_type = 1; await expect(api.token('code')).rejects.toThrow();
  data.user_type = 0; data.access_token_expire_in = 604800; await expect(api.token('code')).rejects.toThrow();
});
