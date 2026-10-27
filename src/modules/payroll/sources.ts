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
  return fileName.replace(/\.(?:pdf|xls|xlsx)$/i, "").trim().slice(0, 120) || "Folha";
}

export function normalizeSourceLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export async function payrollFileHash(file: File) {
  const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// Format-independent fingerprint: the same CPFs and net payments must not be
// added twice just because an Excel export and its PDF have different bytes.
export function payrollPaymentSignature(records:PayrollRecord[]) {
  const payments=new Map<string,number>();
  for(const record of records){
    if(!Number.isFinite(record.liquid))throw new Error("Há um líquido inválido na folha. Revise o arquivo antes de importar.");
    payments.set(record.cpf,(payments.get(record.cpf)??0)+Math.round(record.liquid*100));
  }
  return JSON.stringify([...payments].sort(([a],[b])=>a.localeCompare(b)));
}

export function assertDistinctPayrollPayments(existing:Array<{id:string;label:string;records:PayrollRecord[]}>,incoming:Array<{sourceId?:string;label:string;payroll:{records:PayrollRecord[]}}>){
  const replaced=new Set(incoming.flatMap(source=>source.sourceId?[source.sourceId]:[]));
  const signatures=new Map<string,string>();
  for(const source of existing)if(!replaced.has(source.id))signatures.set(payrollPaymentSignature(source.records),source.label);
  for(const source of incoming){
    const signature=payrollPaymentSignature(source.payroll.records),duplicate=signatures.get(signature);
    if(duplicate)throw new Error(`Possível folha duplicada: ${source.label} tem os mesmos CPFs e líquidos de ${duplicate}. Este arquivo já foi importado nesta competência ou repete outro do lote. PDF e Excel da mesma folha são alternativas: escolha atualizar a folha existente, não adicionar os dois.`);
    signatures.set(signature,source.label);
  }
}
