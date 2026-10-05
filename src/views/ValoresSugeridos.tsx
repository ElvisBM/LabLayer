import { useEffect, useMemo, useState } from 'react';
import { Search, Save, Tag, Percent, Calculator } from 'lucide-react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { DEFAULT_PRICING_SETTINGS, type PricingSettings, calculateVariationUnitCostBreakdown, normalizePricingSettings } from '../utils/pricing';

interface Supply {
  id: string;
  costPerUnit: number;
}

interface Filament {
  id: string;
  pricePerKg: number;
}

interface Printer {
  id: string;
  acquisitionCost?: number;
  lifespanHours?: number;
  maintenanceBudget?: number;
  powerConsumption?: number;
  status?: 'operacional' | 'manutenção' | 'inativa';
}

interface Marketplace {
  id: string;
  name?: string;
  commissionPercent?: number;
  fixedFee?: number;
  averageShipping?: number;
}

interface VariationMaterial {
  filamentId?: string;
  weightGrams?: number;
  purgeGrams?: number;
}

interface ChannelPrice {
  channel: string;
  price: number;
  feePercentage: number;
}

interface Variation {
  id: string;
  color?: string;
  material?: string;
  weightGrams?: number;
  printTimeHours?: number;
  quantityPerPrint?: number;
  materialCostPerGram?: number;
  printerCostPerHour?: number;
  materials?: VariationMaterial[];
  channelPrices?: ChannelPrice[];
}

interface ProductSupplyUsage {
  supplyId: string;
  quantityPerProduct: number;
}

interface Product {
  id: string;
  name: string;
  category?: string;
  status?: 'ativo' | 'inativo' | 'desenvolvimento';
  stock?: number;
  fixedCost?: number;
  variations?: Variation[];
  supplyUsages?: ProductSupplyUsage[];
  latestSuggestedPrice?: {
    suggestedPrice?: number;
    savedAt?: string;
    channelName?: string;
    variationLabel?: string;
    variationId?: string;
    channelId?: string;
    targetType?: 'profit' | 'margin' | 'markup' | 'custom';
    targetValue?: number;
    cost?: number;
    profit?: number;
    margin?: number;
  };
  pricingHistory?: Array<{
    id: string;
    savedAt: string;
    variationId: string;
    variationLabel: string;
    channelId: string;
    channelName: string;
    targetType: 'profit' | 'margin' | 'markup' | 'custom';
    targetValue: number;
    suggestedPrice: number;
    cost: number;
    profit: number;
    margin: number;
  }>;
}

const MARKUP_MULTIPLIER = 2.2;

export function ValoresSugeridos() {
  const { tenantId } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [filaments, setFilaments] = useState<Filament[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(DEFAULT_PRICING_SETTINGS);
  const [energyPrice, setEnergyPrice] = useState(0.95);
  const [search, setSearch] = useState('');
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<string[]>([]);

  useEffect(() => {
    if (!tenantId) return;

    const unsubProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      setProducts(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Product)));
    });

    const unsubFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      setFilaments(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Filament)));
    });

    const unsubSupplies = onSnapshot(collection(db, `tenants/${tenantId}/supplies`), (snapshot) => {
      setSupplies(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Supply)));
    });

    const unsubPrinters = onSnapshot(collection(db, `tenants/${tenantId}/printers`), (snapshot) => {
      setPrinters(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Printer)));
    });

    const unsubMarketplaces = onSnapshot(collection(db, `tenants/${tenantId}/marketplaces`), (snapshot) => {
      setMarketplaces(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Marketplace)));
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
      unsubProducts();
      unsubFilaments();
      unsubSupplies();
      unsubPrinters();
      unsubMarketplaces();
      unsubPrinterSettings();
      unsubPricingSettings();
    };
  }, [tenantId]);

  const calculateSupplyCostPerUnit = (product: Product) => {
    return (product.supplyUsages || []).reduce((sum, usage) => {
      const supply = supplies.find(item => item.id === usage.supplyId);
      return sum + ((Number(usage.quantityPerProduct) || 0) * (Number(supply?.costPerUnit) || 0));
    }, 0);
  };

  const calculateUnitCost = (product: Product) => {
    const variation = (product.variations || [])[0];
    if (!variation) return Number(product.fixedCost) || 0;
    return calculateVariationCost(product, variation);
  };

  const calculateVariationCost = (product: Product, variation: Variation) => {
    return calculateVariationUnitCostBreakdown({
      variation,
      fixedCost: Number(product.fixedCost) || 0,
      filaments,
      supplies,
      supplyUsages: product.supplyUsages || [],
      printers,
      energyPrice,
      pricingSettings,
    }).total;
  };

  const calculateSuggestedSalePrice = (unitCost: number) => Number((unitCost * MARKUP_MULTIPLIER).toFixed(2));

  const productRows = useMemo(() => {
    return products
      .map(product => {
        const unitCost = calculateUnitCost(product);
        const suggestedPrice = calculateSuggestedSalePrice(unitCost);
        const currentValue = editedValues[product.id]
          ?? (Number(product.latestSuggestedPrice?.suggestedPrice) > 0
            ? Number(product.latestSuggestedPrice?.suggestedPrice).toFixed(2)
            : suggestedPrice.toFixed(2));

        return {
          product,
          unitCost,
          suggestedPrice,
          currentValue,
        };
      })
      .filter(({ product }) => {
        const haystack = `${product.name || ''} ${product.category || ''}`.toLowerCase();
        return haystack.includes(search.trim().toLowerCase());
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name, 'pt-BR'));
  }, [products, filaments, supplies, printers, editedValues, search, energyPrice, pricingSettings]);

  const summary = useMemo(() => {
    return productRows.reduce((acc, row) => {
      acc.count += 1;
      acc.totalCost += row.unitCost;
      acc.totalSuggested += row.suggestedPrice;
      return acc;
    }, { count: 0, totalCost: 0, totalSuggested: 0 });
  }, [productRows]);

  const handleSaveValue = async (product: Product, value: string) => {
    if (!tenantId) return;

    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Informe um valor de venda válido.');
      return;
    }

    const primaryVariation = (product.variations || [])[0];
    if (!primaryVariation) {
      toast.error('Este produto ainda não possui variação para salvar o valor.');
      return;
    }

    try {
      setSavingIds(prev => [...prev, product.id]);
      const savedAt = new Date().toISOString();
      const currentChannelPrices = primaryVariation.channelPrices || [];
      const hasDirectSale = currentChannelPrices.some(price => price.channel === 'Venda Direta');

      const nextVariations = (product.variations || []).map(variation => {
        if (variation.id !== primaryVariation.id) return variation;

        return {
          ...variation,
          channelPrices: hasDirectSale
            ? currentChannelPrices.map(price => price.channel === 'Venda Direta' ? { ...price, price: parsed } : price)
            : [...currentChannelPrices, { channel: 'Venda Direta', price: parsed, feePercentage: 0 }],
        };
      });

      await updateDoc(doc(db, `tenants/${tenantId}/products`, product.id), {
        variations: nextVariations,
        latestSuggestedPrice: {
          suggestedPrice: parsed,
          savedAt,
          channelName: 'Venda Direta',
          variationLabel: `${primaryVariation.color || 'Padrão'} (${primaryVariation.material || 'Material'})`,
        },
      });

      setEditedValues(prev => ({ ...prev, [product.id]: parsed.toFixed(2) }));
      toast.success('Valor de venda salvo no produto.');
    } catch (error) {
      console.error('Error saving suggested value:', error);
      toast.error('Erro ao salvar valor de venda.');
    } finally {
      setSavingIds(prev => prev.filter(id => id !== product.id));
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Valores Sugeridos</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">
            Lista rápida de produtos com sugestão automática usando <strong>custo x 2,20</strong> para facilitar a consulta e o ajuste do valor de venda.
          </p>
        </div>

        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar produto..."
            className="w-full bg-surface-container border-none rounded-xl p-3 pl-10 text-sm focus:ring-2 focus:ring-primary outline-none"
          />
        </div>
      </div>

      <p role="note" className="text-sm text-on-surface-variant">
        As sugestões acompanham os custos atuais. Preços salvos e histórico permanecem preservados;
        para mudar o valor de venda, revise e salve cada produto individualmente.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <div className="w-10 h-10 bg-primary-container rounded-lg flex items-center justify-center mb-4">
            <Tag className="w-5 h-5 text-on-primary-container" />
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Produtos na Lista</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{summary.count}</p>
        </div>

        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <div className="w-10 h-10 bg-secondary-container rounded-lg flex items-center justify-center mb-4">
            <Calculator className="w-5 h-5 text-on-secondary-container" />
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Custo Médio Unitário</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">
            R$ {(summary.count > 0 ? summary.totalCost / summary.count : 0).toFixed(2)}
          </p>
        </div>

        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <div className="w-10 h-10 bg-tertiary-container rounded-lg flex items-center justify-center mb-4">
            <Percent className="w-5 h-5 text-on-tertiary-container" />
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Regra Atual</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">120%</p>
          <p className="text-xs text-on-surface-variant mt-2">Aplicado como acréscimo de 120% sobre o custo</p>
        </div>
      </div>

      <section className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1100px]">
            <thead>
              <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                <th className="px-6 py-3">Produto</th>
                <th className="px-6 py-3 text-right">Estoque</th>
                <th className="px-6 py-3 text-right">Custo Unit.</th>
                <th className="px-6 py-3 text-right">Sugestão 120%</th>
                <th className="px-6 py-3 text-right">Valor de Venda</th>
                <th className="px-6 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {productRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-on-surface-variant">
                    Nenhum produto encontrado para esse filtro.
                  </td>
                </tr>
              )}

              {productRows.map(({ product, unitCost, suggestedPrice, currentValue }) => (
                <tr key={product.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-bold text-primary">{product.name}</p>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">{product.status || 'sem status'}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-semibold tabular-nums">{Number(product.stock) || 0}</td>
                  <td className="px-6 py-4 text-right text-sm font-semibold tabular-nums">R$ {unitCost.toFixed(2)}</td>
                  <td className="px-6 py-4 text-right text-sm font-bold tabular-nums text-secondary">R$ {suggestedPrice.toFixed(2)}</td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end">
                      <input
                        type="number"
                        step="0.01"
                        value={currentValue}
                        onChange={e => setEditedValues(prev => ({ ...prev, [product.id]: e.target.value }))}
                        className="w-32 bg-surface-container border-none rounded p-2 text-sm text-right tabular-nums focus:ring-2 focus:ring-primary outline-none"
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleSaveValue(product, currentValue)}
                      disabled={savingIds.includes(product.id)}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-on-primary rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      {savingIds.includes(product.id) ? 'Salvando...' : 'Salvar'}
                    </button>
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
