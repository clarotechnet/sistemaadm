"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, History, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import type { ComparisonKind } from "../../../src/modules/comparisons/processor";
import { isPlanCoparticipationOnly, parsePlanBase, parsePlanCoparticipation, parsePlanInvoice, parsePlanValue, planBaseAtMonth, planCoparticipationsAtMonth, type PlanBaseInput, type PlanBaseStatus, type PlanBaseVersion } from "../../../src/modules/benefits/plan-base";
import { savePlanBase, savePlanCoparticipation } from "../../../src/services/benefit-plan-base";
import { exportPlanBaseExcel } from "../../../src/services/benefit-plan-export";
import { readExcel } from "../../../src/services/excel";
import { formatCpf } from "../../../src/utils/cpf";
import { formatMoney } from "../../../src/utils/money";
import { normalizeHeader } from "../../../src/utils/text";
import { ConfirmationModal, MetricCard } from "../components/Common";
import { MultiSelectFilter } from "../components/MultiSelectFilter";
import { useApp } from "../state/AppContext";
import { PlanComparison } from "./PlanComparison";
import "./plan-benefit.css";

const thisMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;};
type Draft = Omit<PlanBaseInput,"value"> & {value:string;invoice:string;coparticipation:string;coparticipationMonth:string;effectiveFrom:string};
const emptyDraft=(month:string):Draft=>({cpf:"",name:"",company:"",city:"",department:"",plan:"",value:"",invoice:"",coparticipation:"",coparticipationMonth:month,status:"ATIVO",notes:"",metadata:{},effectiveFrom:month});
const labelStatus=(status:PlanBaseStatus)=>status==="PENDENTE"?"PENDENTE RH":status;
const emptyVersions:PlanBaseVersion[]=[];
const invoiceText=(value:unknown)=>{
  try { const amount=parsePlanInvoice(value);return amount===null?"":amount.toFixed(2).replace(".",","); }
  catch { return String(value??""); }
};
const invoiceLabel=(value:unknown)=>{
  try { return formatMoney(parsePlanInvoice(value)); }
  catch { return "Conferir fatura"; }
};
const copartLabel=(value:unknown)=>{
  try { return formatMoney(parsePlanCoparticipation(value)); }
  catch { return "Conferir coparticipação"; }
};
const filterOptions=(rows:readonly PlanBaseVersion[],field:"city"|"department"|"plan",missing:string)=>{
  const options=new Map<string,string>();
  for(const row of rows){const label=row[field].trim();const key=normalizeHeader(label);if(!options.has(key))options.set(key,label||missing);}
  return [...options].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,"pt-BR"));
};

export function PlanBenefitModule({kind,onImport}:{kind:ComparisonKind;onImport?:()=>void}) {
  const app=useApp(),{toast}=app;
  const [tab,setTab]=useState<"base"|"monthly">("base");
  const versions=app.planBases[kind]??emptyVersions,error=app.planBaseErrors[kind],loading=app.planBases[kind]===null&&!error;
  const [month,setMonth]=useState(thisMonth),[query,setQuery]=useState(""),[status,setStatus]=useState("TODOS"),[history,setHistory]=useState(false);
  const [cities,setCities]=useState<string[]>([]),[departments,setDepartments]=useState<string[]>([]),[plans,setPlans]=useState<string[]>([]);
  const [draft,setDraft]=useState<Draft|null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false);
  const originalDraft=useRef<Draft|null>(null);
  const [copartDraft,setCopartDraft]=useState<{row:PlanBaseVersion;month:string;value:string}|null>(null),copartInput=useRef<HTMLInputElement>(null),copartOpen=copartDraft!==null;
  const [target,setTarget]=useState<PlanBaseVersion|null>(null),[preview,setPreview]=useState<{records:PlanBaseInput[];issues:string[];source:string}|null>(null);
  const refreshPlanBase=app.refreshPlanBase;
  const reload=useCallback(()=>refreshPlanBase(kind),[kind,refreshPlanBase]);
  useEffect(()=>{const timer=setTimeout(()=>void reload(),0);return()=>clearTimeout(timer);},[reload]);
  useEffect(()=>{if(copartOpen)copartInput.current?.focus();},[copartOpen]);
  const current=useMemo(()=>planBaseAtMonth(versions,month),[versions,month]);
  const coparts=useMemo(()=>new Map(planCoparticipationsAtMonth(versions,month).map(row=>[row.cpf,row.metadata.coparticipation])),[versions,month]);
  const active=current.filter(row=>row.status==="ATIVO"),pending=current.filter(row=>row.status==="PENDENTE");
  const scope=history?versions:current;
  const visible=scope.filter(row=>{
    const text=query.trim().toLocaleLowerCase("pt-BR"),digits=query.replace(/\D/g,"");
    return (status==="TODOS"?(history||row.status!=="EXCLUIDO"):row.status===status)
      &&(!cities.length||cities.includes(normalizeHeader(row.city)))
      &&(!departments.length||departments.includes(normalizeHeader(row.department)))
      &&(!plans.length||plans.includes(normalizeHeader(row.plan)))
      &&(!text||[row.name,row.company,row.city,row.plan,row.department,row.notes].some(value=>value.toLocaleLowerCase("pt-BR").includes(text))||Boolean(digits&&row.cpf.includes(digits)));
  });
  const filtered=Boolean(query||cities.length||departments.length||plans.length||status!=="TODOS");
  const state=kind==="health"?app.savedHealth:app.savedDental;
  const openEditor=(row:PlanBaseVersion)=>{
    setEditing(true);
    const next:Draft={...row,value:row.value===null?"":row.value.toFixed(2).replace(".",","),invoice:invoiceText(row.metadata.invoice),coparticipation:invoiceText(coparts.get(row.cpf)),coparticipationMonth:month,effectiveFrom:month};
    originalDraft.current=next;setDraft(next);
  };
  const openCopart=(row:PlanBaseVersion)=>{
    const period=history?String(row.metadata.coparticipationMonth??row.effectiveFrom):month;
    const value=planCoparticipationsAtMonth(versions,period).find(item=>item.cpf===row.cpf)?.metadata.coparticipation;
    setCopartDraft({row,month:period,value:invoiceText(value)});
  };
  const saveCopart=async()=>{
    if(!copartDraft)return;
    setBusy(true);
    try{
      const {row,month:period,value}=copartDraft;
      await savePlanCoparticipation(kind,row.cpf,period,value);
      await reload();setCopartDraft(null);
      app.addAudit({operation:"Atualizou coparticipação mensal",module:"Benefícios",result:`${kind} · ${period} · histórico preservado`,status:"SUCESSO"});
      toast("success","Coparticipação salva",`Detalhamento de ${period.split("-").reverse().join("/")} atualizado.`);
    }catch(e){toast("error","Não foi possível salvar a coparticipação",e instanceof Error?e.message:undefined);}finally{setBusy(false);}
  };
  const exportBase=async(template=false)=>{
    if(!template&&history)return;
    setBusy(true);
    try{
      await exportPlanBaseExcel({kind,competence:month,records:template?[]:visible,versions,maskCpf:app.settings.maskCpf,template});
      if(!template)app.addAudit({operation:"Exportou base do plano para conferência da fatura",module:"Benefícios",result:`${kind} · ${month} · ${visible.length} cadastros nos filtros selecionados`,status:"SUCESSO"});
      toast("success",template?"Modelo baixado":"Base exportada",template?"Veja a aba Como importar para preencher e aplicar reajustes.":"O Excel inclui os cadastros filtrados, FATURA, OBS e a coparticipação da competência.");
    }catch(e){toast("error","Não foi possível exportar",e instanceof Error?e.message:undefined);}finally{setBusy(false);}
  };
  const save=async()=>{
    if(!draft)return;
    setBusy(true);
    try{
      const {invoice,coparticipation,coparticipationMonth,effectiveFrom,...fields}=draft;
      const metadata={...fields.metadata};delete metadata.coparticipationOnly;
      const record:PlanBaseInput={...fields,value:draft.status==="PENDENTE"?null:parsePlanValue(draft.value),metadata:{...metadata,invoice:parsePlanInvoice(invoice),coparticipation:parsePlanCoparticipation(coparticipation),coparticipationMonth}};
      const original=originalDraft.current;
      const baseFields=["cpf","name","company","city","department","plan","value","invoice","status","notes","effectiveFrom"] as const;
      const onlyCopart=Boolean(editing&&original&&!baseFields.some(key=>draft[key]!==original[key]));
      if(onlyCopart&&original&&coparticipation===original.coparticipation&&coparticipationMonth===original.coparticipationMonth){setDraft(null);toast("success","Nenhuma alteração para salvar");return;}
      const saveMonth=onlyCopart?coparticipationMonth:effectiveFrom;
      if(onlyCopart)await savePlanCoparticipation(kind,record.cpf,coparticipationMonth,coparticipation);
      else await savePlanBase(kind,saveMonth,[record]);
      await reload();setDraft(null);
      app.addAudit({operation:onlyCopart?"Atualizou coparticipação mensal":editing?"Alterou cadastro do plano":"Adicionou cadastro do plano",module:"Benefícios",result:`${kind==="health"?"Saúde":"Odonto"} · ${saveMonth} · histórico preservado`,status:"SUCESSO"});
      toast("success",onlyCopart?"Coparticipação salva":"Cadastro salvo",onlyCopart?`Detalhamento de ${saveMonth.split("-").reverse().join("/")} atualizado.`:"A alteração não modifica comparativos já salvos.");
    }catch(e){toast("error","Não foi possível salvar",e instanceof Error?e.message:undefined);}finally{setBusy(false);}
  };
  const importFile=async(file:File)=>{
    setBusy(true);
    try {const parsed=parsePlanBase(await readExcel(file,{preserveBlankRows:true}),kind,current);setPreview({records:parsed.records,issues:parsed.issues,source:file.name});}
    catch(e){toast("error","Não foi possível ler a base",e instanceof Error?e.message:undefined);}finally{setBusy(false);}
  };
  const confirmImport=async()=>{
    if(!preview)return;setBusy(true);
    try {await savePlanBase(kind,month,preview.records,preview.source);await reload();setPreview(null);toast("success","Base importada",`${preview.records.length} cadastro(s). Os ausentes no arquivo não foram excluídos nem desativados.`);app.addAudit({operation:"Importou base de plano",module:"Benefícios",result:`${kind} · ${preview.records.length} cadastros · vigência ${month}`,fileName:preview.source,status:preview.issues.length?"AVISO":"SUCESSO"});}
    catch(e){toast("error","Não foi possível importar",e instanceof Error?e.message:undefined);}finally{setBusy(false);}
  };
  const copySaved=()=>{
    const records=(state?.rows??[]).filter(row=>row.referenceValue!==null).map(row=>({cpf:row.cpf,name:row.name,company:"",city:"",department:"",plan:"",value:row.referenceValue,status:"ATIVO" as const,notes:"",metadata:{referenceFile:state?.fileName}}));
    if(!records.length){toast("warning","Não há referência salva para copiar");return;}
    setPreview({records,issues:[],source:`Referência salva: ${state!.fileName}`});
  };
  return <div className="stack-gap plan-benefit-module">
    <div className="tabs benefit-inner-tabs"><button className={tab==="base"?"active":""} onClick={()=>setTab("base")}>Base de dados</button><button className={tab==="monthly"?"active":""} onClick={()=>setTab("monthly")}>Conferência mensal</button></div>
    {tab==="monthly"?<PlanComparison kind={kind} onImport={onImport} baseVersions={error||loading?undefined:versions} baseLoading={loading} baseError={error}/>:<>
      {error&&<div className="plan-base-error" role="alert">{error}<button className="button secondary" onClick={()=>void reload()}>Tentar novamente</button></div>}
      <div className="metrics-grid"><MetricCard label="CADASTROS NA VIGÊNCIA" value={current.length}/><MetricCard label="ATIVOS" value={active.length} tone="success"/><MetricCard label="DESCONTO PREVISTO" value={formatMoney(active.reduce((sum,row)=>sum+(row.value??0),0))}/><MetricCard label="PENDENTES RH" value={pending.length} tone={pending.length?"warning":"success"}/></div>
      <section className="surface"><div className="section-header"><div><h3>Base de dados · {kind==="health"?"Plano de Saúde":"Plano Odontológico"}</h3><p>CPF, plano e desconto mensal. A vigência exibe o histórico; a Conferência mensal usa o cadastro mais recente para qualquer folha.</p></div><button className="button primary" disabled={busy||Boolean(error)||loading} onClick={()=>{setEditing(false);setDraft(emptyDraft(month));}}><Plus/> Adicionar funcionário</button></div>
        <div className="plan-base-toolbar"><div className="search-box"><Search/><input aria-label="Pesquisar cadastro do plano" placeholder="Pesquisar nome, CPF, empresa ou OBS" value={query} onChange={e=>setQuery(e.target.value)}/></div><label className="field"><span>Vigência em exibição</span><input type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label><label className="field"><span>Situação</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="TODOS">Ativos, inativos e pendentes</option><option value="ATIVO">Ativos</option><option value="INATIVO">Inativos</option><option value="PENDENTE">Pendentes RH</option><option value="EXCLUIDO">Excluídos da base</option></select></label></div>
        <div className="plan-base-filters">
          <MultiSelectFilter label="Cidade" allLabel="Todas as cidades" pluralLabel="cidades" options={filterOptions(versions,"city","Cidade não informada")} values={cities} onChange={setCities}/>
          <MultiSelectFilter label="Setor" allLabel="Todos os setores" pluralLabel="setores" options={filterOptions(versions,"department","Setor não informado")} values={departments} onChange={setDepartments}/>
          <MultiSelectFilter label="Plano" allLabel="Todos os planos" pluralLabel="planos" options={filterOptions(versions,"plan","Plano não informado")} values={plans} onChange={setPlans}/>
        </div>
        <div className="plan-base-actions"><label className="button secondary"><Upload/>{busy?"Aguarde...":"Importar base XLS/XLSX"}<input hidden type="file" accept=".xls,.xlsx" disabled={busy||Boolean(error)||loading} onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.currentTarget.value="";}}/></label><button className="button secondary" disabled={busy||!state||Boolean(error)||loading} onClick={copySaved}>Copiar referência salva</button><label className="checkbox-line"><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/><History size={14}/> Mostrar histórico de versões</label>{filtered&&<button className="button secondary" onClick={()=>{setQuery("");setCities([]);setDepartments([]);setPlans([]);setStatus("TODOS");}}>Limpar filtros</button>}<span>{visible.length} registro(s)</span></div>
        <div className="plan-base-exports"><button className="button secondary" disabled={busy||Boolean(error)||loading||history||!visible.length} title={history?"Desmarque Mostrar histórico de versões para exportar a base mensal.":"Exporta todos os cadastros nos filtros selecionados."} onClick={()=>void exportBase()}><Download/> Exportar base para fatura (.xlsx)</button><button className="button secondary" disabled={busy} onClick={()=>void exportBase(true)}><Download/> Baixar modelo de importação (.xlsx)</button><small>{history?"Desmarque Mostrar histórico de versões para exportar a base mensal.":"Para reajustar a Unimed, filtre o plano, exporte a base, altere os valores e reimporte na vigência desejada."}</small></div>
        <p className="plan-base-import-help">Obrigatórias: <strong>NOME, CPF e DESC FOLHA</strong> (ou VALOR). Opcionais: EMPRESA, CIDADE, SETOR, PLANO, FATURA, COPARTICIPACAO, COMPETENCIA COPARTICIPACAO, OBS e SITUACAO. A coparticipação é detalhada por mês e não é repetida no mês seguinte. A conferência usa DESC FOLHA, sem somar FATURA ou coparticipação.</p>
        {pending.length>0&&<div className="inline-warning plan-base-pending">Existem {pending.length} CPF(s) pendentes RH. Nenhum valor foi presumido para eles. Edite o cadastro depois da confirmação do RH.</div>}
        <div className="table-scroll plan-base-scroll"><table className="data-table plan-base-table">
          <thead><tr><th>Funcionário</th><th>CPF</th><th>Empresa / cidade</th><th>Plano / setor</th><th className="right">Desconto previsto</th><th className="right">Coparticipação<small className="block-muted">{history?"Mês do lançamento":month.split("-").reverse().join("/")}</small></th><th className="right">FATURA</th><th>OBS</th><th>Situação</th><th>Vigência</th><th>Atualizado em</th><th>Ações</th></tr></thead>
          <tbody>{visible.map(row=><tr key={row.id} className={row.status==="PENDENTE"?"row-warning":undefined}>
            <td data-label="Funcionário"><strong>{row.name}</strong><small className="block-muted">{row.source}</small></td>
            <td data-label="CPF" className="mono">{formatCpf(row.cpf,app.settings.maskCpf)}</td>
            <td data-label="Empresa / cidade">{row.company||"—"}<small className="block-muted">{row.city}</small></td>
            <td data-label="Plano / setor">{row.plan||"—"}<small className="block-muted">{row.department}</small></td>
            <td data-label="Desconto previsto" className="right">{formatMoney(row.value)}</td>
            <td data-label="Coparticipação" className="right"><button className="plan-copart-edit" aria-label={`Editar coparticipação de ${row.name} em ${String(history?(row.metadata.coparticipationMonth??row.effectiveFrom):month).split("-").reverse().join("/")}`} title="Editar coparticipação mensal" disabled={busy||loading||row.status==="PENDENTE"} onClick={()=>openCopart(row)}>{copartLabel(history?row.metadata.coparticipation:coparts.get(row.cpf))}<Pencil size={12}/></button>{history&&Object.hasOwn(row.metadata,"coparticipation")&&<small className="block-muted">{String(row.metadata.coparticipationMonth??row.effectiveFrom).split("-").reverse().join("/")}</small>}</td>
            <td data-label="FATURA" className="right">{invoiceLabel(row.metadata.invoice)}</td>
            <td data-label="OBS" className="plan-base-notes">{row.notes.length>80?<details><summary>{row.notes.slice(0,40)}…</summary><p>{row.notes}</p></details>:row.notes||"—"}</td>
            <td data-label="Situação"><span className={`status-badge ${row.status==="ATIVO"?"success":row.status==="PENDENTE"?"warning":"neutral"}`}>{labelStatus(row.status)}</span></td>
            <td data-label="Vigência">{row.effectiveFrom.split("-").reverse().join("/")}<small className="block-muted">Versão {row.revision}{isPlanCoparticipationOnly(row)?" · Coparticipação":""}</small></td>
            <td data-label="Atualizado em">{new Date(row.createdAt).toLocaleString("pt-BR")}<small className="block-muted">{row.createdByName}</small></td>
            <td data-label="Ações"><div className="row-actions"><button aria-label={`Editar ${row.name}`} title={isPlanCoparticipationOnly(row)?"Edite este lançamento na coluna Coparticipação.":`Editar / desativar ${row.name}`} disabled={busy||loading||isPlanCoparticipationOnly(row)} onClick={()=>openEditor(row)}><Pencil/></button>{row.status!=="EXCLUIDO"&&!isPlanCoparticipationOnly(row)&&<button aria-label={`Excluir ${row.name} da base`} title={`Excluir ${row.name} da base`} disabled={busy||row.status==="PENDENTE"} onClick={()=>setTarget(row)}><Trash2/></button>}</div></td>
          </tr>)}</tbody>
        </table>{!visible.length&&<div className="table-empty">{loading?"Carregando base...":"Nenhum cadastro na vigência e filtros selecionados."}</div>}</div>
      </section>
      {preview&&<section className="surface plan-import-preview" aria-label="Conferir importação da base"><h3>Conferir importação</h3><p>{preview.source} · vigência {month} · {preview.records.length} CPF(s) · {preview.records.filter(r=>r.status==="PENDENTE").length} pendente(s) RH · descontos ativos {formatMoney(preview.records.filter(r=>r.status==="ATIVO").reduce((s,r)=>s+(r.value??0),0))}</p><p>Confira a vigência antes de confirmar. Cadastros ausentes no arquivo não serão excluídos.</p>{preview.issues.length>0&&<ul>{preview.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setPreview(null)}>Cancelar</button><button className="button primary" disabled={busy||!preview.records.length} onClick={()=>void confirmImport()}>Confirmar importação</button></div></section>}
      {draft&&<div className="modal-backdrop"><div className="modal form-modal plan-base-editor" role="dialog" aria-modal="true" aria-label="Cadastro do plano"><div className="section-header"><h3>{editing?"Editar cadastro do plano":"Adicionar funcionário ao plano"}</h3><button className="icon-plain" disabled={busy} aria-label="Fechar cadastro do plano" onClick={()=>setDraft(null)}><X/></button></div><div className="plan-base-form">
        <label className="field"><span>Nome do funcionário</span><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label className="field"><span>CPF</span><input disabled={editing} value={draft.cpf} onChange={e=>setDraft({...draft,cpf:e.target.value})}/></label><label className="field"><span>Empresa</span><input value={draft.company} onChange={e=>setDraft({...draft,company:e.target.value})}/></label><label className="field"><span>Cidade</span><input value={draft.city} onChange={e=>setDraft({...draft,city:e.target.value})}/></label><label className="field"><span>Plano / operadora</span><input value={draft.plan} onChange={e=>setDraft({...draft,plan:e.target.value})}/></label><label className="field"><span>Setor / centro de custo</span><input value={draft.department} onChange={e=>setDraft({...draft,department:e.target.value})}/></label><label className="field"><span>Desconto mensal (R$)</span><input inputMode="decimal" disabled={draft.status==="PENDENTE"} value={draft.value} onChange={e=>setDraft({...draft,value:e.target.value})}/></label>
        <label className="field"><span>FATURA (R$) · opcional</span><input inputMode="decimal" placeholder="Não informada" value={draft.invoice} onChange={e=>setDraft({...draft,invoice:e.target.value})}/></label>
        <label className="field"><span>Coparticipação (R$) · opcional</span><input inputMode="decimal" placeholder="Não informada" disabled={draft.status==="PENDENTE"} value={draft.coparticipation} onChange={e=>setDraft({...draft,coparticipation:e.target.value})}/></label>
        <label className="field"><span>Competência da coparticipação</span><input type="month" value={draft.coparticipationMonth} onChange={e=>{const next=e.target.value;if(next)setDraft({...draft,coparticipationMonth:next,coparticipation:invoiceText(planCoparticipationsAtMonth(versions,next).find(row=>row.cpf===draft.cpf)?.metadata.coparticipation)});}}/></label>
        <p className="plan-copart-help">Coparticipação informativa do mês selecionado. O total usado na conferência é o Desconto mensal; a coparticipação não será somada novamente.</p>
        <label className="field"><span>Situação do plano</span><select aria-label="Situação do plano" value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value as PlanBaseStatus})}><option value="ATIVO">Ativo</option><option value="INATIVO">Inativo</option><option value="EXCLUIDO">Excluído da base</option>{draft.status==="PENDENTE"&&<option value="PENDENTE">Pendente RH</option>}</select></label><label className="field"><span>Válido a partir de</span><input type="month" value={draft.effectiveFrom} onChange={e=>setDraft({...draft,effectiveFrom:e.target.value})}/></label>
        <label className="field plan-base-notes-field"><span>OBS · observações (opcional)</span><textarea aria-label="OBS · observações (opcional)" rows={3} maxLength={2000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
        {Array.isArray(draft.metadata.sourceConflicts)&&<div className="plan-base-conflicts"><strong>Dados originais pendentes RH</strong>{(draft.metadata.sourceConflicts as PlanBaseInput[]).map((row,i)=><p key={i}>Linha {String(row.metadata.sourceRow)}: {row.name} — {formatMoney(row.value)}</p>)}</div>}
      </div><p>A vigência organiza o histórico cadastral. A Conferência mensal usará esta nova versão para comparar qualquer folha, independentemente do mês. Comparativos já salvos não são modificados.</p><div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancelar</button><button className="button primary" disabled={busy} onClick={()=>void save()}>Salvar cadastro</button></div></div></div>}
      {copartDraft&&<div className="modal-backdrop"><form className="modal form-modal plan-copart-modal" role="dialog" aria-modal="true" aria-label="Editar coparticipação mensal" onSubmit={e=>{e.preventDefault();void saveCopart();}}>
        <div className="section-header"><h3>Coparticipação mensal</h3><button type="button" className="icon-plain" aria-label="Fechar coparticipação" disabled={busy} onClick={()=>setCopartDraft(null)}><X/></button></div>
        <p>{copartDraft.row.name} · {formatCpf(copartDraft.row.cpf,app.settings.maskCpf)}</p>
        <label className="field"><span>Competência da coparticipação</span><input type="month" disabled={busy} value={copartDraft.month} onChange={e=>{const next=e.target.value;if(next)setCopartDraft({...copartDraft,month:next,value:invoiceText(planCoparticipationsAtMonth(versions,next).find(row=>row.cpf===copartDraft.row.cpf)?.metadata.coparticipation)});}}/></label>
        <label className="field"><span>Coparticipação mensal (R$)</span><input ref={copartInput} inputMode="decimal" disabled={busy} placeholder="Não informada" value={copartDraft.value} onChange={e=>setCopartDraft({...copartDraft,value:e.target.value})}/></label>
        <p className="plan-copart-help">Este lançamento detalha somente o mês escolhido. Branco significa não informado; zero significa coparticipação zerada. O desconto cadastrado e os outros meses são preservados.</p>
        <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setCopartDraft(null)}>Cancelar</button><button type="submit" className="button primary" disabled={busy}>Salvar coparticipação</button></div>
      </form></div>}
      <ConfirmationModal open={Boolean(target)} danger title="Excluir da base sem apagar o histórico?" description={`Será criada uma versão excluída em ${month}, sem apagar o histórico. A Conferência mensal passa a considerar este CPF sem desconto previsto na base atual, para qualquer folha. Comparativos já salvos continuam disponíveis.`} confirmLabel="Excluir da base" onClose={()=>{if(!busy)setTarget(null);}} onConfirm={()=>{if(!target||busy)return;setBusy(true);void savePlanBase(kind,month,[{...target,status:"EXCLUIDO"}]).then(async()=>{await reload();setTarget(null);toast("success","Cadastro excluído da base","O histórico foi preservado.");}).catch(e=>toast("error","Não foi possível excluir",e instanceof Error?e.message:undefined)).finally(()=>setBusy(false));}}/>
    </>}
  </div>;
}
