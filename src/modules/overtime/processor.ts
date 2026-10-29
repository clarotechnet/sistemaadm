import JSZip from "jszip";
import type { ParsedWorkbook } from "../../types";
import { detectColumns } from "../../services/excel";
import { normalizeText, nameSimilarity } from "../../utils/text";
import { extractPdfText, addOvertimeBox } from "../../services/pdf";
import { uniqueArchiveName } from "../../services/pdf-core";
import { downloadFile } from "../../utils/download";
import {formatOvertimeHours,overtimeColumns} from "./common";
export {formatOvertimeHours} from "./common";

export type OvertimeRecord = { name:string; hours:Record<string,string> };
export type OvertimeMatch = { id:string; file:File; pdfName:string; excelName:string|null; hours:Record<string,string>; matchType:"EXATA"|"APROXIMADA"|"NÃO LOCALIZADO"; similarity:number; approved:boolean;identification:"TEXTO_PDF"|"NOME_ARQUIVO" };

export function parseOvertimeWorkbook(workbook:ParsedWorkbook):{records:OvertimeRecord[];columns:string[]}{
  const records:OvertimeRecord[]=[];const columns=new Set<string>();
  for(const sheet of workbook.sheets){const nameIndex=detectColumns(sheet.headers,["COLABORADOR","NOME","FUNCIONARIO"])[0];if(nameIndex===undefined)continue;const hourIndexes=overtimeColumns(sheet.headers).filter(column=>column.kind==="hours").map(column=>({alias:`H EX ${column.rate}%`,index:column.index}));hourIndexes.forEach(item=>columns.add(item.alias));for(const row of sheet.rows){const name=String(row[nameIndex]??"").trim();const normalizedName=normalizeText(name);if(!name||["COLABORADOR","NOME","FUNCIONARIO"].includes(normalizedName))continue;const hours:Record<string,string>=Object.fromEntries(hourIndexes.map(({alias,index})=>[alias,formatOvertimeHours(row[index])]));records.push({name,hours});}}
  const names=new Set<string>();for(const record of records){const normalized=normalizeText(record.name);if(names.has(normalized))throw new Error(`Nome repetido na planilha: ${record.name}. Corrija a ambiguidade antes de associar horas aos PDFs.`);names.add(normalized);}if(!records.length)throw new Error("Nenhuma coluna COLABORADOR/NOME foi encontrada no Excel.");if(!columns.size)throw new Error("O Excel não possui nenhuma coluna H. EX com percentual reconhecido (por exemplo, 50%, 60%, 70% ou 100%).");return{records,columns:[...columns]};
}

const containsName=(text:string,name:string)=>(" "+text+" ").includes(" "+normalizeText(name)+" ");

export function identifyOvertimeName(text:string,fileName:string,records:OvertimeRecord[]):{name:string;fromText:boolean}{
  const normalizedText=normalizeText(text);const exactContained=records.filter(record=>containsName(normalizedText,record.name)).sort((a,b)=>b.name.length-a.name.length)[0];if(exactContained)return{name:exactContained.name,fromText:true};
  const labelMatch=text.match(/(?:COLABORADOR|FUNCION[AÁ]RIO|EMPREGADO|NOME)\s*[:-]?\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]{5,60})/i);if(labelMatch)return{name:labelMatch[1].replace(/\s{2,}.*/,"").trim(),fromText:true};
  return{name:fileName.replace(/\.pdf$/i,"").replace(/[_-]+/g," ").replace(/\b(?:espelho|ponto|folha)\b/gi,"").trim(),fromText:false};
}

export async function matchOvertimePdfs(files:File[],records:OvertimeRecord[]):Promise<OvertimeMatch[]>{
  const matches:OvertimeMatch[]=[];for(const file of files){const extracted=await extractPdfText(file);const identified=identifyOvertimeName(extracted.pages.join(" "),file.name,records),pdfName=identified.name;const normalized=normalizeText(pdfName);const exact=records.find(record=>normalizeText(record.name)===normalized);const fromText=identified.fromText;let best=exact??records[0];let similarity=exact?100:0;if(!exact){for(const record of records){const score=nameSimilarity(pdfName,record.name);if(score>similarity){similarity=score;best=record;}}}const located=Boolean(exact)||similarity>=72;matches.push({id:crypto.randomUUID(),file,pdfName,excelName:located?best.name:null,hours:located?best.hours:{},matchType:exact&&fromText?"EXATA":located?"APROXIMADA":"NÃO LOCALIZADO",similarity:located?similarity:0,approved:Boolean(exact&&fromText),identification:fromText?"TEXTO_PDF":"NOME_ARQUIVO"});}return matches;
}

export async function generateOvertimeOutputs(matches:OvertimeMatch[]){const valid=matches.filter(match=>match.excelName&&(match.matchType==="EXATA"||match.approved));if(!valid.length)throw new Error("Nenhuma correspondência aprovada está pronta para gerar PDFs.");const zip=new JSZip(),usedNames=new Set<string>();const report=["PDF,Colaborador PDF,Colaborador Excel,Tipo,Similaridade,Horas inseridas"];
  for(const match of valid){const lines=Object.entries(match.hours).map(([label,value])=>`${label.replace("H EX","H. EX")}: ${value}`);zip.file(uniqueArchiveName(`${match.file.name.replace(/\.pdf$/i,"")}_horas_extras.pdf`,usedNames),await addOvertimeBox(match.file,lines));report.push([match.file.name,match.pdfName,match.excelName,match.matchType,`${match.similarity.toFixed(1)}%`,lines.join(" | ")].map(value=>`"${String(value).replaceAll('"','""')}"`).join(","));}
  zip.file("relatorio_horas_extras.csv","\uFEFF"+report.join("\r\n"));downloadFile(await zip.generateAsync({type:"blob"}),"Horas_Extras_PDFs.zip");return valid.length;
}
