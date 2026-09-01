"use client";

import { useEffect, useState } from "react";
import { Check, Search, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import type { Role, UserProfile } from "../../../src/types";
import { EmptyState, StatusBadge } from "../components/Common";
import { useApp } from "../state/AppContext";

export function UsersPage(){
  const{user:currentUser,toast,addAudit}=useApp();
  const[users,setUsers]=useState<UserProfile[]>([]);
  const[query,setQuery]=useState("");
  const[formOpen,setFormOpen]=useState(false);
  const[loading,setLoading]=useState(true);
  const[savingId,setSavingId]=useState("");
  const[form,setForm]=useState({name:"",email:"",department:"",jobTitle:"",role:"RH" as Role});

  useEffect(()=>{
    fetch("/api/users").then(async response=>{
      if(!response.ok)throw new Error();
      return await response.json() as {users:UserProfile[]};
    }).then(data=>setUsers(data.users)).catch(()=>setUsers([currentUser])).finally(()=>setLoading(false));
  },[currentUser]);

  const filtered=users.filter(user=>[user.name,user.email,user.department,user.role].join(" ").toLowerCase().includes(query.toLowerCase()));
  const activeAdministrators=users.filter(user=>user.role==="ADMINISTRADOR"&&user.status==="ATIVO").length;

  const update=async(id:string,patch:Partial<UserProfile>)=>{
    const target=users.find(user=>user.id===id);
    if(!target)return;
    setSavingId(id);
    try{
      const response=await fetch("/api/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,...patch})});
      const data=await response.json() as {error?:string;user?:UserProfile};
      if(!response.ok){toast("error","Não foi possível atualizar o usuário",data.error??"Tente novamente.");return}
      const updated=data.user??{...target,...patch};
      setUsers(current=>current.map(user=>user.id===id?updated:user));
      addAudit({operation:"Atualizou usuário",module:"Usuários",result:`${target.name}: ${Object.values(patch).join(", ")}`,status:"SUCESSO"});
      if(id===currentUser.id&&patch.role&&patch.role!==currentUser.role){
        toast("success","Perfil atualizado","As novas permissões serão carregadas agora.");
        window.setTimeout(()=>{window.location.href="/"},1000);
      }else toast("success","Usuário atualizado",patch.role?`Novo perfil: ${patch.role}.`:`Novo status: ${patch.status}.`);
    }catch{toast("error","Não foi possível atualizar o usuário","Verifique sua conexão e tente novamente.")}
    finally{setSavingId("")}
  };

  const add=async()=>{
    if(!form.name||!form.email){toast("warning","Preencha nome e e-mail");return}
    const response=await fetch("/api/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});
    const data=await response.json() as {error?:string;user:UserProfile};
    if(!response.ok){toast("error","Não foi possível adicionar",data.error);return}
    setUsers(current=>[...current,data.user]);
    toast("success","Usuário adicionado","A conta ficará aguardando aprovação.");
    setForm({name:"",email:"",department:"",jobTitle:"",role:"RH"});
    setFormOpen(false);
  };

  return <>
    <div className="page-heading"><div><h2>Usuários e perfis</h2><p>Acesso por função: Administrador, RH e Consulta.</p></div><button className="button primary" onClick={()=>setFormOpen(true)}><UserPlus/> Adicionar usuário</button></div>
    {activeAdministrators===1&&users.some(user=>user.id===currentUser.id&&user.role==="ADMINISTRADOR")&&<div className="inline-warning users-access-warning"><ShieldCheck/><span><strong>Proteção do administrador principal</strong><small>Para alterar seu próprio perfil, primeiro adicione ou promova outro Administrador e deixe-o ativo. Assim o sistema nunca fica sem administração.</small></span></div>}
    <section className="surface table-surface">
      <div className="table-toolbar"><div className="search-box"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Pesquisar usuário"/></div><span>{filtered.length} usuário(s)</span></div>
      {filtered.length?<div className="table-scroll"><table className="data-table"><thead><tr><th>Usuário</th><th>Setor / cargo</th><th>Perfil</th><th>Status</th><th>Ações</th></tr></thead><tbody>{filtered.map(user=><tr key={user.id}>
        <td><div className="person-cell"><span className="avatar">{user.name.split(" ").slice(0,2).map(part=>part[0]).join("")}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></div></td>
        <td>{user.department}<small className="block-muted">{user.jobTitle}</small></td>
        <td><div className="profile-control"><select value={user.role} onChange={event=>update(user.id,{role:event.target.value as Role})} disabled={savingId===user.id} aria-label={`Perfil de ${user.name}`}><option>ADMINISTRADOR</option><option>RH</option><option>CONSULTA</option></select>{user.id===currentUser.id&&<small>Seu perfil</small>}{savingId===user.id&&<small>Salvando...</small>}</div></td>
        <td><StatusBadge status={user.status}/></td>
        <td><div className="row-actions">{user.status==="AGUARDANDO APROVAÇÃO"&&<button className="approve" disabled={savingId===user.id} onClick={()=>update(user.id,{status:"ATIVO"})}><Check/> Aprovar</button>}{user.id!==currentUser.id&&<button disabled={savingId===user.id} onClick={()=>update(user.id,{status:user.status==="BLOQUEADO"?"ATIVO":"BLOQUEADO"})}>{user.status==="BLOQUEADO"?<><ShieldCheck/> Reativar</>:<><X/> Bloquear</>}</button>}</div></td>
      </tr>)}</tbody></table></div>:<EmptyState icon={<Users/>} title={loading?"Carregando usuários...":"Nenhum usuário encontrado"} description={loading?"Consultando os perfis autorizados.":"Tente outro termo de pesquisa."}/>}
    </section>
    {formOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setFormOpen(false)}}><div className="modal form-modal" role="dialog" aria-modal="true"><h3>Novo usuário</h3><p>A conta será criada como aguardando aprovação.</p><label className="field"><span>Nome completo</span><input value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label><label className="field"><span>E-mail</span><input type="email" value={form.email} onChange={event=>setForm({...form,email:event.target.value})}/></label><div className="two-fields"><label className="field grow"><span>Setor</span><input value={form.department} onChange={event=>setForm({...form,department:event.target.value})}/></label><label className="field grow"><span>Cargo</span><input value={form.jobTitle} onChange={event=>setForm({...form,jobTitle:event.target.value})}/></label></div><label className="field"><span>Perfil</span><select value={form.role} onChange={event=>setForm({...form,role:event.target.value as Role})}><option>RH</option><option>CONSULTA</option><option>ADMINISTRADOR</option></select></label><div className="modal-actions"><button className="button secondary" onClick={()=>setFormOpen(false)}>Cancelar</button><button className="button primary" onClick={add}>Adicionar</button></div></div></div>}
  </>;
}
