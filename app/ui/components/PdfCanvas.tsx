"use client";

import { useEffect, useRef, useState } from "react";
import { loadPdfJs } from "../../../src/services/pdf";

export function PdfCanvas({ file, pageNumber = 1, scale = 1, className = "" }: { file: File; pageNumber?: number; scale?: number; className?: string }) {
  const canvasRef=useRef<HTMLCanvasElement>(null);const[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;let task:{cancel:()=>void}|null=null;(async()=>{try{const pdfjs=await loadPdfJs();const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;const page=await pdf.getPage(Math.min(pageNumber,pdf.numPages));const viewport=page.getViewport({scale});const canvas=canvasRef.current;if(!canvas||cancelled)return;canvas.width=viewport.width;canvas.height=viewport.height;const context=canvas.getContext("2d")!;const render=page.render({canvasContext:context,viewport,canvas});task=render;await render.promise;}catch(err){if(!cancelled)setError(err instanceof Error?err.message:"Falha ao renderizar PDF.");}})();return()=>{cancelled=true;task?.cancel();};},[file,pageNumber,scale]);
  return error?<div className="pdf-render-error">{error}</div>:<canvas ref={canvasRef} className={className}/>;
}

export function PdfPageCount({ file, onCount }: { file: File; onCount: (count:number)=>void }) {
  useEffect(()=>{(async()=>{const pdfjs=await loadPdfJs();const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;onCount(pdf.numPages);})();},[file,onCount]);return null;
}
