'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface Usuario {
  id: string;
  nome: string;
  email: string;
}

interface SessionContextValue {
  usuario: Usuario | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  usuario: null,
  loading: true,
  refreshSession: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me');
      const d = r.ok ? await r.json() : null;
      setUsuario(d?.usuario ?? null);
    } catch {
      setUsuario(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSession(); }, [fetchSession]);

  return (
    <SessionContext.Provider value={{ usuario, loading, refreshSession: fetchSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
