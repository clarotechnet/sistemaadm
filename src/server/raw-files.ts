import { createSupabaseAdminClient } from "../lib/supabase/admin";

export async function cleanupExpiredRawFiles(limit=100){
  const admin=createSupabaseAdminClient();
  const now=new Date().toISOString();
  const{data,error}=await admin.from("raw_file_uploads").select("id,storage_path").not("expires_at","is",null).lte("expires_at",now).limit(limit);
  if(error)throw error;
  if(!data?.length)return 0;
  const paths=data.map(item=>item.storage_path);
  const removed=await admin.storage.from("rh-private-files").remove(paths);
  if(removed.error)throw removed.error;
  const ids=data.map(item=>item.id);
  const deleted=await admin.from("raw_file_uploads").delete().in("id",ids);
  if(deleted.error)throw deleted.error;
  return ids.length;
}
