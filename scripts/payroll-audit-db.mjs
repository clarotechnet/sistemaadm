import { config } from "dotenv";
import postgres from "postgres";
import { readFile, readdir } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
const expectedRef = process.argv.find(value => value.startsWith("--project="))?.slice(10);
const publicUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const databaseUrl = new URL(process.env.DATABASE_URL);
const configuredRef = publicUrl.hostname.split(".")[0];
const databaseRef = decodeURIComponent(databaseUrl.username).split(".").at(-1);
if (!expectedRef || configuredRef !== expectedRef || databaseRef !== expectedRef) {
  throw new Error("Projeto recusado: a URL pública e a conexão PostgreSQL devem corresponder ao projeto informado.");
}
const db = postgres(process.env.DATABASE_URL, { connect_timeout: 15, max: 1 });
try {
  const tables = await db.unsafe("select table_name from information_schema.tables where table_schema='public' and table_name in ('employees','payroll_records','payroll_imports') order by table_name");
  if (tables.length !== 3) throw new Error("Estrutura do RH não encontrada no projeto confirmado.");
  console.log(JSON.stringify({ verifiedProject: expectedRef, tables: tables.map(row => row.table_name) }));
  if (process.argv.includes("--apply")) {
    const [installed] = await db.unsafe("select to_regclass('public.payroll_audit_reviews') is not null as reviews, exists(select 1 from information_schema.columns where table_schema='public' and table_name='payroll_records' and column_name='audit_data') as details, position('x.audit_data' in pg_get_functiondef('public.save_payroll_month(text,text,bigint,jsonb,jsonb)'::regprocedure))>0 as rpc, (select count(*) from pg_policies where schemaname='public' and tablename='payroll_audit_reviews' and policyname in ('payroll_audit_reviews_read','payroll_audit_reviews_insert','payroll_audit_reviews_update'))=3 as policies, exists(select 1 from pg_trigger where tgname='stamp_payroll_audit_review' and tgrelid=to_regclass('public.payroll_audit_reviews')) as stamp");
    if (Object.values(installed).every(Boolean)) {
      console.log("Migration de Conferência já presente; nenhuma alteração reaplicada.");
    } else {
      if (installed.reviews || installed.details) throw new Error("Estrutura de Conferência parcial. Inspecione o banco antes de reaplicar a migration.");
      const file = (await readdir("supabase/migrations")).find(name => name.endsWith("_payroll_audit_module.sql"));
      if (!file) throw new Error("Migration de Conferência não encontrada.");
      await db.begin(async transaction => { await transaction.unsafe(await readFile(`supabase/migrations/${file}`, "utf8")); });
      console.log("Migration de Conferência aplicada.");
    }
  }
  const counts = await db.unsafe("select (select count(*) from public.payroll_imports) as months, (select count(*) from public.payroll_records) as records, (select count(*) from public.employees) as employees");
  console.log(JSON.stringify(counts[0]));
  if (process.argv.includes("--inspect")) {
    const columns = await db.unsafe("select column_name from information_schema.columns where table_schema='public' and table_name='payroll_records'");
    const policies = await db.unsafe("select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in ('payroll_records','payroll_audit_reviews')");
    const rpc = await db.unsafe("select pg_get_functiondef('public.save_payroll_month(text,text,bigint,jsonb,jsonb)'::regprocedure) as definition");
    console.log(JSON.stringify({ columns: columns.map(row => row.column_name), policies, rpc: rpc[0].definition }));
  }
} finally { await db.end({ timeout: 2 }); }
