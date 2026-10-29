import type {ParsedWorkbook,PayrollRecord} from "../../types";
import {detectColumns} from "../../services/excel";
import {auditMoney} from "./audit-fields";
import {formatOvertimeHours,overtimeColumns,overtimeRate} from "../overtime/common";
import {fixLegacyEncoding,nameSimilarity,normalizeText} from "../../utils/text";
import {normalizeCpf} from "../../utils/cpf";
import {normalizePdfOvertimeEvent,pdfOvertimeIssues} from "./pdf-overtime";

export interface OvertimeReferenceValue {minutes:number|null;amount:number|null;raw:string;issues:string[]}
export interface OvertimeReferenceRecord {id:string;name:string;cpf:string|null;sheet:string;row:number;values:Record<string,OvertimeReferenceValue>}
export interface OvertimeReferenceData {version:1;fileName:string;rates:string[];records:OvertimeReferenceRecord[];warnings:string[]}
export interface OvertimeReferenceFile {id:string;label:string;data:OvertimeReferenceData;mappings:Record<string,string>;mappingRevision:string|null;sourceId:string|null;updatedAt:string;updatedBy:string;fileName:string;fileHash:string}
export interface PayrollOvertimePerson {cpf:string;name:string;aliases:string[];hasPdf:boolean;incomplete:boolean;rates:Record<string,{minutes:number|null;amount:number;origins:string[];issues:string[]}>}
export type OvertimeStatus="OK"|"DIVERGENTE"|"INVALIDO"|"REVISAR_NOME"|"NAO_LOCALIZADO"|"SEM_REFERENCIA"|"SEM_DETALHE_PDF";
export const overtimeStatusLabels:Record<OvertimeStatus,string>={OK:"OK",DIVERGENTE:"Divergente",INVALIDO:"Dado inválido",REVISAR_NOME:"Revisar associação",NAO_LOCALIZADO:"Não localizado na folha",SEM_REFERENCIA:"Sem referência",SEM_DETALHE_PDF:"Sem detalhe PDF"};
export interface OvertimeComparisonRow {
  id:string;referenceFileId:string|null;referenceRecordId:string|null;name:string;referenceName:string;cpf:string|null;rate:string;
  expectedMinutes:number|null;paidMinutes:number|null;differenceMinutes:number|null;expectedAmount:number|null;paidAmount:number|null;differenceAmount:number|null;
  rawReference:string;origins:string[];issues:string[];status:OvertimeStatus;match:"CPF"|"NOME_EXATO"|"MANUAL"|"APROXIMADO"|"AMBIGUO"|"SEM_MATCH";suggestedCpf:string|null;similarity:number;
}

export function referenceCompetenceFromName(name:string){
  const match=name.match(/(?:^|[^\d])(0[1-9]|1[0-2])[./-](20\d{2})(?!\d)/);
  return match?`${match[1]}/${match[2]}`:null;
}

export function parseOvertimeReference(workbook:ParsedWorkbook):OvertimeReferenceData {
  const records:OvertimeReferenceRecord[]=[],rates=new Set<string>(),warnings=[...workbook.warnings];
  for(const sheet of workbook.sheets){
    const columns=overtimeColumns(sheet.headers),nameIndex=detectColumns(sheet.headers,["COLABORADOR","NOME","FUNCIONARIO"])[0],cpfIndex=detectColumns(sheet.headers,["CPF"])[0];
    if(nameIndex===undefined||!columns.length){warnings.push(`Aba ${sheet.name} ignorada: requer nome e colunas H. EX com percentual.`);continue;}
    columns.forEach(column=>rates.add(column.rate));
    for(const [index,row] of sheet.rows.entries()){
      const name=fixLegacyEncoding(row[nameIndex]).trim(),normalized=normalizeText(name);
      if(!normalized||/^(?:TOTAL|TOTAIS|SUBTOTAL|COLABORADOR|NOME|FUNCIONARIO)(?:\s|$)/.test(normalized))continue;
      const values:OvertimeReferenceRecord["values"]={};
      for(const rate of new Set(columns.map(column=>column.rate))){
        const hours=columns.filter(c=>c.rate===rate&&c.kind==="hours"),amount=columns.filter(c=>c.rate===rate&&c.kind==="amount");
        const value:OvertimeReferenceValue={minutes:null,amount:null,raw:hours.length===1?String(row[hours[0].index]??""):"",issues:[]};
        if(hours.length>1)value.issues.push(`Mais de uma coluna de horas para ${rate}%; revise o cabeçalho.`);
        else if(hours.length===1){try{const formatted=formatOvertimeHours(row[hours[0].index]),[h,m]=formatted.split(":").map(Number);value.minutes=h*60+m;if(row[hours[0].index] instanceof Date||typeof row[hours[0].index]==="number")value.raw=formatted;}catch(error){value.issues.push(error instanceof Error?error.message:"Hora extra inválida.");}}
        if(amount.length>1)value.issues.push(`Mais de uma coluna monetária para ${rate}%.`);
        else if(amount.length===1){value.amount=auditMoney(row[amount[0].index]);if(value.amount===null&&String(row[amount[0].index]??"").trim())value.issues.push(`Valor monetário inválido para ${rate}%.`);}
        values[rate]=value;
      }
      const cpf=cpfIndex===undefined?null:normalizeCpf(row[cpfIndex])||null;
      records.push({id:`${sheet.name}:${sheet.headerRow+index+2}`,name,cpf,sheet:sheet.name,row:sheet.headerRow+index+2,values});
    }
  }
  if(!records.length||!rates.size)throw new Error("Não foram encontrados colaboradores e colunas de horas extras (H. EX 50%, 60%, 70%, 100% ou outro percentual).");
  const invalid=records.filter(record=>Object.values(record.values).some(value=>value.issues.length)).length;
  if(invalid)warnings.push(`${invalid} colaborador(es) com informação inválida. Os valores originais foram preservados, sem conversão automática.`);
  return{version:1,fileName:workbook.fileName,rates:[...rates].sort((a,b)=>Number(a)-Number(b)),records,warnings};
}

// Read every raw source before grouping by CPF. A legacy/Excel source must not
// erase PDF details, and must not be taken as proof of zero paid hours.
export function payrollOvertimePeople(records:PayrollRecord[]):PayrollOvertimePerson[]{
  const people=new Map<string,PayrollOvertimePerson>();
  for(const record of records){
    const person=people.get(record.cpf)??{cpf:record.cpf,name:record.name,aliases:[],hasPdf:false,incomplete:false,rates:{}};
    if(!person.aliases.includes(normalizeText(record.name)))person.aliases.push(normalizeText(record.name));
    const pdf=record.audit?.source?.format==="PDF"||record.audit?.events.some(event=>event.origin==="PDF");
    person.hasPdf ||= Boolean(pdf);person.incomplete ||= !pdf;
    for(const storedEvent of record.audit?.events??[]){
      const event=normalizePdfOvertimeEvent(storedEvent);
      if(event.kind!=="earning"||event.category!=="overtime")continue;
      const rate=overtimeRate(event.label);if(!rate)continue;
      const existing=person.rates[rate]??{minutes:0,amount:0,origins:[],issues:[]};
      existing.issues.push(...pdfOvertimeIssues(event));
      const refs=event.references?.filter(ref=>ref.unit==="hours");
      const complete=event.origin==="PDF"&&Boolean(refs?.length)&&refs!.every(ref=>Number.isSafeInteger(ref.minutes)&&ref.minutes!>=0);
      existing.minutes=existing.minutes===null||!complete?null:existing.minutes+refs!.reduce((sum,ref)=>sum+ref.minutes!,0);
      existing.amount=Math.round((existing.amount+event.value)*100)/100;
      existing.origins.push(`${record.sourceSheet} · ${event.code??event.label}`);
      person.rates[rate]=existing;
    }
    people.set(record.cpf,person);
  }
  return [...people.values()].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
}

export function compareOvertime(people:PayrollOvertimePerson[],files:OvertimeReferenceFile[],revision:string,toleranceMinutes=0,toleranceMoney=.01):OvertimeComparisonRow[]{
  const rows:OvertimeComparisonRow[]=[],used=new Set<string>();
  const inputs=files.flatMap(file=>file.data.records.map(record=>({file,record,person:null as PayrollOvertimePerson|null,match:"SEM_MATCH" as OvertimeComparisonRow["match"],candidate:null as PayrollOvertimePerson|null,similarity:0,issues:[] as string[]})));
  for(const input of inputs){
    const {file,record}=input,manual=file.mappingRevision===revision?file.mappings[record.id]:undefined;
    if(manual){input.person=people.find(person=>person.cpf===manual)??null;input.match=input.person?"MANUAL":"SEM_MATCH";if(!input.person)input.issues.push("A associação salva não existe nesta folha.");}
    else{
      const exact=record.cpf?people.filter(person=>person.cpf===record.cpf):people.filter(person=>person.aliases.includes(normalizeText(record.name)));
      if(exact.length===1){input.person=exact[0];input.match=record.cpf?"CPF":"NOME_EXATO";input.similarity=100;}
      else if(exact.length>1){input.match="AMBIGUO";input.issues.push("Mais de um CPF com o mesmo nome; escolha o colaborador correto.");}
      else if(!record.cpf){
        const suggestions=people.map(person=>({person,score:nameSimilarity(record.name,person.name)})).sort((a,b)=>b.score-a.score);
        if(suggestions[0]?.score>=72){input.candidate=suggestions[0].person;input.similarity=suggestions[0].score;input.match="APROXIMADO";input.issues.push("Nome aproximado: confirme a associação antes de comparar.");}
      }
    }
  }
  const counts=new Map<string,number>();for(const input of inputs)if(input.person)counts.set(input.person.cpf,(counts.get(input.person.cpf)??0)+1);
  for(const input of inputs){
    const {file,record,person}=input,duplicate=Boolean(person&&(counts.get(person.cpf)??0)>1);
    if(person)used.add(person.cpf);
    const rates=new Set([...Object.keys(record.values),...Object.keys(person?.rates??{})]);
    for(const rate of rates){
      const reference=record.values[rate],paid=person?.rates[rate],issues=[...input.issues,...(reference?.issues??[]),...(paid?.issues??[])];
      if(duplicate)issues.push("Mais de um lançamento de referência associado ao mesmo CPF. Revise as planilhas; não houve soma automática.");
      const pdf=Boolean(person?.hasPdf&&!person.incomplete),paidMinutes=paid?paid.minutes:pdf?0:null,paidAmount=paid?.amount??(pdf?0:null);
      const expectedMinutes=reference?.minutes??null,expectedAmount=reference?.amount??null;
      const differenceMinutes=expectedMinutes!==null&&paidMinutes!==null?paidMinutes-expectedMinutes:null;
      const differenceAmount=expectedAmount!==null&&paidAmount!==null?Math.round((paidAmount-expectedAmount)*100)/100:null;
      let status:OvertimeStatus;
      if(duplicate||input.match==="AMBIGUO"||input.match==="APROXIMADO")status="REVISAR_NOME";
      else if(reference?.issues.length||paid?.issues.length)status="INVALIDO";
      else if(!person)status="NAO_LOCALIZADO";
      else if(!pdf||paid&&paid.minutes===null)status="SEM_DETALHE_PDF";
      else if(!reference||expectedMinutes===null&&expectedAmount===null)status="SEM_REFERENCIA";
      else if(differenceMinutes!==null&&Math.abs(differenceMinutes)>toleranceMinutes||differenceAmount!==null&&Math.abs(differenceAmount)>toleranceMoney+.000001)status="DIVERGENTE";
      else status="OK";
      rows.push({id:`${file.id}:${record.id}:${rate}`,referenceFileId:file.id,referenceRecordId:record.id,name:person?.name??record.name,referenceName:record.name,cpf:person?.cpf??record.cpf,rate,expectedMinutes,paidMinutes,differenceMinutes,expectedAmount,paidAmount,differenceAmount,rawReference:reference?.raw??"",origins:[`${file.label} · ${record.sheet}, linha ${record.row}`,...(paid?.origins??[])],issues,status,match:input.match,suggestedCpf:input.candidate?.cpf??null,similarity:input.similarity});
    }
  }
for(const person of people)if(!used.has(person.cpf))for(const [rate,paid] of Object.entries(person.rates))rows.push({id:`pdf:${person.cpf}:${rate}`,referenceFileId:null,referenceRecordId:null,name:person.name,referenceName:"",cpf:person.cpf,rate,expectedMinutes:null,paidMinutes:paid.minutes,differenceMinutes:null,expectedAmount:null,paidAmount:paid.amount,differenceAmount:null,rawReference:"",origins:paid.origins,issues:paid.issues,status:paid.issues.length?"INVALIDO":person.hasPdf&&!person.incomplete&&paid.minutes!==null?"SEM_REFERENCIA":"SEM_DETALHE_PDF",match:"SEM_MATCH",suggestedCpf:null,similarity:0});
  return rows.sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")||Number(a.rate)-Number(b.rate));
}
