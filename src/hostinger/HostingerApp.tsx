import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ApprovalPending } from "../../app/ui/ApprovalPending";
import { LoginScreen } from "../../app/ui/LoginScreen";
import { RegistrationScreen } from "../../app/ui/RegistrationScreen";
import { RHControlApp } from "../../app/ui/RHControlApp";
import { SignupScreen } from "../../app/ui/SignupScreen";
import type { AppRoute } from "../../app/ui/components/AppShell";
import type { UserProfile } from "../types";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { loadCurrentProfile } from "../services/browser-backend";

function LoadingScreen() {
  return <main className="registration-page"><section className="registration-card"><h1>RH Control</h1><p>Carregando ambiente seguro...</p></section></main>;
}

function routeFromLocation() {
  const url = new URL(window.location.href);
  return url.pathname;
}

const appRoutes: AppRoute[] = ["dashboard", "payroll", "pdfs", "reports", "history", "users", "settings"];
function appRouteFromPath(path: string): AppRoute {
  const route = path.split("/").filter(Boolean)[0] as AppRoute;
  return appRoutes.includes(route) ? route : "dashboard";
}

export function HostingerApp() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [path, setPath] = useState(routeFromLocation);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    const refresh = async () => {
      setLoading(true);
      setError("");
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          const next = url.searchParams.get("next");
          const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/cadastro";
          window.history.replaceState({}, "", safeNext);
          setPath(safeNext);
        }
        const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
        if (userError && userError.name !== "AuthSessionMissingError") throw userError;
        if (!active) return;
        setUser(currentUser);
        setProfile(currentUser ? await loadCurrentProfile(currentUser.id) : null);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Não foi possível carregar sua sessão.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void refresh();
    const { data: listener } = supabase.auth.onAuthStateChange(() => { void refresh(); });
    const onPopState = () => setPath(routeFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  if (loading) return <LoadingScreen />;
  if (error) return <main className="registration-page"><section className="registration-card"><h1>Não foi possível iniciar</h1><p>{error}</p><button className="button primary full" onClick={() => window.location.reload()}>Tentar novamente</button></section></main>;
  if (!user) return path === "/cadastro" ? <SignupScreen /> : <LoginScreen />;
  if (!profile) return <ApprovalPending name={user.email ?? "Usuário"} />;
  if (path === "/cadastro") return <RegistrationScreen profile={profile} />;
  if (profile.status !== "ATIVO") return <ApprovalPending name={profile.name} status={profile.status} />;
  return <RHControlApp user={profile} initialRoute={appRouteFromPath(path)} />;
}
