import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { ShieldAlert, CheckCircle, XCircle, Users, Activity, CreditCard, AlertOctagon, DollarSign } from 'lucide-react';

const PLAN_PRICES = {
  free: 0,
  pro: 97,
  enterprise: 297
};

interface Tenant {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  companyName: string;
  plan: string;
  status: string;
  createdAt: string;
}

export function SuperAdmin() {
  const { isSuperAdmin } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSuperAdmin) return;

    const unsubscribe = onSnapshot(collection(db, 'tenants'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tenant));
      setTenants(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching tenants:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isSuperAdmin]);

  const toggleTenantStatus = async (tenantId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
      await updateDoc(doc(db, 'tenants', tenantId), { status: newStatus });
    } catch (error) {
      console.error("Error updating tenant status:", error);
      alert("Erro ao atualizar status do cliente.");
    }
  };

  const updateTenantPlan = async (tenantId: string, newPlan: string) => {
    try {
      await updateDoc(doc(db, 'tenants', tenantId), { plan: newPlan });
    } catch (error) {
      console.error("Error updating tenant plan:", error);
      alert("Erro ao atualizar plano do cliente.");
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
        <ShieldAlert className="w-16 h-16 text-error" />
        <h2 className="text-2xl font-bold text-on-surface">Acesso Negado</h2>
        <p className="text-on-surface-variant">Você não tem permissão para acessar esta área.</p>
      </div>
    );
  }

  const mrr = tenants
    .filter(t => t.status === 'active')
    .reduce((acc, t) => acc + (PLAN_PRICES[t.plan as keyof typeof PLAN_PRICES] || 0), 0);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Super Admin</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Gestão global de clientes e assinaturas do SaaS.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container p-6 rounded-xl border border-outline-variant/20 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Total de Clientes</p>
            <p className="text-2xl font-bold text-on-surface">{tenants.length}</p>
          </div>
        </div>
        <div className="bg-surface-container p-6 rounded-xl border border-outline-variant/20 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Clientes Ativos</p>
            <p className="text-2xl font-bold text-on-surface">{tenants.filter(t => t.status === 'active').length}</p>
          </div>
        </div>
        <div className="bg-surface-container p-6 rounded-xl border border-outline-variant/20 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-600">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">MRR Estimado</p>
            <p className="text-2xl font-bold text-on-surface">R$ {mrr.toFixed(2)}</p>
          </div>
        </div>
        <div className="bg-surface-container p-6 rounded-xl border border-outline-variant/20 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center text-error">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Inadimplentes</p>
            <p className="text-2xl font-bold text-on-surface">{tenants.filter(t => t.status === 'past_due').length}</p>
          </div>
        </div>
      </div>

      <section className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                <th className="px-6 py-3">Empresa / Cliente</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Plano</th>
                <th className="px-6 py-3">Data de Cadastro</th>
                <th className="px-6 py-3 text-center">Status</th>
                <th className="px-6 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-on-surface-variant">Carregando clientes...</td>
                </tr>
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-on-surface-variant">Nenhum cliente encontrado.</td>
                </tr>
              ) : (
                tenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-primary">{tenant.companyName}</p>
                      <p className="text-[10px] font-mono text-on-surface-variant uppercase">ID: {tenant.id.substring(0, 8)}...</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface">
                      {tenant.ownerEmail || 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={tenant.plan || 'free'}
                        onChange={(e) => updateTenantPlan(tenant.id, e.target.value)}
                        className="bg-surface-container border-none rounded p-1.5 text-xs font-bold uppercase tracking-widest focus:ring-2 focus:ring-primary outline-none cursor-pointer"
                      >
                        <option value="free">FREE</option>
                        <option value="pro">PRO</option>
                        <option value="enterprise">ENTERPRISE</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {tenant.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold bg-green-100 text-green-800">
                          <CheckCircle className="w-3 h-3" /> Ativo
                        </span>
                      ) : tenant.status === 'past_due' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold bg-yellow-100 text-yellow-800">
                          <AlertOctagon className="w-3 h-3" /> Inadimplente
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-800">
                          <XCircle className="w-3 h-3" /> Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => toggleTenantStatus(tenant.id, tenant.status)}
                        className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                          tenant.status === 'active' 
                            ? 'bg-error/10 text-error hover:bg-error/20' 
                            : 'bg-primary/10 text-primary hover:bg-primary/20'
                        }`}
                      >
                        {tenant.status === 'active' ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
