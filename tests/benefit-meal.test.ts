import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { buildMealRows, defaultMealPeriod, mealBenefitMonth, mealCalculationNote, mealCity, mealDailyRate, mealDays, mealPeriod, mealRateGroup, mealRateRule, mealToday, type MealCoverage, type MealEmployee, type MealEvent } from "../supabase/functions/_shared/meal-domain.ts";
import { createMealRequester, extractMealAbsences, extractMealMedical, fetchMealUnit, mealDuration } from "../supabase/functions/sync-benefit-meal/quark.ts";
import { buildMealReportXlsx } from "../src/services/benefit-meal-export";
import type { MealRun } from "../src/services/benefit-meal";

const bounds = { start: "2026-10-26", end: "2026-11-25" };
const employee: MealEmployee = { id: "11111111-1111-4111-8111-111111111111", full_name: "Ana Teste", cpf: "00000000001", department: "TÉCNICA AFASTADO", job_title: "Técnica de instalação", status: "ATIVO", external_id: "1", external_unit_id: "u1", external_unit_name: "VNA TELECOM LTDA - NATAL" };
const coverage: MealCoverage = { unit_id: "u1", absence_ok: true, medical_ok: true, issues: [], employee_issues: {} };
const event = (kind: "FALTA" | "ATESTADO", start: string, end = start, source = start): MealEvent => ({ employee_id: employee.id, event_type: kind, source_id: source, start_date: start, end_date: end, hours: null });

test("26 October to 25 November funds December, not November or a 30-day month", () => {
  assert.deepEqual(mealPeriod(bounds.start, bounds.end), { ...bounds, benefitMonth: "2026-12" });
  assert.deepEqual(defaultMealPeriod(new Date("2026-11-09T12:00:00Z")), { ...bounds, benefitMonth: "2026-12" });
  assert.equal(defaultMealPeriod(new Date("2026-11-25T12:00:00Z")).end, "2026-11-25");
  assert.equal(defaultMealPeriod(new Date("2026-11-26T12:00:00Z")).end, "2026-12-25");
  assert.equal(mealBenefitMonth("2026-12-25"), "2027-01");
  assert.equal(mealToday(new Date("2026-11-10T01:00:00Z")), "2026-11-09");
  assert.throws(() => mealPeriod("2026-02-30", "2026-03-01"), /válidas/);
  assert.throws(() => mealPeriod(bounds.end, bounds.start), /anterior/);
  assert.throws(() => mealPeriod("2024-01-01", "2026-01-01"), /366/);
  assert.equal(mealDays("2024-02-28", "2024-03-01", { start: "2024-02-01", end: "2024-03-31" }).length, 3);
});

test("counts distinct calendar dates clipped to the selected interval and preserves all employees", () => {
  const events = [event("FALTA", "2026-10-26"), event("FALTA", "2026-10-26", undefined, "duplicate"), event("FALTA", "2026-10-25"), event("ATESTADO", "2026-11-24", "2026-11-28"), event("ATESTADO", "2026-11-24", "2026-11-25", "duplicate-medical")];
  const rows = buildMealRows([employee, { ...employee, id: "other", external_id: "2", status: "DESLIGADO" }], events, [coverage], bounds);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].absence_days, 1);
  assert.equal(rows[0].medical_days, 2);
  assert.equal(rows[0].deduction_days, 3);
  assert.equal(rows[1].absence_days, 0);
  assert.equal(rows[1].medical_days, 0);
  for (const row of rows) {
    for (const field of ["planned_work_days", "payable_days", "amount_due"] as const) assert.equal(row[field], null);
    assert.equal(row.daily_value, 25); assert.equal(row.calculation_status, "PENDING");
  }
});

test("unknown API responses never become zero and cross-type overlaps require review", () => {
  const [unknown] = buildMealRows([employee], [], [{ ...coverage, absence_ok: false }], bounds);
  assert.equal(unknown.absence_days, null); assert.equal(unknown.medical_days, 0); assert.equal(unknown.deduction_days, null);
  const [manual] = buildMealRows([{ ...employee, external_id: null }], [], [coverage], bounds);
  assert.equal(manual.absence_days, null); assert.equal(manual.medical_days, null);
  const [overlap] = buildMealRows([employee], [event("FALTA", "2026-11-01"), event("ATESTADO", "2026-11-01", "2026-11-03")], [coverage], bounds);
  assert.equal(overlap.overlap_days, 1); assert.equal(overlap.deduction_days, null); assert.match(overlap.issues.join(" "), /sobrepostos/);
  const [invalid] = buildMealRows([employee], [], [{ ...coverage, employee_issues: { [employee.id]: { medical: "invalid dates" } } }], bounds);
  assert.equal(invalid.medical_days, null);
});

test("approved rates recognize city, sector and job without assigning technical support to the technical band", () => {
  assert.equal(mealRateGroup("NATAL", "TECNICO DE CAMPO ADS E SERV"), "TECNICO");
  assert.equal(mealRateGroup("MOSSORÓ", "TÉCNICA AFASTADO"), "TECNICO");
  assert.equal(mealRateGroup("FORTALEZA", "COMERCIAL PAP"), "GERAL");
  assert.equal(mealRateGroup("RECIFE", "TECNICO"), "RECIFE_TECNICO");
  assert.equal(mealRateGroup("RECIFE", "SUPORTE"), "REGRA_PENDENTE");
  assert.equal(mealRateGroup("NATAL", ""), "SETOR_PENDENTE");
  assert.equal(mealCity("DMV MOSSORO"), "MOSSORÓ");
  assert.equal(mealCity("RDT - FORTALEZA"), "FORTALEZA");
  assert.equal(mealCity("DMV RECIFE"), "RECIFE");
  assert.equal(mealCity("Filial - Parnamirim"), "PARNAMIRIM");
  assert.equal(mealCity("Filial - Panamirim"), "PARNAMIRIM");
  assert.equal(mealCity("unidade sem cidade"), "NÃO IDENTIFICADA");
  for (const city of ["Natal", "Mossoró", "Parnamirim", "Panamirim", "Fortaleza"]) {
    for (const job of ["TÉCNICO DE INSTALAÇÃO", "Técnica", "Auxiliar de instalação", "Supervisor técnico", "Supervisora de técnicos"]) assert.equal(mealRateRule(city, "", job).dailyCents, 2500);
    assert.equal(mealRateRule(city, "SUPORTE TECNICO", "ANALISTA DE SUPORTE TECNICO").dailyCents, 2000);
    assert.equal(mealRateRule(city, "COMERCIAL", "CONSULTOR DE VENDAS").dailyCents, 2000);
  }
  assert.equal(mealRateRule("RECIFE", "TECNICA").dailyCents, 2858);
  assert.deepEqual(mealRateRule("RECIFE", "RH/DP"), { group: "RECIFE_ESTOQUE_RH", dailyCents: 2300, fixedDays: 22 });
  assert.deepEqual(mealRateRule("RECIFE", "ESTOQUE"), mealRateRule("RECIFE", "RH/DP"));
  for (const city of ["RECIFE", "JOÃO PESSOA", "MACEIÓ"]) {
    for (const job of ["CONSULTOR DE VENDAS - PAP", "SUPERVISOR DE VENDAS", "CONSULTORA DE VENDAS"]) assert.equal(mealRateRule(city, "COMERCIAL", job).dailyCents, 2000);
  }
  assert.equal(mealRateRule("MACEIÓ", "TECNICA").dailyCents, null);
  assert.equal(mealRateRule("JOÃO PESSOA", "RH").dailyCents, null);
});

test("Recife stock/RH has a fixed 22-day base and temporarily deducts both absences and medical dates", () => {
  const person = { ...employee, external_unit_name: "DMV - RECIFE", department: "RH/DP", job_title: "Analista de RH" };
  const [row] = buildMealRows([person], [event("FALTA", "2026-11-01"), event("ATESTADO", "2026-11-02", "2026-11-03")], [coverage], bounds);
  assert.equal(row.daily_value, 23); assert.equal(row.planned_work_days, 22);
  assert.equal(row.deduction_days, 3); assert.equal(row.payable_days, 19); assert.equal(row.amount_due, 437);
  assert.equal(row.calculation_status, "READY"); assert.deepEqual(row.calculation_notes, []);
  const [full] = buildMealRows([person], [], [coverage], bounds); assert.equal(full.amount_due, 506);
  const [zero] = buildMealRows([person], [event("ATESTADO", bounds.start, bounds.end)], [coverage], bounds);
  assert.equal(zero.payable_days, 0); assert.equal(zero.amount_due, 0); assert.equal(zero.calculation_status, "READY");
  const [daily] = buildMealRows([{ ...person, department: "TECNICA", job_title: "Técnico" }], [], [coverage], bounds);
  assert.equal(daily.daily_value, 28.58); assert.equal(daily.planned_work_days, null); assert.equal(daily.amount_due, null);
});

test("no final payment is guessed for open periods, unavailable sources, overlapping events or unconfirmed eligibility", () => {
  const person = { ...employee, external_unit_name: "DMV - RECIFE", department: "ESTOQUE", job_title: "Estoquista" };
  const variants = [
    buildMealRows([person], [], [coverage], { start: bounds.start, end: "2026-11-09" }, { periodEnd: bounds.end })[0],
    buildMealRows([person], [], [{ ...coverage, medical_ok: false }], bounds)[0],
    buildMealRows([person], [event("FALTA", "2026-11-01"), event("ATESTADO", "2026-11-01")], [coverage], bounds)[0],
    buildMealRows([{ ...person, status: "DESLIGADO" }], [], [coverage], bounds)[0],
  ];
  for (const row of variants) { assert.equal(row.daily_value, 23); assert.equal(row.payable_days, null); assert.equal(row.amount_due, null); assert.equal(row.calculation_status, "PENDING"); assert.ok(row.calculation_notes?.length); }
  assert.match(mealCalculationNote({ ...variants[0], calculation_version: null, calculation_status: null, calculation_notes: [] }), /Consulta anterior sem cálculo/);
});

test("current-rate references never overwrite saved daily values, legacy totals or historical views", () => {
  const [current] = buildMealRows([employee], [], [coverage], bounds);
  const legacy = { ...current, daily_value: null, calculation_version: null, calculation_status: null };
  assert.deepEqual(mealDailyRate(legacy, true), { value: 25, preview: true });
  assert.deepEqual(mealDailyRate(legacy), { value: null, preview: false });
  assert.equal(legacy.daily_value, null); assert.equal(legacy.amount_due, null);
  assert.deepEqual(mealDailyRate({ ...legacy, daily_value: 19 }, true), { value: 19, preview: false });
  assert.deepEqual(mealDailyRate({ ...current, daily_value: null }, true), { value: null, preview: false });
});

test("Quark daily absences preserve boundaries and source identities, not employee names", () => {
  const map = new Map([["1", employee.id]]);
  const parsed = extractMealAbsences({ content: [{ colaborador: { id: 1 }, dias: [
    { dia: "26/10/2026", tipoDesconto: "FALTA", horasAusencia: "-08:00" },
    { dia: "26/10/2026", tipoDesconto: "FALTA", horasAusencia: "-08:00" },
    { dia: "25/10/2026", tipoDesconto: "FALTA", horasAusencia: "-08:00" },
    { dia: "25/11/2026", tipoDesconto: "FALTA", horasAusencia: "PT4H" },
    { dia: "26/11/2026", tipoDesconto: "FALTA", horasAusencia: "08:00" },
    { dia: "01/11/2026", tipoDesconto: "FALTA", horasAusencia: "00:00" },
  ] }] }, "u1", map, bounds);
  assert.equal(parsed.events.length, 2); assert.equal(parsed.events[0].hours, 8);
  assert.equal(parsed.events[1].end_date, bounds.end);
  assert.equal(mealDuration("08:70"), null); assert.equal(mealDuration(""), null); assert.equal(mealDuration("PT8H30M"), 510);
});

test("medical intervals preserve source dates and never save diagnoses, CIDs or private attachments", () => {
  const map = new Map([["1", employee.id]]);
  const parsed = extractMealMedical([{ id: "medical", colaborador: { id: 1 }, dataAtestado: "2026-10-25", dataTerminoAtestado: "2026-10-27", totalDias: 3, quantidadeHoras: 8, cid: "DO_NOT_KEEP", diagnostico: "PRIVATE" }], "u1", map, bounds);
  assert.equal(parsed.events.length, 1); assert.equal(parsed.events[0].start_date, "2026-10-25");
  assert.equal(parsed.events[0].hours, 8); assert.deepEqual(parsed.issues, {});
  assert.doesNotMatch(JSON.stringify(parsed), /DO_NOT_KEEP|PRIVATE/);
  const invalid = extractMealMedical([{ colaborador: { id: 1 }, dataAtestado: "2026-11-01", dataTerminoAtestado: "2026-02-30" }], "u1", map, bounds);
  assert.equal(invalid.events.length, 0); assert.ok(invalid.issues[employee.id]);
});

test("Espelho uses the working monthly requests, nested containers and all pages, clipping to the selected period", async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal((options?.headers as Record<string, string>)["Unidade-ID"], "u1");
    if (url.pathname.includes("espelho-ponto")) {
      const month = url.searchParams.get("inicio") === "01/10/2026" ? "10" : "11";
      assert.equal(url.searchParams.get("inicio"), `01/${month}/2026`); assert.equal(url.searchParams.get("fim"), month === "10" ? "31/10/2026" : "30/11/2026");
      const page = Number(url.searchParams.get("page"));
      const day = month === "10" ? page === 0 ? "2026-10-25" : "2026-10-26" : page === 0 ? "2026-11-01" : "2026-11-26";
      return Response.json({ totalPages: 2, espelhoDaUnidade: { colaboradores: [{ colaborador: { id: 1 }, dias: [{ dia: day, tipoDesconto: "FALTA", horasAusencia: "08:00" }] }] } });
    }
    return Response.json({ totalPages: 1, content: [] });
  };
  const requester = createMealRequester({ base: "https://quark.example.invalid", token: "fictional", fetcher, intervalMs: 0 });
  const result = await fetchMealUnit({ base: "https://quark.example.invalid", token: "fictional", unit: "u1", employees: new Map([["1", employee.id]]), bounds, requester });
  assert.equal(requests.length, 5); assert.equal(result.events.length, 2); assert.equal(result.coverage.absence_ok, true); assert.equal(result.coverage.medical_ok, true);
  assert.ok(result.events.some(event => event.start_date === "2026-11-01"), "ACTON's 1 November absence must survive a cross-month selection");
  const failed = await fetchMealUnit({ base: "https://quark.example.invalid", token: "fictional", unit: "u1", employees: new Map([["1", employee.id]]), bounds, fetcher: async input => String(input).includes("espelho-ponto") ? new Response("unavailable", { status: 503 }) : Response.json({ content: [] }) });
  assert.equal(failed.coverage.absence_ok, false); assert.equal(failed.coverage.medical_ok, true);
  const malformed = await fetchMealUnit({ base: "https://quark.example.invalid", token: "fictional", unit: "u1", employees: new Map([["1", employee.id]]), bounds, fetcher: async () => Response.json({ unexpected: "not zero" }) });
  assert.equal(malformed.coverage.absence_ok, false); assert.equal(malformed.coverage.medical_ok, false);
});

test("one queue serializes units and sources and honors Retry-After on 429", async () => {
  let clock = 0, active = 0, peak = 0;
  const calls: { path: string; at: number; unit: string | null }[] = [];
  const requester = createMealRequester({ base: "https://quark.example.invalid", token: "fictional", now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (input, init) => {
    active++; peak = Math.max(peak, active);
    calls.push({ path: new URL(String(input)).pathname, at: clock, unit: new Headers(init?.headers).get("Unidade-ID") });
    assert.equal(new Headers(init?.headers).get("User-Agent"), "RH-Control-Aggregation/2.0");
    await Promise.resolve(); active--;
    return calls.length === 1 ? new Response("quota", { status: 429, headers: { "Retry-After": "2" } }) : Response.json({ content: [] });
  } });
  await Promise.all([requester("/one", "u1"), requester("/two", "u2"), requester("/three", "u1")]);
  assert.equal(peak, 1); assert.deepEqual(calls.map(call => call.at), [0, 2000, 2500, 3000]);
  assert.deepEqual(calls.map(call => call.unit), ["u1", "u1", "u2", "u1"]);
});

test("429 retries stay bounded, auth failures do not try date variants and source errors remain explicit", async () => {
  let calls = 0, clock = 0;
  const requester = createMealRequester({ base: "https://quark.example.invalid", token: "fictional", now: () => clock, wait: async ms => { clock += ms; }, fetcher: async () => { calls++; return new Response("PRIVATE_DO_NOT_SAVE", { status: 429 }); } });
  await assert.rejects(requester("/limited", "u1"), /HTTP 429/); assert.equal(calls, 3);
  await assert.rejects(requester("/next-unit", "u2"), /HTTP 429/); assert.equal(calls, 6);
  assert.ok(clock >= 10000, "The last 429 cooldown must also apply to the next source/unit");
  calls = 0;
  const denied = createMealRequester({ base: "https://quark.example.invalid", token: "fictional", intervalMs: 0, fetcher: async input => { calls++; return String(input).includes("espelho-ponto") ? new Response("PRIVATE_DO_NOT_SAVE", { status: 403 }) : Response.json({ content: [] }); } });
  const result = await fetchMealUnit({ base: "https://quark.example.invalid", token: "fictional", unit: "u1", employees: new Map([["1", employee.id]]), bounds, requester: denied });
  assert.equal(calls, 2); assert.equal(result.coverage.absence_ok, false); assert.equal(result.coverage.medical_ok, true);
  assert.match(result.coverage.issues.join(" "), /HTTP 403.*espelho-ponto/); assert.doesNotMatch(JSON.stringify(result.coverage), /PRIVATE_DO_NOT_SAVE/);
  const rows = buildMealRows([employee], result.events, [result.coverage], bounds);
  assert.equal(rows[0].absence_days, null);
  let sent = false;
  const expired = createMealRequester({ base: "https://quark.example.invalid", token: "fictional", now: () => 10, deadline: 5, fetcher: async () => { sent = true; return Response.json([]); } });
  await assert.rejects(expired("/expired", "u1"), /Tempo limite/); assert.equal(sent, false);
});

test("branded XLSX preserves all rows, text CPF, real dates, numeric zero and unknown financial inputs", async () => {
  const run = { id: "fixture-run", period_start: bounds.start, period_end: bounds.end, benefit_month: "2026-12-01", queried_through: bounds.end, status: "SUCCESS", completed_at: "2026-11-25T15:00:00Z", triggered_by_name: "RH Teste", warnings: [] } as unknown as MealRun;
  const rows = buildMealRows(Array.from({ length: 61 }, (_, index) => ({ ...employee, id: String(index), full_name: index === 0 ? "=literal-name" : "Funcionário " + index, external_id: String(index) })), [], [coverage], bounds);
  const logo = new Uint8Array(await readFile(new URL("../public/logo-empresa-ui.png", import.meta.url)));
  const bytes = await buildMealReportXlsx({ run, rows, maskCpf: false, logo, filters: "Todos" });
  const book = XLSX.read(bytes, { type: "array", cellDates: false });
  const sheet = book.Sheets["Vale Alimentação"];
  assert.equal(sheet.A11.v, "=literal-name"); assert.equal(sheet.A11.t, "s"); assert.equal(sheet.A11.f, undefined);
  assert.equal(sheet.B11.t, "s"); assert.equal(String(sheet.B11.v).replace(/\D/g, ""), "00000000001");
  assert.equal(sheet.E11.v, 0); assert.equal(sheet.E11.t, "n"); assert.equal(sheet.P11.t, "n");
  assert.equal(sheet.H11?.v ?? null, null); assert.equal(sheet.K11?.v ?? null, null);
  assert.equal(sheet.J11.v, 25); assert.equal(sheet.J11.t, "n");
  assert.match(sheet["!ref"]!, /Q71$/);
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file("xl/media/logo.png")); assert.ok(zip.file("xl/drawings/drawing1.xml"));
  assert.match(await zip.file("xl/worksheets/sheet1.xml")!.async("text"), /ySplit="10"/);
  assert.match(await zip.file("xl/styles.xml")!.async("text"), /FF991B1B/);
  const [fixed] = buildMealRows([{ ...employee, department: "ESTOQUE", job_title: "Estoquista", external_unit_name: "RECIFE" }], [event("ATESTADO", bounds.start, bounds.end)], [coverage], bounds);
  const fixedBook = XLSX.read(await buildMealReportXlsx({ run, rows: [fixed], maskCpf: false, logo, filters: "Todos" }), { type: "array" });
  const fixedSheet = fixedBook.Sheets["Vale Alimentação"];
  assert.equal(fixedSheet.H11.v, 22); assert.equal(fixedSheet.I11.v, 0); assert.equal(fixedSheet.J11.v, 23); assert.equal(fixedSheet.K11.v, 0); assert.equal(fixedSheet.K11.t, "n");
  const legacy = { ...rows[0], daily_value: null, calculation_version: null, calculation_status: null };
  const referenceSheet = XLSX.read(await buildMealReportXlsx({ run, rows: [legacy], maskCpf: false, logo, filters: "Todos", currentRates: true }), { type: "array" }).Sheets["Vale Alimentação"];
  assert.equal(referenceSheet.J11.v, 25); assert.equal(referenceSheet.K11?.v ?? null, null); assert.match(referenceSheet.Q11.v, /Diária de referência/);
  const historySheet = XLSX.read(await buildMealReportXlsx({ run, rows: [legacy], maskCpf: false, logo, filters: "Todos" }), { type: "array" }).Sheets["Vale Alimentação"];
  assert.equal(historySheet.J11?.v ?? null, null); assert.doesNotMatch(historySheet.Q11.v, /Diária de referência/);
  assert.equal(legacy.daily_value, null);
});

test("persistence is additive, RH-only and service-only; browser never holds provider credentials", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261109181644_benefit_meal_period_snapshots.sql", import.meta.url), "utf8");
  for (const name of ["benefit_meal_runs", "benefit_meal_rows", "benefit_meal_events"]) assert.match(sql, new RegExp(`alter table public\\.${name} enable row level security`));
  assert.match(sql, /security invoker/); assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /from public,anon,authenticated/);
  assert.doesNotMatch(sql, /(?:update|delete from|alter table) public\.(?:employees|payroll_|benefit_aggregation)/i);
  const service = await readFile(new URL("../src/services/benefit-meal.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /QUARK_AUTH_TOKEN|SERVICE_ROLE|SECRET_KEY/);
  assert.doesNotMatch(service, /syncEmployeesFromQuark\(\)/);
});
