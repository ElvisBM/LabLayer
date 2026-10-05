import { useState, useMemo, useEffect } from 'react';
import { Calculator, DollarSign, TrendingUp, Percent, Target, AlertCircle, Save, CheckCircle2, ArrowRightLeft } from 'lucide-react';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { appendPriceSnapshot } from '../services/product-protection';
import { DEFAULT_PRICING_SETTINGS, type PricingSettings, calculateVariationUnitCostBreakdown, normalizePricingSettings } from '../utils/pricing';

type TargetType = 'profit' | 'margin' | 'markup' | 'custom';

interface ProductPricingHistoryEntry {
  id: string;
  savedAt: string;
  variationId: string;
  variationLabel: string;
  channelId: string;
  channelName: string;
  targetType: TargetType;
  targetValue: number;
  suggestedPrice: number;
  cost: number;
  profit: number;
  margin: number;
}

export function Precificacao() {
  const { tenantId, user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [marketplaces, setMarketplaces] = useState<any[]>([]);
  const [filaments, setFilaments] = useState<any[]>([]);
  const [printers, setPrinters] = useState<any[]>([]);
  const [energyPrice, setEnergyPrice] = useState<number>(0.95);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(DEFAULT_PRICING_SETTINGS);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [productId, setProductId] = useState<string>('');
  const [variationId, setVariationId] = useState<string>('');
  const [channelId, setChannelId] = useState<string>('');
  
  const [targetType, setTargetType] = useState<TargetType>('profit');
  const [targetValue, setTargetValue] = useState<number>(10.00);
  const [isSavingPrice, setIsSavingPrice] = useState(false);

  useEffect(() => {
    if (!tenantId) return;

    const unsubProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setProducts(data);
      if (data.length > 0 && !productId) {
        setProductId(data[0].id);
        if (data[0].variations?.length > 0) {
          setVariationId(data[0].variations[0].id);
        }
      }
    });

    const unsubMarketplaces = onSnapshot(collection(db, `tenants/${tenantId}/marketplaces`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setMarketplaces(data);
      if (data.length > 0 && !channelId) {
        setChannelId(data[0].id);
      }
    });

    const unsubFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      setFilaments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubPrinters = onSnapshot(collection(db, `tenants/${tenantId}/printers`), (snapshot) => {
      setPrinters(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubPrinterSettings = onSnapshot(doc(db, `tenants/${tenantId}/settings/printer`), (docSnap) => {
      if (docSnap.exists() && docSnap.data().energyPrice !== undefined) {
        setEnergyPrice(Number(docSnap.data().energyPrice) || 0.95);
      }
    });

    const unsubPricingSettings = onSnapshot(doc(db, `tenants/${tenantId}/settings/pricing`), (docSnap) => {
      setPricingSettings(normalizePricingSettings(docSnap.exists() ? (docSnap.data() as Partial<PricingSettings>) : null));
    });

    return () => {
      unsubProducts();
      unsubMarketplaces();
      unsubFilaments();
      unsubPrinters();
      unsubPrinterSettings();
      unsubPricingSettings();
    };
  }, [tenantId]);

  // Handle product change
  useEffect(() => {
    const product = products.find(p => p.id === productId);
    if (product && product.variations?.length > 0) {
      if (!product.variations.find((v: any) => v.id === variationId)) {
        setVariationId(product.variations[0].id);
      }
    } else {
      setVariationId('');
    }
  }, [productId, products]);

  const product = products.find(p => p.id === productId);
  const variation = product?.variations?.find((v: any) => v.id === variationId);
  const channel = marketplaces.find(c => c.id === channelId);

  const calculateUnitCost = (v: any, fixedCost: number) => {
    if (!v) return 0;
    return calculateVariationUnitCostBreakdown({
      variation: v,
      fixedCost,
      filaments,
      printers,
      energyPrice,
      pricingSettings,
    }).total;
  };

  const unitBreakdown = variation
    ? calculateVariationUnitCostBreakdown({
        variation,
        fixedCost: product?.fixedCost || 0,
        filaments,
        printers,
        energyPrice,
        pricingSettings,
      })
    : null;

  const unitCost = variation ? calculateUnitCost(variation, product?.fixedCost || 0) : 0;

  const calculations = useMemo(() => {
    if (!channel) return null;

    const cost = unitCost + (channel.averageShipping || 0);
    const percentFeeDecimal = (channel.commissionPercent || 0) / 100;
    const fixedFee = channel.fixedFee || 0;

    let finalPrice = 0;

    try {
      if (targetType === 'profit') {
        finalPrice = (cost + fixedFee + targetValue) / (1 - percentFeeDecimal);
      } else if (targetType === 'margin') {
        const marginDecimal = targetValue / 100;
        if (1 - percentFeeDecimal - marginDecimal <= 0) {
          finalPrice = 0;
        } else {
          finalPrice = (cost + fixedFee) / (1 - percentFeeDecimal - marginDecimal);
        }
      } else if (targetType === 'markup') {
        const basePrice = cost * targetValue;
        finalPrice = (basePrice + fixedFee) / (1 - percentFeeDecimal);
      } else if (targetType === 'custom') {
        finalPrice = targetValue;
      }
    } catch (e) {
      finalPrice = 0;
    }

    if (finalPrice < 0 || !isFinite(finalPrice)) finalPrice = 0;

    const percentFeesAmount = finalPrice * percentFeeDecimal;
    const totalFees = percentFeesAmount + fixedFee;
    const netRevenue = finalPrice - totalFees;
    const netProfit = netRevenue - cost;
    const realMargin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;
    const realMarkup = cost > 0 ? (netRevenue / cost) : 0;

    const minPrice = (cost + fixedFee) / (1 - percentFeeDecimal);
    
    let aggressivePrice = 0;
    if (targetType === 'profit') {
      aggressivePrice = (cost + fixedFee + (targetValue / 2)) / (1 - percentFeeDecimal);
    } else if (targetType === 'margin') {
      aggressivePrice = (cost + fixedFee) / (1 - percentFeeDecimal - ((targetValue / 2) / 100));
    } else if (targetType === 'markup') {
      aggressivePrice = ((cost * (targetValue > 1 ? targetValue - 0.5 : 1)) + fixedFee) / (1 - percentFeeDecimal);
    } else {
      aggressivePrice = (cost + fixedFee) / (1 - percentFeeDecimal - 0.1);
    }

    return {
      cost,
      finalPrice,
      percentFeesAmount,
      totalFees,
      netRevenue,
      netProfit,
      realMargin,
      realMarkup,
      minPrice,
      aggressivePrice
    };
  }, [unitCost, channel, targetType, targetValue]);

  const channelComparisons = useMemo(() => {
    return marketplaces.map(ch => {
      const cost = unitCost + (ch.averageShipping || 0);
      const percentFeeDecimal = (ch.commissionPercent || 0) / 100;
      const fixedFee = ch.fixedFee || 0;

      let finalPrice = 0;
      try {
        if (targetType === 'profit') {
          finalPrice = (cost + fixedFee + targetValue) / (1 - percentFeeDecimal);
        } else if (targetType === 'margin') {
          const marginDecimal = targetValue / 100;
          if (1 - percentFeeDecimal - marginDecimal > 0) {
            finalPrice = (cost + fixedFee) / (1 - percentFeeDecimal - marginDecimal);
          }
        } else if (targetType === 'markup') {
          const basePrice = cost * targetValue;
          finalPrice = (basePrice + fixedFee) / (1 - percentFeeDecimal);
        } else if (targetType === 'custom') {
          finalPrice = targetValue;
        }
      } catch (e) {
        finalPrice = 0;
      }

      if (finalPrice < 0 || !isFinite(finalPrice)) finalPrice = 0;

      const percentFeesAmount = finalPrice * percentFeeDecimal;
      const totalFees = percentFeesAmount + fixedFee;
      const netRevenue = finalPrice - totalFees;
      const netProfit = netRevenue - cost;
      const realMargin = finalPrice > 0 ? (netProfit / finalPrice) * 100 : 0;

      return {
        channel: ch,
        finalPrice,
        netProfit,
        realMargin,
        totalFees
      };
    }).sort((a, b) => b.realMargin - a.realMargin);
  }, [unitCost, marketplaces, targetType, targetValue]);

  const handleSaveSuggestedPrice = async () => {
    if (!tenantId || !user || !product || !variation || !channel || !calculations) return;

    try {
      setIsSavingPrice(true);
      const savedAt = new Date().toISOString();
      const newEntry: ProductPricingHistoryEntry = {
        id: `${savedAt}-${variation.id}-${channel.id}`,
        savedAt,
        variationId: variation.id,
        variationLabel: `${variation.color} (${variation.material})`,
        channelId: channel.id,
        channelName: channel.name,
        targetType,
        targetValue,
        suggestedPrice: calculations.finalPrice,
        cost: calculations.cost,
        profit: calculations.netProfit,
        margin: calculations.realMargin,
      };

      await appendPriceSnapshot(db, tenantId, product.id, newEntry, user.uid);

      toast.success('Preço sugerido salvo no produto!');
    } catch (error) {
      console.error('Error saving suggested price:', error);
      toast.error('Erro ao salvar preço sugerido no produto.');
    } finally {
      setIsSavingPrice(false);
    }
  };

  const handleSavePricingSettings = async () => {
    if (!tenantId) return;

    try {
      setIsSavingSettings(true);
      await setDoc(doc(db, `tenants/${tenantId}/settings/pricing`), pricingSettings, { merge: true });
      toast.success('Configurações avançadas de precificação salvas.');
    } catch (error) {
      console.error('Error saving pricing settings:', error);
      toast.error('Erro ao salvar configurações avançadas.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant">
        <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
        <p>Cadastre pelo menos um produto com variação para usar o simulador.</p>
      </div>
    );
  }

  if (marketplaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant">
        <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
        <p>Cadastre pelo menos um marketplace para usar o simulador.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Simulador de Preço</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Calcule o preço ideal garantindo sua margem em cada canal de venda.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        
        {/* BLOCO ESQUERDO - ENTRADAS */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
            <h3 className="font-headline font-bold text-lg mb-6 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-primary" />
              Parâmetros de Cálculo
            </h3>

            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Custo Total (R$)</label>
                  <input 
                    type="text" 
                    disabled
                    value={calculations?.cost.toFixed(2) || '0.00'}
                    className="w-full bg-surface-container-highest border-none rounded p-2.5 text-sm tabular-nums font-bold text-on-surface-variant cursor-not-allowed" 
                  />
                  <p className="text-[9px] text-on-surface-variant/70">Produto + Frete Subs.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Taxas do Canal</label>
                  <div className="w-full bg-surface-container-highest border-none rounded p-2.5 text-sm tabular-nums font-bold text-on-surface-variant">
                    {channel?.commissionPercent || 0}% + R$ {(channel?.fixedFee || 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="border-t border-outline-variant/20 pt-5 mt-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-3 block">Meta de Precificação</label>
                
                <div className="grid grid-cols-4 gap-2 mb-4">
                  <button 
                    onClick={() => { setTargetType('profit'); setTargetValue(10); }}
                    className={`py-2 px-1 text-xs font-bold rounded border transition-all ${targetType === 'profit' ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}
                  >
                    Lucro (R$)
                  </button>
                  <button 
                    onClick={() => { setTargetType('margin'); setTargetValue(20); }}
                    className={`py-2 px-1 text-xs font-bold rounded border transition-all ${targetType === 'margin' ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}
                  >
                    Margem (%)
                  </button>
                  <button 
                    onClick={() => { setTargetType('markup'); setTargetValue(2.5); }}
                    className={`py-2 px-1 text-xs font-bold rounded border transition-all ${targetType === 'markup' ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}
                  >
                    Markup (x)
                  </button>
                  <button 
                    onClick={() => { setTargetType('custom'); setTargetValue(50); }}
                    className={`py-2 px-1 text-xs font-bold rounded border transition-all ${targetType === 'custom' ? 'bg-primary text-on-primary border-primary' : 'bg-transparent border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'}`}
                  >
                    Preço (R$)
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    {targetType === 'profit' && 'Lucro Desejado (R$)'}
                    {targetType === 'margin' && 'Margem Alvo (%)'}
                    {targetType === 'markup' && 'Multiplicador (Markup)'}
                    {targetType === 'custom' && 'Preço de Venda (R$)'}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      {(targetType === 'profit' || targetType === 'custom') && <DollarSign className="w-4 h-4 text-on-surface-variant" />}
                      {targetType === 'margin' && <Percent className="w-4 h-4 text-on-surface-variant" />}
                      {targetType === 'markup' && <TrendingUp className="w-4 h-4 text-on-surface-variant" />}
                    </div>
                    <input 
                      type="number" 
                      step={targetType === 'markup' ? "0.1" : "0.01"}
                      value={targetValue || ''}
                      onChange={(e) => setTargetValue(Number(e.target.value))}
                      className="w-full bg-surface-container border-none rounded p-3 pl-9 text-lg font-bold focus:ring-2 focus:ring-primary tabular-nums outline-none" 
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-outline-variant/20 pt-5 mt-2 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block">Custos Avançados Padrão</label>
                    <p className="text-[11px] text-on-surface-variant mt-1">Aplicados como base na precificação, valores sugeridos e análise de produto.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSavePricingSettings}
                    disabled={isSavingSettings}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-secondary-container text-on-secondary-container text-xs font-bold hover:opacity-90 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingSettings ? 'Salvando...' : 'Salvar padrões'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Taxa de Falha (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={pricingSettings.failureRate}
                      onChange={(e) => setPricingSettings(prev => ({ ...prev, failureRate: Number(e.target.value) || 0 }))}
                      className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Manutenção/Mês (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={pricingSettings.maintenancePerMonth}
                      onChange={(e) => setPricingSettings(prev => ({ ...prev, maintenancePerMonth: Number(e.target.value) || 0 }))}
                      className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Horas de Uso/Mês</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={pricingSettings.monthlyUsageHours}
                      onChange={(e) => setPricingSettings(prev => ({ ...prev, monthlyUsageHours: Math.max(1, Number(e.target.value) || 1) }))}
                      className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary tabular-nums outline-none"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-on-surface-variant">
                  O custo da impressora passa a vir das impressoras cadastradas. Se a variação não tiver uma impressora vinculada, usamos a média das impressoras ativas do seu cadastro.
                </p>
              </div>

            </div>
          </div>
        </div>

        {/* BLOCO DIREITO - RESULTADOS */}
        {calculations && (
          <div className="xl:col-span-7 space-y-6">
            <div className="sticky top-3 z-20">
              <div className="bg-surface-container-lowest/95 backdrop-blur-sm p-5 rounded-xl border border-outline-variant/20 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-headline font-bold text-base text-on-surface">Selecao do Produto</h3>
                  <p className="text-xs text-on-surface-variant mt-1">Deixe a escolha principal mais perto da analise e da lista comparativa.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Produto Base</label>
                  <select
                    value={productId || ''}
                    onChange={(e) => setProductId(e.target.value)}
                    className="w-full bg-surface-container border-none rounded p-3 text-sm focus:ring-2 focus:ring-primary outline-none font-medium"
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {product?.variations && product.variations.length > 0 ? (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Variação</label>
                    <select
                      value={variationId || ''}
                      onChange={(e) => setVariationId(e.target.value)}
                      className="w-full bg-surface-container border-none rounded p-3 text-sm focus:ring-2 focus:ring-primary outline-none font-medium"
                    >
                      {product.variations.map((v: any) => (
                        <option key={v.id} value={v.id}>{v.color} ({v.material})</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Variação</label>
                    <div className="w-full bg-surface-container-highest border-none rounded p-3 text-sm text-on-surface-variant">
                      Sem variações
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Canal de Venda</label>
                  <select
                    value={channelId || ''}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="w-full bg-surface-container border-none rounded p-3 text-sm focus:ring-2 focus:ring-primary outline-none font-medium"
                  >
                    {marketplaces.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.commissionPercent}% + R$ {c.fixedFee.toFixed(2)})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            </div>
            
            {/* Preço Final Destaque */}
            <div className="bg-primary-container text-on-primary-container p-8 rounded-xl shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-10">
                <Target className="w-32 h-32" />
              </div>
              
              <div className="relative z-10">
                <h3 className="text-sm font-bold uppercase tracking-widest opacity-80 mb-2">Preço Final Sugerido</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold opacity-80">R$</span>
                  <span className="text-6xl font-headline font-bold tabular-nums tracking-tighter">
                    {calculations.finalPrice.toFixed(2)}
                  </span>
                </div>
                
                {calculations.finalPrice === 0 && (
                  <div className="mt-4 inline-flex items-center gap-2 bg-error/20 text-error px-3 py-1.5 rounded text-sm font-bold">
                    <AlertCircle className="w-4 h-4" />
                    Margem inviável com as taxas deste canal.
                  </div>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveSuggestedPrice}
                    disabled={isSavingPrice || calculations.finalPrice <= 0}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-on-primary font-bold text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isSavingPrice ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {isSavingPrice ? 'Salvando...' : 'Salvar no Produto'}
                  </button>
                  <span className="text-xs opacity-80">
                    Salva o preço sugerido com data, canal e variação no cadastro do produto.
                  </span>
                </div>
              </div>
            </div>

            {/* DRE Simplificado */}
            <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
              <h3 className="font-headline font-bold text-lg mb-4">Composição do Preço (DRE)</h3>
              
              <div className="space-y-3 font-sans text-sm">
                {unitBreakdown && (
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div className="rounded-lg bg-surface-container p-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Falha embutida</div>
                      <div className="mt-1 text-base font-bold tabular-nums text-on-surface">R$ {unitBreakdown.failureAdjustmentPerUnit.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg bg-surface-container p-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Overhead por hora</div>
                      <div className="mt-1 text-base font-bold tabular-nums text-on-surface">R$ {unitBreakdown.operationalOverheadPerHour.toFixed(2)}</div>
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-center p-2 hover:bg-surface-container-low rounded transition-colors">
                  <span className="text-on-surface-variant font-medium">Receita Bruta (Preço)</span>
                  <span className="font-bold tabular-nums">R$ {calculations.finalPrice.toFixed(2)}</span>
                </div>
                
                <div className="flex justify-between items-center p-2 text-error hover:bg-error/5 rounded transition-colors">
                  <span className="font-medium flex items-center gap-2">
                    Taxas do Canal
                    <span className="text-[10px] bg-error/10 px-1.5 py-0.5 rounded font-bold">-{channel?.commissionPercent || 0}% - R${(channel?.fixedFee || 0).toFixed(2)}</span>
                  </span>
                  <span className="font-bold tabular-nums">- R$ {calculations.totalFees.toFixed(2)}</span>
                </div>
                
                <div className="flex justify-between items-center p-2 border-t border-outline-variant/20">
                  <span className="text-on-surface-variant font-bold">Receita Líquida</span>
                  <span className="font-bold tabular-nums">R$ {calculations.netRevenue.toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center p-2 text-error hover:bg-error/5 rounded transition-colors">
                  <span className="font-medium">Custo Total (Produto + Frete)</span>
                  <span className="font-bold tabular-nums">- R$ {calculations.cost.toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center p-3 bg-tertiary-container text-on-tertiary-container rounded-lg mt-2">
                  <span className="font-bold uppercase tracking-widest text-xs">Lucro Líquido</span>
                  <span className="font-headline font-bold text-xl tabular-nums">R$ {calculations.netProfit.toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-outline-variant/20">
                <div className="bg-surface-container p-4 rounded-lg text-center">
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Margem Real</span>
                  <span className="text-2xl font-headline font-bold text-primary tabular-nums">{calculations.realMargin.toFixed(1)}%</span>
                </div>
                <div className="bg-surface-container p-4 rounded-lg text-center">
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Markup Real</span>
                  <span className="text-2xl font-headline font-bold text-primary tabular-nums">{calculations.realMarkup.toFixed(2)}x</span>
                </div>
              </div>
            </div>

            {/* 3 Preços (Mínimo, Agressivo, Ideal) */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-4 rounded-xl text-center">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Preço Mínimo (Empate)</span>
                <span className="text-lg font-bold tabular-nums text-on-surface">R$ {calculations.minPrice.toFixed(2)}</span>
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant/20 p-4 rounded-xl text-center border-b-4 border-b-secondary">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-secondary mb-1">Preço Agressivo</span>
                <span className="text-lg font-bold tabular-nums text-on-surface">R$ {calculations.aggressivePrice.toFixed(2)}</span>
              </div>
              <div className="bg-primary-container border border-primary/20 p-4 rounded-xl text-center border-b-4 border-b-primary">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-primary mb-1">Preço Ideal (Meta)</span>
                <span className="text-lg font-bold tabular-nums text-primary">R$ {calculations.finalPrice.toFixed(2)}</span>
              </div>
            </div>

            {/* Comparativo de Canais */}
            <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
              <h3 className="font-headline font-bold text-lg mb-4 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-primary" />
                Comparativo de Canais
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                      <th className="px-4 py-3 rounded-tl-lg">Canal</th>
                      <th className="px-4 py-3 text-right">Preço Sugerido</th>
                      <th className="px-4 py-3 text-right">Taxas</th>
                      <th className="px-4 py-3 text-right">Lucro Líquido</th>
                      <th className="px-4 py-3 text-right rounded-tr-lg">Margem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {channelComparisons.map((comp) => (
                      <tr key={comp.channel.id} className={`hover:bg-surface-container-lowest transition-colors ${comp.channel.id === channelId ? 'bg-primary/5' : ''}`}>
                        <td className="px-4 py-3 text-sm font-medium flex items-center gap-2">
                          {comp.channel.name}
                          {comp.channel.id === channelId && <span className="text-[9px] bg-primary text-on-primary px-1.5 py-0.5 rounded uppercase tracking-widest">Atual</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-sm">R$ {comp.finalPrice.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-sm text-error/80">- R$ {comp.totalFees.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-sm font-bold text-secondary">R$ {comp.netProfit.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tabular-nums ${comp.realMargin < 0 ? 'bg-error text-on-error' : comp.realMargin < 20 ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-secondary-container text-on-secondary-container'}`}>
                            {comp.realMargin.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
