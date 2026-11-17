export async function uploadDraftPhoto(user: { getIdToken(): Promise<string> }, base: string, file: File) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use fotos JPEG, PNG ou WebP.');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Cada foto deve ter no máximo 10 MiB.');
  const token = await user.getIdToken();
  const response = await fetch(`${base}/photos`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':file.type }, body:file });
  const result = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível enviar a foto. Tente novamente.');
  if (typeof result.url !== 'string' || !/^https:\/\/app\.lablayer\.com\.br\/api\/listing-photos\/[a-f0-9]{64}\.jpg$/.test(result.url)) throw new Error('O servidor não confirmou o endereço da foto.');
  return result.url as string;
}
