import {normalizeHeader} from "../../utils/text";

export function overtimeRate(label:string):string|null {
  const text=normalizeHeader(label);
  if(!/\b(?:H EX(?:TRAS?)?|HORAS? EXTRAS?|HE)\b/.test(text))return null;
  const percent=label.match(/(\d+(?:[.,]\d+)?)\s*%/),plain=text.match(/(?:H EX(?:TRAS?)?|HORAS? EXTRAS?|HE)\s+(\d+)$/);
  const value=Number((percent?.[1]??plain?.[1]??"").replace(",","."));
  return value>0&&Number.isFinite(value)?String(value):null;
}

export function overtimeColumns(headers:string[]){
  return headers.flatMap((label,index)=>{
    const rate=overtimeRate(label);if(!rate||/\bBASE\b|REFERENCIA|ALIQUOTA|PERCENTUAL/.test(normalizeHeader(label)))return[];
    const kind:"hours"|"amount"=/\bVALOR\b|\bCUSTO\b|R\$/i.test(label)?"amount":"hours";
    return[{index,rate,label,kind}];
  });
}

export function formatOvertimeHours(value:unknown):string {
  if(value===null||value===undefined||String(value).trim()==="")return "00:00";
  if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw new Error("Horário inválido na planilha.");const minutes=value.getUTCFullYear()<1905?Math.round((value.getTime()-Date.UTC(1899,11,30))/60000):value.getUTCHours()*60+value.getUTCMinutes();if(minutes<0)throw new Error("Duração negativa na planilha.");return `${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;}
  if(typeof value==="number"){if(!Number.isFinite(value)||value<0)throw new Error("Duração inválida na planilha.");return formatOvertimeMinutes(Math.round(value*24*60));}
  const text=String(value).trim(),match=text.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if(!match)throw new Error(`Hora extra inválida: ${text}. Use HH:MM com minutos entre 00 e 59, ou uma duração de Excel.`);
  return `${match[1].padStart(2,"0")}:${match[2]}`;
}

export function formatOvertimeMinutes(minutes:number|null):string {
  if(minutes===null)return "—";
  return `${minutes<0?"-":""}${String(Math.floor(Math.abs(minutes)/60)).padStart(2,"0")}:${String(Math.abs(minutes)%60).padStart(2,"0")}`;
}
