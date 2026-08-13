import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Calculator, CheckCircle2, Clock3, Edit2, FileText, ImagePlus, Link as LinkIcon, Package, Plus, Printer, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { SearchableSelect, SelectOption } from '../components/SearchableSelect';
import toast from 'react-hot-toast';
import { DEFAULT_PRICING_SETTINGS, type PricingPrinterLike, type PricingSettings, calculateVariationUnitCostBreakdown, normalizePricingSettings } from '../utils/pricing';

type RequestType = 'orcamento' | 'encomenda';
type RequestStatus = 'aguardando-orcamento' | 'orcado' | 'fila-producao' | 'produzindo' | 'finalizado';
type RequestSourceChannel = 'manual' | 'whatsapp';

interface RequestFilament {
  id: string;
  filamentId: string;
  filamentName: string;
  weightGrams: number;
}

interface CustomRequest {
  id: string;
  title: string;
  type: RequestType;
  status: RequestStatus;
  sourceChannel?: RequestSourceChannel;
  customerName?: string;
  customerPhone?: string;
  sourceMessage?: string;
  description: string;
  requestedQuantity: number;
  productionTimeHours: number;
  printerId: string;
  filaments: RequestFilament[];
  referenceImageUrl?: string;
  quoteMediaImageUrl?: string;
  quoteMediaUrl?: string;
  estimatedUnitCost?: number;
  suggestedUnitPrice?: number;
  quotedPrice?: number;
  createdAt?: string;
  quoteSentAt?: string;
  approvedAt?: string;
  paidAt?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

interface FilamentOption {
  id: string;
  material: string;
  color: string;
  brand?: string;
  colorHex?: string;
  pricePerKg?: number;
}

interface PrinterOption extends PricingPrinterLike {
  id: string;
  name: string;
  model: string;
}

const REQUEST_TYPE_OPTIONS: Array<{ value: RequestType; label: string }> = [
  { value: 'orcamento', label: 'Orçamento' },
  { value: 'encomenda', label: 'Encomenda' },
];

const STATUS_OPTIONS: Array<{ value: RequestStatus; label: string }> = [
  { value: 'aguardando-orcamento', label: 'Aguardando orçamento' },
  { value: 'orcado', label: 'Orçado' },
  { value: 'fila-producao', label: 'Fila de produção' },
  { value: 'produzindo', label: 'Produzindo' },
  { value: 'finalizado', label: 'Finalizado' },
];

const SUGGESTED_MARKUP_MULTIPLIER = 2.2;

const createFilamentEntry = (): RequestFilament => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  filamentId: '',
  filamentName: '',
  weightGrams: 0,
});

const getDefaultFormData = (): Omit<CustomRequest, 'id'> => ({
  title: '',
  type: 'orcamento',
  status: 'aguardando-orcamento',
  sourceChannel: 'manual',
  customerName: '',
  customerPhone: '',
  sourceMessage: '',
  description: '',
  requestedQuantity: 1,
  productionTimeHours: 0,
  printerId: '',
  filaments: [createFilamentEntry()],
  referenceImageUrl: '',
  quoteMediaImageUrl: '',
  quoteMediaUrl: '',
  estimatedUnitCost: 0,
  suggestedUnitPrice: 0,
  quotedPrice: 0,
  createdAt: '',
  quoteSentAt: '',
  approvedAt: '',
  paidAt: '',
  startedAt: '',
  completedAt: '',
});

const getStatusClasses = (status: RequestStatus) => {
  switch (status) {
    case 'finalizado':
      return 'bg-emerald-100 text-emerald-700';
    case 'produzindo':
      return 'bg-amber-100 text-amber-700';
    case 'fila-producao':
      return 'bg-sky-100 text-sky-700';
    case 'orcado':
      return 'bg-primary/10 text-primary';
    case 'aguardando-orcamento':
    default:
      return 'bg-slate-200 text-slate-700';
  }
};

const formatCurrency = (value?: number) => `R$ ${(Number(value) || 0).toFixed(2)}`;
const formatDateLabel = (value?: string) => {
  if (!value) return 'Nao informado';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR');
};

const formatDateTimeInputValue = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.length >= 16 ? value.slice(0, 16) : value;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export function EncomendasOrcamentos() {
  const { tenantId } = useAuth();
  const [requests, setRequests] = useState<CustomRequest[]>([]);
  const [filaments, setFilaments] = useState<FilamentOption[]>([]);
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [energyPrice, setEnergyPrice] = useState(0.95);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(DEFAULT_PRICING_SETTINGS);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RequestStatus>('all');
  const [formData, setFormData] = useState<Omit<CustomRequest, 'id'>>(getDefaultFormData());
  const [isQuotePriceManual, setIsQuotePriceManual] = useState(false);

  useEffect(() => {
    if (!tenantId) return;

    const unsubRequests = onSnapshot(collection(db, `tenants/${tenantId}/customRequests`), (snapshot) => {
      setRequests(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as CustomRequest)));
    }, (error) => {
      console.error('Error fetching custom requests:', error);
      toast.error('Erro ao carregar encomendas e orçamentos.');
    });

    const unsubFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      setFilaments(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as FilamentOption)));
    });

    const unsubPrinters = onSnapshot(collection(db, `tenants/${tenantId}/printers`), (snapshot) => {
      setPrinters(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as PrinterOption)));
    });

    const unsubPrinterSettings = onSnapshot(doc(db, `tenants/${tenantId}/settings/printer`), (snapshot) => {
      if (snapshot.exists() && snapshot.data().energyPrice !== undefined) {
        setEnergyPrice(Number(snapshot.data().energyPrice) || 0.95);
      }
    });

    const unsubPricingSettings = onSnapshot(doc(db, `tenants/${tenantId}/settings/pricing`), (snapshot) => {
      setPricingSettings(normalizePricingSettings(snapshot.exists() ? (snapshot.data() as Partial<PricingSettings>) : null));
    });

    return () => {
      unsubRequests();
      unsubFilaments();
      unsubPrinters();
      unsubPrinterSettings();
      unsubPricingSettings();
    };
  }, [tenantId]);

  const filamentOptions: SelectOption[] = useMemo(() => {
    return filaments.map(item => ({
      value: item.id,
      label: `${item.material} ${item.color}`,
      group: item.brand || 'Sem marca',
    }));
  }, [filaments]);

  const printerOptions: SelectOption[] = useMemo(() => {
    return printers.map(item => ({
      value: item.id,
      label: `${item.name} (${item.model})`,
      group: item.status || 'operacional',
    }));
  }, [printers]);

  const pricingPreview = useMemo(() => {
    const materials = (formData.filaments || [])
      .filter(item => item.filamentId && Number(item.weightGrams) > 0)
      .map(item => ({
        filamentId: item.filamentId,
        weightGrams: Number(item.weightGrams) || 0,
        purgeGrams: 0,
      }));

    if (materials.length === 0 || Number(formData.productionTimeHours) <= 0) {
      return {
        estimatedUnitCost: 0,
        suggestedUnitPrice: 0,
        totalSuggestedPrice: 0,
      };
    }

    const breakdown = calculateVariationUnitCostBreakdown({
      variation: {
        printerId: formData.printerId || '',
        printTimeHours: Number(formData.productionTimeHours) || 0,
        quantityPerPrint: 1,
        materials,
      },
      fixedCost: 0,
      filaments,
      printers,
      energyPrice,
      pricingSettings,
    });

    const estimatedUnitCost = Number(breakdown.total.toFixed(2));
    const suggestedUnitPrice = Number((estimatedUnitCost * SUGGESTED_MARKUP_MULTIPLIER).toFixed(2));
    const totalSuggestedPrice = Number((suggestedUnitPrice * Math.max(1, Number(formData.requestedQuantity) || 1)).toFixed(2));

    return {
      estimatedUnitCost,
      suggestedUnitPrice,
      totalSuggestedPrice,
    };
  }, [energyPrice, filaments, formData.filaments, formData.printerId, formData.productionTimeHours, formData.requestedQuantity, pricingSettings, printers]);

  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      estimatedUnitCost: pricingPreview.estimatedUnitCost,
      suggestedUnitPrice: pricingPreview.suggestedUnitPrice,
      quotedPrice: isQuotePriceManual
        ? prev.quotedPrice
        : pricingPreview.totalSuggestedPrice,
    }));
  }, [isQuotePriceManual, pricingPreview]);

  const filteredRequests = useMemo(() => {
    return requests
      .filter(item => statusFilter === 'all' || item.status === statusFilter)
      .filter(item => {
        const haystack = `${item.title} ${item.description}`.toLowerCase();
        return haystack.includes(search.trim().toLowerCase());
      })
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  }, [requests, search, statusFilter]);

  const resetForm = () => {
    setFormData(getDefaultFormData());
    setEditingId(null);
    setIsQuotePriceManual(false);
  };

  const updateFilament = (entryId: string, field: keyof RequestFilament, value: string | number) => {
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

        return {
          ...entry,
          [field]: field === 'weightGrams' ? Number(value) || 0 : value,
        };
      }),
    }));
  };

  const addFilament = () => {
    setFormData(prev => ({
      ...prev,
      filaments: [...prev.filaments, createFilamentEntry()],
    }));
  };

  const removeFilament = (entryId: string) => {
    setFormData(prev => ({
      ...prev,
      filaments: prev.filaments.length > 1
        ? prev.filaments.filter(entry => entry.id !== entryId)
        : [createFilamentEntry()],
    }));
  };

  const readImageFile = (file: File, onLoad: (result: string) => void) => {
    if (file.size > 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 1MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      onLoad(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const payload = {
        title: formData.title.trim(),
        type: formData.type,
        status: formData.status,
        sourceChannel: formData.sourceChannel || 'manual',
        customerName: formData.customerName?.trim() || '',
        customerPhone: formData.customerPhone?.trim() || '',
        sourceMessage: formData.sourceMessage?.trim() || '',
        description: formData.description.trim(),
        requestedQuantity: Math.max(1, Number(formData.requestedQuantity) || 1),
        productionTimeHours: Number(formData.productionTimeHours) || 0,
        printerId: formData.printerId || '',
        filaments: formData.filaments
          .map(entry => ({
            ...entry,
            weightGrams: Number(entry.weightGrams) || 0,
          }))
          .filter(entry => entry.filamentId && entry.weightGrams > 0),
        referenceImageUrl: formData.referenceImageUrl || '',
        quoteMediaImageUrl: formData.quoteMediaImageUrl || '',
        quoteMediaUrl: formData.quoteMediaUrl?.trim() || '',
        estimatedUnitCost: pricingPreview.estimatedUnitCost,
        suggestedUnitPrice: pricingPreview.suggestedUnitPrice,
        quotedPrice: Number(formData.quotedPrice) || pricingPreview.totalSuggestedPrice,
        createdAt: formData.createdAt || new Date().toISOString(),
        quoteSentAt: formData.quoteSentAt || '',
        approvedAt: formData.approvedAt || '',
        paidAt: formData.paidAt || '',
        startedAt: formData.startedAt || '',
        completedAt: formData.completedAt || '',
        updatedAt: new Date().toISOString(),
      };

      if (editingId) {
        await updateDoc(doc(db, `tenants/${tenantId}/customRequests`, editingId), payload);
        toast.success('Item atualizado com sucesso!');
      } else {
        await addDoc(collection(db, `tenants/${tenantId}/customRequests`), payload);
        toast.success('Solicitação cadastrada com sucesso!');
      }

      setShowForm(false);
      resetForm();
    } catch (error) {
      console.error('Error saving custom request:', error);
      toast.error('Erro ao salvar solicitação.');
    }
  };

  const handleEdit = (request: CustomRequest) => {
    setEditingId(request.id);
    setFormData({
      ...getDefaultFormData(),
      ...request,
      filaments: request.filaments && request.filaments.length > 0 ? request.filaments : [createFilamentEntry()],
    });
    setIsQuotePriceManual(Number(request.quotedPrice) > 0 && Number(request.quotedPrice) !== Number((request.suggestedUnitPrice || 0) * Math.max(1, request.requestedQuantity || 1)));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (requestId: string) => {
    if (!tenantId || !window.confirm('Tem certeza que deseja excluir esta solicitação?')) return;

    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/customRequests`, requestId));
      toast.success('Solicitação excluída com sucesso!');
    } catch (error) {
      console.error('Error deleting custom request:', error);
      toast.error('Erro ao excluir solicitação.');
    }
  };

  const statusCounts = useMemo(() => {
    return STATUS_OPTIONS.reduce((acc, option) => {
      acc[option.value] = requests.filter(item => item.status === option.value).length;
      return acc;
    }, {} as Record<RequestStatus, number>);
  }, [requests]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Encomendas e Orçamentos</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Suba a solicitação, anexe referência, calcule o orçamento e acompanhe a fila de produção em um lugar só.</p>
        </div>
        <button
          onClick={() => {
            if (showForm && !editingId) {
              setShowForm(false);
              return;
            }
            resetForm();
            setShowForm(true);
          }}
          className="w-full sm:w-auto px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-md hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nova Solicitação
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/20 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Total</div>
          <div className="text-2xl font-headline font-bold text-on-surface">{requests.length}</div>
        </div>
        {STATUS_OPTIONS.map(option => (
          <div key={option.value} className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/20 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">{option.label}</div>
            <div className="text-2xl font-headline font-bold text-on-surface">{statusCounts[option.value] || 0}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm space-y-6">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h3 className="font-headline font-bold text-lg">{editingId ? 'Editar Solicitação' : 'Nova Solicitação'}</h3>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Nome da Solicitação</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                  placeholder="Ex: Logo para clínica, topper, brindes..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Tipo</label>
                <select
                  value={formData.type}
                  onChange={e => setFormData(prev => ({ ...prev, type: e.target.value as RequestType }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                >
                  {REQUEST_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Status</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData(prev => ({ ...prev, status: e.target.value as RequestStatus }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                >
                  {STATUS_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Cliente</label>
                <input
                  type="text"
                  value={formData.customerName || ''}
                  onChange={e => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                  placeholder="Nome do cliente"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Telefone / WhatsApp</label>
                <input
                  type="text"
                  value={formData.customerPhone || ''}
                  onChange={e => setFormData(prev => ({ ...prev, customerPhone: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                  placeholder="(13) 99999-9999"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Origem</label>
                <select
                  value={formData.sourceChannel || 'manual'}
                  onChange={e => setFormData(prev => ({ ...prev, sourceChannel: e.target.value as RequestSourceChannel }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                >
                  <option value="manual">Manual</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Descritivo Breve</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none min-h-[110px] resize-y"
                  placeholder="Detalhes da solicitação, material, acabamento, cores, observações..."
                />
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Mensagem Original</label>
                  <textarea
                    value={formData.sourceMessage || ''}
                    onChange={e => setFormData(prev => ({ ...prev, sourceMessage: e.target.value }))}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none min-h-[90px] resize-y"
                    placeholder="Mensagem recebida do cliente no WhatsApp ou observação inicial..."
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Foto / Logo da Solicitação</label>
                  <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant/30 bg-surface-container px-4 py-5 text-sm text-on-surface-variant cursor-pointer hover:border-primary/40">
                    <ImagePlus className="w-4 h-4" />
                    <span>Selecionar imagem</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          readImageFile(file, (result) => setFormData(prev => ({ ...prev, referenceImageUrl: result })));
                        }
                      }}
                    />
                  </label>
                  {formData.referenceImageUrl && (
                    <img src={formData.referenceImageUrl} alt="Referência" className="h-28 w-full object-cover rounded-lg border border-outline-variant/20" />
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Foto do Orçamento / Resultado</label>
                  <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant/30 bg-surface-container px-4 py-4 text-sm text-on-surface-variant cursor-pointer hover:border-primary/40">
                    <ImagePlus className="w-4 h-4" />
                    <span>Selecionar imagem</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          readImageFile(file, (result) => setFormData(prev => ({ ...prev, quoteMediaImageUrl: result })));
                        }
                      }}
                    />
                  </label>
                  {formData.quoteMediaImageUrl && (
                    <img src={formData.quoteMediaImageUrl} alt="Mídia do orçamento" className="h-24 w-full object-cover rounded-lg border border-outline-variant/20" />
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Link de Vídeo / Foto</label>
                  <div className="relative">
                    <LinkIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                    <input
                      type="text"
                      value={formData.quoteMediaUrl || ''}
                      onChange={e => setFormData(prev => ({ ...prev, quoteMediaUrl: e.target.value }))}
                      className="w-full bg-surface-container border-none rounded p-2.5 pl-10 text-sm focus:ring-2 focus:ring-primary outline-none"
                      placeholder="https://..."
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data de criacao</label>
                <input
                  type="datetime-local"
                  value={formatDateTimeInputValue(formData.createdAt)}
                  onChange={e => setFormData(prev => ({ ...prev, createdAt: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Envio do orcamento</label>
                <input
                  type="datetime-local"
                  value={formatDateTimeInputValue(formData.quoteSentAt)}
                  onChange={e => setFormData(prev => ({ ...prev, quoteSentAt: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data de aprovacao</label>
                <input
                  type="datetime-local"
                  value={formatDateTimeInputValue(formData.approvedAt)}
                  onChange={e => setFormData(prev => ({ ...prev, approvedAt: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data de pagamento</label>
                <input
                  type="datetime-local"
                  value={formatDateTimeInputValue(formData.paidAt)}
                  onChange={e => setFormData(prev => ({ ...prev, paidAt: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data de inicio</label>
                <input
                  type="datetime-local"
                  value={formatDateTimeInputValue(formData.startedAt)}
                  onChange={e => setFormData(prev => ({ ...prev, startedAt: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Data de conclusao</label>
                <input
                  type="datetime-local"
                  value={formatDateTimeInputValue(formData.completedAt)}
                  onChange={e => setFormData(prev => ({ ...prev, completedAt: e.target.value }))}
                  className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
            </div>

            <div className="pt-6 border-t border-outline-variant/20 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-on-surface flex items-center gap-2"><Calculator className="w-4 h-4 text-primary" /> Cálculo do Orçamento</h4>
                  <p className="text-xs text-on-surface-variant mt-1">Use os mesmos insumos básicos do cálculo de produto: filamento, tempo e impressora.</p>
                </div>
                <button
                  type="button"
                  onClick={addFilament}
                  className="px-3 py-1.5 bg-secondary-container text-on-secondary-container rounded text-xs font-bold"
                >
                  Adicionar Filamento
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Impressora</label>
                  <SearchableSelect
                    options={printerOptions}
                    value={formData.printerId}
                    onChange={(value) => setFormData(prev => ({ ...prev, printerId: value }))}
                    placeholder="Selecionar impressora"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Tempo de Produção (h)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={formData.productionTimeHours || ''}
                    onChange={e => setFormData(prev => ({ ...prev, productionTimeHours: Number(e.target.value) || 0 }))}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none tabular-nums"
                    placeholder="Ex: 4.5"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Quantidade Pedida</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={formData.requestedQuantity || ''}
                    onChange={e => setFormData(prev => ({ ...prev, requestedQuantity: Math.max(1, Number(e.target.value) || 1) }))}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Valor do Orçamento</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.quotedPrice || ''}
                    onChange={e => {
                      setIsQuotePriceManual(true);
                      setFormData(prev => ({ ...prev, quotedPrice: Number(e.target.value) || 0 }));
                    }}
                    className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {formData.filaments.map(entry => (
                  <div key={entry.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_160px_auto] gap-3 items-end bg-surface-container rounded-xl p-4 border border-outline-variant/10">
                    <SearchableSelect
                      options={filamentOptions}
                      value={entry.filamentId}
                      onChange={(value) => updateFilament(entry.id, 'filamentId', value)}
                      placeholder="Selecionar filamento"
                      label="Filamento"
                    />
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Qtd Filamento (g)</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={entry.weightGrams || ''}
                        onChange={e => updateFilament(entry.id, 'weightGrams', Number(e.target.value) || 0)}
                        className="w-full bg-surface-container-lowest border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none tabular-nums"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFilament(entry.id)}
                      className="p-2 text-error hover:bg-surface-container-lowest rounded justify-self-end"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Custo Unitário</div>
                  <div className="text-2xl font-headline font-bold text-on-surface">{formatCurrency(pricingPreview.estimatedUnitCost)}</div>
                </div>
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Sugestão por Unidade</div>
                  <div className="text-2xl font-headline font-bold text-primary">{formatCurrency(pricingPreview.suggestedUnitPrice)}</div>
                </div>
                <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/10">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Sugestão Total</div>
                  <div className="text-2xl font-headline font-bold text-on-surface">{formatCurrency(pricingPreview.totalSuggestedPrice)}</div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant/20">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="px-6 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-8 py-2.5 bg-primary text-on-primary rounded font-bold text-sm hover:opacity-90 transition-all active:scale-95"
              >
                {editingId ? 'Atualizar' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10">
        <div className="relative w-full lg:max-w-sm">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar solicitação..."
            className="w-full bg-surface-container border-none rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as 'all' | RequestStatus)}
          className="bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
        >
          <option value="all">Todos os status</option>
          {STATUS_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredRequests.length === 0 && (
          <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-10 text-center text-sm text-on-surface-variant">
            Nenhuma encomenda ou orçamento encontrado com os filtros atuais.
          </div>
        )}

        {filteredRequests.map(request => {
          const totalFilamentGrams = (request.filaments || []).reduce((sum, entry) => sum + (Number(entry.weightGrams) || 0), 0);
          const typeLabel = REQUEST_TYPE_OPTIONS.find(option => option.value === request.type)?.label || 'Solicitação';
          const statusLabel = STATUS_OPTIONS.find(option => option.value === request.status)?.label || request.status;

          return (
            <div key={request.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-sm overflow-hidden">
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary">{typeLabel}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusClasses(request.status)}`}>{statusLabel}</span>
                      {request.sourceChannel === 'whatsapp' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700">WhatsApp</span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-on-surface leading-tight">{request.title}</h3>
                    {request.description && <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">{request.description}</p>}
                    {(request.customerName || request.customerPhone) && (
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-on-surface-variant">
                        {request.customerName && <span>Cliente: <strong className="text-on-surface">{request.customerName}</strong></span>}
                        {request.customerPhone && <span>WhatsApp: <strong className="text-on-surface">{request.customerPhone}</strong></span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => handleEdit(request)} className="p-2 text-slate-400 hover:text-primary hover:bg-surface-container rounded">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => handleDelete(request.id)} className="p-2 text-slate-400 hover:text-error hover:bg-surface-container rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {(request.referenceImageUrl || request.quoteMediaImageUrl) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {request.referenceImageUrl && (
                      <img src={request.referenceImageUrl} alt="Referência" className="h-36 w-full object-cover rounded-lg border border-outline-variant/20" />
                    )}
                    {request.quoteMediaImageUrl && (
                      <img src={request.quoteMediaImageUrl} alt="Mídia do orçamento" className="h-36 w-full object-cover rounded-lg border border-outline-variant/20" />
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-surface-container p-3 rounded-lg border border-outline-variant/10">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Filamento</div>
                    <div className="font-bold text-on-surface tabular-nums">{totalFilamentGrams.toFixed(0)} g</div>
                  </div>
                  <div className="bg-surface-container p-3 rounded-lg border border-outline-variant/10">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Tempo</div>
                    <div className="font-bold text-on-surface tabular-nums">{Number(request.productionTimeHours || 0).toFixed(2)} h</div>
                  </div>
                  <div className="bg-surface-container p-3 rounded-lg border border-outline-variant/10">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Custo Unit.</div>
                    <div className="font-bold text-on-surface tabular-nums">{formatCurrency(request.estimatedUnitCost)}</div>
                  </div>
                  <div className="bg-surface-container p-3 rounded-lg border border-outline-variant/10">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Orçamento</div>
                    <div className="font-bold text-primary tabular-nums">{formatCurrency(request.quotedPrice)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
                  <span className="inline-flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {Math.max(1, Number(request.requestedQuantity) || 1)} un</span>
                  <span className="inline-flex items-center gap-1"><Clock3 className="w-3.5 h-3.5" /> {Number(request.productionTimeHours || 0).toFixed(2)} h</span>
                  {request.printerId && (
                    <span className="inline-flex items-center gap-1"><Printer className="w-3.5 h-3.5" /> {printers.find(item => item.id === request.printerId)?.name || 'Impressora selecionada'}</span>
                  )}
                  {request.quoteMediaUrl && (
                    <a href={request.quoteMediaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      <LinkIcon className="w-3.5 h-3.5" /> Abrir mídia
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant">
                  <div><span className="font-semibold text-on-surface">Criacao:</span> {formatDateLabel(request.createdAt)}</div>
                  <div><span className="font-semibold text-on-surface">Envio do orcamento:</span> {formatDateLabel(request.quoteSentAt)}</div>
                  <div><span className="font-semibold text-on-surface">Aprovacao:</span> {formatDateLabel(request.approvedAt)}</div>
                  <div><span className="font-semibold text-on-surface">Pagamento:</span> {formatDateLabel(request.paidAt)}</div>
                  <div><span className="font-semibold text-on-surface">Inicio:</span> {formatDateLabel(request.startedAt)}</div>
                  <div><span className="font-semibold text-on-surface">Conclusao:</span> {formatDateLabel(request.completedAt)}</div>
                </div>

                {(request.filaments || []).length > 0 && (
                  <div className="pt-3 border-t border-outline-variant/10 flex flex-wrap gap-2">
                    {request.filaments.map(entry => (
                      <span key={entry.id} className="px-2.5 py-1 rounded-full bg-surface-container text-xs text-on-surface">
                        {entry.filamentName || 'Filamento'} • {Number(entry.weightGrams || 0).toFixed(0)} g
                      </span>
                    ))}
                  </div>
                )}

                {request.sourceMessage && (
                  <div className="pt-3 border-t border-outline-variant/10">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-2">Mensagem Original</div>
                    <p className="text-sm text-on-surface-variant whitespace-pre-wrap leading-relaxed">{request.sourceMessage}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
