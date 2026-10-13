"use client";

import { useEffect, useState } from "react";
import type { UserProfile } from "../../src/types";
import { AppProvider } from "./state/AppContext";
import { AppShell, type AppRoute } from "./components/AppShell";
import { Toasts } from "./components/Common";
import { DashboardPage } from "./pages/DashboardPage";
import { PayrollPage } from "./pages/PayrollPage";
import { PdfToolsPage } from "./pages/PdfToolsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { UsersPage } from "./pages/UsersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { EmployeeDocumentsPage } from "./pages/EmployeeDocumentsPage";
import { BenefitsPage } from "./pages/BenefitsPage";
import { PayrollAuditPage } from "./pages/PayrollAuditPage";

const validRoutes:AppRoute[]=["dashboard","payroll","conferencia","documents","pdfs","reports","history","users","benefits","settings"];
function routeFromPath(path=window.location.pathname):AppRoute{const value=path.split("/").filter(Boolean)[0] as AppRoute;return validRoutes.includes(value)?value:"dashboard"}
export function RHControlApp({user,initialRoute="dashboard"}:{user:UserProfile;initialRoute?:AppRoute}) {
  const [route,setRoute]=useState<AppRoute>(initialRoute);
  const [openPayrollImport,setOpenPayrollImport]=useState(false);
  useEffect(()=>{const pop=()=>setRoute(routeFromPath());window.addEventListener("popstate",pop);return()=>window.removeEventListener("popstate",pop)},[]);
  const onImport=()=>{setOpenPayrollImport(true);history.pushState({},"","/payroll");setRoute("payroll")};
  const navigate=(next:AppRoute)=>{setOpenPayrollImport(false);setRoute(next)};
  const page=route==="dashboard"?<DashboardPage navigate={navigate}/>:route==="payroll"?<PayrollPage initialTab={openPayrollImport?"imports":undefined}/>:route==="conferencia"?<PayrollAuditPage onImport={onImport}/>:route==="documents"?<EmployeeDocumentsPage/>:route==="pdfs"?<PdfToolsPage/>:route==="reports"?<ReportsPage/>:route==="history"?<HistoryPage/>:route==="users"?<UsersPage/>:route==="benefits"?<BenefitsPage onImport={onImport}/>:<SettingsPage/>;
  return <AppProvider user={user}><AppShell route={route} onNavigate={navigate}>{page}</AppShell><Toasts/></AppProvider>;
}
