"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, FileBarChart, FileStack, FolderLock, Gauge, History, Menu, PanelLeftClose, Settings, Sheet, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { useApp } from "../state/AppContext";
import { createSupabaseBrowserClient } from "../../../src/lib/supabase/client";

export type AppRoute = "dashboard" | "payroll" | "documents" | "pdfs" | "reports" | "history" | "users" | "settings";
const routes: { id: AppRoute; label: string; icon: typeof Gauge; roles?: string[] }[] = [
  { id: "dashboard", label: "Dashboard", icon: Gauge }, { id: "payroll", label: "Dados da Folha", icon: Sheet, roles: ["ADMINISTRADOR", "RH"] },
  { id: "documents", label: "Documentos RH", icon: FolderLock },
  { id: "pdfs", label: "PDFs", icon: FileStack, roles: ["ADMINISTRADOR", "RH"] }, { id: "reports", label: "Relatórios", icon: FileBarChart },
  { id: "history", label: "Histórico", icon: History }, { id: "users", label: "Usuários", icon: Users, roles: ["ADMINISTRADOR"] },
  { id: "settings", label: "Configurações", icon: Settings, roles: ["ADMINISTRADOR"] },
];

export function AppShell({ route, onNavigate, children }: { route: AppRoute; onNavigate: (route: AppRoute) => void; children: React.ReactNode }) {
  const { user, audits } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationStorageKey = `rh-control:notifications-cleared:${user.id}`;
  const [notificationsClearedAt, setNotificationsClearedAt] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem(notificationStorageKey) ?? "");
  const accountRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const active = routes.find(item => item.id === route)!;
  const visibleNotifications = audits.filter(item => !notificationsClearedAt || item.timestamp > notificationsClearedAt);
  const clearNotifications = () => { const clearedAt = new Date().toISOString(); setNotificationsClearedAt(clearedAt); window.localStorage.setItem(notificationStorageKey, clearedAt) };
  useEffect(() => {
    if (!accountOpen && !notificationsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
      if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setAccountOpen(false); setNotificationsOpen(false); } };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen, notificationsOpen]);
  const navigate = (next: AppRoute) => { setAccountOpen(false); setNotificationsOpen(false); setMobileOpen(false); history.pushState({}, "", next === "dashboard" ? "/" : `/${next}`); onNavigate(next); };
  return <div className={`control-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
    {mobileOpen && <button className="mobile-overlay" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}
    <aside className={`control-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="control-brand"><img className="company-logo sidebar-company-logo" src="/logo-empresa-ui.png" alt="Logo da empresa" /><div><strong>RH Controle</strong><small>Gestão administrativa</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
      <div className="sidebar-section-label">MENU PRINCIPAL</div>
      <nav>{routes.filter(item => !item.roles || item.roles.includes(user.role)).map(item => <button className={item.id === route ? "active" : ""} key={item.id} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}><item.icon size={18} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="lgpd-box"><ShieldCheck size={18} /><span><strong>Ambiente protegido</strong><small>Dados tratados conforme a LGPD</small></span></div>
      <button className="collapse-button" onClick={() => setCollapsed(value => !value)}><PanelLeftClose size={16} /><span>Recolher menu</span></button>
    </aside>
    <main className="control-main">
      <header className="control-topbar"><div className="topbar-title"><button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu /></button><div><span>RH CONTROLE</span><h1>{active.label}</h1></div></div><div className="topbar-actions"><div className="notification-wrap" ref={notificationRef}><button className="notification-button" aria-label="Notificações" aria-expanded={notificationsOpen} aria-haspopup="dialog" onClick={() => { setNotificationsOpen(value => !value); setAccountOpen(false); }}><Bell size={18} />{visibleNotifications.length > 0 && <i aria-hidden="true" />}</button>{notificationsOpen && <div className="notification-menu" role="dialog" aria-label="Notificações recentes"><div className="notification-menu-header"><span><strong>Notificações</strong><small>Atividades recentes do RH Controle</small></span><button className="notification-clear" disabled={!visibleNotifications.length} onClick={clearNotifications} title="Limpar notificações"><Trash2 size={13} /> Limpar</button></div><div className="notification-list">{visibleNotifications.length ? visibleNotifications.slice(0, 5).map(item => <article key={item.id}><i className={item.status.toLowerCase()} /><span><strong>{item.operation}</strong><small>{item.result}</small><time>{new Date(item.timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></span></article>) : <div className="notification-empty"><Bell size={20} /><strong>Nenhuma notificação</strong><small>As novas atividades aparecerão aqui.</small></div>}</div><button className="notification-history" onClick={() => navigate("history")}><History size={14} /> Ver histórico completo</button></div>}</div><div className="account-wrap" ref={accountRef}><button className="account-button" aria-expanded={accountOpen} aria-haspopup="menu" onClick={() => { setAccountOpen(value => !value); setNotificationsOpen(false); }}><span className="avatar">{user.name.split(" ").slice(0, 2).map(part => part[0]).join("")}</span><span><strong>{user.name}</strong><small>{user.role === "ADMINISTRADOR" ? "Administradora" : user.role}</small></span><ChevronDown size={15} /></button>{accountOpen && <div className="account-menu" role="menu"><div><strong>{user.name}</strong><small>{user.email}</small></div><button role="menuitem" onClick={() => navigate("settings")}>Minha conta</button><button role="menuitem" onClick={async () => { const supabase = createSupabaseBrowserClient(); await supabase.auth.signOut(); window.location.href = "/"; }}>Sair</button></div>}</div></div></header>
      <div className="control-content">{children}</div>
    </main>
  </div>;
}

