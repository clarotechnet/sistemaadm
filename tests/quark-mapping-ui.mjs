// Fictional data and intercepted endpoints only; never calls Quark or the real RH DB.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = process.env.PLAYWRIGHT_PATH ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href) : await import("playwright");
const origin = process.env.MEAL_TEST_URL ?? "http://127.0.0.1:5176", host = "meal-preview.supabase.co";
const actor = "11111111-1111-4111-8111-111111111111", expires = Math.floor(Date.now() / 1000) + 3600;
const user = { id: actor, email: "rh@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const profile = { id: actor, email: user.email, full_name: "RH Teste", role: "ADMINISTRADOR", status: "ATIVO", department: "RH", job_title: "Analista" };
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, exp: expires })).toString("base64url")}.fictional`;
const session = { access_token: token, refresh_token: "fictional-refresh", expires_at: expires, expires_in: 3600, token_type: "bearer", user };
const targets = ["Natal", "Mossoró", "Fortaleza", "Recife", "João Pessoa", "Maceió"].map((name, index) => ({ id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`, name, city: name }));
const initial = [["9417839", "VNA TELECOM LTDA - NATAL", "Natal"], ["9417838", "VNA TELECOM LTDA - Mossoro", "Mossoró"], ["9417837", "RDT TELECOM LTDA - RECIFE", "Recife"], ["9417836", "RDT TELECOM LTDA - FORTALEZA", "Fortaleza"], ["9417834", "DMV DINIZ - RECIFE", "Recife"], ["9338112", "DMV DINIZ-NATAL", "Natal"], ["13852936", "DMV DINIZ - FORTALEZA", "Fortaleza"], ["13852937", "RDT TELECOM LTDA - JOAO PESSOA", "João Pessoa"], ["13852938", "RDT TELECOM LTDA - MACEIO", "Maceió"], ["14180910", "VNA TELECOM - Maceió", "Maceió"]];
const units = initial.map(([id, name, city]) => ({ external_unit_id: id, external_unit_name: name, target_unit_id: targets.find(target => target.city === city).id, sync_enabled: true, api_city: "NATAL", last_seen_at: "2026-11-10T12:00:00Z" }));
const teams = [{ external_unit_id: "9417839", external_team_id: "t1", external_team_name: "TECNICO", department: "TECNICO" }, { external_unit_id: "9417837", external_team_id: "t1", external_team_name: "COMERCIAL", department: "COMERCIAL" }];
const employees = teams.map((team, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, full_name: index ? "RECIFE TESTE" : "NATAL TESTE", cpf: index ? "11144477735" : "52998224725", document_number: "", registration: "", department: team.department, job_title: "Analista", status: "ATIVO", source: "QUARK", external_id: String(index + 1), external_unit_id: team.external_unit_id, external_unit_name: units.find(unit => unit.external_unit_id === team.external_unit_id).external_unit_name, external_team_id: "t1", external_team_name: team.external_team_name, mapped_unit_name: index ? "Recife" : "Natal", mapped_city: index ? "Recife" : "Natal", quark_mapping_pending: false, admission_date: null, termination_date: null, last_synced_at: "2026-11-10T12:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: "sb-meal-preview-auth-token", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: origin }]);
let legacy = false; const writes = [], errors = [], unexpected = [], passed = [];
await context.route("**/*", async route => {
 const request = route.request(), url = new URL(request.url());
 if (url.origin === origin) return route.continue();
 if (url.hostname !== host) { unexpected.push(url.origin); return route.abort(); }
 const table = url.pathname.split("/").at(-1), reply = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
 if (url.pathname === "/auth/v1/user") return reply(user);
 if (table === "profiles") return reply(profile);
 if (table === "system_settings") return reply({ mask_cpf: false, file_retention: "NONE", financial_tolerance: .01 });
 if (table === "employees") return reply(employees);
 if (table === "quark_unit_mappings") return reply(units);
 if (table === "quark_team_mappings") return reply(teams);
 if (table === "rh_unit_catalog") return reply(targets);
 if (table === "sync-quark-employees") {
  if (request.method() === "GET") return legacy ? reply({ error: "Método não permitido." }, 405) : reply({ ok: true, mappingVersion: 1 });
  const body = request.postDataJSON(); writes.push(body);
  if (body.action === "discover") {
   if (!units.some(unit => unit.external_unit_id === "99900000")) units.push({ external_unit_id: "99900000", external_unit_name: "NOVA EMPRESA API", target_unit_id: null, sync_enabled: false, api_city: "NATAL", last_seen_at: "2026-11-10T12:00:00Z" });
   return reply({ ok: true, units: units.length });
  }
  assert.equal(body.action, "save_mapping");
  if (body.kind === "unit") {
   const unit = units.find(unit => unit.external_unit_id === body.data.unit); unit.target_unit_id = body.data.target || null; unit.sync_enabled = body.data.enabled;
   const target = targets.find(target => target.id === unit.target_unit_id);
   for (const employee of employees.filter(employee => employee.external_unit_id === unit.external_unit_id)) { employee.mapped_unit_name = target?.name ?? ""; employee.mapped_city = target?.city ?? ""; }
   return reply({ ok: true, employees: 1 });
  }
  if (body.kind === "team") {
   const team = teams.find(team => team.external_unit_id === body.data.unit && team.external_team_id === body.data.team); team.department = body.data.department || null;
   for (const employee of employees.filter(employee => employee.external_unit_id === team.external_unit_id)) employee.department = team.department || employee.external_team_name;
   return reply({ ok: true, employees: 1 });
  }
  if (body.kind === "create_unit") { const row = { id: "22222222-2222-4222-8222-999999999999", name: body.data.name, city: body.data.city }; targets.push(row); return reply({ ok: true, id: row.id }); }
 }
 if (table === "user_presence" || table === "audit_logs") return reply({});
 if (request.method() !== "GET") unexpected.push(request.method() + " " + table);
 return reply([]);
});
const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
const modal = () => page.getByRole("dialog", { name: "Mapeamentos QuarkRH → RH", exact: true });
async function open() { await page.goto(origin + "/documents"); await page.getByRole("button", { name: "Funcionários", exact: true }).click(); await page.getByRole("button", { name: "Mapear setores e unidades", exact: true }).click(); }
try {
 await mkdir("tmp/quark-mapping-qa", { recursive: true }); await open();
 await modal().getByRole("checkbox", { name: "Incluir RDT TELECOM LTDA - JOAO PESSOA na sincronização", exact: true }).waitFor();
 assert.equal(await modal().getByRole("checkbox", { checked: true }).count(), 10); assert.equal(writes.length, 0);
 await modal().getByLabel("Pesquisar mapeamentos").fill("13852937");
 const include = modal().getByRole("checkbox"); await include.uncheck();
 await modal().getByRole("button", { name: "Salvar unidade RDT TELECOM LTDA - JOAO PESSOA", exact: true }).click();
 await page.waitForFunction(() => document.querySelector('[aria-label="Salvar unidade RDT TELECOM LTDA - JOAO PESSOA"]')?.disabled);
 assert.equal(units.find(unit => unit.external_unit_id === "13852937").sync_enabled, false); assert.equal(employees.length, 2);
 passed.push("ten authorized units are visible; excluding a new unit preserves employee rows");
 await modal().getByLabel("Pesquisar mapeamentos").fill("");
 await modal().getByRole("button", { name: "Atualizar lista do QuarkRH", exact: true }).click();
 await modal().getByText("NOVA EMPRESA API", { exact: true }).waitFor();
 assert.equal(units.at(-1).sync_enabled, false); assert.equal(writes.some(body => !body.action), false);
 await modal().getByRole("button", { name: "Cadastrar unidade do RH", exact: true }).click();
 await modal().getByLabel("Nome da unidade no RH").fill("Operação Especial"); await modal().getByLabel("Cidade da operação").fill("São Gonçalo do Amarante");
 await modal().getByRole("button", { name: "Cadastrar unidade", exact: true }).click();
 await modal().getByLabel("Vincular VNA TELECOM LTDA - NATAL", { exact: true }).selectOption("22222222-2222-4222-8222-999999999999");
 await modal().getByRole("button", { name: "Salvar unidade VNA TELECOM LTDA - NATAL", exact: true }).click();
 await page.waitForFunction(() => [...document.querySelectorAll('.documents-surface td')].some(cell => cell.textContent.includes('Operação Especial')));
 assert.equal(employees[0].mapped_city, "São Gonçalo do Amarante"); assert.equal(employees[0].external_unit_name, "VNA TELECOM LTDA - NATAL");
 passed.push("discovery adds excluded units without importing staff; custom RH destinations apply while raw Quark names remain intact");
 await modal().getByRole("tab", { name: "Setores / Equipes", exact: true }).click();
 await modal().getByLabel("Setor 9417839 t1", { exact: true }).fill("Instalação especializada");
 await modal().getByRole("button", { name: "Salvar setor 9417839 t1", exact: true }).click();
 await page.waitForFunction(() => document.querySelector('[aria-label="Salvar setor 9417839 t1"]')?.disabled);
 assert.equal(employees[0].department, "Instalação especializada"); assert.equal(employees[1].department, "COMERCIAL");
 passed.push("team rules apply only to the chosen unit, including teams sharing an external ID");
 await modal().getByRole("tab", { name: "Unidades", exact: true }).click();
 await page.waitForFunction(() => !document.querySelector('[aria-label="Fechar mapeamentos"]')?.disabled);
 await page.screenshot({ path: "tmp/quark-mapping-qa/desktop.png" });
 await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
 assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
 await page.screenshot({ path: "tmp/quark-mapping-qa/mobile.png" });
 await modal().getByRole("button", { name: "Fechar mapeamentos", exact: true }).click();
 const before = writes.length; legacy = true; await open();
 await modal().getByRole("alert").getByText(/Atualize a função/).waitFor();
 assert.equal(await modal().getByRole("button", { name: "Atualizar lista do QuarkRH", exact: true }).isDisabled(), true); assert.equal(writes.length, before);
 passed.push("mobile dark layout fits; a legacy function is detected by read-only GET and cannot accidentally start a sync");
 assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
 console.log(JSON.stringify({ passed, writes: writes.length, pageErrors: errors, unexpectedNetwork: unexpected }, null, 2));
} finally { await context.close(); await browser.close(); }
