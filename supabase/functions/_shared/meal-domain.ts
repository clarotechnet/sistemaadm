// Shared by the browser, the Edge Function and offline regression tests.
export type MealPeriod = { start: string; end: string; benefitMonth: string };
export type MealEmployee = { id: string; full_name: string; cpf: string; department: string; job_title: string; status: string; external_id: string | null; external_unit_id: string | null; external_unit_name: string };
export type MealEvent = { employee_id: string; event_type: "FALTA" | "ATESTADO"; source_id: string; start_date: string; end_date: string; hours: number | null };
export type MealCoverage = { unit_id: string; absence_ok: boolean; medical_ok: boolean; issues: string[]; employee_issues: Record<string, { absence?: string; medical?: string }> };
export type MealRow = {
  employee_id: string; employee_name: string; cpf: string; department: string; job_title: string;
  company: string; city: string; employment_status: string; rate_group: string;
  absence_days: number | null; medical_days: number | null; overlap_days: number | null; deduction_days: number | null;
  planned_work_days: null; payable_days: null; daily_value: null; amount_due: null; issues: string[];
};
const DAY = 86400000;
export const normalizeMealText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
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
  if (/\bNATAL\b/.test(value)) return "NATAL";
  return "NÃO IDENTIFICADA";
}
export function mealRateGroup(city: string, department: string) {
  if (city === "RECIFE") return "RECIFE_PENDENTE";
  if (!["NATAL", "MOSSORÓ", "FORTALEZA"].includes(city)) return "UNIDADE_PENDENTE";
  if (!department.trim()) return "SETOR_PENDENTE";
  return /^TECNIC[OA]\b/.test(normalizeMealText(department)) ? "TECNICO" : "GERAL";
}
export const mealGroupLabels: Record<string, string> = { TECNICO: "Técnico / Técnica", GERAL: "Demais setores", RECIFE_PENDENTE: "Recife: 4 faixas a definir", UNIDADE_PENDENTE: "Identificar unidade", SETOR_PENDENTE: "Identificar setor" };
export function mealDays(start: string, end: string, bounds: { start: string; end: string }) {
  if (!isMealDate(start) || !isMealDate(end) || end < start) throw new Error("Ocorrência com datas inválidas.");
  const a = Math.max(Date.parse(start), Date.parse(bounds.start)), b = Math.min(Date.parse(end), Date.parse(bounds.end));
  const result: string[] = [];
  for (let time = a; time <= b; time += DAY) result.push(new Date(time).toISOString().slice(0, 10));
  return result;
}
export function buildMealRows(employees: MealEmployee[], events: MealEvent[], coverage: MealCoverage[], bounds: { start: string; end: string }): MealRow[] {
  const units = new Map(coverage.map(unit => [unit.unit_id, unit]));
  const byEmployee = new Map<string, MealEvent[]>();
  for (const event of events) { const own = byEmployee.get(event.employee_id) ?? []; own.push(event); byEmployee.set(event.employee_id, own); }
  return employees.map(employee => {
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
    const city = mealCity(employee.external_unit_name);
    return {
      employee_id: employee.id, employee_name: employee.full_name, cpf: employee.cpf || "", department: employee.department || "",
      job_title: employee.job_title || "", company: employee.external_unit_name || "Unidade não informada", city,
      employment_status: employee.status, rate_group: mealRateGroup(city, employee.department || ""),
      absence_days: absenceOk ? absence.size : null, medical_days: medicalOk ? medical.size : null,
      overlap_days: overlap, deduction_days: absenceOk && medicalOk && overlap === 0 ? absence.size + medical.size : null,
      planned_work_days: null, payable_days: null, daily_value: null, amount_due: null, issues,
    };
  }).sort((a, b) => a.employee_name.localeCompare(b.employee_name, "pt-BR") || a.employee_id.localeCompare(b.employee_id));
}
