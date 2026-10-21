// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/contexts/AuthContext', () => ({useAuth:()=>({})}));
import { uploadRequestImage } from '../../src/components/RequestImage';
afterEach(() => vi.unstubAllGlobals());
const user = {getIdToken:vi.fn(async ()=>'test-token')};
it('envia os bytes originais fora do documento Firestore e retorna referência privada',async()=>{
 const fetch=vi.fn(async()=>({ok:true,json:async()=>({reference:`asset:${'a'.repeat(64)}`})}));vi.stubGlobal('fetch',fetch);
 const file=new File([new Uint8Array(1100000)],'referência.png',{type:'image/png'});
 expect(await uploadRequestImage(file,'company',user)).toBe(`asset:${'a'.repeat(64)}`);
 expect(fetch).toHaveBeenCalledWith('/api/tenants/company/assets/upload',expect.objectContaining({body:file,headers:expect.objectContaining({Authorization:'Bearer test-token','Content-Type':'application/octet-stream'})}));
});
it('rejeita tamanho/formato inválido e falha de upload sem produzir referência',async()=>{
 const fetch=vi.fn(async()=>({ok:false,json:async()=>({error:'Falha de armazenamento'})}));vi.stubGlobal('fetch',fetch);
 await expect(uploadRequestImage(new File(['x'],'x.svg',{type:'image/svg+xml'}),'a',user)).rejects.toThrow('PNG');
 await expect(uploadRequestImage(new File([new Uint8Array(10*1024*1024+1)],'x.png',{type:'image/png'}),'a',user)).rejects.toThrow('10 MB');
 expect(fetch).not.toHaveBeenCalled();
 await expect(uploadRequestImage(new File(['x'],'x.png',{type:'image/png'}),'a',user)).rejects.toThrow('Falha de armazenamento');
});
