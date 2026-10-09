"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Download, RefreshCw, Search, Users, AlertTriangle } from "lucide-react";
import type { Employee, EmployeeStatus } from "../../../src/types";
import { employeeUnit, isValidCompetence, monthShift, movementMonthlySummary, type MovementScope } from "../../../src/modules/employees/movements";
import { formatCpf } from "../../../src/utils/cpf";
import { downloadFile } from "../../../src/utils/download";
import { StatusBadge } from "../components/Common";
import { useApp } from "../state/AppContext";

type ReportView = "MOVEMENTS" | "ROSTER";
type StatusFilter = "ALL" | EmployeeStatus;
const thisMonth = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
};
const dateLabel = (s: string | null) => s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4) : "Não informado";
const terminationLabel = (employee: Employee) => employee.terminationDate ? dateLabel(employee.terminationDate) : employee.status === "ATIVO" ? "Vínculo ativo" : "Não informado";
const monthLabel=(s:string)=>{const [y,m]=s.split("-").map(Number);return new Date(y,m-1,1).toLocaleDateString("pt-BR",{month:"short",year:"numeric"});};
const cpfSearch=(s:string)=>s.replace(/\D/g,"");
const entryLabel=(kind:MovementScope)=>kind==="ADMISSION"?"Admissões":kind==="TERMINATION"?"Desligamentos":"Entradas e saídas";

export function EmployeeMovementsPanel({ employees, loading, onSync, syncing, lastSync }:{
  employees:Employee[]; loading:boolean; onSync:()=>void; syncing:boolean; lastSync:string|null;
}) {
  const app=useApp();
  const [competence,setCompetence]=useState(thisMonth);
  const [unit,setUnit]=useState("");
  const [status,setStatus]=useState<StatusFilter>("ALL");
  const [query,setQuery]=useState("");
  const [scope,setScope]=useState<MovementScope>("ALL");
  const [view,setView]=useState<ReportView>("MOVEMENTS");
  const [limit,setLimit]=useState(100);
  const [exporting,setExporting]=useState(false);

  const units=useMemo(()=>[...new Set(employees.map(employeeUnit))].sort((a,b)=>a.localeCompare(b,"pt-BR")),[employees]);
  const filtered=useMemo(()=>{
    const q=query.trim().toLocaleLowerCase("pt-BR"),digits=cpfSearch(query);
    return employees.filter(e=>(!unit||employeeUnit(e)===unit)
      &&(status==="ALL"||e.status===status)
      &&(!q||e.name.toLocaleLowerCase("pt-BR").includes(q)
        ||e.department.toLocaleLowerCase("pt-BR").includes(q)
        ||e.registration.toLocaleLowerCase("pt-BR").includes(q)
        ||(digits.length>0&&e.cpf.includes(digits))));
  },[employees,unit,status,query]);
  const summary=useMemo(()=>movementMonthlySummary(filtered,competence),[filtered,competence]);
  const events=useMemo(()=>summary.movementRows.filter(row=>scope==="ALL"||row.kind===scope),[summary,scope]);
  const roster=useMemo(()=>[...filtered].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")),[filtered]);
  const currentCount=view==="MOVEMENTS"?events.length:roster.length;
  const showing=Math.min(currentCount,limit);
  const monthChart=useMemo(()=>Array.from({length:6},(_,i)=>{
    const key=monthShift(competence,i-5);
    const item=movementMonthlySummary(filtered,key);
    return{key,label:monthLabel(key),entered:item.admissions,exited:item.terminations};
  }),[filtered,competence]);
  const chartMax=Math.max(1,...monthChart.flatMap(row=>[row.entered,row.exited]));
  const hasMissingDates=summary.missingAdmission>0||summary.missingTermination>0;

  const changeMonth=(value:string)=>{
    if(!isValidCompetence(value))return;
    setCompetence(value);
    setLimit(100);
  };
  const exportExcel=async()=>{
    if(!filtered.length||exporting)return;
    setExporting(true);
    try{
      const XLSX=await import("xlsx");
      const wb=XLSX.utils.book_new();
      wb.Props={Author:"RH Controle",Title:"Movimentações de funcionários "+competence};
      const rows=(items:Employee[])=>items.map(e=>[
        e.name,app.settings.maskCpf?formatCpf(e.cpf,true):e.cpf,e.registration||"",employeeUnit(e),e.department,e.jobTitle,
        dateLabel(e.admissionDate).replace("Não informado",""),
        terminationLabel(e).replace("Não informado",""),
        e.status,e.source==="QUARK"?"QuarkRH":"Manual"
      ]);
      const header=["Funcionário","CPF","Matrícula","Unidade / Empresa","Setor","Cargo","Admissão","Desligamento","Situação atual","Origem"];
      const addSheet=(name:string,items:Employee[])=>{
        const ws=XLSX.utils.aoa_to_sheet([header,...rows(items)]);
        ws["!cols"]=[{wch:39},{wch:17},{wch:15},{wch:36},{wch:32},{wch:28},{wch:15},{wch:15},{wch:18},{wch:12}];
        ws["!autofilter"]={ref:"A1:J"+(items.length+1)};
        for(let i=2;i<=items.length+1;i++){
          const c=ws["B"+i];
          if(c){c.t="s";c.z="@";c.v=app.settings.maskCpf?String(c.v??""):String(c.v||"").replace(/\D/g,"").padStart(11,"0")}
        }
        XLSX.utils.book_append_sheet(wb,ws,name);
      };
      const admitted=summary.movementRows.filter(row=>row.kind==="ADMISSION").map(row=>row.employee);
      const departed=summary.movementRows.filter(row=>row.kind==="TERMINATION").map(row=>row.employee);
      const overview=XLSX.utils.aoa_to_sheet([
        ["RELATÓRIO DE MOVIMENTAÇÃO DE FUNCIONÁRIOS"],
        ["Competência",competence],["Unidade",unit||"Todas"],["Situação atual",status==="ALL"?"Todas":status],
        ["Pesquisa",query||"Sem filtro"],["Admissões no mês",summary.admissions],
        ["Desligamentos no mês",summary.terminations],["Saldo",summary.net],
        ["Ativos atualmente",summary.activeNow],["Desligados atualmente",summary.terminatedNow],
        ["Cadastros sem admissão informada",summary.missingAdmission],
        ["Desligados sem data de saída",summary.missingTermination],
        ["Observação","Relatório por datas de admissão/desligamento do cadastro atual; não é histórico de todos os vínculos."]
      ]);
      overview["!cols"]=[{wch:40},{wch:77}];
      XLSX.utils.book_append_sheet(wb,overview,"Resumo");
      addSheet("Admissões",admitted);
      addSheet("Desligamentos",departed);
      addSheet("Cadastro completo",roster);
      const data=XLSX.write(wb,{bookType:"xlsx",type:"array",compression:true});
      downloadFile(data,"movimentacao_funcionarios_"+competence+".xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      app.toast("success","Relatório Excel gerado",`${admitted.length} admissão(ões) e ${departed.length} desligamento(s).`);
    }catch(err){app.toast("error","Não foi possível exportar",err instanceof Error?err.message:"Tente novamente.");}
    finally{setExporting(false);}
  };

  return <section className="surface table-surface employee-movements-panel">
    <div className="section-header movements-title">
      <div><h3>Movimentação de funcionários</h3><p>Entradas e saídas por data oficial do cadastro QuarkRH, com situação atual e histórico mensal.</p>
        {lastSync&&<small className="block-muted">Última sincronização: {new Date(lastSync).toLocaleString("pt-BR")}</small>}
      </div>
      <div className="movement-header-actions">
        <button type="button" className="button secondary" onClick={onSync} disabled={syncing||loading}><RefreshCw className={syncing?"spin":""}/>{syncing?"Sincronizando...":"Sincronizar QuarkRH"}</button>
        <button type="button" className="button primary" onClick={()=>void exportExcel()} disabled={loading||exporting||!filtered.length}><Download/>{exporting?"Gerando Excel...":"Exportar relatório Excel"}</button>
      </div>
    </div>

    <div className="movement-filters">
      <label className="movement-period-label"><span>Competência</span><div className="movement-month-control">
        <button type="button" aria-label="Mês anterior" onClick={()=>changeMonth(monthShift(competence,-1))}><ChevronLeft/></button>
        <input type="month" value={competence} onChange={e=>changeMonth(e.target.value)} aria-label="Mês de referência"/>
        <button type="button" aria-label="Próximo mês" onClick={()=>changeMonth(monthShift(competence,1))}><ChevronRight/></button>
      </div></label>
      <label><span>Empresa / unidade</span><select value={unit} onChange={e=>{setUnit(e.target.value);setLimit(100)}}><option value="">Todas as unidades</option>{units.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>Situação atual</span><select value={status} onChange={e=>{setStatus(e.target.value as StatusFilter);setLimit(100)}}><option value="ALL">Ativos e desligados</option><option value="ATIVO">Ativos</option><option value="DESLIGADO">Desligados</option></select></label>
      <label className="movement-search-label"><span>Funcionário, matrícula ou CPF</span><div className="search-box"><Search/><input value={query} onChange={e=>{setQuery(e.target.value);setLimit(100)}} placeholder="Pesquisar funcionário ou CPF" autoComplete="off"/></div></label>
    </div>

    <div className="movement-kpis">
      <button className={scope==="ADMISSION"&&view==="MOVEMENTS"?"movement-kpi selected incoming":"movement-kpi incoming"} onClick={()=>{setScope("ADMISSION");setView("MOVEMENTS");setLimit(100)}} aria-pressed={scope==="ADMISSION"&&view==="MOVEMENTS"}>
        <small><ArrowUpRight/> Admitidos no mês</small><strong>{loading?"—":summary.admissions}</strong><span>Data de entrada na competência</span></button>
      <button className={scope==="TERMINATION"&&view==="MOVEMENTS"?"movement-kpi selected outgoing":"movement-kpi outgoing"} onClick={()=>{setScope("TERMINATION");setView("MOVEMENTS");setLimit(100)}} aria-pressed={scope==="TERMINATION"&&view==="MOVEMENTS"}>
        <small><ArrowDownRight/> Desligados no mês</small><strong>{loading?"—":summary.terminations}</strong><span>Data de saída na competência</span></button>
      <div className="movement-kpi balance"><small><CalendarDays/> Saldo do mês</small><strong>{loading?"—":summary.net>0?"+"+summary.net:summary.net}</strong><span>Admissões menos desligamentos</span></div>
      <div className="movement-kpi"><small><Users/> Ativos atualmente</small><strong>{loading?"—":summary.activeNow}</strong><span>{summary.terminatedNow} desligado(s) nos filtros</span></div>
    </div>

    {hasMissingDates&&<div className="movement-warning" role="status"><AlertTriangle/>
      <span><strong>Datas ainda não disponíveis em todos os cadastros.</strong> {summary.missingAdmission} funcionário(s) sem admissão e {summary.missingTermination} desligado(s) sem data de saída. O painel mostra apenas movimentações com datas preenchidas; valores zerados não significam necessariamente ausência de movimentação. Confira a publicação/sincronização da função QuarkRH.</span>
    </div>}

    <div className="movement-chart">
      <div className="movement-chart-heading"><strong>Evolução dos últimos 6 meses</strong><div><span className="movement-legend green"/> Admissões <span className="movement-legend red"/> Desligamentos</div></div>
      <div className="movement-chart-bars">{monthChart.map(point=><button type="button" key={point.key} className={point.key===competence?"movement-bar-group current":"movement-bar-group"} onClick={()=>changeMonth(point.key)} title={monthLabel(point.key)+": "+point.entered+" admissão(ões), "+point.exited+" desligamento(s)"}>
        <div className="movement-pair"><div className="movement-bar entered" style={{height:`${Math.max(2,point.entered/chartMax*100)}%`}}><b>{point.entered||""}</b></div><div className="movement-bar exited" style={{height:`${Math.max(2,point.exited/chartMax*100)}%`}}><b>{point.exited||""}</b></div></div>
        <small>{point.label}</small>
      </button>)}</div>
    </div>

    <div className="movement-list-heading">
      <div className="movement-view-tabs"><button type="button" className={view==="MOVEMENTS"?"active":""} onClick={()=>{setView("MOVEMENTS");setLimit(100)}}>Movimentações do mês</button><button type="button" className={view==="ROSTER"?"active":""} onClick={()=>{setView("ROSTER");setLimit(100)}}>Cadastro completo</button></div>
      <div className="movement-summary"><span>{view==="MOVEMENTS"?entryLabel(scope):"Todos os funcionários"} · <strong>{currentCount}</strong> registro(s)</span>{view==="MOVEMENTS"&&scope!=="ALL"&&<button type="button" onClick={()=>setScope("ALL")}>Mostrar entradas e saídas</button>}</div>
    </div>

    {loading?<div className="table-empty">Carregando funcionários...</div>:
      currentCount===0?<div className="table-empty">{view==="MOVEMENTS"?"Nenhuma movimentação com data informada para os filtros e competência selecionados.":"Nenhum funcionário corresponde aos filtros."}</div>:
      <div className="table-scroll"><table className="data-table movement-table"><thead><tr><th>Funcionário</th><th>CPF</th><th>Unidade / Empresa</th>{view==="MOVEMENTS"&&<th>Movimentação</th>}<th>Data admissão</th><th>Data desligamento</th><th>Situação atual</th></tr></thead><tbody>
      {view==="MOVEMENTS"?events.slice(0,limit).map(row=><tr key={row.id}><td><strong>{row.employee.name}</strong><small className="block-muted">{row.employee.department||"Setor não informado"}</small></td><td className="mono">{formatCpf(row.employee.cpf,app.settings.maskCpf)}</td><td>{employeeUnit(row.employee)}</td><td><span className={row.kind==="ADMISSION"?"movement-pill incoming":"movement-pill outgoing"}>{row.kind==="ADMISSION"?"Admissão":"Desligamento"}</span><small className="block-muted">{dateLabel(row.date)}</small></td><td>{dateLabel(row.employee.admissionDate)}</td><td>{terminationLabel(row.employee)}</td><td><StatusBadge status={row.employee.status}/></td></tr>)
      :roster.slice(0,limit).map(e=><tr key={e.id}><td><strong>{e.name}</strong><small className="block-muted">{e.department||"Setor não informado"}</small></td><td className="mono">{formatCpf(e.cpf,app.settings.maskCpf)}</td><td>{employeeUnit(e)}</td><td>{dateLabel(e.admissionDate)}</td><td>{terminationLabel(e)}</td><td><StatusBadge status={e.status}/></td></tr>)}
      </tbody></table></div>}
    {currentCount>showing&&<div className="movement-more"><span>Exibindo {showing} de {currentCount}</span><button type="button" className="button secondary" onClick={()=>setLimit(n=>n+100)}>Ver mais 100</button></div>}
    <div className="movement-footnote">Fonte: cadastro atual de funcionários (QuarkRH e registros manuais). Os números representam datas de admissão/desligamento registradas, não a data em que o cadastro foi inserido no sistema. Readmissões com múltiplos vínculos não são rastreadas separadamente neste cadastro.</div>
  </section>;
}
