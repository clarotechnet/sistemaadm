import { mealToday, normalizeMealText, type MealQuarkDetails, type MealRegisteredAbsence } from "../_shared/meal-domain.ts";
import { parseQuarkEmployeeDate } from "../sync-quark-employees/date-utils.ts";
import { QuarkHttpError, type MealRequester } from "./quark.ts";

type QuarkRecord = Record<string, unknown>;
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const asRecord = (value: unknown): QuarkRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as QuarkRecord : null;
const description = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 180) : "";

async function lookupPages(request: MealRequester, path: string, unit: string): Promise<QuarkRecord[]> {
  const records: QuarkRecord[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = await request(`${path}?page=${page}`, unit);
    const items = Array.isArray(payload) ? payload : asRecord(payload)?.dados;
    if (!Array.isArray(items)) throw new Error("Resposta de detalhes do QuarkRH sem lista de registros.");
    let added = 0;
    for (const value of items) {
      const item = asRecord(value);
      if (!item || (typeof item.id !== "number" && typeof item.id !== "string")) {
        throw new Error("Registro do QuarkRH sem identificação.");
      }
      const id = String(item.id).trim();
      if (!id) throw new Error("Registro do QuarkRH sem identificação.");
      if (seen.has(id)) continue;
      seen.add(id);
      records.push(item);
      added++;
    }
    if (items.length && !added) throw new Error("A API do QuarkRH repetiu uma página.");
    if (items.length < PAGE_SIZE) return records;
  }
  throw new Error("O QuarkRH retornou mais páginas de detalhes do que esta consulta comporta.");
}

function currentBenefits(records: QuarkRecord[], today: string): string[] {
  const options = new Map<string, string>();
  for (const record of records) {
    if (record.ativo === false) continue;
    if (record.ativo !== true) throw new Error("Benefício do QuarkRH sem situação.");
    const starts = parseQuarkEmployeeDate(record.inicioVigencia);
    const ends = parseQuarkEmployeeDate(record.dataInativacao);
    if ((starts && starts > today) || (ends && ends <= today)) continue;
    const option = asRecord(record.auxilioAlimentacao);
    const name = description(option?.descricao);
    if (!name) throw new Error("Benefício ativo do QuarkRH sem descrição.");
    options.set(normalizeMealText(name), name);
  }
  return [...options.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function overlappingAbsences(records: QuarkRecord[], collaborator: string, bounds: { start: string; end: string }): MealRegisteredAbsence[] {
  const entries = new Map<string, MealRegisteredAbsence>();
  for (const record of records) {
    if (record.ativo === false) continue;
    if (record.colaboradorId != null && String(record.colaboradorId) !== collaborator) {
      throw new Error("Ausência do QuarkRH sem correspondência com o colaborador.");
    }
    const start = parseQuarkEmployeeDate(record.inicio);
    const end = parseQuarkEmployeeDate(record.fim);
    if (!start || (record.fim != null && !end) || (end && end < start)) throw new Error("Ausência do QuarkRH com datas inválidas.");
    if (start > bounds.end || (end && end < bounds.start)) continue;
    const type = description(asRecord(record.tipo)?.denominacao);
    if (!type) throw new Error("Ausência do QuarkRH sem tipo registrado.");
    const excused = typeof record.abonada === "boolean" ? record.abonada : null;
    const entry = { type, start_date: start, end_date: end, excused };
    entries.set(JSON.stringify([normalizeMealText(type), start, end, excused]), entry);
  }
  return [...entries.values()].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.type.localeCompare(b.type, "pt-BR"));
}

function pauseReason(error: unknown): string | undefined {
  if (error instanceof QuarkHttpError) {
    if (error.status === 429) return "O QuarkRH limitou as consultas. Aguarde um pouco e consulte os dados que faltam.";
    if (error.status === 401) return "O QuarkRH recusou a credencial da integração. Confira a configuração para continuar.";
    if (error.status >= 500) return "O QuarkRH está indisponível. Quando voltar, consulte os dados que faltam.";
  }
  if (error instanceof TypeError) return "Não foi possível conectar ao QuarkRH. Tente continuar a consulta em instantes.";
  if (error instanceof Error && (error.name === "TimeoutError" || error.message.startsWith("Tempo limite"))) {
    return "A consulta atingiu o limite de tempo. Use o botão para continuar com os dados que faltam.";
  }
}

export async function lookupMealQuarkDetails(
  request: MealRequester,
  unit: string | undefined,
  collaborator: string | undefined,
  bounds: { start: string; end: string },
  previous: MealQuarkDetails | null,
): Promise<{ details: MealQuarkDetails; paused?: string }> {
  const now = new Date();
  const updated_at = now.toISOString();
  const details: MealQuarkDetails = { updated_at, benefit: previous?.benefit ?? null, absences: previous?.absences ?? null };
  if (!unit?.match(/^\d+$/) || !collaborator?.match(/^\d+$/)) return { details: { ...details, no_link: true } };

  if (!details.benefit) {
    try {
      const records = await lookupPages(request, "/v1/beneficios/alimentacao/" + collaborator, unit);
      details.benefit = { options: currentBenefits(records, mealToday(now)), checked_at: new Date().toISOString() };
    } catch (error) {
      const paused = pauseReason(error);
      if (paused) return { details, paused };
    }
  }
  if (!details.absences) {
    try {
      const records = await lookupPages(request, "/v1/ausencias/" + collaborator, unit);
      details.absences = { entries: overlappingAbsences(records, collaborator, bounds), checked_at: new Date().toISOString() };
    } catch (error) {
      const paused = pauseReason(error);
      if (paused) return { details, paused };
    }
  }
  return { details };
}
