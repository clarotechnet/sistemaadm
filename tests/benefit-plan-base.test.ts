import assert from "node:assert/strict";
import test from "node:test";
import type { ActivePayroll, ParsedWorkbook } from "../src/types";
import {comparePlanBase,isPlanCoparticipationOnly,latestPlanBase,parsePlanBase,parsePlanCoparticipation,parsePlanInvoice,parsePlanValue,planBaseAtMonth,planBaseSnapshot,planCoparticipationsAtMonth,planMonth,validatePlanInput,withPlanCoparticipationMonth,type PlanBaseVersion} from "../src/modules/benefits/plan-base";
import { createPlanBaseWorkbook } from "../src/services/benefit-plan-export";
import { readExcel } from "../src/services/excel";
const cpf="52998224725",second="11144477735";
const row=(patch:Partial<PlanBaseVersion>={}):PlanBaseVersion=>({id:"v1",kind:"health",cpf,name:"Pessoa fictícia",company:"",city:"",department:"",plan:"",value:100,status:"ATIVO",notes:"",metadata:{},effectiveFrom:"2026-09",revision:1,source:"Teste",createdAt:"2026-09-01T00:00:00Z",createdByName:"Teste",...patch});
const payroll=(competence="10/2026",healthTotal=120):ActivePayroll=>({id:"payroll",fileName:"teste.xlsx",fileSize:1,competence,importedAt:"2026-10-01",importedBy:"Teste",logs:[],records:[{cpf,name:"Pessoa fictícia",healthTotal,dentalTotal:20,healthColumns:1,dentalColumns:1,liquid:3000,sourceSheet:"Folha"}]});
const book=(headers:string[],rows:unknown[][]):ParsedWorkbook=>({fileName:"teste.xlsx",fileSize:1,warnings:[],sheets:[{name:"Base",headerRow:3,headers,normalizedHeaders:headers,rows}]});
test("plan base selects the correct month and does not lose previous prices on deactivation or deletion",()=>{
  const versions=[row(),row({id:"v2",effectiveFrom:"2026-10",value:120,revision:2}),row({id:"v3",effectiveFrom:"2026-11",status:"INATIVO",revision:3}),row({id:"v4",effectiveFrom:"2026-12",status:"EXCLUIDO",revision:4})];
  assert.equal(planBaseAtMonth(versions,"09/2026")[0].value,100);assert.equal(planBaseAtMonth(versions,"2026-10")[0].value,120);assert.equal(planBaseAtMonth(versions,"2026-11")[0].status,"INATIVO");assert.equal(planBaseAtMonth(versions,"2026-08").length,0);
  assert.equal(comparePlanBase(payroll("09/2026",100),versions,"health",.01).rows[0].referenceValue,0);
  assert.equal(comparePlanBase(payroll("11/2026",100),versions,"health",.01).rows[0].referenceValue,0);
  assert.equal(versions[0].value,100);
});
test("any payroll month uses the latest registration, without summing versions or filtering effective dates",()=>{
  const versions=[row({id:"newer",effectiveFrom:"2026-04",revision:3,value:150}),row({id:"future",effectiveFrom:"2027-01",revision:2,value:140}),row()];
  assert.equal(latestPlanBase(versions).length,1);assert.equal(latestPlanBase(versions)[0].id,"newer");
  for(const month of ["04/2026","09/2026","01/2028"]){
    const result=comparePlanBase(payroll(month,150),versions,"health",.01);
    assert.equal(result.rows[0].referenceValue,150);assert.equal(result.summary.ok,1);
  }
  assert.equal(comparePlanBase(payroll("04/2026",100),[row()],"health",.01).summary.ok,1,"A September base can be compared to an April payroll");
});
test("same-month edits use the latest revision and health/dental are independent",()=>{
  const versions=[row(),row({revision:2,value:110}),row({kind:"dental",value:20})];
  assert.equal(planBaseAtMonth(versions,"2026-10").length,2);
  assert.equal(comparePlanBase(payroll("10/2026",110),versions,"health",.01).summary.ok,1);
  assert.equal(comparePlanBase(payroll(),versions,"dental",.01).summary.ok,1);
});
test("Hapvida uses DESC FOLHA rather than FATURA, unit price or monthly fee",()=>{
  const imported=parsePlanBase(book(["NOME","CPF","BASE MENSALIDADE","FATURA","CO-PART.","DESC FOLHA"],[["Pessoa",cpf,999,888,10,123.45]]),"health");
  assert.equal(imported.records[0].value,123.45);assert.equal(imported.records[0].metadata.invoice,888);assert.equal(imported.records[0].metadata.valueColumn,"DESC FOLHA");
});

test("optional FATURA and OBS import independently of the payroll deduction in both plans",()=>{
  for(const kind of ["health","dental"] as const){
    const imported=parsePlanBase(book(["NOME","CPF","DESC FOLHA","FATURA","OBS"],[["Pessoa",cpf,120,"R$ 1.234,56","  Conferir dependente\nAutorizado pelo RH  "]]),kind);
    assert.equal(imported.issues.length,0);
    assert.equal(imported.records[0].metadata.invoice,1234.56);
    assert.equal(imported.records[0].notes,"Conferir dependente\nAutorizado pelo RH");
    const result=comparePlanBase(payroll("10/2026",120),[row({...imported.records[0],kind})],kind,.01);
    assert.equal(result.rows[0].referenceValue,120,"Invoice must never replace the expected employee deduction");
  }
  for(const header of ["OBS.","Observação","Observações"]){
    assert.equal(parsePlanBase(book(["NOME","CPF","VALOR",header],[["Pessoa",cpf,10,"Observação do RH"]]),"health").records[0].notes,"Observação do RH");
  }
});

test("missing optional columns preserve the existing registration; explicit blank cells clear them",()=>{
  const old=row({city:"Natal",department:"RH",plan:"Plano A",notes:"Conferir",metadata:{invoice:80,lives:2}});
  const imported=parsePlanBase(book(["NOME","CPF","DESC FOLHA"],[["Pessoa",cpf,125]]),"health",[old]);
  assert.deepEqual([imported.records[0].city,imported.records[0].department,imported.records[0].plan,imported.records[0].metadata.invoice,imported.records[0].notes],["Natal","RH","Plano A",80,"Conferir"]);
  const cleared=parsePlanBase(book(["NOME","CPF","DESC FOLHA","FATURA","OBS","CIDADE"],[["Pessoa",cpf,125,"","",""]]),"health",[old]).records[0];
  assert.equal(cleared.metadata.invoice,null);assert.equal(cleared.notes,"");assert.equal(cleared.city,"");assert.equal(cleared.department,"RH");
  assert.equal(old.metadata.invoice,80);assert.equal(old.notes,"Conferir");
  const newRecord=parsePlanBase(book(["NOME","CPF","VALOR"],[["Pessoa",cpf,10]]),"health").records[0];
  assert.equal(newRecord.metadata.invoice,null);assert.equal(newRecord.notes,"");
});

test("optional invoice validation distinguishes blank from zero and identifies invalid input",()=>{
  for(const value of [undefined,null,"","   "])assert.equal(parsePlanInvoice(value),null);
  for(const value of [0,"0,00","R$ 0,00"])assert.equal(parsePlanInvoice(value),0);
  for(const value of ["não informado","-1,00",-1,Infinity])assert.throws(()=>parsePlanInvoice(value),/FATURA/);
  const invalid=parsePlanBase(book(["NOME","CPF","VALOR","FATURA"],[["Pessoa",cpf,10,"erro"],["Outra pessoa",second,20,0]]),"health");
  assert.equal(invalid.records.length,1);assert.equal(invalid.records[0].metadata.invoice,0);assert.match(invalid.issues[0],/linha 5: Valor de FATURA inválido/);
  assert.throws(()=>validatePlanInput(row({notes:"a".repeat(2001)})),/OBS/);
  const revised=validatePlanInput(row({metadata:{invoice:"15,50",sourceSheet:"Base"},notes:"  Revisado  "}));
  assert.equal(revised.metadata.invoice,15.5);assert.equal(revised.metadata.sourceSheet,"Base");assert.equal(revised.notes,"Revisado");
});

test("a named employee without CPF is identified in the preview, without importing totals or blank lines",()=>{
  const imported=parsePlanBase(book(["NOME","CPF","DESC FOLHA","FATURA","OBS"],[
    ["Pessoa sem CPF","",100,140,"Revisar"],["Pessoa válida",cpf,20,25,""],["TOTAL","",120,165,""],["","","","",""],
  ]),"health");
  assert.equal(imported.records.length,1);assert.equal(imported.records[0].cpf,cpf);
  assert.equal(imported.sourceRows,2);assert.equal(imported.issues.length,1);
  assert.match(imported.issues[0],/linha 5: CPF não informado; cadastro não importado/);
});
test("Odonto uses VALOR not VALOR UNI.; conflicting CPF becomes pending, never summed",()=>{
  const imported=parsePlanBase(book(["NOME","CPF","VALOR UNI.","VALOR"],[["Pessoa A",cpf,13.86,13.86],["Pessoa B",cpf,13.86,55.44],["Pessoa C",second,10,30]]),"dental");
  assert.equal(imported.records.length,2);const pending=imported.records.find(r=>r.cpf===cpf)!;assert.equal(pending.status,"PENDENTE");assert.equal(pending.value,null);assert.equal((pending.metadata.sourceConflicts as unknown[]).length,2);assert.equal(imported.records.find(r=>r.cpf===second)!.value,30);
  assert.equal(comparePlanBase(payroll(),[row({...pending})],"health",.01).rows[0].status,"NÃO LOCALIZADO NA REFERÊNCIA");
});
test("unknown, invalid and negative prices are not fabricated as zero; an explicit zero is preserved",()=>{
  assert.equal(parsePlanValue("R$ 1.234,56"),1234.56);assert.equal(parsePlanValue(0),0);
  for(const value of [null,"","erro","-1,00",-1,Infinity])assert.throws(()=>parsePlanValue(value));
  assert.equal(parsePlanBase(book(["NOME","CPF","VALOR"],[["Pessoa",cpf,""]]),"health").records.length,0);
  assert.throws(()=>planMonth("2026-13"));assert.equal(planMonth("09/2026"),"2026-09");
});
test("non-beneficiaries without charges are excluded, while unexpected charges are reported",()=>{
  const p=payroll();p.records.push({...p.records[0],cpf:second,healthTotal:0});
  assert.equal(comparePlanBase(p,[row()],"health",.01).rows.length,1);
  p.records[1].healthTotal=80;
  const result=comparePlanBase(p,[row()],"health",.01);
  assert.equal(result.rows.find(r=>r.cpf===second)!.status,"NÃO LOCALIZADO NA REFERÊNCIA");
});

test("monthly reconciliation flags an omitted deduction and a beneficiary absent from payroll",()=>{
  const versions=[row(),row({id:"v2",cpf:second,name:"Outra pessoa fictícia",value:35})];
  const result=comparePlanBase(payroll("10/2026",0),versions,"health",.01);
  const omitted=result.rows.find(r=>r.cpf===cpf)!;
  assert.equal(omitted.payrollValue,0);assert.equal(omitted.referenceValue,100);assert.equal(omitted.difference,-100);assert.equal(omitted.status,"DIVERGENTE");
  const absent=result.rows.find(r=>r.cpf===second)!;
  assert.equal(absent.payrollValue,null);assert.equal(absent.referenceValue,35);assert.equal(absent.status,"NÃO LOCALIZADO NA FOLHA");
  assert.deepEqual(result.summary,{total:2,ok:0,divergent:1,missing:1,differenceTotal:-100});
});

test("monthly coparticipation keeps each month and ignores informational revisions when selecting the financial base",()=>{
  const september=row({metadata:{coparticipation:15}});
  const december=row({id:"dec",effectiveFrom:"2026-12",revision:2,value:140});
  const november=row({id:"nov-copart",effectiveFrom:"2026-11",revision:3,value:9999,status:"INATIVO",metadata:{coparticipation:25,coparticipationMonth:"2026-11",coparticipationOnly:true}});
  const correction=row({...november,id:"nov-zero",revision:4,metadata:{...november.metadata,coparticipation:0}});
  const versions=[september,december,november,correction];
  assert.equal(planCoparticipationsAtMonth(versions,"2026-09")[0].metadata.coparticipation,15);
  assert.equal(planCoparticipationsAtMonth(versions,"2026-10").length,0);
  assert.equal(planCoparticipationsAtMonth(versions,"2026-11")[0].metadata.coparticipation,0);
  assert.equal(planCoparticipationsAtMonth(versions,"2026-12").length,0);
  assert.equal(planBaseAtMonth(versions,"2026-11")[0].value,100);
  assert.equal(planBaseAtMonth(versions,"2026-12")[0].value,140);
  assert.equal(latestPlanBase(versions)[0].id,"dec");
  assert.equal(comparePlanBase(payroll("11/2026",140),versions,"health",.01).summary.ok,1,"A coparticipation correction cannot replace a later tariff or add the amount twice");
  const cleared=row({...correction,id:"nov-clear",revision:5,metadata:{...correction.metadata,coparticipation:null}});
  assert.equal(planCoparticipationsAtMonth([...versions,cleared],"2026-11")[0].metadata.coparticipation,null);
  assert.equal(september.metadata.coparticipation,15);
});

test("legacy amounts are assigned their original month once; missing import columns do not repeat monthly coparticipation",()=>{
  const original={coparticipation:"12,50",invoice:100};
  const metadata=withPlanCoparticipationMonth(original,"09/2026");
  assert.equal(metadata.coparticipationMonth,"2026-09");assert.equal(Object.hasOwn(original,"coparticipationMonth"),false);
  assert.equal(withPlanCoparticipationMonth(metadata,"2026-12").coparticipationMonth,"2026-09");
  const old=row({metadata});
  const imported=parsePlanBase(book(["NOME","CPF","DESC FOLHA"],[["Pessoa",cpf,150]]),"health",[old]).records[0];
  assert.equal(Object.hasOwn(imported.metadata,"coparticipation"),false);
  assert.equal(planCoparticipationsAtMonth([old,row({...imported,id:"nov",effectiveFrom:"2026-11",revision:2})],"2026-09")[0].metadata.coparticipation,"12,50");
  assert.equal(planCoparticipationsAtMonth([old,row({...imported,id:"nov",effectiveFrom:"2026-11",revision:2})],"2026-11").length,0);
});

test("an older client can edit a tariff after a monthly entry without its financial change being hidden",()=>{
  const base=row({value:160,effectiveFrom:"2026-12"});
  const monthly=row({...base,id:"monthly",revision:2,metadata:{coparticipation:35,coparticipationMonth:"2026-11",coparticipationOnly:true,coparticipationBaseSnapshot:planBaseSnapshot(base)}});
  const oldClientEdit=row({...monthly,id:"tariff-edit",revision:3,value:170});
  assert.equal(isPlanCoparticipationOnly(monthly),true);
  assert.equal(isPlanCoparticipationOnly(oldClientEdit),false);
  assert.equal(latestPlanBase([base,monthly,oldClientEdit])[0].value,170);
  assert.equal(planBaseAtMonth([base,monthly,oldClientEdit],"2026-12")[0].value,170);
  assert.equal(comparePlanBase(payroll("11/2026",170),[base,monthly,oldClientEdit],"health",.01).summary.ok,1);
});

test("coparticipation aliases, period and zero are imported explicitly without changing DESC FOLHA",()=>{
  for(const header of ["COPARTICIPAÇÃO","CO-PART.","COPART","CO PARTICIPACAO"]){
    const imported=parsePlanBase(book(["NOME","CPF","DESC FOLHA",header,"COMPETENCIA COPARTICIPACAO"],[["Pessoa",cpf,120,"12,50","11/2026"]]),"health").records[0];
    assert.equal(imported.value,120);assert.equal(imported.metadata.coparticipation,12.5);assert.equal(imported.metadata.coparticipationMonth,"2026-11");
    assert.equal(comparePlanBase(payroll("11/2026",120),[row({...imported})],"health",.01).summary.ok,1);
  }
  for(const value of ["",null])assert.equal(parsePlanCoparticipation(value),null);
  assert.equal(parsePlanCoparticipation(0),0);assert.throws(()=>parsePlanCoparticipation(-1),/coparticipação/);
  assert.throws(()=>validatePlanInput(row({metadata:{coparticipation:10,coparticipationMonth:"2026-13"}})),/competência/);
  assert.throws(()=>validatePlanInput(row({metadata:{coparticipationOnly:true}})),/lançamento mensal/);
  const invalid=parsePlanBase(book(["NOME","CPF","DESC FOLHA","COPART"],[["Pessoa",cpf,100,"erro"]]),"health");
  assert.equal(invalid.records.length,0);assert.match(invalid.issues[0],/coparticipação inválido/);
});

test("mass tariff imports preserve inactive status and pending references",()=>{
  const inactive=row({status:"INATIVO"});
  const updated=parsePlanBase(book(["NOME","CPF","DESC FOLHA"],[["Pessoa",cpf,130]]),"health",[inactive]).records[0];
  assert.equal(updated.status,"INATIVO");
  const explicit=parsePlanBase(book(["NOME","CPF","DESC FOLHA","SITUACAO"],[["Pessoa",cpf,130,"Ativo"],["Outra pessoa",second,"","PENDENTE"]]),"health",[inactive]);
  assert.equal(explicit.records[0].status,"ATIVO");assert.equal(explicit.records[1].status,"PENDENTE");assert.equal(explicit.records[1].value,null);
});

test("base XLSX exports monthly detail, text CPFs and observations without adding coparticipation, and can be reimported",async()=>{
  const XLSX=await import("xlsx");
  const base=row({cpf:"01234567890",plan:"UNIMED",value:120,status:"INATIVO",notes:"=texto literal",metadata:{invoice:150,coparticipation:9,coparticipationMonth:"2026-09"}});
  const detail=row({...base,id:"copart",revision:2,metadata:{coparticipation:25.5,coparticipationMonth:"2026-11",coparticipationOnly:true}});
  const workbook=await createPlanBaseWorkbook({kind:"health",competence:"2026-11",records:[base],versions:[base,detail],maskCpf:false});
  assert.deepEqual(workbook.SheetNames,["Base","Como importar"]);
  const sheet=workbook.Sheets.Base;
  assert.equal(sheet.C2.v,120);assert.equal(sheet.H2.v,150);assert.equal(sheet.I2.v,25.5);assert.equal(sheet.J2.v,"11/2026");
  assert.equal(sheet.B2.v,"012.345.678-90");assert.equal(sheet.B2.t,"s");assert.equal(sheet.B2.z,"@");assert.equal(sheet.K2.f,undefined);
  assert.equal(sheet.K2.v,"=texto literal");assert.equal(sheet["!autofilter"]?.ref,"A1:Q2");
  const bytes=XLSX.write(workbook,{type:"array",bookType:"xlsx"});
  const reimported=parsePlanBase(await readExcel(new File([bytes],"reajuste-unimed.xlsx")),"health").records[0];
  assert.equal(reimported.cpf,"01234567890");assert.equal(reimported.value,120);assert.equal(reimported.status,"INATIVO");
  assert.equal(reimported.metadata.coparticipation,25.5);assert.equal(reimported.metadata.coparticipationMonth,"2026-11");
});

test("base export respects masking, templates are empty and duplicate historical rows cannot become an invoice base",async()=>{
  const base=row();
  const masked=await createPlanBaseWorkbook({kind:"health",competence:"2026-11",records:[base],versions:[base],maskCpf:true});
  assert.match(String(masked.Sheets.Base.B2.v),/^\*\*\*/);assert.equal(masked.Sheets.Base.I2,undefined);
  const template=await createPlanBaseWorkbook({kind:"health",competence:"2026-11",records:[],versions:[],maskCpf:false,template:true});
  assert.equal(template.Sheets.Base.A2,undefined);assert.equal(template.Sheets.Base.A1.v,"NOME");
  assert.equal(template.Sheets.Base.I1.v,"COPARTICIPACAO");assert.equal(template.Sheets.Base.H1.v,"FATURA");
  assert.equal(template.Sheets.Base.K1.v,"OBS");
  await assert.rejects(()=>createPlanBaseWorkbook({kind:"health",competence:"2026-11",records:[base,base],versions:[base],maskCpf:false}),/apenas um cadastro/);
});
