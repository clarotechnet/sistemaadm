import type { ActivePayroll, ParsedWorkbook, PayrollRecord } from "../../types";
import { normalizeCpf } from "../../utils/cpf";
import { parseMoney } from "../../utils/money";
import { detectColumns } from "../../services/excel";

export function processPayroll(workbook: ParsedWorkbook, competence: string, importedBy: string): ActivePayroll {
  const recordsByCpf = new Map<string, PayrollRecord>();
  const logs = ["Lendo arquivo...", `${workbook.sheets.length} aba(s) com cabeçalho reconhecido.`];
  let healthColumnCount = 0;
  let dentalColumnCount = 0;
  for (const sheet of workbook.sheets) {
    const cpfIndex = detectColumns(sheet.headers, ["CPF"])[0];
    const nameIndex = detectColumns(sheet.headers, ["NOME", "COLABORADOR", "NOME COLABORADOR", "FUNCIONARIO"])[0];
    const liquidIndex = detectColumns(sheet.headers, ["LIQUIDO", "VALOR LIQUIDO", "LIQUIDO PAGAR"])[0];
    const healthIndexes = detectColumns(sheet.headers, ["PLANO DE SAUDE", "PLANO SAUDE", "ASSISTENCIA MEDICA"], { all: true, containsAll: ["PLANO", "SAUDE"] });
    const dentalIndexes = detectColumns(sheet.headers, ["PLANO ODONTOLOGICO", "PLANO ODONTO", "ODONTOLOGICO"], { all: true, containsAll: ["PLANO", "ODONTO"] });
    if (cpfIndex === undefined || nameIndex === undefined) {
      logs.push(`Aba ${sheet.name}: ignorada por não possuir CPF e Nome/Colaborador.`);
      continue;
    }
    healthColumnCount += healthIndexes.length;
    dentalColumnCount += dentalIndexes.length;
    logs.push(`Aba ${sheet.name}: CPF na coluna ${cpfIndex + 1}; ${healthIndexes.length} coluna(s) de saúde; ${dentalIndexes.length} coluna(s) odontológica(s).`);
    for (const row of sheet.rows) {
      const cpf = normalizeCpf(row[cpfIndex]);
      const name = String(row[nameIndex] ?? "").trim();
      if (!cpf || !name) continue;
      const current = recordsByCpf.get(cpf) ?? { cpf, name, liquid: 0, healthTotal: 0, dentalTotal: 0, healthColumns: 0, dentalColumns: 0, sourceSheet: sheet.name };
      current.liquid += liquidIndex === undefined ? 0 : parseMoney(row[liquidIndex]);
      current.healthTotal += healthIndexes.reduce((sum, index) => sum + parseMoney(row[index]), 0);
      current.dentalTotal += dentalIndexes.reduce((sum, index) => sum + parseMoney(row[index]), 0);
      current.healthColumns = Math.max(current.healthColumns, healthIndexes.length);
      current.dentalColumns = Math.max(current.dentalColumns, dentalIndexes.length);
      recordsByCpf.set(cpf, current);
    }
  }
  const records = [...recordsByCpf.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (!records.length) throw new Error("Nenhum colaborador com CPF e nome foi encontrado na Folha de Pagamento.");
  logs.push(`${records.length} CPF(s) encontrado(s).`, `${healthColumnCount} coluna(s) de Plano de Saúde detectada(s).`, `${dentalColumnCount} coluna(s) de Plano Odontológico detectada(s).`, "Processamento concluído.");
  return { id: crypto.randomUUID(), fileName: workbook.fileName, fileSize: workbook.fileSize, competence, importedAt: new Date().toISOString(), importedBy, records, logs };
}
