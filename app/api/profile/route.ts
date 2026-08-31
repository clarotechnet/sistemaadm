import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { profiles } from "../../../db/schema";
import { getOrCreateProfile } from "../../../src/server/profile";

export async function GET(){const user=await getChatGPTUser();if(!user)return Response.json({error:"Não autenticado"},{status:401});return Response.json({profile:await getOrCreateProfile(user)})}
export async function PATCH(request:Request){const user=await getChatGPTUser();if(!user)return Response.json({error:"Não autenticado"},{status:401});const payload=await request.json() as {name?:string;department?:string;jobTitle?:string};await getOrCreateProfile(user);await getDb().update(profiles).set({fullName:payload.name?.trim()||user.displayName,department:payload.department?.trim()??"",jobTitle:payload.jobTitle?.trim()??"",updatedAt:new Date().toISOString()}).where(eq(profiles.id,user.userId));return Response.json({ok:true})}
