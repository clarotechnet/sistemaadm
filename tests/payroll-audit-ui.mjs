// Optional browser smoke test. Uses only fictional responses; no live payroll.
// Run against Vite with VITE_SUPABASE_URL=https://audit-preview.supabase.co.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
const { chromium } = process.env.PLAYWRIGHT_PATH ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href) : await import("playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const userId = "11111111-1111-4111-8111-111111111111";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "teste@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const profile = { id: userId, full_name: "RH de Teste", email: user.email, department: "RH", job_title: "Analista", role: "ADMINISTRADOR", status: "ATIVO" };
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, exp: expires, iat: expires - 3600 })).toString("base64url")}.fake-test-signature`;
const session = { access_token: token, refresh_token: "fake-test-refresh", expires_at: expires, expires_in: 3600, token_type: "bearer", user };
const months = [{ id: "current", competence: "10/2026", file_name: "atual.xlsx", record_count: 32, updated_at: "2026-10-02T00:00:00Z", imported_by_name: "RH de Teste", file_size: 100, logs: [] }, ...[["previous", "09/2026"], ["second", "08/2026"], ["third", "07/2026"], ["too-old", "06/2026"]].map(([id, competence]) => ({ id, competence, file_name: "anterior.xlsx", record_count: 32, updated_at: "2026-09-02T00:00:00Z", imported_by_name: "RH de Teste", file_size: 100, logs: [] }))];
const records = (current) => Array.from({ length: 32 }, (_, index) => {
  const liquid = current ? (index === 0 ? -100 : index === 1 ? 0 : index === 2 ? 3000 : 4200) : 3000;
  return { cpf: String(index + 1).padStart(11, "0"), name: `Funcionário Teste ${String(index + 1).padStart(2, "0")}`, liquid, health_total: 100, dental_total: 0, health_columns: 1, dental_columns: 0, source_sheet: "Folha", audit_data: { version: 1, baseSalary: null, gross: liquid + 500, deductions: 500, liquid, company: "Empresa Teste", unit: "Natal", costCenter: "Operações", department: "Controle", jobTitle: "Analista", registration: "", internalId: "", employmentStatus: "ATIVO", admissionDate: null, terminationDate: null, payrollType: "NORMAL", events: [{ key: "HE", label: "Hora extra", kind: "earning", category: "overtime", value: current && index !== 2 ? 900 : 100 }], occurrences: [{ sheet: "Folha", row: index + 2 }], invalidFields: ["Salário-base"] } };
});
let reviews = [];
const payrollRequests = [];
const historyRequests = [];
let availableMode = "all";
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addCookies([{ name: "sb-audit-preview-auth-token", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: "http://127.0.0.1:5173" }]);
  await context.route("https://*.supabase.co/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const table = url.pathname.split("/").at(-1);
    let body = [];
    if (url.pathname === "/auth/v1/user") body = user;
    else if (table === "profiles") body = profile;
    else if (table === "system_settings") body = { mask_cpf: true, file_retention: "NONE", financial_tolerance: 0.01 };
    else if (table === "payroll_imports") body = url.searchParams.has("competence") ? months.find(month => "eq." + month.competence === url.searchParams.get("competence")) : months.filter(month => availableMode === "all" || (availableMode === "gap" ? month.id !== "second" : ["current", "too-old"].includes(month.id)));
    else if (table === "payroll_records") {
      if (url.searchParams.has("cpf")) {
        const requested = url.searchParams.get("payroll_imports.competence") ?? "";
        historyRequests.push({ competences: requested, limit: url.searchParams.get("limit") });
        body = months.filter(month => requested.includes(month.competence)).map(month => ({ ...records(month.id === "current").find(row => "eq." + row.cpf === url.searchParams.get("cpf")), payroll_imports: { competence: month.competence } }));
      } else {
        payrollRequests.push(url.searchParams.get("payroll_import_id"));
        body = records(url.searchParams.get("payroll_import_id") === "eq.current");
      }
    } else if (table === "payroll_audit_reviews") {
      if (request.method() === "POST") { const value = request.postDataJSON(); body = { ...value, updated_by_name: "RH de Teste", updated_at: new Date().toISOString() }; reviews = [body]; }
      else body = reviews;
    } else if (table === "employees") body = records(true).map((row, index) => ({ id: row.cpf, cpf: row.cpf, full_name: row.name, status: index === 1 ? "DESLIGADO" : "ATIVO", source: "QUARK", external_unit_id: "unidade-teste", external_unit_name: "Empresa Teste", department: "Controle", job_title: "Analista", admission_date: null, termination_date: null, last_synced_at: "2026-10-07T12:00:00Z" }));
    else if (table === "sync-quark-employees") body = { runId: "teste", units: 1, received: 32, created: 0, updated: 32, linked: 0, skipped: 0 };
    else if (table === "user_presence") body = {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body ?? null) });
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173/conferencia");
  await page.getByRole("heading", { name: "Conferência", exact: true }).waitFor();
  await page.getByRole("button", { name: "Conferir", exact: true }).first().waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Valor comparado", exact: true }).inputValue(), "Líquido (sempre)");
  assert.equal(await page.getByRole("textbox", { name: "Valor comparado", exact: true }).getAttribute("readonly"), "");
  assert.deepEqual(await page.getByRole("combobox", { name: "Meses anteriores para comparar", exact: true }).locator("option").evaluateAll(options => options.map(option => option.value)), ["1", "2", "3"]);
  for (const id of ["eq.previous", "eq.second", "eq.third"]) assert.ok(payrollRequests.includes(id));
  assert.ok(!payrollRequests.includes("eq.too-old"));
  assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), 25);
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), 6);
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await page.getByRole("combobox", { name: "Situação cadastral atual", exact: true }).selectOption("DESLIGADO");
  assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), 1);
  await page.getByRole("combobox", { name: "Situação cadastral atual", exact: true }).selectOption("");
  // A metric must clear conflicting filters, reset pagination, and match its count.
  await page.getByRole("textbox", { name: "Pesquisar funcionário" }).fill("sem correspondência");
  const critical = page.getByRole("button", { name: "Críticos: 2", exact: true });
  await critical.click();
  assert.equal(await critical.getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("textbox", { name: "Pesquisar funcionário" }).inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), 2);
  await critical.click();
  assert.equal(await critical.getAttribute("aria-pressed"), "false");
  assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), 25);
  await critical.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), 2);
  const expectedMetrics = [["Processados", 32], ["OK", 1], ["Atenção", 29], ["Críticos", 2], ["Informação", 0], ["Folha zerada", 0], ["Líquido zerado", 1], ["Líquido negativo / descontos excedentes", 1], ["Novos", 0], ["Ausentes / sem folha", 0], ["Possíveis duplicidades", 0], ["Ativos hoje com líquido zerado", 0], ["CPFs sem cadastro", 0], ["Descontos elevados", 2]];
  for (const [label, count] of expectedMetrics) {
    const card = page.getByRole("button", { name: `${label}: ${count}`, exact: true });
    await card.click();
    assert.equal(await card.getAttribute("aria-pressed"), "true", label);
    assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), Math.min(count, 25), label);
    assert.match(await page.locator(".table-toolbar [aria-live]").textContent(), new RegExp(`^${count} de 32 colaboradores`));
  }
  const deductionLimit = page.getByRole("textbox", { name: "Descontos acima de (% do bruto)", exact: true });
  await deductionLimit.fill("100");
  await page.getByRole("button", { name: "Aplicar limites", exact: true }).click();
  await page.getByRole("button", { name: "Descontos elevados: 1", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), 1);
  await deductionLimit.fill("150");
  await page.getByRole("button", { name: "Aplicar limites", exact: true }).click();
  await page.getByText("O limite de descontos deve estar entre 0 e 100%", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Descontos elevados: 1", exact: true }).count(), 1);
  await deductionLimit.fill("50");
  await page.getByRole("button", { name: "Aplicar limites", exact: true }).click();
  await page.getByRole("button", { name: "Descontos elevados: 2", exact: true }).waitFor();
  await page.getByRole("button", { name: "Limpar filtros", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Conferir", exact: true }).count(), 25);
  await page.getByRole("button", { name: "Sincronizar QuarkRH", exact: true }).click();
  await page.getByText("Cadastro do QuarkRH atualizado", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Conferir", exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Conferir", exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.getByText("Comparativo detalhado de eventos", { exact: true }).waitFor();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Comparativo do líquido · até 3 meses anteriores", { exact: true }).waitFor();
  assert.equal(await dialog.locator(".audit-liquid-history tbody tr").count(), 3);
  assert.deepEqual(await dialog.locator(".audit-liquid-history tbody tr td:first-child").allTextContents(), ["09/2026", "08/2026", "07/2026"]);
  await dialog.getByText("Composição das folhas disponíveis", { exact: true }).waitFor();
  assert.equal(historyRequests.at(-1).limit, "4");
  assert.ok(!historyRequests.at(-1).competences.includes("06/2026"));
  const notesInput = dialog.getByRole("textbox", { name: "Observação / justificativa", exact: true }).first();
  const lightStyle = await notesInput.evaluate(input => { const style = getComputedStyle(input); return { border: style.borderTopWidth, height: input.clientHeight, background: style.backgroundColor, color: style.color }; });
  assert.equal(lightStyle.border, "2px");
  assert.ok(lightStyle.height >= 108);
  assert.notEqual(lightStyle.background, "rgba(0, 0, 0, 0)");
  await notesInput.focus();
  assert.notEqual(await notesInput.evaluate(input => getComputedStyle(input).outlineStyle), "none");
  await dialog.screenshot({ path: "outputs/conferencia-achados-claro.png" });
  await dialog.getByRole("combobox", { name: "Tratamento", exact: true }).first().selectOption("JUSTIFICADA");
  await dialog.getByRole("textbox", { name: "Observação / justificativa", exact: true }).first().fill("Conferido em teste com dados fictícios.");
  await dialog.getByRole("button", { name: "Salvar análise", exact: true }).first().click();
  await page.getByText("Tratamento salvo", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Fechar conferência" }).click();
  await critical.click();
  for (const kind of ["XLSX", "CSV", "PDF"]) {
    console.log(`Verificando exportação ${kind}`);
    let download;
    try {
      [download] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.getByRole("button", { name: kind, exact: true }).click()]);
    } catch (error) {
      console.log(await page.locator(".toast").allTextContents());
      await page.screenshot({ path: "outputs/conferencia-test-error.png", fullPage: true });
      throw error;
    }
    assert.ok(download.suggestedFilename().endsWith("." + kind.toLowerCase()));
    if (kind === "CSV") {
      const csv = await readFile(await download.path(), "utf8");
      const lines = csv.trim().split("\r\n");
      assert.equal(lines.length, 3, "Export only the two critical employees, plus the header.");
      assert.match(lines[0], /Descontos \/ bruto %/);
      assert.ok(lines[1].includes(';"125";'), "Percent values in CSV are not fractional ratios.");
      assert.ok(lines[2].includes(';"100";'));
      assert.match(lines[1], /09\/2026: líquido/);
      assert.match(lines[1], /08\/2026: líquido/);
      assert.match(lines[1], /07\/2026: líquido/);
      assert.doesNotMatch(lines[1], /06\/2026: líquido/);
    }
  }
  await page.getByRole("button", { name: "Ativar tema escuro" }).click();
  while (await page.locator(".toast").count()) await page.locator(".toast").getByRole("button", { name: "Fechar", exact: true }).first().click();
  await page.getByRole("button", { name: "Conferir", exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  const darkNotes = page.getByRole("dialog").getByRole("textbox", { name: "Observação / justificativa", exact: true }).first();
  await darkNotes.focus();
  const darkStyle = await darkNotes.evaluate(input => { const style = getComputedStyle(input); return { border: style.borderTopWidth, background: style.backgroundColor, color: style.color }; });
  assert.equal(darkStyle.border, "2px");
  assert.notEqual(darkStyle.background, lightStyle.background);
  assert.notEqual(darkStyle.color, lightStyle.color);
  await page.getByRole("dialog").screenshot({ path: "outputs/conferencia-achados-escuro.png" });
  await page.getByRole("button", { name: "Fechar conferência" }).click();
  await page.getByRole("combobox", { name: "Meses anteriores para comparar", exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Conferir", exact: true }).first().click();
  await page.getByRole("dialog").getByText("Comparativo do líquido · até 1 mês anterior", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").locator(".audit-liquid-history tbody tr").count(), 1);
  await page.getByRole("dialog").getByText("Composição das folhas disponíveis", { exact: true }).waitFor();
  assert.equal(historyRequests.at(-1).limit, "2");
  assert.ok(!historyRequests.at(-1).competences.includes("08/2026"));
  await page.getByRole("button", { name: "Fechar conferência" }).click();
  await page.getByRole("combobox", { name: "Meses anteriores para comparar", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Conferir", exact: true }).first().waitFor();
  await page.screenshot({ path: "outputs/conferencia-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mainBounds = await page.locator(".control-main").boundingBox();
  assert.ok(mainBounds && mainBounds.x === 0 && mainBounds.width === 390, "O conteúdo deve ocupar a tela quando o menu lateral estiver oculto.");
  await page.screenshot({ path: "outputs/conferencia-mobile.png", fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "A tabela deve rolar internamente no celular.");
  await page.getByRole("button", { name: "Conferir", exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  const mobileNotes = page.getByRole("dialog").getByRole("textbox", { name: "Observação / justificativa", exact: true }).first();
  await mobileNotes.scrollIntoViewIfNeeded();
  const notesBounds = await mobileNotes.boundingBox();
  assert.ok(notesBounds && notesBounds.x >= 0 && notesBounds.x + notesBounds.width <= 390);
  await page.getByRole("dialog").screenshot({ path: "outputs/conferencia-achados-mobile.png" });
  await page.getByRole("button", { name: "Fechar conferência" }).click();
  availableMode = "gap";
  await page.reload();
  await page.getByRole("button", { name: "Conferir", exact: true }).first().click();
  await page.getByRole("dialog").getByText("Comparativo do líquido · até 3 meses anteriores", { exact: true }).waitFor();
  const gapRow = page.getByRole("dialog").locator(".audit-liquid-history tbody tr").filter({ hasText: "08/2026" });
  await gapRow.getByText("Folha não importada", { exact: true }).waitFor();
  assert.equal((await gapRow.locator("td").allTextContents())[1], "—");
  await page.getByRole("button", { name: "Fechar conferência" }).click();
  availableMode = "current-and-old";
  await page.reload();
  await page.getByText("Nenhuma folha disponível no período anterior selecionado.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Conferir", exact: true }).first().waitFor();
  assert.ok(!payrollRequests.includes("eq.too-old"), "Never fill missing months with a payroll outside the 3-month window.");
  await page.getByRole("button", { name: "Importar folha", exact: true }).click();
  await page.getByRole("heading", { name: "Importar Folha de Pagamento", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/payroll");
  assert.deepEqual(errors, []);
  console.log("PASS: líquido fixo, até 3 meses, lacunas no histórico, justificativas destacadas, indicadores, limites, paginação, exportações, temas, celular e Importações.");
} finally { await browser.close(); }
