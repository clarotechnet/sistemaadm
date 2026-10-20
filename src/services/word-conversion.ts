import type {ISectionOptions,Paragraph} from "docx";
import {canvasPng,loadPdfJs,pdfDocumentOptions,renderPdfPageCanvas} from "./pdf";
import {validateLocalFile} from "./pdf-core";

export type WordPdfConversion={blob:Blob;fileName:string;pageCount:number;warnings:string[]};
export type PdfWordMode="editable"|"visual";
type Progress=(percent:number,message:string)=>void;
const docxMime="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const baseName=(name:string)=>name.replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g,"_")||"documento";
const cleanWordText=(value:string)=>Array.from(value).filter(char=>{const point=char.codePointAt(0)!;return point===9||point===10||point===13||point>=32&&point<=0xd7ff||point>=0xe000&&point<=0xfffd||point>=0x10000&&point<=0x10ffff;}).join("");

// Read ZIP central-directory limits before inflating an untrusted DOCX.
export function validateDocxArchive(buffer:ArrayBuffer) {
  const view=new DataView(buffer);
  if(view.byteLength<22||view.getUint32(0,true)!==0x04034b50)throw new Error("O arquivo não é um DOCX válido. Arquivos .doc antigos ou protegidos por senha não são suportados.");
  let end=-1;
  for(let offset=view.byteLength-22;offset>=Math.max(0,view.byteLength-65557);offset--)if(view.getUint32(offset,true)===0x06054b50&&offset+22+view.getUint16(offset+20,true)===view.byteLength){end=offset;break;}
  if(end<0)throw new Error("DOCX incompleto ou corrompido.");
  const entries=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||entries>5000||start===0xffffffff||start+size>end)throw new Error("A estrutura deste DOCX não é suportada ou excede o limite de processamento local.");
  let offset=start,total=0;
  for(let entry=0;entry<entries;entry++){
    if(offset+46>start+size||view.getUint32(offset,true)!==0x02014b50)throw new Error("Estrutura ZIP inválida no DOCX.");
    if(view.getUint16(offset+8,true)&1)throw new Error("DOCX protegido por senha não é suportado.");
    total+=view.getUint32(offset+24,true);
    if(total>100*1024*1024)throw new Error("O conteúdo descompactado do DOCX excede 100 MB.");
    offset+=46+view.getUint16(offset+28,true)+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
  }
  if(offset!==start+size)throw new Error("Diretório ZIP inconsistente no DOCX.");
}

export async function pdfToWord(file:File,mode:PdfWordMode="editable",progress?:Progress):Promise<WordPdfConversion> {
  validateLocalFile(file,[".pdf"],75);
  const [word,pdfjs]=await Promise.all([import("docx"),loadPdfJs()]);
  const task=pdfjs.getDocument(pdfDocumentOptions(await file.arrayBuffer()));
  try {
    const pdf=await task.promise,sections:ISectionOptions[]=[],warnings:string[]=[];
    let textPages=0;
    for(let number=1;number<=pdf.numPages;number++){
      progress?.(Math.round((number-1)/pdf.numPages*85),`Convertendo página ${number} de ${pdf.numPages}...`);
      const page=await pdf.getPage(number),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
      const items=content.items.flatMap(item=>{
        if(!("str" in item)||!item.str.trim())return [];
        const transform=pdfjs.Util.transform(viewport.transform,item.transform),fontSize=Math.max(6,Math.min(72,Math.hypot(transform[2],transform[3])||item.height||11));
        return [{text:cleanWordText(item.str),x:transform[4],y:transform[5],fontSize,font:item.fontName}];
      });
      if(items.length)textPages++;
      const children:Paragraph[]=[];
      if(mode==="visual"||!items.length){
        const canvas=await renderPdfPageCanvas(page,1.5),image=await canvasPng(canvas),scale=(viewport.height-12)/viewport.height;
        children.push(new word.Paragraph({alignment:word.AlignmentType.CENTER,spacing:{before:0,after:0,line:1},children:[new word.ImageRun({data:new Uint8Array(await image.arrayBuffer()),type:"png",transformation:{width:viewport.width*96/72*scale,height:viewport.height*96/72*scale}})]}));
        canvas.width=canvas.height=1;
        if(mode==="editable")warnings.push(`Página ${number}: sem texto extraível; mantida como imagem. Para editar seu conteúdo, é necessário OCR.`);
      }else{
        const lines:{y:number;items:typeof items}[]=[];
        for(const item of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)){
          const previous=lines.at(-1);
          if(previous&&Math.abs(previous.y-item.y)<Math.max(2,item.fontSize*.2))previous.items.push(item);
          else lines.push({y:item.y,items:[item]});
        }
        for(const line of lines){
          line.items.sort((a,b)=>a.x-b.x);
          children.push(new word.Paragraph({spacing:{after:0,line:Math.round(Math.max(...line.items.map(item=>item.fontSize))*22)},children:line.items.map((item,index)=>new word.TextRun({text:(index?" ":"")+item.text,font:/times|serif/i.test(item.font)?"Times New Roman":"Arial",size:Math.round(item.fontSize*2),bold:/bold|black|demi/i.test(item.font),italics:/italic|oblique/i.test(item.font)}))}));
        }
      }
      sections.push({properties:{type:word.SectionType.NEXT_PAGE,page:{size:{width:Math.round(viewport.width*20),height:Math.round(viewport.height*20)},margin:{top:mode==="visual"||!items.length?0:540,bottom:mode==="visual"||!items.length?0:540,left:mode==="visual"||!items.length?0:540,right:mode==="visual"||!items.length?0:540}}},children});
      page.cleanup();
    }
    if(mode==="editable"&&!textPages)throw new Error("Este PDF não possui texto extraível. Selecione ‘Preservar aparência (imagens)’ para converter suas páginas; para texto editável, é necessário OCR.");
    if(mode==="editable")warnings.unshift("O texto é editável. Colunas, tabelas, imagens e posicionamento do PDF não são reconstruídos com fidelidade; revise o Word.");
    else warnings.push("As páginas estão dentro de um arquivo Word como imagens. O texto dessas imagens não é editável.");
    const document=new word.Document({creator:"RH Controle",title:baseName(file.name),sections});
    progress?.(95,"Gerando arquivo Word...");
    const blob=await word.Packer.toBlob(document);
    progress?.(100,"Word pronto.");
    return{blob:new Blob([blob],{type:docxMime}),fileName:`${baseName(file.name)}.docx`,pageCount:pdf.numPages,warnings};
  }finally{await task.destroy();}
}

export async function wordToPdf(file:File,progress?:Progress):Promise<WordPdfConversion> {
  validateLocalFile(file,[".docx"],25);
  const buffer=await file.arrayBuffer();validateDocxArchive(buffer);
  progress?.(10,"Lendo o documento Word...");
  const [mammothModule,purifyModule,htmlModule,pdfModule,fontModule,zipModule]=await Promise.all([import("mammoth"),import("dompurify"),import("html-to-pdfmake"),import("pdfmake/build/pdfmake"),import("pdfmake/build/vfs_fonts"),import("jszip")]);
  const mammoth=mammothModule.default,zip=await zipModule.default.loadAsync(buffer);
  const documentXml=await zip.file("word/document.xml")?.async("string");
  if(!documentXml||!zip.file("[Content_Types].xml"))throw new Error("O pacote não contém um documento Word válido.");
  const warnings=["Conversão de conteúdo: texto, tabelas e imagens. Fontes, cabeçalhos, rodapés, caixas de texto, colunas e paginação complexa podem mudar; confira o PDF antes de enviar."];
  const converted=await mammoth.convertToHtml({arrayBuffer:buffer},{externalFileAccess:false,includeEmbeddedStyleMap:false,styleMap:["p[style-name='Title'] => h1:fresh","p[style-name='Título'] => h1:fresh"],convertImage:mammoth.images.imgElement(async image=>{
    if(!["image/png","image/jpeg","image/gif","image/bmp"].includes(image.contentType)){warnings.push(`Imagem ${image.contentType} não suportada na conversão.`);return{src:""};}
    return{src:`data:${image.contentType};base64,${await image.readAsBase64String()}`};
  })});
  warnings.push(...converted.messages.map(message=>message.message));
  const xml=new DOMParser().parseFromString(documentXml,"application/xml"),wordNamespace="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const pageSize=xml.getElementsByTagNameNS(wordNamespace,"pgSz")[0];
  const width=Number(pageSize?.getAttributeNS(wordNamespace,"w"))/20,height=Number(pageSize?.getAttributeNS(wordNamespace,"h"))/20;
  const paper=width>=200&&width<=2500&&height>=200&&height<=2500?{width,height}:{width:595.28,height:841.89};
  const clean=purifyModule.default.sanitize(converted.value,{ALLOWED_TAGS:["p","br","strong","b","em","i","u","s","strike","sup","sub","h1","h2","h3","h4","h5","h6","ul","ol","li","table","thead","tbody","tfoot","tr","th","td","img","span"],ALLOWED_ATTR:["src","colspan","rowspan","width","height"],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
  const html=new DOMParser().parseFromString(clean,"text/html");
  const imageSizes=Array.from(xml.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing","extent")).map(size=>({width:Number(size.getAttribute("cx"))/12700,height:Number(size.getAttribute("cy"))/12700}));
  if(html.querySelectorAll("td,th").length>20000)throw new Error("A tabela excede o limite de processamento local.");
  for(const cell of html.querySelectorAll("td,th"))for(const attribute of ["colspan","rowspan"]){const value=Number(cell.getAttribute(attribute)??1);if(!Number.isInteger(value)||value<1||value>100)throw new Error("A tabela possui uma mesclagem de células não suportada.");}
  const images=Array.from(html.querySelectorAll("img"));
  for(const [index,image] of images.entries()){
    const source=image.getAttribute("src")??"";
    if(!/^data:image\/(?:png|jpeg|gif|bmp);base64,[a-z0-9+/=\s]+$/i.test(source)){image.remove();warnings.push("Uma imagem externa ou inválida foi ignorada; nenhum recurso externo foi acessado.");}
    else{
      const size=imageSizes.length===images.length?imageSizes[index]:undefined;
      if(size&&Number.isFinite(size.width)&&Number.isFinite(size.height)&&size.width>0&&size.height>0){const scale=Math.min(1,(paper.width-80)/size.width,(paper.height-100)/size.height);image.setAttribute("data-pdfmake",JSON.stringify({width:size.width*scale,height:size.height*scale}));}
      else image.setAttribute("data-pdfmake",JSON.stringify({fit:[paper.width-80,paper.height-100]}));
    }
  }
  if(!html.body.textContent?.trim()&&!html.querySelector("img"))throw new Error("Não foi encontrado conteúdo convertível no Word.");
  progress?.(50,"Montando texto, tabelas e imagens...");
  const content=htmlModule.default(html.body.innerHTML,{window,tableAutoSize:true,removeExtraBlanks:true,defaultStyles:{p:{margin:[0,0,0,8]},h1:{fontSize:20,bold:true,margin:[0,12,0,8]},h2:{fontSize:16,bold:true,margin:[0,10,0,6]},table:{margin:[0,6,0,10]},td:{margin:[4,3,4,3]},th:{bold:true,fillColor:"#eeeeee",margin:[4,3,4,3]}}});
  const pdfmake=pdfModule.default;pdfmake.addVirtualFileSystem(fontModule.default);
  const blob=await pdfmake.createPdf({content,pageSize:paper,pageMargins:[40,40,40,40],defaultStyle:{font:"Roboto",fontSize:11,lineHeight:1.15},info:{title:baseName(file.name),author:"RH Controle"}}).getBlob();
  const {PDFDocument}=await import("pdf-lib"),pdf=await PDFDocument.load(await blob.arrayBuffer());
  progress?.(100,"PDF pronto.");
  return{blob,fileName:`${baseName(file.name)}.pdf`,pageCount:pdf.getPageCount(),warnings:[...new Set(warnings)]};
}
