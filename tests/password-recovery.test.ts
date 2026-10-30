import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RECOVERY_LIFETIME_MS, RECOVERY_LINK_ERROR, RECOVERY_SENT_MESSAGE, passwordRecoveryError, readRecoveryIdentity, recoveryRedirectUrl, validateNewPassword, validateRecoveryEmail } from "../src/auth/password-recovery";

test("recovery always returns to the current subdomain, never to a supplied path or query", () => {
  assert.equal(recoveryRedirectUrl("https://administrativo.example.com/payroll?next=https://evil.invalid"), "https://administrativo.example.com/redefinir-senha");
  assert.equal(recoveryRedirectUrl("http://localhost:3000"), "http://localhost:3000/redefinir-senha");
  assert.equal(recoveryRedirectUrl("http://127.0.0.1:5174"), "http://127.0.0.1:5174/redefinir-senha");
  for (const origin of ["http://administrativo.example.com", "javascript:alert(1)", "file:///tmp/a.html"]) assert.throws(() => recoveryRedirectUrl(origin));
});

test("email is trimmed for validation and passwords are preserved exactly", () => {
  assert.equal(validateRecoveryEmail(" teste@example.com "), "");
  for (const value of ["", "   ", "no-at", "a@host", "a b@example.com", "a@example.com\nother"]) assert.ok(validateRecoveryEmail(value));
  assert.ok(validateNewPassword("1234567", "1234567"));
  assert.ok(validateNewPassword("senha-123", "senha-456"));
  assert.equal(validateNewPassword(" senha 123 ", " senha 123 "), "");
  assert.ok(validateNewPassword(" senha 123 ", "senha 123"));
});

test("only a bounded, unexpired per-tab recovery marker can resume the UI", () => {
  const now = 100000;
  const valid = { userId: "fictional-user", expiresAt: now + RECOVERY_LIFETIME_MS };
  assert.deepEqual(readRecoveryIdentity(JSON.stringify(valid), now), valid);
  for (const value of [null, "not-json", "{}", "[]", JSON.stringify({ ...valid, userId: "" }), JSON.stringify({ ...valid, expiresAt: now }), JSON.stringify({ ...valid, expiresAt: now + RECOVERY_LIFETIME_MS + 1 }), JSON.stringify({ ...valid, expiresAt: "future" })]) assert.equal(readRecoveryIdentity(value, now), null);
});

test("safe feedback translates known errors without displaying provider internals or credentials", () => {
  assert.match(RECOVERY_SENT_MESSAGE, /Se este e-mail tiver uma conta/);
  assert.match(passwordRecoveryError({ code: "over_email_send_rate_limit" }), /Aguarde/);
  assert.match(passwordRecoveryError({ code: "same_password" }, true), /diferente/);
  assert.match(passwordRecoveryError({ code: "weak_password" }, true), /mais forte/);
  assert.equal(passwordRecoveryError({ code: "otp_expired" }, true), RECOVERY_LINK_ERROR);
  assert.doesNotMatch(passwordRecoveryError(new Error("private provider internals")), /private provider/);
});

test("both deployment targets expose public recovery routes before protected app initialization", async () => {
  const [login, hostinger, request, reset, service, client] = await Promise.all([
    readFile(new URL("../app/ui/LoginScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hostinger/HostingerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/recuperar-senha/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/redefinir-senha/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/password-recovery.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/client.ts", import.meta.url), "utf8"),
  ]);
  assert.match(login, /href="\/recuperar-senha">Esqueci minha senha/);
  assert.match(request, /mode="request"/);
  assert.match(reset, /mode="reset"/);
  assert.ok(hostinger.indexOf('path === "/redefinir-senha"') < hostinger.indexOf("function AuthenticatedHostingerApp"));
  assert.match(service, /event === "PASSWORD_RECOVERY"/);
  assert.match(service, /recoveryUserId !== data\.user\.id/);
  assert.match(service, /verified\.user\?\.id !== data\.user\.id/);
  assert.match(service, /data\.user\?\.id !== identity\.userId/);
  assert.match(service, /signOut\(\{ scope: "local" \}\)/);
  assert.match(client, /detectSessionInUrl: false/);
  assert.doesNotMatch(client + service, /SERVICE_ROLE|SECRET_KEY|admin\./);
});
