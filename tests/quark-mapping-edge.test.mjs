import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
test("actual employee handler discovers all units, imports only enabled units and rejects unauthorized mapping actions", async () => {
 let source = await readFile("supabase/functions/sync-quark-employees/index.ts", "utf8");
 source = source.replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";', "").replace("npm:@supabase/supabase-js@2.114.0", import.meta.resolve("@supabase/supabase-js"));
 for (const file of ["date-utils", "employee-registration", "catalog", "request"]) source = source.replace(`./${file}.ts`, new URL(`../supabase/functions/sync-quark-employees/${file}.ts`, import.meta.url).href);
 const oldFetch = globalThis.fetch, oldDeno = globalThis.Deno;
 const actor = "11111111-1111-4111-8111-111111111111", run = "22222222-2222-4222-8222-222222222222";
 let handler, role = "RH", failure = false, complete, discovery, saved;
 const calls = [], env = { SUPABASE_URL: "https://mapping-edge.example.invalid", SUPABASE_ANON_KEY: "fictional", SUPABASE_SERVICE_ROLE_KEY: "fictional-service", QUARK_API_URL: "https://quark.example.invalid", QUARK_AUTH_TOKEN: "fictional-quark", QUARK_UNIT_IDS: "obsolete-unit-must-not-override-db" };
 globalThis.Deno = { env: { get: name => env[name] }, serve: callback => { handler = callback; } };
 globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)), method = init?.method ?? "GET";
  calls.push({ path: url.pathname, method, unit: new Headers(init?.headers).get("Unidade-ID") });
  if (url.hostname === "mapping-edge.example.invalid") {
   if (url.pathname === "/auth/v1/user") return Response.json({ id: actor });
   if (url.pathname.endsWith("profiles")) return Response.json({ full_name: "RH Teste", role, status: "ATIVO" });
   if (url.pathname.endsWith("employee_sync_runs")) return method === "POST" ? Response.json({ id: run }) : new Response(null, { status: 204 });
   if (url.pathname.endsWith("quark_unit_mappings")) return Response.json([{ external_unit_id: "9417839", external_unit_name: "VNA NATAL" }, { external_unit_id: "13852937", external_unit_name: "RDT JOAO PESSOA" }]);
   if (url.pathname.endsWith("discover_quark_rh_units")) { discovery = JSON.parse(init.body); return Response.json(3); }
   if (url.pathname.endsWith("save_quark_rh_mapping")) { saved = JSON.parse(init.body); return Response.json({ employees: 1 }); }
   if (url.pathname.endsWith("complete_quark_rh_sync")) { complete = JSON.parse(init.body); return Response.json({ created: 1, updated: 1, linked: 0, received: 3, skipped: 1, conflicts: 0, unmapped: 1 }); }
  }
  if (url.hostname === "quark.example.invalid") {
   if (url.pathname.endsWith("/unidades")) return Response.json({ dados: [{ id: "9417839", nomeFantasia: "VNA NATAL" }, { id: "13852937", nomeFantasia: "RDT JOAO PESSOA" }, { id: "99900000", nomeFantasia: "Nova empresa não selecionada" }] });
   if (url.pathname.endsWith("/colaboradores/")) {
    const unit = new Headers(init.headers).get("Unidade-ID"); assert.notEqual(unit, "99900000");
    if (failure && unit === "13852937") return new Response("private error details", { status: 503 });
    return Response.json({ dados: [{ id: unit === "9417839" ? "old" : "current", pessoa: { nome: "Pessoa Transferida", cpfCnpj: "52998224725" }, ativo: unit !== "9417839", equipe: { id: "t1", denominacao: "TECNICO" } }, ...(unit === "9417839" ? [{ id: "other", pessoa: { nome: "Pessoa Teste", cpfCnpj: "11144477735" }, ativo: true, equipe: { id: "t2", denominacao: "COMERCIAL" } }] : [])] });
   }
  }
  throw new Error("Unexpected mock endpoint " + url.origin + url.pathname);
 };
 try {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
  const request = (body = {}, method = "POST", auth = true) => handler(new Request("https://mapping-edge.example.invalid/functions/v1/sync-quark-employees", { method, headers: { ...(auth ? { Authorization: "Bearer fictional-user" } : {}), "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }));
  assert.equal((await request({}, "GET", false)).status, 401);
  role = "CONSULTA"; assert.equal((await request({ action: "save_mapping" })).status, 403); role = "RH";
  assert.equal((await (await request({}, "GET")).json()).mappingVersion, 1);
  assert.equal(calls.some(call => call.path.includes("quark_rh") || call.path.includes("colaboradores")), false);
  assert.equal((await request({ action: "discover" })).status, 200); assert.equal(discovery.p_units.length, 3);
  assert.equal(calls.some(call => call.path.includes("colaboradores")), false);
  assert.equal((await request({ action: "save_mapping", kind: "unit", data: { unit: "13852937", target: "x", enabled: true }, actor: "forged" })).status, 200);
  assert.equal(saved.p_actor, actor);
  const result = await request(); assert.equal(result.status, 200); assert.equal((await result.json()).runId, run);
  assert.equal(complete.p_received, 3); assert.equal(complete.p_records.length, 2);
  assert.equal(complete.p_records.find(row => row.cpf === "52998224725").external_unit_id, "13852937");
  assert.equal(complete.p_actor, actor);
  complete = undefined; failure = true;
  assert.equal((await request()).status, 502); assert.equal(complete, undefined);
 } finally { globalThis.fetch = oldFetch; if (oldDeno === undefined) delete globalThis.Deno; else globalThis.Deno = oldDeno; }
});
