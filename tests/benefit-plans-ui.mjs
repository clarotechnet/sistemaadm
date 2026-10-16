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
  { id: "august", competence: "08/2026", file_name: "folha-teste-agosto.xlsx", record_count: 1, updated_at: "2026-08-01T12:00:00Z", imported_by_name: profile.full_name, file_size: 100, logs: [] },
];
const comparison = kind => ({
  id: `saved-${kind}`, reference_file_name: `referencia-${kind}.xlsx`, tolerance: 0.01, processed_by_name: profile.full_name, processed_at: "2026-10-02T12:00:00Z",
  total_count: 1, ok_count: kind === "dental" ? 1 : 0, divergent_count: kind === "health" ? 1 : 0, missing_count: 0, difference_total: kind === "health" ? 10 : 0,
  payroll_comparison_rows: [{ cpf: "52998224725", name: "Funcionário Fictício", payroll_value: kind === "health" ? 110 : 20, reference_value: kind === "health" ? 90 : 20, difference: kind === "health" ? 20 : 0, liquid: 3000, column_count: 1, status: kind === "health" ? "DIVERGENTE" : "OK" }],
});
const errors = [], unexpectedHosts = [], deleted = [];
const baseSaves = [], comparisonSaves = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });

async function createFixture(viewport, hasPayroll = true, baseMode = "normal", options = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const actor={...user,id:options.actorId??userId};
  const actorProfile={...profile,id:actor.id,full_name:options.actorId?"Outra pessoa do RH":profile.full_name};
  const actorToken=`${token.split(".")[0]}.${Buffer.from(JSON.stringify({sub:actor.id,exp:expires,iat:expires-3600})).toString("base64url")}.fictional-signature`;
  const actorSession={...session,user:actor,access_token:actorToken};
  const saved = options.shared?.saved ?? { health: comparison("health"), dental: comparison("dental") };
  const base = options.shared?.base ?? ["health","dental"].map(kind=>({id:`base-${kind}`,kind,cpf:"52998224725",employee_name:"Funcionário Fictício",company:"Empresa teste",city:"Cidade teste",department:"RH",plan_name:"Plano teste",discount_value:kind==="health"?100:20,status:"ATIVO",notes:"",metadata:{},effective_from:"2026-09-01",revision:1,source:"Base teste",created_at:"2026-09-01T12:00:00Z",created_by_name:profile.full_name}));
  await context.addCookies([{ name: "sb-benefits-preview-auth-token", value: "base64-" + Buffer.from(JSON.stringify(actorSession)).toString("base64url"), url: baseUrl }]);
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
    if (url.pathname === "/auth/v1/user") body = actor;
    else if (table === "profiles") body = actorProfile;
    else if (table === "system_settings") body = { mask_cpf: false, file_retention: "NONE", financial_tolerance: 0.01 };
    else if (table === "benefit_plan_base_versions") {
      if(baseMode==="error"){await route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({code:"42501",message:"Acesso à base negado"})});return;}
      body = baseMode==="empty"?[]:base.filter(row=>"eq."+row.kind===url.searchParams.get("kind"));
    }
    else if (table === "save_benefit_plan_base") {
      const args=request.postDataJSON();baseSaves.push(args);
      for(const row of args.p_records)base.push({id:crypto.randomUUID(),kind:args.p_kind,cpf:row.cpf,employee_name:row.name,company:row.company,city:row.city,department:row.department,plan_name:row.plan,discount_value:row.value,status:row.status,notes:row.notes,metadata:row.metadata,effective_from:args.p_effective_from,revision:base.filter(item=>item.kind===args.p_kind&&item.cpf===row.cpf).length+1,source:args.p_source,created_at:new Date().toISOString(),created_by_name:profile.full_name});
      body={rows:args.p_records.length};
    } else if (table === "save_payroll_comparison") {
      const args=request.postDataJSON();comparisonSaves.push(args);const rows=args.p_rows;
      saved[args.p_kind]={...comparison(args.p_kind),reference_file_name:args.p_reference_file_name,payroll_comparison_rows:rows,total_count:rows.length,ok_count:rows.filter(r=>r.status==="OK").length,divergent_count:rows.filter(r=>r.status==="DIVERGENTE").length,missing_count:rows.filter(r=>r.status.includes("NÃO LOCALIZADO")).length,difference_total:rows.reduce((s,r)=>s+(r.difference??0),0)};
      body={ok:true};
    } else if (table === "benefit_aggregation_sync_runs") body = url.searchParams.get("competence")==="eq.2026-10-01"?{id:"run-test",status:url.searchParams.has("status")?"SUCCESS":"ERROR",started_at:"2026-10-15T12:00:00Z",completed_at:"2026-10-15T12:30:00Z",triggered_by_name:profile.full_name,processed_count:1,warning_message:null}:null;
    else if (table === "payroll_imports") body = !hasPayroll ? (url.searchParams.has("competence") ? null : []) : url.searchParams.has("competence") ? months.find(month => "eq." + month.competence === url.searchParams.get("competence")) : months;
    else if (table === "payroll_records") body = [{ cpf: "52998224725", name: "Funcionário Fictício", liquid: 3000, health_total: url.searchParams.get("payroll_import_id")==="eq.september"?100:110, dental_total: 20, health_columns: 1, dental_columns: 1, source_sheet: "Folha de teste" }];
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
  return { context, page, base, saved };
}

try {
  const { context, page } = await createFixture({ width: 1366, height: 768 });
  const modules = page.locator(".benefit-module-tabs");
  assert.deepEqual(await modules.locator("strong").allTextContents(), ["Agregamento", "Vale Transporte", "Plano de Saúde", "Plano Odontológico"]);
  await modules.getByRole("button", { name: /Plano de Saúde/ }).click();
  await page.locator(".benefit-inner-tabs").getByRole("button", { name: "Conferência mensal", exact: true }).click();
  await page.getByRole("heading", { name: "Resultado · Plano de Saúde", exact: true }).waitFor();
  const competence = page.locator(".page-heading select");
  assert.equal(await competence.inputValue(), "10/2026");
  const live=page.locator(".plan-live-result");
  assert.equal(await live.getByRole("columnheader", { name: "Saúde Folha", exact: true }).count(), 1);
  assert.equal(await page.locator(".plan-monthly-comparison input[type=file]").count(),0);
  assert.match(await live.locator("tbody").textContent(),/100,00/);
  assert.doesNotMatch(await live.locator("tbody").textContent(),/90,00/);
  assert.equal(comparisonSaves.length,0,"Opening the automatic comparison must not overwrite saved history");
  assert.equal(await page.getByRole("button",{name:/Atualizar resultado salvo|Salvar conferência/}).count(),0);
  if(process.env.BENEFIT_SCREENSHOT)await page.screenshot({path:process.env.BENEFIT_SCREENSHOT,fullPage:true});
  await page.getByLabel("Pesquisar conferência por nome ou CPF").fill("nome inexistente");
  await live.getByText("Nenhum registro corresponde aos filtros aplicados.",{exact:true}).waitFor();
  await page.getByLabel("Pesquisar conferência por nome ou CPF").fill("");
  await page.locator(".filter-pills").getByRole("button", { name: "OK", exact: true }).click();
  await page.getByText("Nenhum registro corresponde aos filtros aplicados.", { exact: true }).waitFor();
  await page.locator(".filter-pills").getByRole("button", { name: "DIVERGENTES", exact: true }).click();
  assert.equal(await live.locator("tbody tr").count(), 1);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Gerar Excel", exact: true }).click();
  assert.equal((await downloadEvent).suggestedFilename(), "Comparativo_health_10-2026.xlsx");
  await modules.getByRole("button", { name: /Plano Odontológico/ }).click();
  await page.locator(".benefit-inner-tabs").getByRole("button", { name: "Conferência mensal", exact: true }).click();
  await page.getByRole("heading", { name: "Resultado · Plano Odontológico", exact: true }).waitFor();
  assert.equal(await live.getByRole("columnheader", { name: "Odonto Folha", exact: true }).count(), 1);
  assert.match(await live.locator("tbody").textContent(),/20,00.*20,00.*OK/);
  assert.equal(await page.locator(".dropzone").count(), 0);
  await modules.getByRole("button", { name: /Plano de Saúde/ }).click();
  await page.locator(".benefit-inner-tabs").getByRole("button", { name: "Conferência mensal", exact: true }).click();
  await page.getByRole("heading", { name: "Resultado · Plano de Saúde", exact: true }).waitFor();
  await competence.selectOption("09/2026");
  await page.getByRole("heading", { name: "Resultado · Plano de Saúde", exact: true }).waitFor();
  assert.match(await live.locator("tbody").textContent(),/100,00.*100,00.*OK/);
  assert.equal(await page.locator(".plan-saved-result").count(),0);
  await competence.selectOption("08/2026");
  await page.getByRole("heading", { name: "Resultado · Plano de Saúde", exact: true }).waitFor();
  assert.match(await live.locator("tbody").textContent(),/110,00.*100,00.*DIVERGENTE/);
  assert.match(await page.locator(".plan-base-comparison").textContent(),/mesmo que a data da base seja diferente da folha/);
  await modules.getByRole("button",{name:/Plano Odontológico/}).click();
  await page.locator(".benefit-inner-tabs").getByRole("button",{name:"Conferência mensal",exact:true}).click();
  await page.getByRole("heading",{name:"Resultado · Plano Odontológico",exact:true}).waitFor();
  assert.match(await live.locator("tbody").textContent(),/20,00.*20,00.*OK/);
  await modules.getByRole("button",{name:/Plano de Saúde/}).click();
  await page.locator(".benefit-inner-tabs").getByRole("button",{name:"Conferência mensal",exact:true}).click();
  await competence.selectOption("10/2026");
  await page.getByRole("heading", { name: "Resultado · Plano de Saúde", exact: true }).waitFor();
  await page.locator(".plan-saved-result summary").click();
  assert.match(await page.locator(".plan-saved-result tbody").textContent(),/90,00/);
  await page.getByRole("button", { name: "Excluir resultado salvo", exact: true }).click();
  await page.locator(".modal").getByRole("button", { name: "Excluir resultado salvo", exact: true }).click();
  await page.getByText("Resultado salvo excluído",{exact:true}).waitFor();
  assert.equal(await live.locator("tbody tr").count(),1,"Deleting a snapshot must not hide the automatic comparison");
  assert.equal(comparisonSaves.length,0);
  assert.deepEqual(deleted, ["health"]);
  await page.locator(".control-sidebar nav").getByRole("button", { name: "Dados da Folha", exact: true }).click();
  assert.deepEqual(await page.locator(".control-content > .tabs > button").allTextContents(), ["Visão geral", "Importações"]);
  await page.locator(".control-content > .tabs").getByRole("button", { name: "Importações", exact: true }).click();
  await page.getByRole("heading", { name: "Importar Folha de Pagamento", exact: true }).waitFor();
  await context.close();

  const empty = await createFixture({ width: 1366, height: 768 }, false);
  await empty.page.locator(".benefit-module-tabs").getByRole("button", { name: /Plano de Saúde/ }).click();
  await empty.page.locator(".benefit-inner-tabs").getByRole("button", { name: "Conferência mensal", exact: true }).click();
  await empty.page.getByRole("heading", { name: "A Folha de Pagamento é obrigatória", exact: true }).waitFor();
  await empty.page.getByRole("button", { name: "Importar Folha de Pagamento", exact: true }).click();
  await empty.page.getByRole("heading", { name: "Importar Folha de Pagamento", exact: true }).waitFor();
  assert.equal(new URL(empty.page.url()).pathname, "/payroll");
  await empty.context.close();

  for(const mode of ["empty","error"]){
    const unavailable=await createFixture({width:1366,height:768},true,mode);
    await unavailable.page.locator(".benefit-module-tabs").getByRole("button",{name:/Plano de Saúde/}).click();
    await unavailable.page.locator(".benefit-inner-tabs").getByRole("button",{name:"Conferência mensal",exact:true}).click();
    if(mode==="empty")await unavailable.page.getByRole("heading",{name:"Nenhum cadastro na Base de dados deste plano",exact:true}).waitFor();
    else await unavailable.page.getByRole("alert").getByText("Acesso à base negado",{exact:true}).waitFor();
    assert.equal(await unavailable.page.locator(".plan-live-result").count(),0,"Unavailable base must not show a misleading saved result as the current calculation");
    await unavailable.context.close();
  }

  for (const width of [1024, 390]) {
    const mobile = await createFixture({ width, height: 844 });
    await mobile.page.locator(".benefit-module-tabs").getByRole("button", { name: /Plano Odontológico/ }).click();
  await mobile.page.locator(".benefit-inner-tabs").getByRole("button", { name: "Conferência mensal", exact: true }).click();
    await mobile.page.getByRole("heading", { name: "Resultado · Plano Odontológico", exact: true }).waitFor();
    await mobile.page.getByRole("button", { name: "Ativar tema escuro", exact: true }).click();
    assert.equal(await mobile.page.evaluate(() => document.documentElement.dataset.theme), "dark");
    assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Benefit cards must not cause horizontal page overflow");
    await mobile.context.close();
  }
  const registry=await createFixture({width:1366,height:768});
  const colleague=await createFixture({width:1366,height:768},true,"normal",{shared:registry,actorId:"22222222-2222-4222-8222-222222222222"});
  await colleague.page.locator(".benefit-module-tabs").getByRole("button",{name:/Plano de Saúde/}).click();
  await colleague.page.locator(".benefit-inner-tabs").getByRole("button",{name:"Conferência mensal",exact:true}).click();
  await colleague.page.getByRole("heading",{name:"Resultado · Plano de Saúde",exact:true}).waitFor();
  assert.match(await colleague.page.locator(".plan-live-result tbody").textContent(),/100,00/);
  await colleague.page.getByLabel("Pesquisar conferência por nome ou CPF").fill("Funcionário");
  await registry.page.locator(".benefit-module-tabs").getByRole("button",{name:/Plano de Saúde/}).click();
  await registry.page.getByRole("heading",{name:"Base de dados · Plano de Saúde",exact:true}).waitFor();
  await registry.page.locator(".plan-base-toolbar input[type=month]").fill("2026-10");
  await registry.page.getByRole("button",{name:"Editar Funcionário Fictício",exact:true}).click();
  const editor=registry.page.getByRole("dialog",{name:"Cadastro do plano",exact:true});
  await editor.getByLabel("Desconto mensal (R$)",{exact:true}).fill("130,00");
  await editor.getByRole("button",{name:"Salvar cadastro",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  assert.equal(baseSaves.at(-1).p_records[0].value,130);
  assert.equal(baseSaves.at(-1).p_effective_from,"2026-10-01");
  await colleague.page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await colleague.page.locator(".plan-live-result tbody td").filter({hasText:/130,00/}).waitFor();
  assert.equal(await colleague.page.getByLabel("Pesquisar conferência por nome ou CPF").inputValue(),"Funcionário","Background refresh must preserve work in the current screen");
  assert.equal(comparisonSaves.length,0,"Another user sees the updated base without anyone saving a comparison");
  await colleague.page.locator(".control-sidebar nav").getByRole("button",{name:"Dashboard",exact:true}).click();
  assert.match((await colleague.page.locator(".comparison-overview").textContent()).replace(/\u00a0/g," "),/diferença -R\$\s*20,00/);
  await colleague.context.close();
  await registry.page.locator(".benefit-inner-tabs").getByRole("button",{name:"Conferência mensal",exact:true}).click();
  await registry.page.getByRole("heading",{name:"Resultado · Plano de Saúde",exact:true}).waitFor();
  assert.match(await registry.page.locator(".plan-live-result tbody").textContent(),/130,00/);
  assert.match(await registry.page.locator(".plan-saved-result tbody").textContent(),/90,00/);
  assert.equal(comparisonSaves.length,0,"Editing the base recalculates the view without overwriting a snapshot");
  await registry.page.getByLabel("Tolerância da conferência pela base").fill("20,00");
  assert.match(await registry.page.locator(".plan-live-result tbody").textContent(),/OK/);
  await registry.page.getByLabel("Tolerância da conferência pela base").fill("-1");
  await registry.page.getByRole("alert").getByText("Informe uma tolerância válida, maior ou igual a zero.",{exact:true}).waitFor();
  assert.equal(await registry.page.locator(".plan-live-result").count(),0);
  await registry.page.getByLabel("Tolerância da conferência pela base").fill("0,00");
  assert.match(await registry.page.locator(".plan-live-result tbody").textContent(),/DIVERGENTE/);
  assert.equal(await registry.page.getByRole("button",{name:/Atualizar resultado salvo|Salvar conferência/}).count(),0);
  assert.equal(comparisonSaves.length,0);
  await registry.page.locator(".benefit-inner-tabs").getByRole("button",{name:"Base de dados",exact:true}).click();
  await registry.page.getByRole("button",{name:"Editar Funcionário Fictício",exact:true}).click();
  await editor.getByLabel("Situação do plano",{exact:true}).selectOption("INATIVO");
  await editor.getByLabel("Válido a partir de",{exact:true}).fill("2026-11");
  await editor.getByRole("button",{name:"Salvar cadastro",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  await registry.page.locator(".plan-base-toolbar input[type=month]").fill("2026-09");
  assert.match(await registry.page.locator(".plan-base-table tbody").textContent(),/100,00/);
  await registry.page.locator(".plan-base-toolbar input[type=month]").fill("2026-11");
  assert.match(await registry.page.locator(".plan-base-table tbody").textContent(),/INATIVO/);
  await registry.page.getByLabel("Mostrar histórico de versões").check();
  assert.equal(await registry.page.locator(".plan-base-table tbody tr").count(),3);
  await registry.page.getByLabel("Mostrar histórico de versões").uncheck();
  await registry.page.getByRole("button",{name:"Excluir Funcionário Fictício da base",exact:true}).click();
  await registry.page.getByRole("dialog").getByRole("button",{name:"Excluir da base",exact:true}).click();
  await registry.page.getByText("Cadastro excluído da base",{exact:true}).waitFor();
  await registry.page.locator(".plan-base-toolbar input[type=month]").fill("2026-09");
  assert.match(await registry.page.locator(".plan-base-table tbody").textContent(),/100,00/);
  await registry.page.getByLabel("Mostrar histórico de versões").check();
  assert.equal(await registry.page.locator(".plan-base-table tbody tr").count(),4);
  assert.match(await registry.page.locator(".plan-base-table tbody").textContent(),/EXCLUIDO/);
  await registry.page.locator(".benefit-module-tabs").getByRole("button",{name:/Agregamento/}).click();
  await registry.page.locator(".benefit-inner-tabs").getByRole("button",{name:"Agregamentos mensal",exact:true}).click();
  await registry.page.getByText(/Última atualização pelo QuarkRH:/).waitFor();
  assert.match(await registry.page.locator(".benefit-sync-notice").textContent(),/15\/10\/2026/);
  assert.match(await registry.page.locator(".benefit-sync-notice").textContent(),/falhou/);
  await registry.context.close();
  for(const [kind,file,expected] of [["health",process.env.BENEFIT_HEALTH_FILE,127],["dental",process.env.BENEFIT_DENTAL_FILE,209]])if(file){
    const imported=await createFixture({width:1366,height:768});
    await imported.page.locator(".benefit-module-tabs").getByRole("button",{name:kind==="health"?/Plano de Saúde/:/Plano Odontológico/}).click();
    await imported.page.locator(".plan-base-toolbar input[type=month]").fill("2026-09");
    await imported.page.locator(".plan-base-actions input[type=file]").setInputFiles(file);
    await imported.page.getByRole("button",{name:"Confirmar importação",exact:true}).click();
    await imported.page.getByText("Base importada",{exact:true}).waitFor();
    const request=baseSaves.at(-1);assert.equal(request.p_kind,kind);assert.equal(request.p_records.length,expected);assert.equal(request.p_effective_from,"2026-09-01");
    const pending=request.p_records.filter(row=>row.status==="PENDENTE");assert.equal(pending.length,kind==="dental"?1:0);
    if(kind==="dental"){assert.equal(pending[0].value,null);assert.deepEqual(pending[0].metadata.sourceConflicts.map(row=>row.value),[13.86,55.44]);}
    await imported.context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedHosts, []);
  console.log("Benefit plans UI passed: automatic base comparisons, month selection, independent plans, recalculation after edits, snapshot preservation, no upload, filters, tolerance, export, unavailable data, registry history and responsive layout.");
} catch(error) {
  for(const context of browser.contexts())for(const page of context.pages())if(!page.isClosed())console.log(JSON.stringify({url:page.url(),dialogs:await page.getByRole("dialog").allTextContents(),labels:await page.locator(".plan-base-editor label").allTextContents(),pageErrors:errors}));
  throw error;
} finally {
  await browser.close();
}
