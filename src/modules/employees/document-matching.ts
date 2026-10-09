import type { Employee } from "../../types";

/** Correspondência por nome completo, nunca por nome parcial. */
export function normalizeDocumentMatchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export type DocumentEmployeeMatch =
  | { status:"matched"; employee:Employee }
  | { status:"ambiguous"; employeeNames:string[] }
  | { status:"unmatched" };

export function matchEmployeeFromFilename(fileName:string, employees:readonly Employee[]):DocumentEmployeeMatch {
  const stem=fileName.replace(/\.[^.]+$/,"");
  const normalized=" "+normalizeDocumentMatchText(stem)+" ";
  const candidates=employees.map(employee=>({
    employee, name:normalizeDocumentMatchText(employee.name),
  })).filter(item=>item.name.length>=5 && normalized.includes(" "+item.name+" "));

  if(!candidates.length)return{status:"unmatched"};
  // Nomes curtos contidos integralmente em nomes completos maiores não geram
  // falso conflito. Nomes independentes no mesmo arquivo geram ambiguidade.
  const maxLength=Math.max(...candidates.map(item=>item.name.length));
  const longest=candidates.filter(item=>item.name.length===maxLength);
  const winner=longest[0];
  const distinct=longest.length===1&&candidates.every(item=>winner.name===item.name||(" "+winner.name+" ").includes(" "+item.name+" "));
  if(distinct)return{status:"matched",employee:winner.employee};
  return {status:"ambiguous",employeeNames:[...new Set(candidates.map(item=>item.employee.name))].sort((a,b)=>a.localeCompare(b,"pt-BR"))};
}
