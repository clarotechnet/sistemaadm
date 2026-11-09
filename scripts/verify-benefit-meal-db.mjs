// Read-only installation verification. The explicit RH reference must match both URLs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const ref = process.argv.find(value => value.startsWith("--project="))?.slice(10);
assert.equal(ref, "kdbnheeosaptxpwkmjbz", "Informe explicitamente o projeto RH correto.");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + ".supabase.co");
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).username).split(".").at(-1), ref);
const db = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const tables = ["benefit_meal_runs", "benefit_meal_rows", "benefit_meal_events"];
const signature = "public.complete_benefit_meal_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb)";
const migration = await readFile("supabase/migrations/20261109181644_benefit_meal_period_snapshots.sql", "utf8");
try {
  await db.begin(async sql => {
    await sql.unsafe("set transaction read only");
    for (const table of tables) {
      const [state] = await sql`select c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=${table}`;
      assert.equal(state?.rls, true, table + ": RLS obrigatório");
      const [read] = await sql`select has_table_privilege('authenticated',${"public." + table},'SELECT') permitted`;
      assert.equal(read.permitted, true);
      for (const role of ["anon", "authenticated"]) for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", ...(role === "anon" ? ["SELECT"] : [])]) {
        const [grant] = await sql`select has_table_privilege(${role},${"public." + table},${privilege}) permitted`;
        assert.equal(grant.permitted, false, `${table}: ${role} não pode ${privilege}`);
      }
      const policies = await sql`select cmd,roles,qual from pg_policies where schemaname='public' and tablename=${table}`;
      assert.equal(policies.length, 1); assert.equal(policies[0].cmd, "SELECT"); assert.match(policies[0].qual, /is_rh_or_admin/);
    }
    const [rpc] = await sql`select p.prosecdef,p.prosrc,p.proconfig from pg_proc p where p.oid=${signature}::regprocedure`;
    assert.equal(rpc.prosecdef, false, "RPC deve usar SECURITY INVOKER");
    assert.ok(rpc.proconfig.some(setting => setting.startsWith("search_path=")));
    const normalize = text => text.replace(/\s+/g, " ").trim();
    assert.equal(normalize(rpc.prosrc), normalize(migration.split("as $$")[1].split("$$;")[0]), "Corpo RPC instalado deve corresponder ao arquivo validado");
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [access] = await sql`select has_function_privilege(${role},${signature},'EXECUTE') permitted`;
      assert.equal(access.permitted, role === "service_role");
    }
    const columns = await sql`select column_name from information_schema.columns where table_schema='public' and table_name='benefit_meal_rows'`;
    for (const column of ["snapshot_employee_id", "absence_days", "medical_days", "overlap_days", "deduction_days", "planned_work_days", "payable_days", "daily_value", "amount_due", "issues"]) assert.ok(columns.some(row => row.column_name === column));
    const checks = await sql`select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.benefit_meal_rows'::regclass and contype='c'`;
    assert.ok(checks.some(row => /planned_work_days IS NULL/.test(row.definition) && /amount_due IS NULL/.test(row.definition)));
    const counts = {};
    for (const table of tables) counts[table] = (await sql.unsafe(`select count(*)::int n from public.${table}`))[0].n;
    console.log(JSON.stringify({ project: ref, result: "PASS: schema, RH-only RLS, read-only browser grants, private atomic RPC and pending financial inputs", counts, mutation: false }));
  });
} finally { await db.end({ timeout: 2 }); }
