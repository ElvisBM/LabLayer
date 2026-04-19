import { useState } from 'react';
import { Settings, Link as LinkIcon, ShoppingBag, Store, Globe, AlertCircle } from 'lucide-react';

export function Configuracoes() {
  const [activeTab, setActiveTab] = useState('integracoes');

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Configurações</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Gerencie integrações, chaves de API e preferências do sistema.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-outline-variant/20">
        <button
          onClick={() => setActiveTab('integracoes')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'integracoes' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
        >
          <LinkIcon className="w-4 h-4" />
          Integrações (APIs)
        </button>
        <button
          onClick={() => setActiveTab('geral')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'geral' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
        >
          <Settings className="w-4 h-4" />
          Geral
        </button>
      </div>

      {activeTab === 'integracoes' && (
        <div className="space-y-6">
          <div className="bg-primary-container/30 border border-primary/20 p-4 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm text-on-surface">Como funcionam as integrações reais?</h4>
              <p className="text-xs text-on-surface-variant mt-1">
                Para conectar sua conta real, você precisa configurar as credenciais de desenvolvedor de cada plataforma no arquivo <code>.env</code> do servidor. O sistema utiliza um backend Node.js (Express) para gerenciar a autenticação OAuth e webhooks com segurança, sem expor suas chaves no navegador.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Mercado Livre */}
            <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#FFF159] rounded-lg flex items-center justify-center">
                    <Store className="w-6 h-6 text-[#2D3277]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Mercado Livre</h3>
                    <p className="text-xs text-on-surface-variant">API Oficial (OAuth 2.0)</p>
                  </div>
                </div>
                <span className="bg-surface-container-highest text-on-surface-variant text-[10px] font-bold uppercase px-2 py-1 rounded flex items-center gap-1">
                  Desconectado
                </span>
              </div>
              <p className="text-sm text-on-surface-variant mb-6">
                Sincronize pedidos, atualize estoque e preços automaticamente. Requer criação de um App no Dev Center do Mercado Livre.
              </p>
              <div className="space-y-3">
                <button 
                  onClick={() => window.location.href = '/api/integrations/mercadolivre/auth'}
                  className="w-full py-2.5 bg-[#2D3277] text-white text-sm font-bold rounded hover:opacity-90 transition-opacity"
                >
                  Conectar Conta (OAuth)
                </button>
                <p className="text-[10px] text-center text-on-surface-variant">Requer ML_CLIENT_ID e ML_CLIENT_SECRET no .env</p>
              </div>
            </div>

            {/* Shopee */}
            <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#EE4D2D] rounded-lg flex items-center justify-center">
                    <ShoppingBag className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Shopee</h3>
                    <p className="text-xs text-on-surface-variant">Open API 2.0</p>
                  </div>
                </div>
                <span className="bg-surface-container-highest text-on-surface-variant text-[10px] font-bold uppercase px-2 py-1 rounded flex items-center gap-1">
                  Desconectado
                </span>
              </div>
              <p className="text-sm text-on-surface-variant mb-6">
                Importação de pedidos e gestão de anúncios. Requer Partner ID e Partner Key do Shopee Open Platform.
              </p>
              <div className="space-y-3">
                <button 
                  onClick={() => window.location.href = '/api/integrations/shopee/auth'}
                  className="w-full py-2.5 bg-[#EE4D2D] text-white text-sm font-bold rounded hover:opacity-90 transition-opacity"
                >
                  Autorizar Loja
                </button>
                <p className="text-[10px] text-center text-on-surface-variant">Requer SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY</p>
              </div>
            </div>

            {/* Shopify */}
            <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#95BF47] rounded-lg flex items-center justify-center">
                    <Globe className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Shopify</h3>
                    <p className="text-xs text-on-surface-variant">Admin API (GraphQL/REST)</p>
                  </div>
                </div>
                <span className="bg-surface-container-highest text-on-surface-variant text-[10px] font-bold uppercase px-2 py-1 rounded flex items-center gap-1">
                  Desconectado
                </span>
              </div>
              <p className="text-sm text-on-surface-variant mb-6">
                Integração direta com sua loja virtual. Utilize um Custom App Token para acesso.
              </p>
              <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Store URL (ex: loja.myshopify.com)</label>
                  <input type="text" className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="sua-loja.myshopify.com" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Admin API Access Token</label>
                  <input type="password" className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="shpat_..." />
                </div>
                <button type="submit" className="w-full py-2.5 bg-[#95BF47] text-white text-sm font-bold rounded hover:opacity-90 transition-opacity mt-2">
                  Salvar Credenciais
                </button>
              </form>
            </div>

            {/* WooCommerce */}
            <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#96588A] rounded-lg flex items-center justify-center">
                    <Store className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">WooCommerce</h3>
                    <p className="text-xs text-on-surface-variant">REST API V3</p>
                  </div>
                </div>
                <span className="bg-surface-container-highest text-on-surface-variant text-[10px] font-bold uppercase px-2 py-1 rounded flex items-center gap-1">
                  Desconectado
                </span>
              </div>
              <p className="text-sm text-on-surface-variant mb-6">
                Conecte seu site WordPress. Gere as chaves em WooCommerce {'>'} Configurações {'>'} Avançado {'>'} REST API.
              </p>
              <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">URL do Site</label>
                  <input type="text" className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="https://seusite.com.br" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Consumer Key</label>
                  <input type="password" className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="ck_..." />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Consumer Secret</label>
                  <input type="password" className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="cs_..." />
                </div>
                <button type="submit" className="w-full py-2.5 bg-[#96588A] text-white text-sm font-bold rounded hover:opacity-90 transition-opacity mt-2">
                  Salvar Credenciais
                </button>
              </form>
            </div>

          </div>
        </div>
      )}

      {activeTab === 'geral' && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <p className="text-on-surface-variant">Configurações gerais do sistema em desenvolvimento.</p>
        </div>
      )}
    </div>
  );
}
