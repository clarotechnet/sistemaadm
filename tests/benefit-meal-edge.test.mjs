// Execute the actual Edge handler under Node with its runtime/API boundaries mocked.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { mealRateDefinitions } from "../supabase/functions/_shared/meal-policy.ts";

test("Edge verifies active RH, validates dates, paginates the whole registry and saves missing sources as unknown", async () => {
  const path = process.env.MEAL_EDGE_ENTRY ?? new URL("../supabase/functions/sync-benefit-meal/index.ts", import.meta.url);
  let source = await readFile(path, "utf8");
  source = source.replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";', "").replace("npm:@supabase/supabase-js@2.114.0", import.meta.resolve("@supabase/supabase-js")).replace("../_shared/meal-domain.ts", new URL("../supabase/functions/_shared/meal-domain.ts", import.meta.url).href).replace("./quark.ts", new URL("../supabase/functions/sync-benefit-meal/quark.ts", import.meta.url).href);
  source = source.replace("../_shared/meal-policy.ts", new URL("../supabase/functions/_shared/meal-policy.ts", import.meta.url).href);
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const oldFetch = globalThis.fetch, oldDeno = globalThis.Deno;
  const actor = "11111111-1111-4111-8111-111111111111", run = "22222222-2222-4222-8222-222222222222";
  const employees = Array.from({ length: 1005 }, (_, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, full_name: `Pessoa teste ${index}`, cpf: String(index).padStart(11, "0"), department: "TECNICA", job_title: "Técnico", status: index % 2 ? "ATIVO" : "DESLIGADO", external_id: String(index), external_unit_id: "u1", external_unit_name: "Empresa - NATAL" }));
  Object.assign(employees[1004], { department: "RH", job_title: "Analista de RH", status: "ATIVO", external_unit_name: "Empresa - RECIFE" });
  const env = { SUPABASE_URL: "https://meal-edge.example.invalid", SUPABASE_ANON_KEY: "fictional-public", SUPABASE_SERVICE_ROLE_KEY: "fictional-service", QUARK_AUTH_TOKEN: "fictional-quark", QUARK_API_URL: "https://quark.example.invalid" };
  const rates = mealRateDefinitions.map((item, index) => ({ id: `55555555-5555-4555-8555-${String(index).padStart(12,'0')}`, revision:index+1, city:item.city,rate_group:item.group,effective_month:'2026-11-01',daily_value:item.initialCents/100,fixed_days:item.fixedDays,created_at:'2026-11-10T15:00:00Z',created_by_name:'Inicial',note:'' }));
  let handler, role = "RH", medicalFailure = false, missingRates = false, missingMapping = true, saved, rateChanges, insertedRun;
  const calls = [];
  globalThis.Deno = { env: { get: key => env[key] }, serve: callback => { handler = callback; } };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), method = options?.method ?? "GET";
    calls.push({ path: url.pathname, method, offset: url.searchParams.get("offset"), select: url.searchParams.get("select") });
    if (url.hostname === "meal-edge.example.invalid") {
      if (url.pathname === "/auth/v1/user") return Response.json({ id: actor, email: "rh@example.invalid" });
      if (url.pathname.endsWith("/profiles")) return Response.json({ full_name: "RH Teste", role, status: "ATIVO" });
      if (url.pathname.endsWith("/employees")) {
        if (missingMapping && url.searchParams.get("select").includes("mapped_city")) return Response.json({ code: "42703", message: "column mapped_city does not exist" }, { status: 400 });
        const offset = Number(url.searchParams.get("offset") ?? 0); return Response.json(employees.slice(offset, offset + Number(url.searchParams.get("limit") ?? 1000)));
      }
      if (url.pathname.endsWith("/benefit_meal_rate_versions")) return missingRates ? Response.json({ code: "42P01", message: "not installed" }, { status: 404 }) : Response.json([]);
      if (url.pathname.endsWith("/get_benefit_meal_rates")) return Response.json(rates);
      if (url.pathname.endsWith("/save_benefit_meal_rates")) { rateChanges=JSON.parse(options.body); return Response.json({saved:1,effectiveMonth:'2027-01-01'}); }
      if (url.pathname.endsWith("/benefit_meal_runs")) { if(method==='POST') insertedRun=JSON.parse(options.body); return method === "POST" ? Response.json({ id: run }, { status: 201 }) : new Response(null, { status: 204 }); }
      if (url.pathname.endsWith("/complete_benefit_meal_versioned_run")) { saved = JSON.parse(options.body); return Response.json(run); }
    }
    if (url.hostname === "quark.example.invalid") {
      assert.equal(new Headers(options.headers).get("Auth-Token"), "fictional-quark");
      if (url.pathname.endsWith("espelho-ponto")) { const month = url.searchParams.get("inicio") === "01/09/2026" ? "09" : "10"; assert.equal(url.searchParams.get("inicio"), `01/${month}/2026`); assert.equal(url.searchParams.get("fim"), month === "09" ? "30/09/2026" : "31/10/2026"); return Response.json({ totalPages: 1, content: [] }); }
      if (url.pathname.endsWith("atestado-medico")) return medicalFailure ? new Response("unavailable", { status: 503 }) : Response.json({ totalPages: 1, content: [] });
    }
    throw new Error("Unexpected endpoint in offline Edge test: " + url.origin + url.pathname);
  };
  try {
    await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
    const request = (body = { start: "2026-09-26", end: "2026-10-25" }, auth = true) => handler(new Request("https://meal-edge.example.invalid/functions/v1/sync-benefit-meal", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer fictional-jwt" } : {}) }, body: JSON.stringify(body) }));
    assert.equal((await request(undefined, false)).status, 401);
    role = "CONSULTA"; assert.equal((await request()).status, 403); assert.equal(calls.some(call => call.path.endsWith("employees")), false);
    role = "RH";
    const capability = await handler(new Request("https://meal-edge.example.invalid/functions/v1/sync-benefit-meal", { headers: { Authorization: "Bearer fictional-jwt" } }));
    assert.equal((await capability.json()).calculationVersion, 2);
    assert.equal(calls.some(call => call.method !== "GET" || call.path.endsWith("employees")), false);
    missingRates = true;
    assert.equal((await handler(new Request("https://meal-edge.example.invalid/functions/v1/sync-benefit-meal", { headers: { Authorization: "Bearer fictional-jwt" } }))).status, 503);
    assert.equal(calls.some(call => call.method !== "GET" || call.path.includes("espelho-ponto")), false);
    missingRates = false;
    assert.equal((await request({ start: "2026-02-30", end: "2026-10-25" })).status, 400);
    assert.equal((await request({ start: "2099-01-01", end: "2099-01-25" })).status, 400);
    const response = await request(); assert.equal(response.status, 200); assert.equal((await response.json()).runId, run);
    assert.equal(saved.p_actor, actor); assert.equal(saved.p_rows.length, 1005); assert.equal(saved.p_rows[0].absence_days, 0); assert.equal(saved.p_rows[0].medical_days, 0); assert.equal(saved.p_rows[0].amount_due, null);
    assert.equal(saved.p_rows[0].calculation_version,2); assert.ok(saved.p_rows[0].rate_version_id); assert.deepEqual(insertedRun.rate_version_ids,rates.map(item=>item.id));
    assert.equal(saved.p_rows[0].daily_value, 25); assert.equal(saved.p_rows[0].calculation_status, "PENDING");
    const fixed = saved.p_rows.find(row => row.employee_id === employees[1004].id);
    assert.equal(fixed.daily_value, 23); assert.equal(fixed.amount_due, 506); assert.equal(fixed.payable_days, 22); assert.equal(fixed.calculation_status, "READY");
    assert.ok(calls.some(call => call.path.endsWith("employees") && call.offset === "1000"));
    assert.equal(calls.filter(call => call.path.endsWith("employees")).length, 3);
    missingMapping = false;
    medicalFailure = true;
    assert.equal((await request()).status, 200);
    assert.equal(saved.p_rows[0].absence_days, 0); assert.equal(saved.p_rows[0].medical_days, null); assert.ok(saved.p_warnings.length);
    assert.equal(saved.p_rows.find(row => row.employee_id === employees[1004].id).amount_due, null);
    assert.equal(calls.some(call => call.path.includes("benefit_aggregation")), false);
    const sourceCalls=calls.filter(call=>/espelho-ponto|atestado-medico/.test(call.path)).length;
    env.QUARK_AUTH_TOKEN='';
    assert.equal((await request({action:'save_rates',actor:'spoofed',city:'NATAL',month:'2027-01',changes:[{group:'TECNICO',dailyCents:2700,fixedDays:null,expectedId:rates[0].id}],note:'Reajuste'})).status,200);
    assert.equal(rateChanges.p_actor,actor); assert.equal(rateChanges.p_month,'2027-01-01');
    assert.equal(calls.filter(call=>/espelho-ponto|atestado-medico/.test(call.path)).length,sourceCalls);
    role='CONSULTA'; assert.equal((await request({action:'save_rates',city:'NATAL',month:'2027-01',changes:[]})).status,403);
  } finally { globalThis.fetch = oldFetch; if (oldDeno === undefined) delete globalThis.Deno; else globalThis.Deno = oldDeno; }
});
