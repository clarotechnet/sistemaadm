import test from "node:test";
import assert from "node:assert/strict";
import type { Employee } from "../src/types";
import { movementMonthlySummary, movementRowsForMonth, monthShift, employeeUnit, isValidCompetence } from "../src/modules/employees/movements";

function employee(id:string, admissionDate:string|null, terminationDate:string|null, status:Employee["status"], unit="VNA - NATAL"):Employee {
  return {
    id,name:"Colaborador "+id,cpf:"00000000000",documentNumber:"",registration:"",
    department:"Operações",jobTitle:"Técnico",status,source:"QUARK",
    externalId:id,externalUnitId:"1",externalUnitName:unit,
    externalTeamId:null,externalTeamName:"",admissionDate,terminationDate,
    lastSyncedAt:null,createdAt:"2026-10-09T00:00:00Z",updatedAt:"2026-10-09T00:00:00Z"
  };
}

test("admissões por data real e desligamentos por data real, não data de sincronização",()=>{
  const employees=[
    employee("A","2026-09-03",null,"ATIVO"),
    employee("B","2026-09-08","2026-10-05","DESLIGADO"),
    employee("C","2025-01-01","2026-09-25","DESLIGADO"),
    employee("D",null,null,"ATIVO"),
  ];
  const sept=movementMonthlySummary(employees,"2026-09");
  assert.equal(sept.admissions,2);
  assert.equal(sept.terminations,1);
  assert.equal(sept.net,1);
  assert.equal(sept.activeNow,2);
  assert.equal(sept.missingAdmission,1);
  assert.equal(sept.missingTermination,0);
  assert.deepEqual(sept.movementRows.map(row=>row.date),["2026-09-25","2026-09-08","2026-09-03"]);
  const oct=movementMonthlySummary(employees,"2026-10");
  assert.equal(oct.admissions,0);
  assert.equal(oct.terminations,1);
});

test("funcionário que entrou e saiu no mesmo mês conta uma vez em cada indicador",()=>{
  const result=movementMonthlySummary([employee("E","2026-09-02","2026-09-28","DESLIGADO")],"2026-09");
  assert.equal(result.admissions,1);
  assert.equal(result.terminations,1);
  assert.equal(result.net,0);
  assert.equal(result.movementRows.length,2);
});

test("cadastro sem data de saída não conta como demitido no mês arbitrariamente",()=>{
  const result=movementMonthlySummary([employee("X",null,null,"DESLIGADO")],"2026-09");
  assert.equal(result.terminations,0);
  assert.equal(result.missingTermination,1);
  assert.equal(result.missingAdmission,1);
});

test("competência é validada e mudança de mês atravessa o ano corretamente",()=>{
  assert.equal(isValidCompetence("2026-13"),false);
  assert.equal(isValidCompetence("2026-02"),true);
  assert.equal(monthShift("2026-01",-1),"2025-12");
  assert.equal(monthShift("2026-12",1),"2027-01");
  assert.deepEqual(movementRowsForMonth([employee("K","2026-10-03",null,"ATIVO")],"2026-13"),[]);
});

test("empresa/unidade do cadastro Quark serve como filtro",()=>{
  assert.equal(employeeUnit(employee("A","2026-09-02",null,"ATIVO")),"VNA - NATAL");
  assert.equal(employeeUnit({...employee("M",null,null,"ATIVO",""),source:"MANUAL"}),"Cadastro manual");
});
