import type { PayrollRecord } from "../../types";
import { mergeAuditData } from "./audit-fields";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Every consumer sees the same consolidated month. A CPF present in two source
// files is summed, but both occurrences remain visible to the audit rules.
export function consolidatePayrollRecords(records: PayrollRecord[]): PayrollRecord[] {
  const grouped = new Map<string, PayrollRecord>();
  for (const record of records) {
    const copy = structuredClone(record), previous = grouped.get(copy.cpf);
    if (!previous) { grouped.set(copy.cpf, copy); continue; }
    previous.liquid = money(previous.liquid + copy.liquid);
    previous.healthTotal = money(previous.healthTotal + copy.healthTotal);
    previous.dentalTotal = money(previous.dentalTotal + copy.dentalTotal);
    previous.healthColumns = Math.max(previous.healthColumns, copy.healthColumns);
    previous.dentalColumns = Math.max(previous.dentalColumns, copy.dentalColumns);
    previous.sourceSheet = [...new Set([previous.sourceSheet, copy.sourceSheet].filter(Boolean))].join(" | ");
    // Do not invent complete financial details when one source is legacy.
    previous.audit = previous.audit && copy.audit ? mergeAuditData(previous.audit, copy.audit) : undefined;
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function sourceLabel(fileName: string) {
  return fileName.replace(/\.(?:xls|xlsx)$/i, "").trim().slice(0, 120) || "Folha";
}

export function normalizeSourceLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export async function payrollFileHash(file: File) {
  const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
