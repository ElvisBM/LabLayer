// Short-lived, bounded memory cache. Never writes private media or tokens to disk.
const media = new Map<string, { blob: Blob; expires: number }>();
const pending = new Map<string, Promise<Blob>>();
let bytes = 0;
export function clearAssistantMedia() { media.clear(); pending.clear(); bytes = 0; }
export async function loadAssistantAsset(token: string, id: string, requestId?: string, preview = false): Promise<Blob> {
  const query = new URLSearchParams();
  if (requestId) query.set('requestId', requestId);
  if (preview) query.set('preview', 'true');
  const path = `/api/assistant/assets/${encodeURIComponent(id)}${query.size ? `?${query}` : ''}`;
  const key = `${token}:${path}`;
  for (const [k, entry] of media) if (entry.expires <= Date.now()) { bytes -= entry.blob.size; media.delete(k); }
  const cached = media.get(key);
  if (cached) { media.delete(key); media.set(key, cached); return cached.blob; }
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const request = (async () => {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw Error('Não foi possível carregar o arquivo.');
    const blob = await response.blob();
    if (!blob.size || blob.size > 10 * 1024 * 1024) throw Error('Arquivo inválido.');
    // A cleared session cannot be repopulated by its outstanding requests.
    if (pending.get(key) === request) {
      while (media.size && (media.size >= 32 || bytes + blob.size > 24 * 1024 * 1024)) {
        const oldest = media.keys().next().value!; bytes -= media.get(oldest)!.blob.size; media.delete(oldest);
      }
      media.set(key, { blob, expires: Date.now() + 60_000 }); bytes += blob.size;
    }
    return blob;
  })();
  if (pending.size < 64) pending.set(key, request);
  try { return await request; } finally { if (pending.get(key) === request) pending.delete(key); }
}
