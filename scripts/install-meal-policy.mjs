// Default: read-only. --apply installs only the editable meal-rate migration.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const ref = process.argv.find(value => value.startsWith("--project="))?.slice(10);
assert.equal(ref, "kdbnheeosaptxpwkmjbz", "Informe explicitamente o projeto Supabase RH correto.");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + ".supabase.co", "A URL pública não pertence ao RH confirmado.");
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).username).split(".").at(-1), ref, "A conexão de banco não pertence ao RH confirmado.");
const migration = await readFile("supabase/migrations/20261110143715_benefit_meal_editable_rates.sql", "utf8");
const db = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const apply = process.argv.includes("--apply"), table = "public.benefit_meal_rate_versions";
const functions = [
  ["get_benefit_meal_rates", "date", ["authenticated", "service_role"]],
  ["save_benefit_meal_rates", "uuid,text,date,jsonb,text", ["service_role"]],
  ["complete_benefit_meal_versioned_run", "uuid,uuid,jsonb,jsonb,jsonb,jsonb", ["service_role"]],
];
async function snapshot(sql) {
  const result = {};
  for (const name of ["employees", "employee_documents", "payroll_imports", "payroll_records", "benefit_aggregation_base", "benefit_aggregation_monthly", "benefit_plan_base_versions", "benefit_meal_runs", "benefit_meal_rows", "benefit_meal_events"]) {
    if (!(await sql`select to_regclass(${"public." + name}) present`)[0].present) continue;
    const value = name === "benefit_meal_rows" ? "to_jsonb(t)-'rate_version_id'" : name === "benefit_meal_runs" ? "to_jsonb(t)-'rate_version_ids'" : "to_jsonb(t)";
    result[name] = (await sql.unsafe(`select md5(coalesce(string_agg(j::text,'|' order by j::text),'')) hash from(select ${value} j from public.${name} t)s`))[0].hash;
  }
  return result;
}
async function verify(sql) {
  assert.equal((await sql`select relrowsecurity rls from pg_class where oid=${table}::regclass`)[0].rls, true);
  for (const role of ["anon", "authenticated", "service_role"]) for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
    const permitted = (role !== "anon" && privilege === "SELECT") || (role === "service_role" && privilege === "INSERT");
    assert.equal((await sql`select has_table_privilege(${role},${table},${privilege}) permitted`)[0].permitted, permitted);
  }
  for (const [name, args, roles] of functions) {
    const signature = `public.${name}(${args})`;
    const [fn] = await sql`select prosecdef,prosrc from pg_proc where oid=${signature}::regprocedure`;
    assert.equal(fn.prosecdef, false);
    const expected = migration.slice(migration.indexOf(`create function public.${name}(`)).split("as $$")[1].split("$$;")[0];
    assert.equal(fn.prosrc.replace(/\s+/g, " ").trim(), expected.replace(/\s+/g, " ").trim());
    for (const role of ["anon", "authenticated", "service_role"]) assert.equal((await sql`select has_function_privilege(${role},${signature},'EXECUTE') permitted`)[0].permitted, roles.includes(role));
  }
  assert.equal((await sql`select count(*)::int n from pg_trigger where tgrelid='public.benefit_meal_rows'::regclass and tgname='benefit_meal_reject_outdated' and not tgisinternal`)[0].n, 1);
}
try {
  const result = await db.begin(async sql => {
    if (!apply) await sql.unsafe("set transaction read only");
    assert.ok((await sql`select to_regprocedure('public.complete_benefit_meal_calculated_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') present`)[0].present, "Instale primeiro os valores iniciais com scripts/install-meal-rates.mjs.");
    const present = Boolean((await sql`select to_regclass(${table}) present`)[0].present);
    const columns = (await sql`select count(*)::int n from information_schema.columns where table_schema='public' and ((table_name='benefit_meal_rows' and column_name='rate_version_id') or (table_name='benefit_meal_runs' and column_name='rate_version_ids'))`)[0].n;
    assert.ok((present && columns === 2) || (!present && columns === 0), "Instalação parcial encontrada. Interrompido sem alterar o banco.");
    let installedNow = false;
    if (!present && apply) {
      await sql.unsafe("set local lock_timeout='5s'; set local statement_timeout='90s'; select pg_advisory_xact_lock(hashtext('rh_meal_policy_install'))");
      const before = await snapshot(sql);
      await sql.unsafe(migration); await verify(sql);
      assert.deepEqual(await snapshot(sql), before, "Consultas, funcionários e folhas anteriores devem ser preservados.");
      installedNow = true;
    } else if (present) await verify(sql);
    return { project: ref, installed: present || installedNow, installedNow, previousQueriesAndPayrollPreserved: true };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await db.end({ timeout: 2 }); }
