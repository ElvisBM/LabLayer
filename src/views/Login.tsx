import React, { useState } from 'react';
import { loginWithGoogle, loginWithEmail, registerWithEmail } from '../firebase';
import { Printer, ShieldCheck, Database, Zap, Mail, Lock } from 'lucide-react';

export function Login() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Firebase requires a valid email format, so we append a dummy domain if it's just a username
      const validEmail = email.includes('@') ? email : `${email}@empresa.com`;
      
      if (isRegistering) {
        await registerWithEmail(validEmail, password);
      } else {
        await loginWithEmail(validEmail, password);
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Usuário ou senha incorretos.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Este usuário já está cadastrado.');
      } else if (err.code === 'auth/weak-password') {
        setError('A senha deve ter pelo menos 6 caracteres.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setError('O login por Email/Senha não está ativado no Firebase. Siga os passos no chat para ativar.');
      } else {
        setError(`Erro: ${err.message || err.code || 'Desconhecido'}. Verifique o console.`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-surface-container-lowest p-8 rounded-2xl shadow-xl border border-outline-variant/20 text-center">
        <div className="flex justify-center mb-6">
          <img 
            src="https://i.postimg.cc/pXXRSprc/Logo-Lab-Layer-3D-(1).png" 
            alt="LabLayer Logo" 
            className="h-24 w-auto object-contain"
            referrerPolicy="no-referrer"
          />
        </div>
        
        <p className="text-on-surface-variant text-sm mb-8">
          Gestão industrial completa para sua fazenda de impressão 3D.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-error-container text-on-error-container text-sm rounded-lg border border-error/20">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div className="relative text-left">
            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant ml-1 mb-1 block">Usuário / E-mail</label>
            <div className="relative">
              <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input 
                type="text" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="elvisbmartins"
                className="w-full pl-10 pr-4 py-3 bg-surface-container border-none rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all"
                required
              />
            </div>
          </div>
          
          <div className="relative text-left">
            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant ml-1 mb-1 block">Senha</label>
            <div className="relative">
              <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 bg-surface-container border-none rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none transition-all"
                required
              />
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-primary text-on-primary font-bold rounded-xl hover:opacity-90 active:scale-95 transition-all shadow-md disabled:opacity-50"
          >
            {loading ? 'Aguarde...' : (isRegistering ? 'Criar Conta' : 'Entrar')}
          </button>
        </form>

        <div className="flex items-center justify-between text-sm mb-6">
          <span className="text-on-surface-variant">
            {isRegistering ? 'Já tem uma conta?' : 'Não tem uma conta?'}
          </span>
          <button 
            type="button"
            onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
            className="text-primary font-bold hover:underline"
          >
            {isRegistering ? 'Fazer Login' : 'Cadastre-se'}
          </button>
        </div>

        <div className="relative flex items-center py-2 mb-6">
          <div className="flex-grow border-t border-outline-variant/30"></div>
          <span className="flex-shrink-0 mx-4 text-on-surface-variant text-xs uppercase tracking-widest font-bold">Ou</span>
          <div className="flex-grow border-t border-outline-variant/30"></div>
        </div>

        <button 
          onClick={loginWithGoogle}
          type="button"
          className="w-full py-3 px-4 bg-surface-container text-on-surface font-bold rounded-xl hover:bg-surface-container-high active:scale-95 transition-all flex items-center justify-center gap-3 border border-outline-variant/20"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continuar com Google
        </button>
      </div>
    </div>
  );
}
