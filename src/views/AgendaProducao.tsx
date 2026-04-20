import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, Plus, Trash2, Layers, Package } from 'lucide-react';
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
}

interface ProductionOrder {
  id: string;
  productName: string;
  productId?: string;
  tablesCount: number;
  scheduledAt: string;
  hoursPerTable: number;
  totalHours: number;
  status: 'fila' | 'produzindo' | 'concluida';
  filaments: ProductionFilament[];
  notes?: string;
  createdAt?: string;
  completedAt?: string;
}

interface FilamentOption {
  id: string;
  material: string;
  color: string;
  brand?: string;
}

interface ProductOption {
  id: string;
  name: string;
  baseSku?: string;
  status?: string;
  stock?: number;
}

const getLocalDateTimeString = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

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

export function AgendaProducao() {
  const { tenantId } = useAuth();
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [filaments, setFilaments] = useState<FilamentOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());

  const [formData, setFormData] = useState({
    productName: '',
    productId: '',
    tablesCount: 1,
    scheduledAt: getLocalDateTimeString(),
    hoursPerTable: 1,
    filaments: [{ id: Date.now().toString(), filamentId: '', filamentName: '', quantityKg: 0 }] as ProductionFilament[],
    notes: '',
  });

  useEffect(() => {
    if (!tenantId) return;

    const unsubOrders = onSnapshot(collection(db, `tenants/${tenantId}/productionOrders`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionOrder));
      setOrders(data);
    }, (error) => {
      console.error('Error fetching production orders:', error);
      toast.error('Erro ao carregar agenda de producao.');
    });

    const unsubProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductOption));
      setProducts(data);
    });

    const unsubFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FilamentOption));
      setFilaments(data);
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
    return [...orders].sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
  }, [orders]);

  const queueOrders = sortedOrders.filter(order => order.status !== 'concluida');
  const completedOrders = sortedOrders.filter(order => order.status === 'concluida');

  const calendarItemsByDay = useMemo(() => {
    const grouped: Record<string, ProductionOrder[]> = {};
    sortedOrders.forEach(order => {
      if (!order.scheduledAt) return;
      const key = order.scheduledAt.slice(0, 10);
      grouped[key] = [...(grouped[key] || []), order];
    });
    return grouped;
  }, [sortedOrders]);

  const calendarCells = useMemo(() => buildCalendarDays(calendarDate), [calendarDate]);

  const totalQueuedHours = queueOrders.reduce((acc, order) => acc + (Number(order.totalHours) || 0), 0);

  const resetForm = () => {
    setFormData({
      productName: '',
      productId: '',
      tablesCount: 1,
      scheduledAt: getLocalDateTimeString(),
      hoursPerTable: 1,
      filaments: [{ id: Date.now().toString(), filamentId: '', filamentName: '', quantityKg: 0 }],
      notes: '',
    });
  };

  const updateFilamentEntry = (entryId: string, field: keyof ProductionFilament, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      filaments: prev.filaments.map(entry => {
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
    }));
  };

  const addFilamentEntry = () => {
    setFormData(prev => ({
      ...prev,
      filaments: [...prev.filaments, { id: Date.now().toString(), filamentId: '', filamentName: '', quantityKg: 0 }]
    }));
  };

  const removeFilamentEntry = (entryId: string) => {
    setFormData(prev => ({
      ...prev,
      filaments: prev.filaments.length > 1
        ? prev.filaments.filter(entry => entry.id !== entryId)
        : [{ id: Date.now().toString(), filamentId: '', filamentName: '', quantityKg: 0 }]
    }));
  };

  const handleSelectProduct = (value: string) => {
    const product = products.find(item => item.id === value);
    setFormData(prev => ({
      ...prev,
      productId: value,
      productName: product?.name || prev.productName,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const normalizedFilaments = formData.filaments
        .map(entry => ({
          ...entry,
          filamentId: entry.filamentId || '',
          filamentName: entry.filamentName || '',
          quantityKg: Number(entry.quantityKg) || 0,
        }))
        .filter(entry => entry.filamentId && entry.quantityKg > 0);

      const tablesCount = Number(formData.tablesCount) || 1;
      const hoursPerTable = Number(formData.hoursPerTable) || 0;

      await addDoc(collection(db, `tenants/${tenantId}/productionOrders`), {
        productName: formData.productName || 'Produto sem nome',
        productId: formData.productId || '',
        tablesCount,
        scheduledAt: formData.scheduledAt || getLocalDateTimeString(),
        hoursPerTable,
        totalHours: tablesCount * hoursPerTable,
        filaments: normalizedFilaments,
        notes: formData.notes || '',
        status: 'fila',
        createdAt: new Date().toISOString(),
      });

      toast.success('Item adicionado na agenda de producao!');
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
      const existingProduct = products.find(product => product.name.trim().toLowerCase() === order.productName.trim().toLowerCase());
      const quantityToAdd = Number(order.tablesCount) || 1;

      if (existingProduct) {
        batch.update(doc(db, `tenants/${tenantId}/products`, existingProduct.id), {
          stock: (Number(existingProduct.stock) || 0) + quantityToAdd,
          status: 'ativo',
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
          variations: [],
          files: [],
          wastes: [],
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
          <p className="text-on-surface-variant font-sans text-sm mt-1">Adicione as mesas, filamentos, horas por mesa e o horário de início em uma fila simples com calendário.</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(!showForm);
          }}
          className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Novo Agendamento
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Fila Aberta</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{queueOrders.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Horas Planejadas</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{totalQueuedHours.toFixed(1)} h</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Produções Concluídas</h3>
          <p className="text-3xl font-headline font-bold text-primary tabular-nums">{completedOrders.length}</p>
        </div>
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="font-headline font-bold text-lg mb-6">Novo Item da Agenda</h3>
          <form className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" onSubmit={handleSave}>
            <div className="space-y-1.5 xl:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Produto</label>
              <input
                type="text"
                required
                value={formData.productName}
                onChange={e => setFormData(prev => ({ ...prev, productName: e.target.value }))}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                placeholder="Nome do produto que vai entrar na fila"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd de Mesas</label>
              <input
                type="number"
                min="1"
                value={formData.tablesCount}
                onChange={e => setFormData(prev => ({ ...prev, tablesCount: Number(e.target.value) || 1 }))}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Horas por Mesa</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.hoursPerTable}
                onChange={e => setFormData(prev => ({ ...prev, hoursPerTable: Number(e.target.value) || 0 }))}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
              />
            </div>

            <div className="space-y-1.5 xl:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data e Hora de Início da Mesa</label>
              <input
                type="datetime-local"
                value={formData.scheduledAt}
                onChange={e => setFormData(prev => ({ ...prev, scheduledAt: e.target.value }))}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
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

            <div className="xl:col-span-4 space-y-3 border border-outline-variant/20 rounded-xl p-4 bg-surface-container-low">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-on-surface">Filamentos Planejados</h4>
                  <p className="text-xs text-on-surface-variant">Informe os filamentos e quanto será consumido neste item da agenda.</p>
                </div>
                <button type="button" onClick={addFilamentEntry} className="px-3 py-1.5 bg-primary text-on-primary rounded text-xs font-bold">
                  Adicionar Filamento
                </button>
              </div>

              <div className="space-y-3">
                {formData.filaments.map(entry => (
                  <div key={entry.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end bg-surface-container rounded-lg p-3">
                    <SearchableSelect
                      label="Filamento"
                      options={filamentOptions}
                      value={entry.filamentId}
                      onChange={(value) => updateFilamentEntry(entry.id, 'filamentId', value)}
                      placeholder="Selecionar filamento"
                    />
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd de Filamento (Kg)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={entry.quantityKg || ''}
                        onChange={e => updateFilamentEntry(entry.id, 'quantityKg', Number(e.target.value))}
                        className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-on-surface-variant">{entry.filamentName || 'Sem filamento selecionado'}</div>
                      <button type="button" onClick={() => removeFilamentEntry(entry.id)} className="p-2 text-error hover:bg-surface-container-lowest rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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
                placeholder="Anotações rápidas sobre prioridade, acabamento ou máquina..."
              />
            </div>

            <div className="xl:col-span-4 flex justify-end gap-3 pt-4 border-t border-outline-variant/20">
              <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors">
                Cancelar
              </button>
              <button type="submit" className="px-8 py-2.5 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all">
                Salvar na Agenda
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-6">
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
          <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-headline font-bold text-lg flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                Fila de Produção
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">Itens ordenados por data e hora de produção.</p>
            </div>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {queueOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-on-surface-variant">Nenhum item na fila de produção.</div>
            ) : (
              queueOrders.map(order => (
                <div key={order.id} className="p-4 flex flex-col gap-3">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-on-surface">{order.productName}</div>
                      <div className="text-[10px] uppercase tracking-widest text-on-surface-variant mt-1">
                        {order.status === 'fila' ? 'Na fila' : 'Produzindo'} • {new Date(order.scheduledAt).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {order.status === 'fila' && (
                        <button type="button" onClick={() => handleStart(order)} className="px-3 py-1.5 rounded text-xs font-bold bg-secondary-container text-on-secondary-container">
                          Iniciar
                        </button>
                      )}
                      <button type="button" onClick={() => handleComplete(order)} className="px-3 py-1.5 rounded text-xs font-bold bg-tertiary-fixed text-on-tertiary-fixed-variant">
                        Concluir e Enviar para Produtos
                      </button>
                      <button type="button" onClick={() => handleDelete(order.id)} className="px-3 py-1.5 rounded text-xs font-bold bg-error-container text-on-error-container">
                        Excluir
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-surface-container p-3 rounded-lg">
                      <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Mesas</div>
                      <div className="text-lg font-bold text-on-surface tabular-nums">{order.tablesCount}</div>
                    </div>
                    <div className="bg-surface-container p-3 rounded-lg">
                      <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Horas por Mesa</div>
                      <div className="text-lg font-bold text-on-surface tabular-nums">{Number(order.hoursPerTable || 0).toFixed(1)} h</div>
                    </div>
                    <div className="bg-surface-container p-3 rounded-lg">
                      <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Horas Totais</div>
                      <div className="text-lg font-bold text-primary tabular-nums">{Number(order.totalHours || 0).toFixed(1)} h</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {order.filaments.length === 0 ? (
                      <span className="text-xs text-on-surface-variant italic">Nenhum filamento informado.</span>
                    ) : (
                      order.filaments.map(item => (
                        <span key={item.id} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container text-xs font-medium text-on-surface">
                          <Package className="w-3.5 h-3.5 text-primary" />
                          {item.filamentName} • {Number(item.quantityKg || 0).toFixed(2)} kg
                        </span>
                      ))
                    )}
                  </div>

                  {order.notes && (
                    <div className="text-sm text-on-surface-variant bg-surface-container-low rounded-lg p-3">
                      {order.notes}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden">
          <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-headline font-bold text-lg flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-primary" />
                Calendário
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">Visualização simples da fila por data.</p>
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
            {calendarCells.map(({ date, inMonth }) => {
              const key = date.toISOString().slice(0, 10);
              const dayOrders = calendarItemsByDay[key] || [];
              const isCurrentMonth = getMonthKey(date) === getMonthKey(calendarDate);

              return (
                <div key={key} className={`min-h-[120px] border-b border-r border-outline-variant/10 p-2 ${isCurrentMonth ? 'bg-transparent' : 'bg-surface-container/40 text-on-surface-variant/40'}`}>
                  <div className="text-xs font-bold mb-2">{date.getDate()}</div>
                  <div className="space-y-1">
                    {dayOrders.slice(0, 3).map(order => (
                      <div key={order.id} className={`rounded px-2 py-1 text-[10px] ${order.status === 'concluida' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : order.status === 'produzindo' ? 'bg-secondary-container text-on-secondary-container' : 'bg-primary/10 text-primary'}`}>
                        <div className="font-bold truncate">{order.productName}</div>
                        <div className="tabular-nums">{new Date(order.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    ))}
                    {dayOrders.length > 3 && (
                      <div className="text-[10px] text-on-surface-variant font-bold">+{dayOrders.length - 3} itens</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
