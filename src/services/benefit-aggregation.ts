import { createSupabaseBrowserClient } from "../lib/supabase/client";
import type { AggregationBaseRecord, AggregationMonthlyRecord, EmployeeStatus } from "../types";

type BaseRow = {
  id:string; source_label:string; company:string; city:string; employee_name:string; cpf:string;
  bank:string; base_value:number|string; notes:string; employee_id:string|null; source:"ARQUIVO"|"MANUAL";
  active_override:boolean|null; employees?:{status:EmployeeStatus;admission_date:string|null;termination_date:string|null}|null;
};
type MonthlyRow = {
  id:string; competence:string; aggregation_id:string; employee_id:string|null; cpf:string; employee_name:string;
  company:string; city:string; base_value:number|string; employment_status:EmployeeStatus|"NAO_LOCALIZADO";
  admission_date:string|null; termination_date:string|null; absence_days:number|string; medical_days:number|string;
  vacation_days:number|string; maintenance_vehicle_days:number|string; employment_days:number|string; payable_days:number|string; amount_due:number|string;
  calculation_note:string; synced_at:string;
};

const baseFromRow=(row:BaseRow):AggregationBaseRecord=>({
  id:row.id,sourceLabel:row.source_label,company:row.company,city:row.city,employeeName:row.employee_name,cpf:row.cpf,
  bank:row.bank,baseValue:Number(row.base_value??0),notes:row.notes??"",employeeId:row.employee_id,source:row.source,
  activeOverride:row.active_override,employeeStatus:row.employees?.status??null,
  admissionDate:row.employees?.admission_date??null,terminationDate:row.employees?.termination_date??null,
});
const monthlyFromRow=(row:MonthlyRow):AggregationMonthlyRecord=>({
  id:row.id,competence:row.competence.slice(0,7),aggregationId:row.aggregation_id,employeeId:row.employee_id,
  cpf:row.cpf,employeeName:row.employee_name,company:row.company,city:row.city,baseValue:Number(row.base_value??0),
  employmentStatus:row.employment_status,admissionDate:row.admission_date,terminationDate:row.termination_date,
  absenceDays:Number(row.absence_days??0),medicalDays:Number(row.medical_days??0),vacationDays:Number(row.vacation_days??0),
  maintenanceVehicleDays:Number(row.maintenance_vehicle_days??0),employmentDays:Number(row.employment_days??30),payableDays:Number(row.payable_days??30),amountDue:Number(row.amount_due??0),
  calculationNote:row.calculation_note??"",syncedAt:row.synced_at,
});

export async function listAggregationBase():Promise<AggregationBaseRecord[]>{
  const supabase=createSupabaseBrowserClient();
  const {data,error}=await supabase.from("benefit_aggregation_base")
    .select("id,source_label,company,city,employee_name,cpf,bank,base_value,notes,employee_id,source,active_override,employees(status,admission_date,termination_date)")
    .order("employee_name");
  if(error)throw error;
  return ((data??[]) as unknown as BaseRow[]).map(baseFromRow);
}

export async function saveAggregationBase(record:Partial<AggregationBaseRecord>&{employeeName:string;cpf:string;company:string;city:string;baseValue:number}){
  const supabase=createSupabaseBrowserClient();
  const payload={
    source_label:record.sourceLabel??[record.company,record.city].filter(Boolean).join(" "),
    company:record.company.trim().toUpperCase(),
    city:record.city.trim().toUpperCase(),
    employee_name:record.employeeName.trim().toUpperCase(),
    cpf:record.cpf.replace(/\D/g,""),
    bank:(record.bank??"").trim().toUpperCase(),
    base_value:Number(record.baseValue)||0,
    notes:(record.notes??"").trim(),
    active_override:record.activeOverride??null,
    source:record.source??"MANUAL",
  };
  if(record.id){
    const {error}=await supabase.from("benefit_aggregation_base").update(payload).eq("id",record.id);
    if(error)throw error;
  }else{
    const {error}=await supabase.from("benefit_aggregation_base").insert(payload);
    if(error)throw error;
  }
}

export async function upsertAggregationBase(records:Array<{sourceLabel:string;company:string;city:string;employeeName:string;cpf:string;bank:string;baseValue:number;notes:string}>){
  const supabase=createSupabaseBrowserClient();
  const payload=records.map(record=>({
    source_label:record.sourceLabel,company:record.company,city:record.city,employee_name:record.employeeName,
    cpf:record.cpf.replace(/\D/g,""),bank:record.bank,base_value:record.baseValue,notes:record.notes,source:"ARQUIVO",
  }));
  for(let index=0;index<payload.length;index+=100){
    const {error}=await supabase.from("benefit_aggregation_base").upsert(payload.slice(index,index+100),{onConflict:"cpf"});
    if(error)throw error;
  }
}

export async function listAggregationMonthly(competence:string):Promise<AggregationMonthlyRecord[]>{
  const supabase=createSupabaseBrowserClient();
  const month=competence.match(/^\d{4}-\d{2}$/)?.[0];
  if(!month)return [];
  const {data,error}=await supabase.from("benefit_aggregation_monthly").select("*").eq("competence",month+"-01").order("employee_name");
  if(error)throw error;
  return ((data??[]) as MonthlyRow[]).map(monthlyFromRow);
}

export async function saveAggregationMaintenance(competence:string,aggregationId:string,days:number){
  const month=competence.match(/^\d{4}-\d{2}$/)?.[0];
  if(!month)throw new Error("Competência inválida.");
  const normalized=Math.max(0,Math.min(30,Math.trunc(Number(days)||0)));
  const supabase=createSupabaseBrowserClient();
  const {data,error}=await supabase.rpc("set_benefit_aggregation_maintenance",{
    p_competence:month+"-01",p_aggregation_id:aggregationId,p_days:normalized,
  });
  if(error)throw error;
  return data as {ok?:boolean;rows?:number;maintenanceVehicleDays?:number};
}

function safeSheetName(value:string,fallback:string){
  const invalid="\\/?*[]:";
  const clean=[...value].map(char=>invalid.includes(char)?" ":char).join("").replace(/\s+/g," ").trim()||fallback;
  return clean.slice(0,31);
}
export async function exportAggregationPaymentExcel(rows:AggregationMonthlyRecord[],competence:string){
  if(!rows.length)throw new Error("Não há pagamentos para exportar com os filtros atuais.");
  const XLSX=await import("xlsx");
  const workbook=XLSX.utils.book_new();
  workbook.Props={Author:"RH Controle",Company:"TechNET",Title:"Pagamento de Agregamento "+competence};
  const grouped=new Map<string,AggregationMonthlyRecord[]>();
  for(const row of rows){
    const key=row.company.trim()||"SEM EMPRESA";
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key)!.push(row);
  }
  const usedNames=new Set<string>();
  for(const [company,companyRows] of [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b,"pt-BR"))){
    const data=companyRows.slice().sort((a,b)=>a.employeeName.localeCompare(b.employeeName,"pt-BR")).map(row=>[
      row.cpf.replace(/\D/g,"").padStart(11,"0"),
      Number(row.amountDue.toFixed(2)),
    ]);
    const worksheet=XLSX.utils.aoa_to_sheet([["CPF","Valor a receber"],...data]);
    worksheet["!cols"]=[{wch:16},{wch:18}];
    worksheet["!autofilter"]={ref:"A1:B"+(data.length+1)};
    for(let rowIndex=2;rowIndex<=data.length+1;rowIndex+=1){
      const cpfCell=worksheet["A"+rowIndex];
      if(cpfCell){cpfCell.t="s";cpfCell.z="@";cpfCell.v=String(cpfCell.v??"").padStart(11,"0")}
      const valueCell=worksheet["B"+rowIndex];
      if(valueCell){valueCell.t="n";valueCell.z="#,##0.00"}
    }
    let sheetName=safeSheetName(company,"EMPRESA"),suffix=2;
    while(usedNames.has(sheetName)){sheetName=safeSheetName(company+" "+suffix,"EMPRESA");suffix+=1}
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(workbook,worksheet,sheetName);
  }
  const output=XLSX.write(workbook,{type:"array",bookType:"xlsx",compression:true});
  const {downloadFile}=await import("../utils/download");
  downloadFile(output,"pagamento_agregamento_"+competence+".xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
export async function syncAggregationMonth(competence:string){
  const supabase=createSupabaseBrowserClient();
  const {data,error}=await supabase.functions.invoke("sync-benefit-aggregation",{body:{competence}});
  if(error){
    const context=(error as {context?:unknown}).context;
    if(context instanceof Response){
      try{
        const payload=await context.clone().json() as {error?:string;message?:string;espelhoError?:string};
        const detail=payload.error??payload.message??payload.espelhoError;
        if(detail)throw new Error(detail);
      }catch(parsed){
        if(parsed instanceof Error&&parsed.message!==error.message)throw parsed;
      }
    }
    throw error;
  }
  const body=(data??{}) as {ok?:boolean;error?:string;rows?:number;events?:number;faltas?:number;atestados?:number;ferias?:number;espelhoOk?:boolean;espelhoError?:string;faltasSource?:string;faltasUpdatedThrough?:string;warnings?:string[]};
  if(!body.ok)throw new Error(body.error??"Não foi possível atualizar o Agregamento pelo QuarkRH.");
  return body;
}
