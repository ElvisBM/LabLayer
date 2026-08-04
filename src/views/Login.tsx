import React, { useState } from 'react';
import { loginWithEmail, resetPassword } from '../firebase';
import { Mail, Lock } from 'lucide-react';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const getValidEmail = () => email.includes('@') ? email : `${email}@empresa.com`;
  const getResetEmail = () => email.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      await loginWithEmail(getValidEmail(), password);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Usuário ou senha incorretos.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setError('O login por Email/Senha não está ativado no Firebase. Siga os passos no chat para ativar.');
      } else {
        setError(`Erro: ${err.message || err.code || 'Desconhecido'}. Verifique o console.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError('Informe seu e-mail para receber o link de redefinição.');
      setMessage('');
      return;
    }

    if (!getResetEmail().includes('@')) {
      setError('Para redefinir a senha, informe o e-mail completo da conta.');
      setMessage('');
      return;
    }

    setError('');
    setMessage('');
    setLoading(true);

    try {
      await resetPassword(getResetEmail());
      setMessage('Enviamos o link de redefinição para o seu e-mail.');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/user-not-found') {
        setError('Não encontramos um usuário com esse e-mail.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Informe um e-mail válido para redefinir a senha.');
      } else {
        setError(`Erro ao enviar redefinição: ${err.message || err.code || 'Desconhecido'}.`);
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

        {message && (
          <div className="mb-4 p-3 bg-primary/10 text-primary text-sm rounded-lg border border-primary/20">
            {message}
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
            {loading ? 'Aguarde...' : 'Entrar'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleResetPassword}
          disabled={loading}
          className="text-primary font-bold hover:underline disabled:opacity-50"
        >
          Esqueci minha senha
        </button>
        <p className="mt-2 text-xs text-on-surface-variant">
          Para redefinir a senha, use o e-mail completo da conta.
        </p>
      </div>
    </div>
  );
}
