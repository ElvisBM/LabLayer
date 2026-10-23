import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BusinessError } from './session';

export const TIKTOK_REDIRECT = 'https://app.lablayer.com.br/api/integrations/tiktokshop/callback';
export const textValue = (v: unknown, max = 8192): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
export function sealTikTok(key: Buffer, purpose: string, value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`tiktokshop:${purpose}:v1`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function openTikTok(key: Buffer, purpose: string, envelope: ReturnType<typeof sealTikTok>) {
  if (envelope.version !== 1) throw Error('Invalid envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`tiktokshop:${purpose}:v1`));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
}
// Sign the exact serialized bytes sent. Token is carried only in the header.
export function signTikTok(secret: string, path: string, query: Record<string, string>, body = '') {
  const params = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort().map(k => k + query[k]).join('');
  return createHmac('sha256', secret).update(secret + path + params + body + secret).digest('hex');
}
export class TikTokError extends BusinessError {
  constructor() { super(502, 'TikTok Shop não confirmou o acesso. Confira as permissões do aplicativo ou reconecte a loja.'); }
}
export class TikTokClient {
  constructor(private appKey: string, private secret: string, private fetcher: typeof fetch = fetch) {}
  private async request(url: URL, init: RequestInit) {
    try {
      const response = await this.fetcher(url.toString(), { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok || body?.code !== 0 || !body.data || typeof body.data !== 'object') throw Error();
      return body.data;
    } catch { throw new TikTokError(); } // Never include provider errors, URLs or tokens in logs/responses.
  }
  async token(value: string, refresh = false) {
    const url = new URL(`https://auth.tiktok-shops.com/api/v2/token/${refresh ? 'refresh' : 'get'}`);
    url.search = new URLSearchParams({ app_key: this.appKey, app_secret: this.secret,
      grant_type: refresh ? 'refresh_token' : 'authorized_code', [refresh ? 'refresh_token' : 'auth_code']: value }).toString();
    const t = await this.request(url, { method: 'GET' });
    // TikTok returns absolute Unix seconds, not durations.
    if (!textValue(t.access_token) || !textValue(t.refresh_token) || !textValue(t.open_id, 256) ||
      t.user_type !== 0 || !Number.isSafeInteger(t.access_token_expire_in) || !Number.isSafeInteger(t.refresh_token_expire_in) ||
      t.access_token_expire_in <= Date.now() / 1000 || t.refresh_token_expire_in <= Date.now() / 1000 ||
      t.access_token_expire_in > 253402300799 || t.refresh_token_expire_in > 253402300799) throw new TikTokError();
    return { accessToken: t.access_token as string, refreshToken: t.refresh_token as string, openId: t.open_id as string,
      expiresAt: t.access_token_expire_in * 1000, refreshExpiresAt: t.refresh_token_expire_in * 1000,
      scopes: Array.isArray(t.granted_scopes) ? t.granted_scopes.filter((s: unknown) => textValue(s, 160)).slice(0, 200) : [] };
  }
  api(path: '/authorization/202309/shops' | '/product/202309/products/search', token: string, query: Record<string, string> = {}, body?: Record<string, unknown>) {
    const serialized = body === undefined ? '' : JSON.stringify(body);
    const params = { ...query, app_key: this.appKey, timestamp: String(Math.floor(Date.now() / 1000)) };
    const url = new URL(path, 'https://open-api.tiktokglobalshop.com');
    url.search = new URLSearchParams({ ...params, sign: signTikTok(this.secret, path, params, serialized) }).toString();
    return this.request(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-tts-access-token': token }, ...(body === undefined ? {} : { body: serialized }) });
  }
  async shops(token: string) {
    const data = await this.api('/authorization/202309/shops', token);
    if (!Array.isArray(data.shops) || data.shops.length > 1000) throw new TikTokError();
    const seen = new Set<string>();
    return data.shops.map((s: any) => {
      // IDs can exceed Number.MAX_SAFE_INTEGER. Never coerce a numeric ID.
      if (!textValue(s.id, 40) || !/^\d+$/.test(s.id) || !textValue(s.cipher, 2048) || !textValue(s.name, 300) ||
        !/^[A-Z]{2}$/.test(s.region) || seen.has(s.id)) throw new TikTokError();
      seen.add(s.id);
      return { id: s.id as string, cipher: s.cipher as string, name: s.name as string, region: s.region as string };
    });
  }
}
