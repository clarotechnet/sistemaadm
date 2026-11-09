import { mealGroupLabels, type MealRow } from "../../supabase/functions/_shared/meal-domain";
import type { MealRun } from "./benefit-meal";
import { formatCpf } from "../utils/cpf";
import { downloadFile } from "../utils/download";

const dateLabel = (value: string) => value.split("-").reverse().join("/");
const monthLabel = (value: string) => value.slice(0, 7).split("-").reverse().join("/");
const timeLabel = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Não concluída";
const pending = "Pendente: dias previstos de trabalho e valores diários ainda não informados pelo RH.";
const headers = ["Funcionário", "CPF", "Setor / Equipe", "Cargo", "Faltas (dias)", "Atestados (dias)", "Dias para desconto", "Dias previstos", "Dias a pagar", "Valor diário (R$)", "Valor a receber (R$)", "Empresa / Unidade", "Cidade", "Situação", "Grupo", "Consulta até", "Observações"];
const xml = (value: unknown) => Array.from(String(value ?? "")).filter(char => char.charCodeAt(0) >= 32 || [9, 10, 13].includes(char.charCodeAt(0))).join("").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const cellName = (column: number, row: number) => {
  let value = column + 1, name = "";
  while (value) { name = String.fromCharCode(65 + (value - 1) % 26) + name; value = Math.floor((value - 1) / 26); }
  return name + row;
};
const textCell = (ref: string, value: unknown, style: number) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
const numericCell = (ref: string, value: number | null, style: number) => value === null ? `<c r="${ref}" s="${style}"/>` : `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
const excelDate = (value: string) => (Date.parse(value + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000;
export type MealReport = { run: MealRun; rows: MealRow[]; maskCpf: boolean; logo: Uint8Array; filters: string };

export async function buildMealReportXlsx(report: MealReport): Promise<Uint8Array> {
  const { run, rows, maskCpf, logo, filters } = report;
  if (!rows.length || !logo.length) throw new Error("O relatório precisa de funcionários e logotipo.");
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip(), ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/workbook.xml", `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Vale Alimentação" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'Vale Alimentação'!$10:$10</definedName></definedNames></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  const fonts = '<fonts count="4"><font><sz val="10"/><name val="Arial"/><color rgb="FF222222"/></font><font><b/><sz val="10"/><name val="Arial"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="16"/><name val="Arial"/><color rgb="FF991B1B"/></font><font><sz val="10"/><name val="Arial"/><color rgb="FF805900"/></font></fonts>';
  const fills = '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF991B1B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF7E0"/><bgColor indexed="64"/></patternFill></fill></fills>';
  const style = (font = 0, fill = 0, num = 0, align = "left", wrap = true) => `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" horizontal="${align}" wrapText="${wrap ? 1 : 0}"/></xf>`;
  zip.file("xl/styles.xml", `<styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>${fonts}${fills}<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9">${style()}${style(1, 2, 0, "center")}${style(2)}${style(0, 0, 0, "left", false)}${style()}${style(0, 0, 1, "right")}${style(0, 0, 164, "right")}${style(0, 0, 165, "right")}${style(3, 3)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  const company = [...new Set(rows.map(row => row.company))].join("; ");
  const body = [
    '<row r="1" ht="12" customHeight="1"/>',
    `<row r="2" ht="24" customHeight="1">${textCell("B2", "TechNET - Vale Alimentação", 2)}</row>`,
    `<row r="3" ht="22" customHeight="1">${textCell("B3", company, 3)}</row>`,
    `<row r="4" ht="22" customHeight="1">${textCell("B4", `Benefício: ${monthLabel(run.benefit_month)} | Ocorrências: ${dateLabel(run.period_start)} a ${dateLabel(run.period_end)}`, 3)}</row>`,
    `<row r="6" ht="22" customHeight="1">${textCell("A6", `Consulta: ${timeLabel(run.completed_at)} por ${run.triggered_by_name}. Dados até ${dateLabel(run.queried_through)}. Versão ${run.id}.`, 3)}</row>`,
    `<row r="7" ht="22" customHeight="1">${textCell("A7", `Filtros: ${filters}. ${rows.length} funcionário(s). Situação: ${run.status === "PARTIAL" ? "Consulta parcial" : "Consulta concluída"}.`, 3)}</row>`,
    `<row r="8" ht="28" customHeight="1">${textCell("A8", pending + " " + run.warnings.join(" "), 8)}</row>`,
    `<row r="10" ht="32" customHeight="1">${headers.map((header, column) => textCell(cellName(column, 10), header, 1)).join("")}</row>`,
  ];
  rows.forEach((row, index) => {
    const position = index + 11;
    const values = [row.employee_name, formatCpf(row.cpf, maskCpf) || "CPF não informado", row.department, row.job_title, row.absence_days, row.medical_days, row.deduction_days, null, null, null, null, row.company, row.city, row.employment_status, mealGroupLabels[row.rate_group] ?? row.rate_group, excelDate(run.queried_through), [pending, ...row.issues].join(" ")];
    body.push(`<row r="${position}" ht="42" customHeight="1">${values.map((value, column) => {
      const ref = cellName(column, position);
      if (column >= 4 && column <= 10) return numericCell(ref, value as number | null, column >= 9 ? 6 : 5);
      if (column === 15) return numericCell(ref, value as number, 7);
      return textCell(ref, value, column === 16 ? 8 : 4);
    }).join("")}</row>`);
  });
  const widths = [38, 18, 31, 31, 13, 15, 17, 15, 15, 17, 20, 38, 18, 16, 29, 17, 80];
  zip.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:Q${rows.length + 10}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="2" ySplit="10" topLeftCell="C11" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${body.join("")}</sheetData><autoFilter ref="A10:Q${rows.length + 10}"/><mergeCells count="6">${["B2:Q2", "B3:Q3", "B4:Q4", "A6:Q6", "A7:Q7", "A8:Q8"].map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/><drawing r:id="rId1"/></worksheet>`);
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
  zip.file("xl/drawings/drawing1.xml", '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from><xdr:ext cx="571500" cy="571500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logotipo TechNET"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="571500" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>');
  zip.file("xl/drawings/_rels/drawing1.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>');
  zip.file("xl/media/logo.png", logo);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function buildMealReportPdf(report: MealReport): Promise<Blob> {
  const { run, rows, maskCpf, logo, filters } = report;
  if (!rows.length || !logo.length) throw new Error("O relatório precisa de funcionários e logotipo.");
  const [pdfModule, fontModule] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  const pdfmake = pdfModule.default; pdfmake.addVirtualFileSystem(fontModule.default);
  let binary = ""; for (const byte of logo) binary += String.fromCharCode(byte);
  const logoUrl = "data:image/png;base64," + btoa(binary);
  const grouped = new Map<string, MealRow[]>();
  for (const row of rows) { const list = grouped.get(row.company) ?? []; list.push(row); grouped.set(row.company, list); }
  const content: unknown[] = [{ text: pending, color: "#805900", fillColor: "#fff7e0", margin: [0, 0, 0, 10] }, { text: `Filtros: ${filters}. ${rows.length} funcionário(s).`, fontSize: 8, margin: [0, 0, 0, 8] }];
  if (run.warnings.length) content.push({ text: run.warnings.join(" "), color: "#805900", fontSize: 8, margin: [0, 0, 0, 8] });
  for (const [company, people] of grouped) {
    const tableHeaders = ["Funcionário", "CPF", "Setor / Equipe", "Cargo", "Faltas", "Atestados", "Dias para desconto", "Dias previstos", "Valor a receber"];
    const body: unknown[][] = [[{ text: company, colSpan: 9, bold: true, color: "#991b1b", fillColor: "#f7eeee" }, {}, {}, {}, {}, {}, {}, {}, {}], tableHeaders.map(text => ({ text, color: "#ffffff", fillColor: "#991b1b", bold: true, fontSize: 8 }))];
    for (const person of people) body.push([
      { stack: [{ text: person.employee_name, bold: true }, { text: `${person.employment_status} - ${person.city} - ${mealGroupLabels[person.rate_group] ?? person.rate_group}`, fontSize: 7, color: "#666666" }, ...(person.issues.length ? [{ text: person.issues.join(" "), fontSize: 7, color: "#805900" }] : [])] },
      formatCpf(person.cpf, maskCpf) || "Não informado", person.department || "-", person.job_title || "-",
      person.absence_days === null ? "Não consultado" : String(person.absence_days), person.medical_days === null ? "Não consultado" : String(person.medical_days),
      person.deduction_days === null ? "Pendente" : String(person.deduction_days), "A definir", { text: "Pendente", color: "#805900" },
    ]);
    content.push({ table: { headerRows: 2, dontBreakRows: true, widths: ["*", 75, 85, 85, 32, 38, 45, 45, 66], body }, layout: { hLineWidth: (index: number) => index < 3 ? 0.6 : 0.3, vLineWidth: () => 0, hLineColor: () => "#dddddd", paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5 }, margin: [0, 0, 0, 14] });
  }
  return pdfmake.createPdf({ pageSize: "A4", pageOrientation: "landscape", pageMargins: [28, 105, 28, 34], defaultStyle: { font: "Roboto", fontSize: 8, lineHeight: 1.15 }, info: { title: "Vale Alimentação " + monthLabel(run.benefit_month), author: "RH Controle - TechNET", subject: "Consulta de ocorrências, com valores e dias previstos pendentes" },
    header: () => ({ margin: [28, 20, 28, 0], columns: [{ image: logoUrl, width: 42 }, { width: "*", stack: [{ text: "TechNET - Vale Alimentação", fontSize: 16, bold: true, color: "#991b1b" }, { text: `Benefício: ${monthLabel(run.benefit_month)}. Ocorrências: ${dateLabel(run.period_start)} a ${dateLabel(run.period_end)}.`, fontSize: 10 }, { text: `Consulta em ${timeLabel(run.completed_at)} por ${run.triggered_by_name}. Dados até ${dateLabel(run.queried_through)}.`, fontSize: 8 }, { text: `${run.status === "PARTIAL" ? "Consulta parcial" : "Consulta concluída"}. Versão: ${run.id}`, fontSize: 7, color: "#666666" }] }], columnGap: 12 }),
    footer: (page: number, total: number) => ({ margin: [28, 10, 28, 0], columns: [{ text: "RH Controle - Dados de funcionários. Valores de pagamento ainda não calculados.", fontSize: 7 }, { text: `Página ${page} de ${total}`, alignment: "right", fontSize: 8 }] }), content,
  }).getBlob();
}

export async function exportMealReport(run: MealRun, rows: MealRow[], maskCpf: boolean, kind: "pdf" | "xlsx", filters: string) {
  const response = await fetch("/logo-empresa-ui.png");
  if (!response.ok) throw new Error("Não foi possível carregar o logotipo do relatório.");
  const logo = new Uint8Array(await response.arrayBuffer()), report = { run, rows, maskCpf, logo, filters };
  const filename = `Vale_Alimentacao_${run.benefit_month.slice(0, 7)}_${run.period_start}_${run.period_end}.${kind}`;
  if (kind === "pdf") downloadFile(await buildMealReportPdf(report), filename, "application/pdf");
  else downloadFile(await buildMealReportXlsx(report), filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
