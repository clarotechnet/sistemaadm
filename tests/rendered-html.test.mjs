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

test("serves the PDF.js worker from the same web origin", async () => {
  const service = await readFile(new URL("../src/services/pdf.ts", import.meta.url), "utf8");
  assert.match(service, /workerSrc\s*=\s*["']\/pdf\.worker\.min\.mjs["']/);
  assert.doesNotMatch(service, /new URL\(["']pdfjs-dist\/build\/pdf\.worker/);
  await access(new URL("../public/pdf.worker.min.mjs", import.meta.url));
});

test("PDF editor selects original text precisely and exposes close/remove controls", async () => {
  const [editor, service, toolsPage] = await Promise.all([
    readFile(new URL("../app/ui/pages/pdf/PdfEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/pdf.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/pages/PdfToolsPage.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(service, /extractPdfTextItems/);
  assert.match(editor, /pdf-text-hitbox/);
  assert.match(editor, /tool==="select"\|\|tool==="editText"/);
  assert.match(editor, /coverBackground:false/);
  assert.match(editor, /Fechar editor/);
  assert.match(editor, /Remover PDF/);
  assert.match(toolsPage, /PdfEditor onClose/);
});

test("account menu closes after clicking outside or pressing Escape", async () => {
  const shell = await readFile(new URL("../app/ui/components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /accountRef\.current\?\.contains/);
  assert.match(shell, /document\.addEventListener\("pointerdown", closeOnOutsideClick\)/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /aria-expanded=\{accountOpen\}/);
});
