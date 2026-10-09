import type { ParsedSheet, PayrollAuditData, PayrollAuditEvent } from "../../types";
import { normalizeHeader } from "../../utils/text";
import { parseMoney } from "../../utils/money";

const financialAliases = {
  baseSalary: ["SALARIO BASE", "SALARIO CONTRATUAL", "SALARIO MENSAL", "SALARIO", "SAL BASE"],
  gross: ["TOTAL PROVENTOS", "TOTAL DE PROVENTOS", "TOTAL VENCIMENTOS", "TOTAL DE VENCIMENTOS", "REMUNERACAO BRUTA", "SALARIO BRUTO", "BRUTO", "TOTAL BRUTO"],
  deductions: ["TOTAL DESCONTOS", "TOTAL DE DESCONTOS", "DESCONTOS TOTAL"],
  liquid: ["LIQUIDO", "VALOR LIQUIDO", "LIQUIDO PAGAR", "LIQUIDO A PAGAR", "TOTAL LIQUIDO", "SALARIO LIQUIDO"],
};
export function isBaseSalaryField(label: string) {
  return column([normalizeHeader(label)], financialAliases.baseSalary) >= 0;
}
const textAliases = {
  company: ["EMPRESA", "RAZAO SOCIAL"], unit: ["FILIAL", "UNIDADE", "ESTABELECIMENTO"],
  costCenter: ["CENTRO DE CUSTO", "CENTRO CUSTO", "CCUSTO"], department: ["DEPARTAMENTO", "SETOR", "LOTACAO"],
  jobTitle: ["CARGO", "FUNCAO"], registration: ["MATRICULA", "REGISTRO"], internalId: ["ID FUNCIONARIO", "CODIGO FUNCIONARIO", "COD FUNCIONARIO"],
  employmentStatus: ["SITUACAO", "STATUS FUNCIONARIO", "STATUS", "SITUACAO FUNCIONAL"],
  admissionDate: ["DATA ADMISSAO", "DATA DE ADMISSAO", "ADMISSAO"], terminationDate: ["DATA DESLIGAMENTO", "DATA DE DESLIGAMENTO", "DATA DEMISSAO", "DEMISSAO"],
  payrollType: ["TIPO FOLHA", "TIPO DE FOLHA", "TIPO PAGAMENTO"],
};

// Exact headers take precedence; a partial "SALARIO" must not select "SALARIO LIQUIDO".
function column(headers: string[], aliases: string[], preferLast = false) {
  const exact = aliases.map(alias => preferLast ? headers.lastIndexOf(alias) : headers.indexOf(alias)).find(index => index >= 0);
  if (exact !== undefined) return exact;
  // A numbered salary event (especially "13 Salário") is not contractual base salary.
  const matches = (header: string) => aliases.some(alias => alias !== "SALARIO" && header.replace(/^\d+\s*[-.]?\s*/, "") === alias);
  return preferLast ? headers.findLastIndex(matches) : headers.findIndex(matches);
}

// Use one selector in both payroll views. The final, explicitly named totals
// take precedence over components, and repeated total headers use the last one.
export function payrollFinancialColumn(headers: string[], field: keyof typeof financialAliases) {
  return column(headers.map(normalizeHeader), financialAliases[field], true);
}

export function auditMoney(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const text = String(value).trim();
  if (!/^(?:R\$\s*)?\(?-?\s*\d[\d.,\s]*\)?(?:\s*R\$)?$/i.test(text)) return null;
  return Math.round(parseMoney(text) * 100) / 100;
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const parts = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(iso + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

const categories: Array<[string, PayrollAuditEvent["kind"], RegExp]> = [
  ["overtime", "earning", /HORA[S]? EXTRA|\bH EX\b|\bHE (50|60|70|100)/],
  ["commission", "earning", /COMISSAO|COMISSOES/],
  ["bonus", "earning", /BONUS|PREMIO|GRATIFICAC/],
  ["additional", "earning", /ADICIONAL NOTURNO|PERICULOSIDADE|INSALUBRIDADE/],
  ["vacation", "earning", /FERIAS/],
  ["thirteenth", "earning", /(?:^13$|\b13O? (?:SALARIO|SAL|PARCELA|ADIANTAMENTO|PROPORCIONAL)\b|\b(?:PRIMEIRA|SEGUNDA|[12]) PARCELA 13\b|DECIMO TERCEIRO)/],
  ["termination", "earning", /RESCISAO|AVISO PREVIO|INDENIZAC/],
  ["inss", "deduction", /\bINSS\b/], ["irrf", "deduction", /\bIRRF\b|IMPOSTO DE RENDA/],
  ["absence", "deduction", /FALTAS|ATRASOS/], ["transport", "deduction", /VALE TRANSPORTE/],
  ["health", "deduction", /PLANO.*SAUDE|ASSISTENCIA MEDICA|CONVENIO MEDICO/],
  ["dental", "deduction", /ODONTO/], ["loan", "deduction", /EMPRESTIMO|CONSIGNADO/],
  ["pension", "deduction", /PENSAO/], ["advance", "deduction", /ADIANTAMENTO/],
  ["benefit", "earning", /VALE ALIMENTACAO|VALE REFEICAO|AUXILIO ALIMENTACAO|BENEFICIO/],
];

const deductionCategories = categories.filter(([, kind]) => kind === "deduction");
const earningCategories = categories.filter(([, kind]) => kind === "earning");
export function classifyPayrollEvent(label: string): Pick<PayrollAuditEvent, "kind" | "category"> | null {
  const header = normalizeHeader(label);
  if (/\bBASE\b|REFERENCIA|QUANTIDADE|\bQTD\b|ALIQUOTA|PERCENTUAL/.test(header)) return null;
  // Taxes, advances and other deductions are not earnings merely because
  // their labels also mention férias, rescisão or 13º salário.
  const deduction = deductionCategories.find(([, , pattern]) => pattern.test(header));
  if (deduction) return { kind: "deduction", category: deduction[0] };
  if (/DESCONTO|\bDESC\b/.test(header)) return { kind: "deduction", category: "other" };
  const earning = earningCategories.find(([, , pattern]) => pattern.test(header));
  if (earning) return { kind: "earning", category: earning[0] };
  return /^(?:\d+\s*[-.]?\s*)?(PROVENTO|VENCIMENTO)\b/.test(header) ? { kind: "earning", category: "other" } : null;
}

export function normalizePayrollAuditEvents(data: PayrollAuditData): PayrollAuditData {
  return { ...data, events: data.events.map(event => ({ ...event, ...(classifyPayrollEvent(event.label) ?? {}) })) };
}

export function createAuditReader(sheet: ParsedSheet) {
  const headers = sheet.headers.map(normalizeHeader);
  const finances = (Object.keys(financialAliases) as Array<keyof typeof financialAliases>).map(key => [key, payrollFinancialColumn(sheet.headers, key)] as const);
  const texts = Object.entries(textAliases).map(([key, aliases]) => [key, column(headers, aliases)] as const);
  const used = new Set([...finances, ...texts].map(([, index]) => index));
  const events = headers.flatMap((header, index) => {
    if (used.has(index)) return [];
    const classification = classifyPayrollEvent(header);
    return classification ? [{ index, key: header, label: sheet.headers[index], ...classification }] : [];
  });
  return (row: unknown[], rowIndex: number): PayrollAuditData => {
    const data: PayrollAuditData = {
      version: 1, baseSalary: null, gross: null, deductions: null, liquid: null,
      company: "", unit: "", costCenter: "", department: "", jobTitle: "", registration: "", internalId: "",
      employmentStatus: "", admissionDate: null, terminationDate: null, payrollType: "",
      events: [], occurrences: [{ sheet: sheet.name, row: sheet.headerRow + rowIndex + 2 }], invalidFields: [],
    };
    for (const [key, index] of finances) {
      const value = index < 0 ? undefined : row[index];
      const parsed = auditMoney(value);
      data[key as keyof typeof financialAliases] = parsed;
      // Contractual base is optional; an empty optional column is not an import error.
      if (index >= 0 && parsed === null && (key !== "baseSalary" || String(value ?? "").trim())) data.invalidFields.push(sheet.headers[index]);
    }
    for (const [key, index] of texts) {
      const value = index < 0 ? "" : row[index];
      if (key === "admissionDate" || key === "terminationDate") data[key] = isoDate(value);
      else data[key as Exclude<keyof typeof textAliases, "admissionDate" | "terminationDate">] = String(value ?? "").trim();
    }
    for (const event of events) {
      const value = auditMoney(row[event.index]);
      if (value !== null) {
        const existing = data.events.find(item => item.key === event.key);
        if (existing) existing.value = Math.round((existing.value + value) * 100) / 100;
        else data.events.push({ key: event.key, label: event.label, kind: event.kind, category: event.category, value });
      }
      else if (String(row[event.index] ?? "").trim()) data.invalidFields.push(event.label);
    }
    return data;
  };
}

export function mergeAuditData(previous: PayrollAuditData, next: PayrollAuditData): PayrollAuditData {
  const sum = (a: number | null, b: number | null) => a === null || b === null ? null : Math.round((a + b) * 100) / 100;
  const events = new Map(previous.events.map(event => [event.key, { ...event }]));
  for (const event of next.events) {
    const old = events.get(event.key);
    events.set(event.key, { ...event, value: Math.round(((old?.value ?? 0) + event.value) * 100) / 100 });
  }
  return {
    ...previous, gross: sum(previous.gross, next.gross), deductions: sum(previous.deductions, next.deductions), liquid: sum(previous.liquid, next.liquid),
    events: [...events.values()], occurrences: [...previous.occurrences, ...next.occurrences],
    invalidFields: [...new Set([...previous.invalidFields, ...next.invalidFields])],
  };
}
