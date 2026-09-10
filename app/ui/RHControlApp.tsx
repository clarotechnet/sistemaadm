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

const validRoutes:AppRoute[]=["dashboard","payroll","documents","pdfs","reports","history","users","settings"];
function routeFromPath(path=window.location.pathname):AppRoute{const value=path.split("/").filter(Boolean)[0] as AppRoute;return validRoutes.includes(value)?value:"dashboard"}
export function RHControlApp({user,initialRoute="dashboard"}:{user:UserProfile;initialRoute?:AppRoute}){const[route,setRoute]=useState<AppRoute>(initialRoute);useEffect(()=>{const pop=()=>setRoute(routeFromPath());window.addEventListener("popstate",pop);return()=>window.removeEventListener("popstate",pop)},[]);const page=route==="dashboard"?<DashboardPage navigate={setRoute}/>:route==="payroll"?<PayrollPage/>:route==="documents"?<EmployeeDocumentsPage/>:route==="pdfs"?<PdfToolsPage/>:route==="reports"?<ReportsPage/>:route==="history"?<HistoryPage/>:route==="users"?<UsersPage/>:<SettingsPage/>;return <AppProvider user={user}><AppShell route={route} onNavigate={setRoute}>{page}</AppShell><Toasts/></AppProvider>}
