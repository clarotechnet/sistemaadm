import { notFound } from "next/navigation";
import { LoginScreen } from "../ui/LoginScreen";
import { RHControlApp } from "../ui/RHControlApp";
import { ApprovalPending } from "../ui/ApprovalPending";
import type { AppRoute } from "../ui/components/AppShell";
import { getCurrentAuthUser, getCurrentProfile } from "../../src/server/auth";

export const dynamic="force-dynamic";
const routes:AppRoute[]=["payroll","pdfs","reports","history","users","settings"];
export default async function SectionPage({params}:{params:Promise<{section:string}>}){const{section}=await params;if(!routes.includes(section as AppRoute))notFound();const user=await getCurrentAuthUser();if(!user)return <LoginScreen/>;const profile=await getCurrentProfile();if(!profile)return <ApprovalPending name={user.email??"Usuário"}/>;if(profile.status!=="ATIVO")return <ApprovalPending name={profile.name}/>;const allowed=profile.role==="ADMINISTRADOR"?routes:profile.role==="RH"?["payroll","pdfs","reports","history"]:["reports","history"];if(!allowed.includes(section as AppRoute))notFound();return <RHControlApp user={profile} initialRoute={section as AppRoute}/>}
