"use client";

import {useEffect,useRef,useState} from "react";
import {loadPdfJs,pdfDocumentOptions} from "../../../src/services/pdf";
import type {PDFDocumentLoadingTask,RenderTask} from "pdfjs-dist";

export function PdfCanvas({file,pageNumber=1,scale=1,className=""}:{file:File;pageNumber?:number;scale?:number;className?:string}) {
  const canvasRef=useRef<HTMLCanvasElement>(null),[error,setError]=useState("");
  useEffect(()=>{
    let cancelled=false,loading:PDFDocumentLoadingTask|undefined,render:RenderTask|undefined;
    void(async()=>{
      try {
        setError("");const pdfjs=await loadPdfJs();if(cancelled)return;
        loading=pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer()));const pdf=await loading.promise;
        if(cancelled)return;
        const page=await pdf.getPage(Math.max(1,Math.min(pageNumber,pdf.numPages))),requested=page.getViewport({scale});
        const pixels=requested.width*requested.height,viewport=page.getViewport({scale:pixels>16_000_000?scale*Math.sqrt(16_000_000/pixels):scale});
        const canvas=canvasRef.current;if(!canvas||cancelled)return;
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        const context=canvas.getContext("2d");if(!context)throw new Error("Não foi possível desenhar a página.");
        render=page.render({canvasContext:context,viewport,canvas,background:"#ffffff"});await render.promise;
      }catch(caught){if(!cancelled)setError(caught instanceof Error?caught.message:"Falha ao renderizar PDF.");}
      finally{if(loading)await loading.destroy();}
    })();
    return()=>{cancelled=true;render?.cancel();};
  },[file,pageNumber,scale]);
  return <>{error&&<div className="pdf-render-error" role="alert">{error}</div>}<canvas ref={canvasRef} hidden={Boolean(error)} className={className}/></>;
}

export function PdfPageCount({file,onCount}:{file:File;onCount:(count:number)=>void}) {
  const [error,setError]=useState("");
  useEffect(()=>{
    let cancelled=false,loading:PDFDocumentLoadingTask|undefined;
    void(async()=>{try{setError("");const pdfjs=await loadPdfJs();if(cancelled)return;loading=pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer()));const pdf=await loading.promise;if(!cancelled)onCount(pdf.numPages);}catch(caught){if(!cancelled)setError(caught instanceof Error?caught.message:"Não foi possível ler as páginas.");}finally{if(loading)await loading.destroy();}})();
    return()=>{cancelled=true;};
  },[file,onCount]);
  return error?<div className="pdf-render-error" role="alert">{error}</div>:null;
}
