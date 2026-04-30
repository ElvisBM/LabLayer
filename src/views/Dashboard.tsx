import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, AlertTriangle, Activity, Store, ArrowUpRight, ArrowDownRight, Target, Package, Cable, Printer, Box } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface DashboardVariationMaterial {
  filamentId?: string;
  weightGrams?: number;
  purgeGrams?: number;
  pieces?: number;
}

interface DashboardVariation {
  filamentId?: string;
  weightGrams?: number;
  quantityPerPrint?: number;
  materials?: DashboardVariationMaterial[];
}

interface DashboardWaste {
  filamentId?: string;
  weightGrams?: number;
}

interface DashboardProduct {
  status?: string;
  stock?: number;
  variations?: DashboardVariation[];
  wastes?: DashboardWaste[];
}

interface DashboardFilamentPurchase {
  quantityKg?: number;
}

interface DashboardFilament {
  id: string;
  stockKg?: number;
  initialStockKg?: number;
  purchaseHistory?: DashboardFilamentPurchase[];
}

interface DashboardOrder {
  productName?: string;
  channelName?: string;
  quantity?: number;
  soldPrice?: number;
  fees?: number;
  realProfit?: number;
}

export function Dashboard() {
  const { tenantId } = useAuth();
  const [products, setProducts] = useState<DashboardProduct[]>([]);
  const [filaments, setFilaments] = useState<DashboardFilament[]>([]);
  const [metrics, setMetrics] = useState({
    revenue: 0,
    profit: 0,
    totalProducts: 0,
    totalFilamentKg: 0,
    totalSupplies: 0,
    activePrinters: 0,
    totalPrinters: 0,
    topProducts: [] as any[],
    topChannels: [] as any[],
  });

  const getPurchasedKg = (filament: DashboardFilament) => {
    const purchaseHistory = (filament.purchaseHistory || []).filter(purchase => (Number(purchase.quantityKg) || 0) > 0);
    if (purchaseHistory.length > 0) {
      return purchaseHistory.reduce((sum, purchase) => sum + (Number(purchase.quantityKg) || 0), 0);
    }
    return Number(filament.initialStockKg ?? filament.stockKg) || 0;
  };

  const calculateFilamentUsageMap = (items: DashboardProduct[]) => {
    const usage: Record<string, number> = {};

    items.forEach(product => {
      (product.variations || []).forEach(variation => {
        const yieldPerBatch = Math.max(1, Number(variation.quantityPerPrint) || 1);

        if ((variation.materials || []).length > 0) {
          (variation.materials || []).forEach(material => {
            if (!material.filamentId) return;

            const stockPieces = Number(material.pieces) || 0;
            const batches = stockPieces > 0 ? Math.ceil(stockPieces / yieldPerBatch) : 1;
            const weightKg = (((Number(material.weightGrams) || 0) + (Number(material.purgeGrams) || 0)) * batches) / 1000;
            usage[material.filamentId] = (usage[material.filamentId] || 0) + weightKg;
          });
          return;
        }

        if (variation.filamentId) {
          const weightKg = (Number(variation.weightGrams) || 0) / 1000;
          usage[variation.filamentId] = (usage[variation.filamentId] || 0) + weightKg;
        }
      });

      (product.wastes || []).forEach(waste => {
        if (!waste.filamentId) return;
        usage[waste.filamentId] = (usage[waste.filamentId] || 0) + ((Number(waste.weightGrams) || 0) / 1000);
      });
    });

    return usage;
  };

  useEffect(() => {
    if (!tenantId) return;

    // Fetch Products
    const unsubProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as DashboardProduct);
      setProducts(data);
      let totalStock = 0;
      data.forEach(data => {
        if (data.status === 'ativo') {
          totalStock += Number(data.stock) || 0;
        }
      });
      setMetrics(prev => ({ ...prev, totalProducts: totalStock }));
    });

    // Fetch Filaments
    const unsubFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DashboardFilament));
      setFilaments(data);
    });

    // Fetch Supplies
    const unsubSupplies = onSnapshot(collection(db, `tenants/${tenantId}/supplies`), (snapshot) => {
      setMetrics(prev => ({ ...prev, totalSupplies: snapshot.size }));
    });

    // Fetch Printers
    const unsubPrinters = onSnapshot(collection(db, `tenants/${tenantId}/printers`), (snapshot) => {
      let active = 0;
      snapshot.forEach(doc => {
        if (doc.data().status === 'online' || doc.data().status === 'imprimindo') active++;
      });
      setMetrics(prev => ({ 
        ...prev, 
        totalPrinters: snapshot.size,
        activePrinters: active 
      }));
    });

    // Fetch Orders for Revenue, Profit, Top Products and Channels
    const unsubOrders = onSnapshot(collection(db, `tenants/${tenantId}/orders`), (snapshot) => {
      const productStats: Record<string, { name: string; sales: number; totalProfit: number }> = {};
      const channelStats: Record<string, { name: string; orders: number; netRevenue: number; totalRevenue: number; totalProfit: number }> = {};
      let revenue = 0;
      let profit = 0;

      snapshot.forEach(doc => {
        const data = doc.data() as DashboardOrder;
        const productName = data.productName || 'Desconhecido';
        const channelName = data.channelName || 'Desconhecido';
        const quantity = Number(data.quantity) || 0;
        const realProfit = Number(data.realProfit) || 0;
        const soldPrice = Number(data.soldPrice) || 0;
        const fees = Number(data.fees) || 0;
        const netRevenue = soldPrice - fees;
        revenue += soldPrice;
        profit += realProfit;

        // Product Stats
        if (!productStats[productName]) {
          productStats[productName] = { name: productName, sales: 0, totalProfit: 0 };
        }
        productStats[productName].sales += quantity;
        productStats[productName].totalProfit += realProfit;

        // Channel Stats
        if (!channelStats[channelName]) {
          channelStats[channelName] = { name: channelName, orders: 0, netRevenue: 0, totalRevenue: 0, totalProfit: 0 };
        }
        channelStats[channelName].orders += 1;
        channelStats[channelName].netRevenue += netRevenue;
        channelStats[channelName].totalRevenue += soldPrice;
        channelStats[channelName].totalProfit += realProfit;
      });

      const topProducts = Object.values(productStats)
        .sort((a, b) => b.totalProfit - a.totalProfit)
        .slice(0, 5);

      const topChannels = Object.values(channelStats)
        .sort((a, b) => b.netRevenue - a.netRevenue)
        .slice(0, 5);

      setMetrics(prev => ({
        ...prev,
        revenue,
        profit,
        topProducts,
        topChannels
      }));
    });

    return () => {
      unsubProducts();
      unsubFilaments();
      unsubSupplies();
      unsubPrinters();
      unsubOrders();
    };
  }, [tenantId]);

  useEffect(() => {
    const usageByFilament = calculateFilamentUsageMap(products);
    const totalFilamentKg = filaments.reduce((sum, filament) => {
      const purchasedKg = getPurchasedKg(filament);
      const consumedKg = usageByFilament[filament.id] || 0;
      return sum + Math.max(0, purchasedKg - consumedKg);
    }, 0);

    setMetrics(prev => ({ ...prev, totalFilamentKg }));
  }, [filaments, products]);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Painel Geral</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Visão geral de estoque, produção e financeiro.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <select className="bg-surface-container border-none rounded-md px-4 py-2 text-sm font-bold text-on-surface focus:ring-2 focus:ring-primary outline-none w-full sm:w-auto">
            <option>Visão Geral</option>
          </select>
        </div>
      </div>

      {/* KPIs Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-primary-container rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-on-primary-container" />
            </div>
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Receita Total</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">
            R$ {metrics.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-tertiary-container text-on-tertiary-container p-6 rounded-xl shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-on-tertiary-container/10 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-on-tertiary-container" />
            </div>
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Lucro Líquido</h3>
          <p className="text-3xl font-headline font-bold tabular-nums">
            R$ {metrics.profit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-secondary-container rounded-lg flex items-center justify-center">
              <Cable className="w-5 h-5 text-on-secondary-container" />
            </div>
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Estoque de Filamentos</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{metrics.totalFilamentKg.toFixed(2)} Kg</p>
        </div>

        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-surface-container-high rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-on-surface" />
            </div>
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Estoque de Produtos</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{metrics.totalProducts} un</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-surface-container-high rounded-lg flex items-center justify-center">
              <Box className="w-5 h-5 text-on-surface" />
            </div>
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Insumos Cadastrados</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{metrics.totalSupplies} itens</p>
        </div>

        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-surface-container-high rounded-lg flex items-center justify-center">
              <Printer className="w-5 h-5 text-on-surface" />
            </div>
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Uso das Impressoras</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{metrics.activePrinters} / {metrics.totalPrinters}</p>
          <p className="text-xs text-on-surface-variant mt-2">Impressoras ativas</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Produtos Lucrativos */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
          <div className="p-5 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low/30">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Top Produtos Lucrativos
            </h3>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                <th className="px-5 py-3">Produto</th>
                <th className="px-5 py-3 text-right">Vendas</th>
                <th className="px-5 py-3 text-right">Lucro/Unid.</th>
                <th className="px-5 py-3 text-right">Lucro Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {metrics.topProducts.length > 0 ? metrics.topProducts.map((prod, idx) => (
                <tr key={idx} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-5 py-3 text-sm font-bold">{prod.name}</td>
                  <td className="px-5 py-3 text-sm text-right tabular-nums">{prod.sales}</td>
                  <td className="px-5 py-3 text-sm text-right tabular-nums text-on-surface-variant">
                    R$ {(prod.sales > 0 ? prod.totalProfit / prod.sales : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3 text-sm text-right font-bold text-tertiary tabular-nums">
                    R$ {prod.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-sm text-on-surface-variant">
                    Nenhum pedido registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Top Canais */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
          <div className="p-5 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low/30">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" />
              Performance por Canal
            </h3>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                <th className="px-5 py-3">Canal</th>
                <th className="px-5 py-3 text-right">Pedidos</th>
                <th className="px-5 py-3 text-right">Receita Líq.</th>
                <th className="px-5 py-3 text-right">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {metrics.topChannels.length > 0 ? metrics.topChannels.map((channel, idx) => (
                <tr key={idx} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-5 py-3 text-sm font-bold">{channel.name}</td>
                  <td className="px-5 py-3 text-sm text-right tabular-nums">{channel.orders}</td>
                  <td className="px-5 py-3 text-sm text-right tabular-nums font-bold">
                    R$ {channel.netRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3 text-sm text-right tabular-nums text-primary font-bold">
                    {(channel.totalRevenue > 0 ? (channel.totalProfit / channel.totalRevenue) * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-sm text-on-surface-variant">
                    Nenhum pedido registrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
