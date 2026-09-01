import { and, eq, ne } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { profiles } from "../../../db/schema";
import { getOrCreateProfile } from "../../../src/server/profile";

const roles=["ADMINISTRADOR","RH","CONSULTA"] as const;
const statuses=["ATIVO","AGUARDANDO APROVAÇÃO","BLOQUEADO"] as const;
type Role=typeof roles[number];
type Status=typeof statuses[number];

async function requireAdmin(){
  const user=await getChatGPTUser();
  if(!user)return null;
  const profile=await getOrCreateProfile(user);
  return profile.role==="ADMINISTRADOR"&&profile.status==="ATIVO"?profile:null;
}

const serialize=(row:typeof profiles.$inferSelect)=>({id:row.id,name:row.fullName,email:row.email,department:row.department,jobTitle:row.jobTitle,role:row.role,status:row.status});

export async function GET(){
  if(!await requireAdmin())return Response.json({error:"Acesso negado"},{status:403});
  const rows=await getDb().select().from(profiles);
  return Response.json({users:rows.map(serialize)});
}

export async function POST(request:Request){
  if(!await requireAdmin())return Response.json({error:"Acesso negado"},{status:403});
  const payload=await request.json() as {name?:string;email?:string;department?:string;jobTitle?:string;role?:Role};
  if(!payload.name?.trim()||!payload.email?.trim())return Response.json({error:"Nome e e-mail são obrigatórios"},{status:400});
  if(payload.role&&!roles.includes(payload.role))return Response.json({error:"Perfil inválido"},{status:400});
  const now=new Date().toISOString();
  const value={id:`invite:${crypto.randomUUID()}`,fullName:payload.name.trim(),email:payload.email.trim().toLowerCase(),department:payload.department?.trim()??"",jobTitle:payload.jobTitle?.trim()??"",role:payload.role??"CONSULTA",status:"AGUARDANDO APROVAÇÃO" as const,createdAt:now,updatedAt:now};
  try{
    await getDb().insert(profiles).values(value);
    return Response.json({user:serialize(value)},{status:201});
  }catch{return Response.json({error:"Já existe um usuário com este e-mail."},{status:409})}
}

export async function PATCH(request:Request){
  if(!await requireAdmin())return Response.json({error:"Acesso negado"},{status:403});
  const payload=await request.json() as {id?:string;role?:Role;status?:Status};
  if(!payload.id||(!payload.role&&!payload.status))return Response.json({error:"Informe o usuário e a alteração desejada."},{status:400});
  if(payload.role&&!roles.includes(payload.role))return Response.json({error:"Perfil inválido"},{status:400});
  if(payload.status&&!statuses.includes(payload.status))return Response.json({error:"Status inválido"},{status:400});
  const db=getDb();
  const[target]=await db.select().from(profiles).where(eq(profiles.id,payload.id)).limit(1);
  if(!target)return Response.json({error:"Usuário não encontrado."},{status:404});
  const nextRole=payload.role??target.role;
  const nextStatus=payload.status??target.status;
  const removesActiveAdmin=target.role==="ADMINISTRADOR"&&target.status==="ATIVO"&&(nextRole!=="ADMINISTRADOR"||nextStatus!=="ATIVO");
  if(removesActiveAdmin){
    const[otherAdmin]=await db.select({id:profiles.id}).from(profiles).where(and(eq(profiles.role,"ADMINISTRADOR"),eq(profiles.status,"ATIVO"),ne(profiles.id,target.id))).limit(1);
    if(!otherAdmin)return Response.json({error:"É necessário manter pelo menos um administrador ativo. Adicione ou promova outro administrador primeiro."},{status:400});
  }
  await db.update(profiles).set({...(payload.role?{role:payload.role}:{}),...(payload.status?{status:payload.status}:{}),updatedAt:new Date().toISOString()}).where(eq(profiles.id,payload.id));
  return Response.json({ok:true,user:serialize({...target,role:nextRole,status:nextStatus,updatedAt:new Date().toISOString()})});
}
