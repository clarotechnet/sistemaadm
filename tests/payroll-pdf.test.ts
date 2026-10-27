import assert from "node:assert/strict";
import test from "node:test";
import {parsePayrollPdf} from "../src/modules/payroll/pdf-parser";
import {analyzePayrollFile} from "../src/services/payroll-import";
import {payrollPdfFixture} from "./fixtures/payroll-pdf";
import {mergeAuditData,normalizePayrollAuditEvents} from "../src/modules/payroll/audit-fields";
import {assertDistinctPayrollPayments,consolidatePayrollRecords,payrollPaymentSignature,sourceLabel} from "../src/modules/payroll/sources";
import {payrollRecordFromRow} from "../src/services/browser-backend";
import {comparePayrolls,detailEvents} from "../src/modules/payroll/audit";
import {comparePlan} from "../src/modules/comparisons/processor";

test("spatial PDF reader separates references from payments, preserves P/D and excludes summaries",()=>{
  const result=parsePayrollPdf(payrollPdfFixture());
  assert.equal(result.records.length,3);assert.equal(result.competence,"09/2026");assert.deepEqual(result.totals,{gross:2898.70,deductions:804.01,liquid:2094.69,health:419,dental:55.45});
  const [ana,bruno,carla]=result.records,extra=ana.audit!.events.find(e=>e.code==="150")!;
  assert.equal(extra.value,347.75);assert.deepEqual(extra.references,[{raw:"21:55",unit:"hours",minutes:1315,rate:60,page:1}]);
  assert.equal(ana.audit!.events.find(e=>e.code==="149")!.references![0].unit,"percentage");assert.equal(bruno.liquid,0);assert.equal(carla.audit!.source!.employeeKind,"CONTRIBUINTE");
  assert.equal(ana.audit!.events.find(e=>e.code==="998")!.category,"inss");assert.equal(ana.audit!.events.find(e=>e.code==="998")!.references![0].unit,"percentage");
  assert.equal(carla.audit!.events.find(e=>e.code==="228")!.references![0].raw,"10,00");assert.match(bruno.audit!.source!.notes[0],/00\/00\/0000/);assert.equal(bruno.audit!.terminationDate,null);
  assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/1 minuto/);assert.match(result.checks.join(" "),/12 rubrica/);
});

test("PDF explicit deduction remains a deduction after database read and reference merge",()=>{
  const result=parsePayrollPdf(payrollPdfFixture()),record=result.records[2],audit=record.audit!;
  assert.equal(normalizePayrollAuditEvents(audit).events.find(e=>e.code==="51")!.kind,"deduction");
  const restored=payrollRecordFromRow({cpf:record.cpf,name:record.name,liquid:record.liquid,health_total:record.healthTotal,dental_total:record.dentalTotal,health_columns:0,dental_columns:0,source_sheet:record.sourceSheet,audit_data:JSON.parse(JSON.stringify(audit))});
  assert.deepEqual(restored.audit,audit);const merged=mergeAuditData(result.records[0].audit!,result.records[0].audit!);
  assert.equal(merged.events.find(e=>e.code==="150")!.value,695.5);assert.equal(merged.events.find(e=>e.code==="150")!.references!.length,2);
  const report=comparePayrolls({id:"x",competence:"09/2026",fileName:"test.pdf",fileSize:10,importedAt:"2026-10-01",importedBy:"Teste",records:result.records,logs:[]},null,[]);
  assert.match(detailEvents(report.rows.find(row=>row.cpf===result.records[0].cpf)!).find(event=>event.key==="150 HORAS EXTRAS 60%")!.currentReference!,/21:55 h/);
});

test("PDF data participates in the existing health and dental comparisons",()=>{
  const result=parsePayrollPdf(payrollPdfFixture()),payroll={id:"x",competence:"09/2026",fileName:"test.pdf",fileSize:10,importedAt:"2026-10-01",importedBy:"Teste",records:result.records,logs:[]};
  assert.equal(comparePlan(payroll,[{cpf:result.records[0].cpf,name:"Ana",value:419}],"health",.01).summary.ok,1);
  assert.equal(comparePlan(payroll,[{cpf:result.records[0].cpf,name:"Ana",value:55.45}],"dental",.01).summary.ok,1);
});

test("PDF extraction ignores source ordering and artificial whitespace",()=>{
  const pages=payrollPdfFixture(),expected=parsePayrollPdf(pages);
  for(const page of pages){page.items.reverse();page.items.push({text:" ",x:0,y:144,width:500,height:7});}
  assert.deepEqual(parsePayrollPdf(pages),expected);
});

test("unrecognized, scanned, partial, mixed and inconsistent PDFs fail closed",()=>{
  const alter=(change:(pages:ReturnType<typeof payrollPdfFixture>)=>void,pattern:RegExp)=>{const pages=payrollPdfFixture();change(pages);assert.throws(()=>parsePayrollPdf(pages),pattern);};
  alter(p=>{p[0].items=[];},/texto extraível/);
  alter(p=>{p[0].width=842;},/proporção/);
  alter(p=>{p[0].items.find(i=>i.text==="EXTRATO MENSAL")!.text="OUTRO MODELO";},/modelo não reconhecido/);
  alter(p=>{p[1].items.find(i=>i.text==="09/2026")!.text="10/2026";},/empresas ou competências diferentes/);
  alter(p=>{p[1].items.find(i=>i.text==="00.000.000/0001-00")!.text="11.111.111/0001-11";},/empresas ou competências diferentes/);
  alter(p=>{p[0].items.find(i=>i.text==="000.000.000-02")!.text="000.000.000-01";},/CPF repetido/);
  alter(p=>{p[0].items.find(i=>i.text==="347,75")!.text="347,74";},/rubrica 150.*não fecha/);
  alter(p=>{p[0].items.find(i=>i.text==="2.898,70")!.text="2.899,70";},/não fecha com o resumo/);
  alter(p=>{p[1].items.find(i=>i.text==="2")!.text="3";},/quantidade/);
  alter(p=>{p[0].items=p[0].items.filter(i=>!i.text.startsWith("Total Geral")&&!i.text.startsWith("Líquido Geral"));},/totais gerais/);
  alter(p=>{p[0].items.find(i=>i.text==="21:55")!.text="21:99";},/horas inválida/);
  alter(p=>{p[0].items.find(i=>i.text==="21:55")!.text="texto";},/referência de rubrica/);
});

test("PDF/Excel alternatives cannot double count identical payments, but explicit replacement and complements work",()=>{
  const records=parsePayrollPdf(payrollPdfFixture()).records,existing=[{id:"vna",label:"VNA Excel",records}];
  assert.equal(sourceLabel("VNA.PDF"),"VNA");assert.equal(payrollPaymentSignature(records),payrollPaymentSignature([...records].reverse()));
  assert.throws(()=>assertDistinctPayrollPayments(existing,[{label:"VNA PDF",payroll:{records}}]),/Possível folha duplicada/);
  assert.throws(()=>assertDistinctPayrollPayments([],[{label:"VNA Excel",payroll:{records}},{label:"VNA PDF",payroll:{records}}]),/Possível folha duplicada/);
  assert.doesNotThrow(()=>assertDistinctPayrollPayments(existing,[{sourceId:"vna",label:"VNA PDF",payroll:{records}}]));
  const complementary=structuredClone(records);complementary[0].liquid=100;
  assert.doesNotThrow(()=>assertDistinctPayrollPayments(existing,[{label:"Complementar",payroll:{records:complementary}}]));
  const consolidated=consolidatePayrollRecords([...records,...complementary]);assert.equal(consolidated[0].audit!.events.find(e=>e.code==="150")!.references!.length,2);
});

test("import router keeps Excel and refuses missing net, wrong format, empty and oversized files",async()=>{
  const XLSX=await import("xlsx"),book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["CPF","NOME","LIQUIDO"],["00000000001","Ana",0]]),"Folha");
  const file=new File([XLSX.write(book,{type:"array",bookType:"xlsx"})],"Folha.xlsx");const result=await analyzePayrollFile(file,"09/2026","Teste");
  assert.equal(result.format,"Excel");assert.equal(result.totals.liquid,0);assert.equal(result.totals.gross,null);
  const missing=XLSX.utils.book_new();XLSX.utils.book_append_sheet(missing,XLSX.utils.aoa_to_sheet([["CPF","NOME"],["00000000001","Ana"]]),"Folha");
  await assert.rejects(()=>analyzePayrollFile(new File([XLSX.write(missing,{type:"array",bookType:"xlsx"})],"Folha.xlsx"),"09/2026","Teste"),/líquido válido/);
  await assert.rejects(()=>analyzePayrollFile(new File(["x"],"arquivo.docx"),"09/2026","Teste"),/Selecione um PDF/);
  await assert.rejects(()=>analyzePayrollFile(new File([],"arquivo.pdf"),"09/2026","Teste"),/50 MB/);
  await assert.rejects(()=>analyzePayrollFile(new File([new Uint8Array(50*1024*1024+1)],"arquivo.pdf"),"09/2026","Teste"),/50 MB/);
});
