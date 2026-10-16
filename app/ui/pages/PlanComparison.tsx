"use client";

import { useMemo, useState } from "react";
import { Download, HeartPulse, Search, Stethoscope, Trash2, Upload } from "lucide-react";
import type { ComparisonRow } from "../../../src/types";
import { exportComparisonExcel } from "../../../src/services/excel";
import { removePayrollComparison } from "../../../src/services/browser-backend";
import type { ComparisonKind } from "../../../src/modules/comparisons/processor";
import { comparePlanBase, latestPlanBase, type PlanBaseVersion } from "../../../src/modules/benefits/plan-base";
import { formatCpf } from "../../../src/utils/cpf";
import { formatMoney } from "../../../src/utils/money";
import { ConfirmationModal, EmptyState, MetricCard, StatusBadge } from "../components/Common";
import { useApp } from "../state/AppContext";

type PlanComparisonProps = {kind:ComparisonKind;onImport?:()=>void;baseVersions?:readonly PlanBaseVersion[];baseLoading?:boolean;baseError?:string};
export function PlanComparison({kind,onImport,...baseProps}:PlanComparisonProps) {
  const {activePayroll}=useApp();
  return <PlanComparisonContent key={`${kind}:${activePayroll?.id??"no-payroll"}`} kind={kind} onImport={onImport} {...baseProps}/>;
}

function PlanComparisonContent({kind,onImport,baseVersions,baseLoading,baseError}:PlanComparisonProps) {
  const app=useApp();
  const savedState=kind==="health"?app.savedHealth:app.savedDental;
  const setState=kind==="health"?app.setSavedHealth:app.setSavedDental;
  const label=kind==="health"?"Plano de Saúde":"Plano Odontológico";
  const valueLabel=kind==="health"?"Saúde Folha":"Odonto Folha";
  const [toleranceDraft,setToleranceDraft]=useState<{value:string;defaultValue:number}|null>(null);
  const [busy,setBusy]=useState(false),[removeOpen,setRemoveOpen]=useState(false);
  const [query,setQuery]=useState(""),[filter,setFilter]=useState("TODOS"),[page,setPage]=useState(1);
  const tolerance=toleranceDraft?.defaultValue===app.settings.financialTolerance?toleranceDraft.value:app.settings.financialTolerance.toFixed(2).replace(".",",");
  const toleranceValue=tolerance.trim()?Number(tolerance.replace(",",".")):NaN;
  const validTolerance=Number.isFinite(toleranceValue)&&toleranceValue>=0;
  const currentBase=useMemo(()=>baseVersions?latestPlanBase(baseVersions.filter(row=>row.kind===kind)):[],[baseVersions,kind]);
  const pendingCpfs=useMemo(()=>new Set(currentBase.filter(row=>row.status==="PENDENTE").map(row=>row.cpf)),[currentBase]);
  // Viewing a result performs no writes; saved snapshots never replace the live calculation.
  const result=useMemo(()=>!app.payrollLoading&&app.activePayroll&&!baseLoading&&!baseError&&baseVersions&&currentBase.length&&validTolerance
    ?comparePlanBase(app.activePayroll,baseVersions,kind,toleranceValue):null,
  [app.payrollLoading,app.activePayroll,baseLoading,baseError,baseVersions,currentBase.length,validTolerance,kind,toleranceValue]);
  const filtered=useMemo(()=>{
    const text=query.trim().toLocaleLowerCase("pt-BR"),digits=text.replace(/\D/g,"");
    return(result?.rows??[]).filter(row=>(!text||row.name.toLocaleLowerCase("pt-BR").includes(text)||Boolean(digits&&row.cpf.includes(digits)))&&
      (filter==="TODOS"||(filter==="OK"&&row.status==="OK")||(filter==="DIVERGENTES"&&row.status==="DIVERGENTE")||(filter==="AUSENTES"&&row.status.includes("NÃO LOCALIZADO"))));
  },[result,query,filter]);
  const perPage=20,totalPages=Math.max(1,Math.ceil(filtered.length/perPage)),currentPage=Math.min(page,totalPages);
  const visible=filtered.slice((currentPage-1)*perPage,currentPage*perPage);
  const removeSaved=async()=>{
    if(!app.activePayroll||busy)return;
    setBusy(true);
    try {
      await removePayrollComparison(app.activePayroll.id,kind);setState(null);
      app.addAudit({operation:`Removeu ${label}`,module:label,result:`Competência ${app.activePayroll.competence}: resultado salvo excluído`,status:"AVISO"});
      app.toast("success","Resultado salvo excluído","A conferência automática, a base e a folha continuam disponíveis.");
    }catch(error){app.toast("error","Não foi possível excluir o resultado salvo",error instanceof Error?error.message:undefined);}finally{setBusy(false);}
  };
  if(app.payrollLoading)return <EmptyState icon={kind==="health"?<HeartPulse/>:<Stethoscope/>} title="Carregando folha da competência..." description="A conferência será exibida automaticamente após o carregamento."/>;
  if(!app.activePayroll)return <EmptyState icon={kind==="health"?<HeartPulse/>:<Stethoscope/>} title="A Folha de Pagamento é obrigatória" description="Importe a folha em Dados da Folha → Importações. Depois, selecione a competência para comparar com a Base de dados do plano, sem enviar outro arquivo." action={onImport?<button className="button primary" onClick={onImport}><Upload size={16}/> Importar Folha de Pagamento</button>:undefined}/>;
  return <div className="stack-gap plan-monthly-comparison">
    <section className="surface plan-base-comparison"><div><h3>Conferência automática · {label}</h3><p>Folha: <strong>{app.activePayroll.competence}</strong> · {currentBase.filter(row=>row.status==="ATIVO").length} cadastro(s) ativo(s) na base atual. O desconto da folha é comparado por CPF com o valor previsto na Base de dados deste plano.</p><p>Usa o cadastro mais recente de cada CPF, mesmo que a data da base seja diferente da folha. O resultado é calculado automaticamente para toda a equipe autorizada, sem precisar salvar. Alterações na base são consultadas novamente ao voltar à aba e a cada minuto.</p>{pendingCpfs.size>0&&<p className="plan-base-pending">{pendingCpfs.size} CPF(s) pendentes RH: valor de referência desconhecido, sem soma ou desconto presumido.</p>}</div><label className="field"><span>Tolerância (R$)</span><input aria-label="Tolerância da conferência pela base" inputMode="decimal" value={tolerance} onChange={event=>setToleranceDraft({value:event.target.value,defaultValue:app.settings.financialTolerance})}/></label></section>
    {baseLoading?<EmptyState title="Carregando a Base de dados..." description="O resultado aparecerá automaticamente quando a base estiver disponível."/>:baseError?<div className="plan-base-error" role="alert">{baseError}</div>:!currentBase.length?<EmptyState title="Nenhum cadastro na Base de dados deste plano" description="Cadastre ou importe a base na aba Base de dados. Depois, ela poderá ser comparada com qualquer folha do sistema, independentemente do mês."/>:!validTolerance?<div className="plan-base-error" role="alert">Informe uma tolerância válida, maior ou igual a zero.</div>:result&&<>
      <div className="result-title"><div><span className="status-badge success">CÁLCULO AUTOMÁTICO</span><h3>Resultado · {label}</h3><p>Competência: {app.activePayroll.competence} · Referência: Base de dados atual · Diferença = desconto na folha menos desconto previsto.</p></div><div><button className="button primary" onClick={()=>exportComparisonExcel(result.rows,`Comparativo_${kind}_${app.activePayroll?.competence.replace("/","-")}.xlsx`,label)}><Download size={16}/> Gerar Excel</button></div></div>
      <div className="metrics-grid five"><MetricCard label="CPFS COMPARADOS" value={result.summary.total}/><MetricCard label="VALORES OK" value={result.summary.ok} tone="success"/><MetricCard label="DIVERGÊNCIAS" value={result.summary.divergent} tone="danger"/><MetricCard label="AUSENTES / PENDENTES" value={result.summary.missing} tone="warning"/><MetricCard label="DIFERENÇA TOTAL" value={formatMoney(result.summary.differenceTotal)} tone={Math.abs(result.summary.differenceTotal)>toleranceValue?"danger":"success"}/></div>
      <section className="surface table-surface plan-live-result" aria-label="Conferência automática pela base"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input aria-label="Pesquisar conferência por nome ou CPF" placeholder="Pesquisar nome ou CPF" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}}/></div><div className="filter-pills">{["TODOS","OK","DIVERGENTES","AUSENTES"].map(item=><button className={filter===item?"active":""} key={item} onClick={()=>{setFilter(item);setPage(1);}}>{item}</button>)}</div><span>{filtered.length} resultado(s)</span></div><ComparisonTable rows={visible} valueLabel={valueLabel} pendingCpfs={pendingCpfs}/><div className="pagination"><span>Página {currentPage} de {totalPages}</span><div><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Anterior</button><button disabled={currentPage===totalPages} onClick={()=>setPage(currentPage+1)}>Próxima</button></div></div></section>
    </>}
    {savedState&&<details className="surface plan-saved-result"><summary>Comparativo anterior (histórico) · {new Date(savedState.processedAt).toLocaleString("pt-BR")}</summary><div className="section-header"><div><h3>Resultado salvo · {label}</h3><p>Competência: {app.activePayroll.competence} · Referência: {savedState.fileName} · {savedState.processedBy}. Este registro não muda ao abrir a tela ou editar a base.</p></div><button className="button danger" disabled={busy} onClick={()=>setRemoveOpen(true)}><Trash2 size={15}/> Excluir resultado salvo</button></div><ComparisonTable rows={savedState.rows} valueLabel={valueLabel}/></details>}
    <ConfirmationModal open={removeOpen} danger title={`Excluir o resultado salvo de ${label} de ${app.activePayroll.competence}?`} description="Somente o comparativo salvo será removido para a equipe. A conferência automática, a Base de dados e a Folha de Pagamento não serão alteradas." confirmLabel="Excluir resultado salvo" onClose={()=>setRemoveOpen(false)} onConfirm={()=>void removeSaved()}/>
  </div>;
}

function ComparisonTable({rows,valueLabel,pendingCpfs}:{rows:ComparisonRow[];valueLabel:string;pendingCpfs?:ReadonlySet<string>}) {
  const {settings}=useApp();
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>Nome</th><th>CPF</th><th className="right">{valueLabel}</th><th className="right">Previsto na base</th><th className="right">Diferença</th><th className="right">Líquido</th><th className="center">Colunas</th><th>Status</th></tr></thead><tbody>{rows.map(row=><tr className={row.status==="DIVERGENTE"?"row-danger":row.status.includes("NÃO LOCALIZADO")?"row-warning":""} key={row.id}><td><strong>{row.name}</strong></td><td className="mono">{formatCpf(row.cpf,settings.maskCpf)}</td><td className="right">{formatMoney(row.payrollValue)}</td><td className="right">{formatMoney(row.referenceValue)}</td><td className={`right ${row.difference&&Math.abs(row.difference)>.01?"negative":"positive"}`}>{formatMoney(row.difference)}</td><td className="right">{formatMoney(row.liquid)}</td><td className="center">{row.columnCount}</td><td><StatusBadge status={pendingCpfs?.has(row.cpf)?"PENDENTE RH":row.status==="NÃO LOCALIZADO NA REFERÊNCIA"?"SEM VALOR PREVISTO NA BASE":row.status}/></td></tr>)}</tbody></table>{!rows.length&&<div className="table-empty">Nenhum registro corresponde aos filtros aplicados.</div>}</div>;
}

