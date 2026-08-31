"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ActivePayroll, AuditEntry, ComparisonRow, ProcessingSummary, ToastMessage, UserProfile } from "../../../src/types";

type ComparisonState = { rows: ComparisonRow[]; summary: ProcessingSummary; processedAt: string; fileName: string } | null;
type AppContextValue = {
  user: UserProfile; activePayroll: ActivePayroll | null; setActivePayroll: (payroll: ActivePayroll | null) => void;
  health: ComparisonState; setHealth: (value: ComparisonState) => void; dental: ComparisonState; setDental: (value: ComparisonState) => void;
  audits: AuditEntry[]; addAudit: (entry: Omit<AuditEntry, "id" | "timestamp" | "user">) => void;
  toasts: ToastMessage[]; toast: (tone: ToastMessage["tone"], title: string, description?: string) => void; dismissToast: (id: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

const demoUser: UserProfile = { id: "local-preview", name: "Marina Alves", email: "marina.alves@empresa.com.br", department: "Recursos Humanos", jobTitle: "Coordenadora de RH", role: "ADMINISTRADOR", status: "ATIVO" };

export function AppProvider({ children, user = demoUser }: { children: React.ReactNode; user?: UserProfile }) {
  const [activePayroll, setActivePayrollState] = useState<ActivePayroll | null>(null);
  const [health, setHealth] = useState<ComparisonState>(null);
  const [dental, setDental] = useState<ComparisonState>(null);
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
    fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(complete) }).catch(() => undefined);
  }, [user.name]);
  const setActivePayroll = useCallback((payroll: ActivePayroll | null) => {
    setActivePayrollState(payroll); setHealth(null); setDental(null);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts(current => current.filter(item => item.id !== id)), []);
  useEffect(()=>{fetch("/api/audit").then(async response=>{if(!response.ok)throw new Error();return await response.json() as {audits:AuditEntry[]}}).then(data=>setAudits(data.audits)).catch(()=>undefined)},[]);
  const value = useMemo(() => ({ user, activePayroll, setActivePayroll, health, setHealth, dental, setDental, audits, addAudit, toasts, toast, dismissToast }), [user, activePayroll, setActivePayroll, health, dental, audits, addAudit, toasts, toast, dismissToast]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp precisa estar dentro de AppProvider");
  return value;
}
