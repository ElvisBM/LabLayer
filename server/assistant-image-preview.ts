import sharp from 'sharp';

// Originals remain immutable. Only derived previews are cached, after authorization.
export function createAssistantImagePreviewer() {
  const cache = new Map<string, { bytes: Buffer; mime: string }>();
  const pending = new Map<string, Promise<{ bytes: Buffer; mime: string }>>();
  let size = 0;
  return async (key: string, mime: string, load: () => Promise<Buffer>) => {
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
    const existing = pending.get(key);
    if (existing) return existing;
    const work = (async () => {
      const original = await load();
      let result = { bytes: original, mime };
      try {
        const bytes = await sharp(original, { limitInputPixels: 40_000_000, animated: false })
          .rotate().resize(960, 960, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
        if (bytes.length < original.length) result = { bytes, mime: 'image/webp' };
      } catch { /* Unsupported images still have their original download. */ }
      if (result.bytes.length <= 2 * 1024 * 1024) {
        while (cache.size && (cache.size >= 64 || size + result.bytes.length > 24 * 1024 * 1024)) {
          const oldest = cache.keys().next().value!; size -= cache.get(oldest)!.bytes.length; cache.delete(oldest);
        }
        cache.set(key, result); size += result.bytes.length;
      }
      return result;
    })();
    // Bound retained in-flight keys as well as completed buffers.
    if (pending.size < 64) pending.set(key, work);
    try { return await work; } finally { if (pending.get(key) === work) pending.delete(key); }
  };
}
