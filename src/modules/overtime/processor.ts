import JSZip from "jszip";
import type { ParsedWorkbook } from "../../types";
import { detectColumns } from "../../services/excel";
import { normalizeText, nameSimilarity } from "../../utils/text";
import { extractPdfText, addOvertimeBox } from "../../services/pdf";
import { downloadFile } from "../../utils/download";

export type OvertimeRecord = { name:string; hours:Record<string,string> };
export type OvertimeMatch = { id:string; file:File; pdfName:string; excelName:string|null; hours:Record<string,string>; matchType:"EXATA"|"APROXIMADA"|"NÃO LOCALIZADO"; similarity:number; approved:boolean };
const hourAliases=["H EX 50%","H EX 60%","H EX 70%","H EX 100%"];

export function parseOvertimeWorkbook(workbook:ParsedWorkbook):{records:OvertimeRecord[];columns:string[]}{
  const records:OvertimeRecord[]=[];const columns=new Set<string>();
  for(const sheet of workbook.sheets){const nameIndex=detectColumns(sheet.headers,["COLABORADOR","NOME","FUNCIONARIO"])[0];if(nameIndex===undefined)continue;const hourIndexes=hourAliases.flatMap(alias=>{const index=detectColumns(sheet.headers,[alias])[0];return index===undefined?[]:[{alias,index}]});hourIndexes.forEach(item=>columns.add(item.alias));for(const row of sheet.rows){const name=String(row[nameIndex]??"").trim();if(!name)continue;const hours:Object=Object.fromEntries(hourIndexes.map(({alias,index})=>[alias,formatHours(row[index])]));records.push({name,hours:hours as Record<string,string>});}}
  if(!records.length)throw new Error("Nenhuma coluna COLABORADOR/NOME foi encontrada no Excel.");if(!columns.size)throw new Error("O Excel não possui nenhuma coluna de horas extras reconhecida (50%, 60%, 70% ou 100%).");return{records,columns:[...columns]};
}

function formatHours(value:unknown):string{if(value instanceof Date)return `${String(value.getUTCHours()).padStart(2,"0")}:${String(value.getUTCMinutes()).padStart(2,"0")}`;if(typeof value==="number"){const total=Math.round(value*24*60);return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;}const text=String(value??"00:00").trim();return text||"00:00";}

function findPdfName(text:string,fileName:string,records:OvertimeRecord[]):string{
  const normalizedText=normalizeText(text);const exactContained=records.filter(record=>normalizedText.includes(normalizeText(record.name))).sort((a,b)=>b.name.length-a.name.length)[0];if(exactContained)return exactContained.name;
  const labelMatch=text.match(/(?:COLABORADOR|FUNCION[AÁ]RIO|EMPREGADO|NOME)\s*[:\-]?\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]{5,60})/i);if(labelMatch)return labelMatch[1].replace(/\s{2,}.*/,"").trim();
  return fileName.replace(/\.pdf$/i,"").replace(/[_-]+/g," ").replace(/\b(?:espelho|ponto|folha)\b/gi,"").trim();
}

export async function matchOvertimePdfs(files:File[],records:OvertimeRecord[]):Promise<OvertimeMatch[]>{
  const matches:OvertimeMatch[]=[];for(const file of files){const extracted=await extractPdfText(file);const pdfName=findPdfName(extracted.pages.join(" "),file.name,records);const normalized=normalizeText(pdfName);const exact=records.find(record=>normalizeText(record.name)===normalized);let best=exact??records[0];let similarity=exact?100:0;if(!exact){for(const record of records){const score=nameSimilarity(pdfName,record.name);if(score>similarity){similarity=score;best=record;}}}const located=Boolean(exact)||similarity>=72;matches.push({id:crypto.randomUUID(),file,pdfName,excelName:located?best.name:null,hours:located?best.hours:{},matchType:exact?"EXATA":located?"APROXIMADA":"NÃO LOCALIZADO",similarity:located?similarity:0,approved:Boolean(exact)});}return matches;
}

export async function generateOvertimeOutputs(matches:OvertimeMatch[]){const valid=matches.filter(match=>match.excelName&&(match.matchType==="EXATA"||match.approved));if(!valid.length)throw new Error("Nenhuma correspondência aprovada está pronta para gerar PDFs.");const zip=new JSZip();const report=["PDF,Colaborador PDF,Colaborador Excel,Tipo,Similaridade,Horas inseridas"];
  for(const match of valid){const lines=Object.entries(match.hours).map(([label,value])=>`${label.replace("H EX","H. EX")}: ${value}`);zip.file(`${match.file.name.replace(/\.pdf$/i,"")}_horas_extras.pdf`,await addOvertimeBox(match.file,lines));report.push([match.file.name,match.pdfName,match.excelName,match.matchType,`${match.similarity.toFixed(1)}%`,lines.join(" | ")].map(value=>`"${String(value).replaceAll('"','""')}"`).join(","));}
  zip.file("relatorio_horas_extras.csv","\uFEFF"+report.join("\r\n"));downloadFile(await zip.generateAsync({type:"blob"}),"Horas_Extras_PDFs.zip");return valid.length;
}
