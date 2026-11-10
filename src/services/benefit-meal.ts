import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { listEmployees } from "./employee-documents";
import { buildMealRows, mealPeriod, type MealCoverage, type MealEvent, type MealPeriod, type MealRow } from "../../supabase/functions/_shared/meal-domain";
import type { MealRateVersion } from "../../supabase/functions/_shared/meal-policy";
import { requireMealRateBackend } from "./meal-rates";

export type MealRun = { id: string; period_start: string; period_end: string; benefit_month: string; queried_through: string; status: "RUNNING" | "SUCCESS" | "PARTIAL" | "ERROR"; triggered_by_name: string; started_at: string; completed_at: string | null; employee_count: number; coverage: MealCoverage[]; warnings: string[]; error_message: string | null };
const runFields = "id,period_start,period_end,benefit_month,queried_through,status,triggered_by_name,started_at,completed_at,employee_count,coverage,warnings,error_message";
function readable(error: { code?: string; message: string }) {
  return new Error(["42P01", "PGRST205", "PGRST202"].includes(error.code ?? "") ? "A estrutura de Vale Alimentação ainda precisa ser instalada no Supabase RH. Nenhum dado foi alterado." : error.message);
}
export async function listMealRuns(period?: MealPeriod, offset = 0): Promise<MealRun[]> {
  let query = createSupabaseBrowserClient().from("benefit_meal_runs").select(runFields);
  if (period) query = query.eq("period_start", period.start).eq("period_end", period.end).eq("benefit_month", period.benefitMonth + "-01");
  const { data, error } = await query.order("started_at", { ascending: false }).order("id").range(offset, offset + 49);
  if (error) throw readable(error);
  return (data ?? []) as MealRun[];
}
export async function listMealRows(runId: string): Promise<MealRow[]> {
  const rows: MealRow[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data, error } = await createSupabaseBrowserClient().from("benefit_meal_rows").select("*").eq("run_id", runId).order("employee_name").order("snapshot_employee_id").range(offset, offset + 999);
    if (error) throw readable(error);
    rows.push(...(data ?? []).map(row => ({ ...row, employee_id: row.snapshot_employee_id })) as MealRow[]);
    if (!data || data.length < 1000) return rows;
  }
  throw new Error("Resultado excede 50 mil funcionários; contate o suporte.");
}
export async function listMealEmployeeEvents(runId: string, employeeId: string): Promise<MealEvent[]> {
  const events: MealEvent[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data, error } = await createSupabaseBrowserClient().from("benefit_meal_events").select("snapshot_employee_id,event_type,source_id,start_date,end_date,hours").eq("run_id", runId).eq("snapshot_employee_id", employeeId).order("start_date").order("id").range(offset, offset + 999);
    if (error) throw readable(error);
    events.push(...(data ?? []).map(row => ({ ...row, employee_id: row.snapshot_employee_id, hours: row.hours === null ? null : Number(row.hours) })) as MealEvent[]);
    if (!data || data.length < 1000) return events;
  }
  throw new Error("Ocorrências excedem o limite de consulta.");
}
export async function currentMealEmployees(period: MealPeriod, rates?: MealRateVersion[]) {
  const employees = await listEmployees();
  return buildMealRows(employees.map(row => ({ id: row.id, full_name: row.name, cpf: row.cpf, department: row.department, job_title: row.jobTitle, status: row.status, external_id: row.externalId, external_unit_id: row.externalUnitId, external_unit_name: row.externalUnitName, mapped_city: row.city })), [], [], period, { rates, benefitMonth: period.benefitMonth });
}
export async function syncMealPeriod(period: MealPeriod, progress?: (message: string) => void) {
  mealPeriod(period.start, period.end);
  const client = createSupabaseBrowserClient();
  await requireMealRateBackend();
  progress?.("Consultando faltas e atestados...");
  const { data, error } = await client.functions.invoke("sync-benefit-meal", { body: { start: period.start, end: period.end } });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
    }
    throw error;
  }
  const result = data as { ok?: boolean; runId?: string; rows?: number; error?: string };
  if (!result?.ok || !result.runId) throw new Error(result?.error ?? "A consulta não retornou uma versão salva.");
  return result as { ok: true; runId: string; rows: number };
}
