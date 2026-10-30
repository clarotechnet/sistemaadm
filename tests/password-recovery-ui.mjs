// Real browser/SDK, fictional Auth only. All non-local requests are intercepted.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { chromium } = process.env.PLAYWRIGHT_PATH ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href) : await import("playwright");
const origin = process.env.AUTH_TEST_URL ?? "http://127.0.0.1:5174";
const hostname = "recovery-preview.supabase.co";
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "rh@example.invalid", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const otherUser = { ...user, id: "22222222-2222-4222-8222-222222222222", email: "outro@example.invalid" };
const exp = Math.floor(Date.now() / 1000) + 3600;
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp, iat: exp - 3600 })).toString("base64url")}.fictional-signature`;
const session = { access_token: token, refresh_token: "fictional-refresh", expires_at: exp, expires_in: 3600, token_type: "bearer", user };
const unexpected = [], errors = [], passed = [], requests = [], consumedCodes = new Set();
let redirectTo = "", recoverMode = "success", updateMode = "success", currentUser = user, flow = 0;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const contexts = [];
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  contexts.push(context);
  await context.route("**/*", async route => {
    const req = route.request(), target = new URL(req.url());
    if (target.origin === origin) return route.continue();
    if (target.hostname !== hostname) { unexpected.push(target.origin + target.pathname); return route.abort(); }
    const respond = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "x-supabase-api-version": "2024-01-01", "access-control-allow-origin": "*", "access-control-expose-headers": "x-supabase-api-version" }, body: JSON.stringify(body) });
    const endpoint = target.pathname, method = req.method();
    requests.push({ endpoint, method, grant: target.searchParams.get("grant_type") });
    if (endpoint === "/auth/v1/recover") {
      const payload = req.postDataJSON();
      assert.equal(payload.email, "rh@example.invalid");
      assert.ok(payload.code_challenge.length >= 43);
      assert.equal(payload.code_challenge_method, "s256");
      redirectTo = target.searchParams.get("redirect_to");
      assert.equal(new URL(redirectTo).origin, origin);
      assert.equal(new URL(redirectTo).pathname, "/redefinir-senha");
      if (recoverMode === "rate") return respond(429, { code: "over_email_send_rate_limit", msg: "provider internal rate details" });
      if (recoverMode === "smtp") return respond(500, { code: "unexpected_failure", msg: "private SMTP failure" });
      if (recoverMode === "unknown") return respond(404, { code: "user_not_found", msg: "No account" });
      return respond(200, {});
    }
    if (endpoint === "/auth/v1/token" && target.searchParams.get("grant_type") === "pkce") {
      const payload = req.postDataJSON();
      assert.ok(payload.code_verifier.length >= 43);
      if (payload.auth_code === "expired-code" || consumedCodes.has(payload.auth_code)) return respond(400, { code: "otp_expired", msg: "Email link is invalid or has expired" });
      consumedCodes.add(payload.auth_code);
      return respond(200, session);
    }
    if (endpoint === "/auth/v1/user" && method === "GET") return respond(200, currentUser);
    if (endpoint === "/auth/v1/user" && method === "PUT") {
      assert.equal(currentUser.id, user.id);
      assert.equal(req.postDataJSON().password, "Nova!senha123 ");
      if (updateMode === "weak") return respond(422, { code: "weak_password", msg: "private policy details" });
      return respond(200, user);
    }
    if (endpoint === "/auth/v1/logout" && method === "POST") {
      assert.equal(target.searchParams.get("scope"), "local");
      return route.fulfill({ status: 204, body: "" });
    }
    unexpected.push(method + " " + endpoint);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  return page;
}
const count = (endpoint, method) => requests.filter(req => req.endpoint === endpoint && (!method || req.method === method)).length;
const requestLink = async page => {
  await page.goto(origin + "/recuperar-senha");
  await page.getByLabel("E-mail da conta").fill("rh@example.invalid");
  await page.getByRole("button", { name: "Enviar link de recuperação", exact: true }).click();
  await page.getByRole("status").getByText(/Se este e-mail tiver uma conta/).waitFor();
};
const link = code => { const url = new URL(redirectTo); url.searchParams.set("code", code); return url.href; };
const openReset = async page => {
  currentUser = user;
  recoverMode = "success";
  await requestLink(page);
  const url = link(`fictional-code-${++flow}`);
  await page.goto(url);
  await page.getByLabel("Nova senha", { exact: true }).waitFor();
  return url;
};
const fillPasswords = async page => {
  await page.getByLabel("Nova senha", { exact: true }).fill("Nova!senha123 ");
  await page.getByLabel("Confirmar nova senha", { exact: true }).fill("Nova!senha123 ");
};

try {
  await mkdir("tmp/recovery-qa", { recursive: true });
  const page = await newPage();
  await page.goto(origin);
  await page.getByRole("heading", { name: "Acesse sua conta" }).waitFor();
  const forgot = page.getByRole("link", { name: "Esqueci minha senha", exact: true });
  assert.equal(await forgot.getAttribute("href"), "/recuperar-senha");
  await page.screenshot({ path: "tmp/recovery-qa/login.png", fullPage: true });
  await forgot.click();
  await page.getByLabel("E-mail da conta").fill("not-an-email");
  await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
  assert.equal(count("/auth/v1/recover"), 0);
  await page.getByLabel("E-mail da conta").fill("rh@example.invalid");
  await page.locator("form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await page.getByRole("status").getByText(/Se este e-mail tiver uma conta/).waitFor();
  assert.equal(count("/auth/v1/recover"), 1);
  assert.equal(await page.getByRole("button", { name: /Reenviar em/ }).isDisabled(), true);
  await page.screenshot({ path: "tmp/recovery-qa/request-sent.png", fullPage: true });
  passed.push("login link, email validation, neutral feedback, double-submit guard, PKCE and resend cooldown");

  const validLink = link(`fictional-code-${++flow}`);
  await page.goto(validLink);
  await page.getByLabel("Nova senha", { exact: true }).waitFor();
  assert.equal(count("/auth/v1/token"), 1);
  assert.equal(page.url(), origin + "/redefinir-senha");
  await page.reload();
  await page.getByLabel("Nova senha", { exact: true }).waitFor();
  assert.equal(count("/auth/v1/token"), 1);
  await page.getByLabel("Nova senha", { exact: true }).fill("Nova!senha123 ");
  await page.getByLabel("Confirmar nova senha", { exact: true }).fill("different-password");
  await page.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
  await page.getByRole("alert").getByText("As senhas não conferem.").waitFor();
  assert.equal(count("/auth/v1/user", "PUT"), 0);
  await fillPasswords(page);
  await page.getByRole("button", { name: "Mostrar nova senha", exact: true }).click();
  assert.equal(await page.getByLabel("Nova senha", { exact: true }).getAttribute("type"), "text");
  await page.screenshot({ path: "tmp/recovery-qa/new-password.png", fullPage: true });
  updateMode = "weak";
  await page.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
  await page.getByRole("alert").getByText(/Use uma senha mais forte/).waitFor();
  assert.equal(count("/auth/v1/logout"), 0);
  updateMode = "success";
  await page.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
  await page.getByRole("heading", { name: "Senha alterada com sucesso" }).waitFor();
  assert.equal(count("/auth/v1/logout"), 1);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("rh-control:password-recovery")), null);
  await page.getByRole("link", { name: "Voltar ao login", exact: true }).last().click();
  await page.getByRole("heading", { name: "Acesse sua conta" }).waitFor();
  passed.push("one-use exchange under StrictMode, refresh resume, confirmation, provider password policy and local sign-out");

  const puts = count("/auth/v1/user", "PUT");
  await page.goto(validLink);
  await page.getByRole("link", { name: "Solicitar novo link" }).waitFor();
  assert.equal(await page.getByLabel("Nova senha", { exact: true }).count(), 0);
  assert.equal(count("/auth/v1/user", "PUT"), puts);
  await requestLink(page);
  await page.goto(link("expired-code"));
  await page.getByRole("link", { name: "Solicitar novo link" }).waitFor();
  assert.equal(page.url(), origin + "/redefinir-senha");
  passed.push("reused and expired codes cannot update passwords and are removed from the address");

  const fresh = await newPage();
  await fresh.context().addCookies([{ name: "sb-recovery-preview-auth-token", value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: origin }]);
  await fresh.goto(origin + "/redefinir-senha");
  await fresh.getByRole("link", { name: "Solicitar novo link" }).waitFor();
  assert.equal(await fresh.getByLabel("Nova senha", { exact: true }).count(), 0);
  await fresh.goto(origin + "/redefinir-senha?code=not-from-this-browser");
  await fresh.getByRole("link", { name: "Solicitar novo link" }).waitFor();
  await fresh.goto(origin + "/redefinir-senha#error=access_denied&error_code=otp_expired&error_description=private-provider-info");
  await fresh.waitForURL(origin + "/redefinir-senha");
  await fresh.getByRole("link", { name: "Solicitar novo link" }).waitFor();
  assert.equal(fresh.url(), origin + "/redefinir-senha");
  assert.doesNotMatch(await fresh.locator("body").innerText(), /private-provider-info/);
  passed.push("an ordinary logged-in session, a wrong browser, and provider error fragments are rejected safely");

  await openReset(page);
  await fillPasswords(page);
  currentUser = otherUser;
  await page.getByRole("button", { name: "Salvar nova senha", exact: true }).click();
  await page.getByRole("link", { name: "Solicitar novo link" }).waitFor();
  assert.equal(count("/auth/v1/user", "PUT"), puts);
  passed.push("a different account appearing in another tab is never updated");
  currentUser = user;

  for (const mode of ["rate", "smtp", "unknown"]) {
    recoverMode = mode;
    await fresh.goto(origin + "/recuperar-senha");
    await fresh.getByLabel("E-mail da conta").fill("rh@example.invalid");
    await fresh.getByRole("button", { name: "Enviar link de recuperação", exact: true }).click();
    if (mode === "unknown") await fresh.getByRole("status").getByText(/Se este e-mail tiver uma conta/).waitFor();
    else {
      await fresh.getByRole("alert").waitFor();
      assert.equal(await fresh.getByText(/Se este e-mail tiver uma conta/).count(), 0);
      assert.doesNotMatch(await fresh.locator("body").innerText(), /private SMTP|provider internal/);
    }
  }
  passed.push("rate limits and SMTP failures are not reported as email sent; unknown accounts have neutral feedback");

  recoverMode = "success";
  await fresh.setViewportSize({ width: 390, height: 844 });
  await fresh.goto(origin + "/recuperar-senha");
  assert.ok(await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fresh.screenshot({ path: "tmp/recovery-qa/request-mobile.png", fullPage: true });
  await openReset(fresh);
  assert.ok(await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fresh.screenshot({ path: "tmp/recovery-qa/reset-mobile.png", fullPage: true });
  assert.equal(await fresh.locator('meta[name="referrer"]').getAttribute("content"), "no-referrer");
  passed.push("mobile recovery and reset fit the screen and do not leak referrers");
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ passed, pageErrors: errors, unexpectedNetwork: unexpected, authRequests: requests.length }, null, 2));
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
