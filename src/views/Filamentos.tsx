import React, { useState, useEffect, useMemo } from 'react';
import { Plus, MoreVertical, Trash2, Edit2, Link } from 'lucide-react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { SearchableSelect, SelectOption } from '../components/SearchableSelect';
import toast from 'react-hot-toast';

interface Filament {
  id: string;
  sku?: string;
  material: string;
  color: string;
  colorHex?: string;
  brand?: string;
  lineType?: string;
  diameter: string;
  pricePerKg: number;
  stockKg: number;
  initialStockKg?: number;
  purchaseDate?: string;
  store?: string;
  createdAt?: string;
}

interface ProductInfo {
  id: string;
  name: string;
  variations: any[];
  wastes?: any[];
}

const getLocalDateString = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
};

const BRANDS: SelectOption[] = [
  ...["Voolt3D", "3D Fila", "3D Prime", "3DX", "GTMax3D", "National 3D", "STLFlix", "Dynalabs", "Print a Lot (PaL)"].map(b => ({ value: b, label: `${b} (Nacional)`, group: 'Nacionais' })),
  ...["eSun", "Creality", "Bambu Lab", "Sunlu", "Overture", "Hatchbox", "Prusament", "Polymaker"].map(b => ({ value: b, label: `${b} (Importada)`, group: 'Importadas' }))
];

const LINE_TYPES: SelectOption[] = [
  { value: 'Sólido (normal)', label: 'Sólido (normal)' },
  { value: 'Velvet', label: 'Velvet' },
  { value: 'V-Silk', label: 'V-Silk' },
  { value: 'Macaron', label: 'Macaron' },
  { value: 'Neon', label: 'Neon' },
  { value: 'Stone', label: 'Stone' },
  { value: 'Wood', label: 'Wood' },
  { value: 'Rainbow', label: 'Rainbow' },
  { value: 'Duo Color', label: 'Duo Color' },
  { value: 'Duo Color Shadow', label: 'Duo Color Shadow' },
  { value: 'Tri Color', label: 'Tri Color' }
];

const COLORS_BY_TYPE: Record<string, string[]> = {
  'Sólido (normal)': ["Preto", "Branco", "Off White", "Cinza Claro", "Cinza Grafite", "Azul", "Azul Cyan", "Azul Safira", "Vermelho", "Verde", "Verde Oliva", "Amarelo", "Laranja", "Roxo", "Rosa", "Rosa Bebê", "Marrom", "Marrom Cappuccino", "Bege", "Bege Caucasiano"],
  'V-Silk': ["Dourado", "Prata", "Alumínio", "Inox", "Cobre", "Bronze", "Azul Silk", "Verde Silk", "Rosa Silk", "Lilás Silk"],
  'Velvet': ["Preto Velvet", "Branco Velvet", "Cinza Velvet", "Cinza Grafite Velvet", "Azul Velvet", "Vermelho Velvet", "Verde Oliva Velvet", "Amarelo Velvet", "Rosa Velvet", "Rosa Bebê Velvet", "Marrom Cappuccino Velvet"],
  'Macaron': ["Lilás Macaron", "Azul Macaron", "Verde Macaron", "Rosa Macaron", "Amarelo Macaron"],
  'Duo Color': ["Azul / Verde", "Ametista / Verde", "Inox / Rosa Choque", "Preto / Dourado", "Dourado / Preto"],
  'Duo Color Shadow': ["Azul / Verde", "Ametista / Verde", "Inox / Rosa Choque", "Preto / Dourado", "Dourado / Preto"],
  'Tri Color': ["Dourado / Laranja / Rosa Choque", "Dourado / Rosa Choque / Verde", "Azul / Laranja / Verde Neon"],
  'Neon': ["Neon"],
  'Stone': ["Stone"],
  'Wood': ["Wood"],
  'Rainbow': ["Rainbow"]
};

export function Filamentos() {
  const { tenantId } = useAuth();
  const [filaments, setFilaments] = useState<Filament[]>([]);
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);

  const [filterColor, setFilterColor] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterStore, setFilterStore] = useState('');
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');

  const [formData, setFormData] = useState<Partial<Filament>>({
    brand: '',
    material: 'PLA',
    lineType: 'Sólido (normal)',
    color: '',
    colorHex: '#000000',
    diameter: '1.75mm',
    pricePerKg: 0,
    stockKg: 0,
    purchaseDate: getLocalDateString(),
    store: ''
  });

  // Get dynamic color options based on selected lineType
  const colorOptions: SelectOption[] = (COLORS_BY_TYPE[formData.lineType || 'Sólido (normal)'] || []).map(c => ({ value: c, label: c }));

  const calculateProductFilamentUsage = (product: ProductInfo): Record<string, number> => {
    const usage: Record<string, number> = {};

    for (const variation of product.variations || []) {
      const yieldPerBatch = Math.max(1, variation.quantityPerPrint || 1);

      if (variation.materials && variation.materials.length > 0) {
        for (const material of variation.materials) {
          if (!material.filamentId) continue;
          const stockPieces = material.pieces || 0;
          const batches = stockPieces > 0 ? Math.ceil(stockPieces / yieldPerBatch) : 1;
          const weightKg = (((material.weightGrams || 0) + (material.purgeGrams || 0)) * batches) / 1000;
          usage[material.filamentId] = (usage[material.filamentId] || 0) + weightKg;
        }
      } else if (variation.filamentId) {
        const weightKg = ((variation.weightGrams || 0) * 1) / 1000;
        usage[variation.filamentId] = (usage[variation.filamentId] || 0) + weightKg;
      }
    }

    for (const waste of product.wastes || []) {
      if (!waste.filamentId) continue;
      usage[waste.filamentId] = (usage[waste.filamentId] || 0) + ((waste.weightGrams || 0) / 1000);
    }

    return usage;
  };

  const usageByFilament = useMemo(() => {
    const usage: Record<string, number> = {};

    for (const product of products) {
      const productUsage = calculateProductFilamentUsage(product);
      for (const [filamentId, amount] of Object.entries(productUsage)) {
        usage[filamentId] = (usage[filamentId] || 0) + amount;
      }
    }

    return usage;
  }, [products]);

  const getPurchasedKg = (filament: Filament) => {
    const consumedKg = usageByFilament[filament.id] || 0;
    const currentStock = Number(filament.stockKg) || 0;
    return currentStock + consumedKg;
  };

  const getCurrentStockKg = (filament: Filament) => {
    const purchasedKg = getPurchasedKg(filament);
    const consumedKg = usageByFilament[filament.id] || 0;
    return Math.max(0, purchasedKg - consumedKg);
  };

  const filamentTotals = useMemo(() => {
    return filaments.reduce((acc, filament) => {
      const purchasedKg = getPurchasedKg(filament);
      const currentStockKg = getCurrentStockKg(filament);
      const spentKg = Math.max(0, purchasedKg - currentStockKg);
      const pricePerKg = Number(filament.pricePerKg) || 0;

      acc.purchasedKg += purchasedKg;
      acc.currentStockKg += currentStockKg;
      acc.purchasedValue += purchasedKg * pricePerKg;
      acc.spentValue += spentKg * pricePerKg;
      return acc;
    }, { purchasedKg: 0, currentStockKg: 0, purchasedValue: 0, spentValue: 0 });
  }, [filaments, usageByFilament]);

  useEffect(() => {
    if (!tenantId) return;

    const unsubscribe = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Filament));
      setFilaments(data);
    }, (error) => {
      console.error("Error fetching filaments:", error);
    });

    const unsubscribeProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      const pData = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name,
          variations: d.variations || [],
          wastes: d.wastes || [],
        };
      });
      setProducts(pData);
    });

    return () => { unsubscribe(); unsubscribeProducts(); };
  }, [tenantId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const purchasedKg = Number(formData.stockKg) || 0;
      const consumedKg = editingId ? (usageByFilament[editingId] || 0) : 0;
      const dataToSave = {
        brand: formData.brand || '',
        material: formData.material || 'PLA',
        lineType: formData.lineType || 'Sólido (normal)',
        color: formData.color || '',
        colorHex: formData.colorHex || '#000000',
        diameter: formData.diameter || '1.75mm',
        pricePerKg: Number(formData.pricePerKg) || 0,
        stockKg: Math.max(0, purchasedKg - consumedKg),
        purchaseDate: formData.purchaseDate || getLocalDateString(),
        store: formData.store || ''
      };

      if (editingId) {
        await updateDoc(doc(db, `tenants/${tenantId}/filaments`, editingId), dataToSave);
        toast.success("Filamento atualizado com sucesso!");
      } else {
        await addDoc(collection(db, `tenants/${tenantId}/filaments`), {
          ...dataToSave,
          createdAt: new Date().toISOString()
        });
        toast.success("Novo filamento adicionado!");
      }

      setShowForm(false);
      setEditingId(null);
      setFormData({ brand: '', material: 'PLA', lineType: 'Sólido (normal)', color: '', colorHex: '#000000', diameter: '1.75mm', pricePerKg: 0, stockKg: 0, purchaseDate: getLocalDateString(), store: '' });
    } catch (error) {
      console.error("Error saving filament:", error);
      toast.error("Erro ao salvar filamento.");
    }
  };

  const handleEdit = (f: Filament) => {
    setFormData({
      ...f,
      stockKg: getPurchasedKg(f),
      colorHex: f.colorHex || '#000000',
      brand: f.brand || '',
      lineType: f.lineType || 'Sólido (normal)',
      store: f.store || '',
      purchaseDate: f.purchaseDate || getLocalDateString()
    });
    setEditingId(f.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!tenantId || !window.confirm("Tem certeza que deseja excluir este filamento?")) return;
    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/filaments`, id));
      toast.success("Filamento excluído com sucesso!");
    } catch (error) {
      console.error("Error deleting filament:", error);
      toast.error("Erro ao excluir filamento.");
    }
  };

  const handleReconcileStocks = async () => {
    if (!tenantId || filaments.length === 0) return;

    try {
      setIsReconciling(true);
      const batch = writeBatch(db);

      filaments.forEach((filament) => {
        const purchasedKg = Number(filament.stockKg) || 0;
        const consumedKg = usageByFilament[filament.id] || 0;
        const reconciledStockKg = Math.max(0, purchasedKg - consumedKg);

        batch.update(doc(db, `tenants/${tenantId}/filaments`, filament.id), {
          stockKg: reconciledStockKg,
        });
      });

      await batch.commit();
      toast.success('Estoques recalculados com base nos produtos cadastrados!');
    } catch (error) {
      console.error("Error reconciling filament stocks:", error);
      toast.error("Erro ao recalcular estoques dos filamentos.");
    } finally {
      setIsReconciling(false);
    }
  };

  const filteredFilaments = filaments.filter(f => {
    if (filterColor && !(f.color || '').toLowerCase().includes(filterColor.toLowerCase())) return false;
    if (filterType && !(f.lineType || '').toLowerCase().includes(filterType.toLowerCase())) return false;
    if (filterBrand && !(f.brand || '').toLowerCase().includes(filterBrand.toLowerCase())) return false;
    if (filterStore && !(f.store || '').toLowerCase().includes(filterStore.toLowerCase())) return false;
    if (filterDateStart && (f.purchaseDate || '') < filterDateStart) return false;
    if (filterDateEnd && (f.purchaseDate || '') > filterDateEnd) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Catálogo de Filamentos</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Gerencie materiais, custos e níveis de estoque.</p>
        </div>
        <button 
          onClick={() => {
            setFormData({ brand: '', material: 'PLA', lineType: 'Sólido (normal)', color: '', colorHex: '#000000', diameter: '1.75mm', pricePerKg: 0, stockKg: 0, purchaseDate: getLocalDateString(), store: '' });
            setEditingId(null);
            setShowForm(!showForm);
          }}
          className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Novo Filamento
        </button>
        <button
          onClick={handleReconcileStocks}
          disabled={isReconciling || filaments.length === 0}
          className="w-full sm:w-auto px-4 py-2 bg-secondary text-on-primary text-sm font-bold rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {isReconciling ? 'Recalculando...' : 'Recalcular Estoques'}
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Rolos Cadastrados</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{filaments.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Estoque Físico Atual</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">
            {filamentTotals.currentStockKg.toFixed(2)} Kg
          </p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden group">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 flex items-center justify-between">
            Custo Total Comprado
            <div className="px-1.5 py-0.5 bg-surface-container rounded text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">Inclui já gasto</div>
          </h3>
          <p className="text-3xl font-headline font-bold text-primary tabular-nums">
            R$ {filamentTotals.purchasedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm relative overflow-hidden group">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 flex items-center justify-between">
            Total Gasto em Filamento
            <div className="px-1.5 py-0.5 bg-surface-container rounded text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">Consumo dos produtos cadastrados</div>
          </h3>
          <p className="text-3xl font-headline font-bold text-secondary tabular-nums">
            R$ {filamentTotals.spentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20">
          <h3 className="font-headline font-bold mb-4">{editingId ? 'Editar Filamento' : 'Cadastrar Novo Filamento'}</h3>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-4" onSubmit={handleSave}>
            <div className="space-y-1">
              <SearchableSelect 
                label="Marca"
                options={BRANDS}
                value={formData.brand || ''}
                onChange={(val) => setFormData({...formData, brand: val})}
                placeholder="Selecione a marca"
                allowCustom={true}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Material</label>
              <select value={formData.material || 'PLA'} onChange={e => setFormData({...formData, material: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary">
                <option>PLA</option>
                <option>PETG</option>
                <option>ABS</option>
                <option>TPU</option>
              </select>
            </div>

            <div className="space-y-1">
              <SearchableSelect 
                label="Tipo de Linha (Acabamento)"
                options={LINE_TYPES}
                value={formData.lineType || 'Sólido (normal)'}
                onChange={(val) => setFormData({...formData, lineType: val, color: ''})} // Reset color when type changes
                placeholder="Selecione o tipo"
                allowCustom={true}
              />
            </div>

            <div className="space-y-1">
              <SearchableSelect 
                label="Cor"
                options={colorOptions}
                value={formData.color || ''}
                onChange={(val) => setFormData({...formData, color: val})}
                placeholder="Selecione a cor"
                allowCustom={true}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Seletor de Cor (Hex)</label>
              <div className="flex items-center gap-2">
                <input type="color" value={formData.colorHex || '#000000'} onChange={e => setFormData({...formData, colorHex: e.target.value})} className="h-9 w-12 bg-surface-container border-none rounded cursor-pointer p-1" />
                <span className="text-xs text-on-surface-variant font-mono">{formData.colorHex}</span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Preço por Kg (R$)</label>
              <input type="number" step="0.01" required value={formData.pricePerKg || ''} onChange={e => setFormData({...formData, pricePerKg: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="120.00" />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Total Comprado (Kg)</label>
              <input type="number" step="0.01" required value={formData.stockKg || ''} onChange={e => setFormData({...formData, stockKg: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary tabular-nums" placeholder="1.0" />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data da Compra</label>
              <input type="date" value={formData.purchaseDate || ''} onChange={e => setFormData({...formData, purchaseDate: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary" />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Loja da Compra</label>
              <input type="text" value={formData.store || ''} onChange={e => setFormData({...formData, store: e.target.value})} className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary" placeholder="Site, Mercado Livre, etc." />
            </div>

            <div className="flex items-end gap-3 md:col-span-2 justify-end mt-2">
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-6 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="submit" className="px-6 bg-primary text-on-primary py-2 rounded font-bold text-sm hover:opacity-90 transition-all">
                {editingId ? 'Atualizar' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/20 flex flex-wrap gap-3 items-center">
        <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mr-2">Filtros</span>
        <input type="text" placeholder="Filtrar por cor..." value={filterColor} onChange={e => setFilterColor(e.target.value)} className="bg-surface-container border-none rounded p-2 text-xs flex-1 min-w-[120px]" />
        <input type="text" placeholder="Filtrar por tipo..." value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-surface-container border-none rounded p-2 text-xs flex-1 min-w-[120px]" />
        <input type="text" placeholder="Filtrar por marca..." value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className="bg-surface-container border-none rounded p-2 text-xs flex-1 min-w-[120px]" />
        <input type="text" placeholder="Filtrar por loja..." value={filterStore} onChange={e => setFilterStore(e.target.value)} className="bg-surface-container border-none rounded p-2 text-xs flex-1 min-w-[120px]" />
        
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <input type="date" value={filterDateStart} onChange={e => setFilterDateStart(e.target.value)} className="w-full bg-surface-container border-none rounded p-2 text-xs" title="Data Compra (Início)" />
          <span className="text-on-surface-variant text-xs">até</span>
          <input type="date" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} className="w-full bg-surface-container border-none rounded p-2 text-xs" title="Data Compra (Fim)" />
        </div>
      </div>

      <section className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                <th className="px-6 py-3">Material / Cor</th>
                <th className="px-6 py-3">Data Compra</th>
                <th className="px-6 py-3 text-right">Custo (Kg)</th>
                <th className="px-6 py-3 text-right">Estoque</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Vinculado</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {filteredFilaments.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-on-surface-variant">Nenhum filamento encontrado.</td>
                </tr>
              )}
              {filteredFilaments.map((f) => {
                const usedByProducts = products.filter(p => p.variations.some((v: any) => v.filamentId === f.id || (v.materials || []).some((m: any) => m.filamentId === f.id)));
                const currentStockKg = getCurrentStockKg(f);
                return (
                <tr key={f.id} className="hover:bg-surface-container-low transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-6 h-6 rounded-full border border-outline-variant/30 shadow-sm flex-shrink-0" 
                        style={{ backgroundColor: f.colorHex || '#cccccc' }}
                        title={f.color}
                      />
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-primary">
                          {f.material} {f.color} {f.lineType && f.lineType !== 'Sólido (normal)' ? `(${f.lineType})` : ''}
                        </span>
                        <span className="text-[10px] font-mono text-on-surface-variant uppercase">
                          {f.brand ? `${f.brand} • ` : ''}{f.diameter}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    <div className="flex flex-col">
                      <span>{f.purchaseDate ? new Date(f.purchaseDate + 'T12:00:00Z').toLocaleDateString('pt-BR') : '-'}</span>
                      {f.store && <span className="text-[10px] text-on-surface-variant/70 truncate max-w-[120px]" title={f.store}>{f.store}</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    R$ {f.pricePerKg.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    {currentStockKg.toFixed(2)} kg
                  </td>
                  <td className="px-6 py-4">
                    {currentStockKg > 5 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-tertiary-fixed text-on-tertiary-fixed-variant">Ideal</span>
                    ) : currentStockKg > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-error-container text-on-error-container">Baixo</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-900 text-white">Sem Estoque</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {usedByProducts.length > 0 ? (
                      <div className="flex items-center gap-1.5 relative group/info cursor-help w-max">
                        <Link className="w-3.5 h-3.5 text-on-surface-variant" />
                        <span className="text-xs font-bold text-on-surface-variant">{usedByProducts.length} prod</span>
                        
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-surface-container-highest text-on-surface text-[10px] p-2 rounded shadow-xl opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none z-10 flex flex-col gap-1">
                          <span className="font-bold border-b border-outline-variant/20 pb-1 mb-1">Vinculado a:</span>
                          {usedByProducts.map(p => (
                            <span key={p.id} className="truncate" title={p.name}>• {p.name}</span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-on-surface-variant/50 italic">- LIVRE -</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(f)} className="p-1.5 text-slate-400 hover:text-primary transition-colors rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(f.id)} className="p-1.5 text-slate-400 hover:text-error transition-colors rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
