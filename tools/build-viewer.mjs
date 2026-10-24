/**
 * Build a single-file viewer edition of the System 1 design site.
 *
 * Why: the canonical site is one file per sector page (docs/system1/*.html)
 * and only works when the whole folder is served/opened together — chat
 * previews and GitHub's source view serve a single file, so relative
 * page links error there. This script inlines the shared CSS/JS into
 * every page and packages all pages into ONE html file where each page
 * runs isolated in a frame and the top nav switches between them.
 * Clicking works from a single downloaded/opened file.
 *
 * Usage: node tools/build-viewer.mjs
 * Output: docs/system1-viewer.html (generated — do not edit by hand)
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "docs", "system1");

const css = await readFile(join(site, "assets", "style.css"), "utf8");
const sectorJs = await readFile(join(site, "assets", "sector.js"), "utf8");

/* Pipeline order; the viewer bar groups these under the dashboard
   hierarchy (decision #21) — see GROUPS in the shell below. */
const PAGES = [
  "index.html",
  "roadmap.html",
  "sectioning.html",
  "scene-boundary.html",
  "dialogue-detector.html",
  "name-detector.html",
  "presence-detector.html",
  "speaker-attribution.html",
  "miniloop-engine.html",
  "extraction.html",
  "em-at-birth.html",
  "merge-gate.html",
  "em-global.html",
  "storage-connectors.html",
  "timeline-forking.html",
  "simulation.html",
  "playground-frontend.html",
];

const BRIDGE = `
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  var h = a.getAttribute('href');
  if (!h || h.indexOf('http') === 0 || h.charAt(0) === '#') return;
  e.preventDefault();
  parent.postMessage({ nav: h }, '*');
}, true);`;

const HIDE_CHROME = "#sitenav, #pager { display: none !important; } body { padding-top: 4px; }";

const pages = {};
for (const name of PAGES) {
  let html = await readFile(join(site, name), "utf8");
  html = html.replace(
    '<link rel="stylesheet" href="assets/style.css">',
    `<style>\n${css}\n${HIDE_CHROME}\n</style>`,
  );
  html = html.replace(
    '<script src="assets/sector.js"></script>',
    `<script>\n${sectorJs}\n</script>`,
  );
  // Any page-specific external script (none in sector pages today) would
  // need inlining too; fail loudly instead of shipping a broken viewer.
  const leftover = html.match(/<script src="([^"]+)"/);
  if (leftover) throw new Error(`${name}: un-inlined script ${leftover[1]}`);
  html = html.replace("</body>", `<script>${BRIDGE}</script>\n</body>`);
  pages[name] = html;
}

const shell = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>System 1 design — single-file viewer · novel-ontology-pi</title>
<style>
  body{margin:0;background:#0b0e14;color:#e8ecf4;font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
  header{position:sticky;top:0;z-index:10;background:#0d1220;border-bottom:1px solid #26304a;
    padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  header b{margin-right:10px}
  header small{color:#5f6d88;display:block;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase}
  button{background:#171e2e;color:#9aa7bd;border:1px solid #26304a;border-radius:99px;
    padding:4px 11px;font-size:12.5px;cursor:pointer;white-space:nowrap}
  button:hover{color:#e8ecf4;border-color:#2dd4bf}
  button.here{background:#2dd4bf;color:#0b0e14;border-color:#2dd4bf;font-weight:600}
  .menu{position:relative}
  .dropdown{position:absolute;top:calc(100% + 6px);left:0;z-index:60;display:none;
    flex-direction:column;gap:2px;min-width:220px;padding:6px;
    background:#171e2e;border:1px solid #26304a;border-radius:12px;
    box-shadow:0 14px 34px rgba(0,0,0,.5)}
  .menu.open .dropdown{display:flex}
  @media (hover:hover){ .menu:hover .dropdown{display:flex} }
  .dropdown button{border-radius:8px;text-align:left;border-color:transparent;background:none}
  .dropdown button:hover{background:#1d2639}
  .dropdown button.here{background:#2dd4bf;color:#0b0e14}
  iframe{width:100%;height:calc(100vh - 57px);border:0;display:block;background:#0b0e14}
  #note{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#171e2e;
    border:1px solid #fbbf24;color:#e8ecf4;border-radius:10px;padding:8px 14px;font-size:13px;
    display:none;z-index:20}
</style>
</head>
<body>
<header id="bar"></header>
<iframe id="frame" title="System 1 design page"></iframe>
<div id="note"></div>
<script>
const PAGES = ${JSON.stringify(pages).replace(/<\/script/gi, "<\\/script")};
const ORDER = ${JSON.stringify(PAGES)};
const LABELS = { "index.html": "Overview", "roadmap.html": "🗺 Roadmap", "playground-frontend.html": "13 Playground", "sectioning.html": "01 Sectioning",
  "scene-boundary.html": "02 Scene boundary", "dialogue-detector.html": "03 Dialogue",
  "name-detector.html": "04 Names", "presence-detector.html": "05 Presence",
  "speaker-attribution.html": "06 Speakers", "miniloop-engine.html": "07 Miniloop engine",
  "extraction.html": "08 Extraction", "em-at-birth.html": "08a EM at birth", "merge-gate.html": "09 Merge gate", "em-global.html": "09a EM across the novel",
  "storage-connectors.html": "10 Storage", "timeline-forking.html": "11 Timelines & forks",
  "simulation.html": "12 Simulation" };
/* The bar carries only the hierarchy: Overview, Roadmap, and one
   dropdown per group — the 15 sector pages live inside the dropdowns. */
const GROUPS = [
  { label: "⛏ Digger", pages: ["sectioning.html", "scene-boundary.html", "dialogue-detector.html", "name-detector.html", "presence-detector.html", "speaker-attribution.html", "miniloop-engine.html", "extraction.html", "em-at-birth.html"] },
  { label: "🧱 Solidifier", pages: ["merge-gate.html", "em-global.html"] },
  { label: "📦 Ground", pages: ["storage-connectors.html"] },
  { label: "Simulation group", pages: ["timeline-forking.html", "simulation.html"] },
  { label: "Frontend", pages: ["playground-frontend.html"] },
];
const GROUP_OF = {};
GROUPS.forEach((g, i) => g.pages.forEach(p => GROUP_OF[p] = i));
const bar = document.getElementById('bar');
const frame = document.getElementById('frame');
bar.innerHTML = '<b>novel-ontology-pi<small>Skill + CLI + Adaptor + Frontend · viewer</small></b>' +
  '<button data-p="index.html">Overview</button>' +
  '<button data-p="roadmap.html">🗺 Roadmap</button>' +
  GROUPS.map((g, i) =>
    '<span class="menu"><button class="menubtn" data-g="' + i + '">' + g.label + ' ▾</button>' +
    '<span class="dropdown">' + g.pages.map(p => '<button data-p="' + p + '">' + LABELS[p] + '</button>').join('') + '</span></span>'
  ).join('');
function closeMenus() { bar.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); }
function go(p) {
  if (!PAGES[p]) { note('That link points outside the viewer pages — open it in the repo.'); return; }
  frame.srcdoc = PAGES[p];
  bar.querySelectorAll('button[data-p]').forEach(b => b.classList.toggle('here', b.dataset.p === p));
  bar.querySelectorAll('.menubtn').forEach(b => b.classList.toggle('here', GROUP_OF[p] === Number(b.dataset.g)));
  closeMenus();
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
}
let noteTimer;
function note(msg) {
  const n = document.getElementById('note');
  n.textContent = msg; n.style.display = 'block';
  clearTimeout(noteTimer); noteTimer = setTimeout(() => n.style.display = 'none', 3500);
}
bar.addEventListener('click', e => {
  const mb = e.target.closest('.menubtn');
  if (mb) {
    const menu = mb.parentElement;
    const wasOpen = menu.classList.contains('open');
    closeMenus();
    if (!wasOpen) menu.classList.add('open');
    e.stopPropagation();
    return;
  }
  const b = e.target.closest('button[data-p]');
  if (b) go(b.dataset.p);
});
document.addEventListener('click', e => { if (!e.target.closest('.menu')) closeMenus(); });
window.addEventListener('message', e => {
  if (e.data && e.data.nav) {
    const target = String(e.data.nav).split('/').pop();
    go(target);
  }
});
go(location.hash ? location.hash.slice(1) : 'index.html');
</script>
</body>
</html>
`;

const out = join(root, "docs", "system1-viewer.html");
await writeFile(out, shell);
console.log(`wrote ${out} (${(shell.length / 1024).toFixed(0)} KiB, ${PAGES.length} pages)`);
