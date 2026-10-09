import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
const ref = process.argv.find(value => value.startsWith("--project="))?.slice(10);
assert.ok(ref, "Informe explicitamente o projeto para verificar.");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0], ref);
assert.equal(decodeURIComponent(new URL(process.env.DATABASE_URL).username).split(".").at(-1), ref);
const db = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
const rollback = new Error("ROLLBACK_VERIFIED_FIXTURES");
try {
  await db.begin(async sql => {
    if (process.argv.includes("--dry-run")) {
      const migration = (await readdir("supabase/migrations")).find(name => name.endsWith("_payroll_audit_module.sql"));
      await sql.unsafe(await readFile(`supabase/migrations/${migration}`, "utf8"));
    }
    const [actor] = await sql.unsafe("select id from public.profiles where status='ATIVO' and role='ADMINISTRADOR' limit 1");
    assert.ok(actor, "Administrador ativo necessário para o teste transacional.");
    const [already] = await sql.unsafe("select count(*)::int as count from public.payroll_imports where competence='01/1901'");
    assert.equal(already.count, 0, "Competência fictícia deve estar livre.");
    await sql.unsafe("set local role authenticated");
    await sql.unsafe("select set_config('request.jwt.claim.sub',$1,true)", [actor.id]);
    const payload = [{ cpf: "00000000000", name: "Teste transacional Conferência", liquid: 100, health_total: 5, dental_total: 2, health_columns: 1, dental_columns: 1, source_sheet: "Teste", audit_data: { version: 1, gross: 130, deductions: 30, liquid: 100, baseSalary: 100, events: [], occurrences: [{ sheet: "Teste", row: 2 }] } }];
    const [saved] = await sql.unsafe("select public.save_payroll_month('01/1901','teste.xlsx',1,'[]'::jsonb,$1::text::jsonb) as result", [JSON.stringify(payload)]);
    const id = saved.result.id;
    const [record] = await sql.unsafe("select liquid,health_total,audit_data from public.payroll_records where payroll_import_id=$1", [id]);
    assert.equal(record.liquid, 100); assert.equal(record.health_total, 5); assert.equal(record.audit_data.gross, 130);
    const [review] = await sql.unsafe("insert into public.payroll_audit_reviews(current_import_id,revision_key,employee_key,rule_code,status,notes) values($1,$2,'00000000000','TEST','JUSTIFICADA','Justificativa de teste') returning updated_by,updated_by_name", [id, "a".repeat(64)]);
    assert.equal(review.updated_by, actor.id); assert.ok(review.updated_by_name);
    await sql.unsafe("savepoint invalid_note");
    await assert.rejects(sql.unsafe("update public.payroll_audit_reviews set notes='' where current_import_id=$1", [id]), error => error.code === "23514");
    await sql.unsafe("rollback to savepoint invalid_note");
    // A non-RH identity cannot read payroll or review rows, even with authenticated role.
    await sql.unsafe("select set_config('request.jwt.claim.sub',$1,true)", [crypto.randomUUID()]);
    const [blocked] = await sql.unsafe("select (select count(*)::int from public.payroll_records where payroll_import_id=$1) as payroll, (select count(*)::int from public.payroll_audit_reviews where current_import_id=$1) as reviews", [id]);
    assert.equal(blocked.payroll, 0); assert.equal(blocked.reviews, 0);
    await sql.unsafe("savepoint blocked_write");
    await assert.rejects(sql.unsafe("insert into public.payroll_audit_reviews(current_import_id,revision_key,employee_key,rule_code) values($1,$2,'00000000000','BLOCKED')", [id, "a".repeat(64)]));
    await sql.unsafe("rollback to savepoint blocked_write");
    await sql.unsafe("savepoint blocked_rpc");
    await assert.rejects(sql.unsafe("select public.save_payroll_month('01/1901','teste.xlsx',1,'[]'::jsonb,$1::text::jsonb)", [JSON.stringify(payload)]));
    await sql.unsafe("rollback to savepoint blocked_rpc");
    await sql.unsafe("reset role");
    const [security] = await sql.unsafe("select relrowsecurity from pg_class where oid='public.payroll_audit_reviews'::regclass");
    assert.equal(security.relrowsecurity, true);
    const [anonymous] = await sql.unsafe("select has_table_privilege('anon','public.payroll_audit_reviews','SELECT') as can_read");
    assert.equal(anonymous.can_read, false);
    console.log("PASS: importação, detalhes, justificativa, responsável, RLS, bloqueio de leitura/escrita e RPC. Fixtures serão revertidas.");
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await db.end({ timeout: 2 }); }
