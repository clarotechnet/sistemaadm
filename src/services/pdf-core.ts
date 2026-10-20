import { PDFDocument, degrees, type PDFPage } from "pdf-lib";

export type PdfInput = Pick<File,"name"|"size"|"arrayBuffer">;
export type PageInstruction = {sourceIndex:number;rotation:number};
export function validateLocalFile(file:PdfInput,extensions:readonly string[],maxMb=150) {
  if(!file?.size)throw new Error("Selecione um arquivo válido e não vazio.");
  if(!extensions.some(extension=>file.name.toLowerCase().endsWith(extension)))throw new Error(`Formato não suportado. Use ${extensions.join(", ")}.`);
  if(file.size>maxMb*1024*1024)throw new Error(`O arquivo excede o limite de ${maxMb} MB para processamento local.`);
}
export async function loadEditablePdf(file:PdfInput) {
  validateLocalFile(file,[".pdf"]);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!new TextDecoder("latin1").decode(bytes.subarray(0,1024)).includes("%PDF-"))throw new Error("O conteúdo do arquivo não é um PDF válido.");
  try {return await PDFDocument.load(bytes,{updateMetadata:false});}
  catch(error){if(error instanceof Error&&/encrypt/i.test(error.message))throw new Error("PDF protegido por senha não é suportado nesta ferramenta. Use uma cópia desbloqueada.");throw new Error("Não foi possível ler o PDF. Verifique se o arquivo está íntegro.");}
}
export function parsePageRanges(value:string,pageCount:number):number[] {
  if(!Number.isInteger(pageCount)||pageCount<1)throw new Error("O PDF não possui páginas válidas.");
  if(!value.trim())return Array.from({length:pageCount},(_,index)=>index);
  const selected=new Set<number>();
  for(const part of value.trim().split(/[;,\s]+/).filter(Boolean)) {
    if(!/^\d+(?:-\d+)?$/.test(part))throw new Error(`Intervalo inválido: ${part}. Use 1-3, 5, 7-10.`);
    const [startText,endText]=part.split("-"),start=Number(startText),end=Number(endText??startText);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>pageCount)throw new Error(`Intervalo inválido: ${part}. O PDF possui ${pageCount} página(s).`);
    for(let page=start;page<=end;page++)selected.add(page-1);
  }
  if(!selected.size)throw new Error("Informe pelo menos uma página válida no intervalo.");
  return [...selected].sort((a,b)=>a-b);
}
export async function mergePdfBytes(files:PdfInput[]) {
  if(files.length<2)throw new Error("Selecione pelo menos dois PDFs para juntar.");
  const output=await PDFDocument.create();
  for(const file of files){const source=await loadEditablePdf(file);requireCopyablePages(source);const pages=await output.copyPages(source,source.getPageIndices());pages.forEach(page=>output.addPage(page));}
  return output.save();
}
export async function splitPdfParts(file:PdfInput,range:string|null,individual:boolean) {
  const source=await loadEditablePdf(file),indexes=parsePageRanges(range??"",source.getPageCount());
  requireCopyablePages(source);
  const groups=individual?indexes.map(index=>[index]):[indexes];
  return Promise.all(groups.map(async group=>{const output=await PDFDocument.create();const pages=await output.copyPages(source,group);pages.forEach(page=>output.addPage(page));return{indexes:group,bytes:await output.save()};}));
}
export async function organizePdfBytes(file:PdfInput,instructions:PageInstruction[]) {
  const source=await loadEditablePdf(file);
  requireCopyablePages(source);
  if(!instructions.length)throw new Error("Mantenha pelo menos uma página no PDF.");
  const output=await PDFDocument.create();
  for(const instruction of instructions){
    if(!Number.isInteger(instruction.sourceIndex)||instruction.sourceIndex<0||instruction.sourceIndex>=source.getPageCount())throw new Error("Página original inválida.");
    if(!Number.isInteger(instruction.rotation)||instruction.rotation%90!==0)throw new Error("A rotação deve ser um múltiplo de 90 graus.");
    const [page]=await output.copyPages(source,[instruction.sourceIndex]);
    page.setRotation(degrees(((page.getRotation().angle+instruction.rotation)%360+360)%360));output.addPage(page);
  }
  return output.save();
}
export function requireCopyablePages(pdf:PDFDocument) {
  if(pdf.getForm().getFields().length)throw new Error("O PDF contém campos interativos ou de assinatura. Para juntar, separar ou reorganizar, use uma cópia estática sem campos e preserve o original.");
}
export function uniqueArchiveName(value:string,used:Set<string>):string {
  const safe=Array.from(value,char=>char.codePointAt(0)!<32?"_":char).join("").replace(/[\\/:*?"<>|]+/g,"_").replace(/^\.+/,"").trim()||"arquivo.pdf";
  const dot=safe.lastIndexOf("."),base=dot>0?safe.slice(0,dot):safe,extension=dot>0?safe.slice(dot):"";
  let name=safe,suffix=2;while(used.has(name.toLocaleLowerCase("pt-BR")))name=`${base} (${suffix++})${extension}`;
  used.add(name.toLocaleLowerCase("pt-BR"));return name;
}
export function pdfPageDisplayGeometry(page:PDFPage) {
  const box=page.getCropBox(),rotation=((page.getRotation().angle%360)+360)%360;
  const matrices:Record<number,[number,number,number,number,number,number]>={0:[1,0,0,1,box.x,box.y],90:[0,1,-1,0,box.x+box.width,box.y],180:[-1,0,0,-1,box.x+box.width,box.y+box.height],270:[0,-1,1,0,box.x,box.y+box.height]};
  if(!matrices[rotation])throw new Error("A rotação da página não é suportada.");
  return{width:rotation%180?box.height:box.width,height:rotation%180?box.width:box.height,matrix:matrices[rotation]};
}
