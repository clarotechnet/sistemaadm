import type { Metadata } from "next";
import { getChatGPTUser } from "./chatgpt-auth";
import { LoginScreen } from "./ui/LoginScreen";
import { RHControlApp } from "./ui/RHControlApp";
import { ApprovalPending } from "./ui/ApprovalPending";
import type { UserProfile } from "../src/types";
import { getOrCreateProfile } from "../src/server/profile";

export const metadata: Metadata = {
  title: "Dashboard | RH Control",
  description: "Central administrativa de folha, benefícios e documentos de RH.",
};

export const dynamic = "force-dynamic";

const localProfile:UserProfile={id:"local-preview",name:"Marina Alves",email:"marina.alves@empresa.com.br",department:"Recursos Humanos",jobTitle:"Coordenadora de RH",role:"ADMINISTRADOR",status:"ATIVO"};

export default async function Home() {
  const user=await getChatGPTUser();
  if(!user&&process.env.NODE_ENV!=="development")return <LoginScreen/>;
  let profile=localProfile;
  if(user){try{profile=await getOrCreateProfile(user)}catch{profile={...localProfile,id:user.userId,name:user.displayName,email:user.email,role:"CONSULTA",status:"AGUARDANDO APROVAÇÃO"}}}
  if(profile.status!=="ATIVO")return <ApprovalPending name={profile.name}/>;
  return <RHControlApp user={profile}/>;
}
