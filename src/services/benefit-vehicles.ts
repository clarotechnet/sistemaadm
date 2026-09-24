import { createSupabaseBrowserClient } from "../lib/supabase/client";
import type { AggregationBaseRecord, BenefitVehicleRecord } from "../types";

type VehicleRow={
  id:string;aggregation_id:string|null;employee_name:string;cpf:string;company:string;city:string;
  base_value:number|string;plate:string;vehicle_year:number|null;vehicle_model:string;
  source:"BASE"|"MANUAL";excluded:boolean;
};

const fromManual=(row:VehicleRow):BenefitVehicleRecord=>({
  id:row.id,aggregationId:row.aggregation_id,source:row.source,employeeName:row.employee_name,cpf:row.cpf,
  company:row.company,city:row.city,baseValue:Number(row.base_value??0),plate:row.plate??"",
  vehicleYear:row.vehicle_year??null,vehicleModel:row.vehicle_model??"",
});

export async function listBenefitVehicles(base:AggregationBaseRecord[]):Promise<BenefitVehicleRecord[]>{
  const supabase=createSupabaseBrowserClient();
  const {data,error}=await supabase.from("benefit_vehicle_registry").select("*");
  if(error)throw error;
  const rows=(data??[]) as VehicleRow[];
  const byAggregation=new Map(rows.filter(row=>row.aggregation_id).map(row=>[row.aggregation_id as string,row]));
  const result:BenefitVehicleRecord[]=base.flatMap(item=>{
    const meta=byAggregation.get(item.id);
    if(meta?.excluded)return [];
    return [{
      id:meta?.id??("base:"+item.id),aggregationId:item.id,source:"BASE" as const,employeeName:item.employeeName,
      cpf:item.cpf,company:item.company,city:item.city,baseValue:item.baseValue,plate:meta?.plate??"",
      vehicleYear:meta?.vehicle_year??null,vehicleModel:meta?.vehicle_model??"",
    }];
  });
  for(const row of rows){
    if(row.source==="MANUAL"&&!row.excluded)result.push(fromManual(row));
  }
  return result.sort((a,b)=>a.employeeName.localeCompare(b.employeeName,"pt-BR"));
}

export async function saveBenefitVehicle(record:BenefitVehicleRecord){
  const supabase=createSupabaseBrowserClient();
  const payload={
    aggregation_id:record.aggregationId,
    employee_name:record.employeeName.trim().toUpperCase(),
    cpf:record.cpf.replace(/\D/g,"").padStart(11,"0"),
    company:record.company.trim().toUpperCase(),
    city:record.city.trim().toUpperCase(),
    base_value:Number(record.baseValue)||0,
    plate:record.plate.trim().toUpperCase(),
    vehicle_year:record.vehicleYear,
    vehicle_model:record.vehicleModel.trim().toUpperCase(),
    source:record.source,
    excluded:false,
  };
  if(record.source==="BASE"&&record.aggregationId){
    const {error}=await supabase.from("benefit_vehicle_registry").upsert(payload,{onConflict:"aggregation_id"});
    if(error)throw error;
    return;
  }
  if(record.id&&!record.id.startsWith("manual:new")){
    const {error}=await supabase.from("benefit_vehicle_registry").update(payload).eq("id",record.id);
    if(error)throw error;
  }else{
    const {error}=await supabase.from("benefit_vehicle_registry").insert(payload);
    if(error)throw error;
  }
}

export async function removeBenefitVehicle(record:BenefitVehicleRecord){
  const supabase=createSupabaseBrowserClient();
  if(record.source==="BASE"&&record.aggregationId){
    const payload={aggregation_id:record.aggregationId,employee_name:record.employeeName,cpf:record.cpf,company:record.company,
      city:record.city,base_value:record.baseValue,plate:record.plate,vehicle_year:record.vehicleYear,
      vehicle_model:record.vehicleModel,source:"BASE",excluded:true};
    const {error}=await supabase.from("benefit_vehicle_registry").upsert(payload,{onConflict:"aggregation_id"});
    if(error)throw error;
  }else{
    const {error}=await supabase.from("benefit_vehicle_registry").delete().eq("id",record.id);
    if(error)throw error;
  }
}
export async function exportBenefitVehicleExcel(rows:BenefitVehicleRecord[]){
  if(!rows.length)throw new Error("Não há veículos para exportar com os filtros atuais.");
  const XLSX=await import("xlsx");
  const workbook=XLSX.utils.book_new();
  workbook.Props={Author:"RH Controle",Company:"TechNET",Title:"Relatório de veículos do Agregamento"};
  const data=rows.map(row=>[
    row.employeeName,row.cpf.replace(/\D/g,"").padStart(11,"0"),row.company,row.city,Number(row.baseValue.toFixed(2)),
    row.plate,row.vehicleYear??"",row.vehicleModel,
  ]);
  const worksheet=XLSX.utils.aoa_to_sheet([["Colaborador","CPF","Empresa","Cidade","Valor base","Placa","Ano","Modelo"],...data]);
  worksheet["!cols"]=[{wch:34},{wch:16},{wch:14},{wch:18},{wch:16},{wch:12},{wch:10},{wch:28}];
  worksheet["!autofilter"]={ref:"A1:H"+(data.length+1)};
  for(let rowIndex=2;rowIndex<=data.length+1;rowIndex+=1){
    const cpfCell=worksheet["B"+rowIndex];
    if(cpfCell){cpfCell.t="s";cpfCell.z="@";cpfCell.v=String(cpfCell.v??"").padStart(11,"0")}
    const valueCell=worksheet["E"+rowIndex];
    if(valueCell){valueCell.t="n";valueCell.z="#,##0.00"}
    const yearCell=worksheet["G"+rowIndex];
    if(yearCell&&yearCell.v!=="")yearCell.t="n";
  }
  XLSX.utils.book_append_sheet(workbook,worksheet,"Veículos");
  const output=XLSX.write(workbook,{type:"array",bookType:"xlsx",compression:true});
  const {downloadFile}=await import("../utils/download");
  const stamp=new Date().toISOString().slice(0,10);
  downloadFile(output,"relatorio_veiculos_agregamento_"+stamp+".xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
