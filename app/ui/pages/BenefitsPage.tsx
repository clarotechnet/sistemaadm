"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Bus, CalendarDays, Check, FileSpreadsheet, HeartPulse, Pencil, Plus, RefreshCw, Search, Stethoscope, Upload, X } from "lucide-react";
import type { AggregationBaseRecord, AggregationMonthlyRecord } from "../../../src/types";
import { formatCpf } from "../../../src/utils/cpf";
import { formatMoney } from "../../../src/utils/money";
import { exportAggregationPaymentExcel, listAggregationBase, listAggregationMonthly, saveAggregationBase, saveAggregationMaintenance, syncAggregationMonth, upsertAggregationBase } from "../../../src/services/benefit-aggregation";
import { readExcel } from "../../../src/services/excel";
import { normalizeText } from "../../../src/utils/text";
import { EmptyState, MetricCard, StatusBadge } from "../components/Common";
import { useApp } from "../state/AppContext";
import { BenefitVehiclesTab } from "./BenefitVehiclesTab";
import { PlanBenefitModule } from "./PlanBenefitModule";
import { AggregationSyncNotice } from "../components/AggregationSyncNotice";

type BenefitTool="aggregation"|"transport"|"health"|"dental";
type AggregationTab="base"|"monthly"|"vehicles";
type BaseDraft={id?:string;employeeName:string;cpf:string;company:string;city:string;bank:string;baseValue:string;notes:string;activeMode:"QUARK"|"ATIVO"|"DESLIGADO";sourceLabel?:string};

const emptyDraft:BaseDraft={employeeName:"",cpf:"",company:"",city:"",bank:"MENTORE",baseValue:"",notes:"",activeMode:"QUARK"};
const hasPaymentDifference=(item:AggregationMonthlyRecord)=>Math.abs(item.baseValue-item.amountDue)>0.005;

export function BenefitsPage({onImport}:{onImport?:()=>void}={}){
  const app=useApp();
  const[tool,setTool]=useState<BenefitTool>("aggregation");
  const isPlan=tool==="health"||tool==="dental";
  return <div className="stack-gap">
    <div className="page-heading compact"><div><h2>Benefícios</h2><p>Cadastros, fechamentos e conferências dos benefícios.</p></div>{isPlan&&<label className="field competence-filter"><span>COMPETÊNCIA DA FOLHA</span><select value={app.selectedCompetence??""} disabled={app.payrollLoading||!app.payrollMonths.length} onChange={event=>void app.selectCompetence(event.target.value)}>{!app.payrollMonths.length&&<option value="">Nenhuma competência</option>}{app.payrollMonths.map(month=><option key={month.id} value={month.competence}>{month.competence}</option>)}</select><small>{app.payrollLoading?"Carregando dados...":`${app.payrollMonths.length} competência(s) disponível(is)`}</small></label>}</div>
    <div className="benefit-module-tabs">
      <button className={tool==="aggregation"?"active":""} aria-pressed={tool==="aggregation"} onClick={()=>setTool("aggregation")}><Boxes size={18}/><span><strong>Agregamento</strong><small>Base, ocorrências e fechamento mensal</small></span></button>
      <button className={tool==="transport"?"active":""} aria-pressed={tool==="transport"} onClick={()=>setTool("transport")}><Bus size={18}/><span><strong>Vale Transporte</strong><small>Estrutura reservada para a próxima etapa</small></span></button>
      <button className={tool==="health"?"active":""} aria-pressed={tool==="health"} onClick={()=>setTool("health")}><HeartPulse size={18}/><span><strong>Plano de Saúde</strong><small>Conferência com a folha importada</small></span></button>
      <button className={tool==="dental"?"active":""} aria-pressed={tool==="dental"} onClick={()=>setTool("dental")}><Stethoscope size={18}/><span><strong>Plano Odontológico</strong><small>Conferência com a folha importada</small></span></button>
    </div>
    {tool==="aggregation"&&<AggregationModule/>}
    {tool==="transport"&&<section className="surface"><EmptyState icon={<Bus/>} title="Vale Transporte" description="A área foi separada do Agregamento e ficará disponível para configurarmos as regras específicas na próxima etapa."/></section>}
    {isPlan&&<PlanBenefitModule key={tool} kind={tool} onImport={onImport}/>}
  </div>;
}

function AggregationModule(){
  const app=useApp();
  const[tab,setTab]=useState<AggregationTab>("base");
  const[base,setBase]=useState<AggregationBaseRecord[]>([]);
  const[monthly,setMonthly]=useState<AggregationMonthlyRecord[]>([]);
  const[loading,setLoading]=useState(true);
  const[syncing,setSyncing]=useState(false);
  const[importing,setImporting]=useState(false);
  const[exporting,setExporting]=useState(false);
  const[differenceOnly,setDifferenceOnly]=useState(false);
  const[query,setQuery]=useState("");
  const[company,setCompany]=useState("TODAS");
  const[city,setCity]=useState("TODAS");
  const[competence,setCompetence]=useState(new Date().toISOString().slice(0,7));
  const[editing,setEditing]=useState<BaseDraft|null>(null);
  const[syncRevision,setSyncRevision]=useState(0);

  const reloadBase=async()=>{setLoading(true);try{setBase(await listAggregationBase())}catch(e){app.toast("error","Não foi possível carregar a base de Agregamento",e instanceof Error?e.message:undefined)}finally{setLoading(false)}};
  const reloadMonthly=async()=>{try{setMonthly(await listAggregationMonthly(competence))}catch(e){app.toast("error","Não foi possível carregar o fechamento mensal",e instanceof Error?e.message:undefined)}};
  useEffect(()=>{void reloadBase()},[]);
  useEffect(()=>{if(tab==="monthly")void reloadMonthly()},[tab,competence]);
  const companies=useMemo(()=>[...new Set(base.map(item=>item.company).filter(Boolean))].sort(),[base]);
  const cities=useMemo(()=>[...new Set(base.map(item=>item.city).filter(Boolean))].sort(),[base]);
  const filtered=useMemo(()=>base.filter(item=>{
    const q=query.trim().toLocaleLowerCase("pt-BR"); const digits=query.replace(/\D/g,"");
    return (company==="TODAS"||item.company===company)&&(city==="TODAS"||item.city===city)&&(!q||item.employeeName.toLocaleLowerCase("pt-BR").includes(q)||(digits&&item.cpf.includes(digits)));
  }),[base,query,company,city]);
  const monthlyScope=useMemo(()=>monthly.filter(item=>(company==="TODAS"||item.company===company)&&(city==="TODAS"||item.city===city)),[monthly,company,city]);
  const filteredMonthlyBase=useMemo(()=>monthlyScope.filter(item=>{
    const q=query.trim().toLocaleLowerCase("pt-BR"); const digits=query.replace(/\D/g,"");
    return !q||item.employeeName.toLocaleLowerCase("pt-BR").includes(q)||(digits&&item.cpf.includes(digits));
  }),[monthlyScope,query]);
  const differenceCount=useMemo(()=>monthlyScope.filter(hasPaymentDifference).length,[monthlyScope]);
  const effectiveDifferenceOnly=differenceOnly&&differenceCount>0;
  const filteredMonthly=useMemo(()=>effectiveDifferenceOnly?filteredMonthlyBase.filter(hasPaymentDifference):filteredMonthlyBase,[filteredMonthlyBase,effectiveDifferenceOnly]);
  const filteredBaseTotal=useMemo(()=>monthlyScope.reduce((sum,item)=>sum+item.baseValue,0),[monthlyScope]);
  const filteredAmountDue=useMemo(()=>monthlyScope.reduce((sum,item)=>sum+item.amountDue,0),[monthlyScope]);
  const monthlyCompanies=useMemo(()=>new Set(monthlyScope.map(item=>item.company).filter(Boolean)).size,[monthlyScope]);
  const filterScopeLabel=company!=="TODAS"&&city!=="TODAS"?company+" · "+city:company!=="TODAS"?company:city!=="TODAS"?city:"competência completa";

  const startEdit=(item?:AggregationBaseRecord)=>setEditing(item?{
    id:item.id,employeeName:item.employeeName,cpf:item.cpf,company:item.company,city:item.city,bank:item.bank,
    baseValue:item.baseValue.toFixed(2).replace(".",","),notes:item.notes,sourceLabel:item.sourceLabel,
    activeMode:item.activeOverride===true?"ATIVO":item.activeOverride===false?"DESLIGADO":"QUARK"
  }:{...emptyDraft});

  const save=async()=>{
    if(!editing)return;
    const cpf=editing.cpf.replace(/\D/g,""); const value=Number(editing.baseValue.replace(".","").replace(",","."));
    if(cpf.length!==11||!editing.employeeName.trim()||!editing.company.trim()||!editing.city.trim()||!Number.isFinite(value)){app.toast("warning","Confira os dados","Nome, CPF, empresa, cidade e valor base são obrigatórios.");return}
    try{
      await saveAggregationBase({id:editing.id,employeeName:editing.employeeName,cpf,company:editing.company,city:editing.city,bank:editing.bank,baseValue:value,notes:editing.notes,
        sourceLabel:editing.sourceLabel,source:editing.id?undefined:"MANUAL",activeOverride:editing.activeMode==="QUARK"?null:editing.activeMode==="ATIVO"});
      setEditing(null);await reloadBase();app.toast("success",editing.id?"Agregado atualizado":"Novo agregado cadastrado");
    }catch(e){app.toast("error","Não foi possível salvar o agregado",e instanceof Error?e.message:undefined)}
  };
  const importBase=async(file:File)=>{
    setImporting(true);
    try{
      const workbook=await readExcel(file);
      const sheet=workbook.sheets.find(item=>item.normalizedHeaders.includes("CPF")&&item.normalizedHeaders.some(h=>h.includes("COLABORADOR")))??workbook.sheets[0];
      if(!sheet)throw new Error("Nenhuma aba válida foi encontrada.");
      const find=(aliases:string[])=>sheet.normalizedHeaders.findIndex(header=>aliases.some(alias=>header.includes(alias)));
      const companyIndex=find(["EMPRESA CIDADE","EMPRESA"]);
      const nameIndex=find(["COLABORADOR DEPENDENTE","COLABORADOR","FUNCIONARIO","NOME"]);
      const cpfIndex=find(["CPF"]);
      const bankIndex=find(["BANCO"]);
      const valueIndex=find(["R BASE","VALOR BASE","BASE"]);
      const notesIndex=find(["OBSERVACOES","OBSERVACAO"]);
      if(nameIndex<0||cpfIndex<0||valueIndex<0)throw new Error("O arquivo precisa ter Colaborador, CPF e R$ Base.");
      const parsePlace=(raw:unknown)=>{
        const original=String(raw??"").trim(); const normalized=normalizeText(original);
        const companyName=normalized.startsWith("VNA")?"VNA":normalized.startsWith("DMV")?"DMV":normalized.startsWith("RDT")?"RDT":normalized.split(" ")[0]||"";
        const cityName=normalized.includes("MOSSORO")?"MOSSORÓ":normalized.includes("FORT")?"FORTALEZA":normalized.includes("REC")?"RECIFE":normalized.includes("NATAL")?"NATAL":normalized.replace(companyName,"").trim();
        return {sourceLabel:original,company:companyName,city:cityName};
      };
      const records=sheet.rows.map(row=>{
        const place=parsePlace(row[companyIndex]);
        const cpf=String(row[cpfIndex]??"").replace(/\D/g,"").padStart(11,"0");
        const rawValue=String(row[valueIndex]??"0").trim().replace(/\./g,"").replace(",",".");
        return {sourceLabel:place.sourceLabel,company:place.company,city:place.city,employeeName:String(row[nameIndex]??"").trim().toUpperCase(),cpf,bank:bankIndex>=0?String(row[bankIndex]??"").trim().toUpperCase():"",baseValue:Number(rawValue)||0,notes:notesIndex>=0?String(row[notesIndex]??"").trim():""};
      }).filter(row=>row.employeeName&&row.cpf.length===11);
      if(!records.length)throw new Error("Nenhum registro válido foi encontrado no arquivo.");
      await upsertAggregationBase(records);await reloadBase();
      app.addAudit({operation:"Importou base de Agregamento",module:"Benefícios",result:`${records.length} CPF(s) importados/atualizados`,status:"SUCESSO",fileName:file.name,processedCount:records.length});
      app.toast("success","Base de Agregamento atualizada",`${records.length} registro(s) importado(s) do arquivo.`);
    }catch(e){app.toast("error","Não foi possível importar a base",e instanceof Error?e.message:undefined)}
    finally{setImporting(false)}
  };

  const sync=async()=>{
    setSyncing(true);
    try{
      const result=await syncAggregationMonth(competence);await reloadMonthly();
      const warning=(result.warnings??[]).join(" ");
      app.addAudit({operation:"Atualizou Agregamento mensal",module:"Benefícios",result:`${competence}: ${result.rows??0} colaboradores · ${result.faltas??0} faltas · ${result.atestados??0} atestados · ${result.ferias??0} férias`,status:warning?"AVISO":"SUCESSO",processedCount:result.rows});
      if(warning)app.toast("warning","Agregamento atualizado com ressalvas",warning);
      else app.toast("success","Agregamento atualizado pelo QuarkRH",`${result.rows??0} colaborador(es) · faltas, atestados e férias atualizados.`);
    }catch(e){app.toast("error","Não foi possível consultar o QuarkRH",e instanceof Error?e.message:undefined)}
    finally{setSyncing(false);setSyncRevision(value=>value+1)}
  };
  const exportPayment=async()=>{
    setExporting(true);
    try{
      await exportAggregationPaymentExcel(filteredMonthlyBase,competence);
      app.addAudit({operation:"Exportou relatório de pagamento do Agregamento",module:"Benefícios",result:`${competence}: ${filteredMonthlyBase.length} pagamento(s) exportado(s) em XLSX`,status:"SUCESSO",processedCount:filteredMonthlyBase.length});
      app.toast("success","Relatório de pagamento criado",`${filteredMonthlyBase.length} registro(s) separados por empresa.`);
    }catch(e){app.toast("error","Não foi possível criar o relatório",e instanceof Error?e.message:undefined)}
    finally{setExporting(false)}
  };

  const activeCount=base.filter(item=>(item.activeOverride===null?item.employeeStatus==="ATIVO":item.activeOverride)).length;
  const totalBase=base.reduce((sum,item)=>sum+item.baseValue,0);
  return <div className="stack-gap">
    <div className="tabs benefit-inner-tabs">
      <button className={tab==="base"?"active":""} onClick={()=>setTab("base")}>Base de dados</button>
      <button className={tab==="monthly"?"active":""} onClick={()=>setTab("monthly")}>Agregamentos mensal</button>
      <button className={tab==="vehicles"?"active":""} onClick={()=>setTab("vehicles")}>Veículos</button>
    </div>
    {tab==="monthly"&&<AggregationSyncNotice competence={competence} refresh={syncRevision}/>}
    {tab==="vehicles"?<BenefitVehiclesTab base={base}/>:<>
    {tab==="base"?<div className="metrics-grid">
      <MetricCard label="AGREGADOS" value={base.length} detail="CPFs cadastrados"/>
      <MetricCard label="ATIVOS" value={activeCount} detail="QuarkRH + ajustes manuais" tone="success"/>
      <MetricCard label="EMPRESAS" value={companies.length} detail="na base"/>
      <MetricCard label="VALOR BASE TOTAL" value={formatMoney(totalBase)} detail="cadastro atual"/>
    </div>:<div className="metrics-grid five">
      <MetricCard label="COLABORADORES" value={monthlyScope.length} detail={filterScopeLabel}/>
      <button type="button" className={`metric-card-v2 metric-card-button ${differenceCount>0?"danger":"success"} ${effectiveDifferenceOnly?"active":""}`} disabled={differenceCount===0} onClick={()=>setDifferenceOnly(value=>!value)}>
        <span>COM DIFERENÇA</span><strong>{differenceCount}</strong><small>{differenceCount===0?"Nenhuma diferença no filtro":effectiveDifferenceOnly?"Filtro ativo · clique para mostrar todos":"Clique para mostrar somente diferenças"}</small>
      </button>
      <MetricCard label="EMPRESAS" value={monthlyCompanies} detail={filterScopeLabel}/>
      <MetricCard label="VALOR BASE" value={formatMoney(filteredBaseTotal)} detail={filterScopeLabel}/>
      <MetricCard label="VALOR A RECEBER" value={formatMoney(filteredAmountDue)} detail={`montante · ${filterScopeLabel}`} tone={differenceCount>0?"warning":"success"}/>
    </div>}
    {editing&&<section className="surface aggregation-edit-card">
      <div className="section-header"><div><h3>{editing.id?"Editar agregado":"Adicionar novo agregado"}</h3><p>O CPF é usado para vincular este cadastro ao funcionário sincronizado do QuarkRH.</p></div><button className="icon-plain" onClick={()=>setEditing(null)}><X size={18}/></button></div>
      <div className="aggregation-form-grid">
        <label className="field"><span>Colaborador</span><input value={editing.employeeName} onChange={e=>setEditing({...editing,employeeName:e.target.value})}/></label>
        <label className="field"><span>CPF</span><input disabled={Boolean(editing.id)} value={editing.cpf} onChange={e=>setEditing({...editing,cpf:e.target.value})}/></label>
        <label className="field"><span>Empresa</span><input value={editing.company} onChange={e=>setEditing({...editing,company:e.target.value})}/></label>
        <label className="field"><span>Cidade</span><input value={editing.city} onChange={e=>setEditing({...editing,city:e.target.value})}/></label>
        <label className="field"><span>Banco</span><input value={editing.bank} onChange={e=>setEditing({...editing,bank:e.target.value})}/></label>
        <label className="field"><span>Valor base</span><input inputMode="decimal" value={editing.baseValue} onChange={e=>setEditing({...editing,baseValue:e.target.value})}/></label>
        <label className="field"><span>Status</span><select value={editing.activeMode} onChange={e=>setEditing({...editing,activeMode:e.target.value as BaseDraft["activeMode"]})}><option value="QUARK">Seguir QuarkRH</option><option value="ATIVO">Forçar ativo</option><option value="DESLIGADO">Forçar desligado</option></select></label>
        <label className="field aggregation-notes"><span>Observações</span><input value={editing.notes} onChange={e=>setEditing({...editing,notes:e.target.value})}/></label>
      </div>
      <div className="form-actions"><button className="button secondary" onClick={()=>setEditing(null)}>Cancelar</button><button className="button primary" onClick={()=>void save()}><Check size={16}/> Salvar</button></div>
    </section>}
    <section className="surface table-surface">
      <div className="aggregation-toolbar">
        <div className="search-box"><Search size={16}/><input placeholder="Pesquisar colaborador ou CPF" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <select value={company} onChange={e=>{setCompany(e.target.value);setDifferenceOnly(false)}}><option value="TODAS">Todas as empresas</option>{companies.map(item=><option key={item}>{item}</option>)}</select>
        <select value={city} onChange={e=>{setCity(e.target.value);setDifferenceOnly(false)}}><option value="TODAS">Todas as cidades</option>{cities.map(item=><option key={item}>{item}</option>)}</select>
        {tab==="base"?<div className="aggregation-base-actions"><label className={`button secondary ${importing?"disabled":""}`}><Upload size={16}/>{importing?"Importando...":"Importar / Atualizar base"}<input type="file" accept=".xls,.xlsx" disabled={importing} hidden onChange={e=>{const file=e.target.files?.[0];if(file)void importBase(file);e.currentTarget.value=""}}/></label><button className="button primary" onClick={()=>startEdit()}><Plus size={16}/> Adicionar novo agregado</button></div>:<div className="aggregation-monthly-actions"><label className="aggregation-competence"><CalendarDays size={16}/><input type="month" value={competence} onChange={e=>{setCompetence(e.target.value);setDifferenceOnly(false)}}/></label><button className="button secondary" title="Exporta CPF e Valor a receber dos filtros atuais, separados por empresa." disabled={exporting||!filteredMonthlyBase.length} onClick={()=>void exportPayment()}><FileSpreadsheet size={16}/>{exporting?"Gerando...":"Relatório de pagamento"}</button><button className="button primary" disabled={syncing} onClick={()=>void sync()}><RefreshCw className={syncing?"spin":""} size={16}/>{syncing?"Consultando...":"Atualizar pelo QuarkRH"}</button></div>}
      </div>
      {tab==="base"?<BaseTable rows={filtered} loading={loading} maskCpf={app.settings.maskCpf} onEdit={startEdit}/>:<MonthlyTable rows={filteredMonthly} maskCpf={app.settings.maskCpf} differenceOnly={effectiveDifferenceOnly} competence={competence} onSaved={reloadMonthly}/>}
    </section>
    {tab==="monthly"&&<div className="inline-warning aggregation-rule"><CalendarDays/><span><strong>Regra de cálculo</strong> Divisor fixo de 30 dias. Faltas, atestados, férias e manutenção de veículo são somados; até 3 dias não há desconto. A partir de 4 dias, todos os dias acumulados são descontados. Admissões e desligamentos continuam proporcionais ao período trabalhado.</span></div>}
    </>}
  </div>;
}
function BaseTable({rows,loading,maskCpf,onEdit}:{rows:AggregationBaseRecord[];loading:boolean;maskCpf:boolean;onEdit:(item:AggregationBaseRecord)=>void}){
  if(loading)return <div className="table-empty">Carregando base de Agregamento...</div>;
  return <div className="table-scroll"><table className="data-table aggregation-table"><thead><tr><th>Colaborador</th><th>CPF</th><th>Empresa</th><th>Cidade</th><th>Banco</th><th className="right">Valor base</th><th>Status</th><th>Observações</th><th>Ações</th></tr></thead><tbody>
    {rows.map(item=>{const active=item.activeOverride===null?item.employeeStatus==="ATIVO":item.activeOverride;return <tr key={item.id}><td><strong>{item.employeeName}</strong><small>{item.sourceLabel}</small></td><td className="mono">{formatCpf(item.cpf,maskCpf)}</td><td>{item.company}</td><td>{item.city}</td><td>{item.bank||"—"}</td><td className="right">{formatMoney(item.baseValue)}</td><td><StatusBadge status={active?"ATIVO":"DESLIGADO"}/>{item.activeOverride!==null&&<small className="manual-override">ajuste manual</small>}</td><td className="aggregation-notes-cell">{item.notes||"—"}</td><td><button className="icon-plain" title="Editar agregado" onClick={()=>onEdit(item)}><Pencil size={16}/></button></td></tr>})}
  </tbody></table>{!rows.length&&<div className="table-empty">Nenhum agregado corresponde aos filtros aplicados.</div>}</div>;
}

function MonthlyTable({rows,maskCpf,differenceOnly,competence,onSaved}:{rows:AggregationMonthlyRecord[];maskCpf:boolean;differenceOnly:boolean;competence:string;onSaved:()=>Promise<void>}){
  const app=useApp();
  const[drafts,setDrafts]=useState<Record<string,string>>({});
  const[savingId,setSavingId]=useState("");
  const saveMaintenance=async(item:AggregationMonthlyRecord)=>{
    const raw=drafts[item.id]??String(item.maintenanceVehicleDays);
    const days=Math.max(0,Math.min(30,Math.trunc(Number(raw)||0)));
    setDrafts(current=>({...current,[item.id]:String(days)}));
    if(days===item.maintenanceVehicleDays)return;
    setSavingId(item.id);
    try{
      await saveAggregationMaintenance(competence,item.aggregationId,days);
      await onSaved();
      app.toast("success","Manutenção de veículo atualizada",`${item.employeeName}: ${days} dia(s).`);
    }catch(e){
      setDrafts(current=>({...current,[item.id]:String(item.maintenanceVehicleDays)}));
      app.toast("error","Não foi possível salvar a manutenção do veículo",e instanceof Error?e.message:undefined);
    }finally{setSavingId("")}
  };
  return <div className="table-scroll"><table className="data-table aggregation-table monthly"><thead><tr><th>Data</th><th>Colaborador</th><th>CPF</th><th className="right">Valor base</th><th className="center">Faltas</th><th className="center">Atestado</th><th className="center">Férias</th><th className="center">Manutenção veículo</th><th className="right">Valor a receber</th><th>Status</th></tr></thead><tbody>
    {rows.map(item=><tr className={hasPaymentDifference(item)?"row-warning":undefined} key={item.id}><td>{item.competence.split("-").reverse().join("/")}</td><td><strong>{item.employeeName}</strong><small>{item.company} · {item.city}</small></td><td className="mono">{formatCpf(item.cpf,maskCpf)}</td><td className="right">{formatMoney(item.baseValue)}</td><td className="center">{item.absenceDays}</td><td className="center">{item.medicalDays}</td><td className="center">{item.vacationDays}</td><td className="center"><input className="maintenance-days-input" type="number" min={0} max={30} step={1} disabled={savingId===item.id} value={drafts[item.id]??String(item.maintenanceVehicleDays)} onChange={e=>setDrafts(current=>({...current,[item.id]:e.target.value.replace(/[^0-9]/g,"")}))} onBlur={()=>void saveMaintenance(item)} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur()}} aria-label={`Manutenção de veículo de ${item.employeeName}`}/></td><td className="right"><strong>{formatMoney(item.amountDue)}</strong><small>{item.payableDays} dia(s) pagos</small></td><td><StatusBadge status={item.employmentStatus==="NAO_LOCALIZADO"?"NÃO LOCALIZADO":item.employmentStatus}/></td></tr>)}
  </tbody></table>{!rows.length&&<div className="table-empty">{differenceOnly?"Nenhum colaborador com diferença entre Valor base e Valor a receber nos filtros atuais.":"Nenhum fechamento salvo para esta competência. Clique em “Atualizar pelo QuarkRH”."}</div>}</div>;
}
