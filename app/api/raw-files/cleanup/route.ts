import { getCurrentProfile } from "../../../../src/server/auth";
import { cleanupExpiredRawFiles } from "../../../../src/server/raw-files";

export async function POST(){
  const profile=await getCurrentProfile();
  if(!profile||profile.status!=="ATIVO")return Response.json({error:"Acesso negado"},{status:403});
  try{
    const deleted=await cleanupExpiredRawFiles();
    return Response.json({ok:true,deleted});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Falha ao limpar arquivos expirados."},{status:500});
  }
}
