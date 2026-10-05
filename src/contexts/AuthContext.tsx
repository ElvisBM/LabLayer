import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  tenantId: string | null;
  isSuperAdmin: boolean;
  initializationError: string | null;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, tenantId: null, isSuperAdmin: false, initializationError: null });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const currentGeneration = ++generation;
      setUser(currentUser);
      setLoading(true);
      setTenantId(null);
      setIsSuperAdmin(false);
      setInitializationError(null);
      if (currentUser) {
        try {
          const token = await currentUser.getIdToken();
          const response = await fetch('/api/session', {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Não foi possível inicializar a empresa.');
          if (typeof result.tenantId !== 'string' || !result.tenantId) throw new Error('Resposta de sessão inválida.');
          if (generation !== currentGeneration) return;
          setTenantId(result.tenantId);
          setIsSuperAdmin(result.isSuperAdmin === true);
        } catch (error) {
          if (generation !== currentGeneration) return;
          setInitializationError(error instanceof Error ? error.message : 'Não foi possível inicializar a empresa.');
        }
      }
      if (generation === currentGeneration) setLoading(false);
    });

    return () => { generation++; unsubscribe(); };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, tenantId, isSuperAdmin, initializationError }}>
      {children}
    </AuthContext.Provider>
  );
};
