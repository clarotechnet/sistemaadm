import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";

const PROD_ORIGIN = "https://administrativo.clarotechnet.com.br";
const allowedOrigins = new Set([PROD_ORIGIN, "http://localhost:3000", "http://localhost:5173"]);
const defaultUnits = ["9417839", "9417838", "9417837", "9417836", "9417834", "9338112"];
const defaultApiUrl = "https://api.quark.tec.br/rh/ext";
const pageSize = 100;
const maxPages = 100;

type JsonObject = Record<string, unknown>;
type SyncCounts = { total?: number; created?: number; updated?: number; linked?: number; skipped?: number };

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
const isoDate = (value: unknown) => {
  const text = asText(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : PROD_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const jsonResponse = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), "Content-Type": "application/json" },
});

function extractList(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(item => item && typeof item === "object") as JsonObject[];
  const object = asObject(value);
  for (const key of ["dados", "content", "data", "items", "results", "result", "records", "registros", "colaboradores", "unidades", "lista"]) {
    if (Array.isArray(object[key])) return extractList(object[key]);
  }
  for (const nested of Object.values(object)) {
    const list = extractList(nested);
    if (list.length) return list;
  }
  return [];
}
function unitNameFromRecord(record: JsonObject) {
  return firstText(record.nomeFantasia, record.razaoSocial, record.nome, record.denominacao, record.descricao, record.sigla);
}

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
    registration: firstText(record.matricula, record.numeroMatricula, record.numero_matricula),
    department,
    job_title: firstText(cargo.denominacao, record.funcao),
    status,
    external_unit_id: unitId,
    external_unit_name: unitName,
    external_team_id: asText(equipe.id),
    external_team_name: department,
    admission_date: isoDate(record.dataAdmissao),
    termination_date: isoDate(record.dataDesligamento),
  };
}
async function quarkRequest(baseUrl: string, token: string, path: string, unitId?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Accept": "application/json",
      "Auth-Token": token,
      ...(unitId ? { "Unidade-ID": unitId } : {}),
      "User-Agent": "RH-Control-Quark-Sync/1.0",
    },
  });
  if (!response.ok) throw new Error(`QuarkRH respondeu HTTP ${response.status} em ${path}.`);
  return await response.json() as unknown;
}

async function fetchUnitNames(baseUrl: string, token: string) {
  const names = new Map<string, string>();
  try {
    const payload = await quarkRequest(baseUrl, token, "/v1/unidades");
    for (const item of extractList(payload)) {
      const id = asText(item.id ?? item.unidadeId ?? item.unidade_id);
      if (id) names.set(id, unitNameFromRecord(item));
    }
  } catch {
    // A sincronização de colaboradores continua mesmo se a lista de unidades falhar.
  }
  return names;
}

async function fetchCollaborators(baseUrl: string, token: string, unitId: string, unitName: string) {
  const rows: NormalizedEmployee[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    const payload = await quarkRequest(baseUrl, token, `/v1/colaboradores/?${query.toString()}`, unitId);
    const pageRows = extractList(payload);
    for (const record of pageRows) {
      const normalized = normalizeEmployee(record, unitId, unitName);
      if (normalized) rows.push(normalized);
    }
    if (pageRows.length < pageSize) break;
    if (page === maxPages) throw new Error(`A unidade ${unitId} excedeu o limite seguro de paginação.`);
  }
  return rows;
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse(request, { error: "Não autenticado." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const quarkToken = Deno.env.get("QUARK_AUTH_TOKEN")?.trim() ?? "";
  const quarkBaseUrl = (Deno.env.get("QUARK_API_URL")?.trim() || defaultApiUrl).replace(/\/$/, "");
  const configuredUnits = (Deno.env.get("QUARK_UNIT_IDS") ?? "")
    .split(",").map(value => value.trim()).filter(Boolean);
  if (!quarkToken) return jsonResponse(request, { error: "O segredo QUARK_AUTH_TOKEN não está configurado no servidor." }, 503);

  const token = authorization.slice("Bearer ".length);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) return jsonResponse(request, { error: "Sessão inválida." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller, error: callerError } = await admin.from("profiles").select("full_name,role,status").eq("id", user.id).single();
  if (callerError || caller?.status !== "ATIVO" || !["ADMINISTRADOR", "RH"].includes(caller.role)) {
    return jsonResponse(request, { error: "Acesso negado." }, 403);
  }

  const unitNames = await fetchUnitNames(quarkBaseUrl, quarkToken);
  const unitIds = configuredUnits.length ? configuredUnits : defaultUnits;

  const { data: run, error: runError } = await admin.from("employee_sync_runs").insert({
    source: "QUARK", status: "RUNNING", triggered_by: user.id, triggered_by_name: caller.full_name,
    units_count: unitIds.length,
  }).select("id").single();
  if (runError || !run) return jsonResponse(request, { error: runError?.message ?? "Não foi possível iniciar a sincronização." }, 500);
  try {
    const byExternalKey = new Map<string, NormalizedEmployee>();
    for (const unitId of unitIds) {
      const unitName = unitNames.get(unitId) ?? unitId;
      const collaborators = await fetchCollaborators(quarkBaseUrl, quarkToken, unitId, unitName);
      for (const collaborator of collaborators) byExternalKey.set(`${collaborator.external_unit_id}:${collaborator.external_id}`, collaborator);
    }

    const records = [...byExternalKey.values()];
    const { data: result, error: syncError } = await admin.rpc("sync_quark_employees", {
      p_actor: user.id,
      p_records: records,
    });
    if (syncError) throw syncError;

    const counts = (result ?? {}) as SyncCounts;
    await admin.from("employee_sync_runs").update({
      status: "SUCCESS",
      received_count: records.length,
      created_count: Number(counts.created ?? 0),
      updated_count: Number(counts.updated ?? 0),
      linked_count: Number(counts.linked ?? 0),
      skipped_count: Number(counts.skipped ?? 0),
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);

    return jsonResponse(request, {
      ok: true,
      runId: run.id,
      units: unitIds.length,
      received: records.length,
      created: Number(counts.created ?? 0),
      updated: Number(counts.updated ?? 0),
      linked: Number(counts.linked ?? 0),
      skipped: Number(counts.skipped ?? 0),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na sincronização.";
    await admin.from("employee_sync_runs").update({
      status: "ERROR", error_message: message.slice(0, 1000), completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return jsonResponse(request, { error: message }, 502);
  }
});
