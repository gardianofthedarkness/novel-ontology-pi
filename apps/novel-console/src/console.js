"use strict";
// The console's window: the libraries and their books, the reader, the book's cast, problems and records, the keys and the
// readings. Everything it knows comes from the novel server through window.novelHost (preload.js).
const host = window.novelHost;
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let libs = [], current = null, panelTab = "cast", record = null;
const trees = new Map(), books = new Map(), expanded = new Set(), running = new Map();
const ask = (folder, method, params) => host.ask(folder, method, params);
const say = (text, bad = false) => { $("status").textContent = text; $("status").className = bad ? "err" : ""; };
const bookList = (tree) => [...tree.universes.flatMap((universe) => universe.books), ...tree.unsorted];

// The libraries and their trees.
async function load(folder) {
  try { const tree = await ask(folder, "novel/tree"); trees.set(folder, tree); for (const book of bookList(tree)) books.set(`${folder}|${book.id}`, book); }
  catch (error) { trees.set(folder, { error: error.message, universes: [], unsorted: [] }); }
}
async function refresh(scan = false) {
  libs = await host.libraries();
  for (const lib of libs) { if (!lib.exists) continue; if (scan) await ask(lib.path, "novel/scan").catch(() => {}); await load(lib.path); if (!expanded.has(lib.path) && !expanded.has(`closed:${lib.path}`)) expanded.add(lib.path); }
  $("welcome").hidden = Boolean(current);
  render(); follow();
}
function node({ depth = 0, chev = null, icon = "", name = "", nameClass = "", desc = "", action = null, cls = "", title = "", onClick = null, key = "" }) {
  const row = document.createElement("div");
  row.className = `node ${cls}`; row.style.setProperty("--depth", depth); row.setAttribute("role", "treeitem"); if (title) row.title = title; if (key) row.dataset.key = key;
  row.innerHTML = `<span class="chev">${chev === null ? "" : chev ? "▾" : "▸"}</span><span class="ic">${icon}</span><span class="name ${nameClass}">${esc(name)}</span><span class="desc">${esc(desc)}</span>`;
  if (action) row.append(action);
  if (onClick) row.addEventListener("click", (event) => { if (!event.target.closest(".act")) onClick(event); });
  return row;
}
function actionButton(label, cls, title, run) { const button = document.createElement("button"); button.className = `act ${cls}`; button.innerHTML = label; button.title = title; button.addEventListener("click", (event) => { event.stopPropagation(); run(); }); return button; }

function bookRow(folder, book, depth) {
  const key = `${folder}|${book.id}`, job = book.job, reading = job?.state === "running", open = expanded.has(key);
  const desc = book.missing ? "missing" : book.unread ? "not readable" : reading ? `reading… ${job.now ?? ""}` : book.reading ? `${book.symbols} entries${book.problems ? ` · ${book.problems} problems` : ""}` : job?.state === "failed" ? "reading failed" : job?.state === "stopped" ? "reading stopped" : `${Math.round(book.chars / 1000)}k characters`;
  let action = null;
  if (reading) action = actionButton(`<span class="spin"></span>`, "", "Reading. Press to stop it (what it asked stays cached).", () => stopReading(folder, book));
  else if (!book.reading && !book.missing && !book.unread) action = actionButton("▶", "run", `Read this book with Jev and the work model (about $${(book.chars * 0.35 / 125000).toFixed(2)})`, () => runReading(folder, book));
  const row = node({ depth, key, chev: book.missing ? null : open, icon: book.reading ? "📖" : "📄", name: book.title, nameClass: "book", desc, action, cls: current?.key === key ? "current" : "",
    title: `${book.path}${job?.error ? `\nLast reading ${job.state}: ${job.error}` : ""}`,
    onClick: (event) => { if (event.target.closest(".chev")) { toggle(key); return; } if (book.reading) openBook(folder, book, null); else { toggle(key); say(`${book.title} has no reading yet: press ▶ to read it.`); } } });
  const rows = [row];
  if (open && !book.missing) {
    const detail = book.detail;
    if (!detail) { ask(folder, "novel/book", { id: book.id }).then((value) => { book.detail = value; render(); }).catch(() => {}); rows.push(node({ depth: depth + 1, name: "…", cls: "group" })); }
    else for (const chapter of detail.chapters) {
      const chapterKey = `${key}|${chapter.id}`, chapterOpen = expanded.has(chapterKey);
      rows.push(node({ depth: depth + 1, chev: chapter.children.length ? chapterOpen : null, icon: "§", name: chapter.label, nameClass: "book", desc: chapter.children.length ? `${chapter.children.length}` : "",
        onClick: (event) => { if (event.target.closest(".chev")) { toggle(chapterKey); return; } goTo(folder, book, detail.uri, chapter.range); } }));
      if (chapterOpen) for (const part of chapter.children) rows.push(node({ depth: depth + 2, icon: part.kind === "scene" ? "◦" : "·", name: part.label, desc: part.detail || "", onClick: () => goTo(folder, book, detail.uri, part.range) }));
    }
  }
  return rows;
}
function render() {
  const tree = $("tree"), scroll = tree.scrollTop;
  tree.replaceChildren();
  for (const lib of libs) {
    const open = expanded.has(lib.path);
    const remove = actionButton("⋯", "", "Show in Finder, or remove from the console", () => libraryMenu(lib));
    tree.append(node({ cls: "lib", chev: open, icon: "🗂", name: lib.name, desc: lib.exists ? "" : "folder gone", action: remove, title: lib.path, onClick: () => { if (open) { expanded.delete(lib.path); expanded.add(`closed:${lib.path}`); } else { expanded.add(lib.path); expanded.delete(`closed:${lib.path}`); } render(); } }));
    if (!open) continue;
    const data = trees.get(lib.path);
    if (!data) { tree.append(node({ depth: 1, name: "Looking for books…", cls: "group" })); continue; }
    if (data.error) { tree.append(node({ depth: 1, name: data.error, cls: "group" })); continue; }
    for (const universe of data.universes) {
      const key = `u|${lib.path}|${universe.id}`, uOpen = !expanded.has(`closed:${key}`);
      tree.append(node({ depth: 1, chev: uOpen, icon: "◎", name: universe.name, nameClass: "book", desc: `${universe.books.length} ${universe.books.length === 1 ? "book" : "books"}`, onClick: () => { toggle(`closed:${key}`); } }));
      if (uOpen) for (const book of universe.books) tree.append(...bookRow(lib.path, book, 2));
    }
    if (data.unsorted.length) {
      tree.append(node({ depth: 1, chev: null, icon: "", name: `Not arranged · ${data.unsorted.length}`, cls: "group" }));
      for (const book of data.unsorted) tree.append(...bookRow(lib.path, book, 2));
    }
    if (!data.universes.length && !data.unsorted.length) tree.append(node({ depth: 1, name: "No EPUB or text files here.", cls: "group" }));
  }
  tree.scrollTop = scroll;
}
const toggle = (key) => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); render(); };
async function libraryMenu(lib) {
  const choice = await chooser(`${lib.name}`, lib.path, [["Show in Finder", "reveal"], ["Remove from the console", "remove"]]);
  if (choice === "reveal") host.reveal(lib.path);
  if (choice === "remove") { libs = await host.removeLibrary(lib.path); trees.delete(lib.path); if (current?.folder === lib.path) closeBook(); render(); }
}
function chooser(title, detail, options) {
  return new Promise((done) => {
    const toast = $("toast"); toast.hidden = false;
    toast.innerHTML = `<b>${esc(title)}</b><span class="muted">${esc(detail)}</span><div class="row">${options.map(([label, value]) => `<button data-v="${esc(value)}">${esc(label)}</button>`).join("")}<button data-v="" class="ghost">Cancel</button></div>`;
    toast.onclick = (event) => { const button = event.target.closest("button"); if (!button) return; toast.hidden = true; done(button.dataset.v || null); };
  });
}
async function addLibrary() {
  say("Choose a folder of books…");
  try { libs = await host.addLibrary(); say("Looking for books…"); await refresh(); say(`${libs.length} ${libs.length === 1 ? "library" : "libraries"}.`); }
  catch (error) { say(error.message, true); }
}

// The reader: one book at a time, in a frame that asks the server through this window.
function openBook(folder, book, at) {
  const key = `${folder}|${book.id}`;
  if (current?.key === key && at) { $("reader").contentWindow.postMessage({ type: "reveal", sentence: at }, "*"); return; }
  current = { key, folder, id: book.id, title: book.title, book };
  $("welcome").hidden = true; $("reader").hidden = false;
  $("reader").src = `app://console/reader?id=${encodeURIComponent(book.id)}${at ? `&at=${encodeURIComponent(at)}` : ""}`;
  $("crumb").textContent = book.title;
  record = null; showPanel(panelTab === "record" ? "cast" : panelTab);
  render();
}
function closeBook() { current = null; $("reader").hidden = true; $("reader").src = "about:blank"; $("welcome").hidden = false; $("crumb").textContent = ""; showPanel("cast"); }
async function goTo(folder, book, uri, range) {
  if (!book.reading) { say(`${book.title} has no reading yet: press ▶ to read it.`); return; }
  const found = await ask(folder, "novel/sentenceAt", { textDocument: { uri }, position: range.start }).catch(() => null);
  openBook(folder, book, found?.sentence ?? null);
}
window.addEventListener("message", async (event) => {
  if (event.source !== $("reader").contentWindow || !current) return;
  const message = event.data || {}, folder = current.folder;
  if (message.id !== undefined && message.method) {
    try { event.source.postMessage({ reply: message.id, result: await ask(folder, message.method, { ...message.params, id: current.id }) }, "*"); }
    catch (error) { event.source.postMessage({ reply: message.id, error: error.message }, "*"); }
    return;
  }
  if (message.type === "record" || message.type === "references") showRecord(message.entity);
  if (message.type === "error") say(`Reader: ${message.message}`, true);
});

// The panel: the book's cast, its problems, one record with every line that refers to it.
function showPanel(tab) {
  panelTab = tab;
  for (const button of document.querySelectorAll(".tabs button")) button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  const body = $("panel-body");
  if (!current) { body.innerHTML = `<p class="muted">Open a book that has a reading to see its people, places and things.</p>`; return; }
  if (tab === "cast") return castPanel(body);
  if (tab === "problems") return problemsPanel(body);
  return record ? recordPanel(body, record) : (body.innerHTML = `<p class="muted">Tap a name in the cast, or in the reader's notes, to see its record and every line that refers to it.</p>`);
}
async function castPanel(body) {
  body.innerHTML = `<p class="muted">Reading the cast…</p>`;
  const cast = await ask(current.folder, "novel/cast", { id: current.id, limit: 400 }).catch((error) => ({ error: error.message }));
  if (panelTab !== "cast") return;
  if (cast.error) { body.innerHTML = `<p class="muted">${esc(cast.error)}</p>`; return; }
  const groups = [["People", (s) => s.category === "person" && !s.unnamed], ["Places", (s) => s.category === "place"], ["Things", (s) => s.category === "thing"], ["Concepts", (s) => s.category === "concept"], ["Unnamed people and crowds", (s) => s.unnamed]];
  body.innerHTML = groups.map(([label, fits]) => { const list = cast.symbols.filter(fits); return list.length ? `<h3>${label} · ${list.length}</h3><ul class="list">${list.map((s) => `<li data-entity="${esc(s.id)}"><span class="who c-${esc(s.category)}">${esc(s.label)}</span><span class="n">${s.references}</span></li>`).join("")}</ul>` : ""; }).join("") || `<p class="muted">No cast.</p>`;
}
async function problemsPanel(body) {
  body.innerHTML = `<p class="muted">Reading the problems…</p>`;
  const found = await ask(current.folder, "novel/bookProblems", { id: current.id, limit: 500 }).catch((error) => ({ error: error.message }));
  if (panelTab !== "problems") return;
  if (found.error) { body.innerHTML = `<p class="muted">${esc(found.error)}</p>`; return; }
  body.innerHTML = found.problems.length ? `<h3>${found.total} ${found.total === 1 ? "problem" : "problems"}</h3><ul class="list">${found.problems.map((p) => `<li class="ref" data-line="${esc(p.line)}"><span class="problem">${esc(p.message)}</span><small>${esc(p.chapterTitle ?? "")}${p.scene ? ` · scene ${p.scene}` : ""}</small></li>`).join("")}</ul>` : `<p class="muted">No problems in this book's reading.</p>`;
}
async function showRecord(entity) { record = entity; showPanel("record"); }
async function recordPanel(body, entity) {
  body.innerHTML = `<p class="muted">Reading the record…</p>`;
  const link = await ask(current.folder, "novel/record", { id: current.id, entity }).catch(() => null);
  const doc = link ? await ask(current.folder, "novel/document", { uri: link.uri }).catch(() => null) : null;
  const refs = await ask(current.folder, "novel/refs", { id: current.id, entity, limit: 200 }).catch(() => null);
  if (panelTab !== "record" || record !== entity) return;
  const lines = (refs?.books ?? []).map((book) => `<h3>${esc(book.title)} · ${book.references} lines${book.more ? ` (first ${book.shown.length})` : ""}</h3><ul class="list">${book.shown.map((r) => `<li class="ref" data-line="${esc(r.line)}" data-book="${esc(book.book)}"><span class="line">${esc(r.text ?? r.line)}</span><small>${esc(r.chapterTitle ?? "")} · scene ${r.scene} · ${esc((r.how ?? []).join(", "))}${r.confidence !== undefined ? ` · ${Math.round(r.confidence * 100)}%` : ""}</small></li>`).join("")}</ul>`).join("");
  body.innerHTML = `<div class="record">${markdown(doc?.text ?? `# ${entity}`)}</div>${lines}`;
}
function markdown(text) {
  const out = [], lines = text.split("\n");
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (/^> /.test(line)) out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (/^\|/.test(line)) { const rows = []; for (; i < lines.length && /^\|/.test(lines[i]); i++) if (!/^\|\s*-/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((cell) => cell.trim())); i--; out.push(`<table>${rows.map((cells, n) => `<tr>${cells.map((cell) => (n === 0 ? `<th>${inline(cell)}</th>` : `<td>${inline(cell)}</td>`)).join("")}</tr>`).join("")}</table>`); }
    else if (/^- /.test(line)) out.push(`<p>· ${inline(line.slice(2))}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  return out.join("");
}
$("panel-body").addEventListener("click", (event) => {
  const entity = event.target.closest("[data-entity]")?.dataset.entity;
  if (entity) { showRecord(entity); return; }
  const line = event.target.closest("[data-line]");
  if (!line || !current) return;
  const other = line.dataset.book && line.dataset.book !== current.book.path ? bookList(trees.get(current.folder) ?? { universes: [], unsorted: [] }).find((book) => book.path === line.dataset.book) : null;
  if (other) openBook(current.folder, other, line.dataset.line);
  else $("reader").contentWindow.postMessage({ type: "reveal", sentence: line.dataset.line }, "*");
});
for (const button of document.querySelectorAll(".tabs button")) button.addEventListener("click", () => showPanel(button.dataset.tab));

// Keys and readings.
async function keyDots() { const keys = await host.keys().catch(() => ({})); $("dot-jev").classList.toggle("on", Boolean(keys.jev)); $("dot-work").classList.toggle("on", Boolean(keys.work)); return keys; }
async function enterKeys() {
  const keys = await keyDots();
  $("state-jev").textContent = keys.jev ? "set" : "not set"; $("state-work").textContent = keys.work ? "set" : "not set";
  $("key-jev").value = ""; $("key-work").value = "";
  const dialog = $("keys-dialog");
  dialog.showModal();
  return new Promise((done) => {
    dialog.addEventListener("close", async () => {
      if (dialog.returnValue === "save") { try { await host.setKeys({ jev: $("key-jev").value, work: $("key-work").value }); say("Keys saved."); } catch (error) { say(error.message, true); } }
      $("key-jev").value = ""; $("key-work").value = "";
      done(await keyDots());
    }, { once: true });
  });
}
async function runReading(folder, book) {
  let keys = await keyDots();
  if (!keys.jev || !keys.work) { keys = await enterKeys(); if (!keys.jev || !keys.work) { say("A reading needs both keys: Jev's and the work model's.", true); return; } }
  try {
    const started = await ask(folder, "novel/startReading", { id: book.id });
    say(`Reading ${book.title}: about $${started.estimate}. It goes on if you close the window.`);
    await load(folder); render(); follow();
  } catch (error) { say(error.message, true); }
}
async function stopReading(folder, book) {
  const choice = await chooser(`Stop reading ${book.title}?`, "What it has asked stays cached: starting it again pays only for the rest.", [["Stop", "stop"]]);
  if (choice !== "stop") return;
  await ask(folder, "novel/stopReading", { id: book.id }).catch(() => {});
  await load(folder); render();
}
// While a reading runs, the tree is read again every few seconds; when one ends, it says so.
let following = null;
function follow() {
  for (const lib of libs) for (const book of bookList(trees.get(lib.path) ?? { universes: [], unsorted: [] })) {
    const key = `${lib.path}|${book.id}`, was = running.get(key), now = book.job?.state;
    if (now === "running") running.set(key, book);
    else if (was) {
      running.delete(key);
      if (now === "done") chooser(`${book.title} is read`, `${book.job.steps} steps.`, [["Open it", "open"]]).then((choice) => { if (choice === "open") openBook(lib.path, book, null); });
      else if (now === "failed") say(`The reading of ${book.title} failed: ${book.job.error ?? "see its log in .novel"}`, true);
    }
  }
  $("readings").textContent = running.size ? `${running.size} reading${running.size === 1 ? "" : "s"} running` : "";
  if (running.size && !following) following = setInterval(async () => { for (const lib of libs) await load(lib.path); render(); follow(); }, 3000);
  if (!running.size && following) { clearInterval(following); following = null; }
}

$("add").addEventListener("click", addLibrary);
$("add-2").addEventListener("click", addLibrary);
$("keys").addEventListener("click", enterKeys);
$("refresh").addEventListener("click", async () => { say("Looking for new books…"); await refresh(true); say("Up to date."); });
window.addEventListener("focus", () => refresh());
refresh().then(keyDots).then(() => { $("welcome").hidden = Boolean(current); });
