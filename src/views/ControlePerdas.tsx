import React, { useState, useEffect } from 'react';
import { AlertOctagon, TrendingDown, Trash2, Filter } from 'lucide-react';
import { collection, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

interface Loss {
  id: string;
  date: string;
  type: 'purga' | 'falha' | 'outro';
  weightGrams: number;
  filamentId: string;
  filamentName: string;
  cost: number;
  notes: string;
  productId?: string;
  variationId?: string;
}

export function ControlePerdas() {
  const { tenantId } = useAuth();
  const [losses, setLosses] = useState<Loss[]>([]);
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    if (!tenantId) return;

    const unsubscribe = onSnapshot(collection(db, `tenants/${tenantId}/losses`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Loss));
      // Sort by date descending
      data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setLosses(data);
    });

    return () => unsubscribe();
  }, [tenantId]);

  const handleDelete = async (id: string) => {
    if (!tenantId) return;
    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/losses`, id));
    } catch (error) {
      console.error("Error deleting loss:", error);
    }
  };

  const filteredLosses = losses.filter(l => filterType === 'all' || l.type === filterType);

  const totalWeight = filteredLosses.reduce((acc, l) => acc + (l.weightGrams || 0), 0);
  const totalCost = filteredLosses.reduce((acc, l) => acc + (l.cost || 0), 0);

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-headline font-bold text-on-surface">Controle de Perdas</h2>
          <p className="text-sm text-on-surface-variant mt-1">Monitore desperdícios com purgas e falhas de impressão.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 flex items-center gap-4">
          <div className="w-12 h-12 bg-error/10 text-error rounded-full flex items-center justify-center">
            <TrendingDown className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface-variant uppercase tracking-wider">Total Desperdiçado</p>
            <p className="text-2xl font-black text-on-surface">{totalWeight.toFixed(0)} g</p>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 flex items-center gap-4">
          <div className="w-12 h-12 bg-error/10 text-error rounded-full flex items-center justify-center">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface-variant uppercase tracking-wider">Custo das Perdas</p>
            <p className="text-2xl font-black text-error">R$ {totalCost.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
        <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-lowest/50">
          <h3 className="font-bold text-on-surface flex items-center gap-2">
            <Filter className="w-4 h-4 text-primary" /> Filtros
          </h3>
          <select 
            value={filterType || 'todos'} 
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none"
          >
            <option value="all">Todos os Tipos</option>
            <option value="purga">Apenas Purgas</option>
            <option value="falha">Apenas Falhas</option>
            <option value="outro">Outros</option>
          </select>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                <th className="px-6 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Data</th>
                <th className="px-6 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Tipo</th>
                <th className="px-6 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Filamento</th>
                <th className="px-6 py-3 text-xs font-bold text-on-surface-variant uppercase tracking-wider">Detalhes</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-on-surface-variant uppercase tracking-wider">Peso (g)</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-on-surface-variant uppercase tracking-wider">Custo</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {filteredLosses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-on-surface-variant">Nenhum registro de perda encontrado.</td>
                </tr>
              ) : (
                filteredLosses.map((loss) => (
                  <tr key={loss.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-on-surface">
                      {new Date(loss.date).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-bold uppercase ${
                        loss.type === 'purga' ? 'bg-orange-100 text-orange-700' : 
                        loss.type === 'falha' ? 'bg-red-100 text-red-700' : 
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {loss.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface font-medium">
                      {loss.filamentName}
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">
                      {loss.notes}
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface font-bold text-right tabular-nums">
                      {loss.weightGrams} g
                    </td>
                    <td className="px-6 py-4 text-sm text-error font-bold text-right tabular-nums">
                      R$ {loss.cost.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => handleDelete(loss.id)} className="p-2 text-slate-400 hover:text-error transition-colors rounded-full hover:bg-error/10">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
