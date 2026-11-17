import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadMarketplaceKey, sealMarketplaceSecret, openMarketplaceSecret } from '../../server/marketplace-credentials';

it('exige chave de 32 bytes e arquivo sem permissão para grupo/outros', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marketplace-key-')), file = join(dir, 'key');
  try {
    expect(loadMarketplaceKey(file)).toBeNull();
    writeFileSync(file, randomBytes(32), { mode: 0o600 });
    expect(loadMarketplaceKey(file)?.length).toBe(32);
    chmodSync(file, 0o644); expect(loadMarketplaceKey(file)).toBeNull();
    chmodSync(file, 0o600); writeFileSync(file, 'short'); expect(loadMarketplaceKey(file)).toBeNull();
  } finally { rmSync(dir, { recursive: true }); }
});
it('usa nonce novo por gravação e rejeita ciphertext adulterado', () => {
  const key = randomBytes(32), a = sealMarketplaceSecret(key, 'a', 'fake-test-secret'), b = sealMarketplaceSecret(key, 'a', 'fake-test-secret');
  expect(a.iv).not.toBe(b.iv); expect(a.data).not.toBe(b.data);
  const bytes = Buffer.from(a.data, 'base64'); bytes[0] ^= 1;
  expect(() => openMarketplaceSecret(key, 'a', { ...a, data: bytes.toString('base64') })).toThrow();
});
