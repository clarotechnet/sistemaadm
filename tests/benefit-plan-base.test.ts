import assert from "node:assert/strict";
import test from "node:test";
import type { ActivePayroll, ParsedWorkbook } from "../src/types";
import {comparePlanBase,latestPlanBase,parsePlanBase,parsePlanValue,planBaseAtMonth,planMonth,type PlanBaseVersion} from "../src/modules/benefits/plan-base";
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
