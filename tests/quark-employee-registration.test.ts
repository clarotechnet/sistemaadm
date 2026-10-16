import assert from "node:assert/strict";
import test from "node:test";
import { quarkEmployeeRegistration } from "../supabase/functions/sync-quark-employees/employee-registration.ts";

test("Matrícula eSocial do QuarkRH vem em pessoa.eletronicoSocial", () => {
  const record = {
    id: 123456,
    pessoa: { nome: "FUNCIONARIO TESTE", eletronicoSocial: "359", pis: "01234567890" },
  };
  assert.equal(quarkEmployeeRegistration(record), "359");
});

test("Preserva matrícula alfanumérica e zeros à esquerda", () => {
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: "  000359-A " } }), "000359-A");
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: 359 } }), "359");
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: "359.0" } }), "359");
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: "000359.0" } }), "000359");
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: "A.0" } }), "A.0");
});

test("Faz fallback em campos anteriores, mas não usa ID, CPF ou PIS como matrícula", () => {
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: "" }, matricula: "1234" }), "1234");
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: null }, numeroMatricula: "678" }), "678");
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: null }, numero_matricula: 802 }), "802");
  assert.equal(quarkEmployeeRegistration({ id: 45, pessoa: { cpfCnpj: "11122233344", pis: "00123456789" } }), "");
  assert.equal(quarkEmployeeRegistration({ pessoa: null }), "");
});

test("Matrícula eSocial tem prioridade quando outros campos divergirem", () => {
  assert.equal(quarkEmployeeRegistration({ pessoa: { eletronicoSocial: "359" }, matricula: "98765" }), "359");
});
