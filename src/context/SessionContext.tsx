'use client';

import { createContext, useContext, useEffect, useState } from 'react';

interface Usuario {
  id: string;
  nome: string;
  email: string;
}

interface SessionContextValue {
  usuario: Usuario | null;
  loading: boolean;
}

const SessionContext = createContext<SessionContextValue>({ usuario: null, loading: true });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setUsuario(d?.usuario ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <SessionContext.Provider value={{ usuario, loading }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
