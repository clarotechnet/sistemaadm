"use client";

import { Clock3, LogOut, ShieldCheck, UserX } from "lucide-react";
import { createSupabaseBrowserClient } from "../../src/lib/supabase/client";

type AccessStatus="AGUARDANDO APROVAÇÃO"|"BLOQUEADO";

export function ApprovalPending({name,status="AGUARDANDO APROVAÇÃO"}:{name:string;status?:AccessStatus}){
  const denied=status==="BLOQUEADO";
  const signOut=async()=>{const supabase=createSupabaseBrowserClient();await supabase.auth.signOut();window.location.href="/"};
  return <main className={`approval-page ${denied?"denied":""}`}><section>
    <span>{denied?<UserX/>:<Clock3/>}</span>
    <h1>{denied?"Acesso recusado":"Acesso aguardando aprovação"}</h1>
    <p>{denied?`Olá, ${name}. Sua solicitação de acesso foi recusada por um administrador. Entre em contato com o RH caso precise de uma nova análise.`:`Olá, ${name}. Seu cadastro foi recebido. Um administrador precisa liberar seu perfil antes que você acesse dados de RH.`}</p>
    <div><ShieldCheck/><span><strong>{denied?"Acesso aos dados bloqueado":"Seus dados estão protegidos"}</strong><small>{denied?"Nenhum dado administrativo ou arquivo de folha está disponível para esta conta.":"Nenhum arquivo ou informação de folha está visível enquanto a conta estiver pendente."}</small></span></div>
    <button className="button secondary" onClick={()=>void signOut()}><LogOut/> Sair</button>
  </section></main>;
}
