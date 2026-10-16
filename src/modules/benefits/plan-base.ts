import type { ActivePayroll, ParsedWorkbook, ReferenceRecord } from "../../types";
import { isValidCpf, normalizeCpf } from "../../utils/cpf";
import { normalizeHeader } from "../../utils/text";
import { comparePlan, type ComparisonKind } from "../comparisons/processor";

export type PlanBaseStatus = "ATIVO" | "INATIVO" | "EXCLUIDO" | "PENDENTE";
export type PlanBaseInput = {
  cpf: string; name: string; company: string; city: string; department: string; plan: string;
  value: number | null; status: PlanBaseStatus; notes: string; metadata: Record<string, unknown>;
};
export type PlanBaseVersion = PlanBaseInput & {
  id: string; kind: ComparisonKind; effectiveFrom: string; revision: number;
  source: string; createdAt: string; createdByName: string;
};
export type PlanBaseImport = { records: PlanBaseInput[]; issues: string[]; sourceRows: number; valueColumn: string };

export function planMonth(value: string): string {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const match = value.match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  throw new Error("Informe uma competência válida.");
}

export function planBaseAtMonth(versions: readonly PlanBaseVersion[], competence: string): PlanBaseVersion[] {
  const month = planMonth(competence), byCpf = new Map<string, PlanBaseVersion>();
  for (const row of versions) {
    if (row.effectiveFrom.slice(0, 7) > month) continue;
    const key = row.kind+":"+row.cpf, old = byCpf.get(key);
    if (!old || row.effectiveFrom > old.effectiveFrom || (row.effectiveFrom === old.effectiveFrom && row.revision > old.revision)) byCpf.set(key, row);
  }
  return [...byCpf.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Monthly reconciliation uses the most recently saved registration for each CPF,
// regardless of its historical effective month or the selected payroll month.
export function latestPlanBase(versions: readonly PlanBaseVersion[]): PlanBaseVersion[] {
  const byCpf = new Map<string, PlanBaseVersion>();
  for (const row of versions) {
    const key = row.kind+":"+row.cpf, old = byCpf.get(key);
    if (!old || row.revision > old.revision) byCpf.set(key, row);
  }
  return [...byCpf.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function parsePlanValue(value: unknown): number {
  const text = String(value ?? "").trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  const normalized = typeof value === "number" ? value : text.includes(",") && /^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(text)
    ? Number(text.replace(/\./g, "").replace(",", ".")) : /^\d+(\.\d{1,2})?$/.test(text) ? Number(text) : NaN;
  if (!text || !Number.isFinite(normalized) || Number(normalized) < 0 || Number(normalized) > 9999999999.99) throw new Error("Valor de desconto inválido. Informe um valor maior ou igual a zero.");
  return Math.round(Number(normalized) * 100) / 100;
}

export function validatePlanInput(row: PlanBaseInput): PlanBaseInput {
  if (!isValidCpf(row.cpf)) throw new Error("Informe um CPF válido.");
  if (row.name.trim().length < 2) throw new Error("Informe o nome do funcionário.");
  if (!["ATIVO", "INATIVO", "EXCLUIDO", "PENDENTE"].includes(row.status)) throw new Error("Situação inválida.");
  if (row.status !== "PENDENTE" && Array.isArray(row.metadata.sourceConflicts) && row.name === "CPF com dados divergentes") throw new Error("Confirme o nome do funcionário com o RH antes de resolver a pendência.");
  return { ...row, cpf: row.cpf.replace(/\D/g, ""), name: row.name.trim(), value: row.status === "PENDENTE" ? null : parsePlanValue(row.value) };
}

// DESC FOLHA is the employee deduction, not invoice, unit price or monthly fee.
export function parsePlanBase(workbook: ParsedWorkbook, kind: ComparisonKind): PlanBaseImport {
  const groups = new Map<string, PlanBaseInput[]>(), issues: string[] = [];
  let sourceRows = 0, valueColumn = "";
  for (const sheet of workbook.sheets) {
    const headers = sheet.headers.map(normalizeHeader);
    const find = (aliases: string[]) => aliases.map(alias => headers.indexOf(normalizeHeader(alias))).find(index => index >= 0) ?? -1;
    const cpfIndex = find(["CPF"]), nameIndex = find(["NOME", "COLABORADOR", "FUNCIONARIO"]);
    const valueIndex = find(["DESC FOLHA", "DESCONTO FOLHA", "DESCONTO EM FOLHA", "FOLHA", "VALOR FOLHA", "VALOR", kind === "health" ? "PLANO DE SAUDE" : "PLANO ODONTOLOGICO"]);
    if (cpfIndex < 0 || nameIndex < 0 || valueIndex < 0) continue;
    valueColumn = sheet.headers[valueIndex];
    const get = (row: unknown[], aliases: string[]) => String(row[find(aliases)] ?? "").trim();
    for (const [index, row] of sheet.rows.entries()) {
      const rawCpf = String(row[cpfIndex] ?? "").trim();
      if (!rawCpf) continue;
      if (["CPF", "DESCONTO EM FOLHA", "RDT", "DMV", "VNA"].includes(normalizeHeader(rawCpf))) continue;
      sourceRows++;
      try {
        const digits = rawCpf.replace(/\D/g, "");
        if (digits.length > 11 || !/^\d[\d.\-\s]*$/.test(rawCpf)) throw new Error("CPF inválido");
        const record = validatePlanInput({ cpf: normalizeCpf(rawCpf), name: get(row, ["NOME", "COLABORADOR", "FUNCIONARIO"]),
          company: get(row, ["EMPRESA", "EMP"]), city: get(row, ["CIDADE"]), department: get(row, ["CENTRO DE CUSTO", "SETOR"]),
          plan: get(row, ["PLANO", "OPERADORA"]), value: parsePlanValue(row[valueIndex]), status: "ATIVO", notes: "",
          metadata: { sourceSheet: sheet.name, sourceRow: sheet.headerRow + index + 2, valueColumn: sheet.headers[valueIndex],
            lives: row[find(["QT VIDAS", "QTD.", "QUANTIDADE"])] ?? null,
            monthlyFee: row[find(["BASE MENSALIDADE"])] ?? null, invoice: row[find(["FATURA"])] ?? null, coparticipation: row[find(["CO-PART.", "COPARTICIPACAO"])] ?? null } });
        groups.set(record.cpf, [...(groups.get(record.cpf) ?? []), record]);
      } catch (error) { issues.push(`${sheet.name}, linha ${sheet.headerRow + index + 2}: ${error instanceof Error ? error.message : "Dados inválidos"}.`); }
    }
  }
  if (!valueColumn) throw new Error("A base precisa conter NOME, CPF e DESC FOLHA/VALOR. FATURA e VALOR UNI. não substituem o desconto.");
  const records: PlanBaseInput[] = [];
  for (const rows of groups.values()) {
    if (rows.length > 1) {
      const message = `CPF repetido nas linhas ${rows.map(row => row.metadata.sourceRow).join(", ")}. Pendente RH; valores não somados.`;
      issues.push(message);
      records.push({...rows[0],name:"CPF com dados divergentes",value:null,status:"PENDENTE",notes:message,metadata:{sourceConflicts:rows}});
      continue;
    }
    records.push(rows[0]);
  }
  return { records, issues, sourceRows, valueColumn };
}

export function comparePlanBase(payroll: ActivePayroll, versions: readonly PlanBaseVersion[], kind: ComparisonKind, tolerance: number) {
  const base = latestPlanBase(versions.filter(row => row.kind === kind));
  const actual = new Map(payroll.records.map(row => [row.cpf, kind === "health" ? row.healthTotal : row.dentalTotal]));
  const relevant = base.filter(row => row.status === "ATIVO" || row.status === "PENDENTE" || (actual.get(row.cpf) ?? 0) !== 0);
  const cpfs = new Set(relevant.map(row => row.cpf));
  const reference: ReferenceRecord[] = relevant.filter(row=>row.status!=="PENDENTE").map(row => ({ cpf: row.cpf, name: row.name, value: row.status === "ATIVO" ? row.value! : 0 }));
  const scoped = { ...payroll, records: payroll.records.filter(row => cpfs.has(row.cpf) || (kind === "health" ? row.healthTotal : row.dentalTotal) !== 0) };
  return comparePlan(scoped, reference, kind, tolerance);
}
