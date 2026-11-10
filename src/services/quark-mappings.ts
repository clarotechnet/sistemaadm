import { createSupabaseBrowserClient } from "../lib/supabase/client";
export type RhUnit = { id: string; name: string; city: string };
export type QuarkUnitMapping = { external_unit_id: string; external_unit_name: string; api_city: string; sync_enabled: boolean; target_unit_id: string | null; last_seen_at: string | null };
export type QuarkTeamMapping = { external_unit_id: string; external_team_id: string; external_team_name: string; department: string | null };
async function rows<T>(table: string, order: string) {
  const all: T[] = [];
  for (let start = 0; start < 50000; start += 1000) {
    let query = createSupabaseBrowserClient().from(table).select("*");
    for (const field of order.split(",")) query = query.order(field);
    const { data, error } = await query.range(start, start + 999);
    if (error) throw new Error(["42P01", "PGRST205"].includes(error.code) ? "O mapeamento QuarkRH ainda precisa ser instalado no Supabase RH." : error.message);
    all.push(...data as T[]); if (data.length < 1000) return all;
  }
  throw new Error("O catálogo ultrapassou o limite de consulta.");
}
export async function loadQuarkMappings() {
  const capability = await createSupabaseBrowserClient().functions.invoke("sync-quark-employees", { method: "GET" });
  if (capability.error || capability.data?.mappingVersion !== 1) throw new Error("Atualize a função sync-quark-employees no Supabase RH para habilitar o mapeamento.");
  const [units, teams, targets] = await Promise.all([rows<QuarkUnitMapping>("quark_unit_mappings", "external_unit_name"), rows<QuarkTeamMapping>("quark_team_mappings", "external_unit_id,external_team_id"), rows<RhUnit>("rh_unit_catalog", "name")]);
  return { units, teams, targets };
}
async function invoke(body: Record<string, unknown>) {
  const { data, error } = await createSupabaseBrowserClient().functions.invoke("sync-quark-employees", { body });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) { const result = await response.clone().json().catch(() => null) as { error?: unknown } | null; if (typeof result?.error === "string") throw new Error(result.error); }
    throw error;
  }
  if (!data?.ok) throw new Error(data?.error || "Resposta inválida do QuarkRH.");
  return data as { ok: true; units?: number; employees?: number; id?: string };
}
export const discoverQuarkUnits = () => invoke({ action: "discover" });
export const saveQuarkUnit = (unit: string, target: string, enabled: boolean) => invoke({ action: "save_mapping", kind: "unit", data: { unit, target, enabled } });
export const saveQuarkTeam = (unit: string, team: string, department: string) => invoke({ action: "save_mapping", kind: "team", data: { unit, team, department } });
export const createRhUnit = (name: string, city: string) => invoke({ action: "save_mapping", kind: "create_unit", data: { name, city } });
