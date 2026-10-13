// Local CSS regression check: fictional shell only, no server, login or network.
// Use PLAYWRIGHT_PATH and PLAYWRIGHT_CHROMIUM for an existing browser runtime.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { chromium } = process.env.PLAYWRIGHT_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href)
  : await import("playwright");
const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8"))
  .replace(/^@import\s+"tailwindcss";\s*/, "");
const labels = ["Dashboard", "Dados da Folha", "Conferência", "Documentos RH", "PDFs", "Relatórios", "Histórico", "Usuários", "Benefícios", "Configurações"];
const icon = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="2" width="14" height="14" fill="currentColor"/></svg>';
const fixture = (theme, collapsed) => `<!doctype html><html lang="pt-BR" data-theme="${theme}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>
  <div class="control-shell${collapsed ? " sidebar-collapsed" : ""}">
    <aside class="control-sidebar">
      <div class="control-brand"><svg class="sidebar-company-logo" viewBox="0 0 48 48"><rect width="48" height="48" fill="#c91818"/></svg><div><strong>RH Controle</strong><small>Gestão administrativa</small></div></div>
      <div class="sidebar-section-label">MENU PRINCIPAL</div>
      <nav>${labels.map(label => `<button title="${label}">${icon}<span>${label}</span></button>`).join("")}</nav>
      <div class="sidebar-spacer"></div>
      <div class="lgpd-box">${icon}<span><strong>Ambiente protegido</strong><small>Dados tratados conforme a LGPD</small></span></div>
      <button class="collapse-button">${icon}<span>Recolher menu</span></button>
    </aside>
    <main class="control-main">
      <header class="control-topbar"><div class="topbar-title"><div><span>RH CONTROLE</span><h1>Dados da Folha</h1></div></div><div class="topbar-actions"><div class="account-wrap"><button class="account-button"><span class="avatar">RH</span><span><strong>Usuário de teste</strong><small>Administradora</small></span></button><div class="account-menu" hidden><button>Minha conta</button><button>Sair</button></div></div></div></header>
      <div class="control-content"><h2>Dados da Folha</h2><section class="surface"><div class="table-scroll"><table class="data-table" style="min-width:1600px"><tbody><tr><td>Tabela com rolagem horizontal própria</td></tr></tbody></table></div></section>${'<p style="height:100px">Conteúdo de teste</p>'.repeat(25)}<button id="last-action">Última ação</button></div>
    </main>
  </div>
  <div class="modal-backdrop" hidden><div class="modal"><h3>Modal de teste</h3></div></div>
</body></html>`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM });
let checked = 0;
try {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1536, height: 864 }, { width: 1920, height: 1080 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
    for (const theme of ["light", "dark"]) {
      for (const collapsed of [false, true]) {
        const page = await browser.newPage({ viewport });
        await page.route("**/*", route => route.abort());
        await page.setContent(fixture(theme, collapsed));
        // The CSS display declarations otherwise override the HTML hidden attribute.
        await page.locator(".account-menu, .modal-backdrop").evaluateAll(nodes => nodes.forEach(node => { node.style.display = "none"; }));
        const name = `${viewport.width}x${viewport.height} ${theme} ${collapsed ? "collapsed" : "expanded"}`;
        const measure = () => page.evaluate(() => {
          const main = document.querySelector(".control-main"), header = document.querySelector(".control-topbar"), sidebar = document.querySelector(".control-sidebar");
          const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width }; };
          return { main: rect(main), header: rect(header), sidebar: rect(sidebar), collapse: rect(document.querySelector(".collapse-button")), overflowY: getComputedStyle(main).overflowY, scrollWidth: document.documentElement.scrollWidth, innerWidth, scrollY };
        });
        const initial = await measure();
        assert.equal(initial.overflowY, "visible", `${name}: main must not capture vertical scrolling`);
        assert.ok(initial.main.left >= 0 && initial.main.right <= viewport.width + 1, `${name}: main must fit beside the sidebar`);
        assert.ok(initial.scrollWidth <= initial.innerWidth + 1, `${name}: no horizontal page scrollbar`);
        if (viewport.width > 900) {
          assert.ok(initial.sidebar.width <= (collapsed ? 68 : 224), `${name}: compact sidebar width`);
          assert.ok(Math.abs(initial.main.left - initial.sidebar.right) <= 1, `${name}: main/sidebar alignment`);
          assert.ok(initial.collapse.bottom <= viewport.height, `${name}: collapse control remains accessible`);
          assert.ok(await page.locator(".control-sidebar nav button").last().isVisible(), `${name}: final menu item remains accessible`);
        } else {
          assert.equal(initial.main.left, 0, `${name}: mobile content uses the full width`);
          await page.locator(".control-sidebar").evaluate(node => node.classList.add("mobile-open"));
          const mobile = await measure();
          assert.ok(mobile.sidebar.width <= 224, `${name}: mobile drawer is compact`);
          await page.locator(".control-sidebar").evaluate(node => node.classList.remove("mobile-open"));
        }
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        const middle = await measure();
        assert.ok(middle.scrollY >= 590, `${name}: the page really scrolled`);
        assert.ok(Math.abs(middle.header.top) <= 1, `${name}: header remains at viewport top`);
        assert.equal(middle.header.left, initial.header.left, `${name}: horizontal header alignment remains unchanged`);
        await page.locator(".account-menu").evaluate(node => { node.style.display = "block"; });
        assert.equal(await page.locator(".account-menu button").first().evaluate(node => {
          const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        }), true, `${name}: dropdown remains above page content`);
        await page.locator(".modal-backdrop").evaluate(node => { node.style.display = "grid"; });
        assert.equal(await page.evaluate(() => document.elementFromPoint(innerWidth - 20, 20)?.closest(".modal-backdrop") !== null), true, `${name}: modal remains above header`);
        await page.locator(".modal-backdrop, .account-menu").evaluateAll(nodes => nodes.forEach(node => { node.style.display = "none"; }));
        await page.locator("#last-action").scrollIntoViewIfNeeded();
        assert.ok(Math.abs((await measure()).header.top) <= 1, `${name}: header remains visible at the page bottom`);
        await page.close();
        checked++;
      }
    }
  }
  console.log(`App shell: ${checked} viewport/theme/sidebar combinations passed.`);
} finally {
  await browser.close();
}
