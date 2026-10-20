import assert from "node:assert/strict";
import test from "node:test";
import {PDFDocument,StandardFonts,degrees} from "pdf-lib";
import {mergePdfBytes,organizePdfBytes,parsePageRanges,pdfPageDisplayGeometry,splitPdfParts,uniqueArchiveName} from "../src/services/pdf-core";
import {applyPdfEdits,addOvertimeBox} from "../src/services/pdf";
import {validateDocxArchive} from "../src/services/word-conversion";
import JSZip from "jszip";
import {formatOvertimeHours,identifyOvertimeName,parseOvertimeWorkbook} from "../src/modules/overtime/processor";

async function fixture(rotated=false){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);for(let index=0;index<3;index++){const page=pdf.addPage([400,600]);page.drawText(`PAGINA ${index+1}`,{x:30,y:550,font,size:14});if(rotated&&index===0)page.setRotation(degrees(90));}return new File([await pdf.save() as BlobPart],"teste.pdf",{type:"application/pdf"});}

test("PDF page ranges reject malformed values and select the intended pages",()=>{
  assert.deepEqual(parsePageRanges("1-3, 5; 3",5),[0,1,2,4]);assert.deepEqual(parsePageRanges("",3),[0,1,2]);
  for(const value of ["1-2-3","1-","-2","0","2-1","1.5","6","2-a",",,;"])assert.throws(()=>parsePageRanges(value,5));
});
test("merge/split preserve pages and do not change the original PDF",async()=>{
  const file=await fixture(),original=new Uint8Array(await file.arrayBuffer());
  assert.equal((await PDFDocument.load(await mergePdfBytes([file,file]))).getPageCount(),6);
  const group=await splitPdfParts(file,"2-3",false);assert.equal(group.length,1);assert.equal((await PDFDocument.load(group[0].bytes)).getPageCount(),2);
  const individual=await splitPdfParts(file,"1,3",true);assert.equal(individual.length,2);for(const part of individual)assert.equal((await PDFDocument.load(part.bytes)).getPageCount(),1);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()),original);
  await assert.rejects(mergePdfBytes([file]),/pelo menos dois/);
});
test("organizer duplicates/reorders/deletes and adds to existing rotation instead of resetting it",async()=>{
  const file=await fixture(true),bytes=await organizePdfBytes(file,[{sourceIndex:2,rotation:0},{sourceIndex:0,rotation:90},{sourceIndex:0,rotation:0}]),pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),3);assert.deepEqual(pdf.getPages().map(page=>page.getRotation().angle),[0,180,90]);
  await assert.rejects(organizePdfBytes(file,[]),/pelo menos/);await assert.rejects(organizePdfBytes(file,[{sourceIndex:10,rotation:0}]),/inválida/);await assert.rejects(organizePdfBytes(file,[{sourceIndex:0,rotation:15}]),/90/);
});
test("overlay coordinates respect crop boxes and rotated pages; invalid edits fail clearly",async()=>{
  const file=await fixture(true),pdf=await PDFDocument.load(await file.arrayBuffer()),page=pdf.getPage(0);page.setCropBox(10,20,300,500);
  assert.deepEqual(pdfPageDisplayGeometry(page),{width:500,height:300,matrix:[0,1,-1,0,310,20]});
  const overlay={id:"text",page:0,type:"text" as const,x:.1,y:.1,width:.5,height:.1,text:"TESTE",fontSize:12,coverBackground:false};
  const edited=await applyPdfEdits(file,[overlay]);assert.equal((await PDFDocument.load(edited)).getPageCount(),3);
  await assert.rejects(applyPdfEdits(file,[{...overlay,x:2}]),/limites/);await assert.rejects(applyPdfEdits(file,[{...overlay,page:99}]),/inválida/);
  assert.equal((await PDFDocument.load(await addOvertimeBox(file,["H. EX 50%: 02:30"]))).getPageCount(),3);
});
test("invalid or empty files do not produce fake PDF outputs; ZIP names never overwrite duplicates",async()=>{
  await assert.rejects(mergePdfBytes([new File(["not a PDF"],"a.pdf"),await fixture()]),/não é um PDF/);
  const used=new Set<string>();assert.equal(uniqueArchiveName("a.pdf",used),"a.pdf");assert.equal(uniqueArchiveName("A.pdf",used),"A (2).pdf");assert.doesNotMatch(uniqueArchiveName("../x/y.pdf",used),/[\\/]/);
});
test("DOCX archive guard rejects old DOC, corrupt ZIP and oversized decompression metadata",async()=>{
  assert.throws(()=>validateDocxArchive(new Uint8Array([1,2,3]).buffer),/DOCX válido/);
  const zip=new JSZip();zip.file("word/document.xml","<document/>");zip.file("[Content_Types].xml","<Types/>");const bytes=await zip.generateAsync({type:"uint8array"});validateDocxArchive(bytes.buffer as ArrayBuffer);
  const broken=bytes.slice();for(let index=0;index<broken.length-4;index++)if(new DataView(broken.buffer).getUint32(index,true)===0x02014b50){new DataView(broken.buffer).setUint32(index+24,200*1024*1024,true);break;}
  assert.throws(()=>validateDocxArchive(broken.buffer),/100 MB/);
});
test("PDF page-copy tools reject interactive forms instead of silently discarding their fields",async()=>{
  const pdf=await PDFDocument.create(),page=pdf.addPage();pdf.getForm().createTextField("nome").addToPage(page);
  const file=new File([await pdf.save() as BlobPart],"formulario.pdf");
  await assert.rejects(mergePdfBytes([file,await fixture()]),/campos interativos/);
  await assert.rejects(splitPdfParts(file,null,false),/campos interativos/);
  await assert.rejects(organizePdfBytes(file,[{sourceIndex:0,rotation:0}]),/campos interativos/);
});
test("overtime durations retain hours above 24 and reject ambiguous employee names",()=>{
  assert.equal(formatOvertimeHours(1.5),"36:00");assert.equal(formatOvertimeHours("27:45"),"27:45");assert.equal(formatOvertimeHours(new Date(Date.UTC(1899,11,31,12))),"36:00");
  for(const value of [-1,"10:99","texto"])assert.throws(()=>formatOvertimeHours(value));
  assert.throws(()=>parseOvertimeWorkbook({fileName:"test.xlsx",fileSize:1,warnings:[],sheets:[{name:"Horas",headerRow:0,headers:["COLABORADOR","H EX 50%"],normalizedHeaders:[],rows:[["Ana Teste","02:30"],["ANA TESTE","01:00"]]}]}),/Nome repetido/);
  const records=[{name:"ANA LIMA",hours:{}}];
  assert.deepEqual(identifyOvertimeName("RELATORIO GENERICO","ANA LIMA.pdf",records),{name:"ANA LIMA",fromText:false});
  assert.deepEqual(identifyOvertimeName("ANA LIMA","arquivo.pdf",records),{name:"ANA LIMA",fromText:true});
  assert.equal(identifyOvertimeName("MARIANA LIMA","arquivo.pdf",records).fromText,false);
});
