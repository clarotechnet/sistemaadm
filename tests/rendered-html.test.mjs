import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("defines the protected RH Control entry flow", async () => {
  const [page, login, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/LoginScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /getCurrentAuthUser/);
  assert.match(page, /getCurrentProfile/);
  assert.match(page, /LoginScreen/);
  assert.match(login, /Acesse sua conta/);
  assert.match(login, /signInWithPassword/);
  assert.match(login, /autenticação protegida pelo Supabase/);
  assert.match(layout, /RH Control/);
  assert.doesNotMatch(page + login + layout, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("supports current Supabase keys without exposing the server secret", async () => {
  const [client, admin, proxy] = await Promise.all([
    readFile(new URL("../src/lib/supabase/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client + proxy, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(admin, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(client + proxy, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test("build configuration has a dedicated Hostinger Node target", async () => {
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /DEPLOY_TARGET === "hostinger"/);
  assert.match(config, /plugins: \[vinext\(\), \.\.\.cloudflarePlugins\]/);
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

test("notification button opens recent activity and links to history", async () => {
  const shell = await readFile(new URL("../app/ui/components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /setNotificationsOpen\(value => !value\)/);
  assert.match(shell, /notification-menu/);
  assert.match(shell, /visibleNotifications\.slice\(0,\s*5\)/);
  assert.match(shell, /notification-clear/);
  assert.match(shell, /localStorage\.setItem\(notificationStorageKey,\s*clearedAt\)/);
  assert.match(shell, /navigate\("history"\)/);
});

test("user roles can be updated with last-admin protection and clear feedback", async () => {
  const [page, route, backend, migration, permissionMigration] = await Promise.all([
    readFile(new URL("../app/ui/pages/UsersPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/users/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/services/browser-backend.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/0007_security_hardening.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260910172817_enforce_security_definer_permissions.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(page, /disabled=\{user\.id===currentUser\.id\}/);
  assert.match(page, /Novo perfil:/);
  assert.match(backend, /data\.error/);
  assert.match(route, /admin_update_profile/);
  assert.match(migration, /manter pelo menos um administrador ativo/);
  assert.match(migration, /p\.id<>target\.id/);
  assert.match(permissionMigration, /handle_new_user\(\) from public, anon, authenticated/);
  assert.match(permissionMigration, /rls_auto_enable\(\)/);
  assert.match(permissionMigration, /grant execute on function public\.admin_update_profile\(uuid, text, text\) to authenticated/);
});

test("returning to a browser tab does not replace the current work with the global loader", async () => {
  const [hostingerApp, authSession] = await Promise.all([
    readFile(new URL("../src/hostinger/HostingerApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hostinger/auth-session.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hostingerApp, /onAuthStateChange\(\(event, session\)/);
  assert.match(hostingerApp, /refreshProfileInBackground/);
  assert.doesNotMatch(hostingerApp, /onAuthStateChange\(\(\) => \{ void (?:refresh|initialize)\(\); \}\)/);
  assert.match(authSession, /event === "TOKEN_REFRESHED"/);
  assert.match(authSession, /event === "SIGNED_IN" && sessionUserId === currentUserId/);
});

test("provides a private employee-document center with monthly audit packages", async () => {
  const [page, service, shell, app, migration] = await Promise.all([
    readFile(new URL("../app/ui/pages/EmployeeDocumentsPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/employee-documents.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/RHControlApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260910192418_employee_document_center.sql", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /Documentos RH/);
  assert.match(app, /EmployeeDocumentsPage/);
  assert.match(page, /Gerar pacote mensal/);
  assert.match(page, /Relacao_de_documentos\.xlsx/);
  assert.match(page, /Pendências/);
  assert.match(service, /employee-documents/);
  assert.match(service, /SHA-256/);
  assert.match(migration, /create table if not exists public\.employees/);
  assert.match(migration, /create table if not exists public\.employee_documents/);
  assert.match(migration, /alter table public\.employee_documents enable row level security/);
  assert.match(migration, /values \('employee-documents', 'employee-documents', false/);
  assert.match(migration, /public\.is_rh_or_admin\(\)/);
  assert.match(migration, /public\.is_admin\(\)/);
  assert.doesNotMatch(migration, /service_role/);
});

test("keeps the documents route available and employee registration minimal", async () => {
  const [route, page, service] = await Promise.all([
    readFile(new URL("../app/[section]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/pages/EmployeeDocumentsPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/employee-documents.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /"payroll","documents","pdfs"/);
  assert.match(route, /"payroll","documents","pdfs","reports","history"/);
  assert.doesNotMatch(page, /<span>Matrícula<\/span>/);
  assert.doesNotMatch(page, /<span>Cargo<\/span>/);
  assert.doesNotMatch(service, /payload\.registration/);
  assert.doesNotMatch(service, /payload\.jobTitle/);
});

test("adds local batch PDF compression and compact ZIP workflows", async () => {
  const [toolsPage, compressor, service] = await Promise.all([
    readFile(new URL("../app/ui/pages/PdfToolsPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ui/pages/pdf/PdfCompressor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/pdf.ts", import.meta.url), "utf8"),
  ]);
  assert.match(toolsPage, /Compactar PDFs/);
  assert.match(toolsPage, /PdfCompressor/);
  assert.match(compressor, /Diminuir PDFs/);
  assert.match(compressor, /Criar ZIP menor/);
  assert.match(compressor, /Forte legível/);
  assert.match(compressor, /Converter para tons de cinza/);
  assert.match(compressor, /Baixar ZIP/);
  assert.match(compressor, /Limpar/);
  assert.match(service, /maxPixels = 16_000_000/);
  assert.match(service, /generated\.size >= file\.size/);
  assert.match(service, /loadingTask\.destroy\(\)/);
  assert.doesNotMatch(compressor, /fetch\(/);
});
