// Execute the actual Edge handler under Node with its runtime/API boundaries mocked.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

test("Edge verifies active RH, validates dates, paginates the whole registry and saves missing sources as unknown", async () => {
  const path = process.env.MEAL_EDGE_ENTRY ?? new URL("../supabase/functions/sync-benefit-meal/index.ts", import.meta.url);
  let source = await readFile(path, "utf8");
  source = source.replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";', "").replace("npm:@supabase/supabase-js@2.114.0", import.meta.resolve("@supabase/supabase-js")).replace("../_shared/meal-domain.ts", new URL("../supabase/functions/_shared/meal-domain.ts", import.meta.url).href).replace("./quark.ts", new URL("../supabase/functions/sync-benefit-meal/quark.ts", import.meta.url).href);
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const oldFetch = globalThis.fetch, oldDeno = globalThis.Deno;
  const actor = "11111111-1111-4111-8111-111111111111", run = "22222222-2222-4222-8222-222222222222";
  const employees = Array.from({ length: 1005 }, (_, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, full_name: `Pessoa teste ${index}`, cpf: String(index).padStart(11, "0"), department: "TECNICA", job_title: "Técnico", status: index % 2 ? "ATIVO" : "DESLIGADO", external_id: String(index), external_unit_id: "u1", external_unit_name: "Empresa - NATAL" }));
  const env = { SUPABASE_URL: "https://meal-edge.example.invalid", SUPABASE_ANON_KEY: "fictional-public", SUPABASE_SERVICE_ROLE_KEY: "fictional-service", QUARK_AUTH_TOKEN: "fictional-quark", QUARK_API_URL: "https://quark.example.invalid" };
  let handler, role = "RH", medicalFailure = false, saved;
  const calls = [];
  globalThis.Deno = { env: { get: key => env[key] }, serve: callback => { handler = callback; } };
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)), method = options?.method ?? "GET";
    calls.push({ path: url.pathname, method, offset: url.searchParams.get("offset") });
    if (url.hostname === "meal-edge.example.invalid") {
      if (url.pathname === "/auth/v1/user") return Response.json({ id: actor, email: "rh@example.invalid" });
      if (url.pathname.endsWith("/profiles")) return Response.json({ full_name: "RH Teste", role, status: "ATIVO" });
      if (url.pathname.endsWith("/employees")) { const offset = Number(url.searchParams.get("offset") ?? 0); return Response.json(employees.slice(offset, offset + Number(url.searchParams.get("limit") ?? 1000))); }
      if (url.pathname.endsWith("/benefit_meal_runs")) return method === "POST" ? Response.json({ id: run }, { status: 201 }) : new Response(null, { status: 204 });
      if (url.pathname.endsWith("/complete_benefit_meal_run")) { saved = JSON.parse(options.body); return Response.json(run); }
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
    assert.equal((await request({ start: "2026-02-30", end: "2026-10-25" })).status, 400);
    assert.equal((await request({ start: "2099-01-01", end: "2099-01-25" })).status, 400);
    const response = await request(); assert.equal(response.status, 200); assert.equal((await response.json()).runId, run);
    assert.equal(saved.p_actor, actor); assert.equal(saved.p_rows.length, 1005); assert.equal(saved.p_rows[0].absence_days, 0); assert.equal(saved.p_rows[0].medical_days, 0); assert.equal(saved.p_rows[0].amount_due, null);
    assert.ok(calls.some(call => call.path.endsWith("employees") && call.offset === "1000"));
    medicalFailure = true;
    assert.equal((await request()).status, 200);
    assert.equal(saved.p_rows[0].absence_days, 0); assert.equal(saved.p_rows[0].medical_days, null); assert.ok(saved.p_warnings.length);
    assert.equal(calls.some(call => call.path.includes("benefit_aggregation")), false);
  } finally { globalThis.fetch = oldFetch; if (oldDeno === undefined) delete globalThis.Deno; else globalThis.Deno = oldDeno; }
});
