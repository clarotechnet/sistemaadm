import { createSupabaseServerClient } from "../../../src/lib/supabase/server";
import { getCurrentProfile } from "../../../src/server/auth";
import type { FileRetentionMode, SystemSettings } from "../../../src/types";

const retentionModes:FileRetentionMode[]=["NONE","24_HOURS","SECURE_OPTIONAL"];
const serialize=(row:any):SystemSettings=>({
  maskCpf:Boolean(row.mask_cpf),
  fileRetention:row.file_retention as FileRetentionMode,
  financialTolerance:Number(row.financial_tolerance??0.01),
  updatedAt:row.updated_at??undefined,
});

export async function GET(){
  const profile=await getCurrentProfile();
  if(!profile||profile.status!=="ATIVO")return Response.json({error:"Acesso negado"},{status:403});
  const supabase=await createSupabaseServerClient();
  const{data,error}=await supabase.from("system_settings").select("mask_cpf,file_retention,financial_tolerance,updated_at").eq("id","global").single();
  if(error)return Response.json({error:error.message},{status:500});
  return Response.json({settings:serialize(data)});
}

export async function PATCH(request:Request){
  const profile=await getCurrentProfile();
  if(!profile||profile.status!=="ATIVO"||profile.role!=="ADMINISTRADOR")return Response.json({error:"Somente administradores podem alterar estas configurações."},{status:403});
  const payload=await request.json() as Partial<SystemSettings>;
  const retention=payload.fileRetention;
  if(retention&&!retentionModes.includes(retention))return Response.json({error:"Modo de retenção inválido."},{status:400});  const tolerance=payload.financialTolerance;
  if(tolerance!==undefined&&(!Number.isFinite(tolerance)||tolerance<0||tolerance>1000))return Response.json({error:"Tolerância financeira inválida."},{status:400});
  const patch:any={updated_by:profile.id,updated_at:new Date().toISOString()};
  if(payload.maskCpf!==undefined)patch.mask_cpf=Boolean(payload.maskCpf);
  if(retention)patch.file_retention=retention;
  if(tolerance!==undefined)patch.financial_tolerance=tolerance;
  const supabase=await createSupabaseServerClient();
  const{data,error}=await supabase.from("system_settings").update(patch).eq("id","global").select("mask_cpf,file_retention,financial_tolerance,updated_at").single();
  if(error)return Response.json({error:error.message},{status:400});
  return Response.json({settings:serialize(data)});
}
