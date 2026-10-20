"use client";

import {useEffect,useState} from "react";
import {CalendarDays,Upload} from "lucide-react";
import type {ActivePayroll} from "../../../src/types";
import {readExcel} from "../../../src/services/excel";
import {loadPayrollMonth,savePayrollSources,type PayrollSourceInput} from "../../../src/services/browser-backend";
import {processPayroll} from "../../../src/modules/payroll/processor";
import {normalizeSourceLabel,payrollFileHash,sourceLabel} from "../../../src/modules/payroll/sources";
import {FileDropzone} from "../components/FileDropzone";
import {ConfirmationModal,ProcessingLog} from "../components/Common";
import {useApp} from "../state/AppContext";

type FileChoice={file:File;label:string;sourceId:string};
const monthNames=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
export function PayrollImport({onDone}:{onDone:()=>void}){
  const app=useApp();
  const [choices,setChoices]=useState<FileChoice[]>([]);
  const [competence,setCompetence]=useState(app.selectedCompetence??new Date().toLocaleDateString("pt-BR",{month:"2-digit",year:"numeric"}));
  const [target,setTarget]=useState<ActivePayroll|null>(null),[targetLoading,setTargetLoading]=useState(true),[targetError,setTargetError]=useState("");
  const [logs,setLogs]=useState<string[]>([]),[progress,setProgress]=useState(0),[busy,setBusy]=useState(false),[confirmUpdate,setConfirmUpdate]=useState(false);
  const match=competence.trim().match(/^(\d{1,2})\/(\d{4})$/),normalized=match&&Number(match[1])>=1&&Number(match[1])<=12?`${match[1].padStart(2,"0")}/${match[2]}`:null;
  const [selectedMonth,selectedYear]=competence.split("/");
  const years=[...new Set([...Array.from({length:201},(_,index)=>1900+index),Number(selectedYear),...app.payrollMonths.map(month=>Number(month.competence.split("/")[1]))])].sort((a,b)=>b-a);
  const changeCompetence=(value:string)=>{if(value===competence)return;setCompetence(value);setTarget(null);setTargetLoading(true);setTargetError("");setChoices(current=>current.map(choice=>({...choice,sourceId:""})));};
  useEffect(()=>{
    let cancelled=false;
    if(!normalized)return;
    loadPayrollMonth(normalized).then(value=>{if(!cancelled){setTarget(value);setTargetError("");setTargetLoading(false);}}).catch(error=>{if(!cancelled){setTargetError(error instanceof Error?error.message:"Não foi possível consultar as folhas existentes.");setTargetLoading(false);}});
    return()=>{cancelled=true;};
  },[competence,normalized]);
  const receiveFiles=(files:File[])=>setChoices(current=>files.map(file=>current.find(choice=>choice.file===file)??{file,label:sourceLabel(file.name),sourceId:""}));
  const patch=(index:number,value:Partial<FileChoice>)=>setChoices(current=>current.map((choice,position)=>position===index?{...choice,...value}:choice));
  const validate=()=>{
    if(!normalized)throw new Error("Informe a competência no formato MM/AAAA.");
    if(!choices.length||choices.length>20)throw new Error("Selecione entre 1 e 20 folhas XLS/XLSX por importação.");
    if(targetLoading||targetError)throw new Error(targetError||"Aguarde a consulta das folhas desta competência.");
    const labels=new Set<string>(),ids=new Set<string>();
    for(const choice of choices){
      const label=normalizeSourceLabel(choice.label);
      if(!label||choice.label.trim().length>120)throw new Error("Identifique cada folha pela empresa/unidade (até 120 caracteres).");
      if(labels.has(label))throw new Error("Use identificações diferentes para cada folha do lote.");labels.add(label);
      if(choice.sourceId){if(ids.has(choice.sourceId))throw new Error("Uma folha existente não pode ser atualizada duas vezes no mesmo lote.");ids.add(choice.sourceId);if(!target?.sources?.some(source=>source.id===choice.sourceId))throw new Error("A folha escolhida não pertence à competência. Selecione-a novamente.");}
      if(target?.sources?.some(source=>source.id!==choice.sourceId&&normalizeSourceLabel(source.label)===label))throw new Error(`Já existe a folha ${choice.label}. Escolha atualizar esse arquivo ou use outra identificação para uma nova folha.`);
    }
  };
  const run=async()=>{
    if(busy)return;
    try{validate();}catch(error){app.toast("warning","Revise a importação",error instanceof Error?error.message:undefined);return;}
    setBusy(true);setLogs(["Lendo todas as folhas antes de gravar. Nenhuma substituição automática será feita."]);setProgress(5);
    try{
      const sources:PayrollSourceInput[]=[];
      for(const [index,choice] of choices.entries()){
        const workbook=await readExcel(choice.file),payroll=processPayroll(workbook,normalized!,app.user.name),existing=target?.sources?.find(source=>source.id===choice.sourceId);
        sources.push({payroll,label:choice.label,fileHash:await payrollFileHash(choice.file),sourceId:existing?.id,expectedUpdatedAt:existing?.importedAt});
        setLogs(current=>[...current,`${choice.label}: ${payroll.records.length} CPF(s) reconhecidos.`,...workbook.warnings]);setProgress(10+Math.round((index+1)/choices.length*60));
      }
      setLogs(current=>[...current,"Gravando o lote em uma única transação. As demais folhas serão preservadas..."]);
      const result=await savePayrollSources(normalized!,sources);setProgress(90);
      await app.refreshPayrollMonths(normalized!);setProgress(100);
      app.addAudit({operation:"Importou arquivos da Folha de Pagamento",module:"Folha",result:`${normalized}: ${result.added} adicionada(s), ${result.updated} atualizada(s), ${result.payroll.records.length} CPFs no consolidado`,fileName:choices.map(choice=>choice.file.name).join("; "),status:"SUCESSO",processedCount:result.payroll.records.length});
      app.toast("success","Folhas salvas na competência",`${result.added} adicionada(s) · ${result.updated} atualizada(s) · ${result.payroll.records.length} CPFs únicos.`);onDone();
    }catch(error){const message=error instanceof Error?error.message:"Falha inesperada na importação.";setLogs(current=>[...current,message]);app.toast("error","Não foi possível concluir a importação",message);}
    finally{setBusy(false);}
  };
  const start=()=>{try{validate();if(choices.some(choice=>choice.sourceId))setConfirmUpdate(true);else void run();}catch(error){app.toast("warning","Revise a importação",error instanceof Error?error.message:undefined);}};
  return <section className="surface import-surface"><div className="section-header"><div><h3>Importar Folha de Pagamento</h3><p>Envie uma ou várias folhas da mesma competência. Cada empresa/unidade fica em um arquivo independente.</p></div></div><div className="import-form">
    <fieldset className="payroll-competence-picker" disabled={busy}><legend><CalendarDays size={16}/> Competência da importação</legend><div><label className="field"><span>Mês</span><select aria-label="Mês da importação" value={selectedMonth} onChange={event=>changeCompetence(`${event.target.value}/${selectedYear}`)}>{monthNames.map((month,index)=><option key={month} value={String(index+1).padStart(2,"0")}>{String(index+1).padStart(2,"0")} · {month}</option>)}</select></label><label className="field"><span>Ano</span><select aria-label="Ano da importação" value={selectedYear} onChange={event=>changeCompetence(`${selectedMonth}/${event.target.value}`)}>{years.map(year=><option key={year} value={year}>{year}</option>)}</select></label></div><small>As folhas selecionadas serão importadas para <strong>{competence}</strong>.</small></fieldset>
    {targetError&&<p className="payroll-import-error" role="alert">Não foi possível verificar as folhas existentes: {targetError}</p>}
    {normalized&&!targetError&&<p className="payroll-source-note">{targetLoading?"Consultando folhas existentes...":`${target?.sources?.length??(target?1:0)} folha(s) já cadastrada(s) nesta competência. Novos arquivos serão acrescentados, não substituirão o mês.`}</p>}
    <FileDropzone accept=".xls,.xlsx" multiple disabled={busy} files={choices.map(choice=>choice.file)} onFiles={receiveFiles} label="Arraste as Folhas de Pagamento" hint="selecione uma ou várias folhas XLS/XLSX da mesma competência"/>
    {choices.length>0&&<div className="payroll-import-choices">{choices.map((choice,index)=><div className="payroll-import-choice" key={`${choice.file.name}:${index}`}><strong>{choice.file.name}</strong><label className="field"><span>Identificação da folha {index+1}</span><input disabled={busy} maxLength={120} value={choice.label} placeholder="Ex.: DMV Natal, VNA Natal, RDT" onChange={event=>patch(index,{label:event.target.value})}/></label><label className="field"><span>Ação para o arquivo {index+1}</span><select disabled={busy||targetLoading||Boolean(targetError)} value={choice.sourceId} onChange={event=>{const source=target?.sources?.find(item=>item.id===event.target.value);patch(index,{sourceId:event.target.value,...(source?{label:source.label}:{})});}}><option value="">Adicionar nova folha (preservar as demais)</option>{target?.sources?.map(source=><option value={source.id} key={source.id}>Atualizar somente: {source.label}</option>)}</select></label>{choice.sourceId&&<p className="payroll-replace-note">O arquivo escolhido será substituído; os demais arquivos da competência não serão alterados.</p>}</div>)}</div>}
    <ProcessingLog logs={logs} progress={progress}/><div className="form-actions"><button className="button primary" disabled={busy||!choices.length||targetLoading||Boolean(targetError)||!normalized} onClick={start}><Upload size={16}/>{busy?"Processando folhas...":"Importar folhas selecionadas"}</button></div>
    <ConfirmationModal open={confirmUpdate} title="Atualizar os arquivos escolhidos?" description={`Você marcou ${choices.filter(choice=>choice.sourceId).length} folha(s) para substituição em ${normalized}. Somente essas folhas serão atualizadas; as demais serão preservadas. Novos arquivos do lote serão acrescentados.`} confirmLabel="Confirmar atualização das folhas" onClose={()=>setConfirmUpdate(false)} onConfirm={()=>void run()}/>
  </div></section>;
}
