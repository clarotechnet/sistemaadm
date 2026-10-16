import { createSupabaseBrowserClient } from "../lib/supabase/client";
import type { ComparisonKind } from "../modules/comparisons/processor";
import { planMonth, validatePlanInput, type PlanBaseInput, type PlanBaseVersion } from "../modules/benefits/plan-base";

type Row = { id:string; kind:ComparisonKind; cpf:string; employee_name:string; company:string; city:string; department:string; plan_name:string; discount_value:number|string|null; status:PlanBaseInput["status"]; notes:string; metadata:Record<string,unknown>; effective_from:string; revision:number; source:string; created_at:string; created_by_name:string };
export async function listPlanBase(kind: ComparisonKind): Promise<PlanBaseVersion[]> {
  const db = createSupabaseBrowserClient(), all: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const {data,error} = await db.from("benefit_plan_base_versions").select("*").eq("kind",kind).order("effective_from",{ascending:false}).order("revision",{ascending:false}).order("id").range(offset,offset+499);
    if(error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "A Base de dados dos planos ainda precisa ser instalada no Supabase do RH." : error.message);
    all.push(...(data??[]) as Row[]);
    if((data?.length??0)<500) break;
  }
  return all.map(row=>({id:row.id,kind:row.kind,cpf:row.cpf,name:row.employee_name,company:row.company,city:row.city,department:row.department,plan:row.plan_name,value:row.discount_value===null?null:Number(row.discount_value),status:row.status,notes:row.notes,metadata:row.metadata??{},effectiveFrom:row.effective_from.slice(0,7),revision:row.revision,source:row.source,createdAt:row.created_at,createdByName:row.created_by_name}));
}

export async function savePlanBase(kind:ComparisonKind, competence:string, records:PlanBaseInput[], source="Cadastro manual") {
  if(!records.length) throw new Error("Nenhum cadastro válido para salvar.");
  const clean=records.map(validatePlanInput);
  if(new Set(clean.map(row=>row.cpf)).size!==clean.length) throw new Error("Existem CPFs repetidos no lote. Confira os registros antes de importar.");
  const {data,error}=await createSupabaseBrowserClient().rpc("save_benefit_plan_base",{p_kind:kind,p_effective_from:planMonth(competence)+"-01",p_records:clean,p_source:source});
  if(error) throw new Error(error.message);
  return data as {rows:number};
}
