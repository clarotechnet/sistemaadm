import type { User } from "@supabase/supabase-js";
import type { UserProfile } from "../types";
import { createSupabaseServerClient } from "../lib/supabase/server";

export async function getCurrentAuthUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) return null;
  return user;
}

export async function getCurrentProfile(): Promise<UserProfile | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("id,email,full_name,department,job_title,role,status").eq("id", user.id).maybeSingle();
  if (error || !data) return null;
  return { id:data.id, email:data.email, name:data.full_name, department:data.department, jobTitle:data.job_title, role:data.role, status:data.status } as UserProfile;
}

export async function requireActiveProfile() {
  const profile = await getCurrentProfile();
  return profile?.status === "ATIVO" ? profile : null;
}
