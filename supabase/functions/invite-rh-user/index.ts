import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://administrativo.clarotechnet.com.br",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

type Role = "ADMINISTRADOR" | "RH" | "CONSULTA";
type InvitePayload = { name?: string; email?: string; department?: string; jobTitle?: string; role?: Role };

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Não autenticado." }, 401);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const token = authorization.slice("Bearer ".length);
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: caller, error: callerError } = await admin.from("profiles").select("role,status").eq("id", user.id).single();
    if (callerError || caller?.role !== "ADMINISTRADOR" || caller.status !== "ATIVO") return json({ error: "Acesso negado." }, 403);

    const payload = await request.json() as InvitePayload;
    const name = payload.name?.trim();
    const email = payload.email?.trim().toLowerCase();
    const role = payload.role ?? "CONSULTA";
    if (!name || !email) return json({ error: "Nome e e-mail são obrigatórios." }, 400);
    if (!["ADMINISTRADOR", "RH", "CONSULTA"].includes(role)) return json({ error: "Perfil inválido." }, 400);

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://administrativo.clarotechnet.com.br/auth/callback?next=/cadastro",
      data: {
        full_name: name,
        department: payload.department?.trim() ?? "",
        job_title: payload.jobTitle?.trim() ?? "",
      },
    });
    if (error || !data.user) return json({ error: error?.message ?? "Falha ao enviar o convite." }, 400);

    const { data: profile, error: profileError } = await admin.from("profiles").update({
      full_name: name,
      department: payload.department?.trim() ?? "",
      job_title: payload.jobTitle?.trim() ?? "",
      role,
      status: "AGUARDANDO APROVAÇÃO",
      updated_at: new Date().toISOString(),
    }).eq("id", data.user.id).select("id,email,full_name,department,job_title,role,status").single();
    if (profileError) return json({ error: profileError.message }, 400);

    return json({ user: {
      id: profile.id,
      email: profile.email,
      name: profile.full_name,
      department: profile.department,
      jobTitle: profile.job_title,
      role: profile.role,
      status: profile.status,
    } }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Falha inesperada." }, 400);
  }
});
