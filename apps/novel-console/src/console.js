"use strict";
// The console's window (docs/v3/plan.md §1.5a): the library and the book are always there; the side bar (Characters, Places,
// Strands, Record, Problems: each folds) and the chat fold. Time is an ordered tree, places an unordered one, characters and
// things are movables at a place at a time, and the strands draw that. Everything comes from window.novelHost (preload.js).
const host = window.novelHost;
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const remember = { get(key, fallback) { try { const value = localStorage.getItem(`console:${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(`console:${key}`, JSON.stringify(value)); } catch {} } };

let libs = [], current = null, world = null, record = null, selectedChar = null, selectedPlace = null, strandFocus = null;
const trees = new Map(), books = new Map(), expanded = new Set(), running = new Map(), worlds = new Map();
const ask = (folder, method, params) => host.ask(folder, method, params);
const say = (text, bad = false) => { $("status").textContent = text; $("status").className = bad ? "err" : ""; };
const bookList = (tree) => [...tree.universes.flatMap((universe) => universe.books), ...tree.unsorted];

// ---------- Layout: day and night, the side bar and the chat, the views' folds, the splitters. ----------
function daylight(mode) {
  document.documentElement.dataset.daylight = mode; remember.set("daylight", mode);
  $("reader").contentWindow?.postMessage({ type: "theme", mode: mode === "day" ? "light" : "dark" }, "*");
}
function pane(name, open) {
  const work = $("work"), cls = name === "side" ? "no-side" : "no-chat";
  work.classList.toggle(cls, !open); $(name === "side" ? "t-side" : "t-chat").setAttribute("aria-pressed", String(open)); remember.set(`pane:${name}`, open);
  if (name === "chat" && open && !hostsLoaded) loadHosts();
}
const paneOpen = (name) => !$("work").classList.contains(name === "side" ? "no-side" : "no-chat");
function fold(view, folded) {
  const section = document.querySelector(`.view[data-view="${view}"]`);
  section.classList.toggle("folded", folded); section.querySelector(".chev").textContent = folded ? "▸" : "▾";
  const folds = remember.get("folds", {}); folds[view] = folded; remember.set("folds", folds);
  if (!folded) renderView(view);
}
for (const head of document.querySelectorAll(".view-head")) head.addEventListener("click", (event) => { if (event.target.closest(".seg")) return; const view = head.parentElement.dataset.view; fold(view, !head.parentElement.classList.contains("folded")); });
for (const split of document.querySelectorAll(".split")) {
  split.addEventListener("pointerdown", (event) => {
    const which = split.dataset.split, work = $("work"), start = event.clientX, style = getComputedStyle(work), key = { library: "--lib-w", side: "--side-w", chat: "--chat-w" }[which];
    const from = parseFloat(style.getPropertyValue(key)) || 300, sign = which === "library" ? 1 : -1;
    split.classList.add("dragging"); split.setPointerCapture(event.pointerId);
    const move = (e) => { const width = Math.max(200, Math.min(720, from + sign * (e.clientX - start))); work.style.setProperty(key, `${width}px`); };
    const up = () => { split.classList.remove("dragging"); split.removeEventListener("pointermove", move); remember.set(`width:${which}`, parseFloat(getComputedStyle(work).getPropertyValue(key))); };
    split.addEventListener("pointermove", move); split.addEventListener("pointerup", up, { once: true });
  });
}
$("t-side").addEventListener("click", () => pane("side", !paneOpen("side")));
$("t-chat").addEventListener("click", () => pane("chat", !paneOpen("chat")));
$("t-daylight").addEventListener("click", () => daylight(document.documentElement.dataset.daylight === "day" ? "night" : "day"));
document.addEventListener("keydown", (event) => {
  if (!event.metaKey || event.altKey || event.shiftKey) return;
  if (event.key === "b") { event.preventDefault(); pane("side", !paneOpen("side")); }
  if (event.key === "i") { event.preventDefault(); pane("chat", !paneOpen("chat")); }
});

// ---------- The library. ----------
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
function node({ depth = 0, chev = null, icon = "", name = "", nameClass = "", desc = "", action = null, cls = "", title = "", onClick = null }) {
  const row = document.createElement("div");
  row.className = `node ${cls}`; row.style.setProperty("--depth", depth); row.setAttribute("role", "treeitem"); if (title) row.title = title;
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
  const row = node({ depth, chev: book.missing ? null : open, icon: book.reading ? "📖" : "📄", name: book.title, nameClass: "book", desc, action, cls: current?.key === key ? "current" : "",
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
    tree.append(node({ cls: "lib", chev: open, icon: "🗂", name: lib.name, desc: lib.exists ? "" : "folder gone", action: actionButton("⋯", "", "Show in Finder, or remove from the console", () => libraryMenu(lib)), title: lib.path, onClick: () => { if (open) { expanded.delete(lib.path); expanded.add(`closed:${lib.path}`); } else { expanded.add(lib.path); expanded.delete(`closed:${lib.path}`); } render(); } }));
    if (!open) continue;
    const data = trees.get(lib.path);
    if (!data) { tree.append(node({ depth: 1, name: "Looking for books…", cls: "group" })); continue; }
    if (data.error) { tree.append(node({ depth: 1, name: data.error, cls: "group" })); continue; }
    for (const universe of data.universes) {
      const key = `u|${lib.path}|${universe.id}`, uOpen = !expanded.has(`closed:${key}`);
      tree.append(node({ depth: 1, chev: uOpen, icon: "◎", name: universe.name, nameClass: "book", desc: `${universe.books.length} ${universe.books.length === 1 ? "book" : "books"}`, onClick: () => toggle(`closed:${key}`) }));
      if (uOpen) for (const book of universe.books) tree.append(...bookRow(lib.path, book, 2));
    }
    if (data.unsorted.length) { tree.append(node({ depth: 1, name: `Not arranged · ${data.unsorted.length}`, cls: "group" })); for (const book of data.unsorted) tree.append(...bookRow(lib.path, book, 2)); }
    if (!data.universes.length && !data.unsorted.length) tree.append(node({ depth: 1, name: "No EPUB or text files here.", cls: "group" }));
  }
  tree.scrollTop = scroll;
}
const toggle = (key) => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); render(); };
async function libraryMenu(lib) {
  const choice = await chooser(lib.name, lib.path, [["Show in Finder", "reveal"], ["Remove from the console", "remove"]]);
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

// ---------- The book: the reader in a frame that asks the server through this window. ----------
function openBook(folder, book, at) {
  const key = `${folder}|${book.id}`;
  if (current?.key === key) { if (at) $("reader").contentWindow.postMessage({ type: "reveal", sentence: at }, "*"); return; }
  current = { key, folder, id: book.id, title: book.title, book };
  $("welcome").hidden = true; $("reader").hidden = false;
  $("reader").src = `app://console/reader?id=${encodeURIComponent(book.id)}${at ? `&at=${encodeURIComponent(at)}` : ""}`;
  $("crumb").textContent = book.title;
  world = null; record = null; selectedChar = null; selectedPlace = null; strandFocus = null;
  render(); loadWorld(); renderAll();
}
function closeBook() { current = null; world = null; $("reader").hidden = true; $("reader").src = "about:blank"; $("welcome").hidden = false; $("crumb").textContent = ""; renderAll(); }
const reveal = (sentence) => { if (current && sentence) $("reader").contentWindow.postMessage({ type: "reveal", sentence }, "*"); };
async function goTo(folder, book, uri, range) {
  if (!book.reading) { say(`${book.title} has no reading yet: press ▶ to read it.`); return; }
  const found = await ask(folder, "novel/sentenceAt", { textDocument: { uri }, position: range.start }).catch(() => null);
  if (current?.key === `${folder}|${book.id}`) reveal(found?.sentence); else openBook(folder, book, found?.sentence ?? null);
}
$("reader").addEventListener("load", () => daylight(document.documentElement.dataset.daylight));
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

// ---------- The world: time (an ordered tree), places (an unordered tree), movables, strands. ----------
async function loadWorld() {
  const at = current; if (!at) return;
  const cached = worlds.get(at.key);
  if (cached) { world = cached; renderAll(); return; }
  try { const value = await ask(at.folder, "novel/world", { id: at.id }); worlds.set(at.key, value); if (current === at) { world = value; renderAll(); } }
  catch (error) { if (current === at) { world = { error: error.message }; renderAll(); } }
}
const views = ["characters", "places", "strands", "record", "problems"];
const isOpen = (view) => paneOpen("side") && !document.querySelector(`.view[data-view="${view}"]`).classList.contains("folded");
function renderAll() { for (const view of views) renderView(view); }
function renderView(view) {
  const body = $(`v-${view}`);
  if (view === "record") return renderRecord(body);
  if (view === "problems") return renderProblems(body);
  if (!current) { body.innerHTML = `<p class="empty">Open a book that has a reading.</p>`; $(`n-${view}`).textContent = ""; return; }
  if (!world) { body.innerHTML = `<p class="empty">Reading the book's world…</p>`; return; }
  if (world.error) { body.innerHTML = `<p class="empty">${esc(world.error)}</p>`; return; }
  if (view === "characters") renderCharacters(body);
  if (view === "places") renderPlaces(body);
  if (view === "strands") renderStrands(body);
}
const timeOf = (() => { const memo = new WeakMap(); return () => { if (!world?.time) return new Map(); if (!memo.has(world)) memo.set(world, new Map(world.time.map((node) => [node.id, node]))); return memo.get(world); }; })();
const dayOf = (scene) => { const nodes = timeOf(); for (let at = nodes.get(scene.node), n = 0; at && n < 8; at = nodes.get(at.parent), n++) if (at.level === "day") return at.label; return null; };
const whenOf = (scene) => (scene.when ? scene.when.split(" › ").slice(1).join(" ") : "—") + (scene.flashback ? " (past)" : "");
const placeName = (id) => { if (!id) return "—"; const place = world.places.find((entry) => entry.id === id); return place ? place.label : id; };
const nameOf = (id) => world.movables[id]?.[0] ?? id;
const laneColor = (lane) => `var(--lane-${(lane ?? 0) % 10})`;
const storyScenes = () => { if (!world.story) world.story = [...world.scenes].sort((a, b) => (a.story ?? 1e9) - (b.story ?? 1e9) || a.index - b.index); return world.story; };

function renderCharacters(body) {
  const kind = remember.get("charKind", "people");
  for (const button of document.querySelectorAll("#char-kind button")) button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
  const counts = new Map();
  for (const scene of world.scenes) { for (const id of scene.present) counts.set(id, (counts.get(id) ?? 0) + 1); for (const thing of scene.things) counts.set(thing.id, (counts.get(thing.id) ?? 0) + 1); }
  const fits = ([, [, category, unnamed]]) => (kind === "people" ? category === "person" && !unnamed : kind === "things" ? category !== "person" && !unnamed : Boolean(unnamed));
  const list = Object.entries(world.movables).filter(fits).sort((a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0)).slice(0, 400);
  $("n-characters").textContent = String(Object.keys(world.movables).length);
  body.innerHTML = list.length ? `<ul class="rows">${list.map(([id, [label, category, unnamed]]) => `<li data-char="${esc(id)}" class="${selectedChar === id ? "on" : ""}"><span class="nm ${unnamed ? "unnamed" : `c-${esc(category)}`}">${esc(label)}</span><span class="n">${counts.get(id) ?? 0} scenes</span></li>${selectedChar === id ? pathOf(id) : ""}`).join("")}</ul>` : `<p class="empty">None in this book.</p>`;
  const on = body.querySelector("li.on"); if (on) on.scrollIntoView({ block: "nearest" });
}
/** A movable's path: scene by scene in story order, runs at the same place on the same strand joined. */
function pathOf(id) {
  const steps = [];
  for (const scene of storyScenes()) {
    if (!scene.present.includes(id) && !scene.things.some((thing) => thing.id === id)) continue;
    const last = steps.at(-1);
    if (last && last.place === scene.place && last.strand === scene.strand) { last.count++; continue; }
    steps.push({ place: scene.place, strand: scene.strand, lane: scene.lane, first: scene, count: 1 });
  }
  return `<li style="display:block;cursor:default;padding:0"><div class="chips" style="margin:2px 0 4px 20px"><button class="chip" data-record="${esc(id)}">Record and every line</button><span class="mini">${steps.length} ${steps.length === 1 ? "stop" : "stops"}</span></div><ul class="path">${steps.map((step) => `<li data-sentence="${esc(step.first.first)}" title="${esc(step.first.when ?? "")}"><span class="lane" style="--lc:${laneColor(step.lane)}"></span><span class="where">${esc(placeName(step.place))}${step.count > 1 ? ` <span class="mini">× ${step.count}</span>` : ""}</span><span class="when">${esc(whenOf(step.first))}</span></li>`).join("")}</ul></li>`;
}
$("v-characters").addEventListener("click", (event) => {
  const sentence = event.target.closest("[data-sentence]")?.dataset.sentence; if (sentence) { reveal(sentence); return; }
  const recordOf = event.target.closest("[data-record]")?.dataset.record; if (recordOf) { showRecord(recordOf); return; }
  const id = event.target.closest("[data-char]")?.dataset.char; if (!id) return;
  selectedChar = selectedChar === id ? null : id; renderView("characters");
});
for (const button of document.querySelectorAll("#char-kind button")) button.addEventListener("click", (event) => { event.stopPropagation(); remember.set("charKind", button.dataset.kind); renderView("characters"); });

function renderPlaces(body) {
  const children = new Map(), at = new Map(), all = new Map(world.places.map((place) => [place.id, place]));
  for (const scene of world.scenes) if (scene.place) at.set(scene.place, (at.get(scene.place) ?? 0) + 1);
  for (const place of world.places) { const parent = place.parent && all.has(place.parent) ? place.parent : ""; (children.get(parent) ?? children.set(parent, []).get(parent)).push(place); }
  const total = new Map(); const sum = (id) => { if (total.has(id)) return total.get(id); total.set(id, 0); const n = (at.get(id) ?? 0) + (children.get(id) ?? []).reduce((acc, child) => acc + sum(child.id), 0); total.set(id, n); return n; };
  for (const place of world.places) sum(place.id);
  const open = remember.get(`places:${current.key}`, null) ?? Object.fromEntries((children.get("") ?? []).map((place) => [place.id, true]));
  const branch = (parent) => `<ul${parent ? "" : ' class="ptree"'}>${(children.get(parent) ?? []).filter((place) => total.get(place.id) > 0 || !place.unnamed).sort((a, b) => total.get(b.id) - total.get(a.id)).map((place) => {
    const kids = (children.get(place.id) ?? []).length, opened = open[place.id];
    return `<li><div class="prow ${selectedPlace === place.id ? "on" : ""}" data-place="${esc(place.id)}"><span class="chev" data-fold="${esc(place.id)}">${kids ? (opened ? "▾" : "▸") : ""}</span><span class="nm ${place.unnamed ? "unnamed" : "c-place"}">${esc(place.label)}</span><span class="sc">${esc(place.scale ?? "")}</span><span class="n">${total.get(place.id)}</span></div>${kids && opened ? branch(place.id) : ""}</li>`;
  }).join("")}</ul>`;
  $("n-places").textContent = String(world.places.length);
  body.innerHTML = branch("") + (selectedPlace ? placeDetail(selectedPlace, children) : "");
  body.dataset.open = JSON.stringify(open);
}
function placeDetail(id, children) {
  const inside = new Set([id]); const add = (p) => { for (const child of children.get(p) ?? []) { inside.add(child.id); add(child.id); } }; add(id);
  const scenes = storyScenes().filter((scene) => inside.has(scene.place));
  const people = new Map(); for (const scene of scenes) for (const who of scene.present) people.set(who, (people.get(who) ?? 0) + 1);
  return `<div class="detail"><h4>${esc(placeName(id))} · ${scenes.length} scenes</h4><div class="chips">${[...people].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([who, n]) => `<button class="chip" data-char-open="${esc(who)}">${esc(nameOf(who))} ${n}</button>`).join("")}</div>${scenes.slice(0, 80).map((scene) => `<div class="scene-row" data-sentence="${esc(scene.first)}"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${laneColor(scene.lane)}"></span> <span class="mini">${esc(whenOf(scene))}</span> ${scene.place !== id ? `<span class="c-place">${esc(placeName(scene.place))}</span>` : ""}</span><span class="mini">${esc(scene.present.slice(0, 5).map(nameOf).join(", "))}${scene.present.length > 5 ? ` +${scene.present.length - 5}` : ""}</span></div>`).join("")}</div>`;
}
$("v-places").addEventListener("click", (event) => {
  const sentence = event.target.closest("[data-sentence]")?.dataset.sentence; if (sentence) { reveal(sentence); return; }
  const who = event.target.closest("[data-char-open]")?.dataset.charOpen; if (who) { selectedChar = who; fold("characters", false); renderView("characters"); return; }
  const folder = event.target.closest("[data-fold]")?.dataset.fold, body = $("v-places"), open = JSON.parse(body.dataset.open || "{}");
  if (folder) { open[folder] = !open[folder]; remember.set(`places:${current.key}`, open); renderView("places"); return; }
  const id = event.target.closest("[data-place]")?.dataset.place; if (!id) return;
  selectedPlace = selectedPlace === id ? null : id; renderView("places");
});

function renderStrands(body) {
  const scenes = storyScenes(), told = world.strands.filter((strand) => !strand.past), lanes = Math.max(1, ...world.strands.map((strand) => strand.lane + 1));
  const rowOf = new Map(scenes.map((scene, n) => [scene.id, n])), span = new Map();
  for (const strand of world.strands) { const rows = strand.scenes.map((id) => rowOf.get(id)).filter((n) => n !== undefined); if (rows.length) span.set(strand.id, [Math.min(...rows), Math.max(...rows)]); }
  const byId = new Map(world.strands.map((strand) => [strand.id, strand])), W = 12, gw = lanes * W + 8;
  const x = (lane) => 6 + lane * W;
  $("n-strands").textContent = String(told.length);
  let day = null, html = `<div class="legend">${told.map((strand) => `<button data-strand="${esc(strand.id)}" aria-pressed="${strandFocus === strand.id}" style="--lc:${laneColor(strand.lane)}" title="${esc(strand.people.map(nameOf).join(", "))}"><i></i>${esc(strand.people.slice(0, 2).map(nameOf).join(", ") || "—")}${strand.people.length > 2 ? ` +${strand.people.length - 2}` : ""} · ${strand.scenes.length}${strand.open ? "" : strand.into ? " → joins" : ""}</button>`).join("")}</div><div class="graph" style="--gw:${gw}px">`;
  scenes.forEach((scene, r) => {
    const today = dayOf(scene);
    if (today && today !== day) { day = today; html += `<div class="day-row">${esc(today)}</div>`; }
    let svg = "";
    for (const strand of world.strands) {
      const [from, to] = span.get(strand.id) ?? [-1, -1]; if (r < from || r > to) continue;
      const cx = x(strand.lane), color = laneColor(strand.lane);
      if (r > from) svg += `<line x1="${cx}" y1="0" x2="${cx}" y2="11" stroke="${color}" stroke-width="2"/>`;
      if (r < to) svg += `<line x1="${cx}" y1="11" x2="${cx}" y2="22" stroke="${color}" stroke-width="2"/>`;
      if (r === from) for (const parent of strand.splitFrom) { const p = byId.get(parent); if (p) svg += `<path d="M${x(p.lane)} 0 C ${x(p.lane)} 8, ${cx} 4, ${cx} 11" fill="none" stroke="${color}" stroke-width="2"/>`; }
      if (r === to && strand.into) { const target = byId.get(strand.into); if (target) svg += `<path d="M${cx} 11 C ${cx} 18, ${x(target.lane)} 14, ${x(target.lane)} 22" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3 2"/>`; }
    }
    const lane = scene.lane ?? 0, own = laneColor(lane);
    svg += scene.flashback ? `<circle cx="${x(lane)}" cy="11" r="4" fill="var(--panel)" stroke="${own}" stroke-width="2"/>` : `<circle cx="${x(lane)}" cy="11" r="4" fill="${own}"/>`;
    const dim = strandFocus && scene.strand !== strandFocus ? " dim" : "";
    html += `<div class="grow-row${dim}" data-sentence="${esc(scene.first)}" title="${esc(`${scene.id} · ${scene.when ?? ""}`)}"><svg width="${gw}" height="22" viewBox="0 0 ${gw} 22">${svg}</svg><span class="txt"><span class="pl">${esc(placeName(scene.place))}</span><span class="pp">${esc(scene.present.slice(0, 3).map(nameOf).join(", "))}${scene.present.length > 3 ? ` +${scene.present.length - 3}` : ""}</span></span></div>`;
  });
  body.innerHTML = `${html}</div>`;
}
$("v-strands").addEventListener("click", (event) => {
  const strand = event.target.closest("[data-strand]")?.dataset.strand; if (strand) { strandFocus = strandFocus === strand ? null : strand; renderView("strands"); return; }
  const sentence = event.target.closest("[data-sentence]")?.dataset.sentence; if (sentence) reveal(sentence);
});

// ---------- Record and problems. ----------
function showRecord(entity) { record = entity; if (!paneOpen("side")) pane("side", true); fold("record", false); }
async function renderRecord(body) {
  if (!current || !record) { body.innerHTML = `<p class="empty">Tap a name in the reader's notes, or "Record and every line" under a character, to see the record and every line that refers to it.</p>`; $("n-record").textContent = ""; return; }
  const entity = record, at = current;
  body.innerHTML = `<p class="empty">Reading the record…</p>`;
  const link = await ask(at.folder, "novel/record", { id: at.id, entity }).catch(() => null);
  const doc = link ? await ask(at.folder, "novel/document", { uri: link.uri }).catch(() => null) : null;
  const refs = await ask(at.folder, "novel/refs", { id: at.id, entity, limit: 200 }).catch(() => null);
  if (record !== entity || current !== at) return;
  $("n-record").textContent = link?.label ?? "";
  const lines = (refs?.books ?? []).map((book) => `<h4 class="mini" style="margin:12px 0 4px;text-transform:uppercase;letter-spacing:.05em">${esc(book.title)} · ${book.references} lines${book.more ? ` (first ${book.shown.length})` : ""}</h4>${book.shown.map((r) => `<div class="ref" data-line="${esc(r.line)}" data-book="${esc(book.book)}"><span class="line">${esc(r.text ?? r.line)}</span><small>${esc(r.chapterTitle ?? "")} · scene ${r.scene} · ${esc((r.how ?? []).join(", "))}${r.confidence !== undefined ? ` · ${Math.round(r.confidence * 100)}%` : ""}</small></div>`).join("")}`).join("");
  body.innerHTML = `<div class="record">${markdown(doc?.text ?? `# ${entity}`)}</div>${lines}`;
}
async function renderProblems(body) {
  if (!current) { body.innerHTML = `<p class="empty">Open a book that has a reading.</p>`; $("n-problems").textContent = ""; return; }
  if (!isOpen("problems")) { const known = current.book.problems; $("n-problems").textContent = known ? String(known) : ""; return; }
  const at = current;
  body.innerHTML = `<p class="empty">Reading the problems…</p>`;
  const found = await ask(at.folder, "novel/bookProblems", { id: at.id, limit: 500 }).catch((error) => ({ error: error.message }));
  if (current !== at) return;
  if (found.error) { body.innerHTML = `<p class="empty">${esc(found.error)}</p>`; return; }
  $("n-problems").textContent = String(found.total);
  body.innerHTML = found.problems.length ? found.problems.map((p) => `<div class="ref" data-line="${esc(p.line)}"><span class="problem">${esc(p.message)}</span><small>${esc(p.chapterTitle ?? "")}${p.scene ? ` · scene ${p.scene}` : ""}</small></div>`).join("") : `<p class="empty">No problems in this book's reading.</p>`;
}
function markdown(text) {
  const out = [], lines = text.split("\n"), inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
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
for (const id of ["v-record", "v-problems"]) $(id).addEventListener("click", (event) => {
  const line = event.target.closest("[data-line]"); if (!line || !current) return;
  const other = line.dataset.book && line.dataset.book !== current.book.path ? bookList(trees.get(current.folder) ?? { universes: [], unsorted: [] }).find((book) => book.path === line.dataset.book) : null;
  if (other) openBook(current.folder, other, line.dataset.line); else reveal(line.dataset.line);
});

// ---------- The chat: the agent hosts' existing sessions. ----------
let hostsLoaded = false, hostList = [], chosenHost = remember.get("chatHost", null), openSession = null;
async function loadHosts() {
  hostsLoaded = true; $("chat-body").innerHTML = `<p class="note">Looking for sessions…</p>`;
  try { hostList = await host.agents(); } catch (error) { $("chat-body").innerHTML = `<p class="note">${esc(error.message)}</p>`; return; }
  if (!hostList.some((entry) => entry.id === chosenHost)) chosenHost = (hostList.find((entry) => entry.sessions.length) ?? hostList[0])?.id ?? null;
  renderHosts(); if (openSession) showSession(openSession); else renderSessions();
}
function renderHosts() { $("hosts").innerHTML = hostList.map((entry) => `<button role="tab" data-host="${esc(entry.id)}" aria-selected="${entry.id === chosenHost}">${esc(entry.name)}<span class="k">${entry.sessions.length}</span></button>`).join(""); }
const ago = (iso) => { const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000); return minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`; };
function renderSessions() {
  openSession = null; $("chat-back").hidden = true; $("compose").hidden = true;
  const entry = hostList.find((item) => item.id === chosenHost);
  if (!entry) { $("chat-body").innerHTML = `<p class="note">No agent hosts are registered.</p>`; return; }
  $("chat-body").innerHTML = `${entry.note ? `<p class="note">${esc(entry.note)}</p>` : ""}${entry.sessions.length ? entry.sessions.map((session) => `<div class="session" data-session="${esc(session.key)}"><span class="t">${esc(session.title)}</span><small>${esc(session.cwd ? session.cwd.split("/").slice(-2).join("/") : "")} · ${esc(ago(session.updated))}</small></div>`).join("") : `<p class="note">No sessions of ${esc(entry.name)} on this Mac.</p>`}`;
}
async function showSession(key) {
  openSession = key; $("chat-back").hidden = false;
  const entry = hostList.find((item) => item.sessions.some((session) => session.key === key)), session = entry?.sessions.find((item) => item.key === key);
  $("chat-body").innerHTML = `<p class="note">Reading the session…</p>`;
  let transcript; try { transcript = await host.transcript(key); } catch (error) { $("chat-body").innerHTML = `<p class="note">${esc(error.message)}</p>`; return; }
  if (openSession !== key) return;
  $("chat-body").innerHTML = `<p class="note"><b>${esc(session?.title ?? "")}</b><br>${esc(entry?.name ?? "")} · ${esc(session?.cwd ?? "")} · the last ${transcript.messages.length} messages</p>${transcript.messages.map((message) => `<div class="msg ${message.role === "user" ? "user" : "assistant"}">${esc(message.text.length > 4000 ? `${message.text.slice(0, 4000)}…` : message.text)}${message.tools ? `<span class="tools">${message.tools} tool ${message.tools === 1 ? "call" : "calls"}</span>` : ""}</div>`).join("")}`;
  $("chat-body").scrollTop = $("chat-body").scrollHeight;
  $("compose").hidden = !entry?.continues;
  $("compose-note").textContent = entry?.continues ? `Sent with ${entry.name}'s own command, in ${session?.cwd ? session.cwd.split("/").pop() : "its folder"}.` : "";
}
$("hosts").addEventListener("click", (event) => { const id = event.target.closest("[data-host]")?.dataset.host; if (!id) return; chosenHost = id; remember.set("chatHost", id); renderHosts(); renderSessions(); });
$("chat-body").addEventListener("click", (event) => { const key = event.target.closest("[data-session]")?.dataset.session; if (key) showSession(key); });
$("chat-back").addEventListener("click", renderSessions);
$("chat-refresh").addEventListener("click", loadHosts);
$("compose").addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = openSession, text = $("compose-text").value.trim(); if (!key || !text) return;
  $("compose-text").value = ""; $("compose-send").disabled = true;
  $("chat-body").insertAdjacentHTML("beforeend", `<div class="msg user">${esc(text)}</div><div class="msg assistant pending" id="pending">Waiting for the reply…</div>`);
  $("chat-body").scrollTop = $("chat-body").scrollHeight;
  try { await host.sendToSession(key, text); if (openSession === key) await showSession(key); }
  catch (error) { const pending = $("pending"); if (pending) pending.textContent = `Not sent: ${error.message}`; }
  finally { $("compose-send").disabled = false; }
});
$("compose-text").addEventListener("keydown", (event) => { if (event.key === "Enter" && event.metaKey) { event.preventDefault(); $("compose").requestSubmit(); } });

// ---------- Keys and readings. ----------
async function keyDots() { const keys = await host.keys().catch(() => ({})); $("dot-jev").classList.toggle("on", Boolean(keys.jev)); $("dot-work").classList.toggle("on", Boolean(keys.work)); return keys; }
async function enterKeys() {
  const keys = await keyDots();
  $("state-jev").textContent = keys.jev ? "set" : "not set"; $("state-work").textContent = keys.work ? "set" : "not set";
  $("key-jev").value = ""; $("key-work").value = "";
  const dialog = $("keys-dialog"); dialog.showModal();
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
  try { const started = await ask(folder, "novel/startReading", { id: book.id }); say(`Reading ${book.title}: about $${started.estimate}. It goes on if you close the window.`); await load(folder); render(); follow(); }
  catch (error) { say(error.message, true); }
}
async function stopReading(folder, book) {
  const choice = await chooser(`Stop reading ${book.title}?`, "What it has asked stays cached: starting it again pays only for the rest.", [["Stop", "stop"]]);
  if (choice !== "stop") return;
  await ask(folder, "novel/stopReading", { id: book.id }).catch(() => {}); await load(folder); render();
}
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

// Start as it was left: day or night, the panes, the folds and the widths.
daylight(remember.get("daylight", "night"));
for (const [which, key] of [["library", "--lib-w"], ["side", "--side-w"], ["chat", "--chat-w"]]) { const width = remember.get(`width:${which}`, null); if (width) $("work").style.setProperty(key, `${width}px`); }
for (const [view, folded] of Object.entries(remember.get("folds", {}))) { const section = document.querySelector(`.view[data-view="${view}"]`); if (section) { section.classList.toggle("folded", folded); section.querySelector(".chev").textContent = folded ? "▸" : "▾"; } }
pane("side", remember.get("pane:side", true)); pane("chat", remember.get("pane:chat", false));
refresh().then(keyDots).then(() => { $("welcome").hidden = Boolean(current); renderAll(); });
