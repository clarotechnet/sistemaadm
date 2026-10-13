// Optional local browser check. All Supabase requests use fictional responses.
// Run Vite's Hostinger config with VITE_SUPABASE_URL=https://benefits-preview.supabase.co.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = process.env.PLAYWRIGHT_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href)
  : await import("playwright");
const baseUrl = process.env.BENEFITS_TEST_URL ?? "http://127.0.0.1:5174";
const userId = "11111111-1111-4111-8111-111111111111";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "rh@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const profile = { id: userId, full_name: "RH de Teste", email: user.email, department: "RH", job_title: "Analista", role: "ADMINISTRADOR", status: "ATIVO" };
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, exp: expires, iat: expires - 3600 })).toString("base64url")}.fictional-signature`;
const session = { access_token: token, refresh_token: "fictional-refresh", expires_at: expires, expires_in: 3600, token_type: "bearer", user };
const months = [
  { id: "october", competence: "10/2026", file_name: "folha-teste-outubro.xlsx", record_count: 1, updated_at: "2026-10-01T12:00:00Z", imported_by_name: profile.full_name, file_size: 100, logs: [] },
  { id: "september", competence: "09/2026", file_name: "folha-teste-setembro.xlsx", record_count: 1, updated_at: "2026-09-01T12:00:00Z", imported_by_name: profile.full_name, file_size: 100, logs: [] },
];
const comparison = kind => ({
  id: `saved-${kind}`, reference_file_name: `referencia-${kind}.xlsx`, tolerance: 0.01, processed_by_name: profile.full_name, processed_at: "2026-10-02T12:00:00Z",
  total_count: 1, ok_count: kind === "dental" ? 1 : 0, divergent_count: kind === "health" ? 1 : 0, missing_count: 0, difference_total: kind === "health" ? 10 : 0,
  payroll_comparison_rows: [{ cpf: "00000000001", name: "Funcionário Fictício", payroll_value: kind === "health" ? 110 : 20, reference_value: kind === "health" ? 100 : 20, difference: kind === "health" ? 10 : 0, liquid: 3000, column_count: 1, status: kind === "health" ? "DIVERGENTE" : "OK" }],
});
const errors = [], unexpectedHosts = [], deleted = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });

async function createFixture(viewport, hasPayroll = true) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const saved = { health: comparison("health"), dental: comparison("dental") };
  await context.addCookies([{ name: "sb-benefits-preview-auth-token", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseUrl }]);
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === baseUrl) { await route.continue(); return; }
    if (url.hostname !== "benefits-preview.supabase.co") {
      unexpectedHosts.push(url.hostname);
      await route.abort();
      return;
    }
    const table = url.pathname.split("/").at(-1);
    let body = [];
    if (url.pathname === "/auth/v1/user") body = user;
    else if (table === "profiles") body = profile;
    else if (table === "system_settings") body = { mask_cpf: false, file_retention: "NONE", financial_tolerance: 0.01 };
    else if (table === "payroll_imports") body = !hasPayroll ? (url.searchParams.has("competence") ? null : []) : url.searchParams.has("competence") ? months.find(month => "eq." + month.competence === url.searchParams.get("competence")) : months;
    else if (table === "payroll_records") body = [{ cpf: "00000000001", name: "Funcionário Fictício", liquid: 3000, health_total: 110, dental_total: 20, health_columns: 1, dental_columns: 1, source_sheet: "Folha de teste" }];
    else if (table === "payroll_comparisons") body = url.searchParams.get("payroll_import_id") === "eq.october" ? saved[url.searchParams.get("kind").replace("eq.", "")] : null;
    else if (table === "delete_payroll_comparison") {
      const args = request.postDataJSON();
      assert.equal(args.p_payroll_import_id, "october");
      deleted.push(args.p_kind);
      saved[args.p_kind] = null;
      body = null;
    } else if (table === "user_presence") body = {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body ?? null) });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseUrl + "/benefits");
  await page.getByRole("heading", { name: "Benefícios", exact: true }).first().waitFor();
  return { context, page };
}

try {
  const { context, page } = await createFixture({ width: 1366, height: 768 });
  const modules = page.locator(".benefit-module-tabs");
  assert.deepEqual(await modules.locator("strong").allTextContents(), ["Agregamento", "Vale Transporte", "Plano de Saúde", "Plano Odontológico"]);
  await modules.getByRole("button", { name: /Plano de Saúde/ }).click();
  await page.getByRole("heading", { name: "Resultado · Plano de Saúde", exact: true }).waitFor();
  const competence = page.locator(".page-heading select");
  assert.equal(await competence.inputValue(), "10/2026");
  assert.equal(await page.getByRole("columnheader", { name: "Saúde Folha", exact: true }).count(), 1);
  await page.locator(".filter-pills").getByRole("button", { name: "OK", exact: true }).click();
  await page.getByText("Nenhum registro corresponde aos filtros aplicados.", { exact: true }).waitFor();
  await page.locator(".filter-pills").getByRole("button", { name: "DIVERGENTES", exact: true }).click();
  assert.equal(await page.locator(".data-table tbody tr").count(), 1);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Gerar Excel", exact: true }).click();
  assert.equal((await downloadEvent).suggestedFilename(), "Comparativo_health_10-2026.xlsx");
  await modules.getByRole("button", { name: /Plano Odontológico/ }).click();
  await page.getByRole("heading", { name: "Resultado · Plano Odontológico", exact: true }).waitFor();
  assert.equal(await page.getByRole("columnheader", { name: "Odonto Folha", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Refazer comparativo", exact: true }).click();
  await page.getByRole("heading", { name: "Conferência · Plano Odontológico", exact: true }).waitFor();
  assert.equal(await page.locator(".dropzone").count(), 1);
  await modules.getByRole("button", { name: /Plano de Saúde/ }).click();
  await page.getByRole("heading", { name: "Resultado · Plano de Saúde", exact: true }).waitFor();
  await competence.selectOption("09/2026");
  await page.getByRole("heading", { name: "Conferência · Plano de Saúde", exact: true }).waitFor();
  assert.equal(await page.locator(".comparison-competence select").inputValue(), "09/2026");
  await competence.selectOption("10/2026");
  await page.getByRole("heading", { name: "Resultado · Plano de Saúde", exact: true }).waitFor();
  await page.getByRole("button", { name: "Excluir comparativo", exact: true }).click();
  await page.locator(".modal").getByRole("button", { name: "Excluir comparativo", exact: true }).click();
  await page.getByRole("heading", { name: "Conferência · Plano de Saúde", exact: true }).waitFor();
  assert.deepEqual(deleted, ["health"]);
  await page.locator(".control-sidebar nav").getByRole("button", { name: "Dados da Folha", exact: true }).click();
  assert.deepEqual(await page.locator(".control-content > .tabs > button").allTextContents(), ["Visão geral", "Importações"]);
  await page.locator(".control-content > .tabs").getByRole("button", { name: "Importações", exact: true }).click();
  await page.getByRole("heading", { name: "Importar Folha de Pagamento", exact: true }).waitFor();
  await context.close();

  const empty = await createFixture({ width: 1366, height: 768 }, false);
  await empty.page.locator(".benefit-module-tabs").getByRole("button", { name: /Plano de Saúde/ }).click();
  await empty.page.getByRole("heading", { name: "A Folha de Pagamento é obrigatória", exact: true }).waitFor();
  await empty.page.getByRole("button", { name: "Importar Folha de Pagamento", exact: true }).click();
  await empty.page.getByRole("heading", { name: "Importar Folha de Pagamento", exact: true }).waitFor();
  assert.equal(new URL(empty.page.url()).pathname, "/payroll");
  await empty.context.close();

  for (const width of [1024, 390]) {
    const mobile = await createFixture({ width, height: 844 });
    await mobile.page.locator(".benefit-module-tabs").getByRole("button", { name: /Plano Odontológico/ }).click();
    await mobile.page.getByRole("heading", { name: "Resultado · Plano Odontológico", exact: true }).waitFor();
    await mobile.page.getByRole("button", { name: "Ativar tema escuro", exact: true }).click();
    assert.equal(await mobile.page.evaluate(() => document.documentElement.dataset.theme), "dark");
    assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Benefit cards must not cause horizontal page overflow");
    await mobile.context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedHosts, []);
  console.log("Benefit plans UI passed: order, saved results, month selection, filters, export, deletion, import shortcut and responsive layout.");
} finally {
  await browser.close();
}
