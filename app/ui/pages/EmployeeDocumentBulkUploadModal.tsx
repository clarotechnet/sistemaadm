"use client";

import { useMemo, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import type { DocumentCategory, Employee } from "../../../src/types";
import { employeeDocumentAccept, employeeDocumentMaxSize } from "../../../src/services/employee-documents";
import { matchEmployeeFromFilename } from "../../../src/modules/employees/document-matching";
import { formatFileSize } from "../../../src/utils/download";

export type BulkUploadForm = { categoryId:string; competence:string; title:string; notes:string };
export type BulkFile = { file:File; match:ReturnType<typeof matchEmployeeFromFilename>; valid:boolean; issue:string|null };

export function prepareBulkFiles(files:readonly File[], employees:readonly Employee[]):BulkFile[] {
  return files.map(file=>{
    const match=matchEmployeeFromFilename(file.name,employees);
    const extension=file.name.split(".").pop()?.toLowerCase()??"";
    const valid=employeeDocumentAccept.split(",").includes("."+extension)&&file.size>0&&file.size<=employeeDocumentMaxSize;
    const issue=!employeeDocumentAccept.split(",").includes("."+extension)?"Formato não permitido"
      :!file.size?"Arquivo vazio":file.size>employeeDocumentMaxSize?"Acima de 50 MB por arquivo"
      :match.status==="unmatched"?"Funcionário não encontrado no cadastro"
      :match.status==="ambiguous"?"Mais de um funcionário possível: "+match.employeeNames.join(", ")
      :null;
    return{file,match,valid,issue};
  });
}

export function EmployeeDocumentBulkUploadModal({form,setForm,employees,categories,files,setFiles,busy,progress,onClose,onUpload}:{
  form:BulkUploadForm;setForm:(form:BulkUploadForm)=>void;employees:Employee[];categories:DocumentCategory[];
  files:File[];setFiles:React.Dispatch<React.SetStateAction<File[]>>;busy:boolean;progress:string;onClose:()=>void;onUpload:()=>void;
}) {
  const input=useRef<HTMLInputElement>(null);
  const [dragging,setDragging]=useState(false);
  const [previewCount,setPreviewCount]=useState(70);
  const prepared=useMemo(()=>prepareBulkFiles(files,employees),[files,employees]);
  const ready=prepared.filter(item=>item.valid&&item.match.status==="matched").length;
  const unmatched=prepared.filter(item=>item.match.status==="unmatched"&&item.valid).length;
  const ambiguous=prepared.filter(item=>item.match.status==="ambiguous"&&item.valid).length;
  const invalid=prepared.filter(item=>!item.valid).length;
  const canSend=Boolean(ready&&form.categoryId&&/^\d{4}-(0[1-9]|1[0-2])$/.test(form.competence));
  const addFiles=(list:FileList|null)=>{
    if(!list||busy)return;
    setFiles(previous=>{
      const known=new Set(previous.map(file=>[file.name,file.size,file.lastModified].join("|")));
      const next=[...previous];
      for(const file of Array.from(list)){
        const key=[file.name,file.size,file.lastModified].join("|");
        if(!known.has(key)){next.push(file);known.add(key)}
      }
      return next;
    });
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
    <div className="modal form-modal document-upload-modal document-bulk-modal" role="dialog" aria-modal="true" aria-label="Envio em massa de documentos">
      <h3>Enviar documentos em massa</h3>
      <p>Selecione a categoria e competência. O sistema identifica cada funcionário pelo <strong>nome completo no nome do arquivo</strong> e associa automaticamente ao cadastro.</p>
      <div className="two-fields">
        <label className="field grow"><span>Competência *</span><input type="month" required disabled={busy} value={form.competence} onChange={e=>setForm({...form,competence:e.target.value})}/></label>
        <label className="field grow"><span>Categoria *</span><select required disabled={busy} value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}>
          <option value="">Selecione a categoria</option>{categories.map(category=><option key={category.id} value={category.id}>{category.label}</option>)}
        </select></label>
      </div>
      <div className="two-fields">
        <label className="field grow"><span>Título do documento (opcional)</span><input disabled={busy} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Em branco: usa o nome original do PDF"/></label>
        <label className="field grow"><span>Observações (opcional)</span><input disabled={busy} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Informações adicionais para auditoria"/></label>
      </div>
      <button type="button" disabled={busy} className={`document-dropzone ${dragging?"dragging":""}`} onClick={()=>input.current?.click()}
        onDragOver={event=>{event.preventDefault();if(!busy)setDragging(true)}}
        onDragLeave={()=>setDragging(false)}
        onDrop={event=>{event.preventDefault();setDragging(false);addFiles(event.dataTransfer.files)}}>
        <Upload/><strong>Arraste vários documentos para cá</strong>
        <span>ou clique para selecionar quantos arquivos precisar</span>
        <small>PDF e demais formatos aceitos · até 50 MB por arquivo · identificação pelo nome completo, como “Espelho de Ponto Completo - JAILZA CORREIA ALVES-QuarkSign_13.pdf”</small>
      </button>
      <input hidden ref={input} multiple type="file" accept={employeeDocumentAccept} onChange={event=>{addFiles(event.target.files);event.target.value=""}}/>
      {files.length>0&&<>
        <div className="bulk-upload-stats" aria-live="polite">
          <span>{files.length} arquivo(s) selecionado(s)</span>
          <strong className="bulk-success">{ready} identificado(s)</strong>
          {unmatched>0&&<strong className="bulk-warning">{unmatched} sem correspondência</strong>}
          {ambiguous>0&&<strong className="bulk-warning">{ambiguous} ambíguo(s)</strong>}
          {invalid>0&&<strong className="bulk-warning">{invalid} inválido(s)</strong>}
          {!busy&&<button type="button" onClick={()=>setFiles([])}>Limpar seleção</button>}
        </div>
        {(unmatched+ambiguous+invalid)>0&&<p className="bulk-match-warning">Os arquivos sem identificação segura ou inválidos <strong>não serão enviados</strong>. Confira os nomes dos arquivos ou o cadastro dos funcionários antes de tentar novamente.</p>}
        <div className="document-selected-files bulk-document-files">
          {prepared.slice(0,previewCount).map(({file,match,issue},index)=><div key={file.name+"-"+file.lastModified+"-"+index} className={issue?"invalid":""}>
            <FileText/><span><strong title={file.name}>{file.name}</strong>
              <small>{formatFileSize(file.size)} · {issue??(match.status==="matched"?match.employee.name:"Sem identificação")}</small>
            </span><button type="button" disabled={busy} onClick={()=>setFiles(current=>current.filter(item=>item!==file))} aria-label={"Remover "+file.name}><X/></button>
          </div>)}
          {prepared.length>previewCount&&<button type="button" className="bulk-show-more" onClick={()=>setPreviewCount(n=>n+100)}>Ver mais 100 arquivos · {prepared.length-previewCount} restante(s)</button>}
        </div>
      </>}
      {progress&&<div className="upload-progress" role="status"><i/><span>{progress}</span></div>}
      <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="button" className="button primary" disabled={busy||!canSend} onClick={onUpload}>
          {busy?"Enviando documentos...":`Arquivar ${ready} documento(s)`}
        </button></div>
    </div>
  </div>;
}
