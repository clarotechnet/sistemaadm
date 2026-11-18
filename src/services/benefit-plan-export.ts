import type { WorkBook } from "xlsx";
import type { ComparisonKind } from "../modules/comparisons/processor";
import { parsePlanCoparticipation, parsePlanInvoice, planCoparticipationsAtMonth, planMonth, type PlanBaseVersion } from "../modules/benefits/plan-base";
import { formatCpf } from "../utils/cpf";
import { downloadFile } from "../utils/download";

export type PlanBaseExcelOptions = {
  kind: ComparisonKind;
  competence: string;
  records: readonly PlanBaseVersion[];
  versions: readonly PlanBaseVersion[];
  maskCpf: boolean;
  template?: boolean;
};

export const planBaseExcelHeaders = ["NOME", "CPF", "DESC FOLHA", "PLANO", "EMPRESA", "CIDADE", "SETOR", "FATURA", "COPARTICIPACAO", "COMPETENCIA COPARTICIPACAO", "OBS", "SITUACAO", "VIGENCIA", "REVISAO", "ATUALIZADO EM", "ATUALIZADO POR", "ORIGEM"];

export async function createPlanBaseWorkbook(options: PlanBaseExcelOptions): Promise<WorkBook> {
  const XLSX = await import("xlsx");
  const { kind, records, versions, maskCpf, template = false } = options;
  const month = planMonth(options.competence), label = kind === "health" ? "Plano de Saúde" : "Plano Odontológico";
  if (!template && !records.length) throw new Error("Não há cadastros nos filtros selecionados para exportar.");
  if (records.some(row => row.kind !== kind) || new Set(records.map(row => row.cpf)).size !== records.length) throw new Error("Exporte a base mensal com apenas um cadastro por CPF, sem o histórico de versões.");
  const coparts = new Map(planCoparticipationsAtMonth(versions.filter(row => row.kind === kind), month).map(row => [row.cpf, row.metadata.coparticipation]));
  const data = template ? [] : records.map(row => {
    let invoice: number | null, copart: number | null;
    try { invoice = parsePlanInvoice(row.metadata.invoice); copart = parsePlanCoparticipation(coparts.get(row.cpf)); }
    catch { throw new Error(`Confira a fatura e a coparticipação de ${row.name} antes de exportar.`); }
    return [row.name, formatCpf(row.cpf, maskCpf), row.value, row.plan, row.company, row.city, row.department, invoice, copart, month.split("-").reverse().join("/"), row.notes, row.status, row.effectiveFrom.split("-").reverse().join("/"), row.revision, new Date(row.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), row.createdByName, row.source];
  });
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: `${template ? "Modelo de importação" : "Base para conferência da fatura"} · ${label}`, Author: "RH Controle", Company: "TechNET", Subject: `Competência ${month}` };
  const sheet = XLSX.utils.aoa_to_sheet([planBaseExcelHeaders, ...data]);
  sheet["!cols"] = [36, 18, 18, 22, 26, 20, 30, 18, 20, 30, 60, 18, 16, 12, 24, 34, 36].map(wch => ({ wch }));
  sheet["!autofilter"] = { ref: `A1:Q${Math.max(1, data.length + 1)}` };
  for (let row = 2; row <= data.length + 1; row++) {
    if (sheet[`B${row}`]) sheet[`B${row}`].z = "@";
    for (const column of ["C", "H", "I"]) if (sheet[`${column}${row}`]) sheet[`${column}${row}`].z = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "Base");
  const guide = XLSX.utils.aoa_to_sheet([
    ["CAMPO", "COMO PREENCHER"],
    ["RELATÓRIO", `${label} · competência ${month.split("-").reverse().join("/")} · ${template ? "modelo vazio para importação" : `${records.length} cadastro(s) nos filtros selecionados`}`],
    ["NOME", "Obrigatório. Nome completo do funcionário."],
    ["CPF", "Obrigatório. CPF completo, como texto, preservando os zeros à esquerda. É a chave da atualização."],
    ["DESC FOLHA", "Obrigatório. Total esperado do desconto na folha. A conferência compara este campo sem acrescentar FATURA ou COPARTICIPACAO."],
    ["PLANO / EMPRESA / CIDADE / SETOR", "Opcionais. Colunas ausentes preservam os dados do cadastro; células vazias limpam esses campos."],
    ["FATURA", "Opcional. Valor da fatura, apenas para detalhamento e conferência. Não substitui DESC FOLHA."],
    ["COPARTICIPACAO", "Opcional. Valor mensal para detalhamento. Branco significa não informado; zero significa valor explicitamente zerado."],
    ["COMPETENCIA COPARTICIPACAO", "Opcional, em MM/AAAA. Se não informada, usa o mês selecionado na importação. O valor não é repetido automaticamente nos outros meses."],
    ["OBS", "Opcional. Observações, até 2000 caracteres."],
    ["SITUACAO", "Opcional: ATIVO, INATIVO, EXCLUIDO ou PENDENTE. Se não informada, preserva a situação atual; cadastros novos começam ativos."],
    ["VIGENCIA / REVISAO / ATUALIZADO EM / ATUALIZADO POR / ORIGEM", "Colunas informativas da exportação. A vigência da nova versão é escolhida na tela antes de confirmar a importação."],
    ["REAJUSTE UNIMED", "Na Base de dados, filtre o plano Unimed e exporte os cadastros. Altere DESC FOLHA e/ou FATURA conforme o reajuste, mantenha NOME e CPF e importe o arquivo na vigência desejada. Você também pode preencher este modelo vazio."],
    ["HISTÓRICO", "A importação cria novas versões e mantém os registros antigos. Pessoas ausentes no arquivo não são excluídas ou desativadas. A conferência usa a base mais recente para qualquer folha."],
    ...(maskCpf && !template ? [["CPF MASCARADO", "Este relatório respeita a máscara de CPF da configuração. Para reimportar, a coluna CPF precisa conter os números completos."]] : []),
  ]);
  guide["!cols"] = [{ wch: 48 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, guide, "Como importar");
  return workbook;
}

export async function exportPlanBaseExcel(options: PlanBaseExcelOptions) {
  const workbook = await createPlanBaseWorkbook(options), XLSX = await import("xlsx");
  const label = options.kind === "health" ? "Plano_de_Saude" : "Plano_Odontologico";
  const filename = options.template ? `Modelo_Base_${label}.xlsx` : `Base_${label}_${planMonth(options.competence)}.xlsx`;
  downloadFile(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }), filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
