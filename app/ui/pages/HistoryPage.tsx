"use client";

import { useMemo, useState } from "react";
import { History, Search, Trash2 } from "lucide-react";
import { useApp } from "../state/AppContext";
import { ConfirmationModal, EmptyState, StatusBadge } from "../components/Common";

export function HistoryPage(){
  const{audits,user,clearAudits,toast}=useApp();
  const[query,setQuery]=useState("");const[confirmOpen,setConfirmOpen]=useState(false);const[busy,setBusy]=useState(false);
  const filtered=useMemo(()=>audits.filter(item=>[item.user,item.operation,item.module,item.result,item.fileName].join(" ").toLowerCase().includes(query.toLowerCase())),[audits,query]);
  const isAdmin=user.role==="ADMINISTRADOR"&&user.status==="ATIVO";
  const clearHistory=async()=>{setBusy(true);try{const removed=await clearAudits();setQuery("");toast("success","Histórico limpo",`${removed} registro(s) anterior(es) foram removidos. A ação de limpeza permaneceu registrada.`);}catch(error){toast("error","Não foi possível limpar o histórico",error instanceof Error?error.message:"Tente novamente.");}finally{setBusy(false)}};
  return <><div className="page-heading"><div><h2>Histórico e auditoria</h2><p>Rastreamento de operações sem registrar senhas ou conteúdo sensível desnecessário.</p></div>{isAdmin&&<button className="button danger" disabled={busy||!audits.length} onClick={()=>setConfirmOpen(true)}><Trash2 size={16}/>{busy?"Limpando...":"Limpar histórico"}</button>}</div>
    <section className="surface table-surface"><div className="table-toolbar"><div className="search-box"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Pesquisar usuário, operação ou módulo"/></div><span>{filtered.length} registro(s)</span></div>{filtered.length?<div className="audit-timeline">{filtered.map(item=><article key={item.id}><span className={`timeline-dot ${item.status.toLowerCase()}`}/><div><div><strong>{item.operation}</strong><StatusBadge status={item.status}/></div><p>{item.result}</p><small>{item.user} · {item.module} · {new Date(item.timestamp).toLocaleString("pt-BR")}</small></div></article>)}</div>:<EmptyState icon={<History/>} title="Nenhum evento registrado" description="As atividades realizadas nesta sessão aparecerão aqui e serão enviadas ao log seguro."/>}</section>
    <ConfirmationModal open={confirmOpen} danger title="Limpar histórico de auditoria?" description="Todos os registros anteriores serão removidos. Esta ação é exclusiva de Administrador e o evento da própria limpeza permanecerá registrado para rastreabilidade." confirmLabel="Limpar histórico" onClose={()=>setConfirmOpen(false)} onConfirm={()=>void clearHistory()}/>
  </>;
}
