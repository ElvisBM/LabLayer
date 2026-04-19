import React, { useState, useEffect, useMemo } from 'react';
import { Plus, MoreVertical, Trash2, Edit2, Link } from 'lucide-react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { SearchableSelect, SelectOption } from '../components/SearchableSelect';
import toast from 'react-hot-toast';

interface FilamentPurchase {
  id: string;
  quantityKg: number;
  pricePerKg: number;
  purchaseDate: string;
  store: string;
  supplierId?: string;
}

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
  supplierId?: string;
  createdAt?: string;
  purchaseHistory?: FilamentPurchase[];
}

interface ProductInfo {
  id: string;
  name: string;
  variations: any[];
  wastes?: any[];
}

interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  status?: 'ativo' | 'inativo';
  createdAt?: string;
}

type FilamentSortKey = 'material' | 'date' | 'price' | 'purchased' | 'stock';

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
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [sortKey, setSortKey] = useState<FilamentSortKey>('material');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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
    store: '',
    supplierId: '',
    purchaseHistory: [{
      id: Date.now().toString(),
      quantityKg: 0,
      pricePerKg: 0,
      purchaseDate: getLocalDateString(),
      store: '',
      supplierId: '',
    }]
  });

  // Get dynamic color options based on selected lineType
  const colorOptions: SelectOption[] = (COLORS_BY_TYPE[formData.lineType || 'Sólido (normal)'] || []).map(c => ({ value: c, label: c }));

  const createBlankPurchase = (): FilamentPurchase => ({
    id: Date.now().toString(),
    quantityKg: 0,
    pricePerKg: 0,
    purchaseDate: getLocalDateString(),
    store: '',
    supplierId: '',
  });

  const getPurchaseHistory = (filament: Partial<Filament>) => {
    const purchaseHistory = (filament.purchaseHistory || []).filter(p => (Number(p.quantityKg) || 0) > 0);
    if (purchaseHistory.length > 0) return purchaseHistory;

    const fallbackQuantity = Number(filament.initialStockKg ?? filament.stockKg) || 0;
    if (fallbackQuantity <= 0) return [];

    return [{
      id: `${filament.id || 'legacy'}-initial`,
      quantityKg: fallbackQuantity,
      pricePerKg: Number(filament.pricePerKg) || 0,
      purchaseDate: filament.purchaseDate || getLocalDateString(),
      store: filament.store || '',
      supplierId: filament.supplierId || '',
    }];
  };

  const getPurchasedKgFromHistory = (filament: Partial<Filament>) => {
    return getPurchaseHistory(filament).reduce((acc, purchase) => acc + (Number(purchase.quantityKg) || 0), 0);
  };

  const getAveragePricePerKg = (filament: Partial<Filament>) => {
    const purchases = getPurchaseHistory(filament);
    const totalKg = purchases.reduce((acc, purchase) => acc + (Number(purchase.quantityKg) || 0), 0);
    if (totalKg <= 0) return Number(filament.pricePerKg) || 0;

    const totalValue = purchases.reduce((acc, purchase) => {
      return acc + ((Number(purchase.quantityKg) || 0) * (Number(purchase.pricePerKg) || 0));
    }, 0);
    return totalValue / totalKg;
  };

  const getPurchasedValue = (filament: Partial<Filament>) => {
    const purchases = getPurchaseHistory(filament);
    if (purchases.length === 0) {
      const fallbackKg = Number(filament.initialStockKg ?? filament.stockKg) || 0;
      return fallbackKg * (Number(filament.pricePerKg) || 0);
    }

    return purchases.reduce((acc, purchase) => {
      return acc + ((Number(purchase.quantityKg) || 0) * (Number(purchase.pricePerKg) || 0));
    }, 0);
  };

  const getLatestPurchase = (filament: Partial<Filament>) => {
    const purchases = [...getPurchaseHistory(filament)];
    purchases.sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
    return purchases[0] || null;
  };

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
    return getPurchasedKgFromHistory(filament);
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
      const consumedKg = usageByFilament[filament.id] || 0;
      const pricePerKg = getAveragePricePerKg(filament);

      acc.purchasedKg += purchasedKg;
      acc.currentStockKg += currentStockKg;
      acc.purchasedValue += getPurchasedValue(filament);
      acc.spentValue += consumedKg * pricePerKg;
      return acc;
    }, { purchasedKg: 0, currentStockKg: 0, purchasedValue: 0, spentValue: 0 });
  }, [filaments, usageByFilament]);

  const getSupplierNameById = (supplierId?: string) => {
    if (!supplierId) return '';
    return suppliers.find(supplier => supplier.id === supplierId)?.name || '';
  };

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

    const unsubscribeSuppliers = onSnapshot(collection(db, `tenants/${tenantId}/suppliers`), (snapshot) => {
      const supplierData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
      setSuppliers(supplierData);
    }, (error) => {
      console.error("Error fetching suppliers:", error);
    });

    return () => { unsubscribe(); unsubscribeProducts(); unsubscribeSuppliers(); };
  }, [tenantId]);

  const legacySupplierNames = useMemo(() => {
    const names = new Set<string>();

    filaments.forEach(filament => {
      getPurchaseHistory(filament).forEach(purchase => {
        if (!purchase.supplierId && purchase.store) names.add(purchase.store);
      });
    });

    (formData.purchaseHistory || []).forEach(purchase => {
      if (!purchase.supplierId && purchase.store) names.add(purchase.store);
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [filaments, formData.purchaseHistory]);

  const supplierOptions: SelectOption[] = useMemo(() => {
    const activeSuppliers = suppliers
      .filter(supplier => supplier.status !== 'inativo')
      .map(supplier => ({ value: supplier.id, label: supplier.name, group: 'Fornecedores' }));
    const inactiveSuppliers = suppliers
      .filter(supplier => supplier.status === 'inativo')
      .map(supplier => ({ value: supplier.id, label: `${supplier.name} (Inativo)`, group: 'Fornecedores Inativos' }));
    const legacySuppliers = legacySupplierNames.map(name => ({ value: `legacy:${name}`, label: name, group: 'Historico' }));

    return [...activeSuppliers, ...inactiveSuppliers, ...legacySuppliers];
  }, [legacySupplierNames, suppliers]);

  const getPurchaseSupplierValue = (purchase: FilamentPurchase) => {
    if (purchase.supplierId && suppliers.some(supplier => supplier.id === purchase.supplierId)) {
      return purchase.supplierId;
    }
    if (purchase.store) return `legacy:${purchase.store}`;
    return '';
  };

  const handlePurchaseSupplierChange = (purchaseId: string, value: string) => {
    if (value.startsWith('legacy:')) {
      const legacyName = value.replace('legacy:', '');
      setFormData(prev => ({
        ...prev,
        purchaseHistory: (prev.purchaseHistory || []).map(purchase =>
          purchase.id === purchaseId ? { ...purchase, supplierId: '', store: legacyName } : purchase
        )
      }));
      return;
    }

    const supplierName = getSupplierNameById(value);
    setFormData(prev => ({
      ...prev,
      purchaseHistory: (prev.purchaseHistory || []).map(purchase =>
        purchase.id === purchaseId ? { ...purchase, supplierId: value, store: supplierName } : purchase
      )
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const purchaseHistory = (formData.purchaseHistory || [])
        .map(purchase => ({
          ...purchase,
          quantityKg: Number(purchase.quantityKg) || 0,
          pricePerKg: Number(purchase.pricePerKg) || 0,
          purchaseDate: purchase.purchaseDate || getLocalDateString(),
          supplierId: purchase.supplierId || '',
          store: purchase.supplierId ? (getSupplierNameById(purchase.supplierId) || purchase.store || '') : (purchase.store || ''),
        }))
        .filter(purchase => purchase.quantityKg > 0);
      const purchasedKg = purchaseHistory.reduce((acc, purchase) => acc + purchase.quantityKg, 0);
      const consumedKg = editingId ? (usageByFilament[editingId] || 0) : 0;
      const averagePricePerKg = purchasedKg > 0
        ? purchaseHistory.reduce((acc, purchase) => acc + (purchase.quantityKg * purchase.pricePerKg), 0) / purchasedKg
        : 0;
      const latestPurchase = [...purchaseHistory].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))[0];
      const dataToSave = {
        brand: formData.brand || '',
        material: formData.material || 'PLA',
        lineType: formData.lineType || 'Sólido (normal)',
        color: formData.color || '',
        colorHex: formData.colorHex || '#000000',
        diameter: formData.diameter || '1.75mm',
        pricePerKg: averagePricePerKg,
        stockKg: Math.max(0, purchasedKg - consumedKg),
        initialStockKg: purchasedKg,
        purchaseDate: latestPurchase?.purchaseDate || getLocalDateString(),
        store: latestPurchase?.store || '',
        supplierId: latestPurchase?.supplierId || '',
        purchaseHistory,
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
      setFormData({
        brand: '',
        material: 'PLA',
        lineType: 'Sólido (normal)',
        color: '',
        colorHex: '#000000',
        diameter: '1.75mm',
        pricePerKg: 0,
        stockKg: 0,
        purchaseDate: getLocalDateString(),
        store: '',
        supplierId: '',
        purchaseHistory: [createBlankPurchase()]
      });
    } catch (error) {
      console.error("Error saving filament:", error);
      toast.error("Erro ao salvar filamento.");
    }
  };

  const handleEdit = (f: Filament) => {
    setFormData({
      ...f,
      stockKg: getPurchasedKg(f),
      pricePerKg: getAveragePricePerKg(f),
      purchaseDate: getLatestPurchase(f)?.purchaseDate || getLocalDateString(),
      store: getLatestPurchase(f)?.store || '',
      supplierId: getLatestPurchase(f)?.supplierId || '',
      purchaseHistory: getPurchaseHistory(f).map(purchase => ({
        ...purchase,
        supplierId: purchase.supplierId || '',
      })),
      colorHex: f.colorHex || '#000000',
      brand: f.brand || '',
      lineType: f.lineType || 'Sólido (normal)',
    });
    setEditingId(f.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!tenantId || !window.confirm("Tem certeza que deseja excluir este filamento?")) return;

    const linkedProducts = products
      .map(product => ({
        id: product.id,
        name: product.name,
        usageKg: calculateProductFilamentUsage(product)[id] || 0,
      }))
      .filter(product => product.usageKg > 0);

    if (linkedProducts.length > 0) {
      const productNames = linkedProducts.slice(0, 3).map(product => product.name).join(', ');
      toast.error(`Este filamento está vinculado a ${linkedProducts.length} produto(s): ${productNames}${linkedProducts.length > 3 ? '...' : ''}`);
      return;
    }

    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/filaments`, id));
      if (editingId === id) {
        setShowForm(false);
        setEditingId(null);
      }
      toast.success("Filamento excluído com sucesso!");
    } catch (error) {
      console.error("Error deleting filament:", error);
      const message = error instanceof Error ? error.message : "Erro ao excluir filamento.";
      toast.error(message);
    }
  };

  const handleReconcileStocks = async () => {
    if (!tenantId || filaments.length === 0) return;

    try {
      setIsReconciling(true);
      const batch = writeBatch(db);

      filaments.forEach((filament) => {
        const purchasedKg = getPurchasedKg(filament);
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

  const getFilamentSortValue = (filament: Filament, key: FilamentSortKey) => {
    switch (key) {
      case 'date':
        return getLatestPurchase(filament)?.purchaseDate || filament.purchaseDate || '';
      case 'price':
        return getAveragePricePerKg(filament);
      case 'purchased':
        return getPurchasedKg(filament);
      case 'stock':
        return getCurrentStockKg(filament);
      case 'material':
      default:
        return `${filament.material || ''} ${filament.color || ''} ${filament.lineType || ''}`.toLowerCase();
    }
  };

  const sortedFilaments = useMemo(() => {
    return [...filteredFilaments].sort((a, b) => {
      const valueA = getFilamentSortValue(a, sortKey);
      const valueB = getFilamentSortValue(b, sortKey);

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
      }

      const textA = String(valueA);
      const textB = String(valueB);
      return sortDirection === 'asc'
        ? textA.localeCompare(textB, 'pt-BR')
        : textB.localeCompare(textA, 'pt-BR');
    });
  }, [filteredFilaments, sortDirection, sortKey]);

  const handleSort = (key: FilamentSortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
      return;
    }

    setSortKey(key);
    setSortDirection('asc');
  };

  const getSortIndicator = (key: FilamentSortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const editingFilament = editingId ? filaments.find(f => f.id === editingId) : null;
  const editingCurrentStockKg = editingFilament
    ? getCurrentStockKg(editingFilament)
    : Math.max(0, Number(formData.stockKg) || 0);
  const editingFilamentUsage = useMemo(() => {
    if (!editingId) return [];

    return products
      .map(product => {
        const usage = calculateProductFilamentUsage(product)[editingId] || 0;
        return {
          productId: product.id,
          productName: product.name,
          usedKg: usage,
          usedGrams: usage * 1000,
        };
      })
      .filter(item => item.usedKg > 0)
      .sort((a, b) => b.usedKg - a.usedKg);
  }, [editingId, products]);

  const addPurchaseEntry = () => {
    setFormData(prev => ({
      ...prev,
      purchaseHistory: [...(prev.purchaseHistory || []), createBlankPurchase()]
    }));
  };

  const updatePurchaseEntry = (purchaseId: string, field: keyof FilamentPurchase, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      purchaseHistory: (prev.purchaseHistory || []).map(purchase =>
        purchase.id === purchaseId ? { ...purchase, [field]: value } : purchase
      )
    }));
  };

  const removePurchaseEntry = (purchaseId: string) => {
    setFormData(prev => {
      const nextPurchases = (prev.purchaseHistory || []).filter(purchase => purchase.id !== purchaseId);
      return {
        ...prev,
        purchaseHistory: nextPurchases.length > 0 ? nextPurchases : [createBlankPurchase()]
      };
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Catálogo de Filamentos</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Gerencie materiais, custos e níveis de estoque.</p>
        </div>
        <button 
          onClick={() => {
            setFormData({
              brand: '',
              material: 'PLA',
              lineType: 'Sólido (normal)',
              color: '',
              colorHex: '#000000',
              diameter: '1.75mm',
              pricePerKg: 0,
              stockKg: 0,
              purchaseDate: getLocalDateString(),
              store: '',
              supplierId: '',
              purchaseHistory: [createBlankPurchase()]
            });
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
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Total Comprado (Kg)</label>
              <input type="text" value={(formData.purchaseHistory || []).reduce((acc, purchase) => acc + (Number(purchase.quantityKg) || 0), 0).toFixed(2)} readOnly className="w-full bg-surface-container-low border-none rounded p-2 text-sm text-on-surface-variant tabular-nums cursor-not-allowed" />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Estoque Atual (Kg)</label>
              <input type="text" value={editingCurrentStockKg.toFixed(2)} readOnly className="w-full bg-surface-container-low border-none rounded p-2 text-sm text-on-surface-variant tabular-nums cursor-not-allowed" />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Preço Médio (R$/Kg)</label>
              <input type="text" value={getAveragePricePerKg(formData).toFixed(2)} readOnly className="w-full bg-surface-container-low border-none rounded p-2 text-sm text-on-surface-variant tabular-nums cursor-not-allowed" />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Última Compra</label>
              <input type="text" value={getLatestPurchase(formData)?.purchaseDate || '-'} readOnly className="w-full bg-surface-container-low border-none rounded p-2 text-sm text-on-surface-variant cursor-not-allowed" />
            </div>

            {editingId && (
              <div className="md:col-span-3 space-y-3 border border-outline-variant/20 rounded-xl p-4 bg-surface-container-low">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-on-surface">Produtos Vinculados</h4>
                    <p className="text-xs text-on-surface-variant">Visibilidade dos produtos que consomem este filamento e quanto cada um utiliza.</p>
                  </div>
                  <div className="text-xs font-bold text-on-surface-variant">
                    {editingFilamentUsage.length} produto(s) • {(usageByFilament[editingId] || 0).toFixed(3)} kg consumidos
                  </div>
                </div>

                {editingFilamentUsage.length === 0 ? (
                  <div className="text-sm text-on-surface-variant bg-surface-container rounded-lg p-3">
                    Nenhum produto cadastrado está usando este filamento no momento.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {editingFilamentUsage.map(item => (
                      <div key={item.productId} className="flex items-center justify-between gap-3 bg-surface-container rounded-lg p-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-on-surface truncate">{item.productName}</div>
                          <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Consumo registrado no cadastro do produto</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-bold text-primary tabular-nums">{item.usedKg.toFixed(3)} kg</div>
                          <div className="text-[10px] text-on-surface-variant tabular-nums">{item.usedGrams.toFixed(0)} g</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="md:col-span-3 space-y-3 border border-outline-variant/20 rounded-xl p-4 bg-surface-container-low">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-on-surface">Historico de Compras</h4>
                  <p className="text-xs text-on-surface-variant">Adicione novas compras desta cor/material e selecione o fornecedor cadastrado para manter o historico organizado.</p>
                </div>
                <button type="button" onClick={addPurchaseEntry} className="px-3 py-1.5 bg-primary text-on-primary rounded text-xs font-bold">
                  Adicionar Compra
                </button>
              </div>

              <div className="space-y-3">
                {(formData.purchaseHistory || []).map((purchase, index) => (
                  <div key={purchase.id} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end bg-surface-container rounded-lg p-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd (Kg)</label>
                      <input type="number" step="0.01" value={purchase.quantityKg || ''} onChange={e => updatePurchaseEntry(purchase.id, 'quantityKg', Number(e.target.value))} className="w-full bg-surface-container-lowest border-none rounded p-2 text-sm tabular-nums" placeholder="1.00" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Preco (R$/Kg)</label>
                      <input type="number" step="0.01" value={purchase.pricePerKg || ''} onChange={e => updatePurchaseEntry(purchase.id, 'pricePerKg', Number(e.target.value))} className="w-full bg-surface-container-lowest border-none rounded p-2 text-sm tabular-nums" placeholder="120.00" />
                    </div>
                    <div className="space-y-1">
                      <SearchableSelect
                        label="Fornecedor"
                        options={supplierOptions}
                        value={getPurchaseSupplierValue(purchase)}
                        onChange={(value) => handlePurchaseSupplierChange(purchase.id, value)}
                        placeholder={suppliers.length > 0 ? "Selecione um fornecedor" : "Cadastre em Fornecedores"}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data</label>
                      <input type="date" value={purchase.purchaseDate || ''} onChange={e => updatePurchaseEntry(purchase.id, 'purchaseDate', e.target.value)} className="w-full bg-surface-container-lowest border-none rounded p-2 text-sm" />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-on-surface-variant">
                        Compra {index + 1}
                      </div>
                      <button type="button" onClick={() => removePurchaseEntry(purchase.id)} className="p-2 text-error hover:bg-surface-container-lowest rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
        <input type="text" placeholder="Filtrar por fornecedor..." value={filterStore} onChange={e => setFilterStore(e.target.value)} className="bg-surface-container border-none rounded p-2 text-xs flex-1 min-w-[120px]" />
        
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
                <th className="px-6 py-3 cursor-pointer select-none" onClick={() => handleSort('material')}>
                  Material / Cor {getSortIndicator('material')}
                </th>
                <th className="px-6 py-3 cursor-pointer select-none" onClick={() => handleSort('date')}>
                  Data Compra {getSortIndicator('date')}
                </th>
                <th className="px-6 py-3 text-right cursor-pointer select-none" onClick={() => handleSort('price')}>
                  Custo (Kg) {getSortIndicator('price')}
                </th>
                <th className="px-6 py-3 text-right cursor-pointer select-none" onClick={() => handleSort('purchased')}>
                  Comprado {getSortIndicator('purchased')}
                </th>
                <th className="px-6 py-3 text-right cursor-pointer select-none" onClick={() => handleSort('stock')}>
                  Estoque Atual {getSortIndicator('stock')}
                </th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Vinculado</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {sortedFilaments.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-on-surface-variant">Nenhum filamento encontrado.</td>
                </tr>
              )}
              {sortedFilaments.map((f) => {
                const usedByProducts = products.filter(p => p.variations.some((v: any) => v.filamentId === f.id || (v.materials || []).some((m: any) => m.filamentId === f.id)));
                const currentStockKg = getCurrentStockKg(f);
                const purchasedKg = getPurchasedKg(f);
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
                    R$ {getAveragePricePerKg(f).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                    {purchasedKg.toFixed(2)} kg
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
                    <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(f);
                        }}
                        className="p-1.5 text-slate-400 hover:text-primary transition-colors rounded"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(f.id);
                        }}
                        className="p-1.5 text-slate-400 hover:text-error transition-colors rounded"
                      >
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
