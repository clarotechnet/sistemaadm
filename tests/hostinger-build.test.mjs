import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const output = new URL("../dist-hostinger/", import.meta.url);

test("Hostinger build is a static SPA with an Apache entry point", async () => {
  const html = await readFile(new URL("index.html", output), "utf8");
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\//);
  await access(new URL(".htaccess", output));
  await access(new URL("pdf.worker.min.mjs", output));
});

test("Hostinger output does not contain Vinext server directories", async () => {
  await assert.rejects(access(new URL("server/", output)));
  await assert.rejects(access(new URL("client/", output)));
});
