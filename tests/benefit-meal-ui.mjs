// Browser integration with fictional people, intercepted Auth/DB/Edge APIs only.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { buildMealRows } from "../supabase/functions/_shared/meal-domain.ts";
const { chromium } = process.env.PLAYWRIGHT_PATH ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href) : await import("playwright");
const origin = process.env.MEAL_TEST_URL ?? "http://127.0.0.1:5176", host = "meal-preview.supabase.co";
const actor = "11111111-1111-4111-8111-111111111111", expires = Math.floor(Date.now() / 1000) + 3600;
const user = { id: actor, email: "rh@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const profile = { id: actor, email: user.email, full_name: "RH Teste", role: "ADMINISTRADOR", status: "ATIVO", department: "RH", job_title: "Analista" };
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, exp: expires, iat: expires - 3600 })).toString("base64url")}.fictional-signature`;
const session = { access_token: token, refresh_token: "fictional-refresh", expires_at: expires, expires_in: 3600, token_type: "bearer", user };
const period = { start: "2026-10-26", end: "2026-11-25" };
const employees = Array.from({ length: 61 }, (_, index) => ({ id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`, full_name: index === 0 ? "ANA TESTE" : "FUNCIONARIO TESTE " + String(index).padStart(3, "0"), cpf: String(index + 1).padStart(11, "0"), department: index % 2 ? "COMERCIAL" : "TECNICO DE CAMPO ADS E SERV", job_title: "TÉCNICO DE INSTALAÇÃO E SUPORTE", status: index % 9 === 0 ? "DESLIGADO" : "ATIVO", external_id: String(index + 1), external_unit_id: "u1", external_unit_name: index % 4 === 0 ? "DMV - RECIFE" : "VNA TELECOM LTDA - NATAL", source: "QUARK", external_team_name: "", external_team_id: null, document_number: "", registration: "", admission_date: null, termination_date: null, last_synced_at: "2026-11-01T12:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-11-01T12:00:00Z" }));
const runs = [], stored = new Map(), storedEvents = new Map(), errors = [], unexpected = [], calls = [], passed = [];
let version = 0, missingSchema = false, syncFailure = false;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await context.addCookies([{ name: "sb-meal-preview-auth-token", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: origin }]);
await context.route("**/*", async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin === origin) return route.continue();
  if (url.hostname !== host) { unexpected.push(url.origin + url.pathname); return route.abort(); }
  const table = url.pathname.split("/").at(-1), reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const filtered = (rows, key) => !url.searchParams.has(key) ? rows : rows.filter(row => "eq." + row[key] === url.searchParams.get(key));
  const slice = rows => rows.slice(Number(url.searchParams.get("offset") ?? 0), Number(url.searchParams.get("offset") ?? 0) + Number(url.searchParams.get("limit") ?? rows.length));
  let body = [];
  if (url.pathname === "/auth/v1/user") body = user;
  else if (table === "profiles") body = profile;
  else if (table === "system_settings") body = { mask_cpf: false, file_retention: "NONE", financial_tolerance: .01 };
  else if (table === "employees") body = slice(employees);
  else if (table === "benefit_meal_runs") {
    if (missingSchema) return reply({ code: "PGRST205", message: "not installed" }, 404);
    body = slice(["period_start", "period_end", "benefit_month"].reduce((data, key) => filtered(data, key), [...runs].reverse()));
  } else if (table === "benefit_meal_rows") {
    const id = url.searchParams.get("run_id")?.replace("eq.", ""); body = slice(stored.get(id) ?? []);
  } else if (table === "benefit_meal_events") {
    const id = url.searchParams.get("run_id")?.replace("eq.", ""); body = filtered(storedEvents.get(id) ?? [], "snapshot_employee_id");
  } else if (table === "sync-quark-employees") { calls.push(table); body = { runId: "employee-run", units: 2, received: 61, created: 0, updated: 61, linked: 0, skipped: 0 }; }
  else if (table === "sync-benefit-meal") {
    calls.push(table); const input = req.postDataJSON(); assert.deepEqual(input, period);
    if (syncFailure) return reply({ error: "QuarkRH indisponível. Última consulta preservada." }, 502);
    const id = `44444444-4444-4444-8444-${String(++version).padStart(12, "0")}`;
    const events = [{ employee_id: employees[0].id, event_type: "FALTA", source_id: "espelho:u1:1:2026-11-01", start_date: "2026-11-01", end_date: "2026-11-01", hours: 8 }, ...(version > 1 ? [{ employee_id: employees[0].id, event_type: "FALTA", source_id: "espelho:u1:1:2026-11-02", start_date: "2026-11-02", end_date: "2026-11-02", hours: 8 }] : [])];
    const coverage = [{ unit_id: "u1", absence_ok: true, medical_ok: true, issues: [], employee_issues: {} }];
    runs.push({ id, period_start: input.start, period_end: input.end, benefit_month: "2026-12-01", queried_through: input.end, status: "SUCCESS", triggered_by_name: "RH Teste", started_at: `2026-11-25T1${version}:00:00Z`, completed_at: `2026-11-25T1${version}:01:00Z`, employee_count: employees.length, coverage, warnings: [], error_message: null });
    stored.set(id, buildMealRows(employees, events, coverage, period).map(row => ({ ...row, run_id: id, snapshot_employee_id: row.employee_id })));
    storedEvents.set(id, events.map((event, index) => ({ ...event, id: index, run_id: id, snapshot_employee_id: event.employee_id })));
    body = { ok: true, runId: id, rows: employees.length };
  } else if (table === "user_presence") body = {};
  else if (req.method() !== "GET" && table !== "audit_logs") { unexpected.push(req.method() + " " + table); return route.abort(); }
  return reply(body);
});
const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
const panel = () => page.locator(".meal-benefit"), table = () => panel().locator(".meal-table");
const filterButton = name => panel().getByRole("button", { name, exact: true });
const filterDialog = name => page.getByRole("dialog", { name: `Filtrar por ${name}`, exact: true });
async function choose(name, values) {
  await filterButton(name).click();
  const popup = filterDialog(name);
  await popup.getByRole("button", { name: "Mostrar todas", exact: true }).click();
  for (const value of values) await popup.getByRole("checkbox", { name: value, exact: true }).check();
  await popup.getByRole("button", { name: "Concluir", exact: true }).click();
}
async function open() {
  await page.goto(origin + "/benefits");
  await page.locator(".benefit-module-tabs").getByRole("button", { name: /Vale Alimentação/ }).click();
  await panel().getByLabel("Início das ocorrências").fill(period.start);
  await panel().getByLabel("Fim das ocorrências").fill(period.end);
  assert.equal(await filterButton("Situação do funcionário").innerText(), "Ativos");
  await table().locator("tbody tr").first().waitFor();
  assert.equal(await table().getByText("ANA TESTE", { exact: true }).count(), 0);
  await choose("Situação do funcionário", []);
  await table().getByText("ANA TESTE", { exact: true }).waitFor();
}
async function sync() {
  await panel().getByRole("button", { name: "Atualizar pelo QuarkRH", exact: true }).click();
  await panel().getByRole("button", { name: "Atualizar pelo QuarkRH", exact: true }).waitFor();
  await panel().locator(".meal-sync-info").getByText(/Última consulta salva:/).waitFor();
}
try {
  await mkdir("tmp/meal-qa", { recursive: true });
  await open();
  assert.match(await panel().locator(".meal-benefit-month").innerText(), /12\/2026/);
  assert.equal(await table().locator("tbody tr").count(), 50);
  assert.match(await table().locator("tbody tr").first().innerText(), /Não consultado/);
  assert.equal(await panel().getByRole("button", { name: "Exportar PDF" }).isDisabled(), true);
  assert.deepEqual(calls, []);
  await sync();
  assert.deepEqual(calls, ["sync-benefit-meal"]);
  assert.equal(stored.get(runs[0].id).length, 61);
  assert.equal(await table().locator("tbody tr").first().locator("td").nth(4).innerText(), "1");
  assert.match(await table().locator("tbody tr").first().innerText(), /A definir|Pendente/);
  assert.match(await panel().locator(".meal-table-note").innerText(), /61 funcionário/);
  await page.screenshot({ path: "tmp/meal-qa/desktop.png", fullPage: true });
  passed.push("meal replaces transport, loads every employee, derives December, preserves unknown inputs and syncs only on click");

  await filterButton("Empresa").click();
  const companyPopup = filterDialog("Empresa");
  await companyPopup.getByRole("checkbox", { name: "DMV - RECIFE", exact: true }).check();
  assert.equal(await table().locator("tbody tr").count(), 16);
  await companyPopup.getByRole("checkbox", { name: "VNA TELECOM LTDA - NATAL", exact: true }).check();
  assert.equal(await companyPopup.getByRole("checkbox", { checked: true }).count(), 2);
  assert.equal(await companyPopup.isVisible(), true);
  await page.screenshot({ path: "tmp/meal-qa/multi-filter-desktop.png" });
  await page.keyboard.press("Escape");
  assert.equal(await companyPopup.count(), 0);
  assert.equal(await filterButton("Empresa").evaluate(button => document.activeElement === button), true);
  assert.match(await panel().locator(".meal-table-note").innerText(), /61 funcionário/);
  await choose("Cidade", ["NATAL"]);
  assert.equal(await table().locator("tbody tr").count(), 45);
  await choose("Situação do funcionário", ["Ativos", "Desligados"]);
  await choose("Cidade", ["NATAL", "RECIFE"]);
  const multiDownload = page.waitForEvent("download"); await panel().getByRole("button", { name: "Exportar Excel (.xlsx)", exact: true }).click();
  await (await multiDownload).saveAs("tmp/meal-qa/multi-filter.xlsx");
  const multiSheet = XLSX.read(await readFile("tmp/meal-qa/multi-filter.xlsx"), { type: "buffer" }).Sheets["Vale Alimentação"];
  assert.match(multiSheet["!ref"], /Q71$/);
  for (const label of ["DMV - RECIFE", "VNA TELECOM LTDA - NATAL", "NATAL, RECIFE", "Ativos, Desligados"]) assert.ok(multiSheet.A7.v.includes(label), label);
  await choose("Empresa", ["DMV - RECIFE"]);
  await choose("Cidade", ["NATAL"]);
  assert.equal(await table().locator("tbody tr").count(), 0);
  assert.equal(await panel().getByRole("button", { name: "Exportar PDF", exact: true }).isDisabled(), true);
  await choose("Empresa", []); await choose("Cidade", []); await choose("Situação do funcionário", []);
  await filterButton("Cidade").click();
  await panel().locator(".meal-period-panel h3").click();
  assert.equal(await filterDialog("Cidade").count(), 0);
  passed.push("multi-select unions companies, cities and statuses, combines filters, preserves export labels, and closes with Escape or outside click");

  await table().locator("tbody tr").first().getByRole("button", { name: "Ver ocorrências" }).click();
  await page.getByRole("dialog").getByText("01/11/2026").first().waitFor();
  await page.getByRole("button", { name: "Fechar ocorrências" }).click();
  await panel().getByLabel("Próxima página").click();
  assert.equal(await table().locator("tbody tr").count(), 11);
  await panel().getByLabel("Pesquisar funcionário ou CPF").fill("ANA TESTE");
  assert.equal(await table().locator("tbody tr").count(), 1);
  let downloaded = page.waitForEvent("download"); await panel().getByRole("button", { name: "Exportar Excel (.xlsx)", exact: true }).click();
  let download = await downloaded; await download.saveAs("tmp/meal-qa/filtered.xlsx");
  let sheet = XLSX.read(await readFile("tmp/meal-qa/filtered.xlsx"), { type: "buffer" }).Sheets["Vale Alimentação"];
  assert.equal(sheet.A11.v, "ANA TESTE"); assert.equal(sheet.E11.v, 1); assert.equal(sheet.K11?.v ?? null, null); assert.match(sheet["!ref"], /Q11$/);
  await panel().getByLabel("Pesquisar funcionário ou CPF").fill("");
  downloaded = page.waitForEvent("download"); await panel().getByRole("button", { name: "Exportar Excel (.xlsx)", exact: true }).click();
  download = await downloaded; await download.saveAs("tmp/meal-qa/report.xlsx");
  sheet = XLSX.read(await readFile("tmp/meal-qa/report.xlsx"), { type: "buffer" }).Sheets["Vale Alimentação"];
  assert.match(sheet["!ref"], /Q71$/);
  downloaded = page.waitForEvent("download"); await panel().getByRole("button", { name: "Exportar PDF", exact: true }).click();
  download = await downloaded; await download.saveAs("tmp/meal-qa/report.pdf");
  const pdf = await PDFDocument.load(await readFile("tmp/meal-qa/report.pdf")); assert.ok(pdf.getPageCount() > 1);
  passed.push("source events, pagination, filter-aware exports, real styled XLSX and multi-page branded PDF include all filtered rows");

  await sync();
  assert.equal(runs.length, 2); assert.equal(stored.get(runs[0].id)[0].absence_days, 1);
  await panel().getByRole("tab", { name: "Histórico de consultas" }).click();
  await panel().locator(".meal-history tbody tr").last().getByRole("button", { name: "Consultar versão" }).click();
  await page.waitForFunction(() => !document.querySelector('.meal-history button')?.disabled && document.querySelector('.meal-sync-info')?.textContent.includes('Versão consultada'));
  await choose("Situação do funcionário", []);
  assert.equal(await table().locator("tbody tr").first().locator("td").nth(4).innerText(), "1");
  await panel().getByRole("tab", { name: "Apuração por período" }).click();
  await table().getByText("ANA TESTE", { exact: true }).waitFor();
  assert.equal(await table().locator("tbody tr").first().locator("td").nth(4).innerText(), "2");
  syncFailure = true;
  await panel().getByRole("button", { name: "Atualizar pelo QuarkRH", exact: true }).click();
  await page.getByText("Não foi possível atualizar o Vale Alimentação", { exact: true }).waitFor();
  assert.equal(runs.length, 2); assert.equal(await table().locator("tbody tr").first().locator("td").nth(4).innerText(), "2");
  passed.push("repeated sync creates versions, history restores old values, latest reloads correctly and API errors preserve saved data");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await choose("Cidade", ["RECIFE"]);
  assert.match(await table().locator("tbody tr").first().innerText(), /Recife: 4 faixas a definir/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: "tmp/meal-qa/mobile-dark.png", fullPage: true });
  await filterButton("Empresa").click();
  const popupBounds = await filterDialog("Empresa").boundingBox();
  assert.ok(popupBounds.x >= 0 && popupBounds.x + popupBounds.width <= 391 && popupBounds.y >= 0 && popupBounds.y + popupBounds.height <= 845);
  await page.screenshot({ path: "tmp/meal-qa/multi-filter-mobile.png" });
  await page.keyboard.press("Escape");
  passed.push("Recife remains unconfigured and mobile dark layout has no page overflow");

  missingSchema = true;
  const before = calls.length;
  await open();
  await panel().getByRole("alert").getByText(/estrutura de Vale Alimentação/).waitFor();
  assert.equal(await panel().getByRole("button", { name: "Atualizar pelo QuarkRH", exact: true }).isDisabled(), true);
  assert.equal(calls.length, before);
  passed.push("an uninstalled database shows a clear notice and cannot trigger roster/API writes");
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ passed, pageErrors: errors, unexpectedNetwork: unexpected, savedVersions: runs.length }, null, 2));
} finally { await context.close(); await browser.close(); }
