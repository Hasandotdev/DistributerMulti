import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Employee, UserRole, CompanyMembership } from '@/types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  userRole: UserRole | null;
  userEmployee: Employee | null;
  memberships: CompanyMembership[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [userEmployee, setUserEmployee] = useState<Employee | null>(null);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user);
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user);
      } else {
        setUserEmployee(null);
        setUserRole(null);
        setMemberships([]);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchUserData(user: User) {
    try {
      const rawRole = (user.user_metadata?.role ??
        user.app_metadata?.role ??
        'employee') as string;
      const role: UserRole =
        rawRole === 'super_admin' || rawRole === 'admin' ? rawRole : 'employee';
      setUserRole(role);

      const [employeeResult, membershipResult] = await Promise.all([
        supabase
          .from('employees')
          .select('*')
          .eq('auth_user_id', user.id)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('company_memberships')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true),
      ]);

      setUserEmployee((employeeResult.data as Employee) ?? null);
      setMemberships((membershipResult.data as CompanyMembership[]) ?? []);
    } catch {
      setUserEmployee(null);
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setUserRole(null);
    setUserEmployee(null);
    setMemberships([]);
    localStorage.removeItem('activeCompanyId');
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-300 border-t-neutral-800" />
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signIn,
        signOut,
        userRole,
        userEmployee,
        memberships,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
