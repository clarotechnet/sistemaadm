import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { isMealMonth, type MealRateVersion } from "../../supabase/functions/_shared/meal-policy";

const fields = "id,revision,city,rate_group,effective_month,daily_value,fixed_days,created_at,created_by_name,note";
function rateRows(data: unknown): MealRateVersion[] {
  return ((data ?? []) as MealRateVersion[]).map(row => ({ ...row, revision: Number(row.revision), daily_value: Number(row.daily_value), fixed_days: row.fixed_days === null ? null : Number(row.fixed_days) }));
}
function rateError(error: { code?: string; message: string }) {
  const needsInstall = ["42P01", "42703", "PGRST202", "PGRST205"].includes(error.code ?? "");
  return Object.assign(new Error(needsInstall ? "A edição compartilhada de valores precisa ser instalada no Supabase RH." : error.message), { needsInstall });
}
export async function listMealRates(month: string) {
  if (!isMealMonth(month)) throw new Error("Competência dos valores inválida.");
  const { data, error } = await createSupabaseBrowserClient().rpc("get_benefit_meal_rates", { p_month: month + "-01" });
  if (error) throw rateError(error);
  return rateRows(data);
}
export async function listMealRateHistory(city: string) {
  const { data, error } = await createSupabaseBrowserClient().from("benefit_meal_rate_versions").select(fields).eq("city", city).order("revision", { ascending: false }).limit(50);
  if (error) throw rateError(error);
  return rateRows(data);
}
export async function requireMealRateBackend() {
  const capability = await createSupabaseBrowserClient().functions.invoke("sync-benefit-meal", { method: "GET" });
  if (capability.error || capability.data?.calculationVersion !== 2 || capability.data?.rateRulesVersion !== 1) throw new Error("Instale a edição de valores no banco e na função sync-benefit-meal do Supabase RH. Nenhuma consulta nova foi iniciada.");
}
export type MealRateChange = { group: string; dailyCents: number; fixedDays: number | null; expectedId: string | null };
export async function saveMealRates(city: string, month: string, changes: MealRateChange[], note: string) {
  if (!isMealMonth(month)) throw new Error("Competência dos valores inválida.");
  await requireMealRateBackend();
  const { data, error } = await createSupabaseBrowserClient().functions.invoke("sync-benefit-meal", { body: { action: "save_rates", city, month, changes, note } });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      const body = await response.clone().json().catch(() => null) as { error?: string } | null;
      if (body?.error) throw new Error(body.error);
    }
    throw error;
  }
  if (!data?.ok) throw new Error(data?.error || "Não foi possível salvar os valores.");
  return data as { ok: true; saved: number; effectiveMonth: string };
}
