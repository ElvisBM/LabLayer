import { Bell, HelpCircle, Search, LogOut, Menu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { logout } from '../firebase';

interface TopBarProps {
  title: string;
  onMenuClick: () => void;
}

export function TopBar({ title, onMenuClick }: TopBarProps) {
  const { user } = useAuth();

  return (
    <header className="w-full sticky top-0 z-30 bg-slate-50/80 backdrop-blur-md border-b border-slate-200/50 flex justify-between items-center px-4 lg:px-6 h-16">
      <div className="flex items-center gap-3 lg:gap-4">
        <button 
          onClick={onMenuClick}
          className="p-2 -ml-2 text-slate-500 hover:bg-slate-200/50 rounded-lg lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold tracking-tighter text-primary uppercase font-headline hidden sm:block">
          LABLAYER
        </h2>
        <div className="h-6 w-[1px] bg-outline-variant/30 hidden sm:block"></div>
        <span className="text-slate-500 font-sans text-sm font-medium capitalize truncate max-w-[150px] sm:max-w-none">
          {title}
        </span>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="relative hidden lg:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input 
            type="text" 
            placeholder="Buscar ordens, estoque..." 
            className="bg-surface-container border-none rounded-md pl-10 pr-4 py-1.5 text-sm w-64 focus:ring-1 focus:ring-primary outline-none"
          />
        </div>
        
        <div className="flex items-center gap-3">
          <button className="p-2 text-slate-500 hover:bg-slate-200/50 rounded-full transition-colors cursor-pointer active:scale-95">
            <Bell className="w-5 h-5" />
          </button>
          <button className="p-2 text-slate-500 hover:bg-slate-200/50 rounded-full transition-colors cursor-pointer active:scale-95">
            <HelpCircle className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden border-2 border-surface-container-highest flex items-center justify-center text-slate-500 font-bold text-xs">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                user?.displayName?.charAt(0) || 'U'
              )}
            </div>
            <button 
              onClick={logout}
              className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors cursor-pointer active:scale-95"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
