import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // getSession() is the authoritative initializer — it handles token refresh if needed.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION duplicates getSession() and can arrive before it resolves,
      // causing a null-user flash that sends ProtectedRoute to /signin.
      if (event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_IN' && session?.user?.app_metadata?.provider === 'google') {
        // Fire-and-forget so state is never delayed by the network call.
        supabase.from('profiles').upsert(
          {
            id: session.user.id,
            email: session.user.email ?? '',
            first_name: session.user.user_metadata?.given_name ?? '',
            last_name: session.user.user_metadata?.family_name ?? '',
          },
          { onConflict: 'id', ignoreDuplicates: true },
        );
      }

      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [user, session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
