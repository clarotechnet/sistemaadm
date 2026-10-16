"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import type { ComparisonKind } from "../../../src/modules/comparisons/processor";
import { parsePlanBase, parsePlanValue, planBaseAtMonth, type PlanBaseInput, type PlanBaseStatus, type PlanBaseVersion } from "../../../src/modules/benefits/plan-base";
import { savePlanBase } from "../../../src/services/benefit-plan-base";
import { readExcel } from "../../../src/services/excel";
import { formatCpf } from "../../../src/utils/cpf";
import { formatMoney } from "../../../src/utils/money";
import { ConfirmationModal, MetricCard } from "../components/Common";
import { useApp } from "../state/AppContext";
import { PlanComparison } from "./PlanComparison";

const thisMonth=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;};
type Draft = Omit<PlanBaseInput,"value"> & {value:string;effectiveFrom:string};
const emptyDraft=(month:string):Draft=>({cpf:"",name:"",company:"",city:"",department:"",plan:"",value:"",status:"ATIVO",notes:"",metadata:{},effectiveFrom:month});
const labelStatus=(status:PlanBaseStatus)=>status==="PENDENTE"?"PENDENTE RH":status;
const emptyVersions:PlanBaseVersion[]=[];

export function PlanBenefitModule({kind,onImport}:{kind:ComparisonKind;onImport?:()=>void}) {
  const app=useApp(),{toast}=app;
  const [tab,setTab]=useState<"base"|"monthly">("base");
  const versions=app.planBases[kind]??emptyVersions,error=app.planBaseErrors[kind],loading=app.planBases[kind]===null&&!error;
  const [month,setMonth]=useState(thisMonth),[query,setQuery]=useState(""),[status,setStatus]=useState("TODOS"),[history,setHistory]=useState(false);
  const [draft,setDraft]=useState<Draft|null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false);
  const [target,setTarget]=useState<PlanBaseVersion|null>(null),[preview,setPreview]=useState<{records:PlanBaseInput[];issues:string[];source:string}|null>(null);
  const refreshPlanBase=app.refreshPlanBase;
  const reload=useCallback(()=>refreshPlanBase(kind),[kind,refreshPlanBase]);
  useEffect(()=>{const timer=setTimeout(()=>void reload(),0);return()=>clearTimeout(timer);},[reload]);
  const current=useMemo(()=>planBaseAtMonth(versions,month),[versions,month]);
  const active=current.filter(row=>row.status==="ATIVO"),pending=current.filter(row=>row.status==="PENDENTE");
  const visible=(history?versions:current).filter(row=>{
    const text=query.trim().toLocaleLowerCase("pt-BR"),digits=query.replace(/\D/g,"");
    return (status==="TODOS"?(history||row.status!=="EXCLUIDO"):row.status===status)&&(!text||[row.name,row.company,row.city,row.plan].some(value=>value.toLocaleLowerCase("pt-BR").includes(text))||Boolean(digits&&row.cpf.includes(digits)));
  });
  const state=kind==="health"?app.savedHealth:app.savedDental;
  const save=async()=>{
    if(!draft)return;
    setBusy(true);
    try{
      const record={...draft,value:draft.status==="PENDENTE"?null:parsePlanValue(draft.value)};
      await savePlanBase(kind,draft.effectiveFrom,[record]);await reload();setDraft(null);
      app.addAudit({operation:editing?"Alterou cadastro do plano":"Adicionou cadastro do plano",module:"Benefícios",result:`${kind==="health"?"Saúde":"Odonto"} · vigência ${draft.effectiveFrom} · histórico preservado`,status:"SUCESSO"});
      toast("success","Cadastro salvo","A alteração não modifica comparativos já salvos.");
    }catch(e){toast("error","Não foi possível salvar",e instanceof Error?e.message:undefined);}finally{setBusy(false);}
  };
  const importFile=async(file:File)=>{
    setBusy(true);
    try {const parsed=parsePlanBase(await readExcel(file,{preserveBlankRows:true}),kind);setPreview({records:parsed.records,issues:parsed.issues,source:file.name});}
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
        <div className="plan-base-toolbar"><div className="search-box"><Search/><input aria-label="Pesquisar cadastro do plano" placeholder="Pesquisar nome, CPF ou empresa" value={query} onChange={e=>setQuery(e.target.value)}/></div><label className="field"><span>Vigência em exibição</span><input type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label><label className="field"><span>Situação</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="TODOS">Ativos, inativos e pendentes</option><option value="ATIVO">Ativos</option><option value="INATIVO">Inativos</option><option value="PENDENTE">Pendentes RH</option><option value="EXCLUIDO">Excluídos da base</option></select></label></div>
        <div className="plan-base-actions"><label className="button secondary"><Upload/>{busy?"Aguarde...":"Importar base XLS/XLSX"}<input hidden type="file" accept=".xls,.xlsx" disabled={busy||Boolean(error)||loading} onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.currentTarget.value="";}}/></label><button className="button secondary" disabled={busy||!state||Boolean(error)||loading} onClick={copySaved}>Copiar referência salva</button><label className="checkbox-line"><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/><History size={14}/> Mostrar histórico de versões</label><span>{visible.length} registro(s)</span></div>
        {pending.length>0&&<div className="inline-warning plan-base-pending">Existem {pending.length} CPF(s) pendentes RH. Nenhum valor foi presumido para eles. Edite o cadastro depois da confirmação do RH.</div>}
        <div className="table-scroll"><table className="data-table plan-base-table"><thead><tr><th>Funcionário</th><th>CPF</th><th>Empresa / cidade</th><th>Plano / setor</th><th className="right">Desconto previsto</th><th>Situação</th><th>Vigência</th><th>Atualizado em</th><th>Ações</th></tr></thead><tbody>{visible.map(row=><tr key={row.id} className={row.status==="PENDENTE"?"row-warning":undefined}><td><strong>{row.name}</strong><small className="block-muted">{row.source}</small></td><td className="mono">{formatCpf(row.cpf,app.settings.maskCpf)}</td><td>{row.company||"—"}<small className="block-muted">{row.city}</small></td><td>{row.plan||"—"}<small className="block-muted">{row.department}</small></td><td className="right">{formatMoney(row.value)}</td><td><span className={`status-badge ${row.status==="ATIVO"?"success":row.status==="PENDENTE"?"warning":"neutral"}`}>{labelStatus(row.status)}</span></td><td>{row.effectiveFrom.split("-").reverse().join("/")}<small className="block-muted">Versão {row.revision}</small></td><td>{new Date(row.createdAt).toLocaleString("pt-BR")}<small className="block-muted">{row.createdByName}</small></td><td><div className="row-actions"><button aria-label={`Editar ${row.name}`} title={`Editar ${row.name}`} disabled={busy||loading} onClick={()=>{setEditing(true);setDraft({...row,value:row.value===null?"":row.value.toFixed(2).replace(".",","),effectiveFrom:month});}}><Pencil/> Editar / desativar</button>{row.status!=="EXCLUIDO"&&<button title={`Excluir ${row.name} da base`} disabled={busy||row.status==="PENDENTE"} onClick={()=>setTarget(row)}><Trash2/></button>}</div></td></tr>)}</tbody></table>{!visible.length&&<div className="table-empty">{loading?"Carregando base...":"Nenhum cadastro na vigência e filtros selecionados."}</div>}</div>
      </section>
      {preview&&<section className="surface plan-import-preview" aria-label="Conferir importação da base"><h3>Conferir importação</h3><p>{preview.source} · vigência {month} · {preview.records.length} CPF(s) · {preview.records.filter(r=>r.status==="PENDENTE").length} pendente(s) RH · descontos ativos {formatMoney(preview.records.filter(r=>r.status==="ATIVO").reduce((s,r)=>s+(r.value??0),0))}</p><p>Confira a vigência antes de confirmar. Cadastros ausentes no arquivo não serão excluídos.</p>{preview.issues.length>0&&<ul>{preview.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setPreview(null)}>Cancelar</button><button className="button primary" disabled={busy||!preview.records.length} onClick={()=>void confirmImport()}>Confirmar importação</button></div></section>}
      {draft&&<div className="modal-backdrop"><div className="modal form-modal plan-base-editor" role="dialog" aria-modal="true" aria-label="Cadastro do plano"><div className="section-header"><h3>{editing?"Editar cadastro do plano":"Adicionar funcionário ao plano"}</h3><button className="icon-plain" disabled={busy} aria-label="Fechar cadastro do plano" onClick={()=>setDraft(null)}><X/></button></div><div className="plan-base-form">
        <label className="field"><span>Nome do funcionário</span><input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label className="field"><span>CPF</span><input disabled={editing} value={draft.cpf} onChange={e=>setDraft({...draft,cpf:e.target.value})}/></label><label className="field"><span>Empresa</span><input value={draft.company} onChange={e=>setDraft({...draft,company:e.target.value})}/></label><label className="field"><span>Cidade</span><input value={draft.city} onChange={e=>setDraft({...draft,city:e.target.value})}/></label><label className="field"><span>Plano / operadora</span><input value={draft.plan} onChange={e=>setDraft({...draft,plan:e.target.value})}/></label><label className="field"><span>Setor / centro de custo</span><input value={draft.department} onChange={e=>setDraft({...draft,department:e.target.value})}/></label><label className="field"><span>Desconto mensal (R$)</span><input inputMode="decimal" disabled={draft.status==="PENDENTE"} value={draft.value} onChange={e=>setDraft({...draft,value:e.target.value})}/></label><label className="field"><span>Situação do plano</span><select aria-label="Situação do plano" value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value as PlanBaseStatus})}><option value="ATIVO">Ativo</option><option value="INATIVO">Inativo</option><option value="EXCLUIDO">Excluído da base</option>{draft.status==="PENDENTE"&&<option value="PENDENTE">Pendente RH</option>}</select></label><label className="field"><span>Válido a partir de</span><input type="month" value={draft.effectiveFrom} onChange={e=>setDraft({...draft,effectiveFrom:e.target.value})}/></label><label className="field"><span>Observações</span><input maxLength={2000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
        {Array.isArray(draft.metadata.sourceConflicts)&&<div className="plan-base-conflicts"><strong>Dados originais pendentes RH</strong>{(draft.metadata.sourceConflicts as PlanBaseInput[]).map((row,i)=><p key={i}>Linha {String(row.metadata.sourceRow)}: {row.name} — {formatMoney(row.value)}</p>)}</div>}
      </div><p>A vigência organiza o histórico cadastral. A Conferência mensal usará esta nova versão para comparar qualquer folha, independentemente do mês. Comparativos já salvos não são modificados.</p><div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setDraft(null)}>Cancelar</button><button className="button primary" disabled={busy} onClick={()=>void save()}>Salvar cadastro</button></div></div></div>}
      <ConfirmationModal open={Boolean(target)} danger title="Excluir da base sem apagar o histórico?" description={`Será criada uma versão excluída em ${month}, sem apagar o histórico. A Conferência mensal passa a considerar este CPF sem desconto previsto na base atual, para qualquer folha. Comparativos já salvos continuam disponíveis.`} confirmLabel="Excluir da base" onClose={()=>{if(!busy)setTarget(null);}} onConfirm={()=>{if(!target||busy)return;setBusy(true);void savePlanBase(kind,month,[{...target,status:"EXCLUIDO"}]).then(async()=>{await reload();setTarget(null);toast("success","Cadastro excluído da base","O histórico foi preservado.");}).catch(e=>toast("error","Não foi possível excluir",e instanceof Error?e.message:undefined)).finally(()=>setBusy(false));}}/>
    </>}
  </div>;
}
