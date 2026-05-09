import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Dashboard } from './views/Dashboard';
import { Filamentos } from './views/Filamentos';
import { AgendaProducao } from './views/AgendaProducao';
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
import { Login } from './views/Login';

import { Toaster } from 'react-hot-toast';

function MainApp() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-surface text-primary font-bold">Carregando...</div>;
  }

  if (!user) {
    return <Login />;
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'vendas':
        return <Vendas />;
      case 'financeiro':
        return <Financeiro />;
      case 'produtos':
        return <Produtos />;
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
      case 'fornecedores':
        return <Fornecedores />;
      case 'impressoras':
        return <Impressoras />;
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
    switch (currentView) {
      case 'dashboard': return 'Painel Financeiro';
      case 'vendas': return 'Gestão de Vendas';
      case 'financeiro': return 'Controle Financeiro';
      case 'produtos': return 'Catálogo de Produtos';
      case 'precificacao': return 'Simulador de Precificação';
      case 'valores-sugeridos': return 'Valores Sugeridos';
      case 'marketplaces': return 'Canais de Venda';
      case 'perdas': return 'Controle de Perdas';
      case 'estoque': return 'Estoque Inteligente';
      case 'filamentos': return 'Gestão de Filamentos';
      case 'agenda': return 'Agenda de Produção';
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
          setIsSidebarOpen(false);
        }} 
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
      />
      
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <main className="flex-1 lg:ml-64 flex flex-col min-h-screen w-full transition-all duration-300">
        <TopBar title={getTitle()} onMenuClick={() => setIsSidebarOpen(true)} />
        <div className="p-4 lg:p-8 flex-1 overflow-x-hidden">
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
