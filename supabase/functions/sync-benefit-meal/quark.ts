import { isMealDate, mealDays, type MealCoverage, type MealEvent } from "../_shared/meal-domain.ts";
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
class QuarkHttpError extends Error {
  constructor(readonly status: number, path: string) { super(`QuarkRH HTTP ${status} em ${path.split("?")[0]}.`); }
}
type MealRequester = (path: string, unit: string) => Promise<unknown>;
// One queue for the entire invocation: units, sources, pages and retries share the quota.
export function createMealRequester(options: { base: string; token: string; fetcher?: typeof fetch; deadline?: number; intervalMs?: number; now?: () => number; wait?: (ms: number) => Promise<void> }): MealRequester {
  const now = options.now ?? Date.now, wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const fetcher = options.fetcher ?? fetch, deadline = options.deadline ?? now() + 125000;
  let nextAt = 0, tail = Promise.resolve();
  async function request(path: string, unit: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = Math.max(0, nextAt - now());
      if (now() + delay >= deadline) throw new Error("Tempo limite da consulta atingido; dados não considerados completos.");
      if (delay) await wait(delay);
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error("Tempo limite da consulta atingido.");
      const response = await fetcher(options.base.replace(/\/$/, "") + path, {
        // Same application header as the existing, working Agregamento integration.
        headers: { Accept: "application/json", "Auth-Token": options.token, "Unidade-ID": unit, "User-Agent": "RH-Control-Aggregation/2.0" },
        signal: AbortSignal.timeout(Math.min(20000, remaining)),
      });
      nextAt = now() + (options.intervalMs ?? 500);
      if (response.ok) {
        try { return await response.json(); }
        catch { throw new Error(`Resposta QuarkRH sem JSON válido em ${path.split("?")[0]}.`); }
      }
      const error = new QuarkHttpError(response.status, path);
      if (response.status !== 429) throw error;
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : retryAfter && Number.isFinite(Date.parse(retryAfter)) ? Math.max(0, Date.parse(retryAfter) - now()) : 1000 * 2 ** attempt;
      nextAt = Math.max(nextAt, now() + retryMs);
      if (attempt === 2) throw error;
      if (nextAt >= deadline) throw new Error(`${error.message} Limite de requisições: nova tentativa somente após o prazo desta consulta.`);
    }
    throw new Error("Não foi possível consultar o QuarkRH.");
  }
  return (path, unit) => {
    const pending = tail.then(() => request(path, unit));
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  };
}
function date(value: unknown) {
  const raw = text(value), match = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  const result = match ? `${match[3]}-${match[2]}-${match[1]}` : raw.slice(0, 10);
  return isMealDate(result) ? result : "";
}
export function mealDuration(value: unknown): number | null {
  const raw = text(value).replace(/[−–]/g, "-");
  if (!raw) return null;
  const clock = raw.match(/^(-)?(\d{1,6}):(\d{2})(?::(\d{2}))?$/);
  if (clock) return Number(clock[3]) < 60 && Number(clock[4] ?? 0) < 60 ? (clock[1] ? -1 : 1) * (Number(clock[2]) * 60 + Number(clock[3])) : null;
  const iso = raw.match(/^(-)?PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) return (iso[1] ? -1 : 1) * (Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0) + Number(iso[4] ?? 0) / 60);
  const numeric = Number(raw.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}
function pageList(payload: unknown): Obj[] {
  if (Array.isArray(payload)) {
    if (payload.some(item => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("Lista QuarkRH com registros inválidos.");
    return payload.map(object);
  }
  const data = object(payload);
  for (const key of ["dados", "content", "data", "items", "results", "result", "records", "registros", "lista", "colaboradores", "espelhos", "espelhosPonto", "dias"]) {
    if (Array.isArray(data[key])) return pageList(data[key]);
    if (data[key] && typeof data[key] === "object") { try { return pageList(data[key]); } catch { /* Try the next known wrapper. */ } }
  }
  // Agregamento traverses nested response containers. Do the same without accepting
  // an unknown/error object as an empty successful list.
  for (const value of Object.values(data)) if (value && typeof value === "object" && !Array.isArray(value)) {
    try { return pageList(value); } catch { /* Another nested response container. */ }
  }
  for (const value of Object.values(data)) if (Array.isArray(value) && value.some(item => {
    const row = object(item); return "colaborador" in row || "colaboradorId" in row || "dia" in row || "dataAtestado" in row;
  })) return pageList(value);
  throw new Error("Resposta QuarkRH sem lista reconhecida; a contagem não foi considerada zero.");
}
function totalPages(payload: unknown): number | null {
  const data = object(payload);
  for (const [key, value] of Object.entries(data)) {
    if (["TOTALPAGINAS", "TOTALPAGES", "QUANTIDADEPAGINAS", "PAGES"].includes(key.replace(/[^a-z]/gi, "").toUpperCase())) {
      const count = Number(value); if (Number.isInteger(count) && count >= 0) return count;
    }
  }
  for (const value of Object.values(data)) if (value && typeof value === "object" && !Array.isArray(value)) { const count = totalPages(value); if (count !== null) return count; }
  return null;
}
export function extractMealAbsences(payload: unknown, unit: string, employees: Map<string, string>, bounds: { start: string; end: string }) {
  const events: MealEvent[] = [], issues: Record<string, string> = {}, seen = new Set<string>();
  function walk(value: unknown, parentId = "") {
    if (Array.isArray(value)) { for (const item of value) walk(item, parentId); return; }
    if (!value || typeof value !== "object") return;
    const row = object(value), externalId = text(object(row.colaborador).id ?? row.colaboradorId ?? row.colaborador_id ?? row.idColaborador) || parentId;
    const employee = employees.get(externalId);
    if (text(row.tipoDesconto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() === "FALTA" && employee) {
      const day = date(row.dia), minutes = mealDuration(row.horasAusencia);
      if (!day) issues[employee] = "Falta com data inválida no QuarkRH.";
      else if (day >= bounds.start && day <= bounds.end) {
        if (minutes === null) issues[employee] = "Falta com duração inválida no QuarkRH.";
        else if (minutes !== 0) {
          const id = `espelho:${unit}:${externalId}:${day}`;
          if (!seen.has(id)) { seen.add(id); events.push({ employee_id: employee, event_type: "FALTA", source_id: id, start_date: day, end_date: day, hours: Math.abs(minutes) / 60 }); }
        }
      }
    }
    for (const child of Object.values(row)) if (child && typeof child === "object") walk(child, externalId);
  }
  walk(payload);
  return { events, issues };
}
export function extractMealMedical(rows: Obj[], unit: string, employees: Map<string, string>, bounds: { start: string; end: string }) {
  const events: MealEvent[] = [], issues: Record<string, string> = {};
  for (const row of rows) {
    const externalId = text(object(row.colaborador).id ?? row.colaboradorId), employee = employees.get(externalId);
    if (!employee) continue;
    const start = date(row.dataAtestado), end = text(row.dataTerminoAtestado) ? date(row.dataTerminoAtestado) : start;
    if (!start || !end || end < start) { issues[employee] = "Atestado com datas inválidas no QuarkRH."; continue; }
    if (!mealDays(start, end, bounds).length) continue;
    const explicit = Number(row.totalDias ?? row.quantidadeDias), calendarDays = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (Number.isFinite(explicit) && explicit > 0 && explicit !== calendarDays) issues[employee] = "Atestado com quantidade de dias diferente do intervalo de datas. Conferir no QuarkRH.";
    const hours = row.quantidadeHoras == null ? null : Number(String(row.quantidadeHoras).replace(",", "."));
    events.push({ employee_id: employee, event_type: "ATESTADO", source_id: `atestado:${unit}:${text(row.id) || externalId + ":" + start + ":" + end}`, start_date: start, end_date: end, hours: hours !== null && Number.isFinite(hours) ? Math.abs(hours) : null });
  }
  return { events, issues };
}
export async function fetchMealUnit(options: { base: string; token: string; unit: string; employees: Map<string, string>; bounds: { start: string; end: string }; fetcher?: typeof fetch; deadline?: number; requester?: MealRequester }) {
  const { unit, employees, bounds } = options;
  const coverage: MealCoverage = { unit_id: unit, absence_ok: false, medical_ok: false, issues: [], employee_issues: {} };
  const events: MealEvent[] = [];
  const queued = options.requester ?? createMealRequester(options);
  const request = (path: string) => queued(path, unit);
  const merge = (kind: "absence" | "medical", data: { events: MealEvent[]; issues: Record<string, string> }) => {
    events.push(...data.events);
    for (const [employee, message] of Object.entries(data.issues)) (coverage.employee_issues[employee] ??= {})[kind] = message;
  };
  const formatted = (value: string) => value.split("-").reverse().join("/");
  try {
    // Match the month-based Espelho requests used successfully by Agregamento.
    // Only event dates inside the operator's selected bounds are counted or saved.
    let month = bounds.start.slice(0, 7);
    while (month <= bounds.end.slice(0, 7)) {
        const start = month + "-01", cursor = new Date(start + "T00:00:00Z");
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        const next = cursor.toISOString().slice(0, 10), end = new Date(cursor.getTime() - 86400000).toISOString().slice(0, 10);
        let keys: string[] | null = null, first: unknown;
        for (const candidate of [["inicio", "fim"], ["dataInicio", "dataFim"], ["dataInicial", "dataFinal"]]) {
          try { first = await request("/v1/frequencias/espelho-ponto?" + new URLSearchParams({ page: "0", size: "50", [candidate[0]]: formatted(start), [candidate[1]]: formatted(end) })); keys = candidate; break; }
          catch (error) {
            // A quota/auth/server failure is not a reason to issue two more variants.
            if (!(error instanceof QuarkHttpError) || ![400, 422].includes(error.status) || candidate[0] === "dataInicial") throw error;
          }
        }
        if (!keys) throw new Error("Espelho de Ponto indisponível nas opções suportadas.");
        const pages = totalPages(first);
        if (pages !== null && pages > 100) throw new Error("Espelho excede 100 páginas. Reduza o período.");
        merge("absence", extractMealAbsences(first, unit, employees, bounds));
        let size = pageList(first).length, page = 1;
        while (pages !== null ? page < pages : size >= 50) {
          if (page >= 100) throw new Error("Espelho incompleto: limite de páginas atingido.");
          const payload = await request("/v1/frequencias/espelho-ponto?" + new URLSearchParams({ page: String(page++), size: "50", [keys[0]]: formatted(start), [keys[1]]: formatted(end) }));
          size = pageList(payload).length;
          merge("absence", extractMealAbsences(payload, unit, employees, bounds));
        }
        month = next.slice(0, 7);
    }
    coverage.absence_ok = true;
  } catch (error) { coverage.issues.push(`Faltas: ${error instanceof Error ? error.message : "consulta indisponível"}`); }
  try {
        let page = 1;
        while (true) {
          const payload = await request(`/v1/saude-ocupacional/atestado-medico?page=${page}&size=100`);
          const list = pageList(payload), pages = totalPages(payload);
          if (pages !== null && pages > 100) throw new Error("Atestados excedem 100 páginas.");
          merge("medical", extractMealMedical(list, unit, employees, bounds));
          if (pages !== null ? page >= pages : list.length < 100) break;
          if (++page > 100) throw new Error("Atestados incompletos: limite de páginas atingido.");
        }
    coverage.medical_ok = true;
  } catch (error) { coverage.issues.push(`Atestados: ${error instanceof Error ? error.message : "consulta indisponível"}`); }
  const unique = new Map(events.map(event => [[event.employee_id, event.event_type, event.source_id, event.start_date, event.end_date].join("|"), event]));
  return { events: [...unique.values()], coverage };
}
