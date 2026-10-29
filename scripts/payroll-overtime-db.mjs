// Read-only unless --apply. No user document is imported by this installer.
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {config} from "dotenv";
import postgres from "postgres";

config({path:".env.local",quiet:true});
const project=process.argv.find(value=>value.startsWith("--project="))?.slice(10);
assert.equal(project,"kdbnheeosaptxpwkmjbz","Informe explicitamente o projeto RH correto");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,`${project}.supabase.co`,"Projeto público diferente do RH");
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).username).split(".").at(-1),project,"Conexão PostgreSQL diferente do RH");
const db=postgres(process.env.DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const protectedTables=["profiles","employees","payroll_imports","payroll_sources","payroll_records","payroll_comparisons","payroll_comparison_rows","payroll_audit_reviews"];
async function snapshot(sql){const result={};for(const table of protectedTables){[result[table]]=await sql.unsafe(`select count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from public.${table} t`);}return result;}
async function security(sql){
  const [row]=await sql.unsafe(`select (select relrowsecurity from pg_class where oid='public.payroll_overtime_references'::regclass) rls,
    exists(select 1 from pg_policies where schemaname='public' and tablename='payroll_overtime_references' and cmd='SELECT' and qual like '%is_rh_or_admin%') rh_read_policy,
    not has_table_privilege('anon','public.payroll_overtime_references','SELECT') no_anon_read,
    not has_table_privilege('authenticated','public.payroll_overtime_references','INSERT,UPDATE,DELETE') no_direct_write,
    not has_function_privilege('anon','public.save_payroll_overtime_reference(uuid,uuid,text,text,text,jsonb,uuid,timestamptz)','EXECUTE') no_anon_save,
    not has_function_privilege('anon','public.map_payroll_overtime_reference(uuid,text,text,timestamptz,timestamptz)','EXECUTE') no_anon_map,
    not has_function_privilege('anon','public.admin_delete_payroll_overtime_reference(uuid,timestamptz)','EXECUTE') no_anon_delete,
    not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_payroll_overtime_reference','map_payroll_overtime_reference','admin_delete_payroll_overtime_reference') and p.prosecdef) invoker_entrypoints`);
  assert.ok(Object.values(row).every(value=>value===true),"A segurança da nova estrutura não foi validada: "+JSON.stringify(row));return row;
}
try{
  await db.begin(async sql=>{
    const apply=process.argv.includes("--apply");if(!apply)await sql.unsafe("set transaction read only");
    await sql.unsafe("set local lock_timeout='5s';set local statement_timeout='60s'");
    const before=await snapshot(sql);
    const [state]=await sql.unsafe("select to_regclass('public.payroll_overtime_references') is not null installed,to_regnamespace('payroll_private') is not null private_present");
    assert.equal(state.private_present,true,"O schema privado do RH não está instalado");
    if(!state.installed&&apply){
      const file=(await readdir("supabase/migrations")).find(file=>file.endsWith("_payroll_overtime_references.sql"));assert.ok(file);
      await sql.unsafe(await readFile(`supabase/migrations/${file}`,"utf8"));
      assert.deepEqual(await snapshot(sql),before,"Dados anteriores divergiram; operação revertida");
      console.log(JSON.stringify({verifiedProject:project,applied:file,preserved:Object.fromEntries(Object.entries(before).map(([table,row])=>[table,row.count])),security:await security(sql)}));
    }else console.log(JSON.stringify({verifiedProject:project,installed:state.installed,counts:Object.fromEntries(Object.entries(before).map(([table,row])=>[table,row.count])),security:state.installed?await security(sql):null,action:"Somente leitura; nenhuma estrutura reaplicada"}));
  });
}finally{await db.end({timeout:2});}
