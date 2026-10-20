import { PDFDocument, StandardFonts, rgb, concatTransformationMatrix, pushGraphicsState, popGraphicsState } from "pdf-lib";
import JSZip from "jszip";
import { downloadFile } from "../utils/download";
import {loadEditablePdf,mergePdfBytes,organizePdfBytes,splitPdfParts,uniqueArchiveName,validateLocalFile,pdfPageDisplayGeometry,requireCopyablePages,type PageInstruction} from "./pdf-core";
export {parsePageRanges} from "./pdf-core";
export type {PageInstruction} from "./pdf-core";
import type {PDFPageProxy} from "pdfjs-dist";

export async function mergePdfs(files:File[],fileName="PDF_UNIFICADO.pdf") {
  const bytes=await mergePdfBytes(files);downloadFile(bytes,fileName,"application/pdf");return bytes;
}
export async function splitPdf(file:File,range:string|null,individual:boolean) {
  const parts=await splitPdfParts(file,range,individual),base=file.name.replace(/\.pdf$/i,"");
  if(individual){const zip=new JSZip();for(const part of parts)zip.file(`${base}_pagina_${part.indexes[0]+1}.pdf`,part.bytes);downloadFile(await zip.generateAsync({type:"blob"}),`${base}_paginas.zip`);}
  else downloadFile(parts[0].bytes,`${base}_extrato.pdf`,"application/pdf");
  return parts;
}
export async function organizePdf(file:File,instructions:PageInstruction[],fileName?:string) {
  const bytes=await organizePdfBytes(file,instructions);downloadFile(bytes,fileName??`${file.name.replace(/\.pdf$/i,"")}_organizado.pdf`,"application/pdf");return bytes;
}
export async function extractSelectedPages(file:File,instructions:PageInstruction[]) {
  return organizePdf(file,instructions.filter(Boolean),`${file.name.replace(/\.pdf$/i,"")}_selecionadas.pdf`);
}
export async function imagesToPdf(files:File[]) {
  if(!files.length)throw new Error("Selecione pelo menos uma imagem JPG ou PNG.");
  const pdf=await PDFDocument.create();
  for(const file of files){
    validateLocalFile(file,[".jpg",".jpeg",".png"],50);
    const bytes=new Uint8Array(await file.arrayBuffer());
    const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
    const jpg=bytes[0]===255&&bytes[1]===216;
    if(!png&&!jpg)throw new Error(`${file.name}: o conteúdo não é uma imagem JPG/PNG válida.`);
    const image=png?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);
    const size=image.scale(1),maxW=595.28,maxH=841.89,scale=Math.min(maxW/size.width,maxH/size.height,1);
    const page=pdf.addPage([maxW,maxH]);page.drawImage(image,{x:(maxW-size.width*scale)/2,y:(maxH-size.height*scale)/2,width:size.width*scale,height:size.height*scale});
  }
  const bytes=await pdf.save();downloadFile(bytes,"imagens_convertidas.pdf","application/pdf");return bytes;
}
export function pdfDocumentOptions(data:ArrayBuffer|Uint8Array) {
  return {data,cMapUrl:"/pdfjs/cmaps/",cMapPacked:true,standardFontDataUrl:"/pdfjs/standard_fonts/",wasmUrl:"/pdfjs/wasm/",isEvalSupported:false,useSystemFonts:true};
}
export async function renderPdfPageCanvas(page:PDFPageProxy,scale=1.5) {
  const requested=page.getViewport({scale}),pixels=requested.width*requested.height;
  const viewport=page.getViewport({scale:pixels>16_000_000?scale*Math.sqrt(16_000_000/pixels):scale});
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));
  const context=canvas.getContext("2d",{alpha:false});if(!context)throw new Error("Não foi possível renderizar a página.");
  await page.render({canvasContext:context,viewport,canvas,background:"#ffffff"}).promise;return canvas;
}
export function canvasPng(canvas:HTMLCanvasElement):Promise<Blob> {
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Falha ao gerar a imagem da página.")),"image/png"));
}

export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  // Keep the worker on the same origin. Resolving it from import.meta.url makes
  // server builds emit a file:/// URL, which browsers cannot fetch in Sites.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
  return pdfjs;
}

export const pdfCompressionPresets = {
  readable: {
    label: "Forte legível",
    dpi: 135,
    quality: 0.66,
    description: "Boa redução para documentos administrativos, mantendo letras e números legíveis.",
  },
  balanced: {
    label: "Equilibrado",
    dpi: 150,
    quality: 0.74,
    description: "Mais definição para tabelas e textos pequenos, com tamanho intermediário.",
  },
  quality: {
    label: "Alta qualidade",
    dpi: 180,
    quality: 0.84,
    description: "Preserva melhor detalhes e imagens, mas reduz menos o tamanho final.",
  },
  extreme: {
    label: "Extremo",
    dpi: 105,
    quality: 0.52,
    description: "Prioriza o menor arquivo possível e pode suavizar textos muito pequenos.",
  },
} as const;

export type PdfCompressionPresetId = keyof typeof pdfCompressionPresets;
export type PdfCompressionProgress = { page: number; pageCount: number; percent: number };
export type PdfCompressionResult = {
  source: File;
  blob: Blob;
  fileName: string;
  generatedSize: number;
  keptOriginal: boolean;
};

export function pdfCompressionSaving(originalSize: number, finalSize: number) {
  if (originalSize <= 0 || finalSize < 0) return 0;
  return Math.max(0, (1 - finalSize / originalSize) * 100);
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number, grayscale: boolean) {
  let source = canvas;
  if (grayscale) {
    const gray = window.document.createElement("canvas");
    gray.width = canvas.width;
    gray.height = canvas.height;
    const context = gray.getContext("2d", { alpha: false });
    if (!context) throw new Error("Não foi possível preparar a conversão para tons de cinza.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, gray.width, gray.height);
    context.filter = "grayscale(1)";
    context.drawImage(canvas, 0, 0);
    context.filter = "none";
    source = gray;
  }
  return new Promise<Blob>((resolve, reject) => source.toBlob(
    value => value ? resolve(value) : reject(new Error("Não foi possível compactar uma das páginas.")),
    "image/jpeg",
    quality,
  ));
}

export async function compressPdfFile(
  file: File,
  presetId: PdfCompressionPresetId,
  grayscale: boolean,
  onProgress?: (progress: PdfCompressionProgress) => void,
): Promise<PdfCompressionResult> {
  if (!file.size) throw new Error(`${file.name} está vazio.`);
  if (file.size > 150 * 1024 * 1024) throw new Error(`${file.name} excede o limite de 150 MB para processamento no navegador.`);
  const preset = pdfCompressionPresets[presetId];
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer()));
  try {
    const document = await loadingTask.promise;
    const output = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const originalViewport = page.getViewport({ scale: 1 });
      const requestedScale = preset.dpi / 72;
      const requestedViewport = page.getViewport({ scale: requestedScale });
      const maxPixels = 16_000_000;
      const pixelCount = requestedViewport.width * requestedViewport.height;
      const adjustedScale = pixelCount > maxPixels ? requestedScale * Math.sqrt(maxPixels / pixelCount) : requestedScale;
      const viewport = page.getViewport({ scale: adjustedScale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("O navegador não conseguiu renderizar o PDF.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const jpegBlob = await canvasToJpegBlob(canvas, preset.quality, grayscale);
      const image = await output.embedJpg(await jpegBlob.arrayBuffer());
      const outputPage = output.addPage([originalViewport.width, originalViewport.height]);
      outputPage.drawImage(image, { x: 0, y: 0, width: originalViewport.width, height: originalViewport.height });
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
      onProgress?.({ page: pageNumber, pageCount: document.numPages, percent: pageNumber / document.numPages * 100 });
    }
    const bytes = await output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
    const generated = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const keptOriginal = generated.size >= file.size;
    return {
      source: file,
      blob: keptOriginal ? file : generated,
      generatedSize: generated.size,
      keptOriginal,
      fileName: `${file.name.replace(/\.pdf$/i, "")}_compactado.pdf`,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function pdfToImages(file:File) {
  validateLocalFile(file,[".pdf"]);
  const pdfjs=await loadPdfJs(),task=pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer())),zip=new JSZip();
  try{
    const pdf=await task.promise;
    for(let number=1;number<=pdf.numPages;number++){
      const page=await pdf.getPage(number),canvas=await renderPdfPageCanvas(page,1.7);
      zip.file(`${file.name.replace(/\.pdf$/i,"")}_pagina_${number}.png`,await canvasPng(canvas));canvas.width=canvas.height=1;page.cleanup();
    }
    const blob=await zip.generateAsync({type:"blob"});downloadFile(blob,`${file.name.replace(/\.pdf$/i,"")}_imagens.zip`);return blob;
  }finally{await task.destroy();}
}
export async function extractPdfText(file:File):Promise<{pageCount:number;pages:string[]}> {
  validateLocalFile(file,[".pdf"]);const pdfjs=await loadPdfJs(),task=pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer()));
  try{const pdf=await task.promise,pages:string[]=[];for(let number=1;number<=pdf.numPages;number++){const page=await pdf.getPage(number),content=await page.getTextContent();pages.push(content.items.map(item=>"str" in item?item.str:"").join(" ").replace(/\s+/g," ").trim());page.cleanup();}return{pageCount:pdf.numPages,pages};}finally{await task.destroy();}
}
export type PdfComparisonDocument={pageCount:number;pages:string[];visuals:string[]};
export async function inspectPdfForComparison(file:File):Promise<PdfComparisonDocument> {
  validateLocalFile(file,[".pdf"]);const pdfjs=await loadPdfJs(),task=pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer()));
  try{
    const pdf=await task.promise,pages:string[]=[],visuals:string[]=[];
    for(let number=1;number<=pdf.numPages;number++){
      const page=await pdf.getPage(number),text=await page.getTextContent(),canvas=await renderPdfPageCanvas(page,1);
      pages.push(text.items.map(item=>"str" in item?item.str:"").join(" ").replace(/\s+/g," ").trim());
      const pixels=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;
      const hash=await crypto.subtle.digest("SHA-256",new Uint8Array(pixels));
      visuals.push(`${canvas.width}x${canvas.height}:${Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("")}`);
      canvas.width=canvas.height=1;page.cleanup();
    }
    return{pageCount:pdf.numPages,pages,visuals};
  }finally{await task.destroy();}
}

export type PdfFontFamily = "Helvetica"|"TimesRoman"|"Courier";
export type PdfTextItem = { id:string;text:string;x:number;y:number;width:number;height:number;fontSize:number;fontFamily:PdfFontFamily;bold:boolean };
function detectPdfFontFamily(fontName:string,fontFamily?:string):PdfFontFamily{const value=`${fontName} ${fontFamily??""}`.toLowerCase();if(/times/.test(value)||(/serif/.test(value)&&!/sans/.test(value)))return "TimesRoman";if(/courier|mono/.test(value))return "Courier";return "Helvetica";}
function detectPdfBold(fontName:string,fontFamily?:string){return /bold|black|semibold|demi|heavy/.test(`${fontName} ${fontFamily??""}`.toLowerCase());}
const clampUnit=(value:number)=>Math.min(1,Math.max(0,value));
export async function extractPdfTextItems(file: File, pageNumber: number):Promise<PdfTextItem[]> {
  const pdfjs=await loadPdfJs();
  const loadingTask=pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer()));
  try {
  const document=await loadingTask.promise;
  const page=await document.getPage(pageNumber+1);
  const viewport=page.getViewport({scale:1});
  const content=await page.getTextContent();
  return content.items.flatMap((item,index)=>{
    if(!("str" in item)||!item.str.trim())return [];
    const transform=pdfjs.Util.transform(viewport.transform,item.transform);
    const fontHeight=Math.hypot(transform[2],transform[3])||item.height||10;
    const style=content.styles[item.fontName];
    const ascent=style?.ascent?style.ascent*fontHeight:style?.descent?(1+style.descent)*fontHeight:fontHeight;
    const x=clampUnit(transform[4]/viewport.width);
    const y=clampUnit((transform[5]-ascent)/viewport.height);
    const width=clampUnit(Math.max(item.width*viewport.scale,1)/viewport.width);
    const height=clampUnit(Math.max(fontHeight,1)/viewport.height);
    return [{id:`${pageNumber}-${index}`,text:item.str,x,y,width:Math.min(width,1-x),height:Math.min(height,1-y),fontSize:Math.max(6,Math.round(fontHeight)),fontFamily:detectPdfFontFamily(item.fontName,style?.fontFamily),bold:detectPdfBold(item.fontName,style?.fontFamily)}];
  });
  }finally{await loadingTask.destroy();}
}

export async function samplePdfTextColor(file: File, pageNumber: number, item: PdfTextItem):Promise<string|null> {
  const pdfjs=await loadPdfJs();
  const loadingTask=pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer()));
  try{
    const document=await loadingTask.promise;
    const page=await document.getPage(pageNumber+1);
    const viewport=page.getViewport({scale:2.4});
    const canvas=window.document.createElement("canvas");
    canvas.width=Math.max(1,Math.ceil(viewport.width));
    canvas.height=Math.max(1,Math.ceil(viewport.height));
    const context=canvas.getContext("2d",{alpha:false});
    if(!context)return null;
    context.fillStyle="#fff";
    context.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:context,viewport,canvas}).promise;
    const pad=Math.max(2,Math.round(item.fontSize*.25*viewport.scale));
    const sx=Math.max(0,Math.floor(item.x*canvas.width)-pad);
    const sy=Math.max(0,Math.floor(item.y*canvas.height)-pad);
    const sw=Math.min(canvas.width-sx,Math.max(1,Math.ceil(item.width*canvas.width)+pad*2));
    const sh=Math.min(canvas.height-sy,Math.max(1,Math.ceil(item.height*canvas.height)+pad*2));
    const pixels=context.getImageData(sx,sy,sw,sh).data;
    const buckets=new Map<string,{score:number;count:number;r:number;g:number;b:number}>();
    for(let index=0;index<pixels.length;index+=4){
      const r=pixels[index],g=pixels[index+1],b=pixels[index+2],a=pixels[index+3];
      if(a<80||r>245&&g>245&&b>245)continue;
      const max=Math.max(r,g,b),min=Math.min(r,g,b),saturation=max-min;
      const brightness=(r+g+b)/3;
      if(saturation<10&&brightness>215)continue;
      const qr=Math.round(r/32),qg=Math.round(g/32),qb=Math.round(b/32);
      const key=`${qr}:${qg}:${qb}`;
      const current=buckets.get(key)??{score:0,count:0,r:0,g:0,b:0};
      const colorBonus=1+saturation/150;
      current.score+=colorBonus;
      current.count+=1;current.r+=r;current.g+=g;current.b+=b;
      buckets.set(key,current);
    }
    const winner=[...buckets.values()].sort((a,b)=>b.score-a.score)[0];
    if(!winner||winner.count<2)return null;
    const hex=(value:number)=>Math.round(value).toString(16).padStart(2,"0");
    return `#${hex(winner.r/winner.count)}${hex(winner.g/winner.count)}${hex(winner.b/winner.count)}`;
  }finally{await loadingTask.destroy();}
}

export type PdfOverlay = { id:string; groupId?:string; page:number; type:"text"|"erase"|"rect"; x:number;y:number;width:number;height:number;text?:string;fontSize?:number;fontFamily?:PdfFontFamily;color?:string;bold?:boolean;coverBackground?:boolean };
function hexToRgb(hex="#1f1f1f"){const clean=hex.replace("#","");return [Number.parseInt(clean.slice(0,2),16)/255,Number.parseInt(clean.slice(2,4),16)/255,Number.parseInt(clean.slice(4,6),16)/255] as const;}
export async function applyPdfEdits(file:File,overlays:PdfOverlay[]) {
  const pdf=await loadEditablePdf(file);
  const fonts={Helvetica:{regular:await pdf.embedFont(StandardFonts.Helvetica),bold:await pdf.embedFont(StandardFonts.HelveticaBold)},TimesRoman:{regular:await pdf.embedFont(StandardFonts.TimesRoman),bold:await pdf.embedFont(StandardFonts.TimesRomanBold)},Courier:{regular:await pdf.embedFont(StandardFonts.Courier),bold:await pdf.embedFont(StandardFonts.CourierBold)}};
  for(const overlay of overlays){
    if(!Number.isInteger(overlay.page)||overlay.page<0||overlay.page>=pdf.getPageCount())throw new Error("Página de edição inválida.");
    if(![overlay.x,overlay.y,overlay.width,overlay.height].every(Number.isFinite)||overlay.x<0||overlay.y<0||overlay.width<=0||overlay.height<=0||overlay.x+overlay.width>1.001||overlay.y+overlay.height>1.001)throw new Error("O elemento está fora dos limites da página. Ajuste sua posição e tamanho.");
    if(overlay.color&&!/^#[a-f0-9]{6}$/i.test(overlay.color))throw new Error("Cor de edição inválida.");
    const page=pdf.getPage(overlay.page),{width,height,matrix}=pdfPageDisplayGeometry(page);
    const x=overlay.x*width,y=height-(overlay.y+overlay.height)*height,w=overlay.width*width,h=overlay.height*height;
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...matrix));
    if(overlay.type==="erase")page.drawRectangle({x,y,width:w,height:h,color:rgb(1,1,1)});
    else if(overlay.type==="rect")page.drawRectangle({x,y,width:w,height:h,borderColor:rgb(...hexToRgb(overlay.color)),borderWidth:1.2,opacity:0,borderOpacity:1});
    else{
      const size=overlay.fontSize??12;if(!Number.isFinite(size)||size<1||size>300)throw new Error("Tamanho de fonte inválido.");
      const font=fonts[overlay.fontFamily??"Helvetica"]?.[overlay.bold?"bold":"regular"];if(!font)throw new Error("Fonte inválida.");
      const text=overlay.text??"";
      try{for(const line of text.split(/\r?\n/))font.encodeText(line);}catch{throw new Error("O texto contém um caractere não suportado pelas fontes do editor. Remova símbolos especiais ou emojis.");}
      if(overlay.coverBackground!==false)page.drawRectangle({x,y,width:w,height:h,color:rgb(1,1,1)});
      page.drawText(text,{x:x+2,y:y+Math.max(2,h-size-2),size,font,color:rgb(...hexToRgb(overlay.color)),maxWidth:Math.max(1,w-4),lineHeight:size*1.15});
    }
    page.pushOperators(popGraphicsState());
  }
  const bytes=await pdf.save();
  const flattened=new Set(overlays.filter(item=>item.type==="erase"||item.type==="text"&&item.coverBackground!==false).map(item=>item.page));
  if(!flattened.size)return bytes;
  requireCopyablePages(pdf);
  // Rebuild covered pages so the original text does not remain extractable below
  // a white rectangle. Other pages retain their original selectable content.
  const pdfjs=await loadPdfJs(),task=pdfjs.getDocument(pdfDocumentOptions(bytes.slice()));
  try{
    const source=await task.promise,output=await PDFDocument.create();
    for(let index=0;index<pdf.getPageCount();index++){
      if(flattened.has(index)){
        const page=await source.getPage(index+1),viewport=page.getViewport({scale:1}),canvas=await renderPdfPageCanvas(page,2.5),png=await canvasPng(canvas);
        const image=await output.embedPng(await png.arrayBuffer()),result=output.addPage([viewport.width,viewport.height]);
        result.drawImage(image,{x:0,y:0,width:viewport.width,height:viewport.height});canvas.width=canvas.height=1;page.cleanup();
      }else{const [page]=await output.copyPages(pdf,[index]);output.addPage(page);}
    }
    return output.save();
  }finally{await task.destroy();}
}
export async function downloadEditedPdfs(documents:{file:File;overlays:PdfOverlay[]}[],all:boolean){
  if(!documents.length)throw new Error("Nenhum PDF está aberto no editor.");
  if(!all){const doc=documents[0];downloadFile(await applyPdfEdits(doc.file,doc.overlays),`${doc.file.name.replace(/\.pdf$/i,"")}_editado.pdf`,"application/pdf");return;}
  const zip=new JSZip(),used=new Set<string>();for(const doc of documents)zip.file(uniqueArchiveName(`${doc.file.name.replace(/\.pdf$/i,"")}_editado.pdf`,used),await applyPdfEdits(doc.file,doc.overlays));
  downloadFile(await zip.generateAsync({type:"blob"}),"PDFs_editados.zip");
}
export async function addOvertimeBox(file:File,lines:string[]) {
  if(!lines.length)throw new Error("Nenhuma hora extra foi informada.");
  const pdf=await loadEditablePdf(file),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),page=pdf.getPage(0),{width,height,matrix}=pdfPageDisplayGeometry(page);
  const lineHeight=13,boxWidth=178,boxHeight=24+lines.length*lineHeight,x=width-boxWidth-18,y=18;
  if(x<0||boxHeight>height-36)throw new Error("A página é pequena demais para receber o quadro de horas extras.");
  page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...matrix));page.drawRectangle({x,y,width:boxWidth,height:boxHeight,color:rgb(1,1,1),borderColor:rgb(.55,.55,.55),borderWidth:.7});
  page.drawText("HORAS EXTRAS",{x:x+9,y:y+boxHeight-16,size:8,font:bold,color:rgb(.12,.12,.12)});
  lines.forEach((line,index)=>page.drawText(line,{x:x+9,y:y+boxHeight-30-index*lineHeight,size:9,font,color:rgb(.12,.12,.12)}));
  page.pushOperators(popGraphicsState());return pdf.save();
}
