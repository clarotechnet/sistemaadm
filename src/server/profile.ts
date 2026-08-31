import { count, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { profiles } from "../../db/schema";
import type { ChatGPTUser } from "../../app/chatgpt-auth";
import type { UserProfile } from "../types";

export async function getOrCreateProfile(user: ChatGPTUser): Promise<UserProfile> {
  const db=getDb();let [existing]=await db.select().from(profiles).where(eq(profiles.id,user.userId)).limit(1);if(!existing){[existing]=await db.select().from(profiles).where(eq(profiles.email,user.email)).limit(1);if(existing&&existing.id.startsWith("invite:")){await db.update(profiles).set({id:user.userId,updatedAt:new Date().toISOString()}).where(eq(profiles.id,existing.id));existing={...existing,id:user.userId};}}if(existing)return{id:existing.id,name:existing.fullName,email:existing.email,department:existing.department,jobTitle:existing.jobTitle,role:existing.role,status:existing.status};
  const [{value}]=await db.select({value:count()}).from(profiles);const first=value===0;const now=new Date().toISOString();const profile={id:user.userId,email:user.email,fullName:user.fullName??user.displayName,department:"",jobTitle:"",role:first?"ADMINISTRADOR" as const:"CONSULTA" as const,status:first?"ATIVO" as const:"AGUARDANDO APROVAÇÃO" as const,createdAt:now,updatedAt:now};await db.insert(profiles).values(profile);return{id:profile.id,name:profile.fullName,email:profile.email,department:profile.department,jobTitle:profile.jobTitle,role:profile.role,status:profile.status};
}
