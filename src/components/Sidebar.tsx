import { LayoutDashboard, Package, Printer, Settings, Wrench, Box, Store, Calculator, ShoppingCart, AlertOctagon, Layers, Wallet, ShieldAlert, Cable, CalendarDays, Tag, X, PanelLeftClose } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (isOpen: boolean) => void;
  isDesktopOpen: boolean;
  setIsDesktopOpen: (isOpen: boolean) => void;
}

export function Sidebar({
  currentView,
  setCurrentView,
  isMobileOpen,
  setIsMobileOpen,
  isDesktopOpen,
  setIsDesktopOpen,
}: SidebarProps) {
  const { isSuperAdmin } = useAuth();

  const navGroups = [
    {
      title: 'Básico',
      items: [
        { id: 'dashboard', label: 'Painel', icon: LayoutDashboard },
        { id: 'produtos', label: 'Produtos', icon: Package },
        { id: 'agenda', label: 'Agenda de Produção', icon: CalendarDays },
        { id: 'precificacao', label: 'Precificação', icon: Calculator },
        { id: 'valores-sugeridos', label: 'Valores Sugeridos', icon: Tag },
        { id: 'filamentos', label: 'Filamentos', icon: Cable },
        { id: 'fornecedores', label: 'Fornecedores', icon: Store },
        { id: 'insumos', label: 'Insumos', icon: Box },
        { id: 'impressoras', label: 'Impressoras', icon: Printer },
        { id: 'marketplaces', label: 'Marketplace', icon: Wrench },
      ]
    },
    {
      title: 'Vendas',
      items: [
        { id: 'vendas', label: 'Vendas', icon: ShoppingCart },
        { id: 'financeiro', label: 'Financeiro', icon: Wallet },
        { id: 'estoque', label: 'Estoque Inteligente', icon: Layers },
        { id: 'perdas', label: 'Controle de Perdas', icon: AlertOctagon },
      ]
    },
    {
      title: 'Configurações',
      items: [
        { id: 'configuracoes', label: 'Configurações', icon: Settings },
      ]
    }
  ];

  if (isSuperAdmin) {
    navGroups[2].items.push({ id: 'superadmin', label: 'Super Admin', icon: ShieldAlert });
  }

  return (
    <aside className={`h-screen w-64 fixed left-0 top-0 bg-slate-100 flex flex-col p-4 gap-2 z-50 border-r border-outline-variant/20 transition-transform duration-300 ease-in-out ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} ${isDesktopOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'}`}>
      <div className="mb-8 px-2 flex items-start justify-between">
        <img 
          src="https://i.postimg.cc/pXXRSprc/Logo-Lab-Layer-3D-(1).png" 
          alt="LabLayer Logo" 
          className="h-24 w-auto object-contain mb-2 -ml-2"
          referrerPolicy="no-referrer"
        />
        <button
          onClick={() => setIsMobileOpen(false)}
          className="p-1.5 text-slate-400 hover:bg-slate-200 rounded-lg lg:hidden"
        >
          <X className="w-5 h-5" />
        </button>
        <button
          onClick={() => setIsDesktopOpen(false)}
          className="hidden lg:inline-flex p-1.5 text-slate-400 hover:bg-slate-200 rounded-lg"
          title="Fechar menu"
        >
          <PanelLeftClose className="w-5 h-5" />
        </button>
      </div>
      
      <nav className="flex flex-col gap-6 flex-grow overflow-y-auto pb-4">
        {navGroups.map((group, idx) => (
          <div key={idx} className="flex flex-col gap-1">
            <h3 className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              {group.title}
            </h3>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id || (item.id === 'produtos' && currentView === 'produto-editor');
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 ease-in-out font-sans text-sm font-medium w-full text-left ${
                    isActive
                      ? 'bg-slate-200 text-slate-900 font-bold'
                      : 'text-slate-600 hover:bg-slate-200/50'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
