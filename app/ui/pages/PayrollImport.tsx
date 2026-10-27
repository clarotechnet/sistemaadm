"use client";

import {useEffect,useState} from "react";
import {CalendarDays,FileSearch,Upload} from "lucide-react";
import type {ActivePayroll} from "../../../src/types";
import {analyzePayrollFile,type PayrollImportAnalysis} from "../../../src/services/payroll-import";
import {loadPayrollMonth,savePayrollSources,type PayrollSourceInput} from "../../../src/services/browser-backend";
import {normalizeSourceLabel,payrollFileHash,sourceLabel} from "../../../src/modules/payroll/sources";
import {FileDropzone} from "../components/FileDropzone";
import {ConfirmationModal,ProcessingLog} from "../components/Common";
import {useApp} from "../state/AppContext";

type FileChoice={file:File;label:string;sourceId:string};
type Preview={analysis:PayrollImportAnalysis;source:PayrollSourceInput};
const money=(value:number|null)=>value===null?"Não informado":value.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const monthNames=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
export function PayrollImport({onDone}:{onDone:()=>void}){
  const app=useApp();
  const [choices,setChoices]=useState<FileChoice[]>([]);
  const [competence,setCompetence]=useState(app.selectedCompetence??new Date().toLocaleDateString("pt-BR",{month:"2-digit",year:"numeric"}));
  const [target,setTarget]=useState<ActivePayroll|null>(null),[targetLoading,setTargetLoading]=useState(true),[targetError,setTargetError]=useState("");
  const [logs,setLogs]=useState<string[]>([]),[progress,setProgress]=useState(0),[busy,setBusy]=useState(false),[confirmUpdate,setConfirmUpdate]=useState(false);
  const [preview,setPreview]=useState<Preview[]>([]),[acknowledged,setAcknowledged]=useState(false),[importError,setImportError]=useState("");
  const invalidate=()=>{setPreview([]);setAcknowledged(false);setImportError("");setLogs([]);setProgress(0);};
  const match=competence.trim().match(/^(\d{1,2})\/(\d{4})$/),normalized=match&&Number(match[1])>=1&&Number(match[1])<=12?`${match[1].padStart(2,"0")}/${match[2]}`:null;
  const [selectedMonth,selectedYear]=competence.split("/");
  const years=[...new Set([...Array.from({length:201},(_,index)=>1900+index),Number(selectedYear),...app.payrollMonths.map(month=>Number(month.competence.split("/")[1]))])].sort((a,b)=>b-a);
  const changeCompetence=(value:string)=>{if(value===competence)return;invalidate();setCompetence(value);setTarget(null);setTargetLoading(true);setTargetError("");setChoices(current=>current.map(choice=>({...choice,sourceId:""})));};
  useEffect(()=>{
    let cancelled=false;
    if(!normalized)return;
    loadPayrollMonth(normalized).then(value=>{if(!cancelled){setTarget(value);setTargetError("");setTargetLoading(false);}}).catch(error=>{if(!cancelled){setTargetError(error instanceof Error?error.message:"Não foi possível consultar as folhas existentes.");setTargetLoading(false);}});
    return()=>{cancelled=true;};
  },[competence,normalized]);
  const receiveFiles=(files:File[])=>{invalidate();setChoices(current=>files.map(file=>current.find(choice=>choice.file===file)??{file,label:sourceLabel(file.name),sourceId:""}));};
  const patch=(index:number,value:Partial<FileChoice>)=>{invalidate();setChoices(current=>current.map((choice,position)=>position===index?{...choice,...value}:choice));};
  const validate=()=>{
    if(!normalized)throw new Error("Informe a competência no formato MM/AAAA.");
    if(!choices.length||choices.length>20)throw new Error("Selecione entre 1 e 20 folhas PDF ou XLS/XLSX por importação.");
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
  const analyze=async()=>{
    if(busy)return;
    try{validate();}catch(error){app.toast("warning","Revise a importação",error instanceof Error?error.message:undefined);return;}
    setBusy(true);setPreview([]);setAcknowledged(false);setImportError("");setLogs(["Analisando os arquivos localmente. Dados da folha só serão gravados após sua confirmação."]);setProgress(5);
    try{
      const results:Preview[]=[];
      for(const [index,choice] of choices.entries()){
        const analysis=await analyzePayrollFile(choice.file,normalized!,app.user.name),existing=target?.sources?.find(source=>source.id===choice.sourceId);
        results.push({analysis,source:{payroll:analysis.payroll,label:choice.label,fileHash:await payrollFileHash(choice.file),sourceId:existing?.id,expectedUpdatedAt:existing?.importedAt}});
        setLogs(current=>[...current,`${choice.label}: ${analysis.payroll.records.length} CPF(s) reconhecidos (${analysis.format}).`,...analysis.warnings]);setProgress(10+Math.round((index+1)/choices.length*70));
      }
      setPreview(results);setProgress(85);setLogs(current=>[...current,"Prévia pronta. Confira os totais e confirme a importação."]);
    }catch(error){const message=error instanceof Error?error.message:"Falha na leitura dos arquivos.";setImportError(message);app.toast("error","Não foi possível analisar a folha",message);}
    finally{setBusy(false);}
  };
  const warnings=preview.flatMap(item=>item.analysis.warnings);
  const run=async()=>{
    if(busy||!preview.length||warnings.length&&!acknowledged)return;
    try{validate();}catch(error){app.toast("warning","Revise a importação",error instanceof Error?error.message:undefined);return;}
    setBusy(true);setImportError("");
    try{
      setLogs(current=>[...current,"Gravando o lote em uma única transação. As demais folhas serão preservadas..."]);
      const result=await savePayrollSources(normalized!,preview.map(item=>item.source));setProgress(90);
      await app.refreshPayrollMonths(normalized!);setProgress(100);
      app.addAudit({operation:"Importou arquivos da Folha de Pagamento",module:"Folha",result:`${normalized}: ${result.added} adicionada(s), ${result.updated} atualizada(s), ${result.payroll.records.length} CPFs no consolidado`,fileName:choices.map(choice=>choice.file.name).join("; "),status:"SUCESSO",processedCount:result.payroll.records.length});
      app.toast("success","Folhas salvas na competência",`${result.added} adicionada(s) · ${result.updated} atualizada(s) · ${result.payroll.records.length} CPFs únicos.`);onDone();
    }catch(error){const message=error instanceof Error?error.message:"Falha inesperada na importação.";setImportError(message);app.toast("error","Não foi possível concluir a importação",message);}
    finally{setBusy(false);}
  };
  const start=()=>{try{validate();if(choices.some(choice=>choice.sourceId))setConfirmUpdate(true);else void run();}catch(error){app.toast("warning","Revise a importação",error instanceof Error?error.message:undefined);}};
  return <section className="surface import-surface"><div className="section-header"><div><h3>Importar Folha de Pagamento</h3><p>Escolha PDF ou Excel. Envie uma ou várias folhas da mesma competência, separadas por empresa/unidade.</p></div></div><div className="import-form">
    <fieldset className="payroll-competence-picker" disabled={busy}><legend><CalendarDays size={16}/> Competência da importação</legend><div><label className="field"><span>Mês</span><select aria-label="Mês da importação" value={selectedMonth} onChange={event=>changeCompetence(`${event.target.value}/${selectedYear}`)}>{monthNames.map((month,index)=><option key={month} value={String(index+1).padStart(2,"0")}>{String(index+1).padStart(2,"0")} · {month}</option>)}</select></label><label className="field"><span>Ano</span><select aria-label="Ano da importação" value={selectedYear} onChange={event=>changeCompetence(`${selectedMonth}/${event.target.value}`)}>{years.map(year=><option key={year} value={year}>{year}</option>)}</select></label></div><small>As folhas selecionadas serão importadas para <strong>{competence}</strong>.</small></fieldset>
    {targetError&&<p className="payroll-import-error" role="alert">Não foi possível verificar as folhas existentes: {targetError}</p>}
    {normalized&&!targetError&&<p className="payroll-source-note">{targetLoading?"Consultando folhas existentes...":`${target?.sources?.length??(target?1:0)} folha(s) já cadastrada(s) nesta competência. Novos arquivos serão acrescentados, não substituirão o mês.`}</p>}
    <div className="payroll-format-help"><strong>Excel · XLS/XLSX</strong><p>Continua disponível com a coluna final de líquido e os descontos.</p><strong>PDF · Extrato Mensal</strong><p>Modelo do extrato enviado, com CPF, rubricas P/D e resumo geral. Lê horas, percentuais e valores separadamente. PDF escaneado, sem resumo ou outro layout: use Excel.</p><small>Até 50 MB por arquivo. PDF e Excel da mesma folha são alternativas; para trocar o formato, escolha “Atualizar somente” abaixo.</small></div>
    <FileDropzone accept=".pdf,.xls,.xlsx" multiple disabled={busy} files={choices.map(choice=>choice.file)} onFiles={receiveFiles} label="Arraste as Folhas de Pagamento" hint="selecione PDF, XLS ou XLSX da mesma competência"/>
    {choices.length>0&&<div className="payroll-import-choices">{choices.map((choice,index)=><div className="payroll-import-choice" key={`${choice.file.name}:${index}`}><strong>{choice.file.name}</strong><label className="field"><span>Identificação da folha {index+1}</span><input disabled={busy} maxLength={120} value={choice.label} placeholder="Ex.: DMV Natal, VNA Natal, RDT" onChange={event=>patch(index,{label:event.target.value})}/></label><label className="field"><span>Ação para o arquivo {index+1}</span><select disabled={busy||targetLoading||Boolean(targetError)} value={choice.sourceId} onChange={event=>{const source=target?.sources?.find(item=>item.id===event.target.value);patch(index,{sourceId:event.target.value,...(source?{label:source.label}:{})});}}><option value="">Adicionar nova folha (preservar as demais)</option>{target?.sources?.map(source=><option value={source.id} key={source.id}>Atualizar somente: {source.label}</option>)}</select></label>{choice.sourceId&&<p className="payroll-replace-note">O arquivo escolhido será substituído; os demais arquivos da competência não serão alterados.</p>}</div>)}</div>}
    <ProcessingLog logs={logs} progress={progress}/>
    {importError&&<p className="payroll-import-error" role="alert">{importError}</p>}
    {preview.length>0&&<section className="payroll-import-preview" aria-label="Prévia da importação"><h4>Confira antes de importar · {normalized}</h4>{preview.map(({analysis,source},index)=><article key={index}><h4>{source.label} <span className="status-badge neutral">{analysis.format}</span></h4><p>{analysis.company}{analysis.companyDocument&&` · CNPJ ${analysis.companyDocument}`}</p><p>{analysis.payroll.records.length} CPFs · {source.sourceId?"Atualizar somente esta folha":"Adicionar nova folha"}</p><dl>{([["Proventos",analysis.totals.gross],["Descontos",analysis.totals.deductions],["Líquido",analysis.totals.liquid],["Plano de Saúde",analysis.totals.health],["Plano Odontológico",analysis.totals.dental]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>{analysis.checks.map(check=><p className="payroll-preview-check" key={check}>{check}</p>)}{analysis.warnings.map(warning=><p className="payroll-preview-warning" key={warning}>Atenção: {warning}</p>)}</article>)}{warnings.length>0&&<label className="payroll-preview-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event=>setAcknowledged(event.target.checked)}/> Li os avisos e conferi os valores antes de importar.</label>}</section>}
    <div className="form-actions">{!preview.length?<button className="button primary" disabled={busy||!choices.length||targetLoading||Boolean(targetError)||!normalized} onClick={()=>void analyze()}><FileSearch size={16}/>{busy?"Analisando arquivos...":"Analisar arquivos"}</button>:<><button className="button secondary" disabled={busy} onClick={invalidate}>Revisar seleção</button><button className="button primary" disabled={busy||Boolean(warnings.length&&!acknowledged)} onClick={start}><Upload size={16}/>{busy?"Salvando folhas...":"Importar folhas selecionadas"}</button></>}</div>
    <ConfirmationModal open={confirmUpdate} title="Atualizar os arquivos escolhidos?" description={`Você marcou ${choices.filter(choice=>choice.sourceId).length} folha(s) para substituição em ${normalized}. Somente essas folhas serão atualizadas; as demais serão preservadas. Novos arquivos do lote serão acrescentados.`} confirmLabel="Confirmar atualização das folhas" onClose={()=>setConfirmUpdate(false)} onConfirm={()=>void run()}/>
  </div></section>;
}
