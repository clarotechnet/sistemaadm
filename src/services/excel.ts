import type { ComparisonRow, ParsedSheet, ParsedWorkbook } from "../types";
import { normalizeHeader } from "../utils/text";

const HEADER_HINTS = ["CPF", "NOME", "COLABORADOR", "LIQUIDO", "PLANO", "FOLHA", "VALOR", "COMPETENCIA"];

export async function readExcel(file: File): Promise<ParsedWorkbook> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, codepage: 1252, raw: true });
  const sheets: ParsedSheet[] = [];
  const warnings: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
    const headerRow = findHeaderRow(rows);
    if (headerRow < 0) {
      warnings.push(`A aba "${name}" foi ignorada porque nenhum cabeçalho confiável foi localizado.`);
      continue;
    }
    const headers = (rows[headerRow] ?? []).map(value => String(value ?? "").trim());
    sheets.push({
      name,
      headerRow,
      headers,
      normalizedHeaders: headers.map(normalizeHeader),
      rows: rows.slice(headerRow + 1).filter(row => row.some(value => String(value ?? "").trim() !== "")),
    });
  }
  if (!sheets.length) throw new Error("Nenhuma aba com cabeçalho reconhecível foi encontrada no arquivo.");
  return { fileName: file.name, fileSize: file.size, sheets, warnings };
}

export function findHeaderRow(rows: unknown[][], maxRows = 35): number {
  let best = { row: -1, score: 0 };
  rows.slice(0, maxRows).forEach((row, index) => {
    const headers = row.map(normalizeHeader).filter(Boolean);
    const matches = HEADER_HINTS.filter(hint => headers.some(header => header === hint || header.includes(hint))).length;
    const score = matches * 4 + Math.min(headers.length, 12) * 0.15;
    if (score > best.score && matches >= 2) best = { row: index, score };
  });
  return best.row;
}

export function detectColumns(headers: string[], aliases: string[], options: { all?: boolean; containsAll?: string[] } = {}): number[] {
  const normalizedAliases = aliases.map(normalizeHeader);
  const indexes = headers.flatMap((header, index) => {
    const normalized = normalizeHeader(header);
    const exact = normalizedAliases.includes(normalized);
    const contains = normalizedAliases.some(alias => normalized.includes(alias));
    const containsAll = options.containsAll?.every(term => normalized.includes(normalizeHeader(term))) ?? false;
    return exact || contains || containsAll ? [index] : [];
  });
  return options.all ? indexes : indexes.slice(0, 1);
}

export async function exportComparisonExcel(rows: ComparisonRow[], fileName: string, valueLabel: string) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Author: "RH Control", Company: "TechNET" };
  const headers = ["Nome", "CPF", `${valueLabel} Folha`, "Valor Referência", "Diferença", "Líquido", "Qtd. Colunas", "Status"];
  const addSheet = (name: string, values: ComparisonRow[]) => {
    const data = values.map(value => [value.name, value.cpf, value.payrollValue, value.referenceValue, value.difference, value.liquid, value.columnCount, value.status]);
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    worksheet["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 34 }];
    worksheet["!autofilter"] = { ref: `A1:H${Math.max(1, data.length + 1)}` };
    for (let row = 2; row <= data.length + 1; row += 1) {
      for (const column of ["C", "D", "E", "F"]) {
        const cell = worksheet[`${column}${row}`];
        if (cell) cell.z = 'R$ #,##0.00;[Red]-R$ #,##0.00';
      }
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  };
  addSheet("Comparativo", rows);
  addSheet("Problemas", rows.filter(row => row.status !== "OK"));
  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
  const { downloadFile } = await import("../utils/download");
  downloadFile(output, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
