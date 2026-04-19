import React, { useState, useEffect } from 'react';
import { ShoppingCart, Upload, Plus, Search, Eye, FileSpreadsheet, CheckCircle2, Package, Clock, RefreshCw, Settings } from 'lucide-react';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Order {
  id: string;
  orderNumber: string;
  date: string;
  productName: string;
  channelName: string;
  status: 'pago' | 'produzindo' | 'enviado';
  quantity: number;
  soldPrice: number;
  fees: number;
  realCost: number;
  realProfit: number;
}

export function Vendas() {
  const { tenantId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [marketplaces, setMarketplaces] = useState<any[]>([]);
  
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showApiModal, setShowApiModal] = useState(false);
  
  const [apiKeys, setApiKeys] = useState({
    mercadoLivre: '',
    shopee: ''
  });
  const [isSyncing, setIsSyncing] = useState(false);

  const [formData, setFormData] = useState({
    productId: '',
    channelId: '',
    quantity: 1,
    soldPrice: 0,
    fees: 0,
    status: 'pago' as 'pago' | 'produzindo' | 'enviado'
  });

  useEffect(() => {
    if (!tenantId) return;

    const unsubOrders = onSnapshot(collection(db, `tenants/${tenantId}/orders`), (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    });

    const unsubProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProducts(data);
      if (data.length > 0 && !formData.productId) {
        setFormData(prev => ({ ...prev, productId: data[0].id }));
      }
    });

    const unsubMarketplaces = onSnapshot(collection(db, `tenants/${tenantId}/marketplaces`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMarketplaces(data);
      if (data.length > 0 && !formData.channelId) {
        setFormData(prev => ({ ...prev, channelId: data[0].id }));
      }
    });

    return () => {
      unsubOrders();
      unsubProducts();
      unsubMarketplaces();
    };
  }, [tenantId]);

  const handleSaveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    const product = products.find(p => p.id === formData.productId);
    const channel = marketplaces.find(c => c.id === formData.channelId);

    if (!product || !channel) {
      alert('Selecione um produto e um canal válidos.');
      return;
    }

    // Simplified cost calculation for now, just using product base cost or 0
    const realCost = (product.cost || 0) * formData.quantity;
    const realProfit = formData.soldPrice - formData.fees - realCost;

    const newOrder = {
      orderNumber: `MANUAL-${Math.floor(Math.random() * 90000) + 10000}`,
      date: new Date().toISOString(),
      productName: product.name,
      channelName: channel.name,
      status: formData.status,
      quantity: formData.quantity,
      soldPrice: formData.soldPrice,
      fees: formData.fees,
      realCost,
      realProfit,
      createdAt: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, `tenants/${tenantId}/orders`), newOrder);
      setShowManualForm(false);
      setFormData({
        productId: products.length > 0 ? products[0].id : '',
        channelId: marketplaces.length > 0 ? marketplaces[0].id : '',
        quantity: 1,
        soldPrice: 0,
        fees: 0,
        status: 'pago'
      });
    } catch (error) {
      console.error("Error adding order: ", error);
      alert('Erro ao salvar pedido.');
    }
  };

  const handleSync = () => {
    setIsSyncing(true);
    // Simulate API fetch delay
    setTimeout(() => {
      alert('Configure os tokens da API para sincronizar.');
      setIsSyncing(false);
      setShowApiModal(false);
    }, 1500);
  };

  const getStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'pago':
        return <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase bg-surface-container-highest text-on-surface-variant"><Clock className="w-3 h-3" /> Pago</span>;
      case 'produzindo':
        return <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase bg-secondary-container text-on-secondary-container"><Package className="w-3 h-3" /> Produzindo</span>;
      case 'enviado':
        return <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase bg-tertiary-fixed text-on-tertiary-fixed-variant"><CheckCircle2 className="w-3 h-3" /> Enviado</span>;
    }
  };

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((acc, order) => acc + order.soldPrice, 0);
  const totalProfit = orders.reduce((acc, order) => acc + order.realProfit, 0);
  const averageTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Vendas e Pedidos</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Gerencie pedidos, acompanhe o status e analise o lucro real.</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button 
            onClick={() => setShowApiModal(true)}
            className="flex-1 sm:flex-none px-4 py-2 bg-secondary-container text-on-secondary-container text-sm font-bold rounded-md hover:bg-secondary-container/80 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Sincronizar</span>
          </button>
          <button 
            onClick={() => setShowImportModal(true)}
            className="flex-1 sm:flex-none px-4 py-2 bg-surface-container-high text-on-surface text-sm font-bold rounded-md hover:bg-surface-container-highest active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Importar</span>
          </button>
          <button 
            onClick={() => setShowManualForm(!showManualForm)}
            className="flex-1 sm:flex-none px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nova Venda</span>
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Total de Pedidos</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{totalOrders}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Receita Total</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">R$ {totalRevenue.toFixed(2)}</p>
        </div>
        <div className="bg-tertiary-container text-on-tertiary-container p-6 rounded-xl shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Lucro Total Real</h3>
          <p className="text-3xl font-headline font-bold tabular-nums">R$ {totalProfit.toFixed(2)}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Ticket Médio</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">R$ {averageTicket.toFixed(2)}</p>
        </div>
      </div>

      {/* Formulário de Lançamento Manual */}
      {showManualForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-[0_20px_40px_rgba(25,28,30,0.06)]">
          <div className="flex items-center gap-2 mb-6">
            <ShoppingCart className="w-5 h-5 text-primary" />
            <h3 className="font-headline font-bold text-lg">Lançamento Manual de Venda</h3>
          </div>
          
          <form className="grid grid-cols-1 md:grid-cols-4 gap-4" onSubmit={handleSaveOrder}>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Produto</label>
              <select 
                value={formData.productId || ''}
                onChange={(e) => setFormData({...formData, productId: e.target.value})}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                required
              >
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Canal</label>
              <select 
                value={formData.channelId || ''}
                onChange={(e) => setFormData({...formData, channelId: e.target.value})}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                required
              >
                {marketplaces.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Quantidade</label>
              <input 
                type="number" 
                min="1"
                value={formData.quantity || ''}
                onChange={(e) => setFormData({...formData, quantity: Number(e.target.value)})}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" 
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Preço Vendido (Total R$)</label>
              <input 
                type="number" 
                step="0.01" 
                value={formData.soldPrice || ''}
                onChange={(e) => setFormData({...formData, soldPrice: Number(e.target.value)})}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" 
                placeholder="0.00" 
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Taxas do Canal (R$)</label>
              <input 
                type="number" 
                step="0.01" 
                value={formData.fees || ''}
                onChange={(e) => setFormData({...formData, fees: Number(e.target.value)})}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" 
                placeholder="0.00" 
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Status</label>
              <select 
                value={formData.status || 'pago'}
                onChange={(e) => setFormData({...formData, status: e.target.value as any})}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="pago">Pago (Aguardando Produção)</option>
                <option value="produzindo">Produzindo</option>
                <option value="enviado">Enviado / Concluído</option>
              </select>
            </div>
            
            <div className="md:col-span-4 flex justify-end mt-4 gap-3 pt-4 border-t border-outline-variant/20">
              <button 
                type="button" 
                onClick={() => setShowManualForm(false)}
                className="px-6 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors"
              >
                Cancelar
              </button>
              <button 
                type="submit" 
                className="px-8 py-2.5 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all active:scale-95"
              >
                Registrar Venda
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Importação CSV */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary-container rounded-full flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-on-primary-container" />
              </div>
              <div>
                <h3 className="font-headline font-bold text-lg">Importar Vendas</h3>
                <p className="text-xs text-on-surface-variant">Faça upload do relatório da plataforma</p>
              </div>
            </div>
            
            <div className="border-2 border-dashed border-outline-variant/50 rounded-lg p-8 text-center hover:bg-surface-container-low transition-colors cursor-pointer mb-6">
              <Upload className="w-8 h-8 text-on-surface-variant mx-auto mb-3" />
              <p className="text-sm font-bold text-primary mb-1">Clique para selecionar o arquivo</p>
              <p className="text-xs text-on-surface-variant">Suporta CSV da Shopee e Mercado Livre</p>
            </div>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={() => setShowImportModal(false)}
                className="px-6 py-2 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all"
              >
                Processar Arquivo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configuração de API */}
      {showApiModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-secondary-container rounded-full flex items-center justify-center">
                <Settings className="w-5 h-5 text-on-secondary-container" />
              </div>
              <div>
                <h3 className="font-headline font-bold text-lg">Sincronização via API</h3>
                <p className="text-xs text-on-surface-variant">Configure seus tokens para importar automaticamente</p>
              </div>
            </div>
            
            <div className="space-y-4 mb-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Token Mercado Livre (Access Token)</label>
                <input 
                  type="password" 
                  value={apiKeys.mercadoLivre}
                  onChange={(e) => setApiKeys({...apiKeys, mercadoLivre: e.target.value})}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" 
                  placeholder="APP_USR-..." 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Token Shopee (Partner ID / Key)</label>
                <input 
                  type="password" 
                  value={apiKeys.shopee}
                  onChange={(e) => setApiKeys({...apiKeys, shopee: e.target.value})}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" 
                  placeholder="Insira o token da Shopee..." 
                />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowApiModal(false)}
                className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors"
                disabled={isSyncing}
              >
                Cancelar
              </button>
              <button 
                onClick={handleSync}
                disabled={isSyncing || (!apiKeys.mercadoLivre && !apiKeys.shopee)}
                className="px-6 py-2 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  'Sincronizar Pedidos'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Layout Principal: Lista + Detalhes */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Lista de Pedidos */}
        <div className={`${selectedOrder ? 'xl:col-span-2' : 'xl:col-span-3'} bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden transition-all duration-300`}>
          <div className="p-4 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low/50">
            <h3 className="font-bold text-sm">Últimos Pedidos</h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input type="text" placeholder="Buscar pedido..." className="pl-9 pr-4 py-1.5 text-sm bg-surface-container rounded-md border-none focus:ring-2 focus:ring-primary outline-none" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant whitespace-nowrap">
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Canal</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Lucro</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {orders.map((order) => (
                  <tr 
                    key={order.id} 
                    onClick={() => setSelectedOrder(order)}
                    className={`hover:bg-surface-container-low transition-colors cursor-pointer group whitespace-nowrap ${selectedOrder?.id === order.id ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-bold text-primary block">{order.orderNumber}</span>
                      <span className="text-[10px] text-on-surface-variant">{order.date}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium">{order.productName}</span>
                      <span className="text-[10px] text-on-surface-variant block">{order.quantity}x unidades</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium bg-slate-100 px-2 py-1 rounded">{order.channelName}</span>
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(order.status)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-tertiary tabular-nums">R$ {order.realProfit.toFixed(2)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-slate-400 hover:text-primary transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detalhe do Pedido (Aparece ao clicar) */}
        {selectedOrder && (
          <div className="xl:col-span-1 bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-lg overflow-hidden flex flex-col h-fit sticky top-6">
            <div className="bg-primary-container p-6 text-on-primary-container relative">
              <button 
                onClick={() => setSelectedOrder(null)}
                className="absolute top-4 right-4 text-on-primary-container/70 hover:text-on-primary-container"
              >
                ✕
              </button>
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-80 block mb-1">Detalhes do Pedido</span>
              <h3 className="text-2xl font-headline font-bold">{selectedOrder.orderNumber}</h3>
              <div className="mt-3 flex items-center gap-2">
                {getStatusBadge(selectedOrder.status)}
                <span className="text-xs opacity-80">{selectedOrder.date}</span>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">Item Vendido</span>
                <div className="bg-surface-container p-3 rounded-lg flex justify-between items-center">
                  <div>
                    <span className="font-bold text-sm block">{selectedOrder.productName}</span>
                    <span className="text-xs text-on-surface-variant">Canal: {selectedOrder.channelName}</span>
                  </div>
                  <span className="font-bold bg-surface-container-high px-2 py-1 rounded text-sm">{selectedOrder.quantity}x</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-2">Análise Financeira (DRE do Pedido)</span>
                <div className="space-y-2 text-sm font-sans">
                  <div className="flex justify-between items-center p-2 rounded hover:bg-surface-container-low">
                    <span className="text-on-surface-variant font-medium">Preço Vendido (Total)</span>
                    <span className="font-bold tabular-nums">R$ {selectedOrder.soldPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded hover:bg-error/5 text-error">
                    <span className="font-medium">Taxas do Canal</span>
                    <span className="font-bold tabular-nums">- R$ {selectedOrder.fees.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded hover:bg-error/5 text-error">
                    <span className="font-medium">Custo Real (Produção)</span>
                    <span className="font-bold tabular-nums">- R$ {selectedOrder.realCost.toFixed(2)}</span>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-outline-variant/20">
                    <div className="bg-tertiary-container text-on-tertiary-container p-4 rounded-lg flex justify-between items-center">
                      <span className="font-bold uppercase tracking-widest text-xs">Lucro Real</span>
                      <span className="font-headline font-bold text-xl tabular-nums">R$ {selectedOrder.realProfit.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-2">
                <button className="flex-1 py-2 bg-surface-container-high hover:bg-surface-container-highest text-sm font-bold rounded transition-colors">
                  Editar
                </button>
                {selectedOrder.status !== 'enviado' && (
                  <button className="flex-1 py-2 bg-primary text-on-primary text-sm font-bold rounded hover:opacity-90 transition-colors">
                    Avançar Status
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
