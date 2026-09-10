"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, RotateCcw, Search, ShieldCheck, UserCheck, UserPlus, Users, UserX, Wifi } from "lucide-react";
import type { Role, UserProfile } from "../../../src/types";
import { EmptyState, StatusBadge } from "../components/Common";
import { useApp } from "../state/AppContext";
import { createSupabaseBrowserClient } from "../../../src/lib/supabase/client";
import { inviteManagedUser, updateManagedUser } from "../../../src/services/browser-backend";

type ProfileRow={id:string;email:string;full_name:string;department:string;job_title:string;role:Role;status:UserProfile["status"]};
const serialize=(row:ProfileRow):UserProfile=>({id:row.id,name:row.full_name,email:row.email,department:row.department,jobTitle:row.job_title,role:row.role,status:row.status});

export function UsersPage(){
  const{user:currentUser,toast,addAudit}=useApp();
  const supabase=useMemo(()=>createSupabaseBrowserClient(),[]);
  const[users,setUsers]=useState<UserProfile[]>([]);
  const[onlineIds,setOnlineIds]=useState<Set<string>>(new Set());
  const[query,setQuery]=useState("");
  const[formOpen,setFormOpen]=useState(false);
  const[loading,setLoading]=useState(true);
  const[savingId,setSavingId]=useState("");
  const[form,setForm]=useState({name:"",email:"",department:"",jobTitle:"",role:"RH" as Role});

  const loadPresence=useCallback(async()=>{
    const cutoff=new Date(Date.now()-90000).toISOString();
    const{data,error}=await supabase.from("user_presence").select("user_id").gte("last_seen",cutoff);
    if(!error)setOnlineIds(new Set((data??[]).map(row=>row.user_id as string)));
  },[supabase]);
  const loadUsers=useCallback(async()=>{
    setLoading(true);
    try{
      const cutoff=new Date(Date.now()-90000).toISOString();
      const[profiles,presence]=await Promise.all([
        supabase.from("profiles").select("id,email,full_name,department,job_title,role,status").order("full_name"),
        supabase.from("user_presence").select("user_id").gte("last_seen",cutoff)
      ]);
      if(profiles.error)throw profiles.error;
      setUsers(((profiles.data??[]) as ProfileRow[]).map(serialize));
      if(!presence.error)setOnlineIds(new Set((presence.data??[]).map(row=>row.user_id as string)));
    }catch(error){
      setUsers(current=>current.length?current:[currentUser]);
      toast("error","Não foi possível carregar os usuários",error instanceof Error?error.message:"Tente novamente.");
    }finally{setLoading(false)}
  },[currentUser,supabase,toast]);

  useEffect(()=>{
    void loadUsers();
    const timer=window.setInterval(()=>void loadPresence(),30000);
    return()=>window.clearInterval(timer);
  },[loadPresence,loadUsers]);

  const normalizedQuery=query.trim().toLowerCase();
  const filtered=users.filter(user=>!normalizedQuery||[user.name,user.email,user.department,user.jobTitle,user.role].join(" ").toLowerCase().includes(normalizedQuery));
  const active=filtered.filter(user=>user.status==="ATIVO");
  const pending=filtered.filter(user=>user.status==="AGUARDANDO APROVAÇÃO");
  const rejected=filtered.filter(user=>user.status==="BLOQUEADO");
  const activeCount=users.filter(user=>user.status==="ATIVO").length;
  const pendingCount=users.filter(user=>user.status==="AGUARDANDO APROVAÇÃO").length;
  const onlineCount=users.filter(user=>user.status==="ATIVO"&&onlineIds.has(user.id)).length;
  const activeAdministrators=users.filter(user=>user.role==="ADMINISTRADOR"&&user.status==="ATIVO").length;

  const update=async(id:string,patch:Partial<UserProfile>)=>{
    const target=users.find(user=>user.id===id);if(!target)return;
    setSavingId(id);
    try{
      const updated=await updateManagedUser(id,patch);
      setUsers(current=>current.map(user=>user.id===id?updated:user));
      if(patch.status==="BLOQUEADO")setOnlineIds(current=>{const next=new Set(current);next.delete(id);return next});
      addAudit({operation:"Atualizou usuário",module:"Usuários",result:`${target.name}: ${Object.values(patch).join(", ")}`,status:"SUCESSO"});
      if(id===currentUser.id&&patch.role&&patch.role!==currentUser.role){toast("success","Perfil atualizado","As novas permissões serão carregadas agora.");window.setTimeout(()=>{window.location.href="/"},1000);return}
      if(patch.status==="ATIVO")toast("success","Usuário aprovado",`${target.name} já pode acessar o sistema.`);
      else if(patch.status==="BLOQUEADO")toast("success","Solicitação recusada",`${target.name} foi movido para recusados.`);
      else if(patch.status==="AGUARDANDO APROVAÇÃO")toast("success","Solicitação reaberta",`${target.name} voltou para pendentes.`);
      else toast("success","Perfil atualizado",`Novo perfil: ${patch.role}.`);
    }catch(caught){toast("error","Não foi possível atualizar o usuário",caught instanceof Error?caught.message:"Verifique sua conexão e tente novamente.")}
    finally{setSavingId("")}
  };
  const add=async()=>{
    if(!form.name||!form.email){toast("warning","Preencha nome e e-mail");return}
    try{const user=await inviteManagedUser(form);setUsers(current=>[...current,user].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")));toast("success","Convite enviado","A conta ficará aguardando aprovação.");setForm({name:"",email:"",department:"",jobTitle:"",role:"RH"});setFormOpen(false)}catch(caught){toast("error","Não foi possível adicionar",caught instanceof Error?caught.message:"Tente novamente.")}
  };

  const profileCell=(user:UserProfile)=><div className="profile-control"><select value={user.role} onChange={event=>void update(user.id,{role:event.target.value as Role})} disabled={savingId===user.id||(user.id===currentUser.id&&activeAdministrators===1)} aria-label={`Perfil de ${user.name}`}><option>ADMINISTRADOR</option><option>RH</option><option>CONSULTA</option></select>{user.id===currentUser.id&&<small>Seu perfil</small>}{savingId===user.id&&<small>Salvando...</small>}</div>;
  const identityCell=(user:UserProfile)=><div className="person-cell"><span className="avatar">{user.name.split(" ").slice(0,2).map(part=>part[0]).join("")}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></div>;

  const pendingTable=()=>pending.length?<div className="table-scroll"><table className="data-table users-table"><thead><tr><th>Usuário</th><th>Setor / cargo</th><th>Perfil</th><th>Status</th><th className="right">Ações</th></tr></thead><tbody>{pending.map(user=><tr key={user.id}><td>{identityCell(user)}</td><td>{user.department||"—"}<small className="block-muted">{user.jobTitle||"Sem cargo informado"}</small></td><td>{profileCell(user)}</td><td><StatusBadge status={user.status}/></td><td><div className="row-actions user-row-actions"><button className="user-action approve" disabled={savingId===user.id} onClick={()=>void update(user.id,{status:"ATIVO"})}><Check/> Aprovar</button><button className="user-action reject" disabled={savingId===user.id} onClick={()=>void update(user.id,{status:"BLOQUEADO"})}><UserX/> Recusar</button></div></td></tr>)}</tbody></table></div>:<div className="users-section-empty"><Check/><span><strong>Nenhuma aprovação pendente</strong><small>Novas solicitações aparecerão aqui.</small></span></div>;
  const activeTable=()=>active.length?<div className="table-scroll"><table className="data-table users-table"><thead><tr><th>Usuário</th><th>Setor / cargo</th><th>Perfil</th><th>Presença</th><th>Status</th></tr></thead><tbody>{active.map(user=><tr key={user.id}><td>{identityCell(user)}</td><td>{user.department||"—"}<small className="block-muted">{user.jobTitle||"Sem cargo informado"}</small></td><td>{profileCell(user)}</td><td><span className={`presence-pill ${onlineIds.has(user.id)?"online":"offline"}`}><i/>{onlineIds.has(user.id)?"Online":"Offline"}</span></td><td><StatusBadge status={user.status}/></td></tr>)}</tbody></table></div>:<EmptyState icon={<Users/>} title={loading?"Carregando usuários...":"Nenhum usuário ativo"} description={loading?"Consultando os perfis autorizados.":"Nenhum usuário corresponde à pesquisa."}/>;

  const rejectedTable=()=>rejected.length?<div className="table-scroll"><table className="data-table users-table"><thead><tr><th>Usuário</th><th>Setor / cargo</th><th>Perfil</th><th>Status</th><th className="right">Ações</th></tr></thead><tbody>{rejected.map(user=><tr key={user.id}><td>{identityCell(user)}</td><td>{user.department||"—"}<small className="block-muted">{user.jobTitle||"Sem cargo informado"}</small></td><td>{profileCell(user)}</td><td><span className="status-badge danger">RECUSADO</span></td><td><div className="row-actions user-row-actions"><button className="user-action reopen" disabled={savingId===user.id} onClick={()=>void update(user.id,{status:"AGUARDANDO APROVAÇÃO"})}><RotateCcw/> Reabrir</button></div></td></tr>)}</tbody></table></div>:null;

  return <>
    <div className="page-heading"><div><h2>Usuários e perfis</h2><p>Gerencie acessos, aprovações e presença em tempo real.</p></div><button className="button primary" onClick={()=>setFormOpen(true)}><UserPlus/> Adicionar usuário</button></div>
    {activeAdministrators===1&&currentUser.role==="ADMINISTRADOR"&&<div className="inline-warning users-access-warning"><ShieldCheck/><span><strong>Proteção do administrador principal</strong><small>Adicione ou promova outro Administrador ativo antes de alterar seu próprio perfil.</small></span></div>}
    <div className="users-kpi-grid">
      <article className="users-kpi-card"><span className="users-kpi-icon active"><UserCheck/></span><div><small>USUÁRIOS APROVADOS</small><strong>{loading?"—":activeCount}</strong><p>Contas aprovadas</p></div></article>
      <article className="users-kpi-card"><span className="users-kpi-icon online"><Wifi/></span><div><small>ONLINE AGORA</small><strong>{loading?"—":onlineCount}</strong><p>Sessões ativas agora</p></div></article>
      <article className={`users-kpi-card ${pendingCount?"attention":""}`}><span className="users-kpi-icon pending"><Clock3/></span><div><small>PENDENTES</small><strong>{loading?"—":pendingCount}</strong><p>{pendingCount?"Aguardando sua decisão":"Nenhuma pendência"}</p></div></article>
    </div>
    <section className="surface users-filter-surface"><div className="table-toolbar users-toolbar"><div className="search-box"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Pesquisar por nome, e-mail, setor ou perfil"/></div><span>{filtered.length} usuário(s)</span></div></section>

    <section className="surface users-section pending-section"><div className="section-header"><div><h3>Solicitações pendentes</h3><p>Revise os dados e aprove ou recuse novos acessos.</p></div><span className={`users-count-pill ${pendingCount?"warning":"neutral"}`}>{pendingCount} pendente(s)</span></div>{pendingTable()}</section>

    <section className="surface users-section"><div className="section-header"><div><h3>Usuários ativos</h3><p>Perfis aprovados com indicador de presença.</p></div><span className="users-count-pill success">{activeCount} ativo(s)</span></div>{activeTable()}</section>

    {rejected.length>0&&<section className="surface users-section rejected-section"><div className="section-header"><div><h3>Solicitações recusadas</h3><p>Acessos recusados podem ser reabertos para nova análise.</p></div><span className="users-count-pill danger">{rejected.length} recusado(s)</span></div>{rejectedTable()}</section>}

    {formOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setFormOpen(false)}}><div className="modal form-modal" role="dialog" aria-modal="true"><h3>Novo usuário</h3><p>A conta será criada como aguardando aprovação.</p><label className="field"><span>Nome completo</span><input value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label><label className="field"><span>E-mail</span><input type="email" value={form.email} onChange={event=>setForm({...form,email:event.target.value})}/></label><div className="two-fields"><label className="field grow"><span>Setor</span><input value={form.department} onChange={event=>setForm({...form,department:event.target.value})}/></label><label className="field grow"><span>Cargo</span><input value={form.jobTitle} onChange={event=>setForm({...form,jobTitle:event.target.value})}/></label></div><label className="field"><span>Perfil</span><select value={form.role} onChange={event=>setForm({...form,role:event.target.value as Role})}><option>RH</option><option>CONSULTA</option><option>ADMINISTRADOR</option></select></label><div className="modal-actions"><button className="button secondary" onClick={()=>setFormOpen(false)}>Cancelar</button><button className="button primary" onClick={()=>void add()}>Adicionar</button></div></div></div>}
  </>;
}
