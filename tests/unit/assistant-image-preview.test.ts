import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createAssistantImagePreviewer } from '../../server/assistant-image-preview';
it('gera prévia menor sem recortar nem ampliar e compartilha trabalho concorrente',async()=>{
 const original=await sharp({create:{width:2400,height:1200,channels:3,background:'#7b45ef'}}).png().toBuffer();
 const load=vi.fn(async()=>original); const preview=createAssistantImagePreviewer();
 const [a,b]=await Promise.all([preview('tenant:photo','image/png',load),preview('tenant:photo','image/png',load)]);
 expect(load).toHaveBeenCalledTimes(1);expect(a).toBe(b);expect(a.bytes.length).toBeLessThan(original.length);expect(a.mime).toBe('image/webp');
 const meta=await sharp(a.bytes).metadata();expect([meta.width,meta.height]).toEqual([960,480]);
 expect(await preview('tenant:photo','image/png',load)).toBe(a);expect(load).toHaveBeenCalledTimes(1);
 await preview('other:photo','image/png',load);expect(load).toHaveBeenCalledTimes(2);
});
it('preserva original quando imagem não pode ser convertida e permite repetir falha de armazenamento',async()=>{
 const preview=createAssistantImagePreviewer();const original=Buffer.from('invalid image');
 expect(await preview('a','image/png',async()=>original)).toEqual({bytes:original,mime:'image/png'});
 await expect(preview('b','image/png',async()=>{throw Error('storage');})).rejects.toThrow('storage');
 expect((await preview('b','image/png',async()=>original)).bytes).toBe(original);
});
