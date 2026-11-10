import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { collectQuarkPages, quarkList, quarkUnits, resolveQuarkDuplicates } from "../supabase/functions/sync-quark-employees/catalog.ts";
import { createEmployeeQuarkRequester } from "../supabase/functions/sync-quark-employees/request.ts";
import { buildMealRows, mealCity } from "../supabase/functions/_shared/meal-domain.ts";

test("catalog discovery preserves API names and billing cities without choosing the RH mapping", () => {
 const units = quarkUnits(quarkList({ cliente: {}, dados: [{ id: 13852937, nomeFantasia: "RDT TELECOM LTDA - JOAO PESSOA" }, { id: 14180910, nomeFantasia: "VNA TELECOM - Maceió", cidade: "NATAL" }] }));
 assert.deepEqual(units, [{ id: "13852937", name: "RDT TELECOM LTDA - JOAO PESSOA", city: "" }, { id: "14180910", name: "VNA TELECOM - Maceió", city: "NATAL" }]);
 assert.deepEqual(quarkList({ cliente: {}, dados: [] }), []);
 assert.throws(() => quarkList({ error: "wrong response" }), /sem lista/);
 assert.throws(() => quarkList({ dados: ["invalid"] }), /inválidos/);
});
test("employee pagination reads every page and rejects a repeated page instead of dropping people", async () => {
 let calls = 0;
 const result = await collectQuarkPages(async query => { calls++; const page = Number(new URLSearchParams(query).get("page")); return { dados: Array.from({ length: page === 1 ? 100 : 2 }, (_, index) => ({ id: (page - 1) * 100 + index })) }; });
 assert.equal(calls, 2); assert.equal(result.length, 102);
 await assert.rejects(collectQuarkPages(async () => ({ dados: Array.from({ length: 100 }, (_, index) => ({ id: index })) })), /repetiu uma página/);
});
test("CPF transfers prefer the sole active employment and ambiguous active records are preserved as conflicts", () => {
 const base = { cpf: "52998224725", external_id: "old", external_unit_id: "9417837", status: "DESLIGADO" as const };
 const current = { ...base, external_id: "new", external_unit_id: "13852937", status: "ATIVO" as const };
 const moved = resolveQuarkDuplicates([base, current]); assert.deepEqual(moved.records, [current]); assert.equal(moved.conflicts, 0);
 const ambiguous = resolveQuarkDuplicates([current, { ...current, external_id: "second", external_unit_id: "14180910" }]);
 assert.equal(ambiguous.records.length, 0); assert.equal(ambiguous.conflicts, 1);
 assert.equal(resolveQuarkDuplicates([current, current]).records.length, 1);
 assert.equal(resolveQuarkDuplicates([{ ...base, cpf: "" }, { ...current, cpf: "" }]).records.length, 2);
});
test("employee requests are paced, respect rate limits and keep private response bodies out of errors", async () => {
 let clock = 0, calls = 0; const starts: number[] = [];
 const request = createEmployeeQuarkRequester({ base: "https://quark.example.invalid", token: "fictional", deadline: 20000, now: () => clock, wait: async ms => { clock += ms; }, fetcher: async (_input, init) => {
  assert.equal(new Headers(init?.headers).get("Auth-Token"), "fictional"); starts.push(clock); calls++;
  return calls === 1 ? new Response("private", { status: 429, headers: { "Retry-After": "2" } }) : Response.json({ dados: [] });
 } });
 await request("/v1/unidades"); await request("/v1/colaboradores/", "13852937"); assert.deepEqual(starts, [0, 2000, 3200]);
 const denied = createEmployeeQuarkRequester({ base: "https://quark.example.invalid", token: "fictional", deadline: Date.now() + 20000, fetcher: async () => new Response("PRIVATE_MEDICAL_OR_ID_DATA", { status: 403 }) });
 await assert.rejects(denied("/v1/unidades"), error => error instanceof Error && /HTTP 403/.test(error.message) && !error.message.includes("PRIVATE"));
});
test("new cities and explicitly mapped operational cities reach meal filters without inventing rates", () => {
 assert.equal(mealCity("RDT TELECOM LTDA - JOAO PESSOA"), "JOÃO PESSOA"); assert.equal(mealCity("VNA TELECOM - Maceió"), "MACEIÓ");
 const [row] = buildMealRows([{ id: "fake", full_name: "Pessoa Teste", cpf: "", department: "TECNICO", job_title: "Técnico", status: "ATIVO", external_id: "1", external_unit_id: "14180910", external_unit_name: "VNA TELECOM - Maceió", mapped_city: "Maceió" }], [], [], { start: "2026-10-26", end: "2026-11-10" });
 assert.equal(row.city, "MACEIÓ"); assert.equal(row.rate_group, "REGRA_PENDENTE"); assert.equal(row.daily_value, null); assert.equal(row.amount_due, null);
});
test("mapping RPCs are service-only invokers and the old fixed unit secret no longer overrides user choices", async () => {
 const sql = await readFile("supabase/migrations/20261110112827_quark_unit_team_mapping.sql", "utf8");
 assert.doesNotMatch(sql, /security definer/i); assert.match(sql, /from public,anon,authenticated/);
 const edge = await readFile("supabase/functions/sync-quark-employees/index.ts", "utf8");
 assert.doesNotMatch(edge, /QUARK_UNIT_IDS|defaultUnits/); assert.match(edge, /eq\("sync_enabled", true\)/);
 assert.match(edge, /mappingVersion: 1/); assert.match(edge, /complete_quark_rh_sync/);
});
