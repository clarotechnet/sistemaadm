import { notFound } from "next/navigation";
import { getChatGPTUser } from "../chatgpt-auth";
import { LoginScreen } from "../ui/LoginScreen";
import { RHControlApp } from "../ui/RHControlApp";
import { getOrCreateProfile } from "../../src/server/profile";
import type { UserProfile } from "../../src/types";
import type { AppRoute } from "../ui/components/AppShell";
import { ApprovalPending } from "../ui/ApprovalPending";

export const dynamic="force-dynamic";
const routes:AppRoute[]=["payroll","pdfs","reports","history","users","settings"];
const localProfile:UserProfile={id:"local-preview",name:"Marina Alves",email:"marina.alves@empresa.com.br",department:"Recursos Humanos",jobTitle:"Coordenadora de RH",role:"ADMINISTRADOR",status:"ATIVO"};
export default async function SectionPage({params}:{params:Promise<{section:string}>}){const{section}=await params;if(!routes.includes(section as AppRoute))notFound();const user=await getChatGPTUser();if(!user&&process.env.NODE_ENV!=="development")return <LoginScreen/>;let profile=localProfile;if(user){try{profile=await getOrCreateProfile(user)}catch{profile={...localProfile,id:user.userId,name:user.displayName,email:user.email,role:"CONSULTA",status:"AGUARDANDO APROVAÇÃO"}}}if(profile.status!=="ATIVO")return <ApprovalPending name={profile.name}/>;const allowed=profile.role==="ADMINISTRADOR"?routes:profile.role==="RH"?["payroll","pdfs","reports","history"]:["reports","history"];if(!allowed.includes(section as AppRoute))notFound();return <RHControlApp user={profile} initialRoute={section as AppRoute}/>}
