import { redirect } from "next/navigation";
import { getChatGPTUser } from "../chatgpt-auth";
import { RegistrationScreen } from "../ui/RegistrationScreen";
import { getOrCreateProfile } from "../../src/server/profile";
export const dynamic="force-dynamic";
export default async function Cadastro(){const user=await getChatGPTUser();if(!user)redirect("/signin-with-chatgpt?return_to=/cadastro");const profile=await getOrCreateProfile(user);return <RegistrationScreen profile={profile}/>}
