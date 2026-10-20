// Read-only by default. Explicit --apply updates only the verified RH project.
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {config} from "dotenv";
import postgres from "postgres";

config({path:".env.local",quiet:true});
const expected=process.argv.find(value=>value.startsWith("--project="))?.slice(10);
const publicUrl=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL),databaseUrl=new URL(process.env.DATABASE_URL);
assert.ok(expected,"Informe explicitamente --project=REFERENCIA_DO_RH");
assert.equal(publicUrl.hostname,`${expected}.supabase.co`,"A URL pública não corresponde ao projeto solicitado");
assert.equal(decodeURIComponent(databaseUrl.username).split(".").at(-1),expected,"A conexão PostgreSQL não corresponde ao projeto solicitado");
const db=postgres(databaseUrl.href,{max:1,connect_timeout:15,onnotice:()=>{}});
const protectedTables=["payroll_imports","payroll_records","payroll_comparisons","payroll_comparison_rows","payroll_audit_reviews"];
async function snapshot(sql){
  const value={};
  for(const table of protectedTables){
    const [row]=await sql.unsafe(`select count(*)::int count,md5(coalesce(string_agg((to_jsonb(t)-'source_id')::text,'' order by (to_jsonb(t)-'source_id')::text),'')) hash from public.${table} t`);
    value[table]=row;
  }
  return value;
}
async function security(sql){
  const [result]=await sql.unsafe(`select
    (select relrowsecurity from pg_class where oid='public.payroll_sources'::regclass) rls,
    exists(select 1 from pg_policies where schemaname='public' and tablename='payroll_sources' and cmd='SELECT' and qual like '%is_rh_or_admin%') policy,
    not has_table_privilege('anon','public.payroll_sources','SELECT') no_anon_read,
    not has_table_privilege('authenticated','public.payroll_sources','INSERT,UPDATE,DELETE') no_direct_write,
    not has_function_privilege('anon','public.save_payroll_sources(text,jsonb)','EXECUTE') no_anon_rpc,
    not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_payroll_sources','admin_delete_payroll_source','save_payroll_month') and p.prosecdef) invoker_entrypoints,
    not exists(select 1 from public.payroll_records where source_id is null) records_linked`);
  assert.ok(Object.values(result).every(value=>value===true),"A validação de segurança/vínculos falhou: "+JSON.stringify(result));
  return result;
}
try{
  await db.begin(async sql=>{
    if(!process.argv.includes("--apply"))await sql.unsafe("set transaction read only");
    await sql.unsafe("set local lock_timeout='5s';set local statement_timeout='60s'");
    const tables=await sql.unsafe("select tablename from pg_tables where schemaname='public' and tablename in ('employees','profiles','payroll_imports','payroll_records','payroll_comparisons','payroll_comparison_rows','payroll_audit_reviews')");
    assert.equal(tables.length,7,"A estrutura completa do RH não foi encontrada no projeto confirmado");
    const [installed]=await sql.unsafe("select to_regclass('public.payroll_sources') is not null installed");
    console.log(JSON.stringify({verifiedProject:expected,migrationInstalled:installed.installed}));
    if(!installed.installed){
      const constraints=await sql.unsafe("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.payroll_records'::regclass");
      assert.ok(constraints.some(row=>row.conname==='payroll_records_payroll_import_id_cpf_key'&&row.definition==='UNIQUE (payroll_import_id, cpf)'),"Estrutura de unicidade inesperada; migração recusada sem alterações");
      if(process.argv.includes("--apply")){
        await sql.unsafe(`lock table ${protectedTables.map(table=>"public."+table).join(",")} in share row exclusive mode`);
        const before=await snapshot(sql),file=(await readdir("supabase/migrations")).find(name=>name.endsWith("_payroll_multiple_sources.sql"));
        assert.ok(file,"Migration não encontrada");
        await sql.unsafe(await readFile(`supabase/migrations/${file}`,"utf8"));
        assert.deepEqual(await snapshot(sql),before,"Dados anteriores divergiram; toda a migração será revertida");
        await security(sql);
        console.log(JSON.stringify({applied:file,preserved:Object.fromEntries(Object.entries(before).map(([table,data])=>[table,data.count]))}));
      }else console.log(JSON.stringify({counts:Object.fromEntries(Object.entries(await snapshot(sql)).map(([table,data])=>[table,data.count])),action:"Inspeção somente leitura; nenhuma alteração aplicada"}));
    }else console.log(JSON.stringify({security:await security(sql),action:"Estrutura já instalada; nenhuma migração reaplicada"}));
  });
}finally{await db.end({timeout:2});}
