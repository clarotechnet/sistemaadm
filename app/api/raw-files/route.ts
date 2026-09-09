import { createSupabaseAdminClient } from "../../../src/lib/supabase/admin";
import { getCurrentProfile } from "../../../src/server/auth";
import { cleanupExpiredRawFiles } from "../../../src/server/raw-files";

const BUCKET="rh-private-files";
const MAX_FILE_SIZE=50*1024*1024;
const safeName=(name:string)=>name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-120)||"arquivo";

export async function GET(request:Request){
  const profile=await getCurrentProfile();
  if(!profile||profile.status!=="ATIVO")return Response.json({error:"Acesso negado"},{status:403});
  try{await cleanupExpiredRawFiles();}catch{}
  const admin=createSupabaseAdminClient();
  const downloadId=new URL(request.url).searchParams.get("download");
  if(downloadId){
    const{data:item,error:itemError}=await admin.from("raw_file_uploads").select("id,user_id,storage_path").eq("id",downloadId).maybeSingle();
    if(itemError||!item)return Response.json({error:itemError?.message??"Arquivo não encontrado."},{status:404});
    if(item.user_id!==profile.id&&profile.role!=="ADMINISTRADOR")return Response.json({error:"Acesso negado"},{status:403});
    const signed=await admin.storage.from(BUCKET).createSignedUrl(item.storage_path,60);
    if(signed.error)return Response.json({error:signed.error.message},{status:500});
    return Response.json({url:signed.data.signedUrl});
  }
  let query=admin.from("raw_file_uploads").select("id,user_id,file_name,size_bytes,retention_mode,expires_at,created_at").order("created_at",{ascending:false}).limit(100);
  if(profile.role!=="ADMINISTRADOR")query=query.eq("user_id",profile.id);
  const{data,error}=await query;
  if(error)return Response.json({error:error.message},{status:500});
  return Response.json({files:(data??[]).map(row=>({id:row.id,fileName:row.file_name,sizeBytes:Number(row.size_bytes),retentionMode:row.retention_mode,expiresAt:row.expires_at,createdAt:row.created_at,ownerId:row.user_id}))});
}

export async function POST(request:Request){
  const profile=await getCurrentProfile();
  if(!profile||profile.status!=="ATIVO")return Response.json({error:"Acesso negado"},{status:403});
  const form=await request.formData();
  const file=form.get("file");
  const optedIn=form.get("optIn")==="true";
  if(!(file instanceof File))return Response.json({error:"Arquivo não informado."},{status:400});
  if(file.size>MAX_FILE_SIZE)return Response.json({error:"O arquivo excede o limite de 50 MB para retenção."},{status:413});
  const admin=createSupabaseAdminClient();
  const{data:settings,error:settingsError}=await admin.from("system_settings").select("file_retention").eq("id","global").single();
  if(settingsError)return Response.json({error:settingsError.message},{status:500});
  const mode=settings.file_retention as "NONE"|"24_HOURS"|"SECURE_OPTIONAL";
  if(mode==="NONE")return Response.json({error:"A política atual não permite armazenar arquivos brutos."},{status:409});
  if(mode==="SECURE_OPTIONAL"&&!optedIn)return Response.json({error:"O armazenamento seguro não foi autorizado para este arquivo."},{status:409});
  try{await cleanupExpiredRawFiles();}catch{}
  const id=crypto.randomUUID();
  const path=`${profile.id}/${id}-${safeName(file.name)}`;
  const bytes=new Uint8Array(await file.arrayBuffer());
  const uploaded=await admin.storage.from(BUCKET).upload(path,bytes,{contentType:file.type||"application/octet-stream",upsert:false});
  if(uploaded.error)return Response.json({error:uploaded.error.message},{status:500});
  const expiresAt=mode==="24_HOURS"?new Date(Date.now()+24*60*60*1000).toISOString():null;
  const{data,error}=await admin.from("raw_file_uploads").insert({id,user_id:profile.id,file_name:file.name,storage_path:path,size_bytes:file.size,retention_mode:mode,expires_at:expiresAt}).select("id,file_name,size_bytes,retention_mode,expires_at,created_at").single();
  if(error){await admin.storage.from(BUCKET).remove([path]);return Response.json({error:error.message},{status:500});}
  return Response.json({file:{id:data.id,fileName:data.file_name,sizeBytes:Number(data.size_bytes),retentionMode:data.retention_mode,expiresAt:data.expires_at,createdAt:data.created_at}},{status:201});
}

export async function DELETE(request:Request){
  const profile=await getCurrentProfile();
  if(!profile||profile.status!=="ATIVO")return Response.json({error:"Acesso negado"},{status:403});
  const{id}=await request.json() as {id?:string};
  if(!id)return Response.json({error:"Arquivo não informado."},{status:400});
  const admin=createSupabaseAdminClient();
  const{data,error}=await admin.from("raw_file_uploads").select("id,user_id,storage_path").eq("id",id).maybeSingle();
  if(error||!data)return Response.json({error:error?.message??"Arquivo não encontrado."},{status:404});
  if(data.user_id!==profile.id&&profile.role!=="ADMINISTRADOR")return Response.json({error:"Acesso negado"},{status:403});
  const removed=await admin.storage.from(BUCKET).remove([data.storage_path]);
  if(removed.error)return Response.json({error:removed.error.message},{status:500});
  const deleted=await admin.from("raw_file_uploads").delete().eq("id",id);
  if(deleted.error)return Response.json({error:deleted.error.message},{status:500});
  return Response.json({ok:true});
}
