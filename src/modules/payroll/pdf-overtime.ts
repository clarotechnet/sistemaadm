import type {PayrollAuditEvent} from "../../types";
import {overtimeRate} from "../overtime/common";

// Only the supported PDF overtime-reference column uses H,MM as hours/minutes.
// Never apply this convention to money, percentages, DSR or Excel numeric cells.
export function pdfOvertimeDuration(raw:string):{minutes:number|null}|null{
  const match=raw.trim().match(/^(\d{1,3}(?:\.\d{3})+|\d+)[:,](\d{2})$/);
  if(!match)return null;
  const hours=Number(match[1].replaceAll(".","")),minute=Number(match[2]),minutes=hours*60+minute;
  return{minutes:minute<60&&Number.isSafeInteger(minutes)?minutes:null};
}

export function normalizePdfOvertimeEvent(event:PayrollAuditEvent):PayrollAuditEvent{
  const rate=overtimeRate(event.label);
  if(event.origin!=="PDF"||event.kind!=="earning"||event.category!=="overtime"||!rate||!event.references)return event;
  return{...event,references:event.references.map(reference=>{
    if(reference.unit!=="quantity"&&reference.unit!=="hours")return reference;
    const duration=pdfOvertimeDuration(reference.raw);if(!duration)return reference;
    const normalized={...reference,unit:"hours" as const,rate:Number(rate)};
    if(duration.minutes===null)delete normalized.minutes;else normalized.minutes=duration.minutes;
    return normalized;
  })};
}

export function pdfOvertimeIssues(event:PayrollAuditEvent):string[]{
  if(event.origin!=="PDF"||event.kind!=="earning"||event.category!=="overtime"||!overtimeRate(event.label))return[];
  return(event.references??[]).flatMap(reference=>{
    if(reference.unit!=="hours"&&reference.unit!=="quantity")return[];
    const duration=pdfOvertimeDuration(reference.raw);
    return duration&&duration.minutes===null?[`Referência de horas extras inválida no PDF: ${reference.raw}${reference.page?` (página ${reference.page})`:""}. Os minutos devem estar entre 00 e 59; solicite correção ao RH.`]:[];
  });
}
