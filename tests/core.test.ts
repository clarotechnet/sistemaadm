import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCpf, formatCpf, isValidCpf } from "../src/utils/cpf";
import { normalizeHeader } from "../src/utils/text";
import { parseMoney } from "../src/utils/money";
import { processPayroll } from "../src/modules/payroll/processor";
import { comparePlan, parseReference } from "../src/modules/comparisons/processor";
import { decideAuthSessionEvent } from "../src/hostinger/auth-session";
import { pdfCompressionSaving } from "../src/services/pdf";
import type { ParsedWorkbook } from "../src/types";

test("normalizes CPF, headers and Brazilian money consistently", () => {
  assert.equal(normalizeCpf("110.673.044-52"), "11067304452");
  assert.equal(normalizeCpf(123456789), "00123456789");
  assert.equal(formatCpf("11067304452"), "110.673.044-52");
  assert.equal(isValidCpf("110.673.044-52"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(normalizeHeader("  PLANO__DE  SAÚDE "), "PLANO DE SAUDE");
  assert.equal(parseMoney("R$ 1.234,56"), 1234.56);
  assert.equal(parseMoney("(419,00)"), -419);
});

test("sums duplicate plan columns and compares the union of CPFs", () => {
  const payrollWorkbook:ParsedWorkbook={fileName:"folha.xlsx",fileSize:1,warnings:[],sheets:[{name:"Folha",headerRow:2,headers:["CPF","COLABORADOR","LÍQUIDO","PLANO DE SAÚDE","PLANO_DE_SAUDE","PLANO ODONTO"],normalizedHeaders:["CPF","COLABORADOR","LIQUIDO","PLANO DE SAUDE","PLANO DE SAUDE","PLANO ODONTO"],rows:[["110.673.044-52","João Silva","2.500,00","419,00",0,"32,10"],["00123456789","Maria Lima",1800,100,25,0]]}]};
  const payroll=processPayroll(payrollWorkbook,"07/2026","Teste");
  assert.equal(payroll.records.find(item=>item.cpf==="11067304452")?.healthTotal,419);
  const referenceWorkbook:ParsedWorkbook={fileName:"ref.xlsx",fileSize:1,warnings:[],sheets:[{name:"Ref",headerRow:0,headers:["CPF","NOME","FOLHA"],normalizedHeaders:["CPF","NOME","FOLHA"],rows:[["11067304452","João Silva",419],["99999999999","Ausente",50]]}]};
  const result=comparePlan(payroll,parseReference(referenceWorkbook,"health"),"health",.01);
  assert.equal(result.summary.total,3);
  assert.equal(result.summary.ok,1);
  assert.equal(result.summary.missing,2);
});

test("keeps the current screen mounted when an existing browser session is reconfirmed", () => {
  assert.equal(decideAuthSessionEvent("INITIAL_SESSION", "user-1", null, false), "ignore");
  assert.equal(decideAuthSessionEvent("TOKEN_REFRESHED", "user-1", "user-1", true), "ignore");
  assert.equal(decideAuthSessionEvent("SIGNED_IN", "user-1", "user-1", true), "ignore");
  assert.equal(decideAuthSessionEvent("USER_UPDATED", "user-1", "user-1", true), "refresh-profile");
  assert.equal(decideAuthSessionEvent("SIGNED_IN", "user-2", "user-1", true), "replace-user");
  assert.equal(decideAuthSessionEvent("SIGNED_OUT", null, "user-1", true), "sign-out");
});

test("calculates PDF compression savings without reporting negative reductions", () => {
  assert.equal(pdfCompressionSaving(1_000, 600), 40);
  assert.equal(pdfCompressionSaving(1_000, 1_200), 0);
  assert.equal(pdfCompressionSaving(0, 0), 0);
});
