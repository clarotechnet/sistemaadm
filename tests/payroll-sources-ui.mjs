// Browser integration with a fictional Supabase project. No production traffic.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {mkdir,readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {payrollPdfFixture} from "./fixtures/payroll-pdf.ts";
import {PDFDocument} from "pdf-lib";
const {chromium}=process.env.PLAYWRIGHT_PATH?await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href):await import("playwright");
const url=process.env.PAYROLL_TEST_URL??"http://127.0.0.1:5174",uid="11111111-1111-4111-8111-111111111111",exp=Math.floor(Date.now()/1000)+3600;
const user={id:uid,aud:"authenticated",role:"authenticated",email:"rh@example.invalid",app_metadata:{},user_metadata:{},created_at:"2026-01-01T00:00:00Z"};
const token=`${Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url")}.${Buffer.from(JSON.stringify({sub:uid,exp,iat:exp-3600})).toString("base64url")}.fictional-signature`;
const session={access_token:token,refresh_token:"fictional-refresh",expires_at:exp,expires_in:3600,token_type:"bearer",user};
const profile={id:uid,full_name:"RH de Teste",email:user.email,department:"RH",job_title:"Analista",role:"ADMINISTRADOR",status:"ATIVO"};
const months=[],sources=[],records=[],errors=[],unexpected=[],saves=[];let revision=0;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM}),context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addCookies([{name:"sb-benefits-preview-auth-token",value:"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"),url}]);
function refresh(month){const list=sources.filter(s=>s.payroll_import_id===month.id),items=records.filter(r=>r.payroll_import_id===month.id);month.file_name=list.length+" folhas";month.record_count=new Set(items.map(r=>r.cpf)).size;month.file_size=list.reduce((total,s)=>total+s.file_size,0);month.updated_at=new Date(Date.UTC(2026,9,20,12,0,++revision)).toISOString();month.logs=[`${list.length} folhas, ${month.record_count} CPFs únicos`];}
await context.route("**/*",async route=>{
  const request=route.request(),target=new URL(request.url());if(target.origin===url){await route.continue();return;}
  if(target.hostname!=="benefits-preview.supabase.co"){unexpected.push(target.href);await route.abort();return;}
  const table=target.pathname.split("/").at(-1);let body=[];
  const equal=(name,value)=>!target.searchParams.has(name)||target.searchParams.get(name)==="eq."+value;
  if(target.pathname==="/auth/v1/user")body=user;
  else if(table==="profiles")body=profile;
  else if(table==="system_settings")body={mask_cpf:false,file_retention:"NONE",financial_tolerance:.01};
  else if(table==="payroll_imports")body=target.searchParams.has("competence")?months.find(m=>equal("competence",m.competence))??null:months;
  else if(table==="payroll_sources")body=sources.filter(s=>equal("payroll_import_id",s.payroll_import_id));
  else if(table==="payroll_records")body=records.filter(r=>equal("payroll_import_id",r.payroll_import_id)&&equal("cpf",r.cpf)).map(r=>({...r,payroll_imports:{competence:months.find(m=>m.id===r.payroll_import_id).competence}}));
  else if(table==="payroll_comparisons")body=null;
  else if(table==="user_presence")body={};
  else if(table==="save_payroll_sources"){
    const args=request.postDataJSON();saves.push(args);
    // Rejection simulates server guard; the database suite tests its actual SQL.
    let month=months.find(m=>m.competence===args.p_competence);
    if(args.p_sources.some(s=>sources.some(old=>old.payroll_import_id===month?.id&&old.id!==s.source_id&&old.file_hash===s.file_hash))){await route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({code:"P0001",message:"Este arquivo já foi importado nesta competência. Não será somado novamente"})});return;}
    if(!month){month={id:crypto.randomUUID(),competence:args.p_competence,updated_at:new Date().toISOString(),imported_by_name:profile.full_name,logs:[]};months.push(month);}
    let added=0,updated=0;
    for(const source of args.p_sources){
      let row=sources.find(s=>s.id===source.source_id);
      if(row){updated++;for(let index=records.length-1;index>=0;index--)if(records[index].source_id===row.id)records.splice(index,1);}
      else{added++;row={id:crypto.randomUUID(),payroll_import_id:month.id};sources.push(row);}
      Object.assign(row,{label:source.label,file_name:source.file_name,file_size:source.file_size,file_hash:source.file_hash,record_count:source.records.length,updated_at:new Date(Date.UTC(2026,9,20,12,0,++revision)).toISOString(),imported_by_name:profile.full_name});
      records.push(...source.records.map(record=>({...record,id:crypto.randomUUID(),source_id:row.id,payroll_import_id:month.id})));
    }
    refresh(month);body={id:month.id,added,updated,record_count:month.record_count};
  }else if(table==="admin_delete_payroll_source"){
    const args=request.postDataJSON(),index=sources.findIndex(s=>s.id===args.p_source_id),source=sources[index];assert.ok(source);
    sources.splice(index,1);for(let i=records.length-1;i>=0;i--)if(records[i].source_id===source.id)records.splice(i,1);
    refresh(months.find(m=>m.id===source.payroll_import_id));body=true;
  }
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
const passed=[];
async function workbook(name,rows){
  const bytes=await page.evaluate(async rows=>{const XLSX=await import("/node_modules/xlsx/xlsx.mjs"),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["CPF","NOME","LÍQUIDO","TOTAL PROVENTOS","TOTAL DESCONTOS","PLANO SAÚDE","PLANO ODONTO"],...rows]),"Folha");return [...new Uint8Array(XLSX.write(book,{type:"array",bookType:"xlsx"}))];},rows);
  return{name,mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(bytes)};
}
const monthPicker=()=>page.getByRole("combobox",{name:"Mês da importação",exact:true}),yearPicker=()=>page.getByRole("combobox",{name:"Ano da importação",exact:true});
const importButton=()=>page.getByRole("button",{name:"Importar folhas selecionadas",exact:true});
async function addFiles(files){await page.locator('input[type="file"]').setInputFiles(files);await page.getByRole("button",{name:"Analisar arquivos",exact:true}).waitFor();}
async function analyzeFiles(){await page.getByRole("button",{name:"Analisar arquivos",exact:true}).click();await page.getByRole("region",{name:"Prévia da importação",exact:true}).waitFor();}
async function importSelected(){await analyzeFiles();await importButton().click();}
async function consolidate(){return page.evaluate(async()=>{const service=await import("/src/services/browser-backend.ts");return service.loadPayrollMonth("10/2026");});}
try{
  await page.goto(url+"/payroll");await page.getByRole("heading",{name:"Importar Folha de Pagamento",exact:true}).waitFor();
  await monthPicker().selectOption("10");await yearPicker().selectOption("2026");
  const dmv=await workbook("DMV Natal.xlsx",[["00000000001","Ana Teste",100,112,12,10,2]]),vna=await workbook("VNA.xlsx",[["00000000002","Bruna Teste",200,224,24,20,4]]),rdt=await workbook("RDT.xlsx",[["00000000003","Clara Teste",300,336,36,30,6]]);
  await addFiles([dmv,vna,rdt]);assert.equal(await page.locator(".payroll-import-choice").count(),3);await importSelected();await page.getByRole("heading",{name:"Folhas importadas · 10/2026",exact:true}).waitFor();
  assert.equal(months.length,1);assert.equal(sources.length,3);assert.equal(months[0].record_count,3);assert.equal(saves[0].p_sources.length,3);assert.equal((await consolidate()).records.reduce((sum,r)=>sum+r.liquid,0),600);passed.push("three XLSX files imported together, one month, all CPFs preserved");
  await page.getByRole("button",{name:"Adicionar folhas",exact:true}).click();const updated=await workbook("VNA corrigida.xlsx",[["00000000002","Bruna Teste",250,274,24,20,4]]);
  await addFiles(updated);const choice=page.locator(".payroll-import-choice");await choice.getByRole("combobox").selectOption(sources.find(s=>s.label==="VNA").id);await importSelected();await page.getByRole("dialog").waitFor();await page.getByRole("button",{name:"Confirmar atualização das folhas",exact:true}).click();await page.getByRole("heading",{name:"Folhas importadas · 10/2026",exact:true}).waitFor();
  assert.equal(sources.length,3);assert.equal((await consolidate()).records.reduce((sum,r)=>sum+r.liquid,0),650);assert.ok(saves[1].p_sources[0].expected_updated_at);passed.push("explicit VNA replacement confirmed without replacing DMV or RDT");
  await page.getByRole("button",{name:"Adicionar folhas",exact:true}).click();const extras=[];for(let i=1;i<=5;i++)extras.push(await workbook(`Complementar ${i}.xlsx`,[["00000000001","Ana Teste",i,i+2,2,1,1]]));await addFiles(extras);await importSelected();await page.getByRole("heading",{name:"Folhas importadas · 10/2026",exact:true}).waitFor();
  const all=await consolidate();assert.equal(all.records.find(r=>r.cpf==="00000000001").liquid,115);assert.equal(all.records.find(r=>r.cpf==="00000000001").audit.occurrences.length,6);
  const history=await page.evaluate(async()=>{const service=await import("/src/services/payroll-audit.ts");return service.loadEmployeePayrollHistory("00000000001","10/2026");});assert.equal(history.length,1);assert.equal(history[0].record.liquid,115);assert.equal(history[0].record.healthTotal,15);passed.push("all six CPF origins are summed in monthly comparisons and employee history, without month-count truncation");
  await page.getByRole("button",{name:"Adicionar folhas",exact:true}).click();await addFiles({...dmv,name:"Renomeada.xlsx"});await importSelected();await page.getByText(/Este arquivo já foi importado nesta competência/).first().waitFor();assert.equal(sources.length,8);passed.push("same file renamed is blocked instead of counted twice");
  await page.getByRole("button",{name:"Visão geral",exact:true}).click();await page.getByRole("button",{name:"Remover folha RDT",exact:true}).click();await page.getByRole("button",{name:"Remover somente esta folha",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".payroll-sources-table tbody tr").length===7);assert.equal(sources.length,7);assert.equal((await consolidate()).records.reduce((sum,r)=>sum+r.liquid,0),365);passed.push("admin removes just one source and totals recalculate");
  await page.reload();await page.getByRole("heading",{name:"Folhas importadas · 10/2026",exact:true}).waitFor();assert.equal(await page.locator(".payroll-sources-table tbody tr").count(),7);passed.push("reload retains all remaining source files");
  await page.getByRole("button",{name:"Adicionar folhas",exact:true}).click();await monthPicker().selectOption("09");await yearPicker().selectOption("2025");await page.getByText("0 folha(s) já cadastrada(s)",{exact:false}).waitFor();const old=await workbook("Folha anterior.xlsx",[["00000000004","Pessoa Teste",50,56,6,5,1]]);await addFiles(old);await importSelected();await page.getByRole("heading",{name:"Folhas importadas · 09/2025",exact:true}).waitFor();assert.equal(months.length,2);assert.equal(months.find(m=>m.competence==="10/2026").record_count,2);passed.push("month/year menu selects a different competence without changing October");
  await page.getByRole("button",{name:"Adicionar folhas",exact:true}).click();
  await mkdir("tmp/payroll-sources-qa",{recursive:true});
  const fixturePath="tmp/payroll-sources-qa/extrato-ficticio.pdf";
  const fixture=spawnSync(process.env.PAYROLL_TEST_PYTHON??"python",["tests/fixtures/render-payroll.py",fixturePath],{input:JSON.stringify(payrollPdfFixture()),encoding:"utf8"});assert.equal(fixture.status,0,fixture.stderr);
  const pdfFile={name:"Extrato ficticio.pdf",mimeType:"application/pdf",buffer:await readFile(fixturePath)};
  const savedBefore=saves.length;
  await yearPicker().selectOption("2026");await monthPicker().selectOption("08");await addFiles(pdfFile);await page.getByRole("button",{name:"Analisar arquivos",exact:true}).click();await page.getByRole("alert").filter({hasText:"O PDF é da competência 09/2026"}).waitFor();assert.equal(saves.length,savedBefore);passed.push("PDF competence mismatch blocks saving instead of assigning the selected month");
  await monthPicker().selectOption("09");const other=await workbook("Outra empresa.xlsx",[["00000000004","Pessoa Teste",50,56,6,5,1]]);await addFiles(other);await analyzeFiles();
  assert.equal(saves.length,savedBefore);assert.equal(await page.locator(".payroll-import-preview article").count(),2);assert.ok(await importButton().isDisabled());await page.getByRole("checkbox",{name:"Li os avisos e conferi os valores antes de importar.",exact:true}).check();
  await page.screenshot({path:"tmp/payroll-sources-qa/pdf-preview-desktop.png",fullPage:true});await page.setViewportSize({width:390,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:"tmp/payroll-sources-qa/pdf-preview-mobile.png",fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>document.documentElement.dataset.theme="dark");await page.locator(".payroll-import-preview").scrollIntoViewIfNeeded();await page.screenshot({path:"tmp/payroll-sources-qa/pdf-preview-dark.png",fullPage:true});await page.evaluate(()=>document.documentElement.dataset.theme="light");
  await importButton().click();await page.getByRole("heading",{name:"Folhas importadas · 09/2026",exact:true}).waitFor();
  const pdfSource=sources.find(s=>s.file_name===pdfFile.name),pdfRows=records.filter(r=>r.source_id===pdfSource.id);assert.equal(pdfRows.length,3);assert.equal(months.find(m=>m.competence==="09/2026").record_count,4);assert.equal(pdfRows.find(r=>r.cpf==="00000000001").audit_data.events.find(e=>e.code==="150").references[0].raw,"21:55");
  await page.reload();await page.getByRole("heading",{name:"Folhas importadas · 09/2026",exact:true}).waitFor();const persisted=await page.evaluate(async()=>{const service=await import("/src/services/browser-backend.ts");return service.loadPayrollMonth("09/2026");});assert.equal(persisted.records.find(r=>r.cpf==="00000000003").audit.events.find(e=>e.code==="51").kind,"deduction");passed.push("mixed PDF/Excel batch previews totals, requires warning acknowledgement, persists references/P-D and survives reload");
  await page.goto(url+"/conferencia");await page.getByRole("button",{name:"ANA TESTE",exact:true}).click();const detail=page.getByRole("dialog");await detail.getByRole("columnheader",{name:"Referência atual",exact:true}).waitFor();await detail.getByRole("cell",{name:"21:55 h",exact:true}).waitFor();assert.ok(await detail.getByRole("cell",{name:/347,75/}).count());await detail.getByRole("heading",{name:"Comparativo detalhado de eventos",exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:"tmp/payroll-sources-qa/pdf-audit-references.png"});await page.goto(url+"/payroll");await page.getByRole("heading",{name:"Folhas importadas · 09/2026",exact:true}).waitFor();passed.push("audit dialog shows hours and percentages separately from reais after persistence");
  await page.getByRole("button",{name:"Adicionar folhas",exact:true}).click();const alternative=await workbook("Alternativa Excel.xlsx",[["00000000001","Ana Teste",1914.69,2598.7,684.01,419,55.45],["00000000002","Bruno Teste",0,100,100,0,0],["00000000003","Carla Teste",180,200,20,0,0]]);await addFiles(alternative);await importSelected();await page.getByRole("alert").filter({hasText:"Possível folha duplicada"}).waitFor();assert.equal(saves.length,savedBefore+1);
  await page.locator(".payroll-import-choice").getByRole("combobox").selectOption(pdfSource.id);await importSelected();await page.getByRole("button",{name:"Confirmar atualização das folhas",exact:true}).click();await page.getByRole("heading",{name:"Folhas importadas · 09/2026",exact:true}).waitFor();assert.equal(sources.filter(s=>s.payroll_import_id===pdfSource.payroll_import_id).length,2);passed.push("same net payments from Excel cannot be added alongside PDF, but explicit source replacement succeeds");
  await page.getByRole("button",{name:"Adicionar folhas",exact:true}).click();const blank=await PDFDocument.create();blank.addPage();const invalid={name:"Digitalizado.pdf",mimeType:"application/pdf",buffer:Buffer.from(await blank.save())};await addFiles([{...other,name:"Outra valida.xlsx"},invalid]);const beforeInvalid=saves.length;await page.getByRole("button",{name:"Analisar arquivos",exact:true}).click();await page.getByRole("alert").filter({hasText:"não há texto extraível"}).waitFor();assert.equal(saves.length,beforeInvalid);assert.equal(await page.locator(".payroll-import-preview").count(),0);passed.push("unreadable PDF aborts the complete batch without saving the valid Excel first");
  await page.getByRole("button",{name:"Remover Digitalizado.pdf",exact:true}).click();await analyzeFiles();await monthPicker().selectOption("08");assert.equal(await importButton().count(),0);passed.push("changing competence invalidates the preview and cannot save stale analysis");
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await mkdir("tmp/payroll-sources-qa",{recursive:true});await page.screenshot({path:"tmp/payroll-sources-qa/month-picker-mobile.png",fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(JSON.stringify({passed,pageErrors:errors,unexpectedNetwork:unexpected},null,2));
}catch(error){await mkdir("tmp/payroll-sources-qa",{recursive:true});await page.screenshot({path:"tmp/payroll-sources-qa/failure.png",fullPage:true});console.log((await page.locator("body").textContent()).slice(-2500));throw error;}finally{await browser.close();}
