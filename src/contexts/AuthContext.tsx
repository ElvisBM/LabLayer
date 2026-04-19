import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  tenantId: string | null;
  isSuperAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, tenantId: null, isSuperAdmin: false });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        setTenantId(currentUser.uid);
        
        try {
          // Check Super Admin status
          let superAdminStatus = currentUser.email === 'elvisbmartins@gmail.com';
          
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              email: currentUser.email,
              role: superAdminStatus ? 'superadmin' : 'admin',
              createdAt: new Date().toISOString()
            });
          } else {
            if (userSnap.data().role === 'superadmin') {
              superAdminStatus = true;
            }
          }
          setIsSuperAdmin(superAdminStatus);

          // Ensure tenant document exists
          const tenantRef = doc(db, 'tenants', currentUser.uid);
          const tenantSnap = await getDoc(tenantRef);
          
          if (!tenantSnap.exists()) {
            await setDoc(tenantRef, {
              ownerUid: currentUser.uid,
              ownerEmail: currentUser.email,
              companyName: currentUser.displayName || 'Minha Empresa',
              plan: 'free',
              status: 'active', // active, inactive, past_due
              createdAt: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error("Error initializing user/tenant:", error);
        }
      } else {
        setTenantId(null);
        setIsSuperAdmin(false);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, tenantId, isSuperAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};
