import type { ActivePayroll, Employee, PayrollAuditData, PayrollRecord } from "../../types";
import { normalizeHeader } from "../../utils/text";
import { isBaseSalaryField } from "./audit-fields";

export type AuditSeverity = "OK" | "ATENCAO" | "CRITICO" | "INFORMACAO";
export type AuditReviewStatus = "PENDENTE" | "EM_ANALISE" | "JUSTIFICADA" | "CORRIGIDA" | "IGNORADA";
export type AuditBasis = "liquid" | "gross" | "baseSalary";
export interface AuditRules { percentage: number; absolute: number; basis: "liquid"; deductionsPercentage?: number }
export const defaultAuditRules: AuditRules = { percentage: 20, absolute: 300, basis: "liquid", deductionsPercentage: 50 };
export type AuditMetric = "processed" | "ok" | "attention" | "critical" | "information" | "zeroPayroll" | "zeroLiquid" | "negativeLiquid" | "newEmployees" | "missing" | "duplicates" | "activeZeroLiquid" | "unmatchedEmployees" | "highDeductions";
export interface AuditFinding { code: string; label: string; severity: Exclude<AuditSeverity, "OK">; explanation: string }
export interface AuditReview { employeeKey: string; ruleCode: string; status: AuditReviewStatus; notes: string; updatedBy: string; updatedByName: string; updatedAt: string }
export interface AuditRow {
  key: string; cpf: string; name: string; current: PayrollRecord | null; previous: PayrollRecord | null;
  employee: Employee | null; currentValue: number | null; previousValue: number | null;
  difference: number | null; variation: number | null; severity: AuditSeverity; findings: AuditFinding[];
  company: string; unit: string; costCenter: string; department: string; jobTitle: string; registration: string;
  employeeStatus: "ATIVO" | "DESLIGADO" | "NAO_LOCALIZADO";
  liquidComparisons: Array<{ competence: string; value: number | null; difference: number | null; variation: number | null }>;
}
export interface AuditSummary {
  total: number; processed: number; ok: number; attention: number; critical: number; information: number;
  currentTotal: number | null; previousTotal: number | null; difference: number | null; variation: number | null;
  zeroPayroll: number; zeroLiquid: number; negativeLiquid: number; newEmployees: number; missing: number; duplicates: number;
  currentKnown: number; previousKnown: number;
  activeZeroLiquid: number; unmatchedEmployees: number; highDeductions: number;
}
export interface AuditResult { rows: AuditRow[]; summary: AuditSummary; coverage: Array<{ label: string; available: number; total: number; note: string }> }
export interface VacationEvidence { cpf: string; days: number }

const rank: Record<AuditSeverity, number> = { CRITICO: 3, ATENCAO: 2, INFORMACAO: 1, OK: 0 };
const cents = (value: number) => Math.round(value * 100) / 100;
const zero = (value: number | null) => value !== null && Math.abs(value) < 0.005;
const changed = (a: number, b: number) => Math.abs(cents(a - b)) > 0.01;
export function competenceIndex(competence: string) {
  const match = competence.match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  return match ? Number(match[2]) * 12 + Number(match[1]) - 1 : -1;
}
export function comparisonCompetences(current: string, months = 3): string[] {
  const index = competenceIndex(current);
  if (index < 0) throw new Error("Informe uma competência válida.");
  if (!Number.isInteger(months) || months < 1 || months > 3) throw new Error("O comparativo permite de 1 a 3 meses anteriores.");
  return Array.from({ length: months }, (_, offset) => {
    const month = index - offset - 1;
    return `${String(month % 12 + 1).padStart(2, "0")}/${Math.floor(month / 12)}`;
  });
}
export function competenceDates(competence: string) {
  const [month, year] = competence.split("/").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}
export function auditValue(record: PayrollRecord | null, basis: AuditBasis): number | null {
  if (!record) return null;
  if (record.audit) return record.audit[basis];
  // Legacy imports preserved only liquid; gross/base cannot be reconstructed.
  return basis === "liquid" && Number.isFinite(record.liquid) ? record.liquid : null;
}
export function deductionsPercentage(record: PayrollRecord | null): number | null {
  const gross = auditValue(record, "gross");
  const deductions = record?.audit?.deductions ?? null;
  // Never use net pay as the denominator or reconstruct unknown totals.
  return gross !== null && Number.isFinite(gross) && gross > 0 && deductions !== null && Number.isFinite(deductions) && deductions >= 0 ? deductions / gross * 100 : null;
}
export function matchesAuditMetric(row: AuditRow, metric: AuditMetric): boolean {
  switch (metric) {
    case "processed": return Boolean(row.current);
    case "ok": return row.severity === "OK";
    case "attention": return row.severity === "ATENCAO";
    case "critical": return row.severity === "CRITICO";
    case "information": return row.severity === "INFORMACAO";
    case "activeZeroLiquid": return Boolean(row.current) && row.employeeStatus === "ATIVO" && zero(auditValue(row.current, "liquid"));
    case "unmatchedEmployees": return Boolean(row.current) && row.employeeStatus === "NAO_LOCALIZADO";
    default: {
      const codes = { zeroPayroll: ["ZERO_PAYROLL"], zeroLiquid: ["ZERO_LIQUID"], negativeLiquid: ["NEGATIVE_LIQUID"], newEmployees: ["NEW"], missing: ["MISSING", "ADMISSION_NO_PAY"], duplicates: ["DUPLICATE"], highDeductions: ["HIGH_DEDUCTIONS"] };
      return row.findings.some(finding => codes[metric].includes(finding.code));
    }
  }
}
export function eventTotal(data: PayrollAuditData | undefined, category: string): number | null {
  const events = data?.events.filter(event => event.kind === "earning" && event.category === category) ?? [];
  return events.length ? cents(events.reduce((sum, event) => sum + event.value, 0)) : null;
}
function largeChange(current: number, previous: number, rules: AuditRules) {
  const delta = Math.abs(cents(current - previous));
  return delta > rules.absolute && (Math.abs(previous) < 0.005 || delta / Math.abs(previous) * 100 > rules.percentage);
}
function adjustmentReason(record: PayrollRecord | null, employee: Employee | null, dates: ReturnType<typeof competenceDates>) {
  const status = normalizeHeader(record?.audit?.employmentStatus ?? "");
  if (/AFASTAD|LICENCA|FERIAS|SUSPENS/.test(status)) return `Situação informada na folha: ${record?.audit?.employmentStatus}.`;
  if (/DESLIGAD|INATIV|DEMIT/.test(status)) return `Situação informada na folha: ${record?.audit?.employmentStatus}; conferir verbas de desligamento.`;
  const termination = record?.audit?.terminationDate ?? employee?.terminationDate;
  if (termination && termination <= dates.end) return `Desligamento registrado em ${termination}.`;
  const admission = record?.audit?.admissionDate ?? employee?.admissionDate;
  if (admission && admission >= dates.start && admission <= dates.end) return `Admissão na competência (${admission}); conferir pagamento proporcional.`;
  if (!status && employee?.status === "DESLIGADO" && !termination) return `Cadastro atual ${employee.source === "QUARK" ? "do QuarkRH" : "manual"} indica desligado, sem data de desligamento. Conferir a situação na competência; o status atual não comprova o histórico.`;
  if (record && !status && !employee) return "CPF não localizado no cadastro de funcionários. Confirmar o vínculo antes de concluir que houve falta de pagamento.";
  return null;
}

function employeeUnit(employee: Employee) {
  return employee.externalUnitId || normalizeHeader(employee.externalUnitName ?? "");
}
function duplicateKeys(records: PayrollRecord[]) {
  const registrations = new Map<string, Set<string>>();
  const internalIds = new Map<string, Set<string>>();
  for (const record of records) {
    for (const [value, map] of [[record.audit?.registration, registrations], [record.audit?.internalId, internalIds]] as const) {
      if (!value) continue;
      const key = `${record.audit?.company ?? ""}:${value}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(record.cpf);
    }
  }
  return new Set([...registrations.values(), ...internalIds.values()].filter(cpfs => cpfs.size > 1).flatMap(cpfs => [...cpfs]));
}

function hasEmploymentEvidence(employee: Employee, dates: ReturnType<typeof competenceDates>) {
  if (!employee.admissionDate || employee.admissionDate > dates.end) return false;
  if (employee.terminationDate) return employee.terminationDate >= dates.start;
  // A currently dismissed employee without a date cannot be assumed active in a historical month.
  return normalizeHeader(employee.status) === "ATIVO";
}

export function comparePayrolls(current: ActivePayroll, previous: ActivePayroll | null, employees: Employee[], rules: AuditRules = defaultAuditRules, vacations: VacationEvidence[] = []): AuditResult {
  if (previous && competenceIndex(previous.competence) >= competenceIndex(current.competence)) throw new Error("A referência deve ser uma competência anterior à atual.");
  if (previous && !comparisonCompetences(current.competence).includes(previous.competence)) throw new Error("A referência deve estar nos 3 meses anteriores à competência atual.");
  if (rules.basis !== "liquid") throw new Error("O comparativo de folha é sempre sobre o líquido.");
  if (!Number.isFinite(rules.percentage) || rules.percentage < 0 || !Number.isFinite(rules.absolute) || rules.absolute < 0) throw new Error("Informe limites de variação válidos.");
  const deductionLimit = rules.deductionsPercentage ?? defaultAuditRules.deductionsPercentage!;
  if (!Number.isFinite(deductionLimit) || deductionLimit < 0 || deductionLimit > 100) throw new Error("Informe um limite de descontos entre 0 e 100%.");
  const currentMap = new Map(current.records.map(record => [record.cpf, record]));
  const previousMap = new Map(previous?.records.map(record => [record.cpf, record]) ?? []);
  const employeeMap = new Map(employees.filter(employee => employee.cpf).map(employee => [employee.cpf, employee]));
  const duplicateCpfs = duplicateKeys(current.records);
  const vacationMap = new Map(vacations.map(item => [item.cpf, item.days]));
  const dates = competenceDates(current.competence);
  const units = new Set(current.records.map(record => employeeMap.get(record.cpf)).filter((employee): employee is Employee => Boolean(employee)).map(employeeUnit).filter(Boolean));
  const belongsToPayrollScope = (employee: Employee) => Boolean(employeeUnit(employee)) && units.has(employeeUnit(employee));
  const keys = new Set([...currentMap.keys(), ...previousMap.keys()]);
  // An admission date provides evidence that the employee should already be in this month.
  for (const employee of employees) {
    if (employee.cpf && belongsToPayrollScope(employee) && hasEmploymentEvidence(employee, dates)) keys.add(employee.cpf);
  }
  const rows: AuditRow[] = [];
  for (const key of keys) {
    const now = currentMap.get(key) ?? null;
    const before = previousMap.get(key) ?? null;
    const employee = employeeMap.get(key) ?? null;
    const data = now?.audit;
    const prior = before?.audit;
    const findings: AuditFinding[] = [];
    const add = (code: string, label: string, severity: AuditFinding["severity"], explanation: string) => findings.push({ code, label, severity, explanation });
    const reason = adjustmentReason(now, employee, dates);
    const currentValue = auditValue(now, "liquid");
    const previousValue = auditValue(before, "liquid");
    const liquid = auditValue(now, "liquid");
    const gross = auditValue(now, "gross");
    const base = auditValue(now, "baseSalary");
    const deductions = data?.deductions ?? null;
    const difference = now && before && currentValue !== null && previousValue !== null ? cents(currentValue - previousValue) : !now && before && previousValue !== null ? -previousValue : null;
    const variation = difference !== null && previousValue !== null && Math.abs(previousValue) >= 0.005 ? difference / Math.abs(previousValue) * 100 : null;

    if (now && previous && !before) add("NEW", "Novo na folha", "INFORMACAO", `Presente em ${current.competence}, sem registro em ${previous.competence}.${data?.admissionDate ?? employee?.admissionDate ? ` Admissão: ${data?.admissionDate ?? employee?.admissionDate}.` : " Data de admissão indisponível para validação."}`);
    if (!now && before) add("MISSING", "Ausente da folha", reason ? "INFORMACAO" : "ATENCAO", reason ?? `Presente em ${previous!.competence} e ausente em ${current.competence}. Conferir desligamento, afastamento ou transferência.`);
    if (!now && employee && belongsToPayrollScope(employee) && hasEmploymentEvidence(employee, dates)) {
      add("ADMISSION_NO_PAY", "Cadastro sem pagamento", reason ? "ATENCAO" : "CRITICO", `Admissão registrada em ${employee.admissionDate}, sem folha nesta competência.${reason ? ` ${reason}` : " Conferir vínculo e pagamento devido."}`);
    }
    if (now) {
      if (!employee) add("EMPLOYEE_NOT_FOUND", "CPF não localizado no cadastro", "ATENCAO", "O CPF da folha não foi encontrado no cadastro sincronizado do QuarkRH nem nos registros manuais. Sincronize e confira o documento; não foi considerado ativo ou desligado.");
      if (zero(gross)) add("ZERO_PAYROLL", "Folha zerada", reason ? "ATENCAO" : "CRITICO", `Total de proventos igual a zero.${reason ? ` ${reason}` : " Nenhuma justificativa encontrada nos dados disponíveis."}`);
      if (zero(liquid)) add("ZERO_LIQUID", "Líquido zerado", reason ? "ATENCAO" : "CRITICO", `Líquido igual a zero. Conferir proventos e descontos.${reason ? ` ${reason}` : ""}`);
      if ((liquid !== null && liquid < 0) || (gross !== null && deductions !== null && deductions > gross)) add("NEGATIVE_LIQUID", "Líquido negativo / descontos excedentes", "CRITICO", "Líquido negativo ou descontos maiores que os proventos. Conferir os eventos financeiros.");
      const deductionRatio = deductionsPercentage(now);
      if (deductionRatio !== null && deductionRatio > deductionLimit) add("HIGH_DEDUCTIONS", "Descontos elevados sobre o bruto", "ATENCAO", `Descontos de ${deductions!.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} representam ${deductionRatio.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% dos proventos de ${gross!.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}, acima do alerta configurado em ${deductionLimit}%. Conferir composição, adiantamentos e demais descontos. É um critério de revisão, não um limite legal.`);
      if (gross !== null && deductions !== null && liquid !== null && Math.abs(cents(gross - deductions - liquid)) > 0.02) add("TOTAL_MISMATCH", "Totais não conciliados", "ATENCAO", "Proventos menos descontos não correspondem ao líquido informado. Conferir composição e arredondamento.");
      if ((data?.occurrences.length ?? 0) > 1 || duplicateCpfs.has(key)) add("DUPLICATE", "Possível duplicidade", "ATENCAO", (data?.occurrences.length ?? 0) > 1 ? `CPF encontrado em ${data!.occurrences.length} linhas. Os valores foram somados conforme a importação existente. Conferir se são pagamentos complementares ou duplicados.` : "Matrícula ou identificador compartilhado com outro CPF na mesma empresa. Conferir cadastro.");
      const termination = data?.terminationDate ?? employee?.terminationDate;
      const normalPayroll = !/RESCISAO|FERIAS|13|DECIMO/.test(normalizeHeader(data?.payrollType ?? "")) && !(eventTotal(data, "termination") ?? 0);
      if (termination && termination < dates.start && normalPayroll && ((gross ?? liquid ?? 0) > 0)) add("TERMINATED_PAID", "Pagamento após desligamento", "CRITICO", `Desligamento anterior à competência (${termination}). Há pagamento sem indicação de rescisão, férias ou 13º. Conferir natureza da folha.`);
      if (currentValue !== null && previousValue !== null && largeChange(currentValue, previousValue, rules)) add("VARIATION", "Variação líquida elevada", "ATENCAO", `Líquido de ${current.competence} comparado a ${previous!.competence}: diferença supera simultaneamente R$ ${rules.absolute.toFixed(2)} e ${rules.percentage}% sobre a referência. O valor pode ser legítimo; conferir eventos.`);
      if (base !== null && prior?.baseSalary !== null && prior?.baseSalary !== undefined && changed(base, prior.baseSalary)) add("BASE_CHANGE", "Alteração de salário-base", "ATENCAO", "O salário-base mudou entre competências, independentemente de horas extras, comissão e outros eventos.");
      if (data && prior) {
        const oldEvents = new Map(prior.events.map(event => [event.key, event]));
        const newEvents = new Map(data.events.map(event => [event.key, event]));
        for (const eventKey of new Set([...oldEvents.keys(), ...newEvents.keys()])) {
          const a = newEvents.get(eventKey); const b = oldEvents.get(eventKey);
          // An absent column is unknown, not zero. Only compare events present in both imports.
          if (a && b && largeChange(a.value, b.value, rules)) add(`EVENT:${eventKey}`, `${a.kind === "deduction" ? "Desconto" : "Provento"} fora do padrão: ${a.label}`, "ATENCAO", "Evento supera os limites de variação percentual e absoluta em relação à competência anterior.");
        }
        for (const [field, label] of [["company", "empresa"], ["unit", "unidade"], ["costCenter", "centro de custo"], ["department", "setor"], ["jobTitle", "cargo"]] as const) {
          if (data[field] && prior[field] && normalizeHeader(data[field]) !== normalizeHeader(prior[field])) add(`CHANGE:${field}`, `Mudança de ${label}`, "INFORMACAO", `${prior[field]} → ${data[field]}. Confirmar movimentação cadastral.`);
        }
      }
      if (data) {
        // Also handles older imports that recorded an empty optional base as invalid.
        const invalidFields = data.invalidFields.filter(field => !isBaseSalaryField(field));
        if (invalidFields.length) add("INVALID_DATA", "Dados vazios ou inválidos", "ATENCAO", `Sem valor numérico confiável: ${invalidFields.join(", ")}. Não foram considerados zero na auditoria.`);
        const hasAllocation = Boolean(data.company || data.unit || data.costCenter);
        if (hasAllocation && (!data.company || !data.unit || !data.costCenter)) add("ALLOCATION_MISSING", "Lotação incompleta", "INFORMACAO", "Empresa, unidade ou centro de custo não foram informados na planilha. Conferir lotação.");
        const vacationDays = vacationMap.get(key) ?? 0;
        const vacationPaid = eventTotal(data, "vacation");
        if (vacationDays > 0 && vacationPaid !== null && vacationPaid <= 0) add("VACATION_UNPAID", "Férias sem evento de pagamento", "ATENCAO", `${vacationDays} dia(s) de férias na base de benefícios, mas o evento de férias da folha está zerado. Conferir recibo separado.`);
        if ((vacationPaid ?? 0) > 0) add("VACATION_REVIEW", vacationDays > 0 ? "Pagamento de férias identificado" : "Férias sem registro na base consultada", "INFORMACAO", vacationDays > 0 ? "Férias e pagamento identificados. Conferir recibo, período e pagamentos em folha separada." : "Há pagamento de férias, mas nenhum período consta na base de benefícios consultada. O cadastro pode estar incompleto ou o recibo ser separado; conferir sem presumir erro.");
        if ((eventTotal(data, "thirteenth") ?? 0) > 0) add("THIRTEENTH_REVIEW", "13º salário identificado", "INFORMACAO", "Conferir parcela, meses elegíveis e proporcionalidade. O sistema não possui calendário de parcelas para atestar o valor devido.");
        if ((eventTotal(data, "termination") ?? 0) > 0 && !termination) add("TERMINATION_DATE_MISSING", "Rescisão sem data de desligamento", "ATENCAO", "Há evento de rescisão, mas a data de desligamento não está disponível no cadastro ou na folha.");
      }
    }
    const meta = data ?? prior;
    rows.push({ key, cpf: key, name: now?.name ?? before?.name ?? employee?.name ?? "Funcionário", current: now, previous: before, employee,
      currentValue, previousValue, difference, variation, findings, severity: "OK", company: meta?.company ?? "", unit: meta?.unit || employee?.externalUnitName || "",
      costCenter: meta?.costCenter ?? "", department: meta?.department || employee?.department || "", jobTitle: meta?.jobTitle || employee?.jobTitle || "", registration: meta?.registration || employee?.registration || "", employeeStatus: employee?.status ?? "NAO_LOCALIZADO", liquidComparisons: [] });
  }
  // Compare peers once per job/company. This is a flag, not an assertion of salary error.
  const peers = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const base = auditValue(row.current, "baseSalary");
    if (!row.jobTitle || base === null || base <= 0) continue;
    const group = `${normalizeHeader(row.company)}:${normalizeHeader(row.jobTitle)}`;
    if (!peers.has(group)) peers.set(group, []);
    peers.get(group)!.push(row);
  }
  for (const group of peers.values()) {
    if (group.length < 5) continue;
    const sorted = group.map(row => auditValue(row.current, "baseSalary")!).sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    for (const row of group) if (Math.abs(auditValue(row.current, "baseSalary")! - median) > rules.absolute && Math.abs(auditValue(row.current, "baseSalary")! - median) / median > 0.5) row.findings.push({ code: "JOB_OUTLIER", label: "Salário-base discrepante no cargo", severity: "ATENCAO", explanation: "Diferença superior a 50% da mediana de pelo menos cinco pessoas do mesmo cargo/empresa. Jornada, nível e tempo de serviço podem explicar a variação." });
  }
  for (const row of rows) row.severity = row.findings.reduce<AuditSeverity>((severity, finding) => rank[finding.severity] > rank[severity] ? finding.severity : severity, "OK");
  rows.sort((a, b) => rank[b.severity] - rank[a.severity] || a.name.localeCompare(b.name, "pt-BR"));
  return { rows, summary: summarizeAudit(rows, Boolean(previous)), coverage: [
    { label: "Salário-base (opcional)", available: current.records.filter(record => auditValue(record, "baseSalary") !== null).length, total: current.records.length, note: "A ausência não gera alerta. Quando disponível, permite verificações complementares; o foco padrão é o líquido." },
    { label: "Bruto e descontos", available: current.records.filter(record => record.audit?.gross !== null && record.audit?.gross !== undefined && record.audit.deductions !== null).length, total: current.records.length, note: "Necessários para conferir composição do líquido. Descontos elevados usam o bruto positivo da própria folha; sem esses totais a proporção não é calculada." },
    { label: "Eventos", available: current.records.filter(record => record.audit?.events.length).length, total: current.records.length, note: "Colunas financeiras reconhecidas de proventos e descontos." },
    { label: "Férias", available: vacationMap.size, total: current.records.length, note: "Cruza somente os CPFs com férias disponíveis na base de benefícios. Recibos separados não são importados." },
    { label: "13º e rescisão", available: current.records.filter(record => (eventTotal(record.audit, "thirteenth") ?? 0) !== 0 || (eventTotal(record.audit, "termination") ?? 0) !== 0).length, total: current.records.length, note: "Sinaliza eventos e datas disponíveis. Parcela/proporcionalidade e verbas de rescisão exigem os respectivos recibos/calendários." },
  ] };
}

export function comparePayrollHistory(current: ActivePayroll, history: ActivePayroll[], employees: Employee[], rules: AuditRules = defaultAuditRules, vacations: VacationEvidence[] = []): AuditResult {
  const window = comparisonCompetences(current.competence);
  const references = [...new Map(history.filter(month => window.includes(month.competence)).map(month => [month.competence, month])).values()].sort((a, b) => competenceIndex(b.competence) - competenceIndex(a.competence));
  // The closest available month remains the reference for new/missing employees
  // and headline totals; older months only add explicit net-pay comparisons.
  const result = comparePayrolls(current, references[0] ?? null, employees, rules, vacations);
  const maps = references.map(month => ({ competence: month.competence, records: new Map(month.records.map(record => [record.cpf, record])) }));
  for (const row of result.rows) {
    row.liquidComparisons = maps.map((month, index) => {
      const value = auditValue(month.records.get(row.cpf) ?? null, "liquid");
      const difference = row.currentValue !== null && value !== null ? cents(row.currentValue - value) : null;
      const variation = difference !== null && value !== null && Math.abs(value) >= 0.005 ? difference / Math.abs(value) * 100 : null;
      if (index > 0 && row.currentValue !== null && value !== null && largeChange(row.currentValue, value, rules)) row.findings.push({ code: `VARIATION:${month.competence}`, label: `Variação líquida elevada · ${month.competence}`, severity: "ATENCAO", explanation: `Líquido de ${current.competence} comparado a ${month.competence}: diferença supera simultaneamente R$ ${rules.absolute.toFixed(2)} e ${rules.percentage}%. A comparação é individual por mês; não utiliza média nem bruto/salário-base.` });
      return { competence: month.competence, value, difference, variation };
    });
    row.severity = row.findings.reduce<AuditSeverity>((severity, finding) => rank[finding.severity] > rank[severity] ? finding.severity : severity, "OK");
  }
  result.rows.sort((a, b) => rank[b.severity] - rank[a.severity] || a.name.localeCompare(b.name, "pt-BR"));
  result.summary = summarizeAudit(result.rows, Boolean(references.length));
  return result;
}

export function summarizeAudit(rows: AuditRow[], hasPrevious: boolean): AuditSummary {
  const currentRows = rows.filter(row => row.current);
  const previousRows = rows.filter(row => row.previous);
  const currentKnown = currentRows.filter(row => row.currentValue !== null).length;
  const previousKnown = previousRows.filter(row => row.previousValue !== null).length;
  const currentTotal = currentKnown === currentRows.length && currentRows.length ? cents(currentRows.reduce((sum, row) => sum + row.currentValue!, 0)) : null;
  const previousTotal = hasPrevious && previousKnown === previousRows.length && previousRows.length ? cents(previousRows.reduce((sum, row) => sum + row.previousValue!, 0)) : null;
  const difference = currentTotal !== null && previousTotal !== null ? cents(currentTotal - previousTotal) : null;
  const count = (metric: AuditMetric) => rows.filter(row => matchesAuditMetric(row, metric)).length;
  return { total: rows.length, processed: count("processed"), ok: count("ok"), attention: count("attention"),
    critical: count("critical"), information: count("information"),
    currentTotal, previousTotal, difference, variation: difference !== null && previousTotal !== null && Math.abs(previousTotal) >= 0.005 ? difference / Math.abs(previousTotal) * 100 : null,
    zeroPayroll: count("zeroPayroll"), zeroLiquid: count("zeroLiquid"), negativeLiquid: count("negativeLiquid"), newEmployees: count("newEmployees"), missing: count("missing"), duplicates: count("duplicates"), currentKnown, previousKnown,
    activeZeroLiquid: count("activeZeroLiquid"), unmatchedEmployees: count("unmatchedEmployees"), highDeductions: count("highDeductions") };
}

export function detailEvents(row: AuditRow) {
  const events = new Map<string, { key: string; label: string; previous: number | null; current: number | null }>();
  for (const [key, label] of [["baseSalary", "Salário-base"], ["gross", "Total de proventos"], ["deductions", "Total de descontos"], ["liquid", "Líquido"]] as const) events.set(key, { key, label, previous: key === "deductions" ? row.previous?.audit?.deductions ?? null : auditValue(row.previous, key), current: key === "deductions" ? row.current?.audit?.deductions ?? null : auditValue(row.current, key) });
  for (const [period, record] of [["previous", row.previous], ["current", row.current]] as const) for (const event of record?.audit?.events ?? []) {
    const item = events.get(event.key) ?? { key: event.key, label: event.label, previous: null, current: null };
    item[period] = event.value; events.set(event.key, item);
  }
  return [...events.values()].map(event => ({ ...event, difference: event.previous !== null && event.current !== null ? cents(event.current - event.previous) : null }));
}
