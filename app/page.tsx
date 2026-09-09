import type { Metadata } from "next";
import { LoginScreen } from "./ui/LoginScreen";
import { RHControlApp } from "./ui/RHControlApp";
import { ApprovalPending } from "./ui/ApprovalPending";
import { getCurrentAuthUser, getCurrentProfile } from "../src/server/auth";

export const metadata: Metadata = { title: "Dashboard | RH Controle", description: "Central administrativa de folha, benefícios e documentos de RH." };
export const dynamic = "force-dynamic";

export default async function Home() { const user = await getCurrentAuthUser(); if (!user) return <LoginScreen />; const profile = await getCurrentProfile(); if (!profile) return <ApprovalPending name={user.email ?? "Usuário"} />; if (profile.status !== "ATIVO") return <ApprovalPending name={profile.name} status={profile.status} />; return <RHControlApp user={profile} /> }
