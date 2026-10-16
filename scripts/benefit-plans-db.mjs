// Explicitly guarded RH schema verification/application and initial file import.
// node --import tsx scripts/benefit-plans-db.mjs --project=kdbnheeosaptxpwkmjbz [--apply] [--seed-files --competence=2026-09]
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({path:".env.local",quiet:true});
const ref=process.argv.find(value=>value.startsWith("--project="))?.slice(10);
assert.equal(ref,"kdbnheeosaptxpwkmjbz","Informe explicitamente o projeto RH correto.");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,ref+".supabase.co");
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).username).split(".").at(-1),ref);
const db=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const filename=(await readdir("supabase/migrations")).find(file=>file.endsWith("_benefit_plan_bases.sql"));
const migration=await readFile("supabase/migrations/"+filename,"utf8");
const rollback=new Error("VERIFIED_ROLLBACK");
const snapshot=async sql=>(await sql.unsafe("select md5(coalesce(string_agg(row_to_json(c)::text,'|' order by id),'')) as hash from public.payroll_comparisons c"))[0].hash;
try {
  const before=await snapshot(db);
  try {
    await db.begin(async sql=>{
      await sql.unsafe(migration);
      const [actor]=await sql.unsafe("select id from public.profiles where status='ATIVO' and role='ADMINISTRADOR' limit 1");
      assert.ok(actor,"Administrador ativo necessário para testar RLS.");
      const cpf="52998224725";
      const [occupied]=await sql.unsafe("select count(*)::int as n from public.benefit_plan_base_versions where cpf=$1",[cpf]);
      assert.equal(occupied.n,0,"CPF de teste já ocupado; não alterar cadastro real.");
      await sql.unsafe("set local role authenticated");
      await sql.unsafe("select set_config('request.jwt.claim.sub',$1,true)",[actor.id]);
      const row={cpf,name:"Teste transacional Plano",value:100,status:"ATIVO"};
      const save=async(kind,date,value)=>sql.unsafe("select public.save_benefit_plan_base($1,$2,$3::text::jsonb,'Teste transacional')",[kind,date,JSON.stringify([{...row,...value}])]);
      await save("health","1901-01-01",{});
      await save("health","1901-02-01",{value:120});
      await save("health","1901-03-01",{value:120,status:"INATIVO"});
      await save("dental","1901-01-01",{value:20});
      const history=await sql.unsafe("select kind,effective_from::text,discount_value::float as value,status,revision,created_by from public.benefit_plan_base_versions where cpf=$1 order by kind,effective_from,revision",[cpf]);
      assert.equal(history.length,4);assert.equal(history[1].value,100);assert.equal(history[3].status,"INATIVO");assert.equal(history[3].revision,3);assert.equal(history[3].created_by,actor.id);
      await sql.unsafe("savepoint blocked_update");
      await assert.rejects(sql.unsafe("update public.benefit_plan_base_versions set discount_value=999 where cpf=$1",[cpf]),e=>e.code==="42501");
      await sql.unsafe("rollback to savepoint blocked_update");
      await sql.unsafe("savepoint blocked_delete");
      await assert.rejects(sql.unsafe("delete from public.benefit_plan_base_versions where cpf=$1",[cpf]),e=>e.code==="42501");
      await sql.unsafe("rollback to savepoint blocked_delete");
      await save("dental","1901-02-01",{value:null,status:"PENDENTE"});
      await sql.unsafe("savepoint invalid_value");
      await assert.rejects(save("health","1901-04-01",{value:-1}),e=>e.code==="23514");
      await sql.unsafe("rollback to savepoint invalid_value");
      await sql.unsafe("select set_config('request.jwt.claim.sub',$1,true)",[crypto.randomUUID()]);
      assert.equal((await sql.unsafe("select count(*)::int as n from public.benefit_plan_base_versions"))[0].n,0);
      await sql.unsafe("savepoint blocked_identity");await assert.rejects(save("health","1901-04-01",{}));await sql.unsafe("rollback to savepoint blocked_identity");
      await sql.unsafe("reset role");
      const [privileges]=await sql.unsafe("select has_table_privilege('anon','public.benefit_plan_base_versions','SELECT') as anon_read,has_function_privilege('anon','public.save_benefit_plan_base(text,date,jsonb,text)','EXECUTE') as anon_execute");
      assert.equal(privileges.anon_read,false);assert.equal(privileges.anon_execute,false);
      assert.equal(await snapshot(sql),before);
      throw rollback;
    });
  }catch(e){if(e!==rollback)throw e;}
  console.log("PASS: vigência, versões, planos separados, pendência sem valor, RLS, bloqueio de UPDATE/DELETE e comparativos preservados. Testes revertidos.");
  if(process.argv.includes("--apply")) {
    await db.begin(sql=>sql.unsafe(migration));
    assert.equal(await snapshot(db),before);
    console.log("Schema dos planos aplicado exclusivamente no RH confirmado.");
  }
  if(process.argv.includes("--seed-files")) {
    assert.ok(process.argv.includes("--apply"),"A importação inicial exige --apply.");
    const month=process.argv.find(value=>value.startsWith("--competence="))?.slice(13);
    assert.equal(month,"2026-09","Os arquivos fornecidos declaram setembro/2026.");
    const XLSX=await import("xlsx");
    const {findHeaderRow}=await import("../src/services/excel.ts");
    const {parsePlanBase}=await import("../src/modules/benefits/plan-base.ts");
    const {normalizeHeader}=await import("../src/utils/text.ts");
    for(const [kind,file] of [["health","C:/Users/Usuario/Downloads/hapvida base.xlsx"],["dental","C:/Users/Usuario/Downloads/ODONTO base.xlsx"]]) {
      const bytes=await readFile(file),hash=createHash("sha256").update(bytes).digest("hex"),workbook=XLSX.read(bytes,{type:"buffer",cellDates:true});
      const parsed=parsePlanBase({fileName:basename(file),fileSize:bytes.length,warnings:[],sheets:workbook.SheetNames.map(name=>{const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:"",raw:true});const headerRow=findHeaderRow(rows),headers=rows[headerRow].map(String);return{name,headerRow,headers,normalizedHeaders:headers.map(normalizeHeader),rows:rows.slice(headerRow+1)};})},kind);
      const count=await db.begin(async sql=>{
        const existing=await sql.unsafe("select metadata->>'sourceSha256' as hash from public.benefit_plan_base_versions where kind=$1",[kind]);
        if(existing.length){assert.ok(existing.every(row=>row.hash===hash),"Já existe uma base diferente. Utilize a importação da interface para não sobrescrever edições.");return 0;}
        await sql.unsafe("insert into public.benefit_plan_base_versions(kind,cpf,employee_name,company,city,department,plan_name,discount_value,status,effective_from,revision,source,notes,metadata,created_by_name) select $1,r.cpf,r.name,r.company,r.city,r.department,r.plan,r.value,r.status,$2,1,$3,r.notes,r.metadata||jsonb_build_object('sourceSha256',$4::text),'' from jsonb_to_recordset($5::text::jsonb) as r(cpf text,name text,company text,city text,department text,plan text,value numeric,status text,notes text,metadata jsonb)",[kind,month+"-01",basename(file),hash,JSON.stringify(parsed.records)]);
        return parsed.records.length;
      });
      console.log(JSON.stringify({kind,inserted:count,records:parsed.records.length,pending:parsed.records.filter(row=>row.status==="PENDENTE").length,totalActive:Math.round(parsed.records.filter(row=>row.status==="ATIVO").reduce((s,r)=>s+(r.value??0),0)*100)/100,issues:parsed.issues}));
    }
    assert.equal(await snapshot(db),before);
  }
}finally{await db.end({timeout:2});}
