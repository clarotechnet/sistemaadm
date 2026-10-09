import { deductionsPercentage, type AuditReview, type AuditRow } from "../modules/payroll/audit";
import { formatCpf } from "../utils/cpf";
import { downloadFile } from "../utils/download";
import { formatMoney } from "../utils/money";

export const severityLabels = { OK: "OK", ATENCAO: "Atenção", CRITICO: "Crítico", INFORMACAO: "Informação" };
export const reviewLabels = { PENDENTE: "Pendente", EM_ANALISE: "Em análise", JUSTIFICADA: "Justificada", CORRIGIDA: "Corrigida", IGNORADA: "Ignorada" };
const headers = ["Colaborador", "CPF", "Empresa", "Unidade", "Centro de custo", "Setor", "Cargo", "Líquido anterior", "Líquido atual", "Diferença", "Variação %", "Classificação", "Achados", "Tratamento", "Situação cadastral atual", "Origem cadastro", "Última sincronização QuarkRH", "Descontos / bruto %", "Comparações individuais do líquido (até 3 meses anteriores)"];
function liquidComparisons(row: AuditRow) {
  return row.liquidComparisons.map(month => `${month.competence}: líquido ${formatMoney(month.value)}, diferença ${formatMoney(month.difference)}, variação ${month.variation === null ? "—" : month.variation.toFixed(2) + "%"}`).join(" | ");
}
function exportRows(rows: AuditRow[], maskCpf: boolean, reviews: AuditReview[]) {
  const reviewMap = new Map(reviews.map(review => [`${review.employeeKey}:${review.ruleCode}`, review]));
  return rows.map(row => {
    const ratio = deductionsPercentage(row.current);
    return [row.name, formatCpf(row.cpf, maskCpf), row.company, row.unit, row.costCenter, row.department, row.jobTitle, row.previousValue, row.currentValue, row.difference, row.variation === null ? null : row.variation / 100, severityLabels[row.severity], row.findings.map(finding => finding.label).join("; "), row.findings.map(finding => `${finding.label}: ${reviewLabels[reviewMap.get(`${row.key}:${finding.code}`)?.status ?? "PENDENTE"]}`).join("; "), row.employeeStatus === "NAO_LOCALIZADO" ? "Não localizado" : row.employeeStatus === "ATIVO" ? "Ativo" : "Desligado", row.employee?.source === "QUARK" ? "QuarkRH" : row.employee ? "Manual" : "", row.employee?.source === "QUARK" ? row.employee.lastSyncedAt ?? "" : "", ratio === null ? null : ratio / 100, liquidComparisons(row)];
  });
}
function safeSpreadsheetText(value: unknown) {
  return typeof value === "string" && /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
}
export async function exportPayrollAudit(rows: AuditRow[], maskCpf: boolean, reviews: AuditReview[], title: string, kind: "xlsx" | "csv" | "pdf") {
  if (!rows.length) throw new Error("Não há registros nos filtros atuais para exportar.");
  const name = `Conferencia_${title.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const data = exportRows(rows, maskCpf, reviews);
  if (kind === "csv") {
    const csvData = data.map(row => row.map((value, index) => (index === 10 || index === 17) && typeof value === "number" ? value * 100 : value));
    const csv = [headers, ...csvData].map(row => row.map(value => `"${String(safeSpreadsheetText(value) ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    downloadFile(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), name + ".csv");
    return;
  }
  if (kind === "xlsx") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    workbook.Props = { Author: "RH Controle", Title: title };
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    sheet["!cols"] = headers.map((_, index) => ({ wch: index === 18 ? 85 : [0, 12, 13].includes(index) ? 45 : 22 }));
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: headers.length - 1 } }) };
    for (let row = 2; row <= data.length + 1; row++) {
      for (const col of ["H", "I", "J"]) if (sheet[col + row]) sheet[col + row].z = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      if (sheet["K" + row]) sheet["K" + row].z = "0.00%";
      if (sheet["R" + row]) sheet["R" + row].z = "0.00%";
    }
    XLSX.utils.book_append_sheet(workbook, sheet, "Conferência");
    downloadFile(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }), name + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return;
  }
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  // Standard fonts cannot encode arbitrary Unicode found in names/source headers.
  const text = (value: string) => [...value.replace(/[→—–]/g, "-")].filter(char => { try { font.encodeText(char); return true; } catch { return false; } }).join("");
  const wrap = (value: string, width: number, size: number) => {
    const words = text(value).split(/\s+/); const lines: string[] = []; let line = "";
    for (const word of words) {
      if (font.widthOfTextAtSize(`${line} ${word}`, size) > width && line) { lines.push(line); line = word; }
      else line = `${line} ${word}`.trim();
    }
    if (line) lines.push(line);
    return lines;
  };
  let page = document.addPage([842, 595]); let y = 550; let pageNumber = 1;
  const startPage = () => {
    page.drawText(text(`Conferência de folha - ${title}`), { x: 30, y: 565, size: 14, font: bold });
    page.drawText(text(`${rows.length} registros nos filtros selecionados. Comparativo sempre do líquido. Página ${pageNumber}.`), { x: 30, y: 548, size: 9, font });
    y = 525;
  };
  startPage();
  for (const row of rows) {
    const lines = wrap([liquidComparisons(row), row.findings.map(finding => `${finding.label}: ${finding.explanation}`).join(" | ") || "Nenhum achado nas regras disponíveis."].filter(Boolean).join(" | "), 775, 8);
    const height = 56 + lines.length * 11;
    if (y - height < 30) { page = document.addPage([842, 595]); pageNumber++; startPage(); }
    page.drawText(text(`${row.name} - ${formatCpf(row.cpf, maskCpf)} - ${severityLabels[row.severity]} - Cadastro atual: ${row.employeeStatus === "NAO_LOCALIZADO" ? "não localizado" : row.employeeStatus.toLowerCase()}`), { x: 30, y, size: 10, font: bold });
    y -= 16;
    page.drawText(text(`Anterior: ${formatMoney(row.previousValue)}  Atual: ${formatMoney(row.currentValue)}  Diferença: ${formatMoney(row.difference)}`), { x: 30, y, size: 9, font });
    y -= 14;
    const ratio = deductionsPercentage(row.current);
    page.drawText(text(`Descontos: ${formatMoney(row.current?.audit?.deductions ?? null)}  Bruto: ${formatMoney(row.current?.audit?.gross ?? null)}  Descontos/bruto: ${ratio === null ? "-" : ratio.toFixed(2) + "%"}`), { x: 30, y, size: 9, font });
    y -= 14;
    for (const line of lines) { page.drawText(line, { x: 30, y, size: 8, font, color: rgb(0.25, 0.25, 0.25) }); y -= 11; }
    y -= 12;
  }
  downloadFile(await document.save(), name + ".pdf", "application/pdf");
}
