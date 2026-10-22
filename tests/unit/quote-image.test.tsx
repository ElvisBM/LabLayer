// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
vi.mock('../../src/contexts/AuthContext',()=>({useAuth:()=>({})}));
import {QuoteImage,AssistantQuoteImage} from '../../src/features/requests/QuoteImage';
const png=()=>new Blob(['png'],{type:'image/png'});
beforeEach(()=>{vi.stubGlobal('ClipboardItem',class{constructor(public data:any){}});URL.createObjectURL=vi.fn(()=> 'blob:quote');URL.revokeObjectURL=vi.fn();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:vi.fn().mockResolvedValue(undefined)}});Object.defineProperty(navigator,'share',{configurable:true,value:undefined});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('mostra imagem, oferece download e copia conteúdo binário junto com texto comercial',async()=>{
 render(<QuoteImage imageKey="one" load={async()=>png()} text="Orçamento — R$ 19,00"/>);
 expect(await screen.findByRole('img',{name:'Imagem do orçamento'})).toBeTruthy();
 expect(screen.getByRole('link',{name:'Baixar imagem'}).getAttribute('download')).toBe('orcamento.png');
 fireEvent.click(screen.getByRole('button',{name:'Copiar imagem e texto'}));await screen.findByText(/Imagem e texto copiados/);
 const item=vi.mocked(navigator.clipboard.write).mock.calls[0][0][0] as any;
 expect(item.data['image/png'].type).toBe('image/png');expect(item.data['text/plain'].type).toBe('text/plain');
});
it('sem clipboard mantém imagem ampliável e download; falha não anuncia sucesso',async()=>{
 vi.stubGlobal('ClipboardItem',undefined);
 render(<QuoteImage imageKey="one" load={async()=>png()} text="Texto"/>);
 await screen.findByRole('img');expect(screen.queryByRole('button',{name:'Copiar imagem e texto'})).toBeNull();expect(screen.getByRole('link',{name:'Ampliar imagem do orçamento'})).toBeTruthy();
});
it('erro de permissão na cópia orienta baixar e copiar texto separadamente',async()=>{
 vi.mocked(navigator.clipboard.write).mockRejectedValue(new Error('denied'));
 render(<QuoteImage imageKey="one" load={async()=>png()} text="Texto"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Copiar imagem e texto'}));await screen.findByText(/não conseguiu copiar/);expect(screen.queryByText(/Imagem e texto copiados/)).toBeNull();
});
it('compartilha arquivo e texto; cancelamento não anuncia envio nem dispara outro canal',async()=>{
 const share=vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'),{name:'AbortError'}));Object.defineProperty(navigator,'share',{configurable:true,value:share});Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
 render(<QuoteImage imageKey="one" load={async()=>png()} text="Texto comercial"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Compartilhar imagem e texto'}));
 await waitFor(()=>expect(share).toHaveBeenCalledWith({files:[expect.any(File)],text:'Texto comercial'}));expect(screen.queryByText('Compartilhamento concluído.')).toBeNull();expect(navigator.clipboard.write).not.toHaveBeenCalled();
});
it('requisição autenticada vincula imagem ao pedido; acesso negado não expõe imagem',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:false});vi.stubGlobal('fetch',fetcher);
 render(<AssistantQuoteImage id="image-a" requestId="request-a" token="secret" text="Texto"/>);
 await screen.findByRole('alert');expect(fetcher).toHaveBeenCalledWith('/api/assistant/assets/image-a?requestId=request-a',{headers:{Authorization:'Bearer secret'}});expect(screen.queryByRole('img')).toBeNull();
});
it('trocar pedido revoga URL antiga e não mantém imagem anterior enquanto carrega',async()=>{
 const {rerender,unmount}=render(<QuoteImage imageKey="one" load={async()=>png()} text="Um"/>);await screen.findByRole('img');
 rerender(<QuoteImage imageKey="two" load={()=>new Promise(()=>{})} text="Dois"/>);
 expect(screen.queryByRole('img')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:quote');unmount();
});
