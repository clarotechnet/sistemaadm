import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new accounts cannot auto-approve or self-elevate", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260924114500_profile_security_lockdown.sql", import.meta.url), "utf8");
  assert.match(migration, /'CONSULTA'/);
  assert.match(migration, /'AGUARDANDO APROVAÇÃO'/);
  assert.doesNotMatch(migration, /first_user/);
  assert.match(migration, /revoke update on public\.profiles from authenticated/i);
  assert.match(migration, /drop policy if exists profiles_update_self/i);
  assert.match(migration, /create or replace function public\.update_own_profile/i);
  assert.match(migration, /protect_profile_privileged_fields/i);
});

test("sensitive RH reads require RH or administrator", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260924121000_sensitive_read_lockdown.sql", import.meta.url), "utf8");
  assert.match(migration, /employees_select[\s\S]*is_rh_or_admin/i);
  assert.match(migration, /employee_documents_select[\s\S]*is_rh_or_admin/i);
  assert.match(migration, /employee_documents_storage_select[\s\S]*is_rh_or_admin/i);
});

test("repository does not hardcode the production Supabase project or absence sheet id", async () => {
  const [workflow, benefitFunction] = await Promise.all([
    readFile(new URL("../.github/workflows/static.yml", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/sync-benefit-aggregation/index.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(workflow, /kdbnheeosaptxpwkmjbz/);
  assert.doesNotMatch(benefitFunction, /184YsW-iN5PRV0bOg4M20otgnytIthwlwi39djZIwEzo/);
  assert.match(benefitFunction, /QUARK_FALTAS_SHEET_ID/);
});
