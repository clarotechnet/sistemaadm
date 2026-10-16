"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ActivePayroll, AuditEntry, PayrollMonthOption, PlanComparisonState, SystemSettings, ToastMessage, UserProfile } from "../../../src/types";
import { createSupabaseBrowserClient } from "../../../src/lib/supabase/client";
import { cleanupExpiredRawFiles, clearAuditEntries, listPayrollMonths, loadAuditEntries, loadPayrollComparison, loadPayrollMonth, loadSystemSettings, storeAuditEntry } from "../../../src/services/browser-backend";
import { listPlanBase } from "../../../src/services/benefit-plan-base";
import { comparePlanBase, type PlanBaseVersion } from "../../../src/modules/benefits/plan-base";
import type { ComparisonKind } from "../../../src/modules/comparisons/processor";

type PlanBases = Record<ComparisonKind, PlanBaseVersion[] | null>;

type AppContextValue = {
  user: UserProfile;
  activePayroll: ActivePayroll | null;
  payrollLoading: boolean;
  payrollMonths: PayrollMonthOption[];
  selectedCompetence: string | null;
  selectCompetence: (competence: string) => Promise<void>;
  refreshPayrollMonths: (preferred?: string) => Promise<void>;
  health: PlanComparisonState | null;
  setSavedHealth: (value: PlanComparisonState | null) => void;
  dental: PlanComparisonState | null;
  setSavedDental: (value: PlanComparisonState | null) => void;
  savedHealth: PlanComparisonState | null;
  savedDental: PlanComparisonState | null;
  planBases: PlanBases;
  planBaseErrors: Record<ComparisonKind, string>;
  refreshPlanBase: (kind:ComparisonKind) => Promise<void>;
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

function automaticPlanState(payroll:ActivePayroll|null,versions:PlanBaseVersion[]|null,kind:ComparisonKind,tolerance:number,error:string):PlanComparisonState|null {
  if(!payroll||!versions?.length||error)return null;
  return {...comparePlanBase(payroll,versions,kind,tolerance),fileName:"Base de dados atual",tolerance,processedBy:"Conferência automática",processedAt:[payroll.importedAt,...versions.map(row=>row.createdAt)].sort().at(-1)??payroll.importedAt};
}

export function AppProvider({ children, user = demoUser }: { children: React.ReactNode; user?: UserProfile }) {
  const [activePayroll, setActivePayrollState] = useState<ActivePayroll | null>(null);
  const [payrollLoading,setPayrollLoading]=useState(true);
  const [payrollMonths,setPayrollMonths]=useState<PayrollMonthOption[]>([]);
  const [selectedCompetence,setSelectedCompetence]=useState<string|null>(null);
  const [savedHealth, setSavedHealth] = useState<PlanComparisonState | null>(null);
  const [savedDental, setSavedDental] = useState<PlanComparisonState | null>(null);
  const [planBases,setPlanBases]=useState<PlanBases>({health:null,dental:null});
  const [planBaseErrors,setPlanBaseErrors]=useState({health:"",dental:""});
  const baseRequests=useRef({health:0,dental:0});
  const [settings,setSettings]=useState<SystemSettings>(defaultSettings);
  const [settingsLoading,setSettingsLoading]=useState(true);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const refreshPlanBase=useCallback(async(kind:ComparisonKind)=>{
    const request=++baseRequests.current[kind];
    try {
      const versions=await listPlanBase(kind);
      if(request!==baseRequests.current[kind])return;
      setPlanBases(current=>JSON.stringify(current[kind])===JSON.stringify(versions)?current:{...current,[kind]:versions});
      setPlanBaseErrors(current=>current[kind]?{...current,[kind]:""}:current);
    }catch(error){
      if(request===baseRequests.current[kind])setPlanBaseErrors(current=>({...current,[kind]:error instanceof Error?error.message:"Falha ao carregar a base."}));
    }
  },[]);
  const health=useMemo(()=>automaticPlanState(activePayroll,planBases.health,"health",settings.financialTolerance,planBaseErrors.health),[activePayroll,planBases.health,settings.financialTolerance,planBaseErrors.health]);
  const dental=useMemo(()=>automaticPlanState(activePayroll,planBases.dental,"dental",settings.financialTolerance,planBaseErrors.dental),[activePayroll,planBases.dental,settings.financialTolerance,planBaseErrors.dental]);

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
        setSavedHealth(null);setSavedDental(null);
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const [healthResult,dentalResult]=await Promise.allSettled([
        loadPayrollComparison(payroll.id,"health"),
        loadPayrollComparison(payroll.id,"dental"),
      ]);
      setSavedHealth(healthResult.status==="fulfilled"?healthResult.value:null);
      setSavedDental(dentalResult.status==="fulfilled"?dentalResult.value:null);
      if(healthResult.status==="rejected"||dentalResult.status==="rejected"){
        toast("warning","Histórico de comparativos indisponível","A conferência automática usa a folha e a Base de dados, sem depender dos resultados antigos salvos.");
      }
      window.localStorage.setItem(STORAGE_KEY,payroll.competence);
    } catch(error) {
      setSavedHealth(null);setSavedDental(null);
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
        setActivePayrollState(null);setSelectedCompetence(null);setSavedHealth(null);setSavedDental(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }catch(error){
      setPayrollMonths([]);setActivePayrollState(null);setSelectedCompetence(null);setSavedHealth(null);setSavedDental(null);
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
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState!=="hidden")void Promise.all([refreshPlanBase("health"),refreshPlanBase("dental")]);};
    const start=window.setTimeout(refresh,0);
    const timer=window.setInterval(refresh,60000);
    window.addEventListener("focus",refresh);
    document.addEventListener("visibilitychange",refresh);
    return()=>{window.clearTimeout(start);window.clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[refreshPlanBase]);
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
      void (async()=>{try{await supabase.from("user_presence").delete().eq("user_id", user.id)}catch{/* Presença é informativa; a limpeza não deve interromper a aplicação. */}})();
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
    selectCompetence:loadCompetence, refreshPayrollMonths, health, setSavedHealth, dental, setSavedDental,
    savedHealth, savedDental, planBases, planBaseErrors, refreshPlanBase,
    settings, settingsLoading, refreshSettings, audits, addAudit, clearAudits,
    toasts, toast, dismissToast,
  }), [user, activePayroll, payrollLoading, payrollMonths, selectedCompetence, loadCompetence, refreshPayrollMonths, health, dental, savedHealth, savedDental, planBases, planBaseErrors, refreshPlanBase, settings, settingsLoading, refreshSettings, audits, addAudit, clearAudits, toasts, toast, dismissToast]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp precisa estar dentro de AppProvider");
  return value;
}
