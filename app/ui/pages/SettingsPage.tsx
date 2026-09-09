"use client";

import { useEffect, useState } from "react";
import { Database, Download, FileArchive, LockKeyhole, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { FileRetentionMode, RawFileUpload, SystemSettings } from "../../../src/types";
import { formatFileSize } from "../../../src/utils/download";
import { useApp } from "../state/AppContext";

const retentionHelp:Record<FileRetentionMode,string>={
  NONE:"O arquivo bruto permanece somente no navegador durante o processamento e não é enviado ao Supabase.",
  "24_HOURS":"Uma cópia privada é armazenada no Supabase e marcada para exclusão automática após 24 horas.",
  SECURE_OPTIONAL:"Cada área de upload mostra uma opção para decidir se uma cópia privada deve ser armazenada sem prazo automático.",
};

export function SettingsPage(){
  const app=useApp();
  const canEdit=app.user.role==="ADMINISTRADOR";
  const[tolerance,setTolerance]=useState("0,01");
  const[maskCpf,setMaskCpf]=useState(true);
  const[retention,setRetention]=useState<FileRetentionMode>("NONE");
  const[files,setFiles]=useState<RawFileUpload[]>([]);
  const[saving,setSaving]=useState(false);
  const[loadingFiles,setLoadingFiles]=useState(false);

  useEffect(()=>{setTolerance(app.settings.financialTolerance.toFixed(2).replace(".",","));setMaskCpf(app.settings.maskCpf);setRetention(app.settings.fileRetention)},[app.settings]);
  const loadFiles=async()=>{setLoadingFiles(true);try{const response=await fetch("/api/raw-files",{cache:"no-store"});if(!response.ok)return;const data=await response.json() as {files:RawFileUpload[]};setFiles(data.files)}finally{setLoadingFiles(false)}};
  useEffect(()=>{void loadFiles()},[]);
  const save=async()=>{
    if(!canEdit)return;
    const financialTolerance=Number(tolerance.replace(",","."));
    if(!Number.isFinite(financialTolerance)||financialTolerance<0){app.toast("warning","Tolerância inválida");return}
    setSaving(true);
    try{
      const payload:Partial<SystemSettings>={maskCpf,fileRetention:retention,financialTolerance};
      const response=await fetch("/api/settings",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      const data=await response.json() as {error?:string};
      if(!response.ok){app.toast("error","Não foi possível salvar",data.error);return}
      await app.refreshSettings();
      app.addAudit({operation:"Atualizou configurações",module:"Configurações",result:`Tolerância R$ ${financialTolerance.toFixed(2)}; CPF mascarado: ${maskCpf?"sim":"não"}; retenção: ${retention}`,status:"SUCESSO"});
      app.toast("success","Configurações salvas","A política já está valendo para os próximos uploads e tabelas.");
    }finally{setSaving(false)}
  };
  const downloadFile=async(id:string)=>{
    const response=await fetch(`/api/raw-files?download=${encodeURIComponent(id)}`,{cache:"no-store"});
    const data=await response.json() as {url?:string;error?:string};
    if(!response.ok||!data.url){app.toast("error","Não foi possível baixar",data.error);return}
    window.open(data.url,"_blank","noopener,noreferrer");
  };
  const removeFile=async(id:string)=>{
    const response=await fetch("/api/raw-files",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    if(!response.ok){const data=await response.json() as {error?:string};app.toast("error","Não foi possível excluir",data.error);return}
    setFiles(current=>current.filter(file=>file.id!==id));
    app.addAudit({operation:"Excluiu arquivo retido",module:"Privacidade",result:"Cópia privada removida do Storage",status:"SUCESSO"});
    app.toast("success","Arquivo excluído do armazenamento privado");
  };

  return <>
    <div className="page-heading"><div><h2>Configurações</h2><p>Parâmetros financeiros, privacidade e retenção de dados.</p></div><button className="button primary" disabled={!canEdit||saving||app.settingsLoading} onClick={save}><Save/> {saving?"Salvando...":"Salvar alterações"}</button></div>
    {!canEdit&&<div className="inline-warning settings-readonly"><ShieldCheck/><span><strong>Somente leitura</strong> Apenas Administradores podem alterar as políticas globais.</span></div>}
    <div className="settings-grid">
      <section className="surface settings-card"><span><Database/></span><div><h3>Processamento</h3><p>Defina valores padrão para os comparativos.</p><label className="field"><span>Tolerância financeira padrão</span><div className="money-input"><span>R$</span><input disabled={!canEdit} value={tolerance} onChange={event=>setTolerance(event.target.value)}/></div></label></div></section>
      <section className="surface settings-card"><span><ShieldCheck/></span><div><h3>Privacidade e LGPD</h3><p>Minimize a exposição de dados pessoais e controle a retenção dos arquivos originais.</p><label className="switch-row"><span><strong>Mascarar CPF nas tabelas</strong><small>Exibe ***.456.789-** nas telas; o CPF completo continua disponível internamente para os cruzamentos.</small></span><input disabled={!canEdit} type="checkbox" checked={maskCpf} onChange={event=>setMaskCpf(event.target.checked)}/></label><label className="field"><span>Retenção de arquivos</span><select disabled={!canEdit} value={retention} onChange={event=>setRetention(event.target.value as FileRetentionMode)}><option value="NONE">Não armazenar arquivos brutos</option><option value="24_HOURS">Excluir após 24 horas</option><option value="SECURE_OPTIONAL">Armazenamento seguro opcional</option></select><small>{retentionHelp[retention]}</small></label></div></section>
      <section className="surface settings-card"><span><LockKeyhole/></span><div><h3>Segurança</h3><p>A autenticação usa Supabase Auth e as tabelas protegidas usam RLS por usuário e perfil.</p><div className="security-line"><ShieldCheck/><span><strong>Autenticação e RLS ativos</strong><small>Chaves administrativas permanecem somente no servidor.</small></span></div></div></section>
    </div>
    <section className="surface retained-files-card"><div className="section-header"><div><h3>Arquivos retidos no Storage privado</h3><p>Somente cópias armazenadas pelos modos de retenção aparecem aqui.</p></div><span className="users-count-pill neutral">{files.length} arquivo(s)</span></div>
      {files.length?<div className="retained-file-list">{files.map(file=><article key={file.id}><span className="retained-file-icon"><FileArchive/></span><span><strong>{file.fileName}</strong><small>{formatFileSize(file.sizeBytes)} · armazenado em {new Date(file.createdAt).toLocaleString("pt-BR")}{file.expiresAt?` · expira ${new Date(file.expiresAt).toLocaleString("pt-BR")}`:" · sem expiração automática"}</small></span><span className={`status-badge ${file.expiresAt?"warning":"success"}`}>{file.expiresAt?"24 HORAS":"PRIVADO"}</span><button className="icon-plain retained-download" title="Baixar cópia privada" onClick={()=>void downloadFile(file.id)}><Download/></button><button className="icon-danger" title="Excluir cópia privada" onClick={()=>void removeFile(file.id)}><Trash2/></button></article>)}</div>:<div className="users-section-empty"><FileArchive/><span><strong>{loadingFiles?"Consultando armazenamento...":"Nenhum arquivo bruto retido"}</strong><small>No modo sem retenção, esta lista permanece vazia.</small></span></div>}
    </section>
  </>;
}
