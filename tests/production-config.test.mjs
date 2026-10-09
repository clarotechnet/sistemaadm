import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RH_SUPABASE_PROJECT_REF, validateProductionConfig, verifyProductionSupabase } from "../scripts/validate-production-env.mjs";

const env = { RH_URL: `https://${RH_SUPABASE_PROJECT_REF}.supabase.co`, RH_KEY: "sb_publishable_test_only", FTP_SERVER: "ftp.example.invalid", FTP_USERNAME: "fixture", FTP_PASSWORD: "fixture-not-a-real-password" };
const legacy = (claims) => [Buffer.from('{"alg":"HS256"}').toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url"), "fakeSignature"].join(".");

test("production accepts only the RH project, including a trailing slash", () => {
  assert.equal(validateProductionConfig(env).url, env.RH_URL);
  assert.equal(validateProductionConfig({ ...env, RH_URL: env.RH_URL + "/" }).url, env.RH_URL);
  for (const url of ["https://outro.supabase.co", "http://" + RH_SUPABASE_PROJECT_REF + ".supabase.co", env.RH_URL + "/rest/v1", env.RH_URL + "?project=outro", env.RH_URL + "#outro", "invalid"]) {
    assert.throws(() => validateProductionConfig({ ...env, RH_URL: url }), /Publicação bloqueada/);
  }
});

test("private keys, user tokens and legacy keys from another project cannot reach the frontend", () => {
  assert.equal(validateProductionConfig({ ...env, RH_KEY: legacy({ role: "anon", ref: RH_SUPABASE_PROJECT_REF }) }).url, env.RH_URL);
  for (const key of ["", "sb_secret_test_only", "not-a-key", legacy({ role: "service_role", ref: RH_SUPABASE_PROJECT_REF }), legacy({ role: "authenticated", ref: RH_SUPABASE_PROJECT_REF }), legacy({ role: "anon", ref: "outro" })]) {
    assert.throws(() => validateProductionConfig({ ...env, RH_KEY: key }), /Publicação bloqueada/);
  }
  for (const field of ["FTP_SERVER", "FTP_USERNAME", "FTP_PASSWORD"]) assert.throws(() => validateProductionConfig({ ...env, [field]: "" }), new RegExp(field));
});

test("deployment checks the key against public Auth settings without reading employee data", async () => {
  const config = validateProductionConfig(env);
  await verifyProductionSupabase(config, async (url, options) => {
    assert.equal(url, env.RH_URL + "/auth/v1/settings");
    assert.equal(options.headers.apikey, env.RH_KEY);
    assert.equal(options.method, undefined);
    return { ok: true, status: 200 };
  });
  await assert.rejects(verifyProductionSupabase(config, async () => ({ ok: false, status: 401 })), /HTTP 401/);
});

test("workflow validates configuration before FTP and sends only the administrative static build", async () => {
  const workflow = await readFile(new URL("../.github/workflows/static.yml", import.meta.url), "utf8");
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /npx tsc --noEmit/);
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
  const deploy = workflow.slice(workflow.indexOf("  deploy:"));
  assert.ok(deploy.indexOf("uses: actions/setup-node@v4") < deploy.indexOf("node scripts/validate-production-env.mjs"));
  assert.ok(workflow.indexOf("node scripts/validate-production-env.mjs") < workflow.indexOf("uses: SamKirkland/FTP-Deploy-Action"));
  assert.match(workflow, /local-dir: \.\/dist-hostinger\//);
  assert.match(workflow, /server-dir: \.\/administrativo\//);
});

test("the command fails closed without logging credentials", () => {
  const privateKey = "sb_secret_fixture_must_never_be_logged";
  const password = "ftp_fixture_must_never_be_logged";
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/validate-production-env.mjs", import.meta.url))], {
    env: { ...process.env, ...env, RH_KEY: privateKey, FTP_PASSWORD: password }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Publicação bloqueada/);
  assert.ok(!(result.stdout + result.stderr).includes(privateKey));
  assert.ok(!(result.stdout + result.stderr).includes(password));
});
