import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AssetStore } from './assets';

// Kept outside the web root and application deployments; served only after tenant authorization.
export function createLocalAssetStore(root: string): AssetStore {
  if (!path.isAbsolute(root)) throw new Error('Diretório privado deve ser absoluto.');
  const resolve = (key: string) => {
    if (!/^tenants\/[A-Za-z0-9_-]{1,128}\/managed-assets\/[a-f0-9]{64}$/.test(key)) throw new Error('Caminho de arquivo inválido.');
    return path.join(root, key);
  };
  return {
    async put(key, bytes) {
      const target = resolve(key), temp = `${target}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
      try { await link(temp, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      finally { await unlink(temp); }
      if (!(await readFile(target)).equals(bytes)) throw new Error('Conteúdo existente divergente.');
    },
    async get(key) { return readFile(resolve(key)); },
  };
}
