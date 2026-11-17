import { afterEach, expect, it, vi } from 'vitest';
import { clearAssistantMedia, loadAssistantAsset } from '../../src/features/assistant/asset-loader';
afterEach(() => { clearAssistantMedia(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const image = () => new Blob(['image'], {type:'image/webp'});
it('compartilha uma única transferência entre prévia e anexos e reutiliza os bytes em memória', async () => {
  const blob = image(); const fetcher = vi.fn().mockResolvedValue({ok:true,blob:async()=>blob}); vi.stubGlobal('fetch',fetcher);
  const [a,b] = await Promise.all([loadAssistantAsset('a','photo','order',true),loadAssistantAsset('a','photo','order',true)]);
  expect(a).toBe(b); expect(await loadAssistantAsset('a','photo','order',true)).toBe(blob); expect(fetcher).toHaveBeenCalledTimes(1);
  await loadAssistantAsset('b','photo','order',true); await loadAssistantAsset('a','photo','other',true); await loadAssistantAsset('a','photo','order');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('não guarda falhas e expira imagens para revalidar o acesso', async () => {
  vi.useFakeTimers(); const fetcher = vi.fn().mockResolvedValueOnce({ok:false}).mockResolvedValue({ok:true,blob:async()=>image()}); vi.stubGlobal('fetch',fetcher);
  await expect(loadAssistantAsset('a','photo','order',true)).rejects.toThrow();
  await loadAssistantAsset('a','photo','order',true); await loadAssistantAsset('a','photo','order',true); expect(fetcher).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60_001); await loadAssistantAsset('a','photo','order',true); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('limita imagens retidas e não recupera dados de sessão encerrada', async () => {
  const fetcher=vi.fn().mockResolvedValue({ok:true,blob:async()=>image()}); vi.stubGlobal('fetch',fetcher);
  for(let i=0;i<33;i++) await loadAssistantAsset('a',`p${i}`,'order',true);
  await loadAssistantAsset('a','p0','order',true); expect(fetcher).toHaveBeenCalledTimes(34);
  let resolve!: (r:any)=>void; fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const old=loadAssistantAsset('a','late','order',true); clearAssistantMedia(); resolve({ok:true,blob:async()=>image()}); await old;
  await loadAssistantAsset('a','late','order',true); expect(fetcher).toHaveBeenCalledTimes(36);
});
