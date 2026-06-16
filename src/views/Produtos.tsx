import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, MoreVertical, Box, Calculator, FileText, Layers, FileUp, Settings, Trash2, Save, TrendingUp, AlertTriangle, DollarSign, Target, Edit2, Upload, X, LayoutGrid, List, Search } from 'lucide-react';
import { collection, onSnapshot, updateDoc, deleteDoc, doc, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { SearchableSelect, SelectOption } from '../components/SearchableSelect';
import toast from 'react-hot-toast';
import { DEFAULT_PRICING_SETTINGS, type PricingSettings, calculateVariationUnitCostBreakdown, normalizePricingSettings } from '../utils/pricing';

function SearchableSelectFilament({ value, onChange, filaments, placeholder = "Buscar..." }: { value: string, onChange: (v: string) => void, filaments: Filament[], placeholder?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = filaments.find(f => f.id === value);
  const filtered = filaments.filter(f => `${f.material} ${f.color} ${f.brand || ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div 
        className="w-full bg-surface-container border-none rounded p-1.5 min-h-[30px] text-xs flex justify-between items-center cursor-pointer focus-within:ring-2 focus-within:ring-primary"
        onClick={() => { setIsOpen(!isOpen); setSearch(''); }}
      >
        <span className="truncate">{selected ? `${selected.material} ${selected.color}` : <span className="text-on-surface-variant">{placeholder}</span>}</span>
        <span className="text-on-surface-variant text-[10px] ml-1">▼</span>
      </div>
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-container-high rounded-lg shadow-xl z-50 border border-outline-variant/20 max-h-[300px] flex flex-col overflow-hidden">
          <input 
            type="text" 
            className="w-full p-2.5 text-xs bg-surface-container border-b border-outline-variant/20 outline-none text-on-surface" 
            placeholder="Buscar filamento..." 
            value={search}
            autoFocus 
            onChange={e => setSearch(e.target.value)}
          />
          <div className="overflow-y-auto w-full p-1" style={{ maxHeight: '200px' }}>
             <div 
              className="px-2 py-2 text-xs hover:bg-surface-container cursor-pointer text-on-surface-variant rounded flex gap-2 items-center"
              onClick={() => { onChange(''); setIsOpen(false); }}
             >
               <span className="text-error font-bold text-lg leading-none">×</span> Limpar Seleção
             </div>
            {filtered.map(f => (
              <div 
                key={f.id} 
                className="px-2 py-2 text-xs hover:bg-surface-container cursor-pointer flex items-center gap-2 rounded text-on-surface"
                onClick={() => { onChange(f.id); setIsOpen(false); }}
              >
                <div className="w-3 h-3 rounded-full shadow-sm border border-outline-variant/30 flex-shrink-0" style={{ backgroundColor: f.colorHex || '#ccc' }} />
                <span className="truncate">{f.material} {f.color} <span className="text-on-surface-variant text-[9px] ml-1">({f.brand || 'S/Marca'})</span></span>
              </div>
            ))}
            {filtered.length === 0 && <div className="px-2 py-3 text-xs text-on-surface-variant text-center">Nenhum encontrado</div>}
          </div>
        </div>
      )}
    </div>
  );
}

interface TechnicalSheet {
  dimensions: string;
  infillPercentage: number;
  layerHeight: number;
  supports: boolean;
  postProcessing: string;
}

interface ChannelPrice {
  channel: string;
  price: number;
  feePercentage: number;
}

interface Filament {
  id: string;
  sku: string;
  material: string;
  color: string;
  colorHex?: string;
  brand?: string;
  diameter: string;
  pricePerKg: number;
  stockKg: number;
}

interface Printer {
  id: string;
  name: string;
  model: string;
  acquisitionCost: number;
  lifespanHours: number;
  maintenanceBudget: number;
  powerConsumption: number;
}

interface VariationMaterial {
  id: string;
  filamentId: string;
  weightGrams: number;
  purgeGrams: number;
  objectName?: string;
  pieces?: number;
  printTimeHours?: number;
  startTime?: string;
  endTime?: string;
}

interface Variation {
  id: string;
  skuSuffix: string;
  color: string;
  material: string;
  materials?: VariationMaterial[];
  weightGrams: number;
  printTimeHours: number;
  startTime?: string;
  endTime?: string;
  quantityPerPrint: number;
  filamentId?: string;
  printerId?: string;
  materialCostPerGram: number;
  printerCostPerHour: number;
  channelPrices: ChannelPrice[];
}

interface ProductFile {
  id: string;
  name: string;
  type: 'STL' | 'GCODE' | '3MF' | 'STEP' | 'PDF';
  url: string;
  version: string;
}

interface ProductWaste {
  id: string;
  filamentId: string;
  weightGrams: number;
  includeInCost: boolean;
  notes: string;
}

interface Supply {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
  minStock: number;
}

interface ProductSupplyUsage {
  id: string;
  supplyId: string;
  supplyName: string;
  quantityPerProduct: number;
  unit: string;
}

interface ProductProductionFilament {
  id: string;
  filamentId: string;
  filamentName: string;
  quantityKg: number;
  productsCount?: number;
}

interface ProductProductionTable {
  id: string;
  tableName: string;
  scheduledAt: string;
  startAt?: string;
  endAt?: string;
  hours: number;
  productsCount: number;
  filaments: ProductProductionFilament[];
}

interface ProductionOrderFallback {
  id: string;
  productName: string;
  status: 'fila' | 'produzindo' | 'concluida';
  tables?: ProductProductionTable[];
  scheduledAt?: string;
  hoursPerTable?: number;
  filaments?: ProductProductionFilament[];
}

const padDateTimeSegment = (value: number) => String(value).padStart(2, '0');

const formatLocalDateTimeInput = (date: Date) => {
  return `${date.getFullYear()}-${padDateTimeSegment(date.getMonth() + 1)}-${padDateTimeSegment(date.getDate())}T${padDateTimeSegment(date.getHours())}:${padDateTimeSegment(date.getMinutes())}`;
};

const parseLocalDateTimeInput = (value?: string) => {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date;
};

const getLocalDateTimeString = (date = new Date()) => formatLocalDateTimeInput(new Date(date));

const formatLocalDateTimeLabel = (value?: string) => {
  const parsedDate = parseLocalDateTimeInput(value);
  if (!parsedDate) return '';
  return parsedDate.toLocaleString('pt-BR');
};

const addMinutesToDateTime = (startAt: string, minutes: number) => {
  const startDate = parseLocalDateTimeInput(startAt);
  if (!startDate) return '';
  return formatLocalDateTimeInput(new Date(startDate.getTime() + Math.max(0, minutes) * 60 * 1000));
};

const addHoursToDateTime = (startAt: string, hours: number) => {
  return addMinutesToDateTime(startAt, Math.round(Math.max(0, hours) * 60));
};

const calculateDateTimeMinutes = (startAt?: string, endAt?: string) => {
  const startDate = parseLocalDateTimeInput(startAt);
  const endDate = parseLocalDateTimeInput(endAt);
  if (!startDate || !endDate) return 0;
  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60));
};

const calculateDateTimeHours = (startAt?: string, endAt?: string) => {
  const diffMinutes = calculateDateTimeMinutes(startAt, endAt);
  return diffMinutes > 0 ? Number((diffMinutes / 60).toFixed(2)) : 0;
};

const getDurationMinutesFromHours = (hours?: number) => {
  return Math.max(0, Math.round((Number(hours) || 0) * 60));
};

const formatDurationLabel = (totalMinutes: number) => {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
};

const getTableDurationMinutes = (table: Pick<ProductProductionTable, 'startAt' | 'scheduledAt' | 'endAt' | 'hours'>) => {
  const startAt = table.startAt || table.scheduledAt || '';
  const diffMinutes = calculateDateTimeMinutes(startAt, table.endAt || '');
  if (diffMinutes > 0) return diffMinutes;
  return getDurationMinutesFromHours(table.hours);
};

const createProductFilamentEntry = (): ProductProductionFilament => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  filamentId: '',
  filamentName: '',
  quantityKg: 0,
});

const createProductTableEntry = (index = 1): ProductProductionTable => {
  const startAt = getLocalDateTimeString();
  const endAt = addHoursToDateTime(startAt, 1);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tableName: `Mesa ${index}`,
    scheduledAt: startAt,
    startAt,
    endAt,
    hours: 1,
    productsCount: 1,
    filaments: [createProductFilamentEntry()],
  };
};

const normalizeProductionOrderTable = (table: any, index: number): ProductProductionTable => {
  const startAt = table?.startAt || table?.scheduledAt || getLocalDateTimeString();
  const baseHours = Number(table?.hours) || Number(table?.hoursPerTable) || 0;
  const endAt = table?.endAt || addHoursToDateTime(startAt, baseHours || 1);
  const hours = calculateDateTimeHours(startAt, endAt) || baseHours;

  return {
    id: table?.id || `legacy-table-${index}`,
    tableName: table?.tableName || `Mesa ${index + 1}`,
    scheduledAt: startAt,
    startAt,
    endAt,
    hours,
    productsCount: Number(table?.productsCount) || (Array.isArray(table?.filaments)
      ? table.filaments.reduce((sum: number, item: any) => sum + (Number(item?.productsCount) || 0), 0)
      : 0) || 1,
    filaments: Array.isArray(table?.filaments) && table.filaments.length > 0
      ? table.filaments.map((item: any, itemIndex: number) => ({
          id: item?.id || `legacy-filament-${index}-${itemIndex}`,
          filamentId: item?.filamentId || '',
          filamentName: item?.filamentName || '',
          quantityKg: Number(item?.quantityKg) || 0,
        }))
      : [],
  };
};

const normalizeProductionOrderFallback = (order: ProductionOrderFallback): ProductionOrderFallback => {
  if (Array.isArray(order.tables) && order.tables.length > 0) {
    return {
      ...order,
      tables: order.tables.map((table, index) => normalizeProductionOrderTable(table, index)),
    };
  }

  return {
    ...order,
    tables: order.filaments && order.filaments.length > 0
      ? [{
          id: 'legacy-table-0',
          tableName: 'Mesa 1',
          scheduledAt: order.scheduledAt || getLocalDateTimeString(),
          hours: Number(order.hoursPerTable) || 0,
          productsCount: order.filaments.reduce((sum, item) => sum + (Number(item.productsCount) || 0), 0) || 1,
          filaments: order.filaments.map((item, index) => ({
            id: item.id || `legacy-filament-${index}`,
            filamentId: item.filamentId || '',
            filamentName: item.filamentName || '',
            quantityKg: Number(item.quantityKg) || 0,
          })),
        }]
      : [],
  };
};

interface Product {
  id: string;
  name: string;
  baseSku: string;
  category: string;
  status: 'ativo' | 'inativo' | 'desenvolvimento';
  fixedCost: number;
  stock?: number;
  imageUrl?: string;
  technicalSheet: TechnicalSheet;
  variations: Variation[];
  files: ProductFile[];
  wastes?: ProductWaste[];
  supplyUsages?: ProductSupplyUsage[];
  productionTables?: ProductProductionTable[];
  latestSuggestedPrice?: {
    savedAt?: string;
    channelName?: string;
    variationLabel?: string;
    suggestedPrice?: number;
  };
  pricingHistory?: Array<{
    id: string;
    savedAt: string;
    variationId: string;
    variationLabel: string;
    channelId: string;
    channelName: string;
    targetType: string;
    targetValue: number;
    suggestedPrice: number;
    cost: number;
    profit: number;
    margin: number;
  }>;
}

type ProductSortKey = 'name' | 'category' | 'status' | 'stock' | 'cost';

const mockProducts: Product[] = [
  { 
    id: '1', 
    name: 'Suporte de Fone (Mesa)', 
    baseSku: 'SUP-FONE', 
    category: 'Acessórios', 
    fixedCost: 2.00,
    status: 'ativo',
    imageUrl: '',
    technicalSheet: { dimensions: '150x100x200mm', infillPercentage: 15, layerHeight: 0.2, supports: false, postProcessing: 'Nenhum' },
    variations: [
      { 
        id: 'v1', skuSuffix: '-BLK-PLA', color: 'Preto', material: 'PLA', weightGrams: 120, printTimeHours: 3, quantityPerPrint: 2,
        materialCostPerGram: 0.12, printerCostPerHour: 1.50,
        channelPrices: [
          { channel: 'Mercado Livre', price: 39.90, feePercentage: 16 },
          { channel: 'Shopee', price: 34.90, feePercentage: 14 },
          { channel: 'Site Próprio', price: 29.90, feePercentage: 5 }
        ]
      },
      { 
        id: 'v2', skuSuffix: '-WHT-PETG', color: 'Branco', material: 'PETG', weightGrams: 125, printTimeHours: 3.5, quantityPerPrint: 1,
        materialCostPerGram: 0.135, printerCostPerHour: 1.50,
        channelPrices: [
          { channel: 'Mercado Livre', price: 44.90, feePercentage: 16 },
          { channel: 'Shopee', price: 39.90, feePercentage: 14 }
        ]
      }
    ],
    files: [
      { id: 'f1', name: 'base_v2.stl', type: 'STL', url: '#', version: '2.0' }
    ]
  }
];

interface ProdutosProps {
  mode?: 'list' | 'editor';
  editorMode?: 'new' | 'edit';
  editorProductId?: string | null;
  onOpenEditor?: (mode: 'new' | 'edit', productId?: string | null) => void;
  onCloseEditor?: () => void;
}

export function Produtos({
  mode = 'list',
  editorMode = 'new',
  editorProductId = null,
  onOpenEditor,
  onCloseEditor,
}: ProdutosProps) {
  const { tenantId } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [productionOrders, setProductionOrders] = useState<ProductionOrderFallback[]>([]);
  const [filaments, setFilaments] = useState<Filament[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [energyPrice, setEnergyPrice] = useState<number>(0.95);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(DEFAULT_PRICING_SETTINGS);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [openTableIds, setOpenTableIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic');
  const [advancedTab, setAdvancedTab] = useState<'tech' | 'variations' | 'wastes' | 'intelligence' | 'files'>('tech');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [sortKey, setSortKey] = useState<ProductSortKey>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDateStart, setFilterDateStart] = useState<string>('');
  const [filterDateEnd, setFilterDateEnd] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const editorInitKeyRef = useRef<string>('');

  const handleTimeCalculate = (start: string, end: string, onChangeTotal: (hrs: number) => void) => {
    if (!start || !end) return;
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    if (!isNaN(h1) && !isNaN(m1) && !isNaN(h2) && !isNaN(m2)) {
      let diffMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (diffMinutes < 0) diffMinutes += 24 * 60;
      const hours = Number((diffMinutes / 60).toFixed(2));
      onChangeTotal(hours);
    }
  };

  const defaultVariation = {
    id: Date.now().toString(), skuSuffix: '', color: 'Padrão', material: 'PLA', weightGrams: 0, printTimeHours: 0, quantityPerPrint: 1,
    filamentId: '', printerId: '',
    materials: [],
    materialCostPerGram: 0.12, printerCostPerHour: 1.50,
    channelPrices: [
      { channel: 'Venda Direta', price: 0, feePercentage: 0 }
    ]
  };

  // Form State
  const [formData, setFormData] = useState<Partial<Product>>({
    status: 'desenvolvimento',
    fixedCost: 0,
    imageUrl: '',
    technicalSheet: { dimensions: '', infillPercentage: 15, layerHeight: 0.2, supports: false, postProcessing: '' },
    variations: [defaultVariation],
    files: [],
    wastes: [],
    supplyUsages: [],
    productionTables: [createProductTableEntry(1)],
  });

  const parseLocaleNumber = (value: string) => {
    const normalized = value.replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const resetProductForm = () => {
    setFormData({
      status: 'desenvolvimento',
      fixedCost: 0,
      imageUrl: '',
      technicalSheet: { dimensions: '', infillPercentage: 15, layerHeight: 0.2, supports: false, postProcessing: '' },
      variations: [{ ...defaultVariation, id: Date.now().toString() }],
      files: [],
      wastes: [],
      supplyUsages: [],
      productionTables: [createProductTableEntry(1)],
    });
    setEditingId(null);
    setOpenTableIds([]);
    setActiveTab('basic');
  };

  const loadProductIntoForm = (product: Product) => {
    const prioritizedProduct = prioritizeScheduledVariations(product);
    const editableTables = ensureEditableProductionTables(
      prioritizedProduct.productionTables && prioritizedProduct.productionTables.length > 0
        ? prioritizedProduct.productionTables
        : getProductProductionTables(prioritizedProduct),
    );

    setFormData({
      ...prioritizedProduct,
      productionTables: editableTables,
    });
    setEditingId(product.id);
    setOpenTableIds(editableTables.map(table => table.id));
    setShowForm(true);
    setActiveTab('basic');
  };

  const closeProductForm = () => {
    if (mode === 'editor' && onCloseEditor) {
      onCloseEditor();
      return;
    }
    setShowForm(false);
    resetProductForm();
  };

  const openNewProductForm = () => {
    if (onOpenEditor) {
      onOpenEditor('new');
      return;
    }
    resetProductForm();
    setShowForm(true);
  };

  const supplyOptions: SelectOption[] = useMemo(() => {
    return supplies.map(supply => ({
      value: supply.id,
      label: supply.name,
      group: supply.category || 'Insumos',
    }));
  }, [supplies]);

  useEffect(() => {
    if (mode !== 'editor') {
      editorInitKeyRef.current = '';
      setShowForm(false);
      return;
    }

    const editorKey = `${editorMode}:${editorProductId || 'new'}`;
    if (editorInitKeyRef.current === editorKey) return;

    if (editorMode === 'new') {
      resetProductForm();
      setShowForm(true);
      editorInitKeyRef.current = editorKey;
      return;
    }

    if (editorMode === 'edit' && editorProductId) {
      const product = products.find(item => item.id === editorProductId);
      if (!product) return;
      loadProductIntoForm(product);
      editorInitKeyRef.current = editorKey;
    }
  }, [mode, editorMode, editorProductId, products]);

  const buildVariationFromProductionTables = (tables: ProductProductionTable[], baseVariation?: Variation): Variation => {
    const materials = tables.flatMap((table, tableIndex) =>
      (table.filaments || [])
        .filter(item => item.filamentId)
          .map((item, filamentIndex) => ({
          id: item.id || `${table.id}-${filamentIndex}`,
          filamentId: item.filamentId,
          weightGrams: Number((Number(item.quantityKg || 0) * 1000).toFixed(2)),
          purgeGrams: 0,
          objectName: table.tableName || `Mesa ${tableIndex + 1}`,
          pieces: filamentIndex === 0 ? (Number(table.productsCount) || 0) : 0,
          printTimeHours: Number(table.hours) || 0,
          startTime: table.startAt || table.scheduledAt || '',
          endTime: table.endAt || '',
        })),
    );

    const firstFilament = filaments.find(item => item.id === materials[0]?.filamentId);
    const totalWeightGrams = materials.reduce((sum, item) => sum + (Number(item.weightGrams) || 0), 0);
    const totalHours = tables.reduce((sum, table) => sum + (Number(table.hours) || 0), 0);
    const totalPieces = tables.reduce((sum, table) => sum + (Number(table.productsCount) || 0), 0);

    return {
      ...(baseVariation || defaultVariation),
      id: baseVariation?.id || Date.now().toString(),
      color: baseVariation?.color || firstFilament?.color || 'Padrão',
      material: baseVariation?.material || firstFilament?.material || 'PLA',
      materials,
      weightGrams: Number(totalWeightGrams.toFixed(2)),
      printTimeHours: Number(totalHours.toFixed(2)),
      quantityPerPrint: totalPieces > 0 ? totalPieces : 1,
      filamentId: materials[0]?.filamentId || '',
    };
  };

  const livePrimaryVariation = useMemo(() => {
    const baseVariation = (formData.variations || [])[0];
    if (formData.productionTables && formData.productionTables.length > 0) {
      return buildVariationFromProductionTables(formData.productionTables, baseVariation);
    }
    return baseVariation || defaultVariation;
  }, [formData.productionTables, formData.variations, filaments]);

  const liveFormProduct = useMemo(() => {
    const variations = formData.variations && formData.variations.length > 0
      ? [livePrimaryVariation, ...(formData.variations || []).slice(1)]
      : [livePrimaryVariation];
    return {
      ...formData,
      variations,
    } as Partial<Product>;
  }, [formData, livePrimaryVariation]);

  useEffect(() => {
    if (!tenantId) return;

    const unsubscribeProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(data);
    }, (error) => {
      console.error("Error fetching products:", error);
    });

    const unsubscribeProductionOrders = onSnapshot(collection(db, `tenants/${tenantId}/productionOrders`), (snapshot) => {
      const data = snapshot.docs.map(doc => normalizeProductionOrderFallback({ id: doc.id, ...doc.data() } as ProductionOrderFallback));
      setProductionOrders(data);
    }, (error) => {
      console.error("Error fetching production orders:", error);
    });

    const unsubscribeFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Filament));
      setFilaments(data);
    }, (error) => {
      console.error("Error fetching filaments:", error);
    });

    const unsubscribeSupplies = onSnapshot(collection(db, `tenants/${tenantId}/supplies`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supply));
      setSupplies(data);
    }, (error) => {
      console.error("Error fetching supplies:", error);
    });

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

    const unsubscribePricingSettings = onSnapshot(doc(db, `tenants/${tenantId}/settings/pricing`), (docSnap) => {
      setPricingSettings(normalizePricingSettings(docSnap.exists() ? (docSnap.data() as Partial<PricingSettings>) : null));
    });

    return () => {
      unsubscribeProducts();
      unsubscribeProductionOrders();
      unsubscribeFilaments();
      unsubscribeSupplies();
      unsubscribePrinters();
      unsubscribeSettings();
      unsubscribePricingSettings();
    };
  }, [tenantId]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchSearch = !searchTerm.trim() || (p.name || '').toLowerCase().includes(searchTerm.trim().toLowerCase());
      const matchCategory = filterCategories.length === 0 || filterCategories.includes(p.category);
      const matchStatus = filterStatus === 'all' || p.status === filterStatus;
      
      let matchDate = true;
      if (filterDateStart || filterDateEnd) {
        const pDate = p.createdAt ? p.createdAt.split('T')[0] : '';
        if (filterDateStart && pDate < filterDateStart) matchDate = false;
        if (filterDateEnd && pDate > filterDateEnd) matchDate = false;
      }

      return matchSearch && matchCategory && matchStatus && matchDate;
    });
  }, [products, searchTerm, filterCategories, filterStatus, filterDateStart, filterDateEnd]);

  const getProductSortValue = (product: Product, key: ProductSortKey) => {
    switch (key) {
      case 'category':
        return (product.category || '').toLowerCase();
      case 'status':
        return (product.status || '').toLowerCase();
      case 'stock':
        return getProductStockInfo(product).complete || 0;
      case 'cost':
        return Number(product.fixedCost) || 0;
      case 'name':
      default:
        return (product.name || '').toLowerCase();
    }
  };

  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      const valueA = getProductSortValue(a, sortKey);
      const valueB = getProductSortValue(b, sortKey);

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
      }

      const textA = String(valueA);
      const textB = String(valueB);
      return sortDirection === 'asc'
        ? textA.localeCompare(textB, 'pt-BR')
        : textB.localeCompare(textA, 'pt-BR');
    });
  }, [filteredProducts, sortDirection, sortKey]);

  const handleSort = (key: ProductSortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
      return;
    }

    setSortKey(key);
    setSortDirection('asc');
  };

  const getSortIndicator = (key: ProductSortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const uniqueCategories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean));
    return Array.from(cats);
  }, [products]);

  const calculateFilamentUsageMap = (formState: Partial<Product>): Record<string, number> => {
    const usage: Record<string, number> = {};
    const vars = formState.variations || [];
    for (const v of vars) {
      const yieldPerBatch = Math.max(1, v.quantityPerPrint || 1); // Peças por impressão
      if (v.materials && v.materials.length > 0) {
        for (const mat of v.materials) {
          if (mat.filamentId) {
            const stockPieces = mat.pieces || 0; 
            // Se indicou pesos na ficha, assume-se pelo menos 1 lote de produção de teste (1 batch).
            const batches = stockPieces > 0 ? Math.ceil(stockPieces / yieldPerBatch) : 1;
            const w = (((mat.weightGrams || 0) + (mat.purgeGrams || 0)) * batches) / 1000;
            usage[mat.filamentId] = (usage[mat.filamentId] || 0) + w;
          }
        }
      } else if (v.filamentId) {
        // Fallback da aba básica (sempre conta 1 lote ao ser criado/existir)
        const batches = 1; 
        const w = ((v.weightGrams || 0) * batches) / 1000;
        usage[v.filamentId] = (usage[v.filamentId] || 0) + w;
      }
    }
    const wastes = formState.wastes || [];
    for (const w of wastes) {
      if (w.filamentId) {
        const wght = (w.weightGrams || 0) / 1000;
        usage[w.filamentId] = (usage[w.filamentId] || 0) + wght;
      }
    }
    return usage;
  };

  const calculateSupplyUsageMap = (formState: Partial<Product>) => {
    const usage: Record<string, number> = {};
    const totalProducts = getProductStockInfo(formState).complete || 0;
    (formState.supplyUsages || []).forEach(supplyUsage => {
      if (!supplyUsage.supplyId) return;
      usage[supplyUsage.supplyId] = (usage[supplyUsage.supplyId] || 0) + ((Number(supplyUsage.quantityPerProduct) || 0) * totalProducts);
    });
    return usage;
  };

  const handleSave = async () => {
    if (!tenantId) return;

    try {
      const sanitizedProductionTables = (formData.productionTables || []).map((table, index) => ({
        id: table.id,
        tableName: table.tableName || `Mesa ${index + 1}`,
        scheduledAt: table.startAt || table.scheduledAt || getLocalDateTimeString(),
        startAt: table.startAt || table.scheduledAt || getLocalDateTimeString(),
        endAt: table.endAt || addMinutesToDateTime(
          table.startAt || table.scheduledAt || getLocalDateTimeString(),
          getTableDurationMinutes(table) || 60,
        ),
        hours: calculateDateTimeHours(
          table.startAt || table.scheduledAt || getLocalDateTimeString(),
          table.endAt || addMinutesToDateTime(
            table.startAt || table.scheduledAt || getLocalDateTimeString(),
            getTableDurationMinutes(table) || 60,
          ),
        ) || Number(table.hours) || 0,
        productsCount: Number(table.productsCount) || 1,
        filaments: (table.filaments || [])
          .map(item => {
            const filament = filaments.find(f => f.id === item.filamentId);
            return {
              ...item,
              filamentId: item.filamentId || '',
              filamentName: item.filamentName || (filament ? `${filament.material} ${filament.color}` : ''),
              quantityKg: Number(item.quantityKg) || 0,
            };
          })
          .filter(item => item.filamentId),
      }));

      const sourceVariations = sanitizedProductionTables.length > 0
        ? [
            buildVariationFromProductionTables(
              sanitizedProductionTables,
              (formData.variations || [])[0],
            ),
            ...(formData.variations || []).slice(1),
          ]
        : (formData.variations || []);

      const sanitizedVariations = sourceVariations.map(v => ({
        ...v,
        filamentId: v.filamentId || '',
        printerId: v.printerId || '',
        materials: (v.materials || []).map(m => ({
          ...m,
          objectName: m.objectName || ''
        }))
      }));

      const sanitizedWastes = (formData.wastes || []).map(w => ({
        id: w.id || Date.now().toString(),
        filamentId: w.filamentId || '',
        weightGrams: Number.isFinite(Number(w.weightGrams)) ? Number(w.weightGrams) : 0,
        includeInCost: !!w.includeInCost,
        notes: w.notes || ''
      }));

      const sanitizedSupplyUsages = (formData.supplyUsages || []).map(supplyUsage => {
        const currentSupply = supplies.find(item => item.id === supplyUsage.supplyId);
        return {
          id: supplyUsage.id || Date.now().toString(),
          supplyId: supplyUsage.supplyId || '',
          supplyName: supplyUsage.supplyName || currentSupply?.name || '',
          quantityPerProduct: Number(supplyUsage.quantityPerProduct) || 0,
          unit: supplyUsage.unit || currentSupply?.unit || 'un',
        };
      }).filter(supplyUsage => supplyUsage.supplyId && supplyUsage.quantityPerProduct > 0);

      const cleanUndefined = (obj: any): any => {
        if (Array.isArray(obj)) return obj.map(cleanUndefined).filter(x => x !== undefined);
        if (obj !== null && typeof obj === 'object') {
          return Object.fromEntries(
            Object.entries(obj)
              .filter(([_, v]) => v !== undefined)
              .map(([k, v]) => [k, cleanUndefined(v)])
          );
        }
        return obj;
      };

      const dataToSave = cleanUndefined({
        name: formData.name || '',
        baseSku: formData.baseSku || '',
        category: formData.category || '',
        status: formData.status || 'desenvolvimento',
        fixedCost: Number(formData.fixedCost) || 0,
        stock: getProductStockInfo({ ...formData, variations: sanitizedVariations }).complete,
        imageUrl: formData.imageUrl || '',
        technicalSheet: formData.technicalSheet || { dimensions: '', infillPercentage: 15, layerHeight: 0.2, supports: false, postProcessing: '' },
        variations: sanitizedVariations,
        files: formData.files || [],
        wastes: sanitizedWastes,
        supplyUsages: sanitizedSupplyUsages,
        productionTables: sanitizedProductionTables,
      });

      // Stock diff calculation
      const oldProduct = editingId ? products.find(p => p.id === editingId) : null;
      const oldUsage = oldProduct ? calculateFilamentUsageMap(oldProduct) : {};
      const newUsage = calculateFilamentUsageMap(dataToSave);
      const oldSupplyUsage = oldProduct ? calculateSupplyUsageMap(oldProduct) : {};
      const newSupplyUsage = calculateSupplyUsageMap(dataToSave);
      
      const deltaUsage: Record<string, number> = {};
      const allFilaments = new Set([...Object.keys(oldUsage), ...Object.keys(newUsage)]);
      allFilaments.forEach(id => {
        const delta = (newUsage[id] || 0) - (oldUsage[id] || 0);
        if (delta !== 0) deltaUsage[id] = delta;
      });

      const deltaSupplyUsage: Record<string, number> = {};
      const allSupplies = new Set([...Object.keys(oldSupplyUsage), ...Object.keys(newSupplyUsage)]);
      allSupplies.forEach(id => {
        const delta = (newSupplyUsage[id] || 0) - (oldSupplyUsage[id] || 0);
        if (delta !== 0) deltaSupplyUsage[id] = delta;
      });

      const batch = writeBatch(db);
      const productRef = editingId
        ? doc(db, `tenants/${tenantId}/products`, editingId)
        : doc(collection(db, `tenants/${tenantId}/products`));

      if (editingId) {
        batch.update(productRef, dataToSave);
      } else {
        batch.set(productRef, {
          ...dataToSave,
          createdAt: new Date().toISOString()
        });

        // Logs de purga apenas na criação para simplificar a auditoria
        for (const variation of sanitizedVariations) {
          const yieldPerBatch = Math.max(1, variation.quantityPerPrint || 1);
          if (variation.materials && variation.materials.length > 0) {
            for (const mat of variation.materials) {
              const filament = filaments.find(f => f.id === mat.filamentId);
              if (filament && mat.purgeGrams && mat.purgeGrams > 0) {
                const stockPieces = mat.pieces || 0;
                const batches = stockPieces > 0 ? Math.ceil(stockPieces / yieldPerBatch) : 1;
                if (batches > 0) {
                  const costPerGram = filament.pricePerKg / 1000;
                  const purgeCost = (mat.purgeGrams * batches) * costPerGram;
                  const lossRef = doc(collection(db, `tenants/${tenantId}/losses`));
                  batch.set(lossRef, {
                    date: new Date().toISOString(),
                    type: 'purga',
                    weightGrams: mat.purgeGrams * batches,
                    filamentId: filament.id,
                    filamentName: `${filament.material} ${filament.color}`,
                    cost: purgeCost,
                    notes: `Purga gerada no lote do produto ${dataToSave.name}`,
                    productId: productRef.id,
                  });
                }
              }
            }
          }
        }
      }

      // Aplica o diff no estoque de filamentos (vale pra criação e edição)
      for (const [fId, delta] of Object.entries(deltaUsage)) {
        const filament = filaments.find(f => f.id === fId);
        if (filament) {
          batch.update(doc(db, `tenants/${tenantId}/filaments`, filament.id), {
            stockKg: Math.max(0, (filament.stockKg || 0) - delta)
          });
        }
      }

      for (const [supplyId, delta] of Object.entries(deltaSupplyUsage)) {
        const supply = supplies.find(item => item.id === supplyId);
        if (supply) {
          batch.update(doc(db, `tenants/${tenantId}/supplies`, supply.id), {
            quantity: Math.max(0, (Number(supply.quantity) || 0) - delta),
          });
        }
      }

      await batch.commit();

      closeProductForm();
      toast.success(editingId ? "Produto salvo com sucesso!" : "Novo produto adicionado e materiais deduzidos!");
    } catch (error: any) {
      console.error("Error saving product:", error);
      toast.error(`Erro: ${error.message || 'Desconhecido'}`);
    }
  };

  const handleEdit = (p: Product) => {
    if (onOpenEditor) {
      onOpenEditor('edit', p.id);
      return;
    }
    loadProductIntoForm(p);
  };

  const handleDelete = async (id: string) => {
    if (!tenantId) return;
    try {
      const productToDelete = products.find(p => p.id === id);
      
      if (productToDelete) {
        const batch = writeBatch(db);

        // Restaurar estoque de filamentos
        const usageToReturn = calculateFilamentUsageMap(productToDelete);
        const supplyUsageToReturn = calculateSupplyUsageMap(productToDelete);
        for (const [fId, amount] of Object.entries(usageToReturn)) {
            const filament = filaments.find(f => f.id === fId);
            if (filament) {
              batch.update(doc(db, `tenants/${tenantId}/filaments`, filament.id), {
                stockKg: (filament.stockKg || 0) + amount
              });
            }
        }

        for (const [supplyId, amount] of Object.entries(supplyUsageToReturn)) {
          const supply = supplies.find(item => item.id === supplyId);
          if (supply) {
            batch.update(doc(db, `tenants/${tenantId}/supplies`, supply.id), {
              quantity: (Number(supply.quantity) || 0) + amount,
            });
          }
        }

        for (const variation of productToDelete.variations) {
          // Restore print hours
          if (variation.printerId && variation.printTimeHours) {
             const printer = printers.find(p => p.id === variation.printerId);
             if (printer && printer.usedHours) {
               let totalHoursUsed = 0;
               if (variation.materials && variation.materials.some(m => m.printTimeHours !== undefined)) {
                 totalHoursUsed = variation.materials.reduce((sum, mat) => sum + (mat.printTimeHours || 0), 0);
               } else {
                 totalHoursUsed = variation.printTimeHours;
               }

               await updateDoc(doc(db, `tenants/${tenantId}/printers`, printer.id), {
                 usedHours: Math.max(0, printer.usedHours - totalHoursUsed)
               });
             }
          }
        }

        // Excluir registros de perdas (purgas) associados a este produto
        const lossesQuery = query(collection(db, `tenants/${tenantId}/losses`), where("productId", "==", id));
        const lossesSnapshot = await getDocs(lossesQuery);
        lossesSnapshot.docs.forEach(lossDoc => {
          batch.delete(doc(db, `tenants/${tenantId}/losses`, lossDoc.id));
        });

        batch.delete(doc(db, `tenants/${tenantId}/products`, id));
        await batch.commit();
      } else {
        await deleteDoc(doc(db, `tenants/${tenantId}/products`, id));
      }
      setDeleteTargetId(null);
      toast.success("Produto excluído com sucesso!");
    } catch (error) {
      console.error("Error deleting product:", error);
      toast.error("Erro ao excluir produto.");
    }
  };

  const requestDelete = (id: string) => {
    setDeleteTargetId(id);
  };

  const addVariation = () => {
    setFormData(prev => ({
      ...prev,
      variations: [...(prev.variations || []), { 
        id: Date.now().toString(), skuSuffix: '', color: '', material: 'PLA', weightGrams: 0, printTimeHours: 0, quantityPerPrint: 1,
        filamentId: '', printerId: '',
        materials: [],
        materialCostPerGram: 0.12, printerCostPerHour: 1.50,
        channelPrices: [
          { channel: 'Mercado Livre', price: 0, feePercentage: 16 },
          { channel: 'Shopee', price: 0, feePercentage: 14 }
        ]
      }]
    }));
  };

  const removeVariation = (id: string) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations?.filter(v => v.id !== id)
    }));
  };

  const updateVariation = (id: string, field: keyof Variation, value: any) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations?.map(v => v.id === id ? { ...v, [field]: value } : v)
    }));
  };

  const updateVariationFields = (id: string, updates: Partial<Variation>) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations?.map(v => v.id === id ? { ...v, ...updates } : v)
    }));
  };

  const addMaterialToVariation = (variationId: string) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations?.map(v => {
        if (v.id === variationId) {
          return {
            ...v,
            materials: [...(v.materials || []), { id: Date.now().toString(), filamentId: '', weightGrams: 0, purgeGrams: 0, objectName: '', pieces: 0 }]
          };
        }
        return v;
      })
    }));
  };

  const removeMaterial = (variationId: string, materialId: string) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations?.map(v => {
        if (v.id === variationId) {
          const updatedMaterials = (v.materials || []).filter(m => m.id !== materialId);
          let updatedVariation = {
            ...v,
            materials: updatedMaterials
          };
          if (updatedMaterials.length > 0 && updatedMaterials.some(m => m.printTimeHours !== undefined)) {
             updatedVariation.printTimeHours = Number(updatedMaterials.reduce((sum, mat) => sum + (mat.printTimeHours || 0), 0).toFixed(2));
          } else if (updatedMaterials.length === 0) {
             updatedVariation.printTimeHours = 0;
          }
          
          let qty = 1;
          if (updatedMaterials.length > 0 && updatedMaterials.some(m => m.pieces !== undefined)) {
             const groups: Record<string, number> = {};
             updatedMaterials.forEach(m => {
               let key = (m.objectName || '').trim().toLowerCase() || m.id;
               groups[key] = (groups[key] || 0) + (m.pieces || 0);
             });
             const groupValues = Object.values(groups);
             if (groupValues.length > 0) {
                 qty = Math.max(1, Math.min(...groupValues));
             }
          }
          updatedVariation.quantityPerPrint = qty;
          return updatedVariation;
        }
        return v;
      })
    }));
  };

  const updateMaterial = (variationId: string, materialId: string, field: keyof VariationMaterial, value: any) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations?.map(v => {
        if (v.id === variationId) {
          const updatedMaterials = (v.materials || []).map(m => m.id === materialId ? { ...m, [field]: value } : m);
          
          let updatedVariation = {
            ...v,
            materials: updatedMaterials
          };

          // Automatically sum print time if any material has printTimeHours defined
          if (updatedMaterials.some(m => m.printTimeHours !== undefined)) {
             updatedVariation.printTimeHours = Number(updatedMaterials.reduce((sum, mat) => sum + (mat.printTimeHours || 0), 0).toFixed(2));
          }
          
          // Auto calculate quantity per print
          if (updatedMaterials.some(m => m.pieces !== undefined)) {
             const groups: Record<string, number> = {};
             updatedMaterials.forEach(m => {
               let key = (m.objectName || '').trim().toLowerCase() || m.id;
               groups[key] = (groups[key] || 0) + (m.pieces || 0);
             });
             const groupValues = Object.values(groups);
             if (groupValues.length > 0) {
                 updatedVariation.quantityPerPrint = Math.max(1, Math.min(...groupValues));
             }
          }
          
          return updatedVariation;
        }
        return v;
      })
    }));
  };

  const handlePrinterChange = (variationId: string, printerId: string) => {
    const printer = printers.find(p => p.id === printerId);
    if (printer && printer.lifespanHours > 0) {
      const depreciation = (printer.acquisitionCost + printer.maintenanceBudget) / printer.lifespanHours;
      const energy = (printer.powerConsumption || 0) * energyPrice;
      const costPerHour = depreciation + energy;
      updateVariationFields(variationId, {
        printerId,
        printerCostPerHour: costPerHour
      });
    } else {
      updateVariationFields(variationId, { printerId: '' });
    }
  };

  const updateChannelPrice = (variationId: string, channelName: string, price: number) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations?.map(v => {
        if (v.id !== variationId) return v;
        const currentPrices = v.channelPrices || [{ channel: channelName, price: 0, feePercentage: 0 }];
        const channelExists = currentPrices.some(cp => cp.channel === channelName);
        
        return {
          ...v,
          channelPrices: channelExists 
            ? currentPrices.map(cp => cp.channel === channelName ? { ...cp, price } : cp)
            : [...currentPrices, { channel: channelName, price, feePercentage: 0 }]
        };
      })
    }));
  };

  const addSupplyUsage = () => {
    setFormData(prev => ({
      ...prev,
      supplyUsages: [
        ...(prev.supplyUsages || []),
        { id: Date.now().toString(), supplyId: '', supplyName: '', quantityPerProduct: 1, unit: 'un' },
      ],
    }));
  };

  const updateSupplyUsage = (usageId: string, field: keyof ProductSupplyUsage, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      supplyUsages: (prev.supplyUsages || []).map(usage => {
        if (usage.id !== usageId) return usage;

        if (field === 'supplyId') {
          const selectedSupply = supplies.find(item => item.id === value);
          return {
            ...usage,
            supplyId: String(value),
            supplyName: selectedSupply?.name || '',
            unit: selectedSupply?.unit || usage.unit || 'un',
          };
        }

        return {
          ...usage,
          [field]: field === 'quantityPerProduct' ? Number(value) || 0 : value,
        };
      }),
    }));
  };

  const removeSupplyUsage = (usageId: string) => {
    setFormData(prev => ({
      ...prev,
      supplyUsages: (prev.supplyUsages || []).filter(usage => usage.id !== usageId),
    }));
  };

  const updateProductionTable = (tableId: string, field: keyof ProductProductionTable, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      productionTables: (prev.productionTables || []).map(table => {
        if (table.id !== tableId) return table;

        const updatedTable = { ...table, [field]: value } as ProductProductionTable;
        const startAt = updatedTable.startAt || updatedTable.scheduledAt || '';

        if (field === 'startAt') {
          updatedTable.scheduledAt = String(value);
        }

        if (field === 'hours') {
          const numericHours = Number(value) || 0;
          updatedTable.hours = numericHours;
          updatedTable.endAt = startAt ? addHoursToDateTime(startAt, numericHours) : updatedTable.endAt;
          return updatedTable;
        }

        if (field === 'startAt' || field === 'endAt' || field === 'scheduledAt') {
          const normalizedStartAt = field === 'scheduledAt' ? String(value) : (updatedTable.startAt || updatedTable.scheduledAt || '');
          const normalizedEndAt = updatedTable.endAt || '';
          updatedTable.startAt = normalizedStartAt;
          updatedTable.scheduledAt = normalizedStartAt;
          updatedTable.hours = calculateDateTimeHours(normalizedStartAt, normalizedEndAt);
        }

        return updatedTable;
      }),
    }));
  };

  const addProductionTable = () => {
    const newTable = createProductTableEntry((formData.productionTables || []).length + 1);
    setFormData(prev => ({
      ...prev,
      productionTables: [...(prev.productionTables || []), newTable],
    }));
    setOpenTableIds(prev => [...prev, newTable.id]);
  };

  const removeProductionTable = (tableId: string) => {
    setFormData(prev => {
      const currentTables = prev.productionTables || [];
      return {
        ...prev,
        productionTables: currentTables.length > 1
          ? currentTables.filter(table => table.id !== tableId)
          : [createProductTableEntry(1)],
      };
    });
    setOpenTableIds(prev => prev.filter(id => id !== tableId));
  };

  const updateProductionFilament = (tableId: string, entryId: string, field: keyof ProductProductionFilament, value: string | number) => {
    setFormData(prev => ({
      ...prev,
          productionTables: (prev.productionTables || []).map(table => {
            if (table.id !== tableId) return table;
            return {
              ...table,
              filaments: table.filaments.map(entry => {
            if (entry.id !== entryId) return entry;
            if (field === 'filamentId') {
              const filament = filaments.find(item => item.id === value);
              return {
                ...entry,
                filamentId: String(value),
                filamentName: filament ? `${filament.material} ${filament.color}` : '',
              };
            }
            return { ...entry, [field]: value };
          }),
        };
      }),
    }));
  };

  const addProductionFilament = (tableId: string) => {
    setFormData(prev => ({
      ...prev,
      productionTables: (prev.productionTables || []).map(table => table.id === tableId
        ? { ...table, filaments: [...table.filaments, createProductFilamentEntry()] }
        : table),
    }));
  };

  const removeProductionFilament = (tableId: string, entryId: string) => {
    setFormData(prev => ({
      ...prev,
      productionTables: (prev.productionTables || []).map(table => {
        if (table.id !== tableId) return table;
        const nextFilaments = table.filaments.length > 1
          ? table.filaments.filter(entry => entry.id !== entryId)
          : [createProductFilamentEntry()];
        return { ...table, filaments: nextFilaments };
      }),
    }));
  };

  // --- ESTOQUE CALCULATION ---
  const getProductStockInfo = (product: Product | Partial<Product>) => {
    let hasMaterialWithPieces = false;
    let totalCompletos = 0;
    const extraStock: string[] = [];

    (product.variations || []).forEach(v => {
      if (v.materials && v.materials.length > 0 && v.materials.some(m => m.pieces !== undefined)) {
        hasMaterialWithPieces = true;
        
        // Group by objectName to allow alternative parts (e.g., 3 different colors of "Capa")
        const groups: Record<string, { sum: number; rawName: string; items: any[] }> = {};
        
        v.materials.forEach(mat => {
          let key = (mat.objectName || '').trim().toLowerCase();
          if (!key) key = mat.id; // Unique parts if no name is provided
          
          if (!groups[key]) {
            const filament = filaments.find(f => f.id === mat.filamentId);
            groups[key] = {
              sum: 0,
              rawName: mat.objectName || filament?.color || 'Peça',
              items: []
            };
          }
          groups[key].items.push(mat);
          groups[key].sum += (mat.pieces || 0);
        });

        const groupValues = Object.values(groups);
        if (groupValues.length > 0) {
          const minPieces = Math.min(...groupValues.map(g => g.sum));
          totalCompletos += minPieces;

          groupValues.forEach(g => {
            const extra = g.sum - minPieces;
            if (extra > 0) {
              // We could break it down by individual items, but grouping is simpler for now
              // If there's extra, we just show the group name
              extraStock.push(`${extra}x ${g.rawName}`);
            }
          });
        }
      }
    });

    if (hasMaterialWithPieces) {
      return { complete: totalCompletos, extra: extraStock, isDerived: true };
    }
    return { complete: product.stock || 0, extra: [], isDerived: false };
  };

  const getProductUniqueColors = (p: Product | Partial<Product>) => {
    const unique = new Map<string, any>();
    (p.variations || []).forEach(v => {
      let vColor = v.color || 'Indefinida';
      if (v.materials && v.materials.length > 0) {
        v.materials.forEach(mat => {
          const f = filaments.find(f => f.id === mat.filamentId);
          if (f) {
            unique.set(f.color, { hex: f.colorHex || '#ccc', colorName: f.color, materialName: f.material });
          }
        });
      } else if (v.filamentId) {
        const f = filaments.find(f => f.id === v.filamentId);
        if (f) {
          unique.set(f.color, { hex: f.colorHex || '#ccc', colorName: f.color, materialName: f.material });
        }
      } else {
        let hex = '#ccc';
        if (vColor.toLowerCase().includes('preto')) hex = '#000';
        if (vColor.toLowerCase().includes('branco')) hex = '#fff';
        unique.set(vColor, { hex, colorName: vColor, materialName: v.material || '' });
      }
    });
    return Array.from(unique.values()).map((u, i) => ({ ...u, id: String(i) }));
  };

  const getProductScheduleTableNames = (product: Product | Partial<Product>) => {
    const names = new Set<string>();
    getProductProductionTables(product).forEach(table => {
      if (table.tableName) names.add(table.tableName);
    });
    return Array.from(names);
  };

  const getProductFilamentSummary = (product: Product | Partial<Product>) => {
    const names = new Set<string>();
    getProductProductionTables(product).forEach(table => {
      table.filaments.forEach(filament => {
        if (filament.filamentName) names.add(filament.filamentName);
      });
    });
    return Array.from(names);
  };

  const prioritizeScheduledVariations = (product: Product): Product => {
    const variations = [...(product.variations || [])].sort((a, b) => {
      const aScore = ((a.id || '').startsWith('agenda-') ? 2 : 0) + ((a.materials || []).length > 0 ? 1 : 0);
      const bScore = ((b.id || '').startsWith('agenda-') ? 2 : 0) + ((b.materials || []).length > 0 ? 1 : 0);
      return bScore - aScore;
    });

    return {
      ...product,
      variations,
    };
  };

  const getProductProductionTables = (product: Product | Partial<Product>) => {
    if (product.productionTables && product.productionTables.length > 0) {
      return product.productionTables.map((table, index) => normalizeProductionOrderTable(table, index));
    }

    const fallbackOrder = productionOrders
      .filter(order => order.status === 'concluida')
      .find(order => order.productName?.trim().toLowerCase() === product.name?.trim().toLowerCase());
    if (fallbackOrder?.tables && fallbackOrder.tables.length > 0) {
      return fallbackOrder.tables;
    }

    const grouped = new Map<string, ProductProductionTable>();
    (product.variations || []).forEach((variation) => {
      (variation.materials || []).forEach((material) => {
        const key = material.objectName || material.id;
        const filament = filaments.find(item => item.id === material.filamentId);
        if (!grouped.has(key)) {
          const startAt = material.startTime || '';
          const endAt = material.endTime || addHoursToDateTime(startAt, Number(material.printTimeHours) || 0);
          grouped.set(key, {
            id: key,
            tableName: material.objectName || 'Mesa',
            scheduledAt: startAt,
            startAt,
            endAt,
            hours: calculateDateTimeHours(startAt, endAt) || Number(material.printTimeHours) || 0,
            productsCount: Number(material.pieces) || 0,
            filaments: [],
          });
        }

        const table = grouped.get(key)!;
        table.hours = Math.max(Number(table.hours) || 0, Number(material.printTimeHours) || 0);
        table.productsCount = Math.max(Number(table.productsCount) || 0, Number(material.pieces) || 0);
        if (!table.scheduledAt && material.startTime) {
          table.scheduledAt = material.startTime;
        }
        if (!table.startAt && material.startTime) {
          table.startAt = material.startTime;
        }
        if (!table.endAt && material.endTime) {
          table.endAt = material.endTime;
        }
        table.filaments.push({
          id: material.id,
          filamentId: material.filamentId,
          filamentName: filament ? `${filament.material} ${filament.color}` : '',
          quantityKg: Number(((Number(material.weightGrams) || 0) / 1000).toFixed(3)),
        });
      });
    });

    return Array.from(grouped.values());
  };

  const ensureEditableProductionTables = (tables: ProductProductionTable[]) => {
    if (tables.length === 0) {
      return [createProductTableEntry(1)];
    }

    return tables.map((table, index) => {
      const normalizedTable = normalizeProductionOrderTable(table, index);
      return {
        ...normalizedTable,
        tableName: normalizedTable.tableName || `Mesa ${index + 1}`,
        filaments: normalizedTable.filaments && normalizedTable.filaments.length > 0
          ? normalizedTable.filaments
          : [createProductFilamentEntry()],
      };
    });
  };

  const isLightColor = (hex?: string) => {
    if (!hex) return false;
    const normalized = hex.trim().toLowerCase();
    return normalized === '#fff' || normalized === '#ffffff' || normalized === 'white';
  };

  const calculateSupplyCostPerUnit = (productState: Partial<Product>) => {
    return (productState.supplyUsages || []).reduce((sum, usage) => {
      const supply = supplies.find(item => item.id === usage.supplyId);
      const costPerUnit = Number(supply?.costPerUnit) || 0;
      return sum + ((Number(usage.quantityPerProduct) || 0) * costPerUnit);
    }, 0);
  };

  // --- INTELLIGENCE CALCULATIONS ---
  const calculateUnitCostBreakdown = (v: Variation, fixedCost: number, productState: Partial<Product> = formData) => {
    return calculateVariationUnitCostBreakdown({
      variation: v,
      fixedCost,
      filaments,
      supplies,
      supplyUsages: productState.supplyUsages || [],
      wastes: productState.wastes || [],
      printers,
      energyPrice,
      pricingSettings,
    });
  };

  const calculateUnitCost = (v: Variation, fixedCost: number, productState: Partial<Product> = formData) => {
    return calculateUnitCostBreakdown(v, fixedCost, productState).total;
  };

  const generateIntelligenceData = () => {
    const alerts: string[] = [];
    let bestMargin = -100;
    let worstMargin = 100;
    let bestChannel = '';
    let worstChannel = '';
    let totalMarginSum = 0;
    let count = 0;

    const variationsData = (formData.variations || []).map(v => {
      const unitCost = calculateUnitCost(v, formData.fixedCost || 0, liveFormProduct);
      
      const channels = v.channelPrices.map(cp => {
        const fee = cp.price * (cp.feePercentage / 100);
        const profit = cp.price - unitCost - fee;
        const margin = cp.price > 0 ? (profit / cp.price) * 100 : 0;

        if (cp.price > 0) {
          if (margin < 0) alerts.push(`⚠️ ${v.color} ${v.material} com margem NEGATIVA na ${cp.channel}`);
          if (margin > 0 && margin < 20) alerts.push(`⚠️ ${v.color} ${v.material} com margem baixa (${margin.toFixed(1)}%) na ${cp.channel}`);
          
          if (margin > bestMargin) { bestMargin = margin; bestChannel = `${cp.channel} (${v.color})`; }
          if (margin < worstMargin) { worstMargin = margin; worstChannel = `${cp.channel} (${v.color})`; }
          
          totalMarginSum += margin;
          count++;
        }

        return { ...cp, fee, profit, margin };
      });

      return { ...v, unitCost, channels };
    });

    return {
      variationsData,
      alerts,
      bestChannel: count > 0 ? bestChannel : 'N/A',
      worstChannel: count > 0 ? worstChannel : 'N/A',
      avgMargin: count > 0 ? (totalMarginSum / count) : 0
    };
  };

  const intel = generateIntelligenceData();

  const getProductCostRange = (product: Product) => {
    if (!product.variations || product.variations.length === 0) return 'R$ 0,00';
    const costs = product.variations.map(v => calculateUnitCost(v, product.fixedCost || 0, product));
    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    if (minCost === maxCost) return `R$ ${minCost.toFixed(2)}`;
    return `R$ ${minCost.toFixed(2)} - R$ ${maxCost.toFixed(2)}`;
  };

  const getProductPriceRange = (product: Product) => {
    if (!product.variations || product.variations.length === 0) return 'R$ 0,00';
    const prices = product.variations.flatMap(v => v.channelPrices?.map(cp => cp.price) || [0]).filter(p => p > 0);
    if (prices.length === 0) return 'Não definido';
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (minPrice === maxPrice) return `R$ ${minPrice.toFixed(2)}`;
    return `R$ ${minPrice.toFixed(2)} - R$ ${maxPrice.toFixed(2)}`;
  };

  const getSuggestedSalePrice = (product: Product) => {
    const latestPrice = Number(product.latestSuggestedPrice?.suggestedPrice) || 0;
    if (latestPrice > 0) return `R$ ${latestPrice.toFixed(2)}`;
    return 'Não salvo';
  };

  const getSuggestedSalePriceMeta = (product: Product) => {
    if (!product.latestSuggestedPrice?.savedAt) return '';
    const savedAt = new Date(product.latestSuggestedPrice.savedAt).toLocaleDateString('pt-BR');
    const channelName = product.latestSuggestedPrice.channelName || 'Sem canal';
    return `${channelName} • ${savedAt}`;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) { // 1MB limit for base64 in firestore
        alert('A imagem deve ter no máximo 1MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, imageUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">
            {showForm ? (editingId ? 'Editar Produto' : 'Novo Produto') : 'Catálogo de Produtos'}
          </h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">
            {showForm
              ? 'Edite o produto em uma área dedicada, com mesas, filamentos e cadastro avançado separados da listagem.'
              : 'Gestão industrial completa: variações, ficha técnica e inteligência de lucro.'}
          </p>
        </div>
        {showForm ? (
          <button
            type="button"
            onClick={closeProductForm}
            className="w-full sm:w-auto px-4 py-2 bg-surface-container text-on-surface text-sm font-bold rounded-md hover:bg-surface-container-high transition-all"
          >
            Voltar para Produtos
          </button>
        ) : (
          <button
            onClick={openNewProductForm}
            className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Novo Produto
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-[0_20px_40px_rgba(25,28,30,0.06)] overflow-hidden">
          <div className="flex border-b border-outline-variant/20 bg-surface-container-low overflow-x-auto">
            <button onClick={() => setActiveTab('basic')} className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'basic' ? 'border-primary text-primary bg-surface-container-lowest' : 'border-transparent text-on-surface-variant hover:bg-surface-container'}`}>
              <Box className="w-4 h-4" /> Básico
            </button>
            <button onClick={() => setActiveTab('advanced')} className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'advanced' ? 'border-primary text-primary bg-surface-container-lowest' : 'border-transparent text-on-surface-variant hover:bg-surface-container'}`}>
              <Settings className="w-4 h-4" /> Avançado
            </button>
          </div>
          
          <div className="p-6">
            {activeTab === 'basic' && (
              <div className="space-y-8">
                {/* Informações Gerais */}
                <div>
                  <h3 className="text-sm font-bold text-on-surface mb-4 flex items-center gap-2"><Box className="w-4 h-4 text-primary" /> Informações Gerais</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Nome do Produto</label>
                      <input type="text" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Ex: Suporte de Fone" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Categoria</label>
                      <input 
                        list="categories-list" 
                        value={formData.category || ''} 
                        onChange={e => setFormData({...formData, category: e.target.value})} 
                        className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" 
                        placeholder="Selecionar ou digitar nova..." 
                      />
                      <datalist id="categories-list">
                        {uniqueCategories.map(cat => (
                          <option key={cat} value={cat} />
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-1.5 md:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant flex items-center justify-between">
                        <span>Estoque Atual / Completo</span>
                        {getProductStockInfo(liveFormProduct).isDerived && (
                          <span className="text-primary tracking-normal truncate ml-2 text-right" title="Calculado das peças">{getProductStockInfo(liveFormProduct).extra.join(', ')}</span>
                        )}
                      </label>
                      <div className="w-full bg-surface-container/50 border border-outline-variant/10 rounded p-2.5 text-sm text-on-surface-variant tabular-nums flex items-center justify-between">
                        <span className="font-bold text-on-surface">{getProductStockInfo(liveFormProduct).complete}</span>
                        <span className="text-[10px] italic">Automático pelas peças</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Informações de Produção */}
                {formData.variations && formData.variations.length > 0 && (
                  <div className="pt-6 border-t border-outline-variant/20">
                    <h3 className="text-sm font-bold text-on-surface mb-4 flex items-center gap-2"><Layers className="w-4 h-4 text-primary" /> Informações de Produção (Padrão)</h3>

                    {(getProductFilamentSummary(liveFormProduct).length > 0 || getProductScheduleTableNames(liveFormProduct).length > 0) && (
                      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Filamentos do Produto</div>
                          <div className="flex flex-wrap gap-2">
                            {getProductFilamentSummary(liveFormProduct).map(name => (
                              <span key={name} className="px-2 py-1 rounded-full bg-surface-container text-xs font-medium text-on-surface">
                                {name}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Mesas do Agendamento</div>
                          <div className="flex flex-wrap gap-2">
                            {getProductScheduleTableNames(liveFormProduct).map(name => (
                              <span key={name} className="px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                {name}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Impressora</label>
                        <select value={formData.variations[0].printerId || ''} onChange={e => handlePrinterChange(formData.variations![0].id, e.target.value)} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none">
                          <option value="">Selecionar Impressora...</option>
                          {printers.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.model})</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Tempo Total (horas)</label>
                        <input type="number" 
                          step="0.1"
                          value={Number((formData.productionTables || []).reduce((sum, table) => sum + (Number(table.hours) || 0), 0).toFixed(2)) || ''} 
                          readOnly
                          className="w-full border-none rounded p-2.5 text-sm tabular-nums bg-surface-container/50 text-on-surface-variant cursor-not-allowed" 
                          placeholder="Ex: 2.5"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Rendimento (Produto Final)</label>
                        <input type="number" 
                          value={(formData.productionTables || []).reduce((sum, table) => sum + (Number(table.productsCount) || 0), 0) || '1'} 
                          readOnly 
                          className="w-full bg-surface-container/50 text-on-surface-variant border-none rounded p-2.5 text-sm cursor-not-allowed font-bold tabular-nums" 
                        />
                      </div>
                      
                      <div className="space-y-1.5 md:col-span-3">
                        <div className="flex justify-between items-center">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Mesas do Produto</label>
                            <p className="text-xs text-on-surface-variant mt-1">Cadastre por mesa com início, fim e filamentos. As horas são calculadas automaticamente.</p>
                          </div>
                          <button type="button" onClick={addProductionTable} className="text-[10px] text-primary font-bold hover:underline">
                            + Adicionar Mesa
                          </button>
                        </div>
                        <div className="space-y-4">
                          {(formData.productionTables || []).length === 0 && (
                            <div className="text-[10px] text-on-surface-variant italic">Nenhuma mesa cadastrada.</div>
                          )}
                          {(formData.productionTables || []).map((table, tableIndex) => (
                            <div key={table.id} className="space-y-4 rounded-xl border border-outline-variant/20 bg-surface-container p-4">
                              <div className="flex items-start justify-between gap-3">
                                <button
                                  type="button"
                                  onClick={() => setOpenTableIds(prev => prev.includes(table.id) ? prev.filter(id => id !== table.id) : [...prev, table.id])}
                                  className="flex-1 text-left"
                                >
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-bold text-on-surface">{table.tableName || `Mesa ${tableIndex + 1}`}</span>
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                                        {openTableIds.includes(table.id) ? 'Fechar' : 'Abrir'}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-xs text-on-surface-variant">
                                      <span>{table.startAt ? formatLocalDateTimeLabel(table.startAt) : 'Sem início'}</span>
                                      <span>•</span>
                                      <span>{formatDurationLabel(getTableDurationMinutes(table))}</span>
                                      <span>•</span>
                                      <span>{Number(table.productsCount || 0)} un</span>
                                      <span>•</span>
                                      <span>{table.filaments.length} filamento(s)</span>
                                      <span>•</span>
                                      <span>{Number((table.filaments.reduce((sum, filament) => sum + (Number(filament.quantityKg) || 0), 0) * 1000).toFixed(2))} g</span>
                                    </div>
                                  </div>
                                </button>
                                <button type="button" onClick={() => removeProductionTable(table.id)} className="p-2 text-error hover:bg-surface-container-lowest rounded">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>

                              {openTableIds.includes(table.id) && (
                                <>
                              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Mesa</label>
                                  <input
                                    type="text"
                                    value={table.tableName}
                                    onChange={e => updateProductionTable(table.id, 'tableName', e.target.value)}
                                    className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                                    placeholder={`Mesa ${tableIndex + 1}`}
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Início da Mesa</label>
                                  <input
                                    type="datetime-local"
                                    value={table.startAt || table.scheduledAt || ''}
                                    onChange={e => updateProductionTable(table.id, 'startAt', e.target.value)}
                                    className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Fim da Mesa</label>
                                  <input
                                    type="datetime-local"
                                    value={table.endAt || ''}
                                    onChange={e => updateProductionTable(table.id, 'endAt', e.target.value)}
                                    className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Duração da Mesa</label>
                                  <input
                                    type="text"
                                    value={formatDurationLabel(getTableDurationMinutes(table))}
                                    readOnly
                                    className="w-full bg-surface-container/50 border-none rounded p-2.5 text-sm text-on-surface-variant cursor-not-allowed tabular-nums outline-none"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd Produtos da Mesa</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={table.productsCount || ''}
                                    onChange={e => updateProductionTable(table.id, 'productsCount', Number(e.target.value))}
                                    className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
                                  />
                                </div>
                              </div>

                              <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <h6 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Filamentos da Mesa</h6>
                                    <p className="text-xs text-on-surface-variant">Informe os filamentos e a quantidade consumida em cada um pela mesa.</p>
                                  </div>
                                  <button type="button" onClick={() => addProductionFilament(table.id)} className="px-3 py-1.5 bg-secondary-container text-on-secondary-container rounded text-xs font-bold">
                                    Adicionar Filamento
                                  </button>
                                </div>

                                <div className="space-y-3">
                                  {table.filaments.map(entry => (
                                    <div key={entry.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end bg-surface-container-lowest rounded-lg p-3">
                                      <SearchableSelectFilament
                                        value={entry.filamentId}
                                        onChange={(value) => updateProductionFilament(table.id, entry.id, 'filamentId', value)}
                                        filaments={filaments}
                                        placeholder="Selecionar filamento"
                                      />
                                      <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd Filamento (g)</label>
                                        <input
                                          type="number"
                                          step="1"
                                          min="0"
                                          value={entry.quantityKg ? Number((Number(entry.quantityKg) * 1000).toFixed(2)) : ''}
                                          onChange={e => updateProductionFilament(table.id, entry.id, 'quantityKg', Number(e.target.value) / 1000)}
                                          className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
                                        />
                                      </div>
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                                          {(() => {
                                            const selectedFilament = filaments.find(item => item.id === entry.filamentId);
                                            if (!selectedFilament) return <span>Sem filamento selecionado</span>;
                                            return (
                                              <>
                                                <span
                                                  className="w-3 h-3 rounded-full border border-outline-variant/30"
                                                  style={{ backgroundColor: selectedFilament.colorHex || '#ccc' }}
                                                />
                                                <span>{selectedFilament.color || entry.filamentName}</span>
                                              </>
                                            );
                                          })()}
                                        </div>
                                        <button type="button" onClick={() => removeProductionFilament(table.id, entry.id)} className="p-2 text-error hover:bg-surface-container rounded">
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-6 border-t border-outline-variant/20">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-on-surface flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> Insumos do Produto</h3>
                      <p className="text-xs text-on-surface-variant mt-1">Vincule os itens comprados que cada unidade consome, como vela, fita ou caixa.</p>
                    </div>
                    <button type="button" onClick={addSupplyUsage} className="px-3 py-1.5 bg-secondary-container text-on-secondary-container rounded text-xs font-bold whitespace-nowrap">
                      Adicionar Insumo
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Insumos Vinculados</p>
                      <p className="text-xl font-bold text-on-surface">{(formData.supplyUsages || []).filter(item => item.supplyId).length}</p>
                    </div>
                    <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Custo por Produto</p>
                      <p className="text-xl font-bold text-primary">R$ {calculateSupplyCostPerUnit(liveFormProduct).toFixed(2)}</p>
                    </div>
                    <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Consumo do Estoque Atual</p>
                      <p className="text-xl font-bold text-on-surface">
                        {(formData.supplyUsages || []).reduce((sum, usage) => sum + ((Number(usage.quantityPerProduct) || 0) * getProductStockInfo(liveFormProduct).complete), 0).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {(formData.supplyUsages || []).length === 0 && (
                      <div className="text-[10px] text-on-surface-variant italic">Nenhum insumo vinculado.</div>
                    )}

                    {(formData.supplyUsages || []).map(usage => {
                      const selectedSupply = supplies.find(item => item.id === usage.supplyId);
                      const totalUsage = (Number(usage.quantityPerProduct) || 0) * getProductStockInfo(liveFormProduct).complete;
                      return (
                        <div key={usage.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_120px_120px_minmax(0,1fr)_auto] gap-3 items-end bg-surface-container rounded-xl p-4 border border-outline-variant/10">
                          <SearchableSelect
                            options={supplyOptions}
                            value={usage.supplyId}
                            onChange={(value) => updateSupplyUsage(usage.id, 'supplyId', value)}
                            placeholder="Selecionar insumo"
                            label="Insumo"
                          />
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd por Produto</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={usage.quantityPerProduct || ''}
                              onChange={e => updateSupplyUsage(usage.id, 'quantityPerProduct', parseLocaleNumber(e.target.value))}
                              className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Unidade</label>
                            <div className="w-full bg-surface-container-lowest border border-outline-variant/10 rounded p-2.5 text-sm text-on-surface-variant">
                              {usage.unit || selectedSupply?.unit || 'un'}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Resumo</label>
                            <div className="rounded p-2.5 bg-surface-container-lowest border border-outline-variant/10 text-xs text-on-surface-variant leading-relaxed">
                              <div>Estoque atual: <span className="font-bold text-on-surface">{selectedSupply ? `${selectedSupply.quantity} ${selectedSupply.unit}` : '--'}</span></div>
                              <div>Baixa ao salvar: <span className="font-bold text-primary">{usage.supplyId ? `${totalUsage.toLocaleString('pt-BR')} ${usage.unit || selectedSupply?.unit || ''}` : '--'}</span></div>
                            </div>
                          </div>
                          <button type="button" onClick={() => removeSupplyUsage(usage.id)} className="p-2 text-error hover:bg-surface-container-lowest rounded justify-self-end">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Custos e Preço */}
                {formData.variations && formData.variations.length > 0 && (
                  <div className="pt-6 border-t border-outline-variant/20">
                    <h3 className="text-sm font-bold text-on-surface mb-4 flex items-center gap-2"><Calculator className="w-4 h-4 text-primary" /> Custos e Preço Sugerido</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Custo Total da Impressão</p>
                        <p className="text-xl font-bold text-on-surface">
                          R$ {(calculateUnitCost(livePrimaryVariation, formData.fixedCost || 0, liveFormProduct) * (livePrimaryVariation.quantityPerPrint || 1)).toFixed(2)}
                        </p>
                      </div>
                      
                      <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Custo por Unidade</p>
                        <p className="text-xl font-bold text-primary">
                          R$ {calculateUnitCost(livePrimaryVariation, formData.fixedCost || 0, liveFormProduct).toFixed(2)}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Preço Sugerido (Unidade)</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm font-bold">R$</span>
                          <input 
                            type="number" 
                            value={livePrimaryVariation.channelPrices?.[0]?.price || ''} 
                            onChange={e => updateChannelPrice(livePrimaryVariation.id, livePrimaryVariation.channelPrices?.[0]?.channel || 'Venda Direta', Number(e.target.value))} 
                            className="w-full bg-surface-container border-none rounded p-2.5 pl-9 text-sm focus:ring-2 focus:ring-primary outline-none font-bold text-secondary" 
                            placeholder="0.00" 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'advanced' && (
              <div className="space-y-6">
                <div className="flex gap-2 border-b border-outline-variant/20 pb-2 overflow-x-auto">
                  <button onClick={() => setAdvancedTab('tech')} className={`px-4 py-2 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${advancedTab === 'tech' ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`}>Ficha Técnica</button>
                  <button onClick={() => setAdvancedTab('variations')} className={`px-4 py-2 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${advancedTab === 'variations' ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`}>Variações</button>
                  <button onClick={() => setAdvancedTab('wastes')} className={`px-4 py-2 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${advancedTab === 'wastes' ? 'bg-error text-on-error' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`}>Desperdícios/Erros</button>
                  <button onClick={() => setAdvancedTab('intelligence')} className={`px-4 py-2 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${advancedTab === 'intelligence' ? 'bg-secondary text-on-secondary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`}>Inteligência de Lucro</button>
                  <button onClick={() => setAdvancedTab('files')} className={`px-4 py-2 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${advancedTab === 'files' ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`}>Arquivos</button>
                </div>

                {advancedTab === 'tech' && (
              <div className="space-y-6">
                <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-5">
                  <h4 className="text-sm font-bold text-on-surface mb-4">Cadastro Avançado</h4>
                  <div className="grid grid-cols-1 md:grid-cols-[140px_minmax(0,1fr)_220px] gap-6">
                    <div className="w-full">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-1.5">Foto do Produto</label>
                      <div className="relative w-full aspect-square bg-surface-container-lowest border-2 border-dashed border-outline-variant/30 rounded-xl flex items-center justify-center overflow-hidden hover:bg-surface-container transition-colors cursor-pointer group">
                        {formData.imageUrl ? (
                          <img src={formData.imageUrl} alt="Produto" className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center p-2">
                            <Upload className="w-6 h-6 text-on-surface-variant mx-auto mb-1 opacity-50 group-hover:opacity-100 transition-opacity" />
                            <span className="text-[9px] text-on-surface-variant uppercase font-bold">Upload</span>
                          </div>
                        )}
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                      </div>
                      {formData.imageUrl && (
                        <button type="button" onClick={() => setFormData(prev => ({...prev, imageUrl: ''}))} className="text-[10px] text-error font-bold mt-1 hover:underline w-full text-center">
                          Remover Foto
                        </button>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">SKU Base</label>
                        <input type="text" value={formData.baseSku || ''} onChange={e => setFormData({...formData, baseSku: e.target.value})} className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Ex: SUP-FONE" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Status</label>
                        <select value={formData.status || 'desenvolvimento'} onChange={e => setFormData({...formData, status: e.target.value as any})} className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none">
                          <option value="desenvolvimento">Em Desenvolvimento</option>
                          <option value="ativo">Ativo (Em Produção)</option>
                          <option value="inativo">Inativo</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Dimensões (LxPxA)</label>
                    <input type="text" value={formData.technicalSheet?.dimensions || ''} onChange={e => setFormData({...formData, technicalSheet: {...formData.technicalSheet, dimensions: e.target.value} as TechnicalSheet})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Ex: 150x100x200mm" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Preenchimento (Infill %)</label>
                    <input type="number" value={formData.technicalSheet?.infillPercentage || ''} onChange={e => setFormData({...formData, technicalSheet: {...formData.technicalSheet, infillPercentage: Number(e.target.value)} as TechnicalSheet})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="15" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Altura da Camada (mm)</label>
                    <input type="number" step="0.04" value={formData.technicalSheet?.layerHeight || ''} onChange={e => setFormData({...formData, technicalSheet: {...formData.technicalSheet, layerHeight: Number(e.target.value)} as TechnicalSheet})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="0.2" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Pós-processamento</label>
                    <input type="text" value={formData.technicalSheet?.postProcessing || ''} onChange={e => setFormData({...formData, technicalSheet: {...formData.technicalSheet, postProcessing: e.target.value} as TechnicalSheet})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Ex: Lixar, Pintar, Inserir ímãs..." />
                  </div>
                  <div className="flex items-center gap-3 mt-4">
                    <input type="checkbox" id="supports" checked={formData.technicalSheet?.supports || false} onChange={e => setFormData({...formData, technicalSheet: {...formData.technicalSheet, supports: e.target.checked} as TechnicalSheet})} className="w-4 h-4 text-primary rounded border-outline-variant/30 focus:ring-primary" />
                    <label htmlFor="supports" className="text-sm font-bold text-on-surface">Requer Suportes?</label>
                  </div>
                </div>
              </div>
            )}

            {advancedTab === 'variations' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm text-on-surface-variant">Custo dinâmico: O custo é recalculado automaticamente considerando material, tempo e <strong className="text-primary">quantidade por impressão</strong>.</p>
                  <button onClick={addVariation} className="px-3 py-1.5 bg-surface-container text-primary text-xs font-bold rounded hover:bg-surface-container-high transition-colors flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Adicionar Variação
                  </button>
                </div>
                
                {formData.variations?.length === 0 ? (
                  <div className="text-center py-8 bg-surface-container-lowest border border-dashed border-outline-variant/30 rounded-lg">
                    <p className="text-sm text-on-surface-variant">Nenhuma variação cadastrada.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {formData.variations?.map((v) => {
                      const costBreakdown = calculateUnitCostBreakdown(v, formData.fixedCost || 0, liveFormProduct);
                      const unitCost = costBreakdown.total;
                      return (
                        <div key={v.id} className="flex flex-col gap-3 p-4 bg-surface-container-lowest border border-outline-variant/20 rounded-lg">
                          <div className="flex justify-between items-center border-b border-outline-variant/10 pb-2">
                            <h5 className="font-bold text-sm flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full border border-outline-variant/30" style={{ backgroundColor: v.color === 'Preto' ? '#000' : v.color === 'Branco' ? '#fff' : '#ccc' }}></span>
                              {v.color} ({v.material})
                            </h5>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <span className="text-[10px] uppercase tracking-widest text-on-surface-variant block">Custo Unitário Final</span>
                                <span className="font-bold text-primary tabular-nums">R$ {unitCost.toFixed(2)}</span>
                              </div>
                              <button onClick={() => removeVariation(v.id)} className="p-1.5 text-on-surface-variant hover:text-error hover:bg-error/10 rounded">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-2 gap-3 mb-1">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold uppercase text-on-surface-variant">Sufixo SKU</label>
                              <input type="text" value={v.skuSuffix || ''} onChange={e => updateVariation(v.id, 'skuSuffix', e.target.value)} className="w-full bg-surface-container border-none rounded p-2 text-xs" placeholder="-BLK" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold uppercase text-on-surface-variant">Impressora (Frota)</label>
                              <select value={v.printerId || ''} onChange={e => handlePrinterChange(v.id, e.target.value)} className="w-full bg-surface-container border-none rounded p-2 text-xs">
                                <option value="">Selecionar Impressora...</option>
                                {printers.map(p => (
                                  <option key={p.id} value={p.id}>{p.name} ({p.model})</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Materials List */}
                          <div className="space-y-2 mt-3">
                            <div className="flex justify-between items-center">
                              <label className="text-[9px] font-bold uppercase text-on-surface-variant">Filamentos Utilizados</label>
                              <button onClick={() => addMaterialToVariation(v.id)} className="text-[10px] text-primary font-bold hover:underline">
                                + Adicionar Filamento
                              </button>
                            </div>
                            {(v.materials || []).map(mat => {
                              const selectedFilament = filaments.find(f => f.id === mat.filamentId);
                              return (
                              <div key={mat.id} className="flex gap-2 items-center bg-surface-container-low p-2 rounded border border-outline-variant/10">
                                {selectedFilament && (
                                  <div className="w-4 h-4 rounded-full border border-outline-variant/30 flex-shrink-0" style={{ backgroundColor: selectedFilament.colorHex || '#ccc' }} title={selectedFilament.color} />
                                )}
                                <div className="flex-1 min-w-[150px]">
                                  <SearchableSelectFilament 
                                    value={mat.filamentId || ''} 
                                    onChange={val => updateMaterial(v.id, mat.id, 'filamentId', val)} 
                                    filaments={filaments} 
                                    placeholder="Localizar filamento..." 
                                  />
                                </div>
                                <div className="flex-1 relative group min-w-[100px]">
                                  <input type="text" value={mat.objectName || ''} onChange={e => updateMaterial(v.id, mat.id, 'objectName', e.target.value)} className="w-full bg-surface-container border-none rounded p-1.5 text-xs" placeholder="Nome do Objeto (ex: Capa)" />
                                  <div className="absolute left-0 -bottom-8 hidden group-hover:block bg-surface-container-highest text-on-surface text-[10px] p-1 rounded z-10 w-48 shadow-lg">Partes com o mesmo nome agem como alternativas para o estoque.</div>
                                </div>
                                <div className="w-16">
                                  <input type="number" value={mat.weightGrams || ''} onChange={e => updateMaterial(v.id, mat.id, 'weightGrams', parseLocaleNumber(e.target.value))} className="w-full bg-surface-container border-none rounded p-1.5 text-xs" placeholder="Peso (g)" />
                                </div>
                                <div className="w-16">
                                  <input type="number" value={mat.purgeGrams || ''} onChange={e => updateMaterial(v.id, mat.id, 'purgeGrams', parseLocaleNumber(e.target.value))} className="w-full bg-surface-container border-none rounded p-1.5 text-xs" placeholder="Purga (g)" />
                                </div>
                                <div className="w-14">
                                  <input type="number" value={mat.pieces === undefined ? '' : mat.pieces} onChange={e => updateMaterial(v.id, mat.id, 'pieces', Math.max(0, Number(e.target.value)))} className="w-full bg-surface-container border-none rounded p-1.5 text-xs" placeholder="Qtd" title="Qtd de Peças Feitas" />
                                </div>
                                <div className="flex gap-1 items-center bg-surface-container rounded p-1">
                                  <input 
                                    type="time" 
                                    value={mat.startTime || ''} 
                                    onChange={e => {
                                      updateMaterial(v.id, mat.id, 'startTime', e.target.value);
                                      handleTimeCalculate(e.target.value, mat.endTime || '', (hrs) => updateMaterial(v.id, mat.id, 'printTimeHours', hrs));
                                    }}
                                    className="w-16 bg-transparent border-none text-[10px] p-0 focus:ring-0 text-on-surface-variant text-center"
                                    title="Hora Início"
                                  />
                                  <span className="text-[10px] text-on-surface-variant font-bold leading-none">-</span>
                                  <input 
                                    type="time" 
                                    value={mat.endTime || ''} 
                                    onChange={e => {
                                      updateMaterial(v.id, mat.id, 'endTime', e.target.value);
                                      handleTimeCalculate(mat.startTime || '', e.target.value, (hrs) => updateMaterial(v.id, mat.id, 'printTimeHours', hrs));
                                    }}
                                    className="w-16 bg-transparent border-none text-[10px] p-0 focus:ring-0 text-on-surface-variant text-center"
                                    title="Hora Fim"
                                  />
                                </div>
                                <div className="w-16">
                                  <input type="number" 
                                    step="0.1"
                                    value={mat.printTimeHours === undefined ? '' : mat.printTimeHours} 
                                    onChange={e => updateMaterial(v.id, mat.id, 'printTimeHours', Math.max(0, Number(e.target.value)))} 
                                    className="w-full bg-surface-container border-none rounded p-1.5 text-xs font-bold text-primary tabular-nums" 
                                    placeholder="Total(h)" 
                                    title="Tempo de Impressão (horas)" 
                                  />
                                </div>
                                <button onClick={() => removeMaterial(v.id, mat.id)} className="p-1 text-on-surface-variant hover:text-error">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )})}
                            {(!v.materials || v.materials.length === 0) && (
                              <div className="text-[10px] text-on-surface-variant italic">Nenhum filamento adicionado. Adicione para calcular o custo do material.</div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-surface-container-low p-3 rounded border border-outline-variant/10 mt-3">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold uppercase text-on-surface-variant flex gap-1 items-center">
                                Tempo Total (horas)
                                {v.materials?.some(m => m.printTimeHours !== undefined) && <span className="text-[8px] bg-primary/10 text-primary px-1 rounded">Auto</span>}
                              </label>
                              <input type="number" 
                                step="0.1"
                                value={v.printTimeHours || ''} 
                                onChange={e => !v.materials?.some(m => m.printTimeHours !== undefined) && updateVariation(v.id, 'printTimeHours', Number(e.target.value))} 
                                readOnly={v.materials?.some(m => m.printTimeHours !== undefined) || false}
                                className={`w-full border-none rounded p-2 text-xs tabular-nums ${v.materials?.some(m => m.printTimeHours !== undefined) ? 'bg-surface-container/50 text-on-surface-variant cursor-not-allowed' : 'bg-surface-container'}`} 
                                placeholder="0" 
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold uppercase text-on-surface-variant">Custo Imp. (R$/h)</label>
                              <input type="number" step="0.01" value={v.printerCostPerHour || ''} onChange={e => updateVariation(v.id, 'printerCostPerHour', Number(e.target.value))} className="w-full bg-surface-container border-none rounded p-2 text-xs tabular-nums" placeholder="1.50" disabled={!!v.printerId} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold uppercase text-on-surface-variant text-primary flex gap-1 items-center">
                                Rendimento (Peças)
                                <span className="text-[8px] bg-primary/10 text-primary px-1 rounded">Auto</span>
                              </label>
                              <input type="number" 
                                value={v.quantityPerPrint || '1'} 
                                readOnly 
                                className="w-full bg-surface-container/50 text-on-surface-variant border-none rounded p-2 text-xs tabular-nums font-bold cursor-not-allowed" 
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold uppercase text-on-surface-variant text-primary">Custo Real por Unidade</label>
                              <div className="w-full bg-surface-container border-none rounded p-2 text-xs tabular-nums font-bold text-primary flex flex-col justify-center min-h-[34px]">
                                <span>R$ {unitCost.toFixed(2)}</span>
                                <span className="text-[8px] text-on-surface-variant font-normal leading-tight mt-0.5">
                                  Mat: R$ {costBreakdown.materialCostPerUnit.toFixed(2)} | Imp: R$ {costBreakdown.timeCostPerUnit.toFixed(2)} | Ins: R$ {costBreakdown.supplyCostPerUnit.toFixed(2)} | Falha: R$ {costBreakdown.failureAdjustmentPerUnit.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {advancedTab === 'wastes' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-on-surface">Desperdícios e Falhas</h3>
                    <p className="text-xs text-on-surface-variant">Registre filamento perdido na prototipagem deste produto.</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        wastes: [...(prev.wastes || []), { id: Date.now().toString(), filamentId: '', weightGrams: 0, includeInCost: false, notes: '' }]
                      }));
                    }}
                    className="px-3 py-1.5 bg-error text-on-error text-xs font-bold rounded flex items-center gap-2 hover:opacity-90"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {(!formData.wastes || formData.wastes.length === 0) ? (
                  <div className="text-center py-6 bg-surface-container-low rounded border border-outline-variant/10 text-on-surface-variant text-sm">
                    Nenhum desperdício registrado.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formData.wastes.map((w, index) => (
                      <div key={w.id} className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/20 relative">
                        <div className="absolute top-3 right-3 flex items-center gap-2">
                          <button 
                            type="button" 
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                wastes: prev.wastes?.filter(waste => waste.id !== w.id)
                              }));
                            }} 
                            className="p-1 text-slate-400 hover:text-error transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pr-10">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Filamento Usado</label>
                            <select 
                              value={w.filamentId || ''} 
                              onChange={(e) => {
                                setFormData(prev => ({
                                  ...prev,
                                  wastes: prev.wastes?.map(waste => waste.id === w.id ? { ...waste, filamentId: e.target.value } : waste)
                                }));
                              }}
                              className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-error"
                            >
                              <option value="">Selecione...</option>
                              {filaments.map(f => (
                                <option key={f.id} value={f.id}>
                                  {f.material} {f.color} ({f.brand})
                                </option>
                              ))}
                            </select>
                          </div>
                          
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Peso Perdido (g)</label>
                            <input 
                              type="number" 
                              value={w.weightGrams || ''} 
                              onChange={(e) => {
                                setFormData(prev => ({
                                  ...prev,
                                  wastes: prev.wastes?.map(waste => waste.id === w.id ? { ...waste, weightGrams: parseLocaleNumber(e.target.value) } : waste)
                                }));
                              }}
                              className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-error tabular-nums" 
                              placeholder="0"
                            />
                          </div>

                          <div className="space-y-1 md:col-span-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Motivo / Notas</label>
                            <input 
                              type="text" 
                              value={w.notes || ''} 
                              onChange={(e) => {
                                setFormData(prev => ({
                                  ...prev,
                                  wastes: prev.wastes?.map(waste => waste.id === w.id ? { ...waste, notes: e.target.value } : waste)
                                }));
                              }}
                              className="w-full bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-error" 
                              placeholder="Ex: Falha na adesão, Teste de tamanho"
                            />
                          </div>
                        </div>
                        
                        <div className="mt-4 pt-3 border-t border-outline-variant/10 flex items-center justify-between">
                          <label className="flex items-center gap-2 cursor-pointer group">
                            <input 
                              type="checkbox" 
                              checked={w.includeInCost || false}
                              onChange={(e) => {
                                setFormData(prev => ({
                                  ...prev,
                                  wastes: prev.wastes?.map(waste => waste.id === w.id ? { ...waste, includeInCost: e.target.checked } : waste)
                                }));
                              }}
                              className="w-4 h-4 text-error rounded border-outline-variant/30 focus:ring-error cursor-pointer"
                            />
                            <span className="text-sm font-bold text-on-surface group-hover:text-error transition-colors">Somar ao Custo de Produção (Diluição em Custo Fixo)</span>
                          </label>
                          
                          {w.filamentId && w.weightGrams > 0 && (
                            <div className="text-xs font-bold text-error">
                              R$ {(w.weightGrams * ((filaments.find(f => f.id === w.filamentId)?.pricePerKg || 0) / 1000)).toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="bg-surface-container-low p-4 rounded-lg flex items-start gap-3 border border-outline-variant/10">
                  <AlertTriangle className="w-5 h-5 text-on-surface-variant mt-0.5" />
                  <p className="text-xs text-on-surface-variant flex-1">
                    Registrar desperdício <strong>não</strong> irá descontar este filamento do seu estoque automaticamente. O registro serve para compor o custo de criação associado à precificação do produto final. Para baixa em estoque por perda de filamentos ativos, utilize a área de <strong>Controle de Perdas</strong> geral.
                  </p>
                </div>
              </div>
            )}

            {advancedTab === 'intelligence' && (
              <div className="space-y-6">
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/20">
                  <div className="space-y-1.5 max-w-xs">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Custo Fixo Rateado (R$)</label>
                    <input type="number" value={formData.fixedCost || ''} onChange={e => setFormData({...formData, fixedCost: Number(e.target.value)})} className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="0.00" />
                    <p className="text-[10px] text-on-surface-variant">Este valor será somado ao custo de produção de cada unidade.</p>
                  </div>
                </div>

                {/* Top KPIs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/20 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container">
                      <Target className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Melhor Canal</p>
                      <p className="text-lg font-bold text-on-surface">{intel.bestChannel}</p>
                    </div>
                  </div>
                  <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/20 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center text-on-error-container">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Pior Canal</p>
                      <p className="text-lg font-bold text-on-surface">{intel.worstChannel}</p>
                    </div>
                  </div>
                  <div className="bg-surface-container p-4 rounded-xl border border-outline-variant/20 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container">
                      <DollarSign className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Margem Média</p>
                      <p className="text-lg font-bold text-on-surface">{intel.avgMargin.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>

                {/* Smart Alerts */}
                {intel.alerts.length > 0 && (
                  <div className="bg-error-container/30 border border-error/20 p-4 rounded-xl space-y-2">
                    <h4 className="text-xs font-bold text-error uppercase tracking-widest flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Alertas Inteligentes
                    </h4>
                    <ul className="space-y-1">
                      {intel.alerts.map((alert, i) => (
                        <li key={i} className="text-sm text-on-surface font-medium">{alert}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Profit Table */}
                <div className="border border-outline-variant/20 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                        <th className="px-4 py-3">Variação</th>
                        <th className="px-4 py-3">Canal</th>
                        <th className="px-4 py-3 text-right">Custo Unit.</th>
                        <th className="px-4 py-3 text-right">Preço Venda</th>
                        <th className="px-4 py-3 text-right">Taxa Canal</th>
                        <th className="px-4 py-3 text-right">Lucro Líquido</th>
                        <th className="px-4 py-3 text-right">Margem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {intel.variationsData.map((v) => (
                        v.channels.map((cp, idx) => (
                          <tr key={`${v.id}-${cp.channel}`} className="hover:bg-surface-container-lowest transition-colors">
                            {idx === 0 && (
                              <td className="px-4 py-3 align-top border-r border-outline-variant/10" rowSpan={v.channels.length}>
                                <div className="font-bold text-sm text-on-surface">{v.color}</div>
                                <div className="text-[10px] text-on-surface-variant">{v.material}</div>
                              </td>
                            )}
                            <td className="px-4 py-3 text-sm font-medium">{cp.channel}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-sm text-on-surface-variant">R$ {v.unitCost.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right">
                              <input 
                                type="number" 
                                value={cp.price || ''}
                                onChange={(e) => updateChannelPrice(v.id, cp.channel, Number(e.target.value))}
                                className="w-20 text-right bg-surface-container border-none rounded p-1 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none font-bold text-primary"
                              />
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-sm text-error/80">- R$ {cp.fee.toFixed(2)} <span className="text-[10px]">({cp.feePercentage}%)</span></td>
                            <td className="px-4 py-3 text-right tabular-nums text-sm font-bold text-secondary">R$ {cp.profit.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tabular-nums ${cp.margin < 0 ? 'bg-error text-on-error' : cp.margin < 20 ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-secondary-container text-on-secondary-container'}`}>
                                {cp.margin.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {advancedTab === 'files' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm text-on-surface-variant">Gerencie os arquivos STL, GCODEs fatiados e manuais.</p>
                </div>
                <div className="text-center py-8 bg-surface-container-lowest border border-dashed border-outline-variant/30 rounded-lg">
                  <p className="text-sm text-on-surface-variant">Nenhum arquivo cadastrado.</p>
                </div>
              </div>
            )}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-outline-variant/20 bg-surface-container-lowest flex justify-end gap-3">
            <button 
              type="button" 
              onClick={closeProductForm}
              className="px-6 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="button" 
              onClick={handleSave}
              className="px-6 py-2 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all active:scale-95 flex items-center gap-2"
            >
              <Save className="w-4 h-4" /> {editingId ? 'Atualizar Produto' : 'Salvar Produto'}
            </button>
          </div>
        </div>
      )}

      {!showForm && (
        <>
      {/* Filtros */}
      <div className="flex flex-col gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome do produto..."
                className="w-full bg-surface-container border-none rounded-lg p-2.5 pl-10 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            {/* Categorias (Pills) */}
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Categorias:</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setFilterCategories([])}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${filterCategories.length === 0 ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
                >
                  Todas
                </button>
                {uniqueCategories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => {
                      if (filterCategories.includes(cat)) {
                        setFilterCategories(filterCategories.filter(c => c !== cat));
                      } else {
                        setFilterCategories([...filterCategories, cat]);
                      }
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${filterCategories.includes(cat) ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="text-sm text-on-surface-variant font-medium">
            Mostrando {sortedProducts.length} produto(s)
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex bg-surface-container rounded-lg p-1 mr-2">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
              title="Visualização em Grade"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}
              title="Visualização em Lista"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Status:</label>
            <select 
              value={filterStatus || 'all'} 
              onChange={e => setFilterStatus(e.target.value)}
              className="bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none"
            >
              <option value="all">Todos</option>
              <option value="ativo">Ativo</option>
              <option value="desenvolvimento">Em Desenvolvimento</option>
              <option value="inativo">Inativo</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Criado entre:</label>
            <input 
              type="date" 
              value={filterDateStart || ''}
              onChange={e => setFilterDateStart(e.target.value)}
              className="bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none"
            />
            <span className="text-on-surface-variant">e</span>
            <input 
              type="date" 
              value={filterDateEnd || ''}
              onChange={e => setFilterDateEnd(e.target.value)}
              className="bg-surface-container border-none rounded p-2 text-sm focus:ring-2 focus:ring-primary outline-none"
            />
          </div>
        </div>
      </div>

      {/* Grade / Lista de Produtos */}
      {sortedProducts.length === 0 ? (
        <div className="text-center py-12 bg-surface-container-lowest rounded-xl border border-outline-variant/10">
          <p className="text-sm text-on-surface-variant">Nenhum produto encontrado com os filtros atuais.</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden shadow-sm">
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant/20 text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">
                  <th className="p-4 whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort('name')}>
                    Produto {getSortIndicator('name')}
                  </th>
                  <th className="p-4 whitespace-nowrap">Cores / Variações</th>
                  <th className="p-4 whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort('stock')}>
                    Estoque {getSortIndicator('stock')}
                  </th>
                  <th className="p-4 whitespace-nowrap cursor-pointer select-none" onClick={() => handleSort('cost')}>
                    Custo Unitário {getSortIndicator('cost')}
                  </th>
                  <th className="p-4 whitespace-nowrap">Preço de Venda</th>
                  <th className="p-4 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {sortedProducts.map(p => (
                  <tr key={p.id} className="hover:bg-surface-container/50 transition-colors cursor-pointer group" onClick={() => handleEdit(p)}>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-surface-container rounded-md flex items-center justify-center flex-shrink-0 border border-outline-variant/20 overflow-hidden">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <Box className="w-5 h-5 text-primary" />
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-sm text-on-surface leading-tight">{p.name}</div>
                          <div className="text-[10px] font-mono text-on-surface-variant uppercase">{p.baseSku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                          {getProductUniqueColors(p).slice(0,5).map((u: any) => (
                            <div key={u.id} className="relative group/tooltip">
                              <span
                                className={`block w-3 h-3 rounded-full shadow-sm ${isLightColor(u.hex) ? 'border border-slate-400' : 'border border-outline-variant/30'}`}
                                style={{ backgroundColor: u.hex }}
                              />
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-surface-container-highest text-on-surface text-[10px] rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                                {u.colorName} ({u.materialName})
                              </div>
                            </div>
                          ))}
                          {getProductUniqueColors(p).length > 5 && <span className="text-[10px] font-bold text-on-surface-variant ml-1">+{getProductUniqueColors(p).length - 5}</span>}
                        </div>
                        {(getProductFilamentSummary(p).length > 0 || getProductScheduleTableNames(p).length > 0) && (
                          <div className="flex flex-col gap-1 ml-3">
                            {getProductFilamentSummary(p).length > 0 && (
                              <span className="text-[10px] text-on-surface-variant">
                                {getProductFilamentSummary(p).slice(0, 2).join(' • ')}
                                {getProductFilamentSummary(p).length > 2 ? ' ...' : ''}
                              </span>
                            )}
                            {getProductScheduleTableNames(p).length > 0 && (
                              <span className="text-[10px] text-primary font-bold">
                                {getProductScheduleTableNames(p).slice(0, 2).join(' • ')}
                                {getProductScheduleTableNames(p).length > 2 ? ' ...' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-sm text-on-surface">{getProductStockInfo(p).complete}</span>
                        {getProductStockInfo(p).extra.length > 0 && (
                          <span className="text-[9px] bg-secondary-container text-on-secondary-container px-1.5 py-0.5 rounded font-bold self-start">{getProductStockInfo(p).extra[0]} {getProductStockInfo(p).extra.length > 1 ? '...' : ''}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="font-bold text-sm text-error whitespace-nowrap">{getProductCostRange(p)}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-sm text-primary whitespace-nowrap">{getSuggestedSalePrice(p)}</span>
                        {getSuggestedSalePriceMeta(p) && (
                          <span className="text-[10px] text-on-surface-variant">{getSuggestedSalePriceMeta(p)}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleEdit(p); }} className="p-1.5 text-slate-400 hover:text-primary hover:bg-surface-container transition-colors rounded">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); requestDelete(p.id); }} className="p-1.5 text-slate-400 hover:text-error hover:bg-error/10 transition-colors rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {sortedProducts.map((p) => (
            <div key={p.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden hover:shadow-md transition-shadow group flex flex-col">
              <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-surface-container rounded-lg flex items-center justify-center flex-shrink-0 border border-outline-variant/20 overflow-hidden">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <Box className="w-6 h-6 text-primary" />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleEdit(p); }} className="p-1.5 text-slate-400 hover:text-primary transition-colors rounded opacity-0 group-hover:opacity-100">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); requestDelete(p.id); }} className="p-1.5 text-slate-400 hover:text-error transition-colors rounded opacity-0 group-hover:opacity-100">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-on-surface mb-1 leading-tight">{p.name}</h3>
                <p className="text-xs font-mono text-on-surface-variant uppercase mb-4">{p.baseSku}</p>

                <div className="mb-4 p-3 rounded-lg bg-surface-container border border-outline-variant/20">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Preço de Venda</div>
                  <div className="text-lg font-bold text-primary">{getSuggestedSalePrice(p)}</div>
                  {getSuggestedSalePriceMeta(p) && (
                    <div className="text-[10px] text-on-surface-variant mt-1">{getSuggestedSalePriceMeta(p)}</div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-on-surface-variant">Variações</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-on-surface">{p.variations.length}</span>
                      <div className="flex gap-0.5">
                        {getProductUniqueColors(p).slice(0,3).map((u: any) => (
                          <span
                            key={u.id}
                            className={`w-2.5 h-2.5 rounded-full ${isLightColor(u.hex) ? 'border border-slate-400' : 'border border-outline-variant/30'}`}
                            style={{ backgroundColor: u.hex }}
                            title={`${u.colorName} - ${u.materialName}`}
                          ></span>
                        ))}
                        {getProductUniqueColors(p).length > 3 && <span className="text-[8px] text-on-surface-variant ml-0.5">+{getProductUniqueColors(p).length - 3}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-on-surface-variant">Arquivos</span>
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-on-surface-variant" />
                      <span className="font-bold text-on-surface">{p.files.length}</span>
                    </div>
                  </div>
                  <div className="flex flex-col text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-on-surface-variant">Estoque Completo</span>
                      <span className="font-bold text-on-surface">{getProductStockInfo(p).complete}</span>
                    </div>
                    {getProductStockInfo(p).extra.length > 0 && (
                      <div className="flex justify-between items-start mt-1">
                        <span className="text-[10px] uppercase text-on-surface-variant tracking-wider mt-0.5">Estoque Extra</span>
                        <div className="text-right flex flex-col gap-0.5">
                          {getProductStockInfo(p).extra.map((ex, i) => (
                            <span key={i} className="text-[10px] bg-secondary-container text-on-secondary-container px-1.5 py-0.5 rounded font-bold">{ex}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm pt-2 border-t border-outline-variant/10">
                    <span className="text-on-surface-variant">Custo Unitário</span>
                    <span className="font-bold text-error">{getProductCostRange(p)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-on-surface-variant">Preço Sugerido</span>
                    <span className="font-bold text-primary">{getProductPriceRange(p)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}

      {deleteTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-2xl">
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-on-surface">Excluir Produto</h3>
                <p className="text-sm text-on-surface-variant mt-1">
                  Tem certeza que quer excluir este produto permanentemente e devolver o saldo dos materiais?
                </p>
              </div>

              <div className="rounded-xl bg-error-container/40 border border-error/10 p-3 text-sm text-on-surface">
                {products.find(p => p.id === deleteTargetId)?.name || 'Produto selecionado'}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteTargetId(null)}
                  className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(deleteTargetId)}
                  className="px-4 py-2 bg-error text-on-error rounded-lg text-sm font-bold hover:opacity-90 transition-all"
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
