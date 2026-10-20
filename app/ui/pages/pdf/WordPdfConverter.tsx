"use client";

import {useState} from "react";
import {Download,FileText,RefreshCw} from "lucide-react";
import {pdfToWord,wordToPdf,type PdfWordMode,type WordPdfConversion} from "../../../../src/services/word-conversion";
import {downloadFile,formatFileSize} from "../../../../src/utils/download";
import {FileDropzone} from "../../components/FileDropzone";
import {useApp} from "../../state/AppContext";

export function WordPdfConverter({direction}:{direction:"pdf-word"|"word-pdf"}) {
  const app=useApp(),toWord=direction==="pdf-word";
  const [files,setFiles]=useState<File[]>([]),[mode,setMode]=useState<PdfWordMode>("editable");
  const [busy,setBusy]=useState(false),[result,setResult]=useState<WordPdfConversion|null>(null),[progress,setProgress]=useState({percent:0,message:""});
  const run=async()=>{
    if(!files[0]||busy)return;setBusy(true);setResult(null);
    try{
      const report=(percent:number,message:string)=>setProgress({percent,message});
      const converted=toWord?await pdfToWord(files[0],mode,report):await wordToPdf(files[0],report);
      setResult(converted);
      app.addAudit({operation:toWord?"Converteu PDF para Word":"Converteu Word para PDF",module:"PDF",result:`${converted.pageCount} página(s) · conversão local${toWord?` · ${mode==="editable"?"texto editável":"páginas como imagens"}`:" · conteúdo DOCX"}`,fileName:files[0].name,status:converted.warnings.length?"AVISO":"SUCESSO",processedCount:converted.pageCount});
      app.toast("success","Conversão concluída","Confira as observações e baixe o arquivo gerado.");
    }catch(error){setProgress({percent:0,message:""});app.toast("error","Não foi possível converter",error instanceof Error?error.message:undefined);}finally{setBusy(false);}
  };
  return <div className="stack-gap word-pdf-converter">
    <div className="page-heading compact"><div><h2>{toWord?"PDF para Word":"Word para PDF"}</h2><p>Conversão local no navegador. O conteúdo não é enviado a serviços de conversão externos; a retenção do original segue a política de upload abaixo.</p></div></div>
    <section className="surface import-surface"><div className="import-form">
      <FileDropzone accept={toWord?".pdf":".docx"} files={files} disabled={busy} onFiles={value=>{setFiles(value);setResult(null);setProgress({percent:0,message:""});}} label={toWord?"Selecione o PDF para converter em Word":"Selecione o documento Word (.docx)"}/>
      {toWord?<><label className="field"><span>Tipo de Word</span><select aria-label="Tipo de conversão PDF para Word" disabled={busy} value={mode} onChange={event=>{setMode(event.target.value as PdfWordMode);setResult(null);setProgress({percent:0,message:""});}}><option value="editable">Texto editável (layout simplificado)</option><option value="visual">Preservar aparência (páginas como imagens)</option></select></label><p className="conversion-notice">{mode==="editable"?"Extrai texto para edição no Word. Não reconstrói tabelas, imagens nem colunas com fidelidade. PDFs inteiramente digitalizados precisam de OCR ou da opção de páginas como imagens.":"Gera um DOCX com as páginas do PDF como imagens. Preserva a aparência, mas não torna o texto editável."}</p></>:<p className="conversion-notice">Aceita DOCX, não arquivos .doc antigos. Converte texto, tabelas e imagens com formatação básica. Fontes, cabeçalhos, rodapés, colunas e paginação avançada podem mudar; revise a saída antes de enviar.</p>}
      <button className="button primary align-start" disabled={busy||!files.length} onClick={()=>void run()}><RefreshCw/>{busy?"Convertendo...":toWord?"Converter para Word":"Converter para PDF"}</button>
      {progress.message&&<div className="compressor-progress" aria-live="polite"><div><i style={{width:`${progress.percent}%`}}/></div><span>{progress.message}</span></div>}
    </div></section>
    {result&&<section className="surface conversion-result"><div className="section-header"><div><h3><FileText size={18}/> Arquivo convertido</h3><p>{result.fileName} · {formatFileSize(result.blob.size)} · {result.pageCount} página(s) de {toWord?"origem":"saída"}</p></div><button className="button primary" onClick={()=>downloadFile(result.blob,result.fileName)}><Download/>{toWord?"Baixar Word (.docx)":"Baixar PDF"}</button></div>{result.warnings.length>0&&<div className="conversion-warnings"><strong>Observações da conversão</strong><ul>{result.warnings.slice(0,20).map((warning,index)=><li key={index}>{warning}</li>)}</ul>{result.warnings.length>20&&<p>Mais {result.warnings.length-20} observação(ões). Revise todo o documento.</p>}</div>}</section>}
  </div>;
}
