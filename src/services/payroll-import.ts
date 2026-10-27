import type {ActivePayroll} from "../types";
import {parsePayrollPdf,type PayrollPdfPage} from "../modules/payroll/pdf-parser";
import {processPayroll} from "../modules/payroll/processor";
import {readExcel} from "./excel";

export interface PayrollImportAnalysis {
  payroll:ActivePayroll;
  format:"PDF"|"Excel";
  company?:string;
  companyDocument?:string;
  warnings:string[];
  checks:string[];
  totals:{gross:number|null;deductions:number|null;liquid:number|null;health:number;dental:number};
}

// No uploads or database writes here: the entire analysis happens locally.
export async function analyzePayrollFile(file:File,competence:string,importedBy:string,onProgress?:(message:string)=>void):Promise<PayrollImportAnalysis>{
  if(!/\.(pdf|xlsx?)$/i.test(file.name))throw new Error("Selecione um PDF de Extrato Mensal ou uma planilha XLS/XLSX.");
  if(!file.size||file.size>50*1024*1024)throw new Error("Cada folha deve ter conteúdo e até 50 MB.");
  if(!/\.pdf$/i.test(file.name)){
    const workbook=await readExcel(file),payroll=processPayroll(workbook,competence,importedBy);
    const sum=(field:"gross"|"deductions"|"liquid")=>payroll.records.every(record=>record.audit?.[field]!=null)?Math.round(payroll.records.reduce((total,record)=>total+record.audit![field]!,0)*100)/100:null;
    const warnings=[...workbook.warnings];
    if(sum("liquid")===null)throw new Error("A planilha não possui líquido válido para todos os colaboradores. Confira a coluna final Líquido antes de importar.");
    if(payroll.records.some(record=>record.audit?.invalidFields.length))warnings.push("Há campos financeiros de apoio inválidos na planilha. Confira o diagnóstico na Conferência após importar.");
    return{payroll,format:"Excel",warnings,checks:[`${payroll.records.length} CPFs únicos reconhecidos. Competência definida pela seleção da importação.`],totals:{gross:sum("gross"),deductions:sum("deductions"),liquid:sum("liquid"),health:Math.round(payroll.records.reduce((sum,record)=>sum+record.healthTotal,0)*100)/100,dental:Math.round(payroll.records.reduce((sum,record)=>sum+record.dentalTotal,0)*100)/100}};
  }
  const {loadPdfJs,pdfDocumentOptions}=await import("./pdf");
  const pdfjs=await loadPdfJs(),bytes=new Uint8Array(await file.arrayBuffer());
  const task=pdfjs.getDocument(pdfDocumentOptions(bytes));
  let result;
  try{
    const document=await task.promise;
    if(document.numPages>500)throw new Error("O PDF ultrapassa 500 páginas. Separe os extratos por empresa ou use Excel.");
    const pages:PayrollPdfPage[]=[];
    for(let number=1;number<=document.numPages;number++){
      onProgress?.(`Lendo PDF: página ${number} de ${document.numPages}...`);
      const page=await document.getPage(number);
      try{
        const viewport=page.getViewport({scale:1}),content=await page.getTextContent();
        if(content.items.length>100000)throw new Error(`Página ${number} muito complexa. Use o extrato original ou Excel.`);
        pages.push({number,width:viewport.width,height:viewport.height,items:content.items.flatMap(item=>{
          if(!("str" in item)||!item.str.trim())return[];
          const transform=pdfjs.Util.transform(viewport.transform,item.transform);
          return[{text:item.str,x:transform[4],y:transform[5],width:item.width,height:item.height}];
        })});
      }finally{page.cleanup();}
    }
    result=parsePayrollPdf(pages);
  }catch(error){
    if(error instanceof Error&&/Password|InvalidPDF|MissingPDF|UnknownError/.test(error.name))throw new Error("Não foi possível abrir o PDF. Envie um extrato válido, sem senha, ou use Excel.");
    throw error;
  }finally{await task.destroy();}
  if(result.competence!==competence)throw new Error(`O PDF é da competência ${result.competence}, mas você selecionou ${competence}. Selecione o mês do documento antes de importar. Nenhum dado foi gravado.`);
  const payroll:ActivePayroll={id:crypto.randomUUID(),fileName:file.name,fileSize:file.size,competence,importedAt:new Date().toISOString(),importedBy,records:result.records,logs:[`PDF · ${result.company} · ${result.competence}`,"Leitura por posição das colunas; referências separadas dos valores monetários.",...result.checks,...result.warnings.map(warning=>`Aviso: ${warning}`)]};
  return{payroll,format:"PDF",company:result.company,companyDocument:result.companyDocument,warnings:result.warnings,checks:result.checks,totals:result.totals};
}
