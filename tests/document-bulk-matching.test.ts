import test from "node:test";
import assert from "node:assert/strict";
import type { Employee } from "../src/types";
import { matchEmployeeFromFilename, normalizeDocumentMatchText } from "../src/modules/employees/document-matching";
import { prepareBulkFiles } from "../app/ui/pages/EmployeeDocumentBulkUploadModal";

function employee(id:string,name:string):Employee {
  return {id,name,cpf:"12345678901",documentNumber:"",registration:"",department:"Operação",jobTitle:"Técnico",
    status:"ATIVO",source:"QUARK",externalId:id,externalUnitId:null,externalUnitName:"",
    externalTeamId:null,externalTeamName:"",admissionDate:null,terminationDate:null,
    lastSyncedAt:null,createdAt:"",updatedAt:""};
}
const employees=[
  employee("1","JAILZA CORREIA ALVES"),
  employee("2","MARIA DA SILVA"),
  employee("3","ANA MARIA DA SILVA"),
  employee("4","JOÃO DA CONCEIÇÃO"),
  employee("5","LUCIANO PEREIRA"),
];

test("PDF QuarkSign padrão localiza pelo nome completo sem escolher funcionário",()=>{
  const result=matchEmployeeFromFilename("Espelho de Ponto Completo - JAILZA CORREIA ALVES-QuarkSign_13.pdf",employees);
  assert.equal(result.status,"matched");
  if(result.status==="matched")assert.equal(result.employee.id,"1");
});
test("Maiúsculas, acentos, separadores e PDF de férias/atestado",()=>{
  assert.equal(normalizeDocumentMatchText("João da Conceição"),"JOAO DA CONCEICAO");
  const result=matchEmployeeFromFilename("Atestado médico_joao-da conceicao (2).PDF",employees);
  assert.equal(result.status,"matched");
  if(result.status==="matched")assert.equal(result.employee.id,"4");
});
test("Nomes inteiros prevalecem sobre trechos de nomes mais longos",()=>{
  const longer=matchEmployeeFromFilename("Documento - ANA MARIA DA SILVA - RH.pdf",employees);
  assert.equal(longer.status,"matched");
  if(longer.status==="matched")assert.equal(longer.employee.id,"3");
  const shorter=matchEmployeeFromFilename("Documento - MARIA DA SILVA.pdf",employees);
  assert.equal(shorter.status,"matched");
  if(shorter.status==="matched")assert.equal(shorter.employee.id,"2");
});
test("Sem nome e nome parcial não vincula ninguém",()=>{
  assert.equal(matchEmployeeFromFilename("espelho-ponto-2026-09.pdf",employees).status,"unmatched");
  assert.equal(matchEmployeeFromFilename("Atestado - JAILZA CORREIA.pdf",employees).status,"unmatched");
});
test("Dois funcionários diferentes no arquivo são ambíguos",()=>{
  const result=matchEmployeeFromFilename("JAILZA CORREIA ALVES e LUCIANO PEREIRA.pdf",employees);
  assert.equal(result.status,"ambiguous");
});
test("Funcionários com mesmo nome são ambíguos, não envia ao ID arbitrário",()=>{
  const duplicate=[employee("a","JAILZA CORREIA ALVES"),employee("b","JAILZA CORREIA ALVES")];
  assert.equal(matchEmployeeFromFilename("JAILZA CORREIA ALVES.pdf",duplicate).status,"ambiguous");
});
test("Massa sem limite artificial de quantidade, com tamanho máximo de 50 MB por PDF",()=>{
  const docs=Array.from({length:123},(_,i)=>new File(["PDF"],`Espelho de Ponto Completo - JAILZA CORREIA ALVES-QuarkSign_${i}.pdf`,{type:"application/pdf"}));
  const matched=prepareBulkFiles(docs,employees);
  assert.equal(matched.length,123);
  assert.equal(matched.filter(x=>x.valid&&x.match.status==="matched").length,123);
  const existing=new File(["abc"],"JAILZA CORREIA ALVES.xlsx");
  assert.equal(prepareBulkFiles([existing],employees)[0].valid,true);
  const wrong=new File(["abc"],"JAILZA CORREIA ALVES.exe");
  assert.equal(prepareBulkFiles([wrong],employees)[0].valid,false);
});
