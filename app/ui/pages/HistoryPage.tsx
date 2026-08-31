"use client";

import { useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import { useApp } from "../state/AppContext";
import { EmptyState, StatusBadge } from "../components/Common";

export function HistoryPage(){const{audits}=useApp();const[query,setQuery]=useState("");const filtered=useMemo(()=>audits.filter(item=>[item.user,item.operation,item.module,item.result,item.fileName].join(" ").toLowerCase().includes(query.toLowerCase())),[audits,query]);return <><div className="page-heading"><div><h2>Histórico e auditoria</h2><p>Rastreamento de operações sem registrar senhas ou conteúdo sensível desnecessário.</p></div></div><section className="surface table-surface"><div className="table-toolbar"><div className="search-box"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Pesquisar usuário, operação ou módulo"/></div><span>{filtered.length} registro(s)</span></div>{filtered.length?<div className="audit-timeline">{filtered.map(item=><article key={item.id}><span className={`timeline-dot ${item.status.toLowerCase()}`}/><div><div><strong>{item.operation}</strong><StatusBadge status={item.status}/></div><p>{item.result}</p><small>{item.user} · {item.module} · {new Date(item.timestamp).toLocaleString("pt-BR")}</small></div></article>)}</div>:<EmptyState icon={<History/>} title="Nenhum evento registrado" description="As atividades realizadas nesta sessão aparecerão aqui e serão enviadas ao log seguro."/>}</section></>}
