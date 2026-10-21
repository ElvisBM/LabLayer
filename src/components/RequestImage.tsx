import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { assetId, MAX_ASSET_BYTES } from '../../shared/assets/model';

export async function uploadRequestImage(file: File, tenantId: string, user: { getIdToken(): Promise<string> }) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use uma imagem PNG, JPEG ou WebP.');
  if (!file.size || file.size > MAX_ASSET_BYTES) throw new Error('A imagem deve ter até 10 MB.');
  const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/assets/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Type': file.type }, body: file,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Não foi possível enviar a imagem.');
  }
  const result = await response.json();
  if (!assetId(result.reference || '')) throw new Error('Upload não confirmado.');
  return result.reference as string;
}

export function RequestImage({ reference, alt, className }: { reference: string; alt: string; className?: string }) {
  const { user, tenantId } = useAuth();
  const key = assetId(reference);
  const [loaded, setLoaded] = useState<{ reference: string; tenant: string; uid: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!key || !tenantId || !user) return;
    let active = true, objectUrl: string | undefined;
    const abort = new AbortController();
    setFailed(false);
    (async () => {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/assets/${key}/download`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, signal: abort.signal });
      if (!response.ok) throw new Error('Imagem indisponível.');
      const blob = await response.blob();
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setLoaded({ reference, tenant: tenantId, uid: user.uid, url: objectUrl });
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, reference, tenantId, user]);
  const url = key ? loaded?.reference === reference && loaded.tenant === tenantId && loaded.uid === user?.uid ? loaded.url : '' : reference;
  if (!url) return <p className="text-sm text-on-surface-variant" role={failed ? 'alert' : 'status'}>{failed ? 'Não foi possível carregar a imagem. Reabra o orçamento para tentar novamente.' : 'Carregando imagem...'}</p>;
  return <a href={url} target="_blank" rel="noreferrer" aria-label={`Ampliar ${alt.toLowerCase()}`}><img src={url} alt={alt} className={className} /></a>;
}
