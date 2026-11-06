import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { Company } from '@/types/database';

const ACTIVE_COMPANY_KEY = 'activeCompanyId';

interface CompanyContextType {
  companies: Company[];
  activeCompany: Company | null;
  loading: boolean;
  switchCompany: (companyId: string) => void;
  refreshCompanies: () => Promise<void>;
  setActiveCompany: (company: Company) => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompany, setActiveCompanyState] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const applyActive = useCallback((list: Company[]) => {
    if (list.length === 0) {
      setActiveCompanyState(null);
      return;
    }
    const storedId = localStorage.getItem(ACTIVE_COMPANY_KEY);
    const found = storedId ? list.find((c) => c.id === storedId) : null;
    setActiveCompanyState(found ?? list[0]);
  }, []);

  const refreshCompanies = useCallback(async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Failed to load companies', error);
      setCompanies([]);
      setActiveCompanyState(null);
      return;
    }

    const list = (data as Company[]) ?? [];
    setCompanies(list);
    applyActive(list);
  }, [applyActive]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setCompanies([]);
          setActiveCompanyState(null);
          setLoading(false);
        }
        return;
      }

      await refreshCompanies();
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshCompanies]);

  function switchCompany(companyId: string) {
    const found = companies.find((c) => c.id === companyId);
    if (!found) return;
    localStorage.setItem(ACTIVE_COMPANY_KEY, companyId);
    setActiveCompanyState(found);
  }

  function setActiveCompany(company: Company) {
    localStorage.setItem(ACTIVE_COMPANY_KEY, company.id);
    setActiveCompanyState(company);
    setCompanies((prev) => {
      const idx = prev.findIndex((c) => c.id === company.id);
      if (idx === -1) return [...prev, company];
      const next = [...prev];
      next[idx] = company;
      return next;
    });
  }

  return (
    <CompanyContext.Provider
      value={{
        companies,
        activeCompany,
        loading,
        switchCompany,
        refreshCompanies,
        setActiveCompany,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}
