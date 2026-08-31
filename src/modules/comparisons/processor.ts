import type { ActivePayroll, ComparisonRow, ComparisonStatus, ParsedWorkbook, ProcessingSummary, ReferenceRecord } from "../../types";
import { detectColumns } from "../../services/excel";
import { normalizeCpf } from "../../utils/cpf";
import { compareValues, parseMoney } from "../../utils/money";

export type ComparisonKind = "health" | "dental";

export function parseReference(workbook: ParsedWorkbook, kind: ComparisonKind): ReferenceRecord[] {
  const byCpf = new Map<string, ReferenceRecord>();
  for (const sheet of workbook.sheets) {
    const cpfIndex = detectColumns(sheet.headers, ["CPF"])[0];
    const nameIndex = detectColumns(sheet.headers, ["NOME", "COLABORADOR", "FUNCIONARIO"])[0];
    const priority = kind === "health" ? ["FOLHA", "PLANO DE SAUDE", "PLANO SAUDE", "VALOR FOLHA", "VALOR"] : ["FOLHA", "PLANO ODONTOLOGICO", "PLANO ODONTO", "VALOR FOLHA", "VALOR"];
    let valueIndex: number | undefined;
    for (const alias of priority) {
      const detected = detectColumns(sheet.headers, [alias])[0];
      if (detected !== undefined) { valueIndex = detected; break; }
    }
    if (cpfIndex === undefined || valueIndex === undefined) continue;
    for (const row of sheet.rows) {
      const cpf = normalizeCpf(row[cpfIndex]);
      if (!cpf) continue;
      const current = byCpf.get(cpf);
      byCpf.set(cpf, { cpf, name: String(row[nameIndex ?? -1] ?? current?.name ?? "").trim(), value: (current?.value ?? 0) + parseMoney(row[valueIndex]) });
    }
  }
  if (!byCpf.size) throw new Error("O arquivo de referência precisa conter as colunas CPF e FOLHA/VALOR reconhecíveis.");
  return [...byCpf.values()];
}

export function comparePlan(payroll: ActivePayroll, reference: ReferenceRecord[], kind: ComparisonKind, tolerance: number): { rows: ComparisonRow[]; summary: ProcessingSummary } {
  const payrollMap = new Map(payroll.records.map(record => [record.cpf, record]));
  const referenceMap = new Map(reference.map(record => [record.cpf, record]));
  const cpfs = new Set([...payrollMap.keys(), ...referenceMap.keys()]);
  const rows: ComparisonRow[] = [...cpfs].map(cpf => {
    const payrollRecord = payrollMap.get(cpf);
    const referenceRecord = referenceMap.get(cpf);
    const payrollValue = payrollRecord ? (kind === "health" ? payrollRecord.healthTotal : payrollRecord.dentalTotal) : null;
    const referenceValue = referenceRecord?.value ?? null;
    const difference = payrollValue !== null && referenceValue !== null ? payrollValue - referenceValue : null;
    const status: ComparisonStatus = !payrollRecord ? "NÃO LOCALIZADO NA FOLHA" : !referenceRecord ? "NÃO LOCALIZADO NA REFERÊNCIA" : compareValues(payrollValue!, referenceValue!, tolerance) ? "OK" : "DIVERGENTE";
    return { id: cpf, name: payrollRecord?.name || referenceRecord?.name || "Não informado", cpf, payrollValue, referenceValue, difference, liquid: payrollRecord?.liquid ?? null, columnCount: payrollRecord ? (kind === "health" ? payrollRecord.healthColumns : payrollRecord.dentalColumns) : 0, status };
  }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const summary = rows.reduce<ProcessingSummary>((acc, row) => { acc.total += 1; if (row.status === "OK") acc.ok += 1; else if (row.status === "DIVERGENTE") acc.divergent += 1; else acc.missing += 1; acc.differenceTotal += row.difference ?? 0; return acc; }, { total: 0, ok: 0, divergent: 0, missing: 0, differenceTotal: 0 });
  return { rows, summary };
}
