import type {PayrollAuditData,PayrollAuditEvent,PayrollEventReference,PayrollRecord} from "../../types";
import {classifyPayrollEvent} from "./audit-fields";
import {normalizeHeader} from "../../utils/text";
import {overtimeRate} from "../overtime/common";
import {pdfOvertimeDuration,pdfOvertimeIssues} from "./pdf-overtime";

export interface PayrollPdfItem {text:string;x:number;y:number;width:number;height:number}
export interface PayrollPdfPage {number:number;width:number;height:number;items:PayrollPdfItem[]}
type Line={y:number;items:PayrollPdfItem[];text:string};
export interface PayrollPdfResult {
  competence:string;company:string;companyDocument:string;records:PayrollRecord[];warnings:string[];
  totals:{gross:number;deductions:number;liquid:number;health:number;dental:number};
  checks:string[];
}
const moneyPattern="-?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2}";
const cpfPattern=/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/;
const cents=(value:number)=>Math.round(value*100);
const money=(value:string)=>Number(value.replaceAll(".","").replace(",","."));
const display=(value:number)=>value.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fail=(page:number,message:string):never=>{throw new Error(`PDF, página ${page}: ${message} Use o extrato completo neste modelo ou a opção Excel.`);};

// PDF.js strings are not in reading order. Ignore artificial whitespace items
// and reconstruct baselines/columns from positions, scaled to the A4 model.
export function payrollPdfLines(page:PayrollPdfPage):Line[]{
  if(Math.abs(page.width/page.height-595.273/841.886)>.03)fail(page.number,"orientação ou proporção de página não reconhecida.");
  const items=page.items.filter(item=>item.text.trim()).map(item=>({...item,text:item.text.trim(),x:item.x*595.273/page.width,y:item.y*841.886/page.height})).sort((a,b)=>a.y-b.y||a.x-b.x);
  const rows:Array<{y:number;items:PayrollPdfItem[]}>=[];
  for(const item of items){const last=rows.at(-1);if(last&&Math.abs(last.y-item.y)<=2)last.items.push(item);else rows.push({y:item.y,items:[item]});}
  return rows.map(row=>{const sorted=row.items.sort((a,b)=>a.x-b.x);return{...row,items:sorted,text:sorted.map(item=>item.text).join(" ")};});
}
const column=(line:Line,start:number,end:number)=>line.items.filter(item=>item.x>=start&&item.x<end).map(item=>item.text).join(" ").trim();
function valueAfter(line:Line,label:string,end=Infinity):string {
  const index=line.items.findIndex(item=>normalizeHeader(item.text)===normalizeHeader(label));
  if(index<0)return "";
  return line.items.slice(index+1).filter(item=>item.x<end).map(item=>item.text).join(" ").trim();
}
function date(value:string):string|null{
  const m=value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!m)return null;
  const iso=`${m[3]}-${m[2]}-${m[1]}`,parsed=new Date(iso+"T00:00:00Z");
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===iso?iso:null;
}
function reference(raw:string,label:string,page:number):PayrollEventReference{
  const h=raw.match(/^(\d+):(\d{2})$/),rate=label.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if(h){if(Number(h[2])>59)fail(page,"referência de horas inválida.");return{raw,unit:"hours",minutes:Number(h[1])*60+Number(h[2]),...(rate?{rate:Number(rate[1].replace(",","."))}:{}),page};}
  if(overtimeRate(label)){
    const duration=pdfOvertimeDuration(raw);
    if(duration)return{raw,unit:"hours",...(duration.minutes===null?{}:{minutes:duration.minutes}),...(rate?{rate:Number(rate[1].replace(",","."))}:{}),page};
  }
  if(!new RegExp(`^${moneyPattern}$`).test(raw))fail(page,"referência de rubrica não reconhecida.");
  const normalized=normalizeHeader(label);
  return{raw,unit:/PERICULOSIDADE|INSALUBRIDADE|I ?N ?S ?S|I ?R ?R ?F|IMPOSTO DE RENDA|PERCENTUAL/.test(normalized)?"percentage":/PLANO|EMPRESTIMO|CRED.*TRAB/.test(normalized)?"amount":"quantity",...(rate?{rate:Number(rate[1].replace(",","."))}:{}),page};
}
function readEvent(line:Line,side:"left"|"right",page:number):PayrollAuditEvent|null{
  const left=side==="left";
  let labelText=column(line,left?-2:285,left?175:450),rawReference=column(line,left?175:450,left?220:500);
  // PDF.js can join a long loan label with its right-aligned reference.
  // Only detach a terminal numeric reference, never contract-number digits.
  if(!rawReference){const joined=labelText.match(new RegExp(`\\s+(${moneyPattern}|\\d+:\\d{2})$`));if(joined){rawReference=joined[1];labelText=labelText.slice(0,-joined[0].length);}}
  const code=labelText.match(/^(\d+)\s+(.+)$/);if(!code)return null;
  const amountText=column(line,left?220:500,left?282:570),amount=amountText.match(new RegExp(`^(${moneyPattern})\\s*([PD])$`));
  if(!amount)fail(page,`valor/tipo da rubrica ${code[1]} não reconhecido.`);
  if(!rawReference)fail(page,`referência ausente na rubrica ${code[1]}.`);
  return{key:normalizeHeader(labelText),code:code[1],label:code[2],kind:amount![2]==="P"?"earning":"deduction",category:classifyPayrollEvent(code[2])?.category??"other",value:money(amount![1]),origin:"PDF",references:[reference(rawReference,code[2],page)]};
}
function totalLine(line:Line,page:number){
  const get=(label:string,end:number)=>{const raw=valueAfter(line,label,end);if(!new RegExp(`^${moneyPattern}$`).test(raw))fail(page,`total ${label} ausente ou ambíguo.`);return money(raw);};
  return{gross:get("Proventos:",140),deductions:get("Descontos:",240),liquid:get("Líquido:",570)};
}

export function parsePayrollPdf(pages:PayrollPdfPage[]):PayrollPdfResult{
  if(!pages.length)throw new Error("PDF sem páginas. Use um extrato mensal válido.");
  const records:PayrollRecord[]=[],warnings:string[]=[],checks:string[]=[],summaryEvents:PayrollAuditEvent[]=[];
  const identities=new Set<string>(),seenCpfs=new Set<string>(),seenPages=new Set<number>();
  const declared:Partial<Record<"gross"|"deductions"|"liquid",number>>={};
  let company="",companyDocument="",competence="",expectedEmployees:number|null=null,expectedContributors:number|null=null,employeeCount=0,contributorCount=0;
  for(const page of pages){
    if(seenPages.has(page.number))fail(page.number,"página repetida.");seenPages.add(page.number);
    const lines=payrollPdfLines(page),all=lines.map(line=>line.text).join("\n");
    if(!all.trim())fail(page.number,"não há texto extraível; PDF digitalizado exige OCR ou Excel.");
    if(!/EXTRATO MENSAL/i.test(all))fail(page.number,"modelo não reconhecido (esperado Extrato Mensal).");
    const companyRow=lines.find(line=>line.items.some(item=>normalizeHeader(item.text)==="EMPRESA"));
    const companyValue=companyRow?valueAfter(companyRow,"Empresa:",450):"";
    const cnpj=all.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0];
    const monthRow=lines.find(line=>line.items.some(item=>normalizeHeader(item.text)==="COMPETENCIA"));
    const month=monthRow?valueAfter(monthRow,"Competência:",450):"";
    if(!companyValue||!cnpj||!month.match(/^(0[1-9]|1[0-2])\/\d{4}$/))fail(page.number,"empresa, CNPJ ou competência não reconhecidos.");
    const calculation=lines.find(line=>line.items.some(item=>normalizeHeader(item.text)==="CALCULO"));
    if(!calculation||normalizeHeader(valueAfter(calculation,"Cálculo:",450))!=="FOLHA MENSAL")fail(page.number,"tipo de cálculo não suportado pelo leitor de Folha Mensal.");
    identities.add(`${cnpj}:${month}`);if(identities.size>1)fail(page.number,"há empresas ou competências diferentes no mesmo PDF; separe os extratos.");
    company=companyValue;companyDocument=cnpj!;competence=month;
    const summaryStart=lines.findIndex(line=>normalizeHeader(line.text)==="RESUMO POR RUBRICA");
    if(summaryStart>=0){for(const row of lines.slice(summaryStart+1))for(const side of ["left","right"] as const){const event=readEvent(row,side,page.number);if(event)summaryEvents.push(event);}}
    for(const line of lines){
      for(const [label,key] of [["Total Geral Proventos:","gross"],["Total Geral Descontos:","deductions"],["Líquido Geral:","liquid"]] as const){
        const found=line.items.find(item=>normalizeHeader(item.text)===normalizeHeader(label));if(!found)continue;
        const text=valueAfter(line,label,key==="gross"?390:570),value=text.match(new RegExp(`^(${moneyPattern})$`));
        if(!value)fail(page.number,`resumo ${label} não reconhecido.`);
        if(declared[key]!==undefined&&cents(declared[key]!)!==cents(money(value![1])))fail(page.number,"resumos repetidos possuem totais diferentes.");
        declared[key]=money(value![1]);
      }
      const n=line.text.match(/No\. Empregados:\s*(\d+)/i);if(n)expectedEmployees=Number(n[1]);
      const c=line.text.match(/No\. Contribuintes:\s*(\d+)/i);if(c)expectedContributors=Number(c[1]);
    }
    const anchors=lines.map((line,index)=>({line,index})).filter(({line})=>/^(?:Empr\.:|Contr:)\s/i.test(line.text));
    if(!anchors.length&&summaryStart<0&&!/No\. Empregados:|Total Geral Proventos:/i.test(all))fail(page.number,"página sem colaboradores ou resumo reconhecível.");
    if((all.match(/CPF:/gi)?.length??0)!==anchors.length)fail(page.number,"quantidade de CPFs não corresponde aos blocos identificados.");
    for(const [position,{line:header,index}] of anchors.entries()){
      const end=anchors[position+1]?.index??lines.length,remaining=lines.slice(index,end);
      const summaryIndex=remaining.findIndex(row=>/^Totais por Centro|Total Geral|Resumo por/i.test(row.text));
      const block=summaryIndex<0?remaining:remaining.slice(0,summaryIndex);
      const cpf=header.text.match(cpfPattern)?.[0].replace(/\D/g,"");
      const name=header.text.match(/^(?:Empr\.:|Contr:)\s*(\d+)\s+(.+?)\s+Situa[cç][aã]o:/i);
      const state=header.text.match(/Situa[cç][aã]o:\s*(.*?)\s+CPF:/i)?.[1];
      if(!cpf||!name||!state)fail(page.number,"cadastro do colaborador incompleto.");
      if(seenCpfs.has(cpf!))fail(page.number,"CPF repetido em mais de um bloco; revise a folha antes de somar pagamentos.");seenCpfs.add(cpf!);
      const totalIndex=block.findIndex(row=>row.items.some(item=>normalizeHeader(item.text)==="LIQUIDO"));
      if(totalIndex<3)fail(page.number,"total líquido do colaborador não foi localizado.");
      const totals=totalLine(block[totalIndex],page.number),events:PayrollAuditEvent[]=[];
      for(const row of block.slice(3,totalIndex))for(const side of ["left","right"] as const){const event=readEvent(row,side,page.number);if(event)events.push(event);}
      for(const [kind,key] of [["earning","gross"],["deduction","deductions"]] as const){const sum=events.filter(event=>event.kind===kind).reduce((total,event)=>total+cents(event.value),0);if(Math.abs(sum-cents(totals[key]))>1)fail(page.number,`soma das rubricas não fecha com o total de ${key==="gross"?"proventos":"descontos"} de um colaborador.`);}
      if(Math.abs(cents(totals.gross)-cents(totals.deductions)-cents(totals.liquid))>1)fail(page.number,"proventos menos descontos não fecha com o líquido de um colaborador.");
      const contract=block[1].text,job=block[2].text,salary=job.match(/Sal[aá]rio:\s*([\d.,-]+)/)?.[1];
      if(!salary||!new RegExp(`^${moneyPattern}$`).test(salary))fail(page.number,"salário contratual não reconhecido.");
      const contributor=header.text.startsWith("Contr:");if(contributor)contributorCount++;else employeeCount++;
      const notes=block.slice(totalIndex+1).filter(row=>!/^NF:|Totais por|Total:|Total Geral|L[ií]quido Geral:|Sistema licenciado/i.test(row.text)&&row.y<page.height*.96).map(row=>row.text);
      const audit:PayrollAuditData={version:1,baseSalary:money(salary!),...totals,company,unit:job.match(/Filial:\s*(\S+)/)?.[1]??"",costCenter:contract.match(/CC:\s*(\S+)/)?.[1]??"",department:contract.match(/Depto:\s*(\S+)/)?.[1]??"",jobTitle:job.match(/Cargo:\s*(.*?)\s+C\.B\.O:/)?.[1]??"",registration:name![1],internalId:name![1],employmentStatus:state!,admissionDate:date(header.text.match(/Adm:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]??""),terminationDate:null,payrollType:"Folha Mensal",events,occurrences:[{sheet:`PDF · página ${page.number}`,row:index+1,page:page.number}],invalidFields:[],source:{format:"PDF",companyDocument,employeeKind:contributor?"CONTRIBUINTE":"EMPREGADO",monthlyHours:contract.match(/Horas M[eê]s:\s*(\S+)/)?.[1]??"",notes}};
      const referenceIssues=events.flatMap(pdfOvertimeIssues);audit.invalidFields.push(...referenceIssues);warnings.push(...referenceIssues);
      const health=events.filter(event=>event.kind==="deduction"&&event.category==="health"),dental=events.filter(event=>event.kind==="deduction"&&event.category==="dental");
      records.push({cpf:cpf!,name:name![2].trim(),liquid:totals.liquid,healthTotal:health.reduce((sum,event)=>sum+cents(event.value),0)/100,dentalTotal:dental.reduce((sum,event)=>sum+cents(event.value),0)/100,healthColumns:health.length,dentalColumns:dental.length,sourceSheet:`PDF · página ${page.number}`,audit});
    }
  }
  if(!records.length)throw new Error("Nenhum colaborador com CPF foi encontrado. Use o Extrato Mensal completo ou Excel.");
  const totals={gross:0,deductions:0,liquid:0,health:0,dental:0};
  for(const record of records){totals.gross+=cents(record.audit!.gross!);totals.deductions+=cents(record.audit!.deductions!);totals.liquid+=cents(record.liquid);totals.health+=cents(record.healthTotal);totals.dental+=cents(record.dentalTotal);}
  for(const key of ["gross","deductions","liquid"] as const){if(declared[key]===undefined)throw new Error("O PDF não contém os totais gerais para validar a importação. Envie o extrato completo ou use Excel.");if(totals[key]!==cents(declared[key]!))throw new Error(`O total de ${key==="gross"?"proventos":key==="deductions"?"descontos":"líquido"} extraído não fecha com o resumo do PDF. Nenhum dado foi gravado.`);checks.push(`Total de ${key==="gross"?"proventos":key==="deductions"?"descontos":"líquido"} conferido: R$ ${display(declared[key]!)}.`);}
  if(expectedEmployees!==null&&expectedEmployees!==employeeCount||expectedContributors!==null&&expectedContributors!==contributorCount)throw new Error("A quantidade de empregados/contribuintes não fecha com o resumo do PDF.");
  if(expectedEmployees===null||expectedContributors===null)warnings.push("Resumo de quantidade de pessoas incompleto; confira se o documento está integral.");
  const allEvents=records.flatMap(record=>record.audit!.events);
  const uniqueSummary=new Set<string>();
  for(const event of summaryEvents){
    const identity=`${event.code}:${event.kind}`;if(uniqueSummary.has(identity))throw new Error("Resumo por rubrica repetido. Separe os extratos antes de importar.");uniqueSummary.add(identity);
    const matching=allEvents.filter(item=>item.code===event.code&&item.kind===event.kind),value=matching.reduce((sum,item)=>sum+cents(item.value),0);
    if(value!==cents(event.value))throw new Error(`A rubrica ${event.code} (${event.label}) não fecha com o resumo. Use o extrato completo ou Excel.`);
    const ref=event.references?.[0];if(ref?.unit==="hours"){
      const individualReferences=matching.flatMap(item=>item.references??[]);
      if(ref.minutes===undefined||individualReferences.some(item=>item.unit!=="hours"||item.minutes===undefined)){warnings.push(`Rubrica ${event.code} (${event.label}): há referência de horas inválida; o total de horas não foi atestado. Valores em R$ preservados.`);continue;}
      const minutes=individualReferences.reduce((sum,item)=>sum+item.minutes!,0);
      if(minutes!==ref.minutes)warnings.push(`Rubrica ${event.code} (${event.label}): referências individuais somam ${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,"0")}; resumo informa ${ref.raw}. Diferença de ${Math.abs(minutes-ref.minutes!)} minuto(s). Valores originais preservados.`);
    }
  }
  if(summaryEvents.length){for(const event of allEvents)if(!uniqueSummary.has(`${event.code}:${event.kind}`))throw new Error(`A rubrica ${event.code} não foi localizada no resumo do PDF.`);checks.push(`${summaryEvents.length} rubrica(s) conferidas com o resumo, incluindo os descontos de saúde e odontológico.`);}
  else warnings.push("Resumo por rubrica ausente; apenas os totais gerais e individuais foram conferidos.");
  checks.push(`${employeeCount} empregado(s) e ${contributorCount} contribuinte(s), ${records.length} CPFs únicos.`);
  return{competence,company,companyDocument,records:records.sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")),warnings,totals:Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,value/100])) as PayrollPdfResult["totals"],checks};
}
