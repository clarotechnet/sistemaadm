// Installs only the new meal-rate migration. Without --apply this is read-only.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const ref = process.argv.find(value => value.startsWith("--project="))?.slice(10);
assert.equal(ref, "kdbnheeosaptxpwkmjbz", "Informe explicitamente o Supabase RH correto.");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + ".supabase.co", "A URL pública não pertence ao RH confirmado.");
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).username).split(".").at(-1), ref, "A conexão de banco não pertence ao RH confirmado.");
const migration = await readFile("supabase/migrations/20261110132307_benefit_meal_daily_rates.sql", "utf8");
const original = await readFile("supabase/migrations/20261109181644_benefit_meal_period_snapshots.sql", "utf8");
const apply = process.argv.includes("--apply");
const db = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const tables = ["benefit_meal_runs", "benefit_meal_rows", "benefit_meal_events"];
const protectedTables = [...tables, "employees", "employee_documents", "payroll_imports", "payroll_records", "benefit_aggregation_base", "benefit_aggregation_monthly", "benefit_plan_base_versions", "rh_unit_catalog", "quark_unit_mappings", "quark_team_mappings"];
const signature = "public.complete_benefit_meal_calculated_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb)";
const normalize = value => value.replace(/\s+/g, " ").trim();
async function exists(sql, table) { return Boolean((await sql`select to_regclass(${"public." + table}) name`)[0].name); }
async function snapshot(sql) {
  const result = {};
  for (const table of protectedTables) if (await exists(sql, table)) {
    const row = table === "benefit_meal_rows" ? "to_jsonb(t)-array['calculation_version','calculation_status','calculation_notes']" : "to_jsonb(t)";
    result[table] = (await sql.unsafe(`select md5(coalesce(string_agg(j::text,'|' order by j::text),'')) hash from(select ${row} j from public.${table} t)s`))[0].hash;
  }
  return result;
}
async function verify(sql) {
  const [fn] = await sql`select p.prosecdef,p.prosrc,p.proconfig from pg_proc p where p.oid=${signature}::regprocedure`;
  assert.equal(fn.prosecdef, false); assert.ok(fn.proconfig.some(setting => setting.startsWith("search_path=")));
  assert.equal(normalize(fn.prosrc), normalize(migration.split("as $$")[1].split("$$;")[0]));
  for (const role of ["anon", "authenticated", "service_role"]) assert.equal((await sql`select has_function_privilege(${role},${signature},'EXECUTE') permitted`)[0].permitted, role === "service_role");
  for (const table of tables) {
    assert.equal((await sql`select relrowsecurity rls from pg_class where oid=${"public." + table}::regclass`)[0].rls, true);
    for (const role of ["anon", "authenticated"]) for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", ...(role === "anon" ? ["SELECT"] : [])]) assert.equal((await sql`select has_table_privilege(${role},${"public." + table},${privilege}) permitted`)[0].permitted, false);
  }
  const constraints = await sql`select conname from pg_constraint where conrelid='public.benefit_meal_rows'::regclass and contype='c'`;
  for (const name of ["benefit_meal_calculation_shape", "benefit_meal_approved_rates", "benefit_meal_amount_consistency"]) assert.ok(constraints.some(item => item.conname === name));
}
try {
  const result = await db.begin(async sql => {
    if (!apply) await sql.unsafe("set transaction read only");
    for (const table of tables) assert.equal(await exists(sql, table), true, "Instale primeiro a estrutura inicial de Vale Alimentação.");
    const [oldRpc] = await sql`select prosrc from pg_proc where oid='public.complete_benefit_meal_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure`;
    assert.equal(normalize(oldRpc.prosrc), normalize(original.split("as $$")[1].split("$$;")[0]), "A função original mudou; interrompido para preservar as consultas.");
    const columns = await sql`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='benefit_meal_rows' and column_name in('calculation_version','calculation_status','calculation_notes')`;
    const [functionState] = await sql`select to_regprocedure(${signature}) present`;
    assert.ok((columns[0].n === 0 && !functionState.present) || (columns[0].n === 3 && functionState.present), "Instalação parcial encontrada. Interrompido sem modificar o banco.");
    let installedNow = false;
    if (!functionState.present && apply) {
      await sql.unsafe("set local lock_timeout='5s'; set local statement_timeout='90s'; select pg_advisory_xact_lock(hashtext('rh_meal_rates_install'))");
      const before = await snapshot(sql);
      await sql.unsafe(migration); await verify(sql);
      assert.deepEqual(await snapshot(sql), before, "Os dados anteriores precisam ser preservados.");
      installedNow = true;
    } else if (functionState.present) await verify(sql);
    return { project: ref, installed: Boolean(functionState.present) || installedNow, installedNow, previousQueriesAndPayrollPreserved: true };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await db.end({ timeout: 2 }); }
