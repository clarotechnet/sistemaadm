"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, LockKeyhole, UploadCloud, X } from "lucide-react";
import { formatFileSize } from "../../../src/utils/download";
import { useApp } from "../state/AppContext";

export function FileDropzone({ accept, multiple = false, files, onFiles, label = "Arraste os arquivos para cá", hint = "ou clique para selecionar" }: { accept: string; multiple?: boolean; files: File[]; onFiles: (files: File[]) => void; label?: string; hint?: string }) {
  const app=useApp();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [storeSecure,setStoreSecure]=useState(false);
  const [archiving,setArchiving]=useState(false);
  const retention=app.settings.fileRetention;
  const archive=async(incoming:File[])=>{
    if(retention==="NONE"||(retention==="SECURE_OPTIONAL"&&!storeSecure)||!incoming.length)return;
    setArchiving(true);
    let stored=0;
    try{
      for(const file of incoming){
        const body=new FormData();body.append("file",file);body.append("optIn",storeSecure?"true":"false");
        const response=await fetch("/api/raw-files",{method:"POST",body});
        if(!response.ok){const data=await response.json() as {error?:string};app.toast("warning",`Arquivo processável, mas não retido: ${file.name}`,data.error);continue}
        stored++;
      }
      if(stored)app.toast("success",retention==="24_HOURS"?"Cópia privada temporária criada":"Cópia privada armazenada",retention==="24_HOURS"?`${stored} arquivo(s) serão excluídos após 24 horas.`:`${stored} arquivo(s) foram armazenados no Storage privado.`);
    }finally{setArchiving(false)}
  };
  const select = (list: FileList | null) => {
    if (!list) return;
    const incoming = [...list];
    onFiles(multiple ? [...files, ...incoming] : incoming.slice(0, 1));
    void archive(multiple?incoming:incoming.slice(0,1));
  };
  const retentionText=retention==="NONE"?"Arquivo bruto permanece somente neste navegador.":retention==="24_HOURS"?"Cópia privada automática com exclusão após 24 horas.":"Cópia privada somente quando você autorizar abaixo.";
  return <div>
    <button type="button" className={`dropzone ${dragging ? "dragging" : ""}`} onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); select(event.dataTransfer.files); }}>
      <UploadCloud size={27} /><strong>{label}</strong><span>{hint}</span><small>Formatos aceitos: {accept.replaceAll(".", "").toUpperCase()}</small>
    </button>
    <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={event => { select(event.target.files); event.target.value = ""; }} />
    <div className="privacy-upload-note"><LockKeyhole/><span><strong>{retention==="NONE"?"Sem retenção de arquivo bruto":retention==="24_HOURS"?"Retenção temporária de 24 horas":"Retenção privada opcional"}</strong><small>{retentionText}</small></span>{retention==="SECURE_OPTIONAL"&&<label><input type="checkbox" checked={storeSecure} onChange={event=>setStoreSecure(event.target.checked)}/> Guardar cópia privada</label>}</div>
    {files.length > 0 && <div className="file-list">{files.map((file, index) => <div className="file-row" key={`${file.name}-${index}`}><span className="file-type-icon">{file.type.includes("pdf") ? <FileText size={18} /> : <FileSpreadsheet size={18} />}</span><span><strong>{file.name}</strong><small>{formatFileSize(file.size)} · {archiving?"Aplicando política de retenção...":"Pronto para processar"}</small></span><span className="status-badge success">Pronto</span><button type="button" className="icon-plain" aria-label={`Remover ${file.name}`} onClick={() => onFiles(files.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button></div>)}</div>}
  </div>;
}
