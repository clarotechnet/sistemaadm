// Installs this one additive RH migration only. Default mode is read-only.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const ref = process.argv.find(value => value.startsWith("--project="))?.slice(10);
assert.equal(ref, "kdbnheeosaptxpwkmjbz", "Informe explicitamente o projeto Supabase RH correto.");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + ".supabase.co", "A URL pública não pertence ao RH confirmado.");
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).username).split(".").at(-1), ref, "A conexão de banco não pertence ao RH confirmado.");
const migration = await readFile("supabase/migrations/20261110112827_quark_unit_team_mapping.sql", "utf8");
const apply = process.argv.includes("--apply");
const db = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const catalog = ["rh_unit_catalog", "quark_unit_mappings", "quark_team_mappings"];
const protectedTables = ["payroll_imports", "payroll_records", "employee_documents", "benefit_aggregation_base", "benefit_aggregation_monthly", "benefit_plan_base_versions", "benefit_meal_runs", "benefit_meal_rows", "benefit_meal_events"];
const employeeColumns = "id,full_name,cpf,document_number,registration,department,job_title,status,source,external_id,external_unit_id,external_unit_name,external_team_id,external_team_name,admission_date,termination_date,last_synced_at,created_by,updated_by";
async function exists(sql, table) { return Boolean((await sql`select to_regclass(${"public." + table}) name`)[0].name); }
async function snapshot(sql) {
 const result = {};
 for (const table of protectedTables) if (await exists(sql, table)) result[table] = (await sql.unsafe(`select md5(coalesce(string_agg(row_to_json(t)::text,'|' order by row_to_json(t)::text),'')) hash from public.${table} t`))[0].hash;
 result.employees = (await sql.unsafe(`select md5(coalesce(string_agg(row_to_json(t)::text,'|' order by id),'')) hash from(select ${employeeColumns} from public.employees)t`))[0].hash;
 return result;
}
async function verify(sql) {
 for (const table of catalog) {
  const [state] = await sql`select relrowsecurity rls from pg_class where oid=${"public." + table}::regclass`; assert.equal(state.rls, true);
  for (const role of ["anon", "authenticated"]) for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", ...(role === "anon" ? ["SELECT"] : [])]) assert.equal((await sql`select has_table_privilege(${role},${"public." + table},${privilege}) permitted`)[0].permitted, false);
 }
 for (const signature of ["discover_quark_rh_units(jsonb)", "save_quark_rh_mapping(uuid,text,jsonb)", "complete_quark_rh_sync(uuid,uuid,jsonb,integer,integer,integer)"]) {
  const [fn] = await sql`select p.prosecdef from pg_proc p where p.oid=${"public." + signature}::regprocedure`; assert.equal(fn.prosecdef, false);
  for (const role of ["anon", "authenticated", "service_role"]) assert.equal((await sql`select has_function_privilege(${role},${"public." + signature},'EXECUTE') permitted`)[0].permitted, role === "service_role");
 }
 assert.equal((await sql`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='employees' and column_name in('mapped_unit_name','mapped_city','quark_mapping_pending')`)[0].n, 3);
}
try {
 const result = await db.begin(async sql => {
  if (!apply) await sql.unsafe("set transaction read only");
  const present = await Promise.all(catalog.map(table => exists(sql, table)));
  assert.ok(present.every(Boolean) || present.every(value => !value), "Instalação parcial encontrada; interrompido sem modificar o banco.");
  let installedNow = false;
  if (!present[0] && apply) {
   await sql.unsafe("set local lock_timeout='5s'; set local statement_timeout='90s'; select pg_advisory_xact_lock(hashtext('rh_quark_mapping_install'))");
   const before = await snapshot(sql); await sql.unsafe(migration); await verify(sql); assert.deepEqual(await snapshot(sql), before, "Dados existentes precisam ser preservados."); installedNow = true;
  } else if (present[0]) await verify(sql);
  const installed = present[0] || installedNow;
  const selected = installed ? await sql`select external_unit_id,external_unit_name from public.quark_unit_mappings where sync_enabled order by external_unit_id` : [];
  return { project: ref, installed, installedNow, selectedUnits: selected, existingEmployeeSourceAndPayrollDataPreserved: true };
 });
 console.log(JSON.stringify(result, null, 2));
} finally { await db.end({ timeout: 2 }); }
