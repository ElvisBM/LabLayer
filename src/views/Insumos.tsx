import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Package } from 'lucide-react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Supply {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
  minStock: number;
  createdAt?: string;
  purchaseDate?: string;
}

export function Insumos() {
  const { tenantId } = useAuth();
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<Supply>>({
    name: '',
    category: '',
    quantity: 0,
    unit: 'un',
    costPerUnit: 0,
    minStock: 0,
    purchaseDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    if (!tenantId) return;

    const unsubscribe = onSnapshot(collection(db, `tenants/${tenantId}/supplies`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supply));
      setSupplies(data);
    }, (error) => {
      console.error("Error fetching supplies:", error);
    });

    return () => unsubscribe();
  }, [tenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const dataToSave = {
        name: formData.name || '',
        category: formData.category || '',
        quantity: Number(formData.quantity) || 0,
        unit: formData.unit || 'un',
        costPerUnit: Number(formData.costPerUnit) || 0,
        minStock: Number(formData.minStock) || 0,
        purchaseDate: formData.purchaseDate || new Date().toISOString().split('T')[0],
      };

      if (editingId) {
        await updateDoc(doc(db, `tenants/${tenantId}/supplies`, editingId), dataToSave);
      } else {
        await addDoc(collection(db, `tenants/${tenantId}/supplies`), {
          ...dataToSave,
          createdAt: new Date().toISOString()
        });
      }

      setShowForm(false);
      setEditingId(null);
      setFormData({ name: '', category: '', quantity: 0, unit: 'un', costPerUnit: 0, minStock: 0, purchaseDate: new Date().toISOString().split('T')[0] });
    } catch (error) {
      console.error("Error saving supply:", error);
      alert("Erro ao salvar insumo.");
    }
  };

  const handleEdit = (s: Supply) => {
    setFormData(s);
    setEditingId(s.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!tenantId || !window.confirm("Tem certeza que deseja excluir este insumo?")) return;
    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/supplies`, id));
    } catch (error) {
      console.error("Error deleting supply:", error);
      alert("Erro ao excluir insumo.");
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Insumos e Componentes</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Controle de estoque de itens comprados para produção (parafusos, ímãs, caixas).</p>
        </div>
        <button 
          onClick={() => {
            setFormData({ name: '', category: '', quantity: 0, unit: 'un', costPerUnit: 0, minStock: 0 });
            setEditingId(null);
            setShowForm(!showForm);
          }}
          className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Novo Insumo
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Total de Insumos</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{supplies.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Itens em Baixa</h3>
          <p className="text-3xl font-headline font-bold text-error tabular-nums">
            {supplies.filter(s => s.quantity <= s.minStock).length}
          </p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Valor Total Gasto</h3>
          <p className="text-3xl font-headline font-bold text-primary tabular-nums">
            R$ {supplies.reduce((acc, s) => acc + (s.quantity * s.costPerUnit), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20">
          <h3 className="font-headline font-bold mb-4">{editingId ? 'Editar Insumo' : 'Cadastrar Novo Insumo'}</h3>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-4" onSubmit={handleSave}>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Nome do Insumo</label>
              <input type="text" required value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary" placeholder="Ex: Ímã Neodímio 5x2mm" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Categoria</label>
              <input type="text" value={formData.category || ''} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary" placeholder="Ex: Ferragens" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data da Compra</label>
              <input type="date" required value={formData.purchaseDate || ''} onChange={e => setFormData({...formData, purchaseDate: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Unidade de Medida</label>
              <select value={formData.unit || 'un'} onChange={e => setFormData({...formData, unit: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary">
                <option value="un">Unidade (un)</option>
                <option value="kg">Quilograma (kg)</option>
                <option value="g">Grama (g)</option>
                <option value="m">Metro (m)</option>
                <option value="cm">Centímetro (cm)</option>
                <option value="cx">Caixa (cx)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Quantidade em Estoque</label>
              <input type="number" step="0.01" required value={formData.quantity || ''} onChange={e => setFormData({...formData, quantity: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="100" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Estoque Mínimo</label>
              <input type="number" step="0.01" value={formData.minStock || ''} onChange={e => setFormData({...formData, minStock: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="20" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Custo por Unidade (R$)</label>
              <input type="number" step="0.001" required value={formData.costPerUnit || ''} onChange={e => setFormData({...formData, costPerUnit: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="0.15" />
            </div>
            
            <div className="md:col-span-3 flex justify-end mt-2 gap-3">
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-6 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="submit" className="px-6 bg-primary text-on-primary py-2 rounded font-bold text-sm hover:opacity-90 transition-all">
                {editingId ? 'Atualizar Insumo' : 'Salvar Insumo'}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                <th className="px-6 py-3">Insumo</th>
                <th className="px-6 py-3 text-right">Custo Unitário</th>
                <th className="px-6 py-3 text-right">Estoque</th>
                <th className="px-6 py-3 text-right">Custo Total</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {supplies.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-on-surface-variant">Nenhum insumo cadastrado.</td>
                </tr>
              )}
              {supplies.map((s) => (
                <tr key={s.id} className="hover:bg-surface-container-low transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-surface-container rounded-sm flex items-center justify-center">
                        <Package className="w-4 h-4 text-slate-500" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-primary">{s.name}</p>
                        <p className="text-[10px] font-mono text-on-surface-variant uppercase">{s.category}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    R$ {s.costPerUnit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    <span className={s.quantity <= s.minStock ? 'text-error' : ''}>
                      {s.quantity} {s.unit}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    R$ {(s.quantity * s.costPerUnit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(s)} className="p-1.5 text-slate-400 hover:text-primary transition-colors rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(s.id)} className="p-1.5 text-slate-400 hover:text-error transition-colors rounded">
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
