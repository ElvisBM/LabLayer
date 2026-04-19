import React, { useState, useEffect } from 'react';
import { Layers, AlertTriangle, TrendingUp, Package, Cable } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

export function EstoqueInteligente() {
  const { tenantId } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [filaments, setFilaments] = useState<any[]>([]);

  useEffect(() => {
    if (!tenantId) return;

    const unsubProducts = onSnapshot(collection(db, `tenants/${tenantId}/products`), (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubFilaments = onSnapshot(collection(db, `tenants/${tenantId}/filaments`), (snapshot) => {
      setFilaments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubProducts();
      unsubFilaments();
    };
  }, [tenantId]);

  // Calculate low stock products (assuming minStock is 5 if not defined, or we just check if stock is 0)
  const lowStockProducts = products.filter(p => {
    const stock = Number(p.stock) || 0;
    const minStock = Number(p.minStock) || 5; // Default min stock for alerts
    return stock <= minStock && p.status === 'ativo';
  });

  // Calculate low stock filaments
  const lowStockFilaments = filaments.filter(f => {
    const stockKg = Number(f.stockKg) || 0;
    const minStockKg = Number(f.minStockKg) || 0.5; // Default 500g min stock
    return stockKg <= minStockKg;
  });

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-headline font-bold text-on-surface">Estoque Inteligente</h2>
          <p className="text-sm text-on-surface-variant mt-1">Visão geral de produtos e filamentos precisando de reposição.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface-variant uppercase tracking-wider">Produtos em Baixa</p>
            <p className="text-2xl font-black text-on-surface">{lowStockProducts.length}</p>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 flex items-center gap-4">
          <div className="w-12 h-12 bg-secondary/10 text-secondary rounded-full flex items-center justify-center">
            <Cable className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-on-surface-variant uppercase tracking-wider">Filamentos em Baixa</p>
            <p className="text-2xl font-black text-on-surface">{lowStockFilaments.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Produtos */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-outline-variant/20 bg-surface-container-lowest/50">
            <h3 className="font-bold text-on-surface flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" /> Produtos para Produzir
            </h3>
          </div>
          <div className="p-0 flex-1 overflow-y-auto">
            {lowStockProducts.length === 0 ? (
              <div className="p-8 text-center text-sm text-on-surface-variant">
                Todos os produtos ativos estão com estoque adequado.
              </div>
            ) : (
              <ul className="divide-y divide-outline-variant/10">
                {lowStockProducts.map(p => (
                  <li key={p.id} className="p-4 flex items-center justify-between hover:bg-surface-container-low/50 transition-colors">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{p.name}</p>
                      <p className="text-[10px] text-on-surface-variant uppercase">{p.baseSku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-error">{p.stock || 0} un</p>
                      <p className="text-[10px] text-on-surface-variant">Mínimo: {p.minStock || 5}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Filamentos */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-outline-variant/20 bg-surface-container-lowest/50">
            <h3 className="font-bold text-on-surface flex items-center gap-2">
              <Cable className="w-4 h-4 text-secondary" /> Filamentos para Comprar
            </h3>
          </div>
          <div className="p-0 flex-1 overflow-y-auto">
            {lowStockFilaments.length === 0 ? (
              <div className="p-8 text-center text-sm text-on-surface-variant">
                Todos os filamentos estão com estoque adequado.
              </div>
            ) : (
              <ul className="divide-y divide-outline-variant/10">
                {lowStockFilaments.map(f => (
                  <li key={f.id} className="p-4 flex items-center justify-between hover:bg-surface-container-low/50 transition-colors">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{f.material} {f.color}</p>
                      <p className="text-[10px] text-on-surface-variant uppercase">{f.brand}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-error">{(f.stockKg || 0).toFixed(2)} kg</p>
                      <p className="text-[10px] text-on-surface-variant">Mínimo: {f.minStockKg || 0.5} kg</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
