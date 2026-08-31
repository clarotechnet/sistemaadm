import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("defines the protected RH Control entry flow", async () => {
  const [page, login, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/LoginScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /getChatGPTUser/);
  assert.match(page, /LoginScreen/);
  assert.match(login, /Acesse sua conta/);
  assert.match(login, /signin-with-chatgpt/);
  assert.match(layout, /RH Control/);
  assert.doesNotMatch(page + login + layout, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("publishes product metadata and social preview", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /openGraph/);
  assert.match(layout, /summary_large_image/);
  assert.match(layout, /og\.png/);
  await access(new URL("../public/og.png", import.meta.url));
});
