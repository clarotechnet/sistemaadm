import assert from "node:assert/strict";
import test from "node:test";
import type {ParsedWorkbook,PayrollRecord} from "../src/types";
import {formatOvertimeHours,formatOvertimeMinutes,overtimeColumns,overtimeRate} from "../src/modules/overtime/common";
import {compareOvertime,parseOvertimeReference,payrollOvertimePeople,referenceCompetenceFromName,type OvertimeReferenceData,type OvertimeReferenceFile} from "../src/modules/payroll/overtime-audit";
import {parsePayrollPdf} from "../src/modules/payroll/pdf-parser";
import {payrollPdfFixture} from "./fixtures/payroll-pdf";
import {buildPayrollOvertimeExcel} from "../src/services/payroll-overtime-export";
import type {OvertimeComparisonRow} from "../src/modules/payroll/overtime-audit";
import * as XLSX from "xlsx";
import {normalizePdfOvertimeEvent,pdfOvertimeDuration} from "../src/modules/payroll/pdf-overtime";

const workbook=(headers:string[],rows:unknown[][]):ParsedWorkbook=>({fileName:"Referência 09.2026.xlsx",fileSize:100,warnings:[],sheets:[{name:"Folha",headerRow:0,headers,normalizedHeaders:[],rows}]});
const reference=(data:OvertimeReferenceData,extra:Partial<OvertimeReferenceFile>={}):OvertimeReferenceFile=>({id:"ref",label:"Referência",data,mappings:{},mappingRevision:null,sourceId:null,updatedAt:"2026-10-01",updatedBy:"Teste",fileName:data.fileName,fileHash:"a".repeat(64),...extra});
const people=()=>payrollOvertimePeople(parsePayrollPdf(payrollPdfFixture()).records);
const data=(rows:unknown[][],headers=["Colaborador","H. EX 60%"])=>(parseOvertimeReference(workbook(headers,rows)));

test("shared overtime headers support arbitrary percentages and distinguish explicit monetary columns",()=>{
  for(const label of ["H. EX 50%","HE 60%","HORAS EXTRAS 70%","150 HORAS EXTRAS 100%","H EXTRA 75%"]){assert.ok(overtimeRate(label));}
  assert.equal(overtimeRate("SALARIO 50%"),null);assert.equal(overtimeRate("H. EX 60,5%"),"60.5");
  assert.deepEqual(overtimeColumns(["H. EX 50%","Valor H. EX 50%","R$ HE 100%","BASE HE 50%"]).map(c=>[c.rate,c.kind]),[["50","hours"],["50","amount"],["100","amount"]]);
});

test("invalid 28:70 is retained as an issue, never converted to minutes, money or zero",()=>{
  const parsed=data([["Ana Teste","28:70"],["Bruno Teste","27:06"]]);
  assert.equal(parsed.records[0].values["60"].minutes,null);assert.equal(parsed.records[0].values["60"].raw,"28:70");assert.match(parsed.records[0].values["60"].issues[0],/inválida/);
  assert.equal(parsed.records[1].values["60"].minutes,1626);assert.equal(parsed.warnings.length,1);
  const row=compareOvertime(people(),[reference(parsed)],"revision").find(row=>row.cpf==="00000000001")!;
  assert.equal(row.status,"INVALIDO");assert.equal(row.differenceMinutes,null);assert.equal(row.paidAmount,347.75);
});

test("duration fractions/dates and hours above 24 reuse the existing PDF-tool logic",()=>{
  assert.equal(formatOvertimeHours(1.5),"36:00");assert.equal(formatOvertimeHours(new Date(Date.UTC(1899,11,31,12))),"36:00");
  assert.equal(data([["Ana",1.5],["Bruno",new Date(Date.UTC(1899,11,31,12))]]).records[1].values["60"].minutes,2160);
  assert.equal(formatOvertimeMinutes(-70),"-01:10");assert.equal(formatOvertimeMinutes(null),"—");assert.throws(()=>formatOvertimeHours("28:70"));
});

test("blank cells in present time columns are no overtime; absent rates and absent money remain unknown",()=>{
  const parsed=data([["Ana Teste",""]]);assert.equal(parsed.records[0].values["60"].minutes,0);assert.equal(parsed.records[0].values["60"].amount,null);assert.equal(parsed.records[0].values["100"],undefined);
  const row=compareOvertime(people(),[reference(parsed)],"rev").find(row=>row.cpf==="00000000001")!;
  assert.equal(row.status,"DIVERGENTE");assert.equal(row.expectedAmount,null);assert.equal(row.differenceAmount,null);
});

test("normalized exact names compare minutes and display money without inventing reference amounts",()=>{
  const rows=compareOvertime(people(),[reference(data([["  ana  teste  ","21:55"]]))],"rev"),row=rows.find(row=>row.cpf==="00000000001")!;
  assert.equal(row.match,"NOME_EXATO");assert.equal(row.expectedMinutes,1315);assert.equal(row.paidMinutes,1315);assert.equal(row.paidAmount,347.75);assert.equal(row.expectedAmount,null);assert.equal(row.status,"OK");
});

test("percentages never compensate one another and monetary comparison requires an explicit amount",()=>{
  const rows=compareOvertime(people(),[reference(data([["Ana Teste","21:55",350]],["Colaborador","H. EX 50%","Valor H. EX 50%"]))],"rev");
  assert.equal(rows.find(row=>row.cpf==="00000000001"&&row.rate==="50")!.paidMinutes,0);assert.equal(rows.find(row=>row.cpf==="00000000001"&&row.rate==="50")!.status,"DIVERGENTE");
  assert.equal(rows.find(row=>row.cpf==="00000000001"&&row.rate==="60")!.status,"SEM_REFERENCIA");
  const same=compareOvertime(people(),[reference(data([["Ana Teste","21:55",347.77]],["Colaborador","H. EX 60%","Valor H. EX 60%"]))],"rev")[0];assert.equal(same.status,"DIVERGENTE");assert.equal(same.differenceAmount,-.02);
});

test("approximate names require manual approval and stale approval is not reused",()=>{
  const ref=reference(data([["Ana Tese","21:55"]]));let row=compareOvertime(people(),[ref],"rev").find(row=>row.referenceName==="Ana Tese")!;
  assert.equal(row.match,"APROXIMADO");assert.equal(row.status,"REVISAR_NOME");assert.equal(row.paidMinutes,null);assert.equal(row.suggestedCpf,"00000000001");
  ref.mappings[ref.data.records[0].id]="00000000001";ref.mappingRevision="rev";
  row=compareOvertime(people(),[ref],"rev").find(row=>row.referenceName==="Ana Tese")!;assert.equal(row.status,"OK");assert.equal(row.match,"MANUAL");
  row=compareOvertime(people(),[ref],"changed").find(row=>row.referenceName==="Ana Tese")!;assert.equal(row.status,"REVISAR_NOME");
});

test("homonyms and duplicate reference rows cannot silently select or sum a person",()=>{
  const list=people();list[1].name=list[0].name;list[1].aliases=[...list[0].aliases];
  const row=compareOvertime(list,[reference(data([["Ana Teste","21:55"]]))],"rev").find(row=>row.referenceName==="Ana Teste")!;assert.equal(row.match,"AMBIGUO");assert.equal(row.paidMinutes,null);
  const duplicates=compareOvertime(people(),[reference(data([["Ana Teste","21:55"],["Ana Teste","01:00"]]))],"rev").filter(row=>row.cpf==="00000000001");assert.equal(duplicates.length,2);assert.ok(duplicates.every(row=>row.status==="REVISAR_NOME"));
});

test("CPF takes precedence and a wrong CPF is not rescued through approximate names",()=>{
  const parsed=data([["Different Name","00000000001","21:55"],["Bruno Teste","00000000999","01:00"]],["Colaborador","CPF","H. EX 60%"]);
  const rows=compareOvertime(people(),[reference(parsed)],"rev");assert.equal(rows.find(row=>row.referenceName==="Different Name")!.match,"CPF");assert.equal(rows.find(row=>row.referenceName==="Bruno Teste")!.status,"NAO_LOCALIZADO");
});

test("legacy Excel and missing PDF references never prove zero paid hours; PDF-only rows stay visible",()=>{
  const records=parsePayrollPdf(payrollPdfFixture()).records,legacy:PayrollRecord={...structuredClone(records[0]),audit:undefined};
  const rows=compareOvertime(payrollOvertimePeople([legacy]),[reference(data([["Ana Teste","21:55"]]))],"rev");assert.equal(rows[0].status,"SEM_DETALHE_PDF");assert.equal(rows[0].paidMinutes,null);
  const all=compareOvertime(people(),[],"rev");assert.equal(all[0].status,"SEM_REFERENCIA");assert.equal(all[0].paidMinutes,1315);
  const mixed=compareOvertime(payrollOvertimePeople([records[0],legacy]),[reference(data([["Ana Teste","21:55"]]))],"rev");assert.equal(mixed[0].status,"SEM_DETALHE_PDF");
});

test("legacy PDF comma quantities compare as hours without reimport or mutating stored events",()=>{
  const records=parsePayrollPdf(payrollPdfFixture()).records,event=records[0].audit!.events.find(event=>event.code==="150")!;
  event.references=[{raw:"27,06",unit:"quantity",rate:60,page:1}];const before=JSON.stringify(records);
  const row=compareOvertime(payrollOvertimePeople(records),[reference(data([["Ana Teste","27:06"]]))],"rev")[0];
  assert.equal(row.paidMinutes,1626);assert.equal(row.paidAmount,347.75);assert.equal(row.status,"OK");assert.equal(JSON.stringify(records),before);
  assert.deepEqual(pdfOvertimeDuration("6,27"),{minutes:387});assert.deepEqual(pdfOvertimeDuration("0,00"),{minutes:0});assert.deepEqual(pdfOvertimeDuration("1.000,06"),{minutes:60006});
  const excel={...event,origin:undefined};assert.equal(normalizePdfOvertimeEvent(excel),excel);
});

test("invalid PDF minutes stay invalid with or without an Excel reference, never coerced to zero",()=>{
  const records=parsePayrollPdf(payrollPdfFixture()).records;records[0].audit!.events.find(event=>event.code==="150")!.references=[{raw:"28,70",unit:"quantity",rate:60,page:1}];
  const list=payrollOvertimePeople(records),standalone=compareOvertime(list,[],"rev")[0],compared=compareOvertime(list,[reference(data([["Ana Teste","28:59"]]))],"rev")[0];
  for(const row of [standalone,compared]){assert.equal(row.status,"INVALIDO");assert.equal(row.paidMinutes,null);assert.match(row.issues.join(" "),/28,70/);assert.equal(row.paidAmount,347.75);}
});

test("time tolerance is explicit; differences use payroll minus reference",()=>{
  const ref=reference(data([["Ana Teste","21:54"]]));assert.equal(compareOvertime(people(),[ref],"rev")[0].differenceMinutes,1);assert.equal(compareOvertime(people(),[ref],"rev")[0].status,"DIVERGENTE");assert.equal(compareOvertime(people(),[ref],"rev",1)[0].status,"OK");
});

test("headers/separators are ignored, rows keep source positions and repeated hour columns are issues",()=>{
  const parsed=data([["Colaborador","H. EX 60%"],["Ana","01:00"],["TOTAL","100:00"],["",""]]);assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].row,3);
  const duplicate=data([["Ana","01:00","02:00"]],["Colaborador","H. EX 60%","HE 60%"]);assert.equal(duplicate.records[0].values["60"].minutes,null);assert.match(duplicate.records[0].values["60"].issues[0],/Mais de uma/);
  assert.equal(referenceCompetenceFromName("INFORMAÇÕES - Folha - 09.2026 - DMV RECIFE.xls"),"09/2026");assert.equal(referenceCompetenceFromName("Ref.xlsx"),null);
});

test("overtime XLSX preserves typed money/rates, leading-zero CPF, long/signed hours, invalid originals and every supplied row",async()=>{
  const base:OvertimeComparisonRow={id:"test",referenceFileId:"ref",referenceRecordId:"row",name:'=HYPERLINK("https://example.invalid")',referenceName:"Nome de referência",cpf:"00000000001",rate:"60",expectedMinutes:2160,paidMinutes:0,differenceMinutes:-2160,expectedAmount:null,paidAmount:0,differenceAmount:-347.75,rawReference:"28:70",origins:["Referência fictícia, linha 2"],issues:["Hora inválida"],status:"INVALIDO",match:"NOME_EXATO",suggestedCpf:null,similarity:100};
  const rows=Array.from({length:35},(_,index)=>({...base,id:String(index)}));
  const bytes=await buildPayrollOvertimeExcel(rows,"09/2026",false),book=XLSX.read(bytes,{type:"array",cellNF:true}),sheet=book.Sheets["Horas Extras"];
  assert.deepEqual(book.SheetNames,["Horas Extras"]);assert.equal(sheet["!ref"],"A1:P36");assert.equal(sheet["!autofilter"]?.ref,"A1:P36");
  assert.equal(sheet.A2.v,"09/2026");assert.equal(sheet.D2.v,"000.000.000-01");assert.equal(sheet.D2.t,"s");assert.equal(sheet.B2.t,"s");assert.equal(sheet.B2.f,undefined);assert.equal(sheet.B2.v,base.name);
  assert.equal(sheet.E2.v,.6);assert.equal(sheet.E2.t,"n");assert.equal(XLSX.utils.format_cell(sheet.E2),"60%");assert.equal(sheet.F2.v,1.5);assert.equal(XLSX.utils.format_cell(sheet.F2),"36:00");assert.equal(sheet.G2.v,0);assert.equal(sheet.H2.v,"-36:00");assert.equal(sheet.H2.t,"s");
  assert.ok(!sheet.I2||sheet.I2.v===undefined);assert.equal(sheet.J2.v,0);assert.equal(sheet.J2.t,"n");assert.equal(sheet.K2.v,-347.75);assert.match(sheet.K2.z??"",/R\$/);assert.equal(sheet.N2.v,"28:70");assert.equal(sheet.L2.v,"Dado inválido");
});

test("overtime XLSX respects CPF masking and refuses empty exports",async()=>{
  const row=compareOvertime(people(),[],"rev")[0];
  const book=XLSX.read(await buildPayrollOvertimeExcel([row],"09/2026",true),{type:"array"});
  assert.notEqual(book.Sheets["Horas Extras"].D2.v,"000.000.000-01");assert.match(book.Sheets["Horas Extras"].D2.v,/\*/);
  await assert.rejects(()=>buildPayrollOvertimeExcel([],"09/2026",false),/Não há registros/);
});
