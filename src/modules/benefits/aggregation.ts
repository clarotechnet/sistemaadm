import type { ParsedWorkbook } from "../../types";
import { normalizeCpf, isValidCpf } from "../../utils/cpf";

export type AggregationImportRecord = {
  sourceLabel: string;
  company: string;
  city: string;
  name: string;
  cpf: string;
  bank: string;
  baseValue: number;
  notes: string;
};

export type AggregationImportResult = {
  records: AggregationImportRecord[];
  warnings: string[];
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parseMoney(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const normalized = text
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitCompanyCity(value: unknown) {
  const label = String(value ?? "").trim();
  const normalized = normalizeHeader(label);
  const company = normalized.startsWith("VNA")
    ? "VNA"
    : normalized.startsWith("RDT")
      ? "RDT"
      : normalized.startsWith("DMV")
        ? "DMV"
        : label.split(/\s+/)[0]?.toUpperCase() ?? "";

  const city = normalized.includes("MOSSOR")
    ? "MOSSORÓ"
    : normalized.includes("FORT")
      ? "FORTALEZA"
      : normalized.includes("REC")
        ? "RECIFE"
        : normalized.includes("NATAL")
          ? "NATAL"
          : "";
  return { label, company, city };
}

function findColumn(headers: string[], aliases: string[]) {
  return headers.findIndex(header => {
    const normalized = normalizeHeader(header);
    return aliases.some(alias => normalized === normalizeHeader(alias));
  });
}

export function parseAggregationWorkbook(workbook: ParsedWorkbook): AggregationImportResult {
  const records: AggregationImportRecord[] = [];
  const warnings = [...workbook.warnings];
  const seen = new Set<string>();

  for (const sheet of workbook.sheets) {

    const companyIndex = findColumn(sheet.headers, ["EMPRESA/CIDADE", "EMPRESA CIDADE", "UNIDADE"]);
    const nameIndex = findColumn(sheet.headers, ["COLABORADOR / DEPENDENTE", "COLABORADOR", "NOME"]);
    const cpfIndex = findColumn(sheet.headers, ["CPF"]);
    const bankIndex = findColumn(sheet.headers, ["BANCO"]);
    const baseIndex = findColumn(sheet.headers, ["R$ BASE", "BASE", "VALOR BASE"]);
    const notesIndex = findColumn(sheet.headers, ["OBSERVAÇÕES", "OBSERVACOES", "OBS"]);

    if (nameIndex < 0 || cpfIndex < 0 || baseIndex < 0) {
      warnings.push(sheet.name + ": cabeçalho de Agregamento não reconhecido.");
      continue;
    }

    for (const row of sheet.rows) {
      const name = String(row[nameIndex] ?? "").trim();
      const cpf = normalizeCpf(row[cpfIndex]);
      if (!name || !cpf) continue;
      if (seen.has(cpf)) {
        warnings.push(sheet.name + ": CPF " + cpf + " repetido; mantida a última ocorrência.");
        const oldIndex = records.findIndex(item => item.cpf === cpf);
        if (oldIndex >= 0) records.splice(oldIndex, 1);
      }

      const unit = splitCompanyCity(companyIndex >= 0 ? row[companyIndex] : "");
      const record: AggregationImportRecord = {
        sourceLabel: unit.label,
        company: unit.company,
        city: unit.city,
        name,
        cpf,
        bank: bankIndex >= 0 ? String(row[bankIndex] ?? "").trim() : "",
        baseValue: Math.max(0, parseMoney(row[baseIndex])),
        notes: notesIndex >= 0 ? String(row[notesIndex] ?? "").trim() : "",
      };
      if (!isValidCpf(cpf)) {
        warnings.push(name + ": CPF " + cpf + " possui dígito verificador inválido; registro mantido para conferência.");
      }
      records.push(record);
      seen.add(cpf);
    }
  }

  if (!records.length) throw new Error("Nenhum registro de Agregamento foi encontrado no arquivo.");
  return { records, warnings };
}
