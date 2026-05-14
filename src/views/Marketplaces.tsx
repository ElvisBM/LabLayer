import React, { useState, useEffect } from 'react';
import { Plus, MoreVertical, Store, Trash2, Edit2 } from 'lucide-react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Marketplace {
  id: string;
  name: string;
  commissionPercent: number;
  fixedFee: number;
  averageShipping: number;
  affiliateCommission: number;
  payoutDays: number;
  status: 'ativo' | 'inativo';
  createdAt?: string;
}

export function Marketplaces() {
  const { tenantId } = useAuth();
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<Partial<Marketplace>>({
    name: '',
    commissionPercent: 0,
    fixedFee: 0,
    averageShipping: 0,
    affiliateCommission: 0,
    payoutDays: 0,
    status: 'ativo'
  });

  useEffect(() => {
    if (!tenantId) return;

    const unsubscribe = onSnapshot(collection(db, `tenants/${tenantId}/marketplaces`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Marketplace));
      setMarketplaces(data);
    }, (error) => {
      console.error("Error fetching marketplaces:", error);
    });

    return () => unsubscribe();
  }, [tenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const dataToSave = {
        name: formData.name || '',
        commissionPercent: Number(formData.commissionPercent) || 0,
        fixedFee: Number(formData.fixedFee) || 0,
        averageShipping: Number(formData.averageShipping) || 0,
        affiliateCommission: Number(formData.affiliateCommission) || 0,
        payoutDays: Number(formData.payoutDays) || 0,
        status: formData.status || 'ativo',
      };

      if (editingId) {
        await updateDoc(doc(db, `tenants/${tenantId}/marketplaces`, editingId), dataToSave);
      } else {
        await addDoc(collection(db, `tenants/${tenantId}/marketplaces`), {
          ...dataToSave,
          createdAt: new Date().toISOString()
        });
      }

      setShowForm(false);
      setEditingId(null);
      setFormData({ name: '', commissionPercent: 0, fixedFee: 0, averageShipping: 0, affiliateCommission: 0, payoutDays: 0, status: 'ativo' });
    } catch (error) {
      console.error("Error saving marketplace:", error);
      alert("Erro ao salvar canal de venda.");
    }
  };

  const handleEdit = (m: Marketplace) => {
    setFormData(m);
    setEditingId(m.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!tenantId || !window.confirm("Tem certeza que deseja excluir este canal?")) return;
    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/marketplaces`, id));
    } catch (error) {
      console.error("Error deleting marketplace:", error);
      alert("Erro ao excluir canal.");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Canais de Venda</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Configure as taxas, fretes e prazos de recebimento por plataforma.</p>
        </div>
        <button 
          onClick={() => {
            setFormData({ name: '', commissionPercent: 0, fixedFee: 0, averageShipping: 0, affiliateCommission: 0, payoutDays: 0, status: 'ativo' });
            setEditingId(null);
            setShowForm(!showForm);
          }}
          className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Novo Canal
        </button>
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-[0_20px_40px_rgba(25,28,30,0.06)]">
          <div className="flex items-center gap-2 mb-6">
            <Store className="w-5 h-5 text-primary" />
            <h3 className="font-headline font-bold text-lg">{editingId ? 'Editar Canal' : 'Configuração do Canal'}</h3>
          </div>
          
          <form className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" onSubmit={handleSave}>
            <div className="space-y-1.5 lg:col-span-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Nome do Canal</label>
              <input type="text" required value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Ex: Shopee, Mercado Livre, Nuvemshop" />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Taxa da Plataforma (%)</label>
              <input type="number" step="0.1" value={formData.commissionPercent || ''} onChange={e => setFormData({...formData, commissionPercent: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" placeholder="0.0" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Taxa Fixa por Venda (R$)</label>
              <input type="number" step="0.01" value={formData.fixedFee || ''} onChange={e => setFormData({...formData, fixedFee: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Frete Médio (R$)</label>
              <input type="number" step="0.01" value={formData.averageShipping || ''} onChange={e => setFormData({...formData, averageShipping: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Comissão Afiliado (%)</label>
              <input type="number" step="0.1" value={formData.affiliateCommission || ''} onChange={e => setFormData({...formData, affiliateCommission: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" placeholder="0.0" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Prazo de Recebimento (Dias)</label>
              <input type="number" value={formData.payoutDays || ''} onChange={e => setFormData({...formData, payoutDays: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none" placeholder="Ex: 14" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Status</label>
              <select value={formData.status || 'ativo'} onChange={e => setFormData({...formData, status: e.target.value as any})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none">
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
            
            <div className="md:col-span-2 lg:col-span-3 flex justify-end mt-4 gap-3 pt-4 border-t border-outline-variant/20">
              <button 
                type="button" 
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-6 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors"
              >
                Cancelar
              </button>
              <button 
                type="submit" 
                className="px-8 py-2.5 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all active:scale-95"
              >
                {editingId ? 'Atualizar Canal' : 'Salvar Configurações'}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant whitespace-nowrap">
                <th className="px-6 py-3">Canal de Venda</th>
                <th className="px-6 py-3 text-right">Taxa (%)</th>
                <th className="px-6 py-3 text-right">Taxa Fixa</th>
                <th className="px-6 py-3 text-right">Frete Médio</th>
                <th className="px-6 py-3 text-right">Comissão Afiliado</th>
                <th className="px-6 py-3 text-right">Recebimento</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {marketplaces.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-on-surface-variant">Nenhum canal cadastrado.</td>
                </tr>
              )}
              {marketplaces.map((m) => (
                <tr key={m.id} className="hover:bg-surface-container-low transition-colors group whitespace-nowrap">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-surface-container rounded-sm flex items-center justify-center flex-shrink-0">
                        <Store className="w-4 h-4 text-slate-500" />
                      </div>
                      <span className="text-sm font-bold text-primary">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    {m.commissionPercent.toFixed(1)}%
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    R$ {m.fixedFee.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    R$ {m.averageShipping.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    {m.affiliateCommission > 0 ? `${m.affiliateCommission.toFixed(1)}%` : '-'}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    {m.payoutDays} dias
                  </td>
                  <td className="px-6 py-4">
                    {m.status === 'ativo' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-tertiary-fixed text-on-tertiary-fixed-variant">
                        Ativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-surface-container-highest text-on-surface-variant">
                        Inativo
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(m)} className="p-1.5 text-slate-400 hover:text-primary transition-colors rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(m.id)} className="p-1.5 text-slate-400 hover:text-error transition-colors rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
