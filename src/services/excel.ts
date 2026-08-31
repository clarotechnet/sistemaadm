import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import type { ComparisonRow, ParsedSheet, ParsedWorkbook } from "../types";
import { normalizeHeader } from "../utils/text";

const HEADER_HINTS = ["CPF", "NOME", "COLABORADOR", "LIQUIDO", "PLANO", "FOLHA", "VALOR", "COMPETENCIA"];

export async function readExcel(file: File): Promise<ParsedWorkbook> {
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
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RH Control";
  const columns = [
    { header: "Nome", key: "name", width: 34 }, { header: "CPF", key: "cpf", width: 18 },
    { header: `${valueLabel} Folha`, key: "payrollValue", width: 20 }, { header: "Valor Referência", key: "referenceValue", width: 20 },
    { header: "Diferença", key: "difference", width: 18 }, { header: "Líquido", key: "liquid", width: 18 },
    { header: "Qtd. Colunas", key: "columnCount", width: 15 }, { header: "Status", key: "status", width: 34 },
  ];
  const addSheet = (name: string, values: ComparisonRow[]) => {
    const worksheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    worksheet.columns = columns;
    values.forEach(value => worksheet.addRow(value));
    worksheet.autoFilter = { from: "A1", to: "H1" };
    const header = worksheet.getRow(1);
    header.height = 24;
    header.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC91818" } }; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.alignment = { vertical: "middle" }; });
    ["C", "D", "E", "F"].forEach(column => { worksheet.getColumn(column).numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00'; });
    worksheet.eachRow((row, index) => {
      if (index === 1) return;
      const status = String(row.getCell(8).value ?? "");
      const color = status === "OK" ? "FFE7F5EC" : status === "DIVERGENTE" ? "FFFDE8E8" : "FFFFF3D6";
      row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; cell.border = { bottom: { style: "hair", color: { argb: "FFE3E3E3" } } }; });
    });
  };
  addSheet("Comparativo", rows);
  addSheet("Problemas", rows.filter(row => row.status !== "OK"));
  const output = await workbook.xlsx.writeBuffer();
  const { downloadFile } = await import("../utils/download");
  downloadFile(output, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
