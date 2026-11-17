import {afterEach,expect,it,vi} from 'vitest';
import {uploadDraftPhoto} from '../../src/features/integrations/draft-photo-upload';
afterEach(()=>vi.unstubAllGlobals());
it('envia binário com bearer e tipo correto, sem serializar como JSON',async()=>{
 const url='https://app.lablayer.com.br/api/listing-photos/'+'a'.repeat(64)+'.jpg';
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({url})));vi.stubGlobal('fetch',fetcher);
 const file=new File(['photo'],'foto.jpg',{type:'image/jpeg'});
 expect(await uploadDraftPhoto({getIdToken:async()=>'private'},'/api/tenants/a/listing-drafts',file)).toBe(url);
 expect(fetcher).toHaveBeenCalledWith('/api/tenants/a/listing-drafts/photos',{method:'POST',headers:{Authorization:'Bearer private','Content-Type':'image/jpeg'},body:file});
});
it('recusa tipo e tamanho inválidos e propaga erro de upload',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Imagem inválida'}),{status:422}));vi.stubGlobal('fetch',fetcher);
 const user={getIdToken:async()=>'private'};
 await expect(uploadDraftPhoto(user,'/api',new File(['x'],'x.svg',{type:'image/svg+xml'}))).rejects.toThrow('JPEG');
 await expect(uploadDraftPhoto(user,'/api',new File([new Uint8Array(10*1024*1024+1)],'x.png',{type:'image/png'}))).rejects.toThrow('10 MiB');
 expect(fetcher).not.toHaveBeenCalled();
 await expect(uploadDraftPhoto(user,'/api',new File(['x'],'x.png',{type:'image/png'}))).rejects.toThrow('Imagem inválida');
});
