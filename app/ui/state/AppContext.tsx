"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ActivePayroll, AuditEntry, ComparisonRow, ProcessingSummary, SystemSettings, ToastMessage, UserProfile } from "../../../src/types";
import { createSupabaseBrowserClient } from "../../../src/lib/supabase/client";
import { cleanupExpiredRawFiles, loadAuditEntries, loadSystemSettings, storeAuditEntry } from "../../../src/services/browser-backend";

type ComparisonState = { rows: ComparisonRow[]; summary: ProcessingSummary; processedAt: string; fileName: string } | null;
type AppContextValue = {
  user: UserProfile; activePayroll: ActivePayroll | null; setActivePayroll: (payroll: ActivePayroll | null) => void;
  health: ComparisonState; setHealth: (value: ComparisonState) => void; dental: ComparisonState; setDental: (value: ComparisonState) => void;
  settings: SystemSettings; settingsLoading:boolean; refreshSettings:()=>Promise<void>;
  audits: AuditEntry[]; addAudit: (entry: Omit<AuditEntry, "id" | "timestamp" | "user">) => void;
  toasts: ToastMessage[]; toast: (tone: ToastMessage["tone"], title: string, description?: string) => void; dismissToast: (id: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);
const defaultSettings:SystemSettings={maskCpf:true,fileRetention:"NONE",financialTolerance:0.01};
const demoUser: UserProfile = { id: "local-preview", name: "Marina Alves", email: "marina.alves@empresa.com.br", department: "Recursos Humanos", jobTitle: "Coordenadora de RH", role: "ADMINISTRADOR", status: "ATIVO" };

export function AppProvider({ children, user = demoUser }: { children: React.ReactNode; user?: UserProfile }) {
  const [activePayroll, setActivePayrollState] = useState<ActivePayroll | null>(null);
  const [health, setHealth] = useState<ComparisonState>(null);
  const [dental, setDental] = useState<ComparisonState>(null);
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
  const setActivePayroll = useCallback((payroll: ActivePayroll | null) => {
    setActivePayrollState(payroll); setHealth(null); setDental(null);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts(current => current.filter(item => item.id !== id)), []);
  const refreshSettings=useCallback(async()=>{
    setSettingsLoading(true);
    try{
      setSettings(await loadSystemSettings());
    }catch{setSettings(defaultSettings)}finally{setSettingsLoading(false)}
  },[]);

  useEffect(()=>{void refreshSettings()},[refreshSettings]);
  useEffect(()=>{loadAuditEntries().then(setAudits).catch(()=>undefined)},[]);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let stopped = false;
    const heartbeat = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      await supabase.from("user_presence").upsert({ user_id: user.id, last_seen: new Date().toISOString() }, { onConflict: "user_id" });
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 30000);
    const onVisibility = () => { if (document.visibilityState === "visible") void heartbeat(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility);
      void supabase.from("user_presence").delete().eq("user_id", user.id);
    };
  }, [user.id]);
  useEffect(()=>{
    const cleanup=()=>cleanupExpiredRawFiles().catch(()=>undefined);
    void cleanup();
    const timer=window.setInterval(cleanup,15*60*1000);
    return()=>window.clearInterval(timer);
  },[]);
  const value = useMemo(() => ({ user, activePayroll, setActivePayroll, health, setHealth, dental, setDental, settings, settingsLoading, refreshSettings, audits, addAudit, toasts, toast, dismissToast }), [user, activePayroll, setActivePayroll, health, dental, settings, settingsLoading, refreshSettings, audits, addAudit, toasts, toast, dismissToast]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp precisa estar dentro de AppProvider");
  return value;
}
