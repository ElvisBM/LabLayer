import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { assetId, MAX_ASSET_BYTES } from '../../../shared/assets/model';

export function QuoteImage({ imageKey, load, text }: { imageKey: string; load: () => Promise<Blob>; text: string }) {
  const loader = useRef(load); loader.current = load;
  const [image, setImage] = useState<{ key: string; blob: Blob; url: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true, url = '';
    setNotice(''); setFailed(false);
    loader.current().then(blob => {
      if (!['image/png','image/jpeg','image/webp'].includes(blob.type) || !blob.size || blob.size > MAX_ASSET_BYTES) throw Error();
      if (!active) return;
      url = URL.createObjectURL(blob); setImage({key:imageKey,blob,url});
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [imageKey]);
  const current = image?.key === imageKey ? image : null;
  if (failed) return <p role="alert">Imagem indisponível. Reabra o orçamento para tentar novamente. O texto continua disponível para copiar.</p>;
  if (!current) return <p role="status">Carregando imagem do orçamento...</p>;
  const extension = current.blob.type === 'image/jpeg' ? 'jpg' : current.blob.type.split('/')[1];
  const file = new File([current.blob], `orcamento.${extension}`, {type:current.blob.type});
  const canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({files:[file]});
  const canCopy = current.blob.type === 'image/png' && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
  const action = 'inline-flex min-h-11 items-center rounded-lg border border-indigo-300 bg-white px-3 text-indigo-700 font-semibold';
  return <div className="space-y-2" aria-label="Imagem do orçamento">
    <a href={current.url} target="_blank" rel="noreferrer" aria-label="Ampliar imagem do orçamento"><img src={current.url} alt="Imagem do orçamento" loading="lazy" className="max-h-64 w-full rounded-lg object-contain bg-white" /></a>
    <div className="flex flex-wrap gap-2">
      {canShare && <button type="button" className={action} onClick={async()=>{
        try { await navigator.share({files:[file],text}); setNotice('Compartilhamento concluído.'); }
        catch(e) { if ((e as Error).name !== 'AbortError') setNotice('Não foi possível compartilhar. Baixe a imagem e copie o texto separadamente.'); }
      }}>Compartilhar imagem e texto</button>}
      {canCopy && <button type="button" className={action} onClick={async()=>{
        try { await navigator.clipboard.write([new ClipboardItem({'image/png':current.blob,'text/plain':new Blob([text],{type:'text/plain'})})]); setNotice('Imagem e texto copiados. O aplicativo de destino pode colar apenas a imagem; nesse caso, use Copiar orçamento para enviar o texto depois.'); }
        catch { setNotice('Este navegador não conseguiu copiar a imagem. Use Baixar imagem e Copiar orçamento.'); }
      }}>Copiar imagem e texto</button>}
      <a className={action} href={current.url} download={`orcamento.${extension}`}>Baixar imagem</a>
    </div>
    <p className="text-xs">Toque na imagem para ampliar. No celular, mantenha pressionada para ver as opções disponíveis. O aplicativo de destino pode separar imagem e texto.</p>
    {notice && <p role="status" className="text-xs">{notice}</p>}
  </div>;
}

export function TenantQuoteImage({reference,text}:{reference?:string;text:string}) {
  const {user,tenantId}=useAuth(); const id=assetId(reference || '');
  if (!id || !user || !tenantId) return null;
  return <QuoteImage imageKey={`${tenantId}:${user.uid}:${id}`} text={text} load={async()=>{
    const response=await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/assets/${id}/download`,{headers:{Authorization:`Bearer ${await user.getIdToken()}`}});
    if(!response.ok)throw Error();return response.blob();
  }}/>;
}
export function AssistantQuoteImage({id,requestId,token,text}:{id?:string|null;requestId:string;token:string;text:string}) {
  if(!id)return null;
  return <QuoteImage imageKey={`${token}:${requestId}:${id}`} text={text} load={async()=>{
    const response=await fetch(`/api/assistant/assets/${encodeURIComponent(id)}?requestId=${encodeURIComponent(requestId)}`,{headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok)throw Error();return response.blob();
  }}/>;
}
