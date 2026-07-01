import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, Edit2, Layers, Package, Plus, Trash2 } from 'lucide-react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { SearchableSelect, SelectOption } from '../components/SearchableSelect';
import toast from 'react-hot-toast';

interface ProductionFilament {
  id: string;
  filamentId: string;
  filamentName: string;
  quantityKg: number;
  productsCount?: number;
}

interface ProductionTable {
  id: string;
  tableName: string;
  scheduledAt: string;
  hours: number;
  productsCount: number;
  filaments: ProductionFilament[];
}

interface ProductionOrder {
  id: string;
  productName: string;
  productId?: string;
  modelUrl?: string;
  status: 'fila' | 'produzindo' | 'concluida';
  tables?: ProductionTable[];
  notes?: string;
  createdAt?: string;
  completedAt?: string;
  // Legacy fields kept for backward compatibility
  tablesCount?: number;
  scheduledAt?: string;
  hoursPerTable?: number;
  totalHours?: number;
  filaments?: ProductionFilament[];
}

interface FilamentOption {
  id: string;
  material: string;
  color: string;
  colorHex?: string;
  brand?: string;
}

interface ProductOption {
  id: string;
  name: string;
  category?: string;
  stock?: number;
  baseSku?: string;
  fixedCost?: number;
  technicalSheet?: {
    dimensions?: string;
    infillPercentage?: number;
    layerHeight?: number;
    supports?: boolean;
    postProcessing?: string;
  };
  variations?: any[];
  files?: any[];
  wastes?: any[];
}

const getLocalDateTimeString = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const getDurationMinutesFromHours = (hours?: number) => Math.max(0, Math.round((Number(hours) || 0) * 60));

const formatDurationLabel = (totalMinutes: number) => {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
};

const createFilamentEntry = (): ProductionFilament => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  filamentId: '',
  filamentName: '',
  quantityKg: 0,
});

const createTableEntry = (index = 1): ProductionTable => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  tableName: `Mesa ${index}`,
  scheduledAt: getLocalDateTimeString(),
  hours: 1,
  productsCount: 1,
  filaments: [createFilamentEntry()],
});

const getMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);

const buildCalendarDays = (viewDate: Date) => {
  const firstDay = startOfMonth(viewDate);
  const lastDay = endOfMonth(viewDate);
  const startWeekDay = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const cells: Array<{ date: Date; inMonth: boolean }> = [];

  for (let i = 0; i < startWeekDay; i += 1) {
    const d = new Date(firstDay);
    d.setDate(firstDay.getDate() - (startWeekDay - i));
    cells.push({ date: d, inMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(viewDate.getFullYear(), viewDate.getMonth(), day), inMonth: true });
  }

  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last);
    d.setDate(last.getDate() + 1);
    cells.push({ date: d, inMonth: false });
  }

  return cells;
};

const normalizeTable = (table: any, index: number): ProductionTable => ({
  id: table?.id || `legacy-table-${index}`,
  tableName: table?.tableName || `Mesa ${index + 1}`,
  scheduledAt: table?.scheduledAt || getLocalDateTimeString(),
  hours: Number(table?.hours) || Number(table?.hoursPerTable) || 0,
  productsCount: table?.productsCount !== undefined && table?.productsCount !== null
    ? Number(table.productsCount) || 0
    : (Array.isArray(table?.filaments)
      ? table.filaments.reduce((sum: number, item: any) => sum + (Number(item?.productsCount) || 0), 0)
      : 0),
  filaments: Array.isArray(table?.filaments) && table.filaments.length > 0
    ? table.filaments.map((item: any, itemIndex: number) => ({
        id: item?.id || `legacy-filament-${index}-${itemIndex}`,
        filamentId: item?.filamentId || '',
        filamentName: item?.filamentName || '',
        quantityKg: Number(item?.quantityKg) || 0,
      }))
    : [createFilamentEntry()],
});

const normalizeOrder = (order: ProductionOrder): ProductionOrder => {
  if (Array.isArray(order.tables) && order.tables.length > 0) {
    return {
      ...order,
      tables: order.tables.map((table, index) => normalizeTable(table, index)),
    };
  }

  return {
    ...order,
    tables: [
      {
        id: 'legacy-table-0',
        tableName: 'Mesa 1',
        scheduledAt: order.scheduledAt || getLocalDateTimeString(),
        hours: Number(order.hoursPerTable) || 0,
        productsCount: Array.isArray(order.filaments) && order.filaments.length > 0
          ? order.filaments.reduce((sum, item) => sum + (Number(item.productsCount) || 0), 0)
          : 0,
        filaments: Array.isArray(order.filaments) && order.filaments.length > 0
          ? order.filaments.map((item, index) => ({
              id: item.id || `legacy-filament-${index}`,
              filamentId: item.filamentId || '',
              filamentName: item.filamentName || '',
              quantityKg: Number(item.quantityKg) || 0,
            }))
          : [createFilamentEntry()],
      },
    ],
  };
};

const getOrderTables = (order: ProductionOrder) => normalizeOrder(order).tables || [];
const getOrderTotalHours = (order: ProductionOrder) => getOrderTables(order).reduce((acc, table) => acc + (Number(table.hours) || 0), 0);
const getOrderProducedUnits = (order: ProductionOrder) => {
  const total = getOrderTables(order).reduce((acc, table) => acc + (Number(table.productsCount) || 0), 0);
  return total;
};
const getOrderFirstSchedule = (order: ProductionOrder) => {
  const tables = getOrderTables(order);
  const sorted = [...tables].sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
  return sorted[0]?.scheduledAt || '';
};

export function AgendaProducao() {
  const { tenantId } = useAuth();
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [filaments, setFilaments] = useState<FilamentOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [showCalendar, setShowCalendar] = useState(false);
  const [openOrderIds, setOpenOrderIds] = useState<string[]>([]);
  const [openFormTableIds, setOpenFormTableIds] = useState<string[]>([]);

  const [formData, setFormData] = useState({
    productName: '',
    productId: '',
    modelUrl: '',
    tables: [createTableEntry(1)] as ProductionTable[],
    notes: '',
  });

  useEffect(() => {
    if (!tenantId) return;

    const unsubOrders = onSnapshot(collection(db, `tenants/${tenantId}/productionOrders`), (snapshot) => {
      const data = snapshot.docs.map(doc => normalizeOrder({ id: doc.id, ...doc.data() } as ProductionOrder));
      setOrders(data);
    }, (error) => {
      console.error('Error fetching production orders:', error);
      toast.error('Erro ao carregar agenda de producao.');
    });

    const unsubProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductOption)));
    });

    const unsubFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      setFilaments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FilamentOption)));
    });

    return () => {
      unsubOrders();
      unsubProducts();
      unsubFilaments();
    };
  }, [tenantId]);

  const filamentOptions: SelectOption[] = useMemo(() => {
    return filaments.map(filament => ({
      value: filament.id,
      label: `${filament.material} ${filament.color}`,
      group: filament.brand || 'Sem marca',
    }));
  }, [filaments]);

  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => getOrderFirstSchedule(a).localeCompare(getOrderFirstSchedule(b)));
  }, [orders]);

  const queueOrders = sortedOrders.filter(order => order.status !== 'concluida');
  const completedOrders = sortedOrders.filter(order => order.status === 'concluida');

  const calendarItemsByDay = useMemo(() => {
    const grouped: Record<string, Array<{ orderId: string; productName: string; status: ProductionOrder['status']; scheduledAt: string; tableName: string }>> = {};

    sortedOrders.forEach(order => {
      getOrderTables(order).forEach(table => {
        const key = (table.scheduledAt || '').slice(0, 10);
        if (!key) return;
        grouped[key] = [
          ...(grouped[key] || []),
          {
            orderId: order.id,
            productName: order.productName,
            status: order.status,
            scheduledAt: table.scheduledAt,
            tableName: table.tableName,
          }
        ];
      });
    });

    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    });

    return grouped;
  }, [sortedOrders]);

  const calendarCells = useMemo(() => buildCalendarDays(calendarDate), [calendarDate]);
  const totalQueuedHours = queueOrders.reduce((acc, order) => acc + getOrderTotalHours(order), 0);
  const totalQueuedMinutes = getDurationMinutesFromHours(totalQueuedHours);

  const toggleOrder = (orderId: string) => {
    setOpenOrderIds(prev => prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]);
  };

  const resetForm = () => {
    setEditingId(null);
    const initialTable = createTableEntry(1);
    setOpenFormTableIds([initialTable.id]);
    setFormData({
      productName: '',
      productId: '',
      modelUrl: '',
      tables: [initialTable],
      notes: '',
    });
  };

  const buildOrderVariation = (order: ProductionOrder) => {
    const orderTables = getOrderTables(order);
    const variationMaterials = orderTables.flatMap((table, tableIndex) =>
      table.filaments
        .filter(item => item.filamentId)
        .map((item, filamentIndex) => ({
          id: `${table.id || tableIndex}-${item.id || filamentIndex}`,
          filamentId: item.filamentId,
          weightGrams: Number((Number(item.quantityKg || 0) * 1000).toFixed(2)),
          purgeGrams: 0,
          objectName: table.tableName || `Mesa ${tableIndex + 1}`,
          pieces: filamentIndex === 0 ? (Number(table.productsCount) || 0) : 0,
          printTimeHours: Number(table.hours) || 0,
          startTime: table.scheduledAt || '',
        })),
    );

    const firstFilament = filaments.find(item => item.id === variationMaterials[0]?.filamentId);
    const uniqueColors = Array.from(
      new Set(
        variationMaterials
          .map(item => filaments.find(filament => filament.id === item.filamentId)?.color)
          .filter(Boolean),
      ),
    ) as string[];
    const totalWeightGrams = variationMaterials.reduce((sum, item) => sum + (Number(item.weightGrams) || 0), 0);
    const totalHours = orderTables.reduce((sum, table) => sum + (Number(table.hours) || 0), 0);
    const totalPieces = getOrderProducedUnits(order);

    return {
      id: `agenda-${order.id}`,
      skuSuffix: '-AGD',
      color: uniqueColors.length === 1 ? uniqueColors[0] : uniqueColors.length > 1 ? 'Misto' : 'Padrão',
      material: firstFilament?.material || 'PLA',
      materials: variationMaterials,
      weightGrams: Number(totalWeightGrams.toFixed(2)),
      printTimeHours: Number(totalHours.toFixed(2)),
      quantityPerPrint: totalPieces > 0 ? totalPieces : 1,
      filamentId: variationMaterials[0]?.filamentId || '',
      printerId: '',
      materialCostPerGram: 0,
      printerCostPerHour: 0,
      channelPrices: [],
    };
  };

  const buildOrderFiles = (order: ProductionOrder) => {
    if (!order.modelUrl) return [];
    return [
      {
        id: `agenda-link-${order.id}`,
        name: 'Referencia do Modelo',
        type: 'PDF',
        url: order.modelUrl,
        version: '1.0',
      }
    ];
  };

  const openEditForm = (order: ProductionOrder) => {
    const normalizedOrder = normalizeOrder(order);
    const nextTables = normalizedOrder.tables?.map((table, tableIndex) => ({
      ...table,
      id: table.id || `${Date.now()}-${tableIndex}`,
      filaments: table.filaments.length > 0
        ? table.filaments.map((entry, entryIndex) => ({
            ...entry,
            id: entry.id || `${Date.now()}-${tableIndex}-${entryIndex}`,
          }))
        : [createFilamentEntry()],
    })) || [createTableEntry(1)];
    setEditingId(order.id);
    setOpenFormTableIds(nextTables.map(table => table.id));
    setFormData({
      productName: normalizedOrder.productName || '',
      productId: normalizedOrder.productId || '',
      modelUrl: normalizedOrder.modelUrl || '',
      notes: normalizedOrder.notes || '',
      tables: nextTables,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectProduct = (value: string) => {
    const product = products.find(item => item.id === value);
    setFormData(prev => ({
      ...prev,
      productId: value,
      productName: product?.name || prev.productName,
    }));
  };

  const updateTable = (tableId: string, field: keyof ProductionTable, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      tables: prev.tables.map(table => table.id === tableId ? { ...table, [field]: value } : table),
    }));
  };

  const addTable = () => {
    const newTable = createTableEntry(formData.tables.length + 1);
    setFormData(prev => ({
      ...prev,
      tables: [...prev.tables, newTable],
    }));
    setOpenFormTableIds(prev => [...prev, newTable.id]);
  };

  const removeTable = (tableId: string) => {
    setFormData(prev => ({
      ...prev,
      tables: prev.tables.length > 1
        ? prev.tables.filter(table => table.id !== tableId)
        : [createTableEntry(1)],
    }));
    setOpenFormTableIds(prev => prev.filter(id => id !== tableId));
  };

  const updateFilamentEntry = (tableId: string, entryId: string, field: keyof ProductionFilament, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      tables: prev.tables.map(table => {
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
          })
        };
      })
    }));
  };

  const addFilamentEntry = (tableId: string) => {
    setFormData(prev => ({
      ...prev,
      tables: prev.tables.map(table => table.id === tableId
        ? { ...table, filaments: [...table.filaments, createFilamentEntry()] }
        : table),
    }));
  };

  const removeFilamentEntry = (tableId: string, entryId: string) => {
    setFormData(prev => ({
      ...prev,
      tables: prev.tables.map(table => {
        if (table.id !== tableId) return table;
        const nextFilaments = table.filaments.length > 1
          ? table.filaments.filter(entry => entry.id !== entryId)
          : [createFilamentEntry()];
        return { ...table, filaments: nextFilaments };
      })
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const currentOrder = editingId ? orders.find(item => item.id === editingId) : null;
      const normalizedTables = formData.tables.map((table, index) => ({
        id: table.id,
        tableName: table.tableName || `Mesa ${index + 1}`,
        scheduledAt: table.scheduledAt || getLocalDateTimeString(),
        hours: Number(table.hours) || 0,
        filaments: table.filaments
          .map(entry => ({
            ...entry,
            filamentId: entry.filamentId || '',
            filamentName: entry.filamentName || '',
            quantityKg: Number(entry.quantityKg) || 0,
          }))
          .filter(entry => entry.filamentId && entry.quantityKg > 0),
        productsCount: Number(table.productsCount) || 0,
      }));

      const payload = {
        productName: formData.productName || 'Produto sem nome',
        productId: formData.productId || '',
        modelUrl: formData.modelUrl.trim(),
        tables: normalizedTables,
        status: currentOrder?.status || 'fila',
        notes: formData.notes || '',
        totalHours: normalizedTables.reduce((acc, table) => acc + (Number(table.hours) || 0), 0),
      };

      if (editingId) {
        await updateDoc(doc(db, `tenants/${tenantId}/productionOrders`, editingId), payload);
      } else {
        await addDoc(collection(db, `tenants/${tenantId}/productionOrders`), {
          ...payload,
          createdAt: new Date().toISOString(),
        });
      }

      toast.success(editingId ? 'Agendamento atualizado com sucesso!' : 'Produto adicionado na agenda de producao!');
      setShowForm(false);
      resetForm();
    } catch (error) {
      console.error('Error saving production order:', error);
      toast.error('Erro ao salvar agenda de producao.');
    }
  };

  const handleDelete = async (orderId: string) => {
    if (!tenantId) return;
    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/productionOrders`, orderId));
      toast.success('Item removido da agenda.');
    } catch (error) {
      console.error('Error deleting production order:', error);
      toast.error('Erro ao excluir item da agenda.');
    }
  };

  const handleStart = async (order: ProductionOrder) => {
    if (!tenantId) return;
    try {
      await updateDoc(doc(db, `tenants/${tenantId}/productionOrders`, order.id), {
        status: 'produzindo',
      });
    } catch (error) {
      console.error('Error starting production order:', error);
      toast.error('Erro ao iniciar producao.');
    }
  };

  const handleComplete = async (order: ProductionOrder) => {
    if (!tenantId) return;

    try {
      const batch = writeBatch(db);
      const existingProduct = products.find(product => product.id === order.productId)
        || products.find(product => product.name.trim().toLowerCase() === order.productName.trim().toLowerCase());
      const quantityToAdd = getOrderProducedUnits(order);
      const scheduledVariation = buildOrderVariation(order);
      const scheduledFiles = buildOrderFiles(order);
      const scheduledTables = getOrderTables(order).map(table => ({
        id: table.id,
        tableName: table.tableName,
        scheduledAt: table.scheduledAt,
        hours: Number(table.hours) || 0,
        filaments: table.filaments.map(filament => ({
          id: filament.id,
          filamentId: filament.filamentId,
          filamentName: filament.filamentName,
          quantityKg: Number(filament.quantityKg) || 0,
        })),
        productsCount: Number(table.productsCount) || 0,
      }));

      if (existingProduct) {
        const existingVariations = Array.isArray(existingProduct.variations) ? existingProduct.variations : [];
        const hasAgendaVariation = existingVariations.some((variation: any) => variation?.id === scheduledVariation.id);
        const existingFiles = Array.isArray(existingProduct.files) ? existingProduct.files : [];
        const hasModelFile = scheduledFiles.length > 0 && existingFiles.some((file: any) => file?.url === scheduledFiles[0].url);
        const existingTables = Array.isArray((existingProduct as any).productionTables) ? (existingProduct as any).productionTables : [];
        const nextTables = [
          ...existingTables.filter((table: any) => !scheduledTables.some(scheduled => scheduled.id === table?.id)),
          ...scheduledTables,
        ];
        batch.update(doc(db, `tenants/${tenantId}/products`, existingProduct.id), {
          stock: (Number(existingProduct.stock) || 0) + quantityToAdd,
          status: 'ativo',
          ...(hasAgendaVariation ? {} : { variations: [...existingVariations, scheduledVariation] }),
          ...(scheduledFiles.length > 0 && !hasModelFile ? { files: [...existingFiles, ...scheduledFiles] } : {}),
          productionTables: nextTables,
        });
      } else {
        const newProductRef = doc(collection(db, `tenants/${tenantId}/products`));
        batch.set(newProductRef, {
          name: order.productName,
          baseSku: `AGD-${Date.now().toString().slice(-6)}`,
          category: 'Agenda de Produção',
          status: 'ativo',
          fixedCost: 0,
          stock: quantityToAdd,
          technicalSheet: {
            dimensions: '',
            infillPercentage: 0,
            layerHeight: 0,
            supports: false,
            postProcessing: '',
          },
          variations: [scheduledVariation],
          files: scheduledFiles,
          wastes: [],
          productionTables: scheduledTables,
          createdAt: new Date().toISOString(),
        });
      }

      batch.update(doc(db, `tenants/${tenantId}/productionOrders`, order.id), {
        status: 'concluida',
        completedAt: new Date().toISOString(),
      });

      await batch.commit();
      toast.success('Produção concluída e produto enviado para a lista principal!');
    } catch (error) {
      console.error('Error completing production order:', error);
      toast.error('Erro ao concluir produção.');
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Agenda de Produção</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Cada produto agendado pode ter várias mesas, cada uma com horário, filamentos, quantidade de produtos e horas próprias.</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(!showForm);
          }}
          className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Novo Produto Agendado
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Fila Aberta</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{queueOrders.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Horas Planejadas</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{formatDurationLabel(totalQueuedMinutes)}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Produções Concluídas</h3>
          <p className="text-3xl font-headline font-bold text-primary tabular-nums">{completedOrders.length}</p>
        </div>
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="font-headline font-bold text-lg mb-6">{editingId ? 'Editar Produto na Agenda' : 'Novo Produto na Agenda'}</h3>
          <form className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" onSubmit={handleSave}>
            <div className="space-y-1.5 xl:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Produto</label>
              <input
                type="text"
                required
                value={formData.productName}
                onChange={e => setFormData(prev => ({ ...prev, productName: e.target.value }))}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                placeholder="Nome do produto"
              />
            </div>

            <div className="space-y-1.5 xl:col-span-2">
              <SearchableSelect
                label="Vincular com Produto Existente (Opcional)"
                options={products.map(product => ({ value: product.id, label: product.name, group: product.category || 'Produtos' }))}
                value={formData.productId}
                onChange={handleSelectProduct}
                placeholder="Selecionar produto já existente"
              />
            </div>

            <div className="space-y-1.5 xl:col-span-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Link do Modelo / Referência</label>
              <input
                type="url"
                value={formData.modelUrl}
                onChange={e => setFormData(prev => ({ ...prev, modelUrl: e.target.value }))}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                placeholder="https://makerworld.com/..."
              />
            </div>

            <div className="xl:col-span-4 space-y-4 border border-outline-variant/20 rounded-xl p-4 bg-surface-container-low">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-on-surface">Mesas do Produto</h4>
                  <p className="text-xs text-on-surface-variant">Cada mesa tem seu próprio horário, horas e filamentos.</p>
                </div>
                <button type="button" onClick={addTable} className="px-3 py-1.5 bg-primary text-on-primary rounded text-xs font-bold">
                  Adicionar Mesa
                </button>
              </div>

              <div className="space-y-4">
                {formData.tables.map((table, tableIndex) => (
                  <div key={table.id} className="space-y-4 rounded-xl border border-outline-variant/20 bg-surface-container p-4">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setOpenFormTableIds(prev => prev.includes(table.id) ? prev.filter(id => id !== table.id) : [...prev, table.id])}
                        className="flex-1 text-left"
                      >
                        <div className="text-sm font-bold text-on-surface">{table.tableName || `Mesa ${tableIndex + 1}`}</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest text-on-surface-variant">
                          <span>{formatDurationLabel(getDurationMinutesFromHours(table.hours))}</span>
                          <span>{table.filaments.length} filamento(s)</span>
                          <span>{(table.filaments.reduce((sum, filament) => sum + (Number(filament.quantityKg) || 0), 0) * 1000).toFixed(0)} g</span>
                          <span>{Number(table.productsCount || 0)} un</span>
                          <span className="text-primary">{openFormTableIds.includes(table.id) ? 'Fechar' : 'Abrir'}</span>
                        </div>
                      </button>
                      <button type="button" onClick={() => removeTable(table.id)} className="p-2 text-error hover:bg-surface-container-lowest rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {openFormTableIds.includes(table.id) && (
                      <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Mesa</label>
                        <input
                          type="text"
                          value={table.tableName}
                          onChange={e => updateTable(table.id, 'tableName', e.target.value)}
                          className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                          placeholder={`Mesa ${tableIndex + 1}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Duração da Mesa</label>
                        <input
                          type="text"
                          value={formatDurationLabel(getDurationMinutesFromHours(table.hours))}
                          readOnly
                          className="w-full bg-surface-container/50 border-none rounded p-2.5 text-sm text-on-surface-variant cursor-not-allowed tabular-nums outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data e Hora da Mesa</label>
                        <input
                          type="datetime-local"
                          value={table.scheduledAt}
                          onChange={e => updateTable(table.id, 'scheduledAt', e.target.value)}
                          className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd Produtos da Mesa</label>
                        <input
                          type="number"
                          min="0"
                          value={table.productsCount ?? ''}
                          onChange={e => updateTable(table.id, 'productsCount', Number(e.target.value) || 0)}
                          className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h6 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Filamentos da Mesa</h6>
                          <p className="text-xs text-on-surface-variant">Informe os filamentos e a quantidade consumida por esta mesa.</p>
                        </div>
                        <button type="button" onClick={() => addFilamentEntry(table.id)} className="px-3 py-1.5 bg-secondary-container text-on-secondary-container rounded text-xs font-bold">
                          Adicionar Filamento
                        </button>
                      </div>

                      <div className="space-y-3">
                        {table.filaments.map(entry => (
                          <div key={entry.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end bg-surface-container-lowest rounded-lg p-3">
                            <SearchableSelect
                              label="Filamento"
                              options={filamentOptions}
                              value={entry.filamentId}
                              onChange={(value) => updateFilamentEntry(table.id, entry.id, 'filamentId', value)}
                              placeholder="Selecionar filamento"
                            />
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd Filamento (Kg)</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={entry.quantityKg || ''}
                                onChange={e => updateFilamentEntry(table.id, entry.id, 'quantityKg', Number(e.target.value))}
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
                              <button type="button" onClick={() => removeFilamentEntry(table.id, entry.id)} className="p-2 text-error hover:bg-surface-container rounded">
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

            <div className="xl:col-span-4 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Observações</label>
              <textarea
                value={formData.notes}
                onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none min-h-[88px] resize-y"
                placeholder="Observações rápidas sobre o produto agendado..."
              />
            </div>

            <div className="xl:col-span-4 flex justify-end gap-3 pt-4 border-t border-outline-variant/20">
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="px-6 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="submit" className="px-8 py-2.5 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all">
                {editingId ? 'Salvar Alterações' : 'Salvar na Agenda'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-6">
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
          <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-headline font-bold text-lg flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                Fila de Produção
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">Visual mais enxuto, com detalhes das mesas só quando você abrir.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCalendar(prev => !prev)}
              className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-xs font-bold flex items-center gap-2"
            >
              <CalendarDays className="w-4 h-4 text-primary" />
              {showCalendar ? 'Ocultar Calendário' : 'Ver Calendário'}
            </button>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {queueOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-on-surface-variant">Nenhum item na fila de produção.</div>
            ) : (
              queueOrders.map(order => {
                const tables = getOrderTables(order);
                const totalFilamentKg = tables.reduce((sum, table) => sum + table.filaments.reduce((tableSum, filament) => tableSum + (Number(filament.quantityKg) || 0), 0), 0);
                const isOpen = openOrderIds.includes(order.id);
                return (
                  <div key={order.id} className="p-4 flex flex-col gap-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <button type="button" onClick={() => toggleOrder(order.id)} className="flex-1 text-left">
                        <div className="text-sm font-bold text-on-surface">{order.productName}</div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest text-on-surface-variant">
                          <span>{order.status === 'fila' ? 'Na fila' : 'Produzindo'}</span>
                          <span>{tables.length} mesa(s)</span>
                          <span>{getOrderProducedUnits(order)} produto(s)</span>
                          <span>{formatDurationLabel(getDurationMinutesFromHours(getOrderTotalHours(order)))}</span>
                          <span>{(totalFilamentKg * 1000).toFixed(0)} g</span>
                          <span className="text-primary">{isOpen ? 'Fechar detalhes' : 'Abrir detalhes'}</span>
                        </div>
                      </button>
                      <div className="flex flex-wrap gap-2">
                        {order.status === 'fila' && (
                          <button type="button" onClick={() => handleStart(order)} className="px-3 py-1.5 rounded text-xs font-bold bg-secondary-container text-on-secondary-container">
                            Iniciar
                          </button>
                        )}
                        <button type="button" onClick={() => openEditForm(order)} className="px-3 py-1.5 rounded text-xs font-bold bg-surface-container text-on-surface flex items-center gap-1.5">
                          <Edit2 className="w-3.5 h-3.5" />
                          Editar
                        </button>
                        <button type="button" onClick={() => handleComplete(order)} className="px-3 py-1.5 rounded text-xs font-bold bg-tertiary-fixed text-on-tertiary-fixed-variant">
                          Concluir e Enviar para Produtos
                        </button>
                        <button type="button" onClick={() => handleDelete(order.id)} className="px-3 py-1.5 rounded text-xs font-bold bg-error-container text-on-error-container">
                          Excluir
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="grid grid-cols-1 gap-3">
                        {tables.map(table => (
                          <div key={table.id} className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                              <div>
                                <div className="text-sm font-bold text-on-surface">{table.tableName}</div>
                                <div className="text-[10px] uppercase tracking-widest text-on-surface-variant mt-1">
                                  {new Date(table.scheduledAt).toLocaleString('pt-BR')}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span className="rounded-full bg-surface-container-lowest px-3 py-1 text-xs font-bold text-on-surface">
                                  {formatDurationLabel(getDurationMinutesFromHours(table.hours))}
                                </span>
                                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                                  {Number(table.productsCount || 0)} un
                                </span>
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              {table.filaments.length === 0 ? (
                                <span className="text-xs text-on-surface-variant italic">Nenhum filamento informado.</span>
                              ) : (
                                table.filaments.map(item => (
                                  <span key={item.id} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-lowest text-xs font-medium text-on-surface">
                                    <Package className="w-3.5 h-3.5 text-primary" />
                                    {filaments.find(filament => filament.id === item.filamentId)?.color || item.filamentName} • {(Number(item.quantityKg || 0) * 1000).toFixed(0)} g
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {order.notes && (
                      <div className="text-sm text-on-surface-variant bg-surface-container-low rounded-lg p-3">
                        {order.notes}
                      </div>
                    )}

                    {order.modelUrl && (
                      <a
                        href={order.modelUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Abrir referência do modelo
                      </a>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {showCalendar && (
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
          <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-headline font-bold text-lg flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-primary" />
                Calendário
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">Cada mesa aparece como um evento separado no calendário.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} className="px-2 py-1 bg-surface-container rounded text-sm font-bold">‹</button>
              <div className="text-sm font-bold text-on-surface min-w-[120px] text-center capitalize">
                {calendarDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </div>
              <button type="button" onClick={() => setCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} className="px-2 py-1 bg-surface-container rounded text-sm font-bold">›</button>
            </div>
          </div>

          <div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/10">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
              <div key={day} className="p-3">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarCells.map(({ date }) => {
              const key = date.toISOString().slice(0, 10);
              const dayOrders = calendarItemsByDay[key] || [];
              const isCurrentMonth = getMonthKey(date) === getMonthKey(calendarDate);

              return (
                <div key={key} className={`min-h-[120px] border-b border-r border-outline-variant/10 p-2 ${isCurrentMonth ? 'bg-transparent' : 'bg-surface-container/40 text-on-surface-variant/40'}`}>
                  <div className="text-xs font-bold mb-2">{date.getDate()}</div>
                  <div className="space-y-1">
                    {dayOrders.slice(0, 3).map(item => (
                      <div key={`${item.orderId}-${item.tableName}-${item.scheduledAt}`} className={`rounded px-2 py-1 text-[10px] ${item.status === 'concluida' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : item.status === 'produzindo' ? 'bg-secondary-container text-on-secondary-container' : 'bg-primary/10 text-primary'}`}>
                        <div className="font-bold truncate">{item.productName}</div>
                        <div className="truncate">{item.tableName}</div>
                        <div className="tabular-nums">{new Date(item.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    ))}
                    {dayOrders.length > 3 && (
                      <div className="text-[10px] text-on-surface-variant font-bold">+{dayOrders.length - 3} mesas</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
