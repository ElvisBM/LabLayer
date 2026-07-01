import React, { useState, useEffect } from 'react';
import { Plus, MoreVertical, Wrench, Trash2, Edit2, Zap } from 'lucide-react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Printer {
  id: string;
  name: string;
  model: string;
  acquisitionCost: number;
  lifespanHours: number;
  usedHours?: number;
  maintenanceBudget: number;
  powerConsumption: number; // kWh
  createdAt?: string;
  purchaseDate?: string;
  status?: 'operacional' | 'manutenção' | 'inativa';
}

export function Impressoras() {
  const { tenantId } = useAuth();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [energyPrice, setEnergyPrice] = useState<number>(0.95); // Default R$/kWh
  const [isEditingEnergy, setIsEditingEnergy] = useState(false);

  const [formData, setFormData] = useState<Partial<Printer>>({
    name: '',
    model: '',
    acquisitionCost: 0,
    lifespanHours: 0,
    maintenanceBudget: 0,
    powerConsumption: 0,
    purchaseDate: new Date().toISOString().split('T')[0],
    status: 'operacional'
  });

  useEffect(() => {
    if (!tenantId) return;

    const unsubscribePrinters = onSnapshot(collection(db, `tenants/${tenantId}/printers`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Printer));
      setPrinters(data);
    }, (error) => {
      console.error("Error fetching printers:", error);
    });

    const unsubscribeSettings = onSnapshot(doc(db, `tenants/${tenantId}/settings/printer`), (docSnap) => {
      if (docSnap.exists() && docSnap.data().energyPrice !== undefined) {
        setEnergyPrice(docSnap.data().energyPrice);
      }
    });

    return () => {
      unsubscribePrinters();
      unsubscribeSettings();
    };
  }, [tenantId]);

  const handleSaveEnergyPrice = async () => {
    if (!tenantId) return;
    try {
      await setDoc(doc(db, `tenants/${tenantId}/settings/printer`), { energyPrice }, { merge: true });
      setIsEditingEnergy(false);
    } catch (error) {
      console.error("Error saving energy price:", error);
      alert("Erro ao salvar custo de energia.");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const dataToSave = {
        name: formData.name || '',
        model: formData.model || '',
        acquisitionCost: Number(formData.acquisitionCost) || 0,
        lifespanHours: Number(formData.lifespanHours) || 0,
        maintenanceBudget: Number(formData.maintenanceBudget) || 0,
        powerConsumption: Number(formData.powerConsumption) || 0,
        purchaseDate: formData.purchaseDate || new Date().toISOString().split('T')[0],
        status: formData.status || 'operacional'
      };

      if (editingId) {
        await updateDoc(doc(db, `tenants/${tenantId}/printers`, editingId), dataToSave);
      } else {
        await addDoc(collection(db, `tenants/${tenantId}/printers`), {
          ...dataToSave,
          createdAt: new Date().toISOString()
        });
      }

      setShowForm(false);
      setEditingId(null);
      setFormData({ name: '', model: '', acquisitionCost: 0, lifespanHours: 0, maintenanceBudget: 0, powerConsumption: 0, purchaseDate: new Date().toISOString().split('T')[0], status: 'operacional' });
    } catch (error) {
      console.error("Error saving printer:", error);
      alert("Erro ao salvar impressora.");
    }
  };

  const handleEdit = (p: Printer) => {
    setFormData(p);
    setEditingId(p.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!tenantId || !window.confirm("Tem certeza que deseja excluir esta impressora?")) return;
    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/printers`, id));
    } catch (error) {
      console.error("Error deleting printer:", error);
      alert("Erro ao excluir impressora.");
    }
  };

  // Calculate cost per hour: Depreciation + Energy.
  // Monthly maintenance is configured in Precificacao and rateado there.
  const calculateCostPerHour = (p: Printer) => {
    if (!p.lifespanHours) return 0;
    const depreciationAndMaintenance = p.acquisitionCost / p.lifespanHours;
    const energyCost = p.powerConsumption * energyPrice;
    return depreciationAndMaintenance + energyCost;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Frota de Impressoras</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Controle de depreciação, manutenção e custo por hora.</p>
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="bg-surface-container-low px-4 py-2 rounded-md flex items-center gap-3 border border-outline-variant/20">
            <Zap className="w-4 h-4 text-tertiary" />
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Custo Energia (R$/kWh)</span>
              {isEditingEnergy ? (
                <div className="flex items-center gap-2 mt-1">
                  <input 
                    type="number" 
                    step="0.01" 
                    value={energyPrice} 
                    onChange={(e) => setEnergyPrice(Number(e.target.value))}
                    className="w-20 bg-surface-container border-none rounded px-2 py-1 text-xs font-bold tabular-nums focus:ring-2 focus:ring-primary"
                  />
                  <button onClick={handleSaveEnergyPrice} className="text-xs font-bold text-primary hover:underline">Salvar</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-bold tabular-nums">R$ {energyPrice.toFixed(2)}</span>
                  <button onClick={() => setIsEditingEnergy(true)} className="text-xs text-primary hover:underline">Editar</button>
                </div>
              )}
            </div>
          </div>

          <button 
            onClick={() => {
              setFormData({ name: '', model: '', acquisitionCost: 0, lifespanHours: 0, maintenanceBudget: 0, powerConsumption: 0 });
              setEditingId(null);
              setShowForm(!showForm);
            }}
            className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 h-full"
          >
            <Plus className="w-4 h-4" />
            Nova Impressora
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20">
          <h3 className="font-headline font-bold mb-4">{editingId ? 'Editar Impressora' : 'Cadastrar Nova Impressora'}</h3>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-4" onSubmit={handleSave}>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Nome Interno</label>
              <input type="text" required value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary" placeholder="Ex: Impressora 03" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Modelo</label>
              <input type="text" required value={formData.model || ''} onChange={e => setFormData({...formData, model: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary" placeholder="Ex: Prusa MK4" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Custo de Aquisição (R$)</label>
              <input type="number" step="0.01" required value={formData.acquisitionCost || ''} onChange={e => setFormData({...formData, acquisitionCost: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="6500.00" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data da Compra</label>
              <input type="date" required value={formData.purchaseDate || ''} onChange={e => setFormData({...formData, purchaseDate: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Vida Útil Estimada (Horas)</label>
              <input type="number" required value={formData.lifespanHours || ''} onChange={e => setFormData({...formData, lifespanHours: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="10000" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Orçamento Manutenção (R$)</label>
              <input type="number" step="0.01" required value={formData.maintenanceBudget || ''} onChange={e => setFormData({...formData, maintenanceBudget: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="500.00" />
              <p className="text-[10px] text-on-surface-variant">Campo informativo. O rateio mensal da manutenção é configurado na Precificação.</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Consumo por Hora (kWh)</label>
              <input type="number" step="0.01" required value={formData.powerConsumption || ''} onChange={e => setFormData({...formData, powerConsumption: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="0.12" />
              <p className="text-[10px] text-on-surface-variant">Ex.: 200 W = 0,20 kWh por hora.</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Status</label>
              <select 
                value={formData.status || 'operacional'} 
                onChange={e => setFormData({...formData, status: e.target.value as any})} 
                className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary"
              >
                <option value="operacional">Operacional</option>
                <option value="manutenção">Em Manutenção</option>
                <option value="inativa">Inativa</option>
              </select>
            </div>
            <div className="md:col-span-3 flex justify-end mt-2 gap-3">
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-6 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="submit" className="px-6 bg-primary text-on-primary py-2 rounded font-bold text-sm hover:opacity-90 transition-all">
                {editingId ? 'Atualizar Impressora' : 'Salvar Impressora'}
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
                <th className="px-6 py-3">Máquina</th>
                <th className="px-6 py-3 text-right">Aquisição</th>
                <th className="px-6 py-3 text-right">Vida Útil</th>
                <th className="px-6 py-3 text-right">Consumo</th>
                <th className="px-6 py-3 text-right">Custo/Hora (Total)</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {printers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-on-surface-variant">Nenhuma impressora cadastrada.</td>
                </tr>
              )}
              {printers.map((p) => {
                const depreciation = p.lifespanHours ? p.acquisitionCost / p.lifespanHours : 0;
                const energy = p.powerConsumption * energyPrice;
                const totalCost = calculateCostPerHour(p);
                
                return (
                  <tr key={p.id} className="hover:bg-surface-container-low transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-surface-container rounded-sm flex items-center justify-center">
                          <Wrench className="w-4 h-4 text-slate-500" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-primary">{p.name}</p>
                            {p.status === 'operacional' && <span className="w-2 h-2 rounded-full bg-green-500" title="Operacional"></span>}
                            {p.status === 'manutenção' && <span className="w-2 h-2 rounded-full bg-yellow-500" title="Em Manutenção"></span>}
                            {p.status === 'inativa' && <span className="w-2 h-2 rounded-full bg-red-500" title="Inativa"></span>}
                          </div>
                          <p className="text-[10px] font-mono text-on-surface-variant uppercase">{p.model}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                      R$ {p.acquisitionCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                      <div className="flex flex-col items-end">
                        <span>{p.lifespanHours.toLocaleString('pt-BR')} h</span>
                        {p.usedHours !== undefined && (
                          <span className="text-[10px] text-on-surface-variant font-normal">
                            Usado: {p.usedHours.toFixed(1)} h
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                      {p.powerConsumption} kWh/h
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-col items-end">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-tertiary-fixed text-on-tertiary-fixed-variant tabular-nums">
                          R$ {totalCost.toFixed(2)}/h
                        </span>
                        <span className="text-[10px] text-on-surface-variant mt-1">
                          Deprec: R$ {depreciation.toFixed(2)} | Energia: R$ {energy.toFixed(2)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleEdit(p)} className="p-1.5 text-slate-400 hover:text-primary transition-colors rounded">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(p.id)} className="p-1.5 text-slate-400 hover:text-error transition-colors rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
