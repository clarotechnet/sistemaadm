import assert from "node:assert/strict";
import test from "node:test";
import type { ActivePayroll, Employee, ParsedWorkbook, PayrollAuditData, PayrollRecord } from "../src/types";
import { processPayroll } from "../src/modules/payroll/processor";
import { auditMoney, createAuditReader } from "../src/modules/payroll/audit-fields";
import { auditValue, comparePayrollHistory, comparePayrolls, comparisonCompetences, deductionsPercentage, defaultAuditRules, detailEvents, matchesAuditMetric, type AuditMetric, type AuditRules } from "../src/modules/payroll/audit";
import { auditContext } from "../src/services/payroll-audit";
import { payrollRecordFromRow } from "../src/services/browser-backend";

function audit(values: Partial<PayrollAuditData> = {}): PayrollAuditData {
  return { version: 1, baseSalary: 3000, gross: 3500, deductions: 500, liquid: 3000, company: "Teste", unit: "Unidade", costCenter: "RH", department: "Controle", jobTitle: "Analista", registration: "", internalId: "", employmentStatus: "ATIVO", admissionDate: null, terminationDate: null, payrollType: "NORMAL", events: [], occurrences: [{ sheet: "Folha", row: 2 }], invalidFields: [], ...values };
}
function record(cpf: string, values: Partial<PayrollAuditData> = {}): PayrollRecord {
  const data = audit(values);
  return { cpf, name: `Funcionário ${cpf}`, liquid: data.liquid ?? 0, healthTotal: 0, dentalTotal: 0, healthColumns: 0, dentalColumns: 0, sourceSheet: "Folha", audit: data };
}
function month(competence: string, records: PayrollRecord[]): ActivePayroll {
  return { id: competence, competence, records, fileName: "Teste.xlsx", fileSize: 1, importedAt: "2026-10-01", importedBy: "Teste", logs: [] };
}
function employee(cpf: string, values: Partial<Employee> = {}): Employee {
  return { id: cpf, cpf, name: `Funcionário ${cpf}`, documentNumber: cpf, registration: "", department: "Controle", jobTitle: "Analista", status: "ATIVO", source: "QUARK", externalId: cpf, externalUnitId: "unidade-1", externalUnitName: "Empresa Teste", externalTeamId: null, externalTeamName: "Controle", admissionDate: "2026-01-01", terminationDate: null, lastSyncedAt: "2026-10-07T12:00:00Z", createdAt: "2026-01-01", updatedAt: "2026-10-07", ...values };
}
test("audit import preserves zeros, unknowns, events and repeated source lines without changing legacy sums", () => {
  const workbook: ParsedWorkbook = { fileName: "Teste.xlsx", fileSize: 1, warnings: [], sheets: [{ name: "Folha", headerRow: 2, headers: ["CPF", "Nome", "Salário líquido", "Salário-base", "Total proventos", "Total descontos", "Hora extra", "Plano de saúde", "Plano_de_saude", "Empresa"], normalizedHeaders: [], rows: [["00123456789", "Teste", 0, "", "inválido", 30, 50, 5, 10, "Teste"], ["00123456789", "Teste", 100, 3000, 130, 30, 25, 2, 3, "Teste"]] }] };
  const payroll = processPayroll(workbook, "10/2026", "Teste");
  const result = payroll.records[0];
  assert.equal(result.liquid, 100);
  assert.equal(result.healthTotal, 20);
  assert.equal(result.audit?.gross, null);
  assert.equal(result.audit?.baseSalary, null);
  assert.equal(result.audit?.liquid, 100);
  assert.deepEqual(result.audit?.occurrences.map(item => item.row), [4, 5]);
  assert.equal(result.audit?.events.find(event => event.category === "health")?.value, 20);
  assert.equal(result.audit?.events.find(event => event.category === "overtime")?.value, 75);
  assert.ok(result.audit?.invalidFields.includes("Total proventos"));
  assert.equal(result.audit?.invalidFields.includes("Salário-base"), false);
  assert.equal(auditMoney(""), null);
  assert.equal(auditMoney("texto"), null);
  assert.equal(auditMoney("0,00"), 0);
  assert.equal(auditMoney("(300,25)"), -300.25);
});
test("audit detects zeros, negative liquid, new/missing and possible duplicates without mutating inputs", () => {
  const previous = month("09/2026", [record("1"), record("2"), record("5")]);
  const current = month("10/2026", [record("1", { baseSalary: 0, gross: 0, deductions: 0, liquid: 0 }), record("2", { gross: 100, deductions: 200, liquid: -100 }), record("3"), record("4", { occurrences: [{ sheet: "Folha", row: 2 }, { sheet: "Folha", row: 3 }] })]);
  const before = JSON.stringify([current, previous]);
  const result = comparePayrolls(current, previous, []);
  assert.equal(result.summary.zeroPayroll, 1);
  assert.equal(result.summary.zeroLiquid, 1);
  assert.equal(result.summary.negativeLiquid, 1);
  assert.equal(result.summary.newEmployees, 2);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.summary.currentTotal, 5900);
  assert.equal(result.summary.previousTotal, 9000);
  assert.equal(result.summary.difference, -3100);
  assert.equal(result.rows.find(row => row.cpf === "5")?.severity, "ATENCAO");
  assert.equal(JSON.stringify([current, previous]), before);
});
test("variation requires both limits and handles zero reference without infinite percentage", () => {
  const previous = month("09/2026", [record("1", { liquid: 100 }), record("2"), record("3", { liquid: 0 })]);
  const current = month("10/2026", [record("1", { liquid: 200 }), record("2", { liquid: 3500 }), record("3", { liquid: 700 })]);
  const result = comparePayrolls(current, previous, []);
  assert.equal(result.rows.find(row => row.cpf === "1")?.findings.some(finding => finding.code === "VARIATION"), false);
  assert.equal(result.rows.find(row => row.cpf === "2")?.findings.some(finding => finding.code === "VARIATION"), false);
  assert.equal(result.rows.find(row => row.cpf === "3")?.findings.some(finding => finding.code === "VARIATION"), true);
  assert.equal(result.rows.find(row => row.cpf === "3")?.variation, null);
});
test("known employment justifications downgrade zero payroll while unexplained negative remains critical", () => {
  const current = month("10/2026", [record("1", { gross: 0, liquid: 0, deductions: 0, baseSalary: 0, employmentStatus: "Afastado" }), record("2", { liquid: -100, employmentStatus: "Férias" })]);
  const result = comparePayrolls(current, null, []);
  assert.equal(result.rows.find(row => row.cpf === "1")?.severity, "ATENCAO");
  assert.equal(result.rows.find(row => row.cpf === "2")?.severity, "CRITICO");
  assert.equal(result.summary.newEmployees, 0);
});
test("legacy and incomplete imports do not fabricate gross, event zeros or complete totals", () => {
  const legacy = record("1"); delete legacy.audit;
  const current = month("10/2026", [legacy, record("2", { liquid: null, gross: null, baseSalary: null })]);
  const result = comparePayrolls(current, null, []);
  assert.equal(result.summary.currentTotal, null);
  assert.equal(result.summary.zeroPayroll, 0);
  assert.equal(result.summary.zeroLiquid, 0);
  assert.equal(auditValue(legacy, "gross"), null);
  assert.equal(detailEvents(result.rows.find(row => row.cpf === "1")!).find(event => event.key === "gross")?.current, null);
});
test("event changes, base changes, dismissals and admitted employees without payment are explained", () => {
  const previous = month("09/2026", [record("1", { events: [{ key: "HE", label: "Hora extra", kind: "earning", category: "overtime", value: 100 }] })]);
  const current = month("10/2026", [record("1", { baseSalary: 4000, terminationDate: "2026-09-15", events: [{ key: "HE", label: "Hora extra", kind: "earning", category: "overtime", value: 800 }] })]);
  const admitted = employee("2", { name: "Admitido", admissionDate: "2026-08-01" });
  const result = comparePayrolls(current, previous, [employee("1"), admitted]);
  const codes = result.rows.find(row => row.cpf === "1")!.findings.map(finding => finding.code);
  assert.ok(codes.includes("BASE_CHANGE")); assert.ok(codes.includes("EVENT:HE")); assert.ok(codes.includes("TERMINATED_PAID"));
  assert.ok(result.rows.find(row => row.cpf === "2")?.findings.some(finding => finding.code === "ADMISSION_NO_PAY"));
  const event = detailEvents(result.rows.find(row => row.cpf === "1")!).find(item => item.key === "HE");
  assert.equal(event?.difference, 700);
  assert.throws(() => comparePayrolls(current, month("11/2026", []), []), /anterior/);
});
test("job peer outliers are attention, and vacation/13 rules require explicit evidence", () => {
  const records = ["1", "2", "3", "4", "5"].map(cpf => record(cpf, { baseSalary: cpf === "5" ? 6000 : 3000 }));
  records[0].audit!.events.push({ key: "FERIAS", label: "Férias", kind: "earning", category: "vacation", value: 0 });
  records[1].audit!.events.push({ key: "13", label: "13º", kind: "earning", category: "thirteenth", value: 1000 });
  const result = comparePayrolls(month("10/2026", records), null, [], undefined, [{ cpf: "1", days: 10 }]);
  assert.ok(result.rows.find(row => row.cpf === "1")?.findings.some(finding => finding.code === "VACATION_UNPAID"));
  assert.ok(result.rows.find(row => row.cpf === "2")?.findings.some(finding => finding.code === "THIRTEENTH_REVIEW"));
  assert.equal(result.rows.find(row => row.cpf === "5")?.findings.find(finding => finding.code === "JOB_OUTLIER")?.severity, "ATENCAO");
});

test("dismissed registry without a date is not presumed eligible for payment", () => {
  const employees = [employee("1", { status: "DESLIGADO" }), employee("2", { status: "DESLIGADO", terminationDate: "2026-10-15" }), employee("3")];
  const result = comparePayrolls(month("10/2026", [record("3")]), null, employees);
  assert.equal(result.rows.some(row => row.cpf === "1"), false);
  assert.ok(result.rows.find(row => row.cpf === "2")?.findings.some(finding => finding.code === "ADMISSION_NO_PAY"));
});

test("final net total is used instead of the earlier termination net component", () => {
  const workbook: ParsedWorkbook = { fileName: "Teste.xls", fileSize: 1, warnings: [], sheets: [{ name: "Folha", headerRow: 0, headers: ["CPF", "Nome", "LIQUIDO RESCISAO", "Total proventos", "Total descontos", "Liquido"], normalizedHeaders: [], rows: [["00123456789", "Teste", 99, 3000, 3000, 0]] }] };
  const row = processPayroll(workbook, "10/2026", "Teste").records[0];
  assert.equal(row.liquid, 0);
  assert.equal(row.audit?.liquid, 0);
});

test("the final named totals are shared by payroll and audit even with earlier net aliases", () => {
  const headers = Array<string>(100).fill("");
  const values = Array<unknown>(100).fill("");
  const fields: Array<[number, string, unknown]> = [[0, "CPF", "00123456789"], [1, "Nome", "Teste"], [60, "LIQUIDO RESCISAO", 99], [90, "VALOR LIQUIDO", 500], [97, "Total proventos", 3000], [98, "Total descontos", 500], [99, "Liquido", 2500]];
  for (const [index, label, value] of fields) { headers[index] = label; values[index] = value; }
  const workbook: ParsedWorkbook = { fileName: "Teste.xls", fileSize: 1, warnings: [], sheets: [{ name: "Folha", headerRow: 0, headers, normalizedHeaders: [], rows: [values] }] };
  const row = processPayroll(workbook, "10/2026", "Teste").records[0];
  assert.equal(row.liquid, 2500);
  assert.equal(row.audit?.liquid, 2500);
  assert.equal(row.audit?.gross, 3000);
  assert.equal(row.audit?.deductions, 500);
});

test("repeated total headers select the final column and retain a genuine zero", () => {
  const workbook: ParsedWorkbook = { fileName: "Teste.xls", fileSize: 1, warnings: [], sheets: [{ name: "Folha", headerRow: 0, headers: ["CPF", "Nome", "Liquido", "Total proventos", "Total descontos", "Total proventos", "Total descontos", "Liquido", ""], normalizedHeaders: [], rows: [["00123456789", "Teste", 500, 1000, 500, 3000, 3000, 0, ""]] }] };
  const row = processPayroll(workbook, "10/2026", "Teste").records[0];
  assert.equal(row.liquid, 0);
  assert.equal(row.audit?.liquid, 0);
  assert.equal(row.audit?.gross, 3000);
  assert.equal(row.audit?.deductions, 3000);
});

test("a termination net component alone is not substituted for an unavailable final net", () => {
  const workbook: ParsedWorkbook = { fileName: "Teste.xls", fileSize: 1, warnings: [], sheets: [{ name: "Folha", headerRow: 0, headers: ["CPF", "Nome", "LIQUIDO RESCISAO"], normalizedHeaders: [], rows: [["00123456789", "Teste", 99]] }] };
  const row = processPayroll(workbook, "10/2026", "Teste").records[0];
  assert.equal(row.audit?.liquid, null);
  assert.notEqual(row.liquid, 99);
});

test("taxes and advances on vacation, termination and thirteenth remain deductions", () => {
  const labels = ["INSS FÉRIAS", "IRRF FÉRIAS", "INSS RESCISÃO", "IRRF RESCISÃO", "013 INSS 13º SALÁRIO", "IRRF 13º SALÁRIO", "ADIANTAMENTO 13º", "Desconto férias", "Férias", "13º salário", "Rescisão"];
  const data = createAuditReader({ name: "Teste", headerRow: 0, headers: labels, normalizedHeaders: [], rows: [] })(labels.map(() => 100), 0);
  assert.deepEqual(data.events.slice(0, 8).map(event => event.kind), Array(8).fill("deduction"));
  assert.deepEqual(data.events.slice(0, 8).map(event => event.category), ["inss", "irrf", "inss", "irrf", "inss", "irrf", "advance", "other"]);
  assert.deepEqual(data.events.slice(8).map(event => [event.kind, event.category]), [["earning", "vacation"], ["earning", "thirteenth"], ["earning", "termination"]]);
});

test("termination taxes do not conceal payment after dismissal or create special-payment findings", () => {
  const workbook: ParsedWorkbook = { fileName: "Teste.xls", fileSize: 1, warnings: [], sheets: [{ name: "Folha", headerRow: 0, headers: ["CPF", "Nome", "Liquido", "Data demissão", "Tipo folha", "INSS RESCISÃO", "IRRF FÉRIAS", "IRRF 13º SALÁRIO"], normalizedHeaders: [], rows: [["00123456789", "Teste", 500, "01/09/2026", "NORMAL", 100, 50, 25]] }] };
  const current = processPayroll(workbook, "10/2026", "Teste");
  const result = comparePayrolls(current, null, [employee("00123456789", { status: "DESLIGADO", terminationDate: "2026-09-01" })]);
  const findings = result.rows[0].findings.map(finding => finding.code);
  assert.ok(findings.includes("TERMINATED_PAID"));
  assert.equal(result.rows[0].severity, "CRITICO");
  for (const code of ["VACATION_REVIEW", "THIRTEENTH_REVIEW", "TERMINATION_DATE_MISSING"]) assert.ok(!findings.includes(code));
});

test("saved imports are reclassified on read without changing stored data or financial values", () => {
  const saved = audit({ gross: 600, deductions: 100, liquid: 500, terminationDate: "2026-09-01", events: [{ key: "INSS RESCISAO", label: "INSS RESCISÃO", kind: "earning", category: "termination", value: 100 }] });
  const original = JSON.stringify(saved);
  const row = payrollRecordFromRow({ cpf: "00123456789", name: "Teste", liquid: 500, health_total: 25, dental_total: 5, health_columns: 1, dental_columns: 1, source_sheet: "Folha", audit_data: saved });
  assert.equal(JSON.stringify(saved), original);
  assert.equal(row.audit?.events[0].kind, "deduction");
  assert.equal(row.audit?.events[0].category, "inss");
  assert.equal(row.audit?.events[0].value, 100);
  assert.equal(row.liquid, 500);
  assert.equal(row.healthTotal, 25);
  assert.equal(row.dentalTotal, 5);
  const result = comparePayrolls(month("10/2026", [row]), null, [employee(row.cpf, { status: "DESLIGADO", terminationDate: "2026-09-01" })]);
  assert.ok(result.rows[0].findings.some(finding => finding.code === "TERMINATED_PAID"));
});

test("zero payroll is checked against Quark CPF status without inventing employment history", () => {
  const records = ["1", "2", "3"].map(cpf => record(cpf, { employmentStatus: "", gross: 0, deductions: 0, liquid: 0 }));
  const result = comparePayrolls(month("06/2026", records), null, [employee("1"), employee("2", { status: "DESLIGADO" })]);
  assert.equal(result.rows.find(row => row.cpf === "1")?.severity, "CRITICO");
  assert.equal(result.rows.find(row => row.cpf === "2")?.severity, "ATENCAO");
  assert.match(result.rows.find(row => row.cpf === "2")!.findings.find(finding => finding.code === "ZERO_LIQUID")!.explanation, /não comprova o histórico/);
  assert.equal(result.rows.find(row => row.cpf === "3")?.employeeStatus, "NAO_LOCALIZADO");
  assert.equal(result.rows.find(row => row.cpf === "3")?.severity, "ATENCAO");
  assert.equal(result.summary.activeZeroLiquid, 1);
  assert.equal(result.summary.unmatchedEmployees, 1);
});

test("registry employees from another unit are not falsely flagged as missing payroll", () => {
  const result = comparePayrolls(month("10/2026", [record("1")]), null, [employee("1"), employee("2"), employee("3", { externalUnitId: "outra-unidade" })]);
  assert.ok(result.rows.find(row => row.cpf === "2")?.findings.some(finding => finding.code === "ADMISSION_NO_PAY"));
  assert.equal(result.rows.some(row => row.cpf === "3"), false);
});

test("changing Quark status invalidates review context but an identical synchronization does not", async () => {
  const current = month("10/2026", [record("1")]);
  const rules = { basis: "liquid" as const, percentage: 20, absolute: 300 };
  const first = await auditContext(current, null, rules, [employee("1")]);
  const unchanged = await auditContext(current, null, rules, [employee("1", { lastSyncedAt: "2026-10-08T12:00:00Z" })]);
  const changed = await auditContext(current, null, rules, [employee("1", { status: "DESLIGADO" })]);
  assert.equal(first.revisionKey, unchanged.revisionKey);
  assert.notEqual(first.revisionKey, changed.revisionKey);
});

test("numeric event codes and tax bases do not masquerade as thirteenth payments", () => {
  const read = createAuditReader({ name: "Teste", headerRow: 0, headers: ["013 INSS", "Base INSS", "13º salário", "13º", "131 Gratificação"], normalizedHeaders: [], rows: [] });
  const data = read([200, 3000, 1000, 1500, 300], 0);
  assert.equal(data.events.find(event => event.label === "013 INSS")?.category, "inss");
  assert.equal(data.events.some(event => event.label === "Base INSS"), false);
  assert.equal(data.events.filter(event => event.category === "thirteenth").length, 2);
  assert.equal(data.events.find(event => event.label === "131 Gratificação")?.category, "bonus");
});

test("optional base salary does not create exceptions or classify a paid payroll as zero", () => {
  const records = [record("1", { baseSalary: null }), record("2", { baseSalary: null, invalidFields: ["Salário-base"] }), record("3", { baseSalary: 0 })];
  const result = comparePayrolls(month("10/2026", records), null, records.map(row => employee(row.cpf)));
  assert.equal(result.summary.ok, 3);
  assert.equal(result.summary.zeroPayroll, 0);
  assert.equal(result.summary.zeroLiquid, 0);
  assert.equal(result.summary.currentTotal, 9000);
  const read = createAuditReader({ name: "Teste", headerRow: 0, headers: ["Salário-base", "Líquido", "Total proventos"], normalizedHeaders: [], rows: [] });
  assert.deepEqual(read(["", 3000, 3500], 0).invalidFields, []);
  const realInvalid = comparePayrolls(month("10/2026", [record("1", { baseSalary: null, gross: null, invalidFields: ["Salário-base", "Total proventos"] })]), null, [employee("1")]);
  assert.match(realInvalid.rows[0].findings.find(item => item.code === "INVALID_DATA")!.explanation, /Total proventos/);
  assert.doesNotMatch(realInvalid.rows[0].findings.find(item => item.code === "INVALID_DATA")!.explanation, /Salário-base/);
});

test("high deductions use known positive gross, configurable strict limits and preserve critical negatives", () => {
  const records = [
    record("1", { baseSalary: null, gross: 4000, deductions: 2400, liquid: 1600 }),
    record("2", { gross: 4000, deductions: 2000, liquid: 2000 }),
    record("3", { gross: null, deductions: 2400, liquid: 1600 }),
    record("4", { gross: 0, deductions: 0, liquid: 0 }),
    record("5", { gross: 1000, deductions: 1100, liquid: -100 }),
  ];
  const current = month("10/2026", records);
  const employees = records.map(row => employee(row.cpf));
  const result = comparePayrolls(current, null, employees);
  assert.equal(deductionsPercentage(records[0]), 60);
  assert.equal(deductionsPercentage(records[2]), null);
  assert.equal(deductionsPercentage(records[3]), null);
  assert.equal(deductionsPercentage(null), null);
  assert.equal(deductionsPercentage(record("6", { deductions: -50 })), null);
  assert.equal(result.summary.highDeductions, 2);
  assert.equal(result.rows.find(row => row.cpf === "1")?.severity, "ATENCAO");
  assert.match(result.rows.find(row => row.cpf === "1")!.findings.find(item => item.code === "HIGH_DEDUCTIONS")!.explanation, /60,00%/);
  assert.equal(result.rows.find(row => row.cpf === "2")?.severity, "OK", "Exactly 50% does not exceed the limit.");
  assert.equal(result.rows.find(row => row.cpf === "5")?.severity, "CRITICO");
  const raised = comparePayrolls(current, null, employees, { ...defaultAuditRules, deductionsPercentage: 60 });
  assert.equal(raised.rows.find(row => row.cpf === "1")?.findings.some(item => item.code === "HIGH_DEDUCTIONS"), false);
  assert.equal(raised.summary.highDeductions, 1);
  for (const value of [-1, 101, NaN, Infinity]) assert.throws(() => comparePayrolls(current, null, employees, { ...defaultAuditRules, deductionsPercentage: value }), /entre 0 e 100/);
});

test("every metric selects exactly its count, including combined missing cases and active zero net", () => {
  const records = [record("1", { gross: 500, deductions: 500, liquid: 0 }), record("2"), record("3", { occurrences: [{ sheet: "Folha", row: 2 }, { sheet: "Folha", row: 3 }] })];
  const previous = month("09/2026", [record("1"), record("2"), record("90")]);
  const employees = [employee("1"), employee("2"), employee("4")];
  const result = comparePayrolls(month("10/2026", records), previous, employees);
  const metrics: AuditMetric[] = ["processed", "ok", "attention", "critical", "information", "zeroPayroll", "zeroLiquid", "negativeLiquid", "newEmployees", "missing", "duplicates", "activeZeroLiquid", "unmatchedEmployees", "highDeductions"];
  for (const metric of metrics) assert.equal(result.rows.filter(row => matchesAuditMetric(row, metric)).length, result.summary[metric], metric);
  assert.equal(result.summary.processed, 3);
  assert.equal(result.summary.missing, 2);
  assert.equal(result.summary.activeZeroLiquid, 1);
  assert.equal(result.summary.unmatchedEmployees, 1);
  assert.equal(result.summary.highDeductions, 1);
  assert.ok(result.rows.find(row => row.cpf === "4")?.findings.some(item => item.code === "ADMISSION_NO_PAY"));
});

test("changing the deduction threshold invalidates the saved review context", async () => {
  const current = month("10/2026", [record("1")]);
  const first = await auditContext(current, null, defaultAuditRules);
  const changed = await auditContext(current, null, { ...defaultAuditRules, deductionsPercentage: 70 });
  assert.notEqual(first.revisionKey, changed.revisionKey);
});

test("comparison is always net pay and accepts only the three preceding calendar months", () => {
  assert.deepEqual(comparisonCompetences("01/2027"), ["12/2026", "11/2026", "10/2026"]);
  assert.deepEqual(comparisonCompetences("03/2026", 2), ["02/2026", "01/2026"]);
  assert.throws(() => comparisonCompetences("10/2026", 4), /1 a 3/);
  assert.throws(() => comparisonCompetences("10/2026", 0), /1 a 3/);
  assert.throws(() => comparisonCompetences("inválida"), /competência válida/);
  const current = month("10/2026", [record("1", { gross: 4500, deductions: 1500, liquid: 3000 })]);
  const prior = month("09/2026", [record("1")]);
  const result = comparePayrolls(current, prior, [employee("1")]);
  assert.equal(result.rows[0].difference, 0);
  assert.equal(result.summary.currentTotal, 3000);
  assert.equal(result.rows[0].findings.some(finding => finding.code === "VARIATION"), false);
  assert.throws(() => comparePayrolls(current, month("06/2026", [record("1")]), []), /3 meses anteriores/);
  for (const basis of ["gross", "baseSalary"]) assert.throws(() => comparePayrolls(current, prior, [], { ...defaultAuditRules, basis } as AuditRules), /sempre sobre o líquido/);
});

test("net pay compares each available prior month without averaging or filling calendar gaps", () => {
  const current = month("10/2026", [record("1", { gross: 3500, deductions: 500, liquid: 3000 }), record("2")]);
  const previous = [month("09/2026", [record("1"), record("2")]), month("08/2026", [record("1", { gross: 2100, deductions: 100, liquid: 2000 })]), month("07/2026", [record("1", { liquid: null })]), month("06/2026", [record("1", { liquid: 100 })]), month("11/2026", [record("1", { liquid: 9999 })])];
  const before = JSON.stringify([current, previous]);
  const result = comparePayrollHistory(current, previous, [employee("1"), employee("2")]);
  const row = result.rows.find(row => row.cpf === "1")!;
  assert.equal(row.previousValue, 3000);
  assert.equal(row.difference, 0);
  assert.equal(result.summary.previousTotal, 6000);
  assert.equal(row.severity, "ATENCAO");
  assert.deepEqual(row.liquidComparisons.map(item => item.competence), ["09/2026", "08/2026", "07/2026"]);
  assert.equal(row.liquidComparisons[1].difference, 1000);
  assert.equal(row.liquidComparisons[1].variation, 50);
  assert.equal(row.liquidComparisons[2].difference, null);
  assert.ok(row.findings.some(finding => finding.code === "VARIATION:08/2026"));
  assert.equal(row.findings.some(finding => finding.code === "VARIATION"), false);
  assert.equal(result.rows.find(row => row.cpf === "2")!.liquidComparisons[1].value, null, "A missing CPF is not zero.");
  assert.equal(JSON.stringify([current, previous]), before);
  const gap = comparePayrollHistory(current, [previous[2], previous[3]], [employee("1"), employee("2")]);
  assert.deepEqual(gap.rows[0].liquidComparisons.map(item => item.competence), ["07/2026"]);
  const none = comparePayrollHistory(current, [previous[3]], [employee("1"), employee("2")]);
  assert.equal(none.summary.previousTotal, null);
  assert.equal(none.rows[0].liquidComparisons.length, 0);
});

test("every additional net reference contributes to the saved review revision", async () => {
  const current = month("10/2026", [record("1")]);
  const previous = month("09/2026", [record("1")]);
  const older = month("08/2026", [record("1")]);
  const first = await auditContext(current, previous, defaultAuditRules, [], [previous, older]);
  const reordered = await auditContext(current, previous, defaultAuditRules, [], [older, previous]);
  const reimported = await auditContext(current, previous, defaultAuditRules, [], [previous, { ...older, importedAt: "2026-10-09" }]);
  const narrowed = await auditContext(current, previous, defaultAuditRules, [], [previous]);
  assert.equal(first.revisionKey, reordered.revisionKey);
  assert.notEqual(first.revisionKey, reimported.revisionKey);
  assert.notEqual(first.revisionKey, narrowed.revisionKey);
  assert.equal(first.previousCompetence, "09/2026");
});
