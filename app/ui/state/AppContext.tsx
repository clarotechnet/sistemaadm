"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ActivePayroll, AuditEntry, PayrollMonthOption, PlanComparisonState, SystemSettings, ToastMessage, UserProfile } from "../../../src/types";
import { createSupabaseBrowserClient } from "../../../src/lib/supabase/client";
import { cleanupExpiredRawFiles, clearAuditEntries, listPayrollMonths, loadAuditEntries, loadPayrollComparison, loadPayrollMonth, loadSystemSettings, storeAuditEntry } from "../../../src/services/browser-backend";

type AppContextValue = {
  user: UserProfile;
  activePayroll: ActivePayroll | null;
  payrollLoading: boolean;
  payrollMonths: PayrollMonthOption[];
  selectedCompetence: string | null;
  selectCompetence: (competence: string) => Promise<void>;
  refreshPayrollMonths: (preferred?: string) => Promise<void>;
  health: PlanComparisonState | null;
  setHealth: (value: PlanComparisonState | null) => void;
  dental: PlanComparisonState | null;
  setDental: (value: PlanComparisonState | null) => void;
  settings: SystemSettings;
  settingsLoading: boolean;
  refreshSettings: () => Promise<void>;
  audits: AuditEntry[];
  addAudit: (entry: Omit<AuditEntry, "id" | "timestamp" | "user">) => void;
  clearAudits: () => Promise<number>;
  toasts: ToastMessage[];  toast: (tone: ToastMessage["tone"], title: string, description?: string) => void;
  dismissToast: (id: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);
const STORAGE_KEY = "rh-control-payroll-competence";
const defaultSettings:SystemSettings={maskCpf:true,fileRetention:"NONE",financialTolerance:0.01};
const demoUser: UserProfile = { id: "local-preview", name: "Marina Alves", email: "marina.alves@empresa.com.br", department: "Recursos Humanos", jobTitle: "Coordenadora de RH", role: "ADMINISTRADOR", status: "ATIVO" };

export function AppProvider({ children, user = demoUser }: { children: React.ReactNode; user?: UserProfile }) {
  const [activePayroll, setActivePayrollState] = useState<ActivePayroll | null>(null);
  const [payrollLoading,setPayrollLoading]=useState(true);
  const [payrollMonths,setPayrollMonths]=useState<PayrollMonthOption[]>([]);
  const [selectedCompetence,setSelectedCompetence]=useState<string|null>(null);
  const [health, setHealth] = useState<PlanComparisonState | null>(null);
  const [dental, setDental] = useState<PlanComparisonState | null>(null);
  const [settings,setSettings]=useState<SystemSettings>(defaultSettings);
  const [settingsLoading,setSettingsLoading]=useState(true);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((tone: ToastMessage["tone"], title: string, description?: string) => {
    const id = crypto.randomUUID();
    setToasts(current => [...current, { id, tone, title, description }]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 5200);
  }, []);
  const addAudit = useCallback((entry: Omit<AuditEntry, "id" | "timestamp" | "user">) => {
    const complete = { ...entry, id: crypto.randomUUID(), timestamp: new Date().toISOString(), user: user.name };
    setAudits(current => [complete, ...current]);
    storeAuditEntry(user, complete).catch(() => undefined);
  }, [user]);

  const loadCompetence = useCallback(async (competence:string) => {
    setPayrollLoading(true);
    try {
      const payroll=await loadPayrollMonth(competence);
      setActivePayrollState(payroll);
      setSelectedCompetence(payroll?.competence??null);
      if(!payroll){
        setHealth(null);setDental(null);
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const [healthResult,dentalResult]=await Promise.allSettled([
        loadPayrollComparison(payroll.id,"health"),
        loadPayrollComparison(payroll.id,"dental"),
      ]);
      setHealth(healthResult.status==="fulfilled"?healthResult.value:null);
      setDental(dentalResult.status==="fulfilled"?dentalResult.value:null);
      if(healthResult.status==="rejected"||dentalResult.status==="rejected"){
        toast("warning","Comparativos ainda não puderam ser carregados","A folha foi carregada normalmente. Saúde/Odonto ficarão disponíveis assim que a estrutura de comparativos estiver acessível no banco.");
      }
      window.localStorage.setItem(STORAGE_KEY,payroll.competence);
    } catch(error) {
      setHealth(null);setDental(null);
      const message=error instanceof Error?error.message:"Não foi possível carregar os dados desta competência.";
      toast("error","Falha ao carregar a competência",message);
    } finally {
      setPayrollLoading(false);
    }
  }, [toast]);

  const refreshPayrollMonths=useCallback(async(preferred?:string)=>{
    setPayrollLoading(true);
    try{
      const months=await listPayrollMonths();
      setPayrollMonths(months);
      const stored=preferred??window.localStorage.getItem(STORAGE_KEY)??undefined;
      const target=months.find(item=>item.competence===stored)?.competence??months[0]?.competence;
      if(target)await loadCompetence(target);
      else{
        setActivePayrollState(null);setSelectedCompetence(null);setHealth(null);setDental(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }catch(error){
      setPayrollMonths([]);setActivePayrollState(null);setSelectedCompetence(null);setHealth(null);setDental(null);
      const message=error instanceof Error?error.message:"Não foi possível consultar as competências salvas.";
      toast("error","Falha ao carregar os dados da folha",message);
    }finally{
      setPayrollLoading(false);
    }
  },[loadCompetence,toast]);

  const clearAudits=useCallback(async()=>{
    const result=await clearAuditEntries();
    setAudits(result.audits);
    return result.removed;
  },[]);

  const dismissToast = useCallback((id: string) => setToasts(current => current.filter(item => item.id !== id)), []);
  const refreshSettings=useCallback(async()=>{
    setSettingsLoading(true);
    try{setSettings(await loadSystemSettings())}
    catch{setSettings(defaultSettings)}
    finally{setSettingsLoading(false)}
  },[]);

  useEffect(()=>{void refreshSettings()},[refreshSettings]);
  useEffect(()=>{void refreshPayrollMonths()},[refreshPayrollMonths]);
  useEffect(()=>{loadAuditEntries().then(setAudits).catch(()=>undefined)},[]);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let stopped = false;
    const heartbeat = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        await supabase.from("user_presence").upsert({ user_id: user.id, last_seen: new Date().toISOString() }, { onConflict: "user_id" });
      } catch {
        // Presença é informativa; falhas de rede não devem interromper a aplicação.
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 30000);
    const onVisibility = () => { if (document.visibilityState === "visible") void heartbeat(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void (async()=>{try{await supabase.from("user_presence").delete().eq("user_id", user.id)}catch{}})();
    };
  }, [user.id]);

  useEffect(()=>{
    const cleanup=()=>cleanupExpiredRawFiles().catch(()=>undefined);
    void cleanup();
    const timer=window.setInterval(cleanup,15*60*1000);
    return()=>window.clearInterval(timer);
  },[]);

  const value = useMemo(() => ({
    user, activePayroll, payrollLoading, payrollMonths, selectedCompetence,
    selectCompetence:loadCompetence, refreshPayrollMonths, health, setHealth, dental, setDental,
    settings, settingsLoading, refreshSettings, audits, addAudit, clearAudits,
    toasts, toast, dismissToast,
  }), [user, activePayroll, payrollLoading, payrollMonths, selectedCompetence, loadCompetence, refreshPayrollMonths, health, dental, settings, settingsLoading, refreshSettings, audits, addAudit, clearAudits, toasts, toast, dismissToast]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp precisa estar dentro de AppProvider");
  return value;
}
