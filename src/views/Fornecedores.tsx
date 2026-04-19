import React, { useEffect, useState } from 'react';
import { Plus, Store, Phone, MapPin, Edit2, Trash2 } from 'lucide-react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  status: 'ativo' | 'inativo';
  createdAt?: string;
}

export function Fornecedores() {
  const { tenantId } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Supplier>>({
    name: '',
    phone: '',
    address: '',
    notes: '',
    status: 'ativo',
  });

  useEffect(() => {
    if (!tenantId) return;

    const unsubscribe = onSnapshot(collection(db, `tenants/${tenantId}/suppliers`), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
      setSuppliers(data);
    }, (error) => {
      console.error("Error fetching suppliers:", error);
      toast.error("Erro ao carregar fornecedores.");
    });

    return () => unsubscribe();
  }, [tenantId]);

  const resetForm = () => {
    setFormData({
      name: '',
      phone: '',
      address: '',
      notes: '',
      status: 'ativo',
    });
    setEditingId(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;

    try {
      const dataToSave = {
        name: formData.name || '',
        phone: formData.phone || '',
        address: formData.address || '',
        notes: formData.notes || '',
        status: formData.status || 'ativo',
      };

      if (editingId) {
        await updateDoc(doc(db, `tenants/${tenantId}/suppliers`, editingId), dataToSave);
        toast.success('Fornecedor atualizado com sucesso!');
      } else {
        await addDoc(collection(db, `tenants/${tenantId}/suppliers`), {
          ...dataToSave,
          createdAt: new Date().toISOString(),
        });
        toast.success('Fornecedor cadastrado com sucesso!');
      }

      setShowForm(false);
      resetForm();
    } catch (error) {
      console.error("Error saving supplier:", error);
      toast.error("Erro ao salvar fornecedor.");
    }
  };

  const handleEdit = (supplier: Supplier) => {
    setFormData(supplier);
    setEditingId(supplier.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (supplierId: string) => {
    if (!tenantId || !window.confirm('Tem certeza que deseja excluir este fornecedor?')) return;

    try {
      await deleteDoc(doc(db, `tenants/${tenantId}/suppliers`, supplierId));
      toast.success('Fornecedor excluído com sucesso!');
    } catch (error) {
      console.error("Error deleting supplier:", error);
      toast.error("Erro ao excluir fornecedor.");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="font-headline text-3xl font-bold text-primary tracking-tighter">Fornecedores</h2>
          <p className="text-on-surface-variant font-sans text-sm mt-1">Cadastre onde cada filamento foi comprado e mantenha telefone e endereço organizados.</p>
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
          Novo Fornecedor
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Total Cadastrado</h3>
          <p className="text-3xl font-headline font-bold text-on-surface tabular-nums">{suppliers.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Ativos</h3>
          <p className="text-3xl font-headline font-bold text-primary tabular-nums">{suppliers.filter(s => s.status !== 'inativo').length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Inativos</h3>
          <p className="text-3xl font-headline font-bold text-on-surface-variant tabular-nums">{suppliers.filter(s => s.status === 'inativo').length}</p>
        </div>
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <Store className="w-5 h-5 text-primary" />
            <h3 className="font-headline font-bold text-lg">{editingId ? 'Editar Fornecedor' : 'Cadastrar Fornecedor'}</h3>
          </div>

          <form className="grid grid-cols-1 md:grid-cols-2 gap-6" onSubmit={handleSave}>
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Nome do Fornecedor</label>
              <input
                type="text"
                required
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                placeholder="Ex: Filamento XYZ, Loja 3D Centro"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Telefone</label>
              <input
                type="text"
                value={formData.phone || ''}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
                placeholder="Ex: (11) 99999-9999"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Status</label>
              <select
                value={formData.status || 'ativo'}
                onChange={e => setFormData({ ...formData, status: e.target.value as Supplier['status'] })}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Endereço</label>
              <textarea
                value={formData.address || ''}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none min-h-[88px] resize-y"
                placeholder="Rua, número, bairro, cidade..."
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Observações</label>
              <textarea
                value={formData.notes || ''}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-surface-container border-none rounded p-2.5 text-sm focus:ring-2 focus:ring-primary outline-none min-h-[88px] resize-y"
                placeholder="Ex: atende via WhatsApp, entrega rápida, vende PLA importado..."
              />
            </div>

            <div className="md:col-span-2 flex justify-end gap-3 pt-4 border-t border-outline-variant/20">
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
                {editingId ? 'Atualizar Fornecedor' : 'Salvar Fornecedor'}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
                <th className="px-6 py-3">Fornecedor</th>
                <th className="px-6 py-3">Contato</th>
                <th className="px-6 py-3">Endereço</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {suppliers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-on-surface-variant">Nenhum fornecedor cadastrado.</td>
                </tr>
              )}
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-surface-container-low transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-surface-container rounded-md flex items-center justify-center flex-shrink-0">
                        <Store className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-primary">{supplier.name}</div>
                        {supplier.notes && <div className="text-[10px] text-on-surface-variant max-w-[280px] truncate" title={supplier.notes}>{supplier.notes}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {supplier.phone ? (
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5" />
                        <span>{supplier.phone}</span>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">
                    {supplier.address ? (
                      <div className="flex items-start gap-2 max-w-[320px]">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span className="line-clamp-2">{supplier.address}</span>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4">
                    {supplier.status === 'inativo' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-surface-container-highest text-on-surface-variant">Inativo</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-tertiary-fixed text-on-tertiary-fixed-variant">Ativo</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(supplier)} className="p-1.5 text-slate-400 hover:text-primary transition-colors rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(supplier.id)} className="p-1.5 text-slate-400 hover:text-error transition-colors rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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
