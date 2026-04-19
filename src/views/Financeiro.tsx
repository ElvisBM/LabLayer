import React, { useState, useEffect } from 'react';
import { Wallet, TrendingUp, TrendingDown, FileText, Plus, Search, DollarSign, ArrowRight, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { collection, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Transaction {
  id: string;
  date: string;
  description: string;
  type: 'entrada' | 'saida';
  category: string;
  amount: number;
  status: 'pago' | 'pendente';
}

interface Order {
  id: string;
  soldPrice: number;
  fees: number;
  realCost: number;
  status: string;
}

interface Supply {
  id: string;
  costPerUnit: number;
  quantity: number;
  purchaseDate?: string;
  createdAt?: string;
}

interface Filament {
  id: string;
  pricePerKg: number;
  stockKg: number;
  initialStockKg?: number;
  purchaseDate?: string;
  createdAt?: string;
  material?: string;
  color?: string;
  purchaseHistory?: Array<{
    id: string;
    quantityKg: number;
    pricePerKg: number;
    purchaseDate: string;
    store: string;
  }>;
}

interface FilamentPurchaseFlow {
  id: string;
  filamentId: string;
  material: string;
  color: string;
  quantityKg: number;
  pricePerKg: number;
  purchaseDate: string;
  store: string;
}

interface Printer {
  id: string;
  acquisitionCost: number;
  purchaseDate?: string;
  createdAt?: string;
}

export function Financeiro() {
  const { tenantId } = useAuth();
  const [activeTab, setActiveTab] = useState<'fluxo' | 'dre'>('fluxo');
  const [showForm, setShowForm] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [filaments, setFilaments] = useState<Filament[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
  
  const [formData, setFormData] = useState({
    description: '',
    type: 'saida' as 'entrada' | 'saida',
    amount: 0,
    category: 'Material',
    date: new Date().toISOString().split('T')[0],
    status: 'pago' as 'pago' | 'pendente'
  });

  useEffect(() => {
    if (!tenantId) return;

    const unsubTransactions = onSnapshot(collection(db, `tenants/${tenantId}/transactions`), (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    });

    const unsubOrders = onSnapshot(collection(db, `tenants/${tenantId}/orders`), (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    });

    const unsubSupplies = onSnapshot(collection(db, `tenants/${tenantId}/supplies`), (snapshot) => {
      setSupplies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supply)));
    });

    const unsubFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      setFilaments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Filament)));
    });

    const unsubPrinters = onSnapshot(collection(db, `tenants/${tenantId}/printers`), (snapshot) => {
      setPrinters(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Printer)));
    });

    return () => {
      unsubTransactions();
      unsubOrders();
      unsubSupplies();
      unsubFilaments();
      unsubPrinters();
    };
  }, [tenantId]);

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      await addDoc(collection(db, `tenants/${tenantId}/transactions`), {
        ...formData,
        createdAt: new Date().toISOString()
      });
      setShowForm(false);
      setFormData({
        description: '',
        type: 'saida',
        amount: 0,
        category: 'Material',
        date: new Date().toISOString().split('T')[0],
        status: 'pago'
      });
    } catch (error) {
      console.error("Error adding transaction: ", error);
      alert("Erro ao salvar lançamento.");
    }
  };

  // Filtros
  const filteredTransactions = transactions.filter(t => t.date.startsWith(selectedMonth));
  const filteredOrders = orders.filter(o => {
    return (o as any).date?.startsWith(selectedMonth) || (o as any).createdAt?.startsWith(selectedMonth);
  });
  const filteredSupplies = supplies.filter(s => {
    return s.purchaseDate?.startsWith(selectedMonth) || s.createdAt?.startsWith(selectedMonth);
  });
  const filteredFilaments = filaments.filter(f => {
    return (f.purchaseHistory || []).some(purchase => purchase.purchaseDate?.startsWith(selectedMonth))
      || ((!f.purchaseHistory || f.purchaseHistory.length === 0) && (f.purchaseDate?.startsWith(selectedMonth) || f.createdAt?.startsWith(selectedMonth)));
  });
  const filamentPurchases: FilamentPurchaseFlow[] = filteredFilaments.flatMap(f => {
    if (f.purchaseHistory && f.purchaseHistory.length > 0) {
      return f.purchaseHistory
        .filter(purchase => purchase.purchaseDate?.startsWith(selectedMonth))
        .map(purchase => ({
          id: `${f.id}-${purchase.id}`,
          filamentId: f.id,
          material: f.material || 'Filamento',
          color: f.color || '',
          quantityKg: Number(purchase.quantityKg) || 0,
          pricePerKg: Number(purchase.pricePerKg) || 0,
          purchaseDate: purchase.purchaseDate,
          store: purchase.store || '',
        }));
    }

    return (f.purchaseDate?.startsWith(selectedMonth) || f.createdAt?.startsWith(selectedMonth)) ? [{
      id: `${f.id}-legacy`,
      filamentId: f.id,
      material: f.material || 'Filamento',
      color: f.color || '',
      quantityKg: Number(f.initialStockKg ?? f.stockKg) || 0,
      pricePerKg: Number(f.pricePerKg) || 0,
      purchaseDate: f.purchaseDate || f.createdAt || '',
      store: '',
    }] : [];
  });
  const filteredPrinters = printers.filter(p => {
    return p.purchaseDate?.startsWith(selectedMonth) || p.createdAt?.startsWith(selectedMonth);
  });

  // Cálculos Compras de Materiais e Equipamentos
  const comprasInsumos = filteredSupplies.reduce((acc, s) => acc + (Number(s.costPerUnit) * Number(s.quantity) || 0), 0);
  const comprasFilamentos = filamentPurchases.reduce((acc, purchase) => acc + (purchase.quantityKg * purchase.pricePerKg), 0);
  const comprasImpressoras = filteredPrinters.reduce((acc, p) => acc + (Number(p.acquisitionCost) || 0), 0);
  const totalComprasMateriais = comprasInsumos + comprasFilamentos;
  const totalInvestimentos = comprasImpressoras;

  // Cálculos DRE
  const receitaBruta = filteredOrders.reduce((acc, order) => acc + (Number(order.soldPrice) || 0), 0);
  const deducoes = filteredOrders.reduce((acc, order) => acc + (Number(order.fees) || 0), 0);
  const custoProducao = filteredOrders.reduce((acc, order) => acc + (Number(order.realCost) || 0), 0);

  const getTransactionSum = (categories: string[], type: 'entrada' | 'saida' = 'saida') => {
    return filteredTransactions
      .filter(t => t.type === type && categories.includes(t.category))
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  };

  const energia = getTransactionSum(['Energia']);
  const frete = getTransactionSum(['Frete', 'Logística']);
  const aluguel = getTransactionSum(['Aluguel', 'Infraestrutura']);
  const software = getTransactionSum(['Software', 'Assinaturas']);
  const prolabore = getTransactionSum(['Pró-labore', 'Salário']);
  const manutencao = getTransactionSum(['Manutenção']);
  const outros = getTransactionSum(['Outros']);

  const receitaLiquida = receitaBruta - deducoes;
  const totalCustosVariaveis = custoProducao + energia + frete + manutencao;
  const margemContribuicao = receitaLiquida - totalCustosVariaveis;
  const totalCustosFixos = aluguel + software + prolabore + outros;
  const lucroLiquido = margemContribuicao - totalCustosFixos;
  const margemLucroPercentual = receitaBruta > 0 ? (lucroLiquido / receitaBruta) * 100 : 0;
  
  const resultadoCaixa = lucroLiquido - totalInvestimentos - totalComprasMateriais;

  // Cálculos Fluxo
  const totalEntradas = filteredTransactions.filter(t => t.type === 'entrada').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalSaidas = filteredTransactions.filter(t => t.type === 'saida').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) + totalComprasMateriais + totalInvestimentos;
  const saldoAtual = totalEntradas - totalSaidas;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Financeiro</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Controle seu fluxo de caixa e analise o DRE da sua operação.</p>
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <input 
            type="month" 
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full sm:w-auto px-4 py-2 bg-surface-container border-none rounded-md text-sm font-bold focus:ring-2 focus:ring-primary outline-none"
          />
          {activeTab === 'fluxo' && (
            <button 
              onClick={() => setShowForm(!showForm)}
              className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Novo Lançamento
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-outline-variant/20">
        <button
          onClick={() => setActiveTab('fluxo')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'fluxo' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
        >
          <Wallet className="w-4 h-4" />
          Fluxo de Caixa
        </button>
        <button
          onClick={() => setActiveTab('dre')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'dre' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
        >
          <FileText className="w-4 h-4" />
          DRE Simplificado
        </button>
      </div>

      {/* Tab: Fluxo de Caixa */}
      {activeTab === 'fluxo' && (
        <div className="space-y-6">
          {/* Resumo Fluxo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-primary" />
                </div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Saldo Atual</h3>
              </div>
              <p className="text-3xl font-headline font-bold tabular-nums">R$ {saldoAtual.toFixed(2)}</p>
            </div>
            <div className="bg-tertiary-container/30 p-6 rounded-xl border border-tertiary/20 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-tertiary/20 flex items-center justify-center">
                  <ArrowDownRight className="w-4 h-4 text-tertiary" />
                </div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-tertiary">Entradas (Total)</h3>
              </div>
              <p className="text-3xl font-headline font-bold text-tertiary tabular-nums">R$ {totalEntradas.toFixed(2)}</p>
            </div>
            <div className="bg-error-container/30 p-6 rounded-xl border border-error/20 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-error/20 flex items-center justify-center">
                  <ArrowUpRight className="w-4 h-4 text-error" />
                </div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-error">Saídas (Total)</h3>
              </div>
              <p className="text-3xl font-headline font-bold text-error tabular-nums">R$ {totalSaidas.toFixed(2)}</p>
            </div>
          </div>

          {/* Formulário */}
          {showForm && (
            <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-[0_20px_40px_rgba(25,28,30,0.06)]">
              <h3 className="font-headline font-bold text-lg mb-6">Novo Lançamento</h3>
              <form className="grid grid-cols-1 md:grid-cols-4 gap-4" onSubmit={handleSaveTransaction}>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Descrição</label>
                  <input 
                    type="text" 
                    value={formData.description || ''}
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" 
                    placeholder="Ex: Compra de Filamento" 
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Tipo</label>
                  <select 
                    value={formData.type || 'saida'}
                    onChange={e => setFormData({...formData, type: e.target.value as any})}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                  >
                    <option value="entrada">Entrada (Receita)</option>
                    <option value="saida">Saída (Despesa)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Valor (R$)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={formData.amount || ''}
                    onChange={e => setFormData({...formData, amount: Number(e.target.value)})}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" 
                    placeholder="0.00" 
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Categoria</label>
                  <select 
                    value={formData.category || 'Outros'}
                    onChange={e => setFormData({...formData, category: e.target.value})}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                  >
                    <option>Vendas</option>
                    <option>Material</option>
                    <option>Energia</option>
                    <option>Manutenção</option>
                    <option>Frete</option>
                    <option>Aluguel</option>
                    <option>Software</option>
                    <option>Pró-labore</option>
                    <option>Taxas</option>
                    <option>Outros</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data</label>
                  <input 
                    type="date" 
                    value={formData.date || ''}
                    onChange={e => setFormData({...formData, date: e.target.value})}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" 
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Status</label>
                  <select 
                    value={formData.status || 'pago'}
                    onChange={e => setFormData({...formData, status: e.target.value as any})}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                  >
                    <option value="pago">Pago / Recebido</option>
                    <option value="pendente">Pendente</option>
                  </select>
                </div>
                
                <div className="md:col-span-4 flex justify-end mt-4 gap-3 pt-4 border-t border-outline-variant/20">
                  <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors">Cancelar</button>
                  <button type="submit" className="px-8 py-2.5 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all active:scale-95">Salvar Lançamento</button>
                </div>
              </form>
            </div>
          )}

          {/* Tabela de Lançamentos */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
            <div className="p-4 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low/50">
              <h3 className="font-bold text-sm">Extrato</h3>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input type="text" placeholder="Buscar..." className="pl-9 pr-4 py-1.5 text-sm bg-surface-container rounded-md border-none focus:ring-2 focus:ring-primary outline-none" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant whitespace-nowrap">
                    <th className="px-6 py-3">Data</th>
                    <th className="px-6 py-3">Descrição</th>
                    <th className="px-6 py-3">Categoria</th>
                    <th className="px-6 py-3 text-right">Valor</th>
                    <th className="px-6 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {filteredTransactions.length > 0 || filteredSupplies.length > 0 || filamentPurchases.length > 0 ? (
                    <>
                      {filteredTransactions.map((t) => (
                        <tr key={t.id} className="hover:bg-surface-container-low transition-colors group whitespace-nowrap">
                          <td className="px-6 py-4 text-sm text-on-surface-variant">{new Date(t.date).toLocaleDateString('pt-BR')}</td>
                          <td className="px-6 py-4 text-sm font-bold">{t.description}</td>
                          <td className="px-6 py-4">
                            <span className="bg-surface-container px-2 py-1 rounded text-xs font-medium">{t.category}</span>
                          </td>
                          <td className={`px-6 py-4 text-right tabular-nums text-sm font-bold ${t.type === 'entrada' ? 'text-tertiary' : 'text-error'}`}>
                            {t.type === 'entrada' ? '+' : '-'} R$ {t.amount.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase ${t.status === 'pago' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {filteredSupplies.map((s) => (
                        <tr key={s.id} className="hover:bg-surface-container-low transition-colors group whitespace-nowrap">
                          <td className="px-6 py-4 text-sm text-on-surface-variant">{new Date(s.purchaseDate || s.createdAt || '').toLocaleDateString('pt-BR')}</td>
                          <td className="px-6 py-4 text-sm font-bold">Compra de Insumo: {(s as any).name}</td>
                          <td className="px-6 py-4">
                            <span className="bg-surface-container px-2 py-1 rounded text-xs font-medium">Material</span>
                          </td>
                          <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-error">
                            - R$ {(s.costPerUnit * s.quantity).toFixed(2)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase bg-tertiary-fixed text-on-tertiary-fixed-variant">
                              pago
                            </span>
                          </td>
                        </tr>
                      ))}
                      {filamentPurchases.map((purchase) => (
                        <tr key={purchase.id} className="hover:bg-surface-container-low transition-colors group whitespace-nowrap">
                          <td className="px-6 py-4 text-sm text-on-surface-variant">{new Date(purchase.purchaseDate || '').toLocaleDateString('pt-BR')}</td>
                          <td className="px-6 py-4 text-sm font-bold">Compra de Filamento: {purchase.material} {purchase.color}{purchase.store ? ` • ${purchase.store}` : ''}</td>
                          <td className="px-6 py-4">
                            <span className="bg-surface-container px-2 py-1 rounded text-xs font-medium">Material</span>
                          </td>
                          <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-error">
                            - R$ {(purchase.pricePerKg * purchase.quantityKg).toFixed(2)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase bg-tertiary-fixed text-on-tertiary-fixed-variant">
                              pago
                            </span>
                          </td>
                        </tr>
                      ))}
                      {filteredPrinters.map((p) => (
                        <tr key={p.id} className="hover:bg-surface-container-low transition-colors group whitespace-nowrap">
                          <td className="px-6 py-4 text-sm text-on-surface-variant">{new Date(p.purchaseDate || p.createdAt || '').toLocaleDateString('pt-BR')}</td>
                          <td className="px-6 py-4 text-sm font-bold">Compra de Impressora: {(p as any).name}</td>
                          <td className="px-6 py-4">
                            <span className="bg-surface-container px-2 py-1 rounded text-xs font-medium">Investimento</span>
                          </td>
                          <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-error">
                            - R$ {(p.acquisitionCost).toFixed(2)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase bg-tertiary-fixed text-on-tertiary-fixed-variant">
                              pago
                            </span>
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-sm text-on-surface-variant">
                        Nenhum lançamento encontrado para este mês.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: DRE Simplificado */}
      {activeTab === 'dre' && (
        <div className="max-w-4xl mx-auto">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-lg overflow-hidden">
            <div className="bg-primary-container p-6 text-on-primary-container flex justify-between items-center">
              <div>
                <h3 className="font-headline font-bold text-2xl">DRE Simplificado</h3>
                <p className="text-sm opacity-80 mt-1">Demonstração do Resultado do Exercício (Total)</p>
              </div>
              <FileText className="w-8 h-8 opacity-50" />
            </div>

            <div className="p-6 space-y-2 font-sans text-sm">
              
              {/* Receita Bruta */}
              <div className="flex justify-between items-center p-3 bg-surface-container-low rounded-lg">
                <span className="font-bold text-base">1. Receita Bruta de Vendas</span>
                <span className="font-bold text-base tabular-nums">R$ {receitaBruta.toFixed(2)}</span>
              </div>

              {/* Deduções */}
              <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                <span>(-) Impostos e Taxas de Canais</span>
                <span className="tabular-nums">- R$ {deducoes.toFixed(2)}</span>
              </div>

              {/* Receita Líquida */}
              <div className="flex justify-between items-center p-3 bg-surface-container-low rounded-lg mt-4">
                <span className="font-bold text-base">2. Receita Líquida</span>
                <span className="font-bold text-base tabular-nums">R$ {receitaLiquida.toFixed(2)}</span>
              </div>

              {/* Custos Variáveis */}
              <div className="pt-2">
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Custo de Produção (Material + Depreciação)</span>
                  <span className="tabular-nums">- R$ {custoProducao.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Energia Elétrica (Produção)</span>
                  <span className="tabular-nums">- R$ {energia.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Fretes e Embalagens</span>
                  <span className="tabular-nums">- R$ {frete.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Manutenção</span>
                  <span className="tabular-nums">- R$ {manutencao.toFixed(2)}</span>
                </div>
              </div>

              {/* Margem de Contribuição */}
              <div className="flex justify-between items-center p-3 bg-surface-container-low rounded-lg mt-4 border-l-4 border-secondary">
                <div>
                  <span className="font-bold text-base block">3. Margem de Contribuição</span>
                  <span className="text-xs text-on-surface-variant">Valor que sobra para pagar custos fixos e gerar lucro</span>
                </div>
                <span className="font-bold text-base tabular-nums text-secondary">R$ {margemContribuicao.toFixed(2)}</span>
              </div>

              {/* Custos Fixos */}
              <div className="pt-2">
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Aluguel / Infraestrutura</span>
                  <span className="tabular-nums">- R$ {aluguel.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Softwares e Assinaturas</span>
                  <span className="tabular-nums">- R$ {software.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Pró-labore</span>
                  <span className="tabular-nums">- R$ {prolabore.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Outros Custos Fixos</span>
                  <span className="tabular-nums">- R$ {outros.toFixed(2)}</span>
                </div>
              </div>

              {/* Lucro Líquido */}
              <div className="mt-6 pt-6 border-t-2 border-outline-variant/20">
                <div className={`p-6 rounded-xl flex justify-between items-center ${lucroLiquido >= 0 ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-error-container text-on-error-container'}`}>
                  <div>
                    <span className="font-headline font-bold text-xl block">4. Lucro Líquido Operacional</span>
                    <span className="text-sm opacity-80">Resultado da operação (antes de investimentos)</span>
                  </div>
                  <div className="text-right">
                    <span className="font-headline font-black text-3xl tabular-nums block">R$ {lucroLiquido.toFixed(2)}</span>
                    <span className="text-sm font-bold opacity-90">Margem: {margemLucroPercentual.toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {/* Investimentos e Resultado de Caixa */}
              <div className="pt-4">
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Investimentos (Compra de Impressoras)</span>
                  <span className="tabular-nums">- R$ {totalInvestimentos.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 text-error pl-8 hover:bg-error/5 rounded">
                  <span>(-) Compras de Estoque (Filamentos e Insumos)</span>
                  <span className="tabular-nums">- R$ {totalComprasMateriais.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-surface-container-low rounded-lg mt-2">
                  <span className="font-bold text-base">5. Resultado de Caixa (Fluxo Livre)</span>
                  <span className={`font-bold text-base tabular-nums ${resultadoCaixa >= 0 ? 'text-tertiary' : 'text-error'}`}>
                    R$ {resultadoCaixa.toFixed(2)}
                  </span>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
