import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";
import { buildMealRows, mealPeriod, mealQuarkDetailsPending, mealToday, MEAL_QUARK_BATCH_SIZE, type MealEmployee, type MealQuarkDetails } from "../_shared/meal-domain.ts";
import { lookupMealQuarkDetails } from "./details.ts";
import { createMealRequester, fetchMealUnit } from "./quark.ts";
import { isMealMonth, type MealRateVersion } from "../_shared/meal-policy.ts";

const origin = "https://administrativo.clarotechnet.com.br";
const allowed = new Set([origin, "http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5174"]);
const fields = "id,full_name,cpf,department,job_title,status,external_id,external_unit_id,external_unit_name,mapped_city";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reply(request: Request, body: unknown, status = 200) {
  const requestOrigin = request.headers.get("origin") ?? "";
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": allowed.has(requestOrigin) ? requestOrigin : origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" } });
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return reply(request, {});
  if (!["GET", "POST"].includes(request.method)) return reply(request, { error: "Método não permitido." }, 405);
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
  if (request.method === "GET") {
    const { error } = await admin.from("benefit_meal_rate_versions").select("id").limit(0);
    return error ? reply(request, { error: "Instale a edição de valores de Vale Alimentação no Supabase RH." }, 503) : reply(request, { ok: true, calculationVersion: 2, rateRulesVersion: 1 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply(request, { error: "Dados inválidos." }, 400);
  if (body.action === "save_rates") {
    if (!isMealMonth(String(body.month ?? ""))) return reply(request, { error: "Competência dos valores inválida." }, 400);
    const { data, error } = await admin.rpc("save_benefit_meal_rates", { p_actor: user.id, p_city: String(body.city ?? ""), p_month: String(body.month) + "-01", p_changes: body.changes, p_note: String(body.note ?? "") });
    if (error) return reply(request, { error: error.message }, error.message.includes("mudaram durante") ? 409 : 400);
    return reply(request, { ok: true, ...data });
  }
  if (body.action === "quark_details") {
    const runId = typeof body.runId === "string" ? body.runId : "";
    const employeeIds: unknown[] = Array.isArray(body.employeeIds) ? body.employeeIds : [];
    if (!uuid.test(runId) || !employeeIds.length || employeeIds.length > MEAL_QUARK_BATCH_SIZE ||
        !employeeIds.every((id): id is string => typeof id === "string" && uuid.test(id)) ||
        new Set(employeeIds).size !== employeeIds.length) {
      return reply(request, { error: "Informe uma apuração e um lote válido de funcionários." }, 400);
    }
    if (!token) return reply(request, { error: "Integração QuarkRH não configurada." }, 503);
    try {
      const { data: run, error: runError } = await admin.from("benefit_meal_runs").select("status,period_start,queried_through").eq("id", runId).maybeSingle();
      if (runError) throw runError;
      if (!run || !["SUCCESS", "PARTIAL"].includes(run.status)) return reply(request, { error: "Abra uma apuração salva para consultar os detalhes." }, 404);

      const { data: rows, error: rowError } = await admin.from("benefit_meal_rows")
        .select("snapshot_employee_id,employee_id,quark_details").eq("run_id", runId).in("snapshot_employee_id", employeeIds);
      if (rowError) throw rowError;
      if (rows.length !== employeeIds.length) return reply(request, { error: "Alguns funcionários não pertencem a esta apuração." }, 400);
      const pending = rows.filter(mealQuarkDetailsPending);
      const linkedIds = pending.flatMap(row => row.employee_id ? [row.employee_id] : []);
      const links = new Map<string, { external_id: string; external_unit_id: string }>();
      if (linkedIds.length) {
        const { data, error } = await admin.from("employees").select("id,external_id,external_unit_id").in("id", linkedIds);
        if (error) throw error;
        for (const link of data) links.set(link.id, link);
      }
      const deadline = Date.now() + 26000;
      const query = createMealRequester({ base, token, deadline, intervalMs: 1200 });
      const result: { employee_id: string; details: MealQuarkDetails | null }[] = rows
        .filter(row => !mealQuarkDetailsPending(row))
        .map(row => ({ employee_id: row.snapshot_employee_id, details: row.quark_details }));
      let paused: string | undefined;
      for (const row of pending) {
        if (Date.now() >= deadline) {
          paused = "A consulta atingiu o limite de tempo. Use o botão para continuar com os dados que faltam.";
          break;
        }
        const link = links.get(row.employee_id);
        const previous = row.quark_details as MealQuarkDetails | null;
        const lookup = await lookupMealQuarkDetails(
          query, link?.external_unit_id, link?.external_id,
          { start: run.period_start, end: run.queried_through }, previous,
        );
        let update = admin.from("benefit_meal_rows").update({ quark_details: lookup.details })
          .eq("run_id", runId).eq("snapshot_employee_id", row.snapshot_employee_id);
        update = previous ? update.eq("quark_details->>updated_at", previous.updated_at) : update.is("quark_details", null);
        const { data: saved, error } = await update.select("quark_details").maybeSingle();
        if (error) throw error;
        let current = saved;
        if (!current) {
          const concurrent = await admin.from("benefit_meal_rows").select("quark_details")
            .eq("run_id", runId).eq("snapshot_employee_id", row.snapshot_employee_id).maybeSingle();
          if (concurrent.error) throw concurrent.error;
          current = concurrent.data;
        }
        result.push({ employee_id: row.snapshot_employee_id, details: current?.quark_details ?? previous });
        if (lookup.paused) { paused = lookup.paused; break; }
      }
      return reply(request, { rows: result, paused });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = ["42703", "PGRST204"].includes(code ?? "")
        ? "Instale a atualização de benefícios e afastamentos no Supabase RH."
        : "Não foi possível consultar os detalhes desta apuração.";
      return reply(request, { error: message }, 503);
    }
  }
  if (body.action && body.action !== "sync") return reply(request, { error: "Ação inválida." }, 400);
  if (!token) return reply(request, { error: "Integração QuarkRH não configurada." }, 503);
  let period;
  try {
    period = mealPeriod(String(body.start ?? ""), String(body.end ?? ""));
    if (period.start > mealToday()) throw new Error("O período selecionado ainda não começou.");
  } catch (error) { return reply(request, { error: error instanceof Error ? error.message : "Período inválido." }, 400); }
  const through = period.end < mealToday() ? period.end : mealToday();
  let runId: string | null = null;
  try {
    const { data: ratesData, error: ratesError } = await admin.rpc("get_benefit_meal_rates", { p_month: period.benefitMonth + "-01" });
    if (ratesError) throw ratesError;
    const rates = (ratesData ?? []) as MealRateVersion[];
    const employees: MealEmployee[] = [];
    let employeeFields = fields;
    for (let offset = 0; offset < 50000; offset += 1000) {
      let { data, error } = await admin.from("employees").select(employeeFields).order("id").range(offset, offset + 999)
        .overrideTypes<MealEmployee[], { merge: false }>();
      if (error?.code === "42703" && employeeFields === fields) {
        // The mapping module can be installed separately. Until then, retain the
        // existing operational-city lookup from the original unit name.
        employeeFields = fields.replace(",mapped_city", "");
        ({ data, error } = await admin.from("employees").select(employeeFields).order("id").range(offset, offset + 999)
          .overrideTypes<MealEmployee[], { merge: false }>());
      }
      if (error) throw error;
      employees.push(...(data ?? []));
      if (!data || data.length < 1000) break;
      if (offset === 49000) throw new Error("Cadastro excede o limite de 50 mil funcionários.");
    }
    if (!employees.length) throw new Error("Nenhum funcionário cadastrado. Sincronize os funcionários primeiro.");
    // Interrupted attempts never block a period permanently or replace old snapshots.
    const { error: cleanupError } = await admin.from("benefit_meal_runs").update({ status: "ERROR", completed_at: new Date().toISOString(), error_message: "Consulta anterior interrompida antes da conclusão." }).eq("status", "RUNNING").lt("started_at", new Date(Date.now() - 10 * 60000).toISOString());
    if (cleanupError) throw cleanupError;
    const { data: run, error: runError } = await admin.from("benefit_meal_runs").insert({ period_start: period.start, period_end: period.end, benefit_month: period.benefitMonth + "-01", queried_through: through, triggered_by: user.id, triggered_by_name: profile.full_name, rate_version_ids: rates.map(rate => rate.id) }).select("id").single();
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
    const rows = buildMealRows(employees, events, coverage, { start: period.start, end: through }, { periodEnd: period.end, rates, benefitMonth: period.benefitMonth });
    const warnings = results.flatMap(result => result.coverage.issues.map(message => `Unidade ${result.coverage.unit_id}: ${message}`));
    if (through < period.end) warnings.unshift(`Período ainda aberto: ocorrências consultadas somente até ${through.split("-").reverse().join("/")}.`);
    const { error: saveError } = await admin.rpc("complete_benefit_meal_versioned_run", { p_run_id: runId, p_actor: user.id, p_rows: rows, p_events: events, p_coverage: coverage, p_warnings: warnings });
    if (saveError) throw saveError;
    return reply(request, { ok: true, runId, rows: rows.length });
  } catch (error) {
    const failure = error as { code?: string; message?: string } | null;
    const message = failure?.code === "PGRST202" ? "Instale a atualização dos valores de Vale Alimentação no banco RH. A consulta anterior foi preservada." : error instanceof Error ? error.message : failure?.message || "Não foi possível concluir a atualização.";
    if (runId) await admin.from("benefit_meal_runs").update({ status: "ERROR", completed_at: new Date().toISOString(), error_message: message.slice(0, 1000) }).eq("id", runId).eq("status", "RUNNING");
    return reply(request, { error: message }, 502);
  }
});
