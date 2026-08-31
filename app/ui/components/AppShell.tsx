"use client";

import { useEffect, useState } from "react";
import { Bell, ChevronDown, FileBarChart, FileStack, Gauge, History, Menu, PanelLeftClose, Settings, Sheet, ShieldCheck, Users, X } from "lucide-react";
import { useApp } from "../state/AppContext";

export type AppRoute = "dashboard" | "payroll" | "pdfs" | "reports" | "history" | "users" | "settings";
const routes: { id: AppRoute; label: string; icon: typeof Gauge; roles?: string[] }[] = [
  { id: "dashboard", label: "Dashboard", icon: Gauge }, { id: "payroll", label: "Dados da Folha", icon: Sheet, roles: ["ADMINISTRADOR", "RH"] },
  { id: "pdfs", label: "PDFs", icon: FileStack, roles: ["ADMINISTRADOR", "RH"] }, { id: "reports", label: "Relatórios", icon: FileBarChart },
  { id: "history", label: "Histórico", icon: History }, { id: "users", label: "Usuários", icon: Users, roles: ["ADMINISTRADOR"] },
  { id: "settings", label: "Configurações", icon: Settings, roles: ["ADMINISTRADOR"] },
];

export function AppShell({ route, onNavigate, children }: { route: AppRoute; onNavigate: (route: AppRoute) => void; children: React.ReactNode }) {
  const { user } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const active = routes.find(item => item.id === route)!;
  useEffect(() => setMobileOpen(false), [route]);
  const navigate = (next: AppRoute) => { history.pushState({}, "", next === "dashboard" ? "/" : `/${next}`); onNavigate(next); };
  return <div className={`control-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
    {mobileOpen && <button className="mobile-overlay" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}
    <aside className={`control-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="control-brand"><span>RH</span><div><strong>RH Control</strong><small>Gestão administrativa</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
      <div className="sidebar-section-label">MENU PRINCIPAL</div>
      <nav>{routes.filter(item => !item.roles || item.roles.includes(user.role)).map(item => <button className={item.id === route ? "active" : ""} key={item.id} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}><item.icon size={18} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="lgpd-box"><ShieldCheck size={18} /><span><strong>Ambiente protegido</strong><small>Dados tratados conforme a LGPD</small></span></div>
      <button className="collapse-button" onClick={() => setCollapsed(value => !value)}><PanelLeftClose size={16} /><span>Recolher menu</span></button>
    </aside>
    <main className="control-main">
      <header className="control-topbar"><div className="topbar-title"><button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu /></button><div><span>RH CONTROL</span><h1>{active.label}</h1></div></div><div className="topbar-actions"><button className="notification-button" aria-label="Notificações"><Bell size={18} /><i /></button><div className="account-wrap"><button className="account-button" onClick={() => setAccountOpen(value => !value)}><span className="avatar">{user.name.split(" ").slice(0,2).map(part => part[0]).join("")}</span><span><strong>{user.name}</strong><small>{user.role === "ADMINISTRADOR" ? "Administradora" : user.role}</small></span><ChevronDown size={15} /></button>{accountOpen && <div className="account-menu"><div><strong>{user.name}</strong><small>{user.email}</small></div><button onClick={() => navigate("settings")}>Minha conta</button><a href="/signout-with-chatgpt?return_to=/">Sair</a></div>}</div></div></header>
      <div className="control-content">{children}</div>
    </main>
  </div>;
}
