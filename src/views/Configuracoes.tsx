import { useState } from 'react';
import { Settings, Link as LinkIcon, ShoppingBag, Store, Globe, AlertCircle } from 'lucide-react';

const plannedIntegrations = [
  { name: 'Mercado Livre', Icon: Store, description: 'Pedidos e anúncios do Mercado Livre.' },
  { name: 'Shopee', Icon: ShoppingBag, description: 'Pedidos e anúncios da Shopee.' },
  { name: 'Shopify', Icon: Globe, description: 'Pedidos da sua loja Shopify.' },
  { name: 'WooCommerce', Icon: Store, description: 'Produtos e pedidos da sua loja WooCommerce.' },
];

export function Configuracoes() {
  const [activeTab, setActiveTab] = useState('integracoes');
  return (
    <div className="space-y-8 pb-12">
      <div>
        <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Configurações</h2>
        <p className="text-on-surface-variant text-sm mt-1">Consulte a disponibilidade das integrações.</p>
      </div>
      <div className="flex border-b border-outline-variant/20">
        {[{ id: 'integracoes', label: 'Integrações', Icon: LinkIcon }, { id: 'geral', label: 'Geral', Icon: Settings }].map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)} className={`px-6 py-3 text-sm font-bold border-b-2 flex items-center gap-2 ${activeTab === id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>
      {activeTab === 'integracoes' ? (
        <div className="space-y-6">
          <div role="note" className="bg-primary-container/30 border border-primary/20 p-4 rounded-lg flex gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">Estas integrações estão em desenvolvimento. A conexão de contas e a sincronização de pedidos ainda não estão disponíveis. Continue cadastrando pedidos manualmente.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {plannedIntegrations.map(({ name, Icon, description }) => (
              <div key={name} className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
                <div className="flex items-center gap-3 mb-3"><Icon className="w-6 h-6" /><h3 className="font-bold text-lg">{name}</h3></div>
                <p className="text-sm text-on-surface-variant mb-3">{description}</p>
                <span className="text-xs font-bold text-on-surface-variant">Em desenvolvimento</span>
              </div>
            ))}
          </div>
        </div>
      ) : <p className="text-on-surface-variant">Configurações gerais em desenvolvimento.</p>}
    </div>
  );
}
