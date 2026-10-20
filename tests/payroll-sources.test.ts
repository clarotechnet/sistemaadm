import assert from "node:assert/strict";
import test from "node:test";
import type {ActivePayroll,ParsedWorkbook} from "../src/types";
import {processPayroll} from "../src/modules/payroll/processor";
import {consolidatePayrollRecords,normalizeSourceLabel,payrollFileHash,sourceLabel} from "../src/modules/payroll/sources";
import {comparePlan} from "../src/modules/comparisons/processor";
import {comparePayrolls} from "../src/modules/payroll/audit";

function sheet(name:string,rows:unknown[][]):ActivePayroll{
  const workbook:ParsedWorkbook={fileName:name+".xlsx",fileSize:100,warnings:[],sheets:[{name,headerRow:0,normalizedHeaders:[],headers:["CPF","NOME","LÍQUIDO","TOTAL PROVENTOS","TOTAL DESCONTOS","PLANO SAÚDE","PLANO ODONTO"],rows}]};
  return processPayroll(workbook,"10/2026","Teste");
}
const one="00000000001",two="00000000002",three="00000000003";
test("DMV, VNA and RDT are consolidated without dropping CPFs or duplicating the employee count",()=>{
  const dmv=sheet("DMV",[[one,"Ana",100,112,12,10,2]]),vna=sheet("VNA",[[two,"Bruna",200,224,24,20,4]]),rdt=sheet("RDT",[[three,"Clara",300,336,36,30,6]]);
  const before=JSON.stringify([dmv,vna,rdt]),records=consolidatePayrollRecords([dmv,vna,rdt].flatMap(month=>month.records));
  assert.equal(records.length,3);assert.equal(records.reduce((sum,r)=>sum+r.liquid,0),600);assert.equal(records.reduce((sum,r)=>sum+r.healthTotal,0),60);assert.equal(JSON.stringify([dmv,vna,rdt]),before);
});
test("same CPF in complementary source files sums money and keeps both origins for audit",()=>{
  const first=sheet("DMV",[[one,"Ana",100.1,112.1,12,10,2]]).records[0],next=sheet("Complementar",[[one,"Ana",50.2,56.2,6,5,1]]).records[0];
  const [record]=consolidatePayrollRecords([first,next]);assert.equal(record.liquid,150.3);assert.equal(record.healthTotal,15);assert.equal(record.dentalTotal,3);assert.equal(record.audit?.gross,168.3);assert.equal(record.audit?.deductions,18);
  assert.equal(record.audit?.baseSalary,null);assert.equal(record.audit?.occurrences.length,2);assert.match(record.sourceSheet,/DMV.*Complementar/);
  const report=comparePayrolls({...sheet("Atual",[[one,"Ana",0,0,0,0,0]]),records:[record]},null,[]);
  assert.equal(report.summary.duplicates,1);
});
test("health and dental comparisons use every source of the selected month",()=>{
  const a=sheet("DMV",[[one,"Ana",100,112,12,10,2]]),b=sheet("VNA",[[two,"Bruna",200,224,24,20,4]]);
  const payroll={...a,records:consolidatePayrollRecords([...a.records,...b.records])};
  assert.equal(comparePlan(payroll,[{cpf:one,name:"Ana",value:10},{cpf:two,name:"Bruna",value:20}],"health",.01).summary.ok,2);
  assert.equal(comparePlan(payroll,[{cpf:one,name:"Ana",value:2},{cpf:two,name:"Bruna",value:4}],"dental",.01).summary.ok,2);
});
test("legacy sources remain readable but do not fabricate complete financial details",()=>{
  const modern=sheet("Moderna",[[one,"Ana",100,112,12,10,2]]).records[0],legacy={...modern,sourceSheet:"Legada",audit:undefined};
  const [record]=consolidatePayrollRecords([legacy,modern]);assert.equal(record.liquid,200);assert.equal(record.audit,undefined);assert.equal(legacy.audit,undefined);
});
test("source names normalize identity; file fingerprints detect renamed reimports",async()=>{
  assert.equal(sourceLabel("VNA Natal.XLSX"),"VNA Natal");assert.equal(normalizeSourceLabel("  DMV   Natal  "),"dmv natal");
  const a=await payrollFileHash(new File(["folha original"],"VNA.xlsx")),b=await payrollFileHash(new File(["folha original"],"renomeada.xlsx")),c=await payrollFileHash(new File(["folha corrigida"],"VNA.xlsx"));
  assert.equal(a,b);assert.notEqual(a,c);assert.equal(a.length,64);
});
