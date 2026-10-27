"use client";

import { useState } from "react";
import { Check, FileSpreadsheet, Trash2, Upload } from "lucide-react";
import { removePayrollMonth } from "../../../src/services/browser-backend";
import { ConfirmationModal, EmptyState, MetricCard, StatusBadge } from "../components/Common";
import { PayrollImport } from "./PayrollImport";
import { PayrollSourceList } from "./PayrollSourceList";
import { useApp } from "../state/AppContext";

type Tab = "overview" | "imports";
const tabs: { id: Tab; label: string }[] = [{ id:"overview",label:"Visão geral"},{id:"imports",label:"Importações"}];

export function PayrollPage({ initialTab }: { initialTab?: Tab } = {}) {
  const app = useApp();
  const [chosenTab, setTab] = useState<Tab|undefined>(initialTab);
  const tab=chosenTab??(app.activePayroll?"overview":"imports");
  const [removeOpen, setRemoveOpen] = useState(false);
  const formats=new Set((app.activePayroll?.sources?.map(source=>source.fileName)??(app.activePayroll?[app.activePayroll.fileName]:[])).map(name=>/\.pdf$/i.test(name)?"PDF":"XLS"));
  const formatLabel=formats.size>1?"MIX":([...formats][0]??"XLS");
  return <>
    <div className="page-heading compact"><div><h2>Dados da Folha</h2><p>Importe as folhas das empresas/unidades e confira o consolidado da competência.</p></div><label className="field competence-filter"><span>COMPETÊNCIA EM EXIBIÇÃO</span><select value={app.selectedCompetence??""} disabled={app.payrollLoading||!app.payrollMonths.length} onChange={event=>void app.selectCompetence(event.target.value)}>{!app.payrollMonths.length&&<option value="">Nenhuma competência</option>}{app.payrollMonths.map(month=><option key={month.id} value={month.competence}>{month.competence}</option>)}</select><small>{app.payrollLoading?"Carregando dados...":`${app.payrollMonths.length} competência(s) disponível(is)`}</small></label></div>
    {app.activePayroll && <div className="payroll-summary"><span className="document-icon">{formatLabel}</span><div><small>FOLHAS DA COMPETÊNCIA</small><strong>{app.activePayroll.sources?.length?`${app.activePayroll.sources.length} folha(s) importada(s)`:app.activePayroll.fileName}</strong><em>{app.activePayroll.records.length} CPFs únicos no consolidado</em></div><div><small>COMPETÊNCIA</small><strong>{app.activePayroll.competence}</strong></div><div><small>IMPORTADA EM</small><strong>{new Date(app.activePayroll.importedAt).toLocaleDateString("pt-BR")}</strong><em>{new Date(app.activePayroll.importedAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</em></div><div><small>USUÁRIO</small><strong>{app.activePayroll.importedBy}</strong></div><button className="button secondary" onClick={() => setTab("imports")}><Upload size={15}/> Adicionar folhas</button>{app.user.role==="ADMINISTRADOR"&&<button className="icon-danger" title="Remover todas as folhas desta competência" onClick={() => setRemoveOpen(true)}><Trash2 size={17}/></button>}</div>}
    <div className="tabs">{tabs.map(item => <button className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {tab === "overview" && <PayrollOverview />}
    {tab === "imports" && <PayrollImport onDone={() => setTab("overview")} />}
    <ConfirmationModal open={removeOpen} danger title="Remover esta competência do banco?" description="Todas as folhas e os comparativos de Saúde/Odonto deste mês serão removidos para toda a equipe. O arquivo original privado, quando existir, segue sua própria política de retenção." confirmLabel="Remover competência" onClose={() => setRemoveOpen(false)} onConfirm={() => { const current=app.activePayroll; if(!current)return; void removePayrollMonth(current.competence).then(async()=>{app.addAudit({operation:"Removeu competência da folha",module:"Folha",result:`Competência ${current.competence} removida`,status:"AVISO"});app.toast("success","Competência removida");await app.refreshPayrollMonths();if(!app.payrollMonths.length)setTab("imports");}).catch(error=>app.toast("error","Não foi possível remover a competência",error instanceof Error?error.message:undefined)); }} />
  </>;
}
function PayrollOverview() {
  const { activePayroll, health, dental } = useApp();
  if (!activePayroll) return <EmptyState icon={<FileSpreadsheet/>} title="Importe a Folha de Pagamento" description="A folha ativa será usada pelos comparativos de saúde, odontológico e benefícios." />;
  const healthColumns = Math.max(0, ...activePayroll.records.map(record => record.healthColumns));
  const dentalColumns = Math.max(0, ...activePayroll.records.map(record => record.dentalColumns));
  return <div className="stack-gap"><div className="metrics-grid"><MetricCard label="COLABORADORES" value={activePayroll.records.length} detail="CPFs únicos de todas as folhas"/><MetricCard label="COLUNAS PLANO SAÚDE" value={healthColumns} detail="somadas por CPF" tone={healthColumns ? "success":"warning"}/><MetricCard label="COLUNAS PLANO ODONTO" value={dentalColumns} detail="somadas por CPF" tone={dentalColumns ? "success":"warning"}/><MetricCard label="CONFERÊNCIAS" value={[health,dental].filter(Boolean).length} detail="de 2 concluídas"/></div><PayrollSourceList/><section className="surface"><div className="section-header"><div><h3>Diagnóstico da importação</h3><p>Detecção automática de estrutura e colunas.</p></div><StatusBadge status="PROCESSAMENTO CONCLUÍDO"/></div><div className="diagnostic-list">{activePayroll.logs.map((log,index)=><div key={index}><Check size={14}/><span>{log}</span></div>)}</div></section></div>;
}
