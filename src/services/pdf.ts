import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import JSZip from "jszip";
import { downloadFile } from "../utils/download";

export async function mergePdfs(files: File[], fileName = "PDF_UNIFICADO.pdf") {
  const output = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }
  downloadFile(await output.save(), fileName, "application/pdf");
}

export function parsePageRanges(value: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const part of value.split(/[;,\s]+/).filter(Boolean)) {
    const [startText, endText] = part.split("-");
    const start = Number(startText); const end = endText ? Number(endText) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pageCount) throw new Error(`Intervalo inválido: ${part}. O PDF possui ${pageCount} página(s).`);
    for (let page = start; page <= end; page += 1) pages.add(page - 1);
  }
  return [...pages].sort((a,b)=>a-b);
}

export async function splitPdf(file: File, range: string | null, individual: boolean) {
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const indexes = range ? parsePageRanges(range, source.getPageCount()) : source.getPageIndices();
  const base = file.name.replace(/\.pdf$/i, "");
  if (individual) {
    const zip = new JSZip();
    for (const index of indexes) {
      const output = await PDFDocument.create(); const [page] = await output.copyPages(source, [index]); output.addPage(page);
      zip.file(`${base}_pagina_${index + 1}.pdf`, await output.save());
    }
    downloadFile(await zip.generateAsync({ type:"blob" }), `${base}_paginas.zip`);
  } else {
    const output = await PDFDocument.create(); const pages = await output.copyPages(source, indexes); pages.forEach(page=>output.addPage(page));
    downloadFile(await output.save(), `${base}_extrato.pdf`, "application/pdf");
  }
}

export type PageInstruction = { sourceIndex: number; rotation: number };
export async function organizePdf(file: File, instructions: PageInstruction[], fileName?: string) {
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption:true });
  const output = await PDFDocument.create();
  for (const instruction of instructions) {
    const [page] = await output.copyPages(source,[instruction.sourceIndex]);
    page.setRotation(degrees(instruction.rotation)); output.addPage(page);
  }
  downloadFile(await output.save(), fileName ?? `${file.name.replace(/\.pdf$/i,"")}_organizado.pdf`, "application/pdf");
}

export async function extractSelectedPages(file: File, instructions: PageInstruction[]) {
  return organizePdf(file,instructions.filter(Boolean),`${file.name.replace(/\.pdf$/i,"")}_selecionadas.pdf`);
}

export async function imagesToPdf(files: File[]) {
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const image = file.type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const size = image.scale(1); const maxW=595.28,maxH=841.89;const scale=Math.min(maxW/size.width,maxH/size.height,1);
    const page=pdf.addPage([maxW,maxH]);page.drawImage(image,{x:(maxW-size.width*scale)/2,y:(maxH-size.height*scale)/2,width:size.width*scale,height:size.height*scale});
  }
  downloadFile(await pdf.save(),"imagens_convertidas.pdf","application/pdf");
}

export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  // Keep the worker on the same origin. Resolving it from import.meta.url makes
  // server builds emit a file:/// URL, which browsers cannot fetch in Sites.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
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
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
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

export async function pdfToImages(file: File) {
  const pdfjs=await loadPdfJs();const pdfDocument=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;const zip=new JSZip();
  for(let number=1;number<=pdfDocument.numPages;number+=1){const page=await pdfDocument.getPage(number);const viewport=page.getViewport({scale:1.7});const canvas=window.document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;const context=canvas.getContext("2d")!;await page.render({canvasContext:context,viewport,canvas}).promise;const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("Falha ao renderizar a página.")),"image/png"));zip.file(`${file.name.replace(/\.pdf$/i,"")}_pagina_${number}.png`,blob);}
  downloadFile(await zip.generateAsync({type:"blob"}),`${file.name.replace(/\.pdf$/i,"")}_imagens.zip`);
}

export async function extractPdfText(file: File): Promise<{ pageCount:number; pages:string[] }> {
  const pdfjs=await loadPdfJs();const document=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;const pages:string[]=[];
  for(let number=1;number<=document.numPages;number+=1){const page=await document.getPage(number);const content=await page.getTextContent();pages.push(content.items.map(item=>("str" in item?item.str:"")).join(" ").replace(/\s+/g," ").trim());}
  return {pageCount:document.numPages,pages};
}

export type PdfTextItem = { id:string;text:string;x:number;y:number;width:number;height:number;fontSize:number };
const clampUnit=(value:number)=>Math.min(1,Math.max(0,value));
export async function extractPdfTextItems(file: File, pageNumber: number):Promise<PdfTextItem[]> {
  const pdfjs=await loadPdfJs();
  const document=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
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
    return [{id:`${pageNumber}-${index}`,text:item.str,x,y,width:Math.min(width,1-x),height:Math.min(height,1-y),fontSize:Math.max(6,Math.round(fontHeight))}];
  });
}

export type PdfOverlay = { id:string; groupId?:string; page:number; type:"text"|"erase"|"rect"; x:number;y:number;width:number;height:number;text?:string;fontSize?:number;color?:string;bold?:boolean;coverBackground?:boolean };
function hexToRgb(hex="#1f1f1f"){const clean=hex.replace("#","");return [Number.parseInt(clean.slice(0,2),16)/255,Number.parseInt(clean.slice(2,4),16)/255,Number.parseInt(clean.slice(4,6),16)/255] as const;}
export async function applyPdfEdits(file: File, overlays: PdfOverlay[]) {
  const pdf=await PDFDocument.load(await file.arrayBuffer(),{ignoreEncryption:true});const regular=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  for(const overlay of overlays){const page=pdf.getPage(overlay.page);const{width,height}=page.getSize();const x=overlay.x*width;const y=height-(overlay.y+overlay.height)*height;const w=overlay.width*width;const h=overlay.height*height;if(overlay.type==="erase")page.drawRectangle({x,y,width:w,height:h,color:rgb(1,1,1)});else if(overlay.type==="rect")page.drawRectangle({x,y,width:w,height:h,borderColor:rgb(...hexToRgb(overlay.color)),borderWidth:1.2,opacity:0,borderOpacity:1});else{if(overlay.coverBackground!==false)page.drawRectangle({x,y,width:w,height:h,color:rgb(1,1,1)});page.drawText(overlay.text??"",{x:x+2,y:y+Math.max(2,h-(overlay.fontSize??12)-2),size:overlay.fontSize??12,font:overlay.bold?bold:regular,color:rgb(...hexToRgb(overlay.color))});}}
  return pdf.save();
}

export async function downloadEditedPdfs(documents:{file:File;overlays:PdfOverlay[]}[],all:boolean){if(!all){const doc=documents[0];downloadFile(await applyPdfEdits(doc.file,doc.overlays),`${doc.file.name.replace(/\.pdf$/i,"")}_editado.pdf`,`application/pdf`);return;}const zip=new JSZip();for(const doc of documents)zip.file(`${doc.file.name.replace(/\.pdf$/i,"")}_editado.pdf`,await applyPdfEdits(doc.file,doc.overlays));downloadFile(await zip.generateAsync({type:"blob"}),"PDFs_editados.zip");}

export async function addOvertimeBox(file: File, lines: string[]) {
  const pdf=await PDFDocument.load(await file.arrayBuffer(),{ignoreEncryption:true});const font=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);const page=pdf.getPage(0);const{width}=page.getSize();const lineHeight=13;const boxWidth=178;const boxHeight=24+lines.length*lineHeight;const x=width-boxWidth-18;const y=18;page.drawRectangle({x,y,width:boxWidth,height:boxHeight,color:rgb(1,1,1),borderColor:rgb(.55,.55,.55),borderWidth:.7});page.drawText("HORAS EXTRAS",{x:x+9,y:y+boxHeight-16,size:8,font:bold,color:rgb(.12,.12,.12)});lines.forEach((line,index)=>page.drawText(line,{x:x+9,y:y+boxHeight-30-index*lineHeight,size:9,font,color:rgb(.12,.12,.12)}));return pdf.save();
}
