import { InventoryPage } from './features/inventory/InventoryPage';
import { useInventoryPhase } from './features/inventory/useInventoryPhase';
import { CatalogPage } from './features/catalog/CatalogPage';
import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Dashboard } from './views/Dashboard';
import { Filamentos } from './views/Filamentos';
import { AgendaProducao } from './views/AgendaProducao';
import { EncomendasOrcamentos } from './views/EncomendasOrcamentos';
import { Fornecedores } from './views/Fornecedores';
import { Impressoras } from './views/Impressoras';
import { Insumos } from './views/Insumos';
import { Produtos } from './views/Produtos';
import { Marketplaces } from './views/Marketplaces';
import { Precificacao } from './views/Precificacao';
import { ValoresSugeridos } from './views/ValoresSugeridos';
import { Vendas } from './views/Vendas';
import { ControlePerdas } from './views/ControlePerdas';
import { EstoqueInteligente } from './views/EstoqueInteligente';
import { Financeiro } from './views/Financeiro';
import { Configuracoes } from './views/Configuracoes';
import { SuperAdmin } from './views/SuperAdmin';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { logout } from './firebase';
import { Login } from './views/Login';

import { Toaster } from 'react-hot-toast';

function MainApp() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [isSidebarMobileOpen, setIsSidebarMobileOpen] = useState(false);
  const [isSidebarDesktopOpen, setIsSidebarDesktopOpen] = useState(true);
  const [productEditorState, setProductEditorState] = useState<{ mode: 'new' | 'edit'; productId: string | null }>({
    mode: 'new',
    productId: null,
  });
  const { user, tenantId, loading, initializationError } = useAuth();
  const inventory = useInventoryPhase(tenantId);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-surface text-primary font-bold">Carregando...</div>;
  }

  if (!user) {
    return <Login />;
  }

  if (initializationError) {
    return <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 bg-surface">
      <p role="alert">{initializationError}</p>
      <button onClick={() => window.location.reload()}>Tentar novamente</button>
      <button onClick={() => logout()}>Sair</button>
    </div>;
  }

  const renderView = () => {
    if (inventory.phase === 'loading') return <p>Conferindo estado do estoque...</p>;
    if (inventory.phase === 'error') return <p role="alert">Não foi possível conferir o estado do estoque. Recarregue antes de operar.</p>;
    if (currentView === 'estoque-operacoes') return <InventoryPage onCatalog={() => setCurrentView('catalogo-fichas')} />;
    if (inventory.phase !== 'legacy') {
      if (['produtos', 'produto-editor', 'catalogo-fichas'].includes(currentView)) return <CatalogPage operational onBack={() => setCurrentView('estoque-operacoes')} />;
      if (['dashboard', 'filamentos', 'insumos', 'estoque', 'agenda', 'perdas'].includes(currentView)) return <InventoryPage onCatalog={() => setCurrentView('catalogo-fichas')} />;
      if (['vendas', 'financeiro', 'encomendas', 'precificacao', 'valores-sugeridos'].includes(currentView)) return <div role="note"><p>O estoque desta empresa já iniciou a migração. Esta tela antiga permanece bloqueada para não gravar ou apresentar valores incompatíveis. Novas propostas, vendas e fechamento financeiro ainda não estão disponíveis neste modelo.</p><button onClick={() => setCurrentView('estoque-operacoes')}>Abrir estoque e produção</button></div>;
    }
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'vendas':
        return <Vendas />;
      case 'financeiro':
        return <Financeiro />;
      case 'catalogo-fichas':
        return <CatalogPage onBack={() => setCurrentView('produtos')} />;
      case 'produtos':
        return (
          <Produtos
            mode="list"
            onOpenCatalog={() => setCurrentView('catalogo-fichas')}
            onOpenEditor={(mode, productId) => {
              setProductEditorState({ mode, productId: productId || null });
              setCurrentView('produto-editor');
            }}
          />
        );
      case 'produto-editor':
        return (
          <Produtos
            mode="editor"
            editorMode={productEditorState.mode}
            editorProductId={productEditorState.productId}
            onCloseEditor={() => {
              setProductEditorState({ mode: 'new', productId: null });
              setCurrentView('produtos');
            }}
          />
        );
      case 'precificacao':
        return <Precificacao />;
      case 'valores-sugeridos':
        return <ValoresSugeridos />;
      case 'marketplaces':
        return <Marketplaces />;
      case 'perdas':
        return <ControlePerdas />;
      case 'estoque':
        return <EstoqueInteligente />;
      case 'filamentos':
        return <Filamentos />;
      case 'agenda':
        return <AgendaProducao />;
      case 'encomendas':
        return <EncomendasOrcamentos />;
      case 'fornecedores':
        return <Fornecedores />;
      case 'impressoras':
        return <Impressoras inventoryActive={inventory.phase !== 'legacy'} />;
      case 'insumos':
        return <Insumos />;
      case 'configuracoes':
        return <Configuracoes />;
      case 'superadmin':
        return <SuperAdmin />;
      default:
        return <Dashboard />;
    }
  };

  const getTitle = () => {
    if (currentView === 'estoque-operacoes' || (inventory.phase !== 'legacy' && ['dashboard', 'filamentos', 'insumos', 'estoque', 'agenda', 'perdas'].includes(currentView))) return 'Estoque e produção';
    switch (currentView) {
      case 'dashboard': return 'Painel Financeiro';
      case 'vendas': return 'Gestão de Vendas';
      case 'financeiro': return 'Controle Financeiro';
      case 'produtos': return 'Catálogo de Produtos';
      case 'catalogo-fichas': return 'Catálogo e Fichas';
      case 'produto-editor': return productEditorState.mode === 'edit' ? 'Editar Produto' : 'Novo Produto';
      case 'precificacao': return 'Simulador de Precificação';
      case 'valores-sugeridos': return 'Valores Sugeridos';
      case 'marketplaces': return 'Canais de Venda';
      case 'perdas': return 'Controle de Perdas';
      case 'estoque': return 'Estoque Inteligente';
      case 'filamentos': return 'Gestão de Filamentos';
      case 'agenda': return 'Agenda de Produção';
      case 'encomendas': return 'Encomendas e Orçamentos';
      case 'fornecedores': return 'Cadastro de Fornecedores';
      case 'impressoras': return 'Frota de Impressoras';
      case 'insumos': return 'Insumos e Componentes';
      case 'configuracoes': return 'Configurações do Sistema';
      case 'superadmin': return 'Administração Global';
      default: return 'Painel Operacional';
    }
  };

  return (
    <div className="flex bg-surface text-on-surface min-h-screen font-sans overflow-x-hidden">
      <Sidebar 
        currentView={currentView} 
        setCurrentView={(view) => {
          setCurrentView(view);
          setIsSidebarMobileOpen(false);
        }} 
        isMobileOpen={isSidebarMobileOpen}
        setIsMobileOpen={setIsSidebarMobileOpen}
        isDesktopOpen={isSidebarDesktopOpen}
        setIsDesktopOpen={setIsSidebarDesktopOpen}
      />
      
      {/* Mobile overlay */}
      {isSidebarMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsSidebarMobileOpen(false)}
        />
      )}

      <main className={`flex-1 flex flex-col min-h-screen w-full transition-all duration-300 ${isSidebarDesktopOpen ? 'lg:ml-64' : 'lg:ml-0'}`}>
        <TopBar
          title={getTitle()}
          onMenuClick={() => {
            if (window.innerWidth >= 1024) {
              setIsSidebarDesktopOpen(prev => !prev);
              return;
            }
            setIsSidebarMobileOpen(true);
          }}
        />
        <div className="p-4 lg:p-8 flex-1 overflow-x-hidden">
          <button className="mb-4 rounded border p-2" onClick={() => setCurrentView('estoque-operacoes')}>Estoque e produção — operações e migração</button>
          {renderView()}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
      <Toaster position="top-right" />
    </AuthProvider>
  );
}
