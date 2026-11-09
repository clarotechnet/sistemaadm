import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";
import { buildMealRows, mealPeriod, mealToday, type MealEmployee } from "../_shared/meal-domain.ts";
import { createMealRequester, fetchMealUnit } from "./quark.ts";

const origin = "https://administrativo.clarotechnet.com.br";
const allowed = new Set([origin, "http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5174"]);
const fields = "id,full_name,cpf,department,job_title,status,external_id,external_unit_id,external_unit_name";
function reply(request: Request, body: unknown, status = 200) {
  const requestOrigin = request.headers.get("origin") ?? "";
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": allowed.has(requestOrigin) ? requestOrigin : origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } });
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return reply(request, {});
  if (request.method !== "POST") return reply(request, { error: "Método não permitido." }, 405);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return reply(request, { error: "Não autenticado." }, 401);
  const url = Deno.env.get("SUPABASE_URL") ?? "", key = Deno.env.get("SUPABASE_ANON_KEY") ?? "", secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = Deno.env.get("QUARK_AUTH_TOKEN")?.trim() ?? "", base = Deno.env.get("QUARK_API_URL")?.trim() || "https://api.quark.tec.br/rh/ext";
  const userClient = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await userClient.auth.getUser(authorization.slice(7));
  if (authError || !user) return reply(request, { error: "Sessão inválida." }, 401);
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin.from("profiles").select("full_name,role,status").eq("id", user.id).single();
  if (profileError || profile?.status !== "ATIVO" || !["RH", "ADMINISTRADOR"].includes(profile?.role)) return reply(request, { error: "Acesso negado." }, 403);
  if (!token) return reply(request, { error: "Integração QuarkRH não configurada." }, 503);
  let period;
  try {
    const body = await request.json();
    period = mealPeriod(String(body.start ?? ""), String(body.end ?? ""));
    if (period.start > mealToday()) throw new Error("O período selecionado ainda não começou.");
  } catch (error) { return reply(request, { error: error instanceof Error ? error.message : "Período inválido." }, 400); }
  const through = period.end < mealToday() ? period.end : mealToday();
  let runId: string | null = null;
  try {
    const employees: MealEmployee[] = [];
    for (let offset = 0; offset < 50000; offset += 1000) {
      const { data, error } = await admin.from("employees").select(fields).order("id").range(offset, offset + 999);
      if (error) throw error;
      employees.push(...(data ?? []) as MealEmployee[]);
      if (!data || data.length < 1000) break;
      if (offset === 49000) throw new Error("Cadastro excede o limite de 50 mil funcionários.");
    }
    if (!employees.length) throw new Error("Nenhum funcionário cadastrado. Sincronize os funcionários primeiro.");
    // Interrupted attempts never block a period permanently or replace old snapshots.
    const { error: cleanupError } = await admin.from("benefit_meal_runs").update({ status: "ERROR", completed_at: new Date().toISOString(), error_message: "Consulta anterior interrompida antes da conclusão." }).eq("status", "RUNNING").lt("started_at", new Date(Date.now() - 10 * 60000).toISOString());
    if (cleanupError) throw cleanupError;
    const { data: run, error: runError } = await admin.from("benefit_meal_runs").insert({ period_start: period.start, period_end: period.end, benefit_month: period.benefitMonth + "-01", queried_through: through, triggered_by: user.id, triggered_by_name: profile.full_name }).select("id").single();
    if (runError) throw new Error(runError.code === "23505" ? "Já existe uma consulta em andamento para este período. Aguarde." : runError.message);
    runId = run.id;
    const byUnit = new Map<string, Map<string, string>>();
    for (const employee of employees) if (employee.external_id && employee.external_unit_id) {
      const map = byUnit.get(employee.external_unit_id) ?? new Map<string, string>();
      if (map.has(employee.external_id)) throw new Error("Vínculo QuarkRH duplicado no cadastro. Corrija antes de atualizar.");
      map.set(employee.external_id, employee.id); byUnit.set(employee.external_unit_id, map);
    }
    const results: Awaited<ReturnType<typeof fetchMealUnit>>[] = [];
    const deadline = Date.now() + 125000, requester = createMealRequester({ base, token, deadline });
    for (const [unit, map] of byUnit) {
      results.push(await fetchMealUnit({ base, token, unit, employees: map, bounds: { start: period.start, end: through }, deadline, requester }));
    }
    const events = results.flatMap(result => result.events), coverage = results.map(result => result.coverage);
    const rows = buildMealRows(employees, events, coverage, { start: period.start, end: through });
    const warnings = results.flatMap(result => result.coverage.issues.map(message => `Unidade ${result.coverage.unit_id}: ${message}`));
    if (through < period.end) warnings.unshift(`Período ainda aberto: ocorrências consultadas somente até ${through.split("-").reverse().join("/")}.`);
    const { error: saveError } = await admin.rpc("complete_benefit_meal_run", { p_run_id: runId, p_actor: user.id, p_rows: rows, p_events: events, p_coverage: coverage, p_warnings: warnings });
    if (saveError) throw saveError;
    return reply(request, { ok: true, runId, rows: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível concluir a atualização.";
    if (runId) await admin.from("benefit_meal_runs").update({ status: "ERROR", completed_at: new Date().toISOString(), error_message: message.slice(0, 1000) }).eq("id", runId).eq("status", "RUNNING");
    return reply(request, { error: message }, 502);
  }
});
