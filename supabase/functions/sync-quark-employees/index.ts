import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";
import { parseQuarkEmployeeDate } from "./date-utils.ts";
import { quarkEmployeeRegistration } from "./employee-registration.ts";
import { collectQuarkPages, quarkUnits, resolveQuarkDuplicates } from "./catalog.ts";
import { createEmployeeQuarkRequester } from "./request.ts";

const PROD_ORIGIN = "https://administrativo.clarotechnet.com.br";
const allowedOrigins = new Set([PROD_ORIGIN, "http://localhost:3000", "http://localhost:5173"]);
const defaultApiUrl = "https://api.quark.tec.br/rh/ext";

type JsonObject = Record<string, unknown>;
type SyncCounts = { total?: number; created?: number; updated?: number; linked?: number; skipped?: number; conflicts?: number; unmapped?: number };

type NormalizedEmployee = {
  external_id: string;
  cpf: string;
  document_number: string;
  name: string;
  registration: string;
  department: string;
  job_title: string;
  status: "ATIVO" | "DESLIGADO";
  external_unit_id: string;
  external_unit_name: string;
  external_team_id: string;
  external_team_name: string;
  admission_date: string | null;
  termination_date: string | null;
};
const asObject = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const asText = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const digits = (value: unknown) => asText(value).replace(/\D/g, "");
const isValidCpfDigits = (cpf: string) => {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
};
const normalizeQuarkCpf = (value: unknown) => {
  const raw = digits(value);
  if (!raw || raw.length > 11) return "";
  const candidate = raw.padStart(11, "0");
  return isValidCpfDigits(candidate) ? candidate : "";
};
const firstText = (...values: unknown[]) => values.map(asText).find(Boolean) ?? "";

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : PROD_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

const jsonResponse = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), "Content-Type": "application/json" },
});

function normalizeEmployee(record: JsonObject, unitId: string, unitName: string): NormalizedEmployee | null {
  const pessoa = asObject(record.pessoa);
  const cargo = asObject(record.cargo);
  const equipe = asObject(record.equipe);
  const situacao = asObject(record.situacao);
  const externalId = asText(record.id ?? record.colaboradorId ?? record.colaborador_id);
  const rawDocumentNumber = digits(pessoa.cpfCnpj ?? record.cpf ?? record.cpfCnpj);
  const cpf = normalizeQuarkCpf(rawDocumentNumber);
  const documentNumber = cpf || rawDocumentNumber;
  const name = firstText(pessoa.nome, record.nome, record.nomeCompleto, record.nome_completo);
  if (!externalId || name.length < 2) return null;

  const situacaoText = firstText(situacao.denominacao, record.situacao).toLocaleLowerCase("pt-BR");
  const inactiveBySituation = situacaoText.includes("deslig") || situacaoText.includes("inativ") || situacaoText.includes("demit");
  const status: "ATIVO" | "DESLIGADO" = record.ativo === false || inactiveBySituation ? "DESLIGADO" : "ATIVO";
  const department = firstText(equipe.denominacao, record.setor, record.departamento);

  return {
    external_id: externalId,
    cpf,
    document_number: documentNumber,
    name,
    registration: quarkEmployeeRegistration(record),
    department,
    job_title: firstText(cargo.denominacao, record.funcao),
    status,
    external_unit_id: unitId,
    external_unit_name: unitName,
    external_team_id: asText(equipe.id),
    external_team_name: department,
    admission_date: parseQuarkEmployeeDate(record.dataAdmissao),
    termination_date: parseQuarkEmployeeDate(record.dataDesligamento),
  };
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (!["GET", "POST"].includes(request.method)) return jsonResponse(request, { error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse(request, { error: "Não autenticado." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const quarkToken = Deno.env.get("QUARK_AUTH_TOKEN")?.trim() ?? "";
  const quarkBaseUrl = (Deno.env.get("QUARK_API_URL")?.trim() || defaultApiUrl).replace(/\/$/, "");

  const token = authorization.slice("Bearer ".length);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) return jsonResponse(request, { error: "Sessão inválida." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller, error: callerError } = await admin.from("profiles").select("full_name,role,status").eq("id", user.id).single();
  if (callerError || caller?.status !== "ATIVO" || !["ADMINISTRADOR", "RH"].includes(caller.role)) {
    return jsonResponse(request, { error: "Acesso negado." }, 403);
  }

  if (request.method === "GET") return jsonResponse(request, { ok: true, mappingVersion: 1 });
  const body = asObject(await request.json().catch(() => ({})));
  const action = asText(body.action) || "sync";
  let runId: string | null = null;
  try {
    if (action === "save_mapping") {
      const { data, error } = await admin.rpc("save_quark_rh_mapping", { p_actor: user.id, p_kind: asText(body.kind), p_data: asObject(body.data) });
      if (error) throw error;
      return jsonResponse(request, { ok: true, ...asObject(data) });
    }
    if (!["sync", "discover"].includes(action)) return jsonResponse(request, { error: "Ação inválida." }, 400);
    if (!quarkToken) return jsonResponse(request, { error: "QUARK_AUTH_TOKEN não configurado no servidor." }, 503);
    if (action === "sync") {
      const { error: releaseError } = await admin.from("employee_sync_runs").update({ status: "ERROR", completed_at: new Date().toISOString(), error_message: "Consulta anterior interrompida." }).eq("status", "RUNNING").lt("started_at", new Date(Date.now() - 10 * 60000).toISOString());
      if (releaseError) throw releaseError;
      const { data: run, error } = await admin.from("employee_sync_runs").insert({ source: "QUARK", status: "RUNNING", triggered_by: user.id, triggered_by_name: caller.full_name, units_count: 0 }).select("id").single();
      if (error || !run) throw new Error(error?.code === "23505" ? "Já existe uma sincronização em andamento." : error?.message || "Não foi possível iniciar.");
      runId = run.id;
    }
    const query = createEmployeeQuarkRequester({ base: quarkBaseUrl, token: quarkToken, deadline: Date.now() + 120000 });
    const units = quarkUnits(await collectQuarkPages(params => query("/v1/unidades?" + params)));
    if (!units.length) throw new Error("A API não retornou unidades. O cadastro foi preservado.");
    const { error: discoveryError } = await admin.rpc("discover_quark_rh_units", { p_units: units });
    if (discoveryError) throw discoveryError;
    if (action === "discover") return jsonResponse(request, { ok: true, units: units.length });
    const { data: enabled, error: unitError } = await admin.from("quark_unit_mappings").select("external_unit_id,external_unit_name").eq("sync_enabled", true).order("external_unit_id");
    if (unitError) throw unitError;
    if (!enabled?.length) throw new Error("Selecione as unidades em Mapear setores e unidades.");
    const { error: countError } = await admin.from("employee_sync_runs").update({ units_count: enabled.length }).eq("id", runId);
    if (countError) throw countError;
    const records: NormalizedEmployee[] = []; let received = 0;
    for (const unit of enabled) {
      const rows = await collectQuarkPages(params => query("/v1/colaboradores/?" + params, unit.external_unit_id)); received += rows.length;
      for (const row of rows) { const normalized = normalizeEmployee(row, unit.external_unit_id, unit.external_unit_name); if (normalized) records.push(normalized); }
    }
    if (!received) throw new Error("A API retornou lista vazia para todas as unidades selecionadas. Os cadastros foram preservados.");
    const resolved = resolveQuarkDuplicates(records);
    const { data: result, error } = await admin.rpc("complete_quark_rh_sync", { p_actor: user.id, p_run: runId, p_records: resolved.records, p_received: received, p_skipped: received - resolved.records.length, p_conflicts: resolved.conflicts });
    if (error) throw error;
    return jsonResponse(request, { ok: true, runId, units: enabled.length, ...(result as SyncCounts) });
  } catch (error) {
    const message = error instanceof Error ? error.message : asText(asObject(error).message) || "Falha inesperada na sincronização.";
    if (runId) await admin.from("employee_sync_runs").update({
      status: "ERROR", error_message: message.slice(0, 1000), completed_at: new Date().toISOString(),
    }).eq("id", runId);
    return jsonResponse(request, { error: message }, 502);
  }
});
