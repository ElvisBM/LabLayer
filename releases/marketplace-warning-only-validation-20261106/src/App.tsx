import { AssistantLinks } from './features/assistant/Assistant';
import { useInventoryPhase } from './features/inventory/useInventoryPhase';
import { lazy, useState } from 'react';
import { ViewBoundary } from './components/ViewBoundary';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { logout } from './firebase';
import { Login } from './views/Login';

import { Toaster } from 'react-hot-toast';

const InventoryPage = lazy(() => import('./features/inventory/InventoryPage').then(module => ({ default: module.InventoryPage })));
const QuotesPage = lazy(() => import('./features/quotes/QuotesPage').then(module => ({ default: module.QuotesPage })));
const FinancePage = lazy(() => import('./features/finance/FinancePage').then(module => ({ default: module.FinancePage })));
const CatalogPage = lazy(() => import('./features/catalog/CatalogPage').then(module => ({ default: module.CatalogPage })));
const Dashboard = lazy(() => import('./views/Dashboard').then(module => ({ default: module.Dashboard })));
const Filamentos = lazy(() => import('./views/Filamentos').then(module => ({ default: module.Filamentos })));
const AgendaProducao = lazy(() => import('./views/AgendaProducao').then(module => ({ default: module.AgendaProducao })));
const EncomendasOrcamentos = lazy(() => import('./views/EncomendasOrcamentos').then(module => ({ default: module.EncomendasOrcamentos })));
const Fornecedores = lazy(() => import('./views/Fornecedores').then(module => ({ default: module.Fornecedores })));
const Impressoras = lazy(() => import('./views/Impressoras').then(module => ({ default: module.Impressoras })));
const Insumos = lazy(() => import('./views/Insumos').then(module => ({ default: module.Insumos })));
const Produtos = lazy(() => import('./views/Produtos').then(module => ({ default: module.Produtos })));
const MarketplaceListings = lazy(() => import('./features/integrations/MarketplaceListings').then(module => ({ default: module.MarketplaceListings })));
const Marketplaces = lazy(() => import('./views/Marketplaces').then(module => ({ default: module.Marketplaces })));
const Precificacao = lazy(() => import('./views/Precificacao').then(module => ({ default: module.Precificacao })));
const ValoresSugeridos = lazy(() => import('./views/ValoresSugeridos').then(module => ({ default: module.ValoresSugeridos })));
const Vendas = lazy(() => import('./views/Vendas').then(module => ({ default: module.Vendas })));
const ControlePerdas = lazy(() => import('./views/ControlePerdas').then(module => ({ default: module.ControlePerdas })));
const EstoqueInteligente = lazy(() => import('./views/EstoqueInteligente').then(module => ({ default: module.EstoqueInteligente })));
const Financeiro = lazy(() => import('./views/Financeiro').then(module => ({ default: module.Financeiro })));
const Configuracoes = lazy(() => import('./views/Configuracoes').then(module => ({ default: module.Configuracoes })));
const SuperAdmin = lazy(() => import('./views/SuperAdmin').then(module => ({ default: module.SuperAdmin })));

const TeamPage = lazy(() => import('./features/team/TeamPage').then(module => ({ default: module.TeamPage })));

function MainApp() {
  const [currentView, setCurrentView] = useState(() => ['configuracoes', 'anuncios'].includes(new URLSearchParams(window.location.search).get('view') || '') ? new URLSearchParams(window.location.search).get('view')! : 'dashboard');
  const [isSidebarMobileOpen, setIsSidebarMobileOpen] = useState(false);
  const [isSidebarDesktopOpen, setIsSidebarDesktopOpen] = useState(true);
  const [productEditorState, setProductEditorState] = useState<{ mode: 'new' | 'edit'; productId: string | null }>({
    mode: 'new',
    productId: null,
  });
  const { user, tenantId, loading, initializationError } = useAuth();
  const inventory = useInventoryPhase(tenantId);
  const inventoryAvailable = !['legacy', 'loading', 'error'].includes(inventory.phase);

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
    if (currentView === 'assistente') return <AssistantLinks />;
    if (currentView === 'usuarios') return <TeamPage />;
    if (currentView === 'estoque-operacoes') {
      if (inventory.phase === 'loading' || inventory.phase === 'error') return <section className="mx-auto max-w-xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950" role={inventory.phase === 'error' ? 'alert' : 'status'}>
        <h2 className="font-semibold">Estoque indisponível no momento</h2>
        <p className="mt-2">{inventory.phase === 'loading' ? 'Conferindo o estado do estoque…' : 'Não foi possível conferir o estado do estoque. As demais telas continuam disponíveis.'}</p>
        {inventory.phase === 'error' && <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg bg-amber-950 px-4 py-2 text-white" onClick={() => window.location.reload()}>Tentar novamente</button><button className="rounded-lg border border-amber-700 px-4 py-2" onClick={() => setCurrentView('dashboard')}>Voltar ao painel</button></div>}
      </section>;
      return <InventoryPage onCatalog={() => setCurrentView('catalogo-fichas')} />;
    }
    if (currentView === 'financeiro-conciliacao') {
      if (inventory.phase === 'loading' || inventory.phase === 'error') return <section className="mx-auto max-w-xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950" role={inventory.phase === 'error' ? 'alert' : 'status'}>
        <h2 className="font-semibold">Conciliação indisponível no momento</h2>
        <p className="mt-2">{inventory.phase === 'loading' ? 'Conferindo o estado do estoque…' : 'Não foi possível conferir o estado do estoque, necessário para esta tela. As demais áreas continuam disponíveis.'}</p>
        {inventory.phase === 'error' && <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg bg-amber-950 px-4 py-2 text-white" onClick={() => window.location.reload()}>Tentar novamente</button><button className="rounded-lg border border-amber-700 px-4 py-2" onClick={() => setCurrentView('dashboard')}>Voltar ao painel</button></div>}
      </section>;
      return <FinancePage onOrders={() => setCurrentView('orcamentos-pedidos')} onInventory={() => setCurrentView('estoque-operacoes')} />;
    }
    if (inventoryAvailable && ['dashboard', 'financeiro'].includes(currentView)) return <FinancePage onOrders={() => setCurrentView('orcamentos-pedidos')} onInventory={() => setCurrentView('estoque-operacoes')} />;
    if (currentView === 'orcamentos-pedidos' && (inventory.phase === 'loading' || inventory.phase === 'error')) return <EncomendasOrcamentos />;
    if (currentView === 'orcamentos-pedidos' || (inventoryAvailable && ['vendas', 'encomendas', 'precificacao', 'valores-sugeridos'].includes(currentView))) return <QuotesPage onInventory={() => setCurrentView('estoque-operacoes')} onCatalog={() => setCurrentView('catalogo-fichas')} />;
    if (inventoryAvailable) {
      if (['produtos', 'produto-editor', 'catalogo-fichas'].includes(currentView)) return <CatalogPage operational onBack={() => setCurrentView('estoque-operacoes')} />;
      if (['filamentos', 'insumos', 'estoque', 'agenda', 'perdas'].includes(currentView)) return <InventoryPage onCatalog={() => setCurrentView('catalogo-fichas')} />;
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
      case 'anuncios': return <MarketplaceListings />;
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
    if (currentView === 'financeiro-conciliacao' || (inventoryAvailable && ['dashboard', 'financeiro'].includes(currentView))) return 'Financeiro e conciliação';
    if (currentView === 'orcamentos-pedidos' || (inventoryAvailable && ['vendas', 'encomendas', 'precificacao', 'valores-sugeridos'].includes(currentView))) return 'Orçamentos e pedidos';
    if (currentView === 'estoque-operacoes' || (inventoryAvailable && ['dashboard', 'filamentos', 'insumos', 'estoque', 'agenda', 'perdas'].includes(currentView))) return 'Estoque e produção';
    switch (currentView) {
      case 'dashboard': return 'Painel Financeiro';
      case 'vendas': return 'Gestão de Vendas';
      case 'financeiro': return 'Controle Financeiro';
      case 'produtos': return 'Catálogo de Produtos';
      case 'catalogo-fichas': return 'Catálogo e Fichas';
      case 'produto-editor': return productEditorState.mode === 'edit' ? 'Editar Produto' : 'Novo Produto';
      case 'precificacao': return 'Simulador de Precificação';
      case 'valores-sugeridos': return 'Valores Sugeridos';
      case 'anuncios': return 'Anúncios';
      case 'marketplaces': return 'Canais de Venda';
      case 'perdas': return 'Controle de Perdas';
      case 'estoque': return 'Estoque Inteligente';
      case 'filamentos': return 'Gestão de Filamentos';
      case 'agenda': return 'Agenda de Produção';
      case 'encomendas': return 'Encomendas e Orçamentos';
      case 'fornecedores': return 'Cadastro de Fornecedores';
      case 'impressoras': return 'Frota de Impressoras';
      case 'insumos': return 'Insumos e Componentes';
      case 'assistente': return 'Assistente';
      case 'usuarios': return 'Usuários e empresa';
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
          <ViewBoundary key={`${tenantId}:${inventory.phase}:${currentView}`}>
            {renderView()}
          </ViewBoundary>
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
