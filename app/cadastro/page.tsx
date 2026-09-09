import { RegistrationScreen } from "../ui/RegistrationScreen";
import { SignupScreen } from "../ui/SignupScreen";
import { getCurrentAuthUser, getCurrentProfile } from "../../src/server/auth";
import type { UserProfile } from "../../src/types";

export const dynamic="force-dynamic";
export default async function Cadastro(){const user=await getCurrentAuthUser();if(!user)return <SignupScreen/>;let profile=await getCurrentProfile();if(!profile){profile={id:user.id,email:user.email??"",name:String(user.user_metadata?.full_name??user.email??"Usuário"),department:String(user.user_metadata?.department??""),jobTitle:String(user.user_metadata?.job_title??""),role:"CONSULTA",status:"AGUARDANDO APROVAÇÃO"} satisfies UserProfile}return <RegistrationScreen profile={profile}/>}
