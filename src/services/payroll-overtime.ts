import type {ActivePayroll,PayrollRecord} from "../types";
import {createSupabaseBrowserClient} from "../lib/supabase/client";
import {payrollRecordFromRow} from "./browser-backend";
import type {OvertimeReferenceData,OvertimeReferenceFile} from "../modules/payroll/overtime-audit";

type ReferenceRow={id:string;label:string;file_name:string;file_hash:string;reference_data:OvertimeReferenceData;mappings:Record<string,string>;mapping_revision:string|null;source_id:string|null;updated_at:string;updated_by_name:string};
const fromRow=(row:ReferenceRow):OvertimeReferenceFile=>({id:row.id,label:row.label,data:row.reference_data,mappings:row.mappings??{},mappingRevision:row.mapping_revision,sourceId:row.source_id,updatedAt:row.updated_at,updatedBy:row.updated_by_name,fileName:row.file_name,fileHash:row.file_hash});
const columns="id,label,file_name,file_hash,reference_data,mappings,mapping_revision,source_id,updated_at,updated_by_name";
const schemaError=(error:{code?:string;message:string})=>new Error(["PGRST205","42P01","PGRST202","42883"].includes(error.code??"")?"A atualização do banco para Horas Extras ainda não foi aplicada. A folha permanece preservada.":error.message);

export async function loadOvertimeReferences(monthId:string):Promise<OvertimeReferenceFile[]>{
  const rows:ReferenceRow[]=[],client=createSupabaseBrowserClient();
  for(let offset=0;;offset+=100){
    const {data,error}=await client.from("payroll_overtime_references").select(columns).eq("payroll_import_id",monthId).order("id").range(offset,offset+99);
    if(error)throw schemaError(error);
    rows.push(...(data??[]) as ReferenceRow[]);if((data?.length??0)<100)break;
  }
  return rows.map(fromRow);
}

export async function loadOvertimePayrollRecords(payroll:ActivePayroll,sourceId:string):Promise<PayrollRecord[]>{
  const records:PayrollRecord[]=[],client=createSupabaseBrowserClient();
  for(let offset=0;;offset+=500){
    let query=client.from("payroll_records").select("cpf,name,liquid,health_total,dental_total,health_columns,dental_columns,source_sheet,audit_data,source_id").eq("payroll_import_id",payroll.id);
    if(sourceId)query=query.eq("source_id",sourceId);
    const {data,error}=await query.order("id").range(offset,offset+499);if(error)throw error;
    for(const row of data??[]){const record=payrollRecordFromRow(row),source=payroll.sources?.find(s=>s.id===row.source_id);if(source)record.sourceSheet=`${source.label} · ${record.sourceSheet}`;records.push(record);}
    if((data?.length??0)<500)break;
  }
  return records;
}

export async function saveOvertimeReference(payroll:ActivePayroll,input:{label:string;fileHash:string;data:OvertimeReferenceData;sourceId:string|null;target?:OvertimeReferenceFile}){
  const {data,error}=await createSupabaseBrowserClient().rpc("save_payroll_overtime_reference",{p_month_id:payroll.id,p_source_id:input.sourceId,p_label:input.label.trim(),p_file_name:input.data.fileName,p_file_hash:input.fileHash,p_reference_data:input.data,p_id:input.target?.id??null,p_expected_updated_at:input.target?.updatedAt??null});
  if(error)throw schemaError(error);return String(data);
}

export async function saveOvertimeMapping(payroll:ActivePayroll,file:OvertimeReferenceFile,recordId:string,cpf:string){
  const {error}=await createSupabaseBrowserClient().rpc("map_payroll_overtime_reference",{p_id:file.id,p_record_id:recordId,p_cpf:cpf||null,p_expected_updated_at:file.updatedAt,p_payroll_revision:payroll.importedAt});
  if(error)throw schemaError(error);
}

export async function removeOvertimeReference(file:OvertimeReferenceFile){
  const {error}=await createSupabaseBrowserClient().rpc("admin_delete_payroll_overtime_reference",{p_id:file.id,p_expected_updated_at:file.updatedAt});
  if(error)throw schemaError(error);
}

