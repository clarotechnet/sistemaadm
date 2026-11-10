// Shared by the browser, the Edge Function and offline regression tests.
import { normalizeMealText, resolveMealRateVersion, type MealRateVersion } from "./meal-policy.ts";
export { normalizeMealText } from "./meal-policy.ts";
export type MealPeriod = { start: string; end: string; benefitMonth: string };
export type MealEmployee = { id: string; full_name: string; cpf: string; department: string; job_title: string; status: string; external_id: string | null; external_unit_id: string | null; external_unit_name: string; mapped_city?: string | null };
export type MealEvent = { employee_id: string; event_type: "FALTA" | "ATESTADO"; source_id: string; start_date: string; end_date: string; hours: number | null };
export type MealCoverage = { unit_id: string; absence_ok: boolean; medical_ok: boolean; issues: string[]; employee_issues: Record<string, { absence?: string; medical?: string }> };
export type MealRow = {
  employee_id: string; employee_name: string; cpf: string; department: string; job_title: string;
  company: string; city: string; employment_status: string; rate_group: string;
  absence_days: number | null; medical_days: number | null; overlap_days: number | null; deduction_days: number | null;
  planned_work_days: number | null; payable_days: number | null; daily_value: number | null; amount_due: number | null; issues: string[];
  calculation_version?: number | null; calculation_status?: "READY" | "PENDING" | null; calculation_notes?: string[] | null;
  rate_version_id?: string | null;
};
const DAY = 86400000;
export function isMealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
export function mealToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function mealBenefitMonth(end: string) {
  if (!isMealDate(end)) throw new Error("Data final inválida.");
  const date = new Date(end + "T00:00:00Z");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
}
export function mealPeriod(start: string, end: string): MealPeriod {
  if (!isMealDate(start) || !isMealDate(end)) throw new Error("Informe datas válidas para início e fim.");
  const days = (Date.parse(end) - Date.parse(start)) / DAY + 1;
  if (days < 1) throw new Error("O fim do período não pode ser anterior ao início.");
  if (days > 366) throw new Error("Selecione um período de até 366 dias por consulta.");
  return { start, end, benefitMonth: mealBenefitMonth(end) };
}
export function defaultMealPeriod(now = new Date()): MealPeriod {
  const today = mealToday(now), date = new Date(today + "T00:00:00Z");
  const cutoffMonth = date.getUTCMonth() + (date.getUTCDate() > 25 ? 1 : 0);
  const end = new Date(Date.UTC(date.getUTCFullYear(), cutoffMonth, 25)).toISOString().slice(0, 10);
  const start = new Date(Date.UTC(date.getUTCFullYear(), cutoffMonth - 1, 26)).toISOString().slice(0, 10);
  return mealPeriod(start, end);
}
export function mealCity(unit: string) {
  const value = normalizeMealText(unit);
  if (/\bRECIFE\b/.test(value)) return "RECIFE";
  if (/\bMOSSORO\b/.test(value)) return "MOSSORÓ";
  if (/\bFORTALEZA\b/.test(value)) return "FORTALEZA";
  if (/\b(?:PARNAMIRIM|PANAMIRIM)\b/.test(value)) return "PARNAMIRIM";
  if (/\bNATAL\b/.test(value)) return "NATAL";
  if (/\bJOAO PESSOA\b/.test(value)) return "JOÃO PESSOA";
  if (/\bMACEIO\b/.test(value)) return "MACEIÓ";
  return "NÃO IDENTIFICADA";
}
export type MealRateRule = { group: string; dailyCents: number | null; fixedDays: number | null; versionId?: string | null };

// A technical support department alone is not the technical/installation band.
// Check both the department and the job, since installation assistants and
// technical supervisors do not always belong to a department named TECNICA.
export function mealRateRule(city: string, department: string, jobTitle = ""): MealRateRule {
  const place = normalizeMealText(city), sector = normalizeMealText(department), job = normalizeMealText(jobTitle);
  const technical = [sector, job].some(value => /^TECNIC[OA]S?\b/.test(value)
    || /^AUXILIAR(?:\s+DE)?\s+INSTALACAO\b/.test(value)
    || /^SUPERVISOR(?:A)?(?:\s+DE)?\s+TECNIC[OA]S?\b/.test(value));
  const sales = [sector, job].some(value => /^(?:CONSULTOR(?:A)?|SUPERVISOR(?:A)?)(?:\s+DE)?\s+VENDAS\b/.test(value)
    || /^CONSULTOR(?:A)?$/.test(value));
  const stockOrRh = /^ESTOQUE\b|^RH\b|^RECURSOS HUMANOS\b/.test(sector)
    || /\b(?:ESTOQUE|RH|RECURSOS HUMANOS)\b/.test(job);
  const rule = (group: string, dailyCents: number | null, fixedDays: number | null = null): MealRateRule => ({ group, dailyCents, fixedDays });
  if (["NATAL", "MOSSORO", "PARNAMIRIM", "PANAMIRIM", "FORTALEZA"].includes(place)) {
    if (technical) return rule("TECNICO", 2500);
    return sector || job ? rule("GERAL", 2000) : rule("SETOR_PENDENTE", null);
  }
  if (place === "RECIFE") {
    if (stockOrRh) return rule("RECIFE_ESTOQUE_RH", 2300, 22);
    if (sales) return rule("RECIFE_VENDAS", 2000);
    if (technical) return rule("RECIFE_TECNICO", 2858);
    return rule("REGRA_PENDENTE", null);
  }
  if (["JOAO PESSOA", "MACEIO"].includes(place)) return sales ? rule("VENDAS", 2000) : rule("REGRA_PENDENTE", null);
  return rule("UNIDADE_PENDENTE", null);
}
export function mealRateGroup(city: string, department: string, jobTitle = "") {
  return mealRateRule(city, department, jobTitle).group;
}
export function configuredMealRateRule(city: string, department: string, jobTitle: string, rates?: MealRateVersion[], month?: string): MealRateRule {
  const initial = mealRateRule(city, department, jobTitle);
  if (rates === undefined) return initial;
  if (!month) throw new Error("Informe o mês do benefício para selecionar os valores vigentes.");
  const version = resolveMealRateVersion(rates, month, city, initial.group);
  return version ? { group: initial.group, dailyCents: Math.round(version.daily_value * 100), fixedDays: version.fixed_days, versionId: version.id }
    : { group: initial.group, dailyCents: null, fixedDays: null, versionId: null };
}
export const mealGroupLabels: Record<string, string> = {
  TECNICO: "Técnica / Instalação / Supervisão técnica", GERAL: "Demais setores", VENDAS: "Consultoria / Supervisão de vendas",
  RECIFE_VENDAS: "Recife: consultoria / supervisão de vendas", RECIFE_TECNICO: "Recife: técnica / instalação / supervisão técnica",
  RECIFE_ESTOQUE_RH: "Recife: estoque / RH (base fixa)", REGRA_PENDENTE: "Valor deste grupo a definir",
  RECIFE_PENDENTE: "Recife: regra não definida nesta versão", UNIDADE_PENDENTE: "Identificar unidade", SETOR_PENDENTE: "Identificar setor / cargo",
};
export function mealCalculationNote(row: MealRow) {
  if (row.calculation_status === "READY") return `Cálculo concluído: base de ${row.planned_work_days} dias menos faltas e atestados do período.`;
  if (row.calculation_version == null) return "Consulta anterior sem cálculo financeiro. Atualize pelo QuarkRH para criar uma nova versão com as regras atuais.";
  return row.calculation_notes?.join(" ") || "Cálculo pendente.";
}
// Presentation only: a legacy snapshot can show today's rate as a reference in
// Apuração. This never fills workdays/totals or rewrites a saved historical rate.
export function mealDailyRate(row: MealRow, currentRules = false, rates?: MealRateVersion[], month?: string) {
  if (row.daily_value != null) return { value: row.daily_value, preview: false };
  if (currentRules && row.calculation_version == null) {
    const rule = configuredMealRateRule(row.city, row.department, row.job_title, rates, month);
    if (rule.dailyCents !== null) return { value: rule.dailyCents / 100, preview: true };
  }
  return { value: null, preview: false };
}
export function mealDays(start: string, end: string, bounds: { start: string; end: string }) {
  if (!isMealDate(start) || !isMealDate(end) || end < start) throw new Error("Ocorrência com datas inválidas.");
  const a = Math.max(Date.parse(start), Date.parse(bounds.start)), b = Math.min(Date.parse(end), Date.parse(bounds.end));
  const result: string[] = [];
  for (let time = a; time <= b; time += DAY) result.push(new Date(time).toISOString().slice(0, 10));
  return result;
}
export function buildMealRows(employees: MealEmployee[], events: MealEvent[], coverage: MealCoverage[], bounds: { start: string; end: string }, options: { periodEnd?: string; rates?: MealRateVersion[]; benefitMonth?: string } = {}): MealRow[] {
  const units = new Map(coverage.map(unit => [unit.unit_id, unit]));
  const byEmployee = new Map<string, MealEvent[]>();
  for (const event of events) { const own = byEmployee.get(event.employee_id) ?? []; own.push(event); byEmployee.set(event.employee_id, own); }
  return employees.map((employee): MealRow => {
    const unit = units.get(employee.external_unit_id ?? "");
    const linked = Boolean(employee.external_id && employee.external_unit_id);
    const issues: string[] = [];
    const ownIssues = unit?.employee_issues[employee.id];
    const absenceOk = linked && unit?.absence_ok === true && !ownIssues?.absence;
    const medicalOk = linked && unit?.medical_ok === true && !ownIssues?.medical;
    if (!linked) issues.push("Sem vínculo QuarkRH: faltas e atestados não consultados.");
    else {
      if (!absenceOk) issues.push(ownIssues?.absence ?? "Faltas não puderam ser consultadas nesta unidade.");
      if (!medicalOk) issues.push(ownIssues?.medical ?? "Atestados não puderam ser consultados nesta unidade.");
    }
    const absence = new Set<string>(), medical = new Set<string>();
    for (const event of byEmployee.get(employee.id) ?? []) {
      const target = event.event_type === "FALTA" ? absence : medical;
      for (const day of mealDays(event.start_date, event.end_date, bounds)) target.add(day);
    }
    const overlap = absenceOk && medicalOk ? [...absence].filter(day => medical.has(day)).length : null;
    if (overlap) issues.push(`${overlap} dia(s) com falta e atestado sobrepostos. Conferir antes de descontar.`);
    const city = employee.mapped_city?.trim().toLocaleUpperCase("pt-BR") || mealCity(employee.external_unit_name);
    const rate = configuredMealRateRule(city, employee.department || "", employee.job_title || "", options.rates, options.benefitMonth);
    const deduction = absenceOk && medicalOk && overlap === 0 ? absence.size + medical.size : null;
    const notes: string[] = [];
    if (rate.dailyCents === null) notes.push("Valor deste grupo ainda não definido pelo RH.");
    if (rate.fixedDays === null) notes.push("Dias previstos de trabalho no mês do benefício ainda não definidos.");
    if (employee.status !== "ATIVO") notes.push("Funcionário desligado: elegibilidade do benefício a confirmar pelo RH.");
    if (bounds.end < (options.periodEnd ?? bounds.end)) notes.push("Período de ocorrências ainda aberto. O valor final aguarda o fechamento.");
    if (deduction === null) notes.push(overlap ? "Conferir sobreposição de falta e atestado antes de calcular." : "Cálculo aguarda a consulta completa de faltas e atestados.");
    const payable = !notes.length && rate.fixedDays !== null && deduction !== null ? Math.max(0, rate.fixedDays - deduction) : null;
    return {
      employee_id: employee.id, employee_name: employee.full_name, cpf: employee.cpf || "", department: employee.department || "",
      job_title: employee.job_title || "", company: employee.external_unit_name || "Unidade não informada", city,
      employment_status: employee.status, rate_group: rate.group,
      absence_days: absenceOk ? absence.size : null, medical_days: medicalOk ? medical.size : null,
      overlap_days: overlap, deduction_days: deduction,
      planned_work_days: rate.fixedDays, payable_days: payable, daily_value: rate.dailyCents === null ? null : rate.dailyCents / 100,
      amount_due: payable === null || rate.dailyCents === null ? null : payable * rate.dailyCents / 100, issues,
      calculation_version: options.rates === undefined ? 1 : 2, calculation_status: payable === null ? "PENDING" : "READY", calculation_notes: notes,
      ...(options.rates === undefined ? {} : { rate_version_id: rate.versionId ?? null }),
    };
  }).sort((a, b) => a.employee_name.localeCompare(b.employee_name, "pt-BR") || a.employee_id.localeCompare(b.employee_id));
}
