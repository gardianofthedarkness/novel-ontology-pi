"use strict";
// The console's window (docs/v3/plan.md §1.5a): the library and the book are always there; every other view sits behind an
// icon on the right-hand strip, one at a time, the panel folding when its icon is pressed again (as VS Code's activity bar).
// Time is an ordered tree, places an unordered one, characters and things movables at a place at a time; the Strands view
// draws that as a git graph. The reading's details of a line (Jev's and the reading's records) are the debug view's.
const host = window.novelHost;
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const remember = { get(key, fallback) { try { const value = localStorage.getItem(`console:${key}`); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(`console:${key}`, JSON.stringify(value)); } catch {} } };
const pct = (value) => (typeof value === "number" ? `${Math.round(value * 100)}%` : "");

let libs = [], current = null, world = null, record = null, selectedChar = null, selectedPlace = null, strandFocus = null, debugLine = null;
const trees = new Map(), books = new Map(), expanded = new Set(), running = new Map(), worlds = new Map();
const ask = (folder, method, params) => host.ask(folder, method, params);
const say = (text, bad = false) => { $("status").textContent = text; $("status").className = bad ? "err" : ""; };
const bookList = (tree) => [...tree.universes.flatMap((universe) => universe.books), ...tree.unsorted];

// ---------- Layout: day and night, the icon strip and its panel, the splitters. ----------
const TITLES = { characters: "Characters", places: "Places", strands: "Strands", record: "Record", problems: "Problems", debug: "Reading details", chat: "Chat" };
let activeView = remember.get("view", "strands");
const counts = {};
function daylight(mode) {
  document.documentElement.dataset.daylight = mode; remember.set("daylight", mode);
  $("reader").contentWindow?.postMessage({ type: "theme", mode: mode === "day" ? "light" : "dark" }, "*");
}
const panelOpen = () => !$("work").classList.contains("no-panel");
function setPanel(open) { $("work").classList.toggle("no-panel", !open); remember.set("panel", open); markActivity(); }
function markActivity() { for (const button of document.querySelectorAll("#activity button")) button.classList.toggle("active", panelOpen() && button.dataset.view === activeView); }
/** An icon pressed: its view in the panel; pressed again when it shows, the panel folds. */
function show(view, toggle = false) {
  if (toggle && panelOpen() && activeView === view) { setPanel(false); return; }
  activeView = view; remember.set("view", view);
  for (const section of document.querySelectorAll(".panel-view")) section.classList.toggle("active", section.dataset.view === view);
  $("panel-title").textContent = TITLES[view]; $("panel-count").textContent = counts[view] ?? "";
  if (!panelOpen()) setPanel(true); else markActivity();
  if (view === "debug") $("badge-debug").hidden = true;
  if (view === "chat" && !hostsLoaded) loadHosts(); else renderView(view);
}
const setCount = (view, text) => { counts[view] = text; if (activeView === view) $("panel-count").textContent = text ?? ""; };
for (const button of document.querySelectorAll("#activity button")) button.addEventListener("click", () => show(button.dataset.view, true));
$("panel-fold").addEventListener("click", () => setPanel(false));
for (const split of document.querySelectorAll(".split")) {
  split.addEventListener("pointerdown", (event) => {
    const which = split.dataset.split, work = $("work"), start = event.clientX, key = which === "library" ? "--lib-w" : "--panel-w";
    const from = parseFloat(getComputedStyle(work).getPropertyValue(key)) || 320, sign = which === "library" ? 1 : -1;
    split.classList.add("dragging"); split.setPointerCapture(event.pointerId);
    const move = (e) => work.style.setProperty(key, `${Math.max(220, Math.min(760, from + sign * (e.clientX - start)))}px`);
    const up = () => { split.classList.remove("dragging"); split.removeEventListener("pointermove", move); remember.set(`width:${which}`, parseFloat(getComputedStyle(work).getPropertyValue(key))); };
    split.addEventListener("pointermove", move); split.addEventListener("pointerup", up, { once: true });
  });
}
$("t-daylight").addEventListener("click", () => daylight(document.documentElement.dataset.daylight === "day" ? "night" : "day"));
document.addEventListener("keydown", (event) => {
  if (!event.metaKey || event.altKey || event.shiftKey) return;
  if (event.key === "b") { event.preventDefault(); setPanel(!panelOpen()); if (panelOpen()) show(activeView); }
  if (event.key === "i") { event.preventDefault(); show("chat", true); }
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
  world = null; record = null; selectedChar = null; selectedPlace = null; strandFocus = null; debugLine = null;
  const badge = $("badge-problems"); badge.hidden = !book.problems; badge.textContent = book.problems > 99 ? "99+" : String(book.problems || "");
  render(); loadWorld(); renderView(activeView);
}
function closeBook() { current = null; world = null; $("reader").hidden = true; $("reader").src = "about:blank"; $("welcome").hidden = false; $("crumb").textContent = ""; renderView(activeView); }
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
  if (message.type === "selected") { debugLine = message.sentence; if (panelOpen() && activeView === "debug") renderView("debug"); else $("badge-debug").hidden = false; }
  if (message.type === "record" || message.type === "references") showRecord(message.entity);
  if (message.type === "error") say(`Reader: ${message.message}`, true);
});

// ---------- The world: time (an ordered tree), places (an unordered tree), movables, strands. ----------
async function loadWorld() {
  const at = current; if (!at) return;
  const cached = worlds.get(at.key);
  if (cached) { world = cached; renderView(activeView); return; }
  try { const value = await ask(at.folder, "novel/world", { id: at.id }); worlds.set(at.key, value); if (current === at) { world = value; renderView(activeView); } }
  catch (error) { if (current === at) { world = { error: error.message }; renderView(activeView); } }
}
function renderView(view) {
  if (view === "chat") return;
  const body = $(`v-${view}`);
  if (view === "record") return renderRecord(body);
  if (view === "problems") return renderProblems(body);
  if (view === "debug") return renderDebug(body);
  if (!current) { body.innerHTML = `<p class="empty">Open a book that has a reading.</p>`; setCount(view, ""); return; }
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
const laneColor = (n) => `var(--lane-${(n ?? 0) % 10})`;
const storyScenes = () => { if (!world.story) world.story = [...world.scenes].sort((a, b) => (a.story ?? 1e9) - (b.story ?? 1e9) || a.index - b.index); return world.story; };
/** Each strand's colour: by the order strands first appear in story time. */
const strandColors = () => { if (!world.colors) { const first = new Map(); storyScenes().forEach((scene, n) => { if (scene.strand && !first.has(scene.strand)) first.set(scene.strand, n); }); world.colors = new Map([...first].sort((a, b) => a[1] - b[1]).map(([id], n) => [id, n])); } return world.colors; };
const colorOf = (strand) => laneColor(strandColors().get(strand) ?? 0);

function renderCharacters(body) {
  const kind = remember.get("charKind", "people");
  for (const button of document.querySelectorAll("#char-kind button")) button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
  const tally = new Map();
  for (const scene of world.scenes) { for (const id of scene.present) tally.set(id, (tally.get(id) ?? 0) + 1); for (const thing of scene.things) tally.set(thing.id, (tally.get(thing.id) ?? 0) + 1); }
  const fits = ([, [, category, unnamed]]) => (kind === "people" ? category === "person" && !unnamed : kind === "things" ? category !== "person" && !unnamed : Boolean(unnamed));
  const list = Object.entries(world.movables).filter(fits).sort((a, b) => (tally.get(b[0]) ?? 0) - (tally.get(a[0]) ?? 0)).slice(0, 400);
  setCount("characters", String(Object.keys(world.movables).length));
  body.innerHTML = list.length ? `<ul class="rows">${list.map(([id, [label, category, unnamed]]) => `<li data-char="${esc(id)}" class="${selectedChar === id ? "on" : ""}"><span class="nm ${unnamed ? "unnamed" : `c-${esc(category)}`}">${esc(label)}</span><span class="n">${tally.get(id) ?? 0} scenes</span></li>${selectedChar === id ? pathOf(id) : ""}`).join("")}</ul>` : `<p class="empty">None in this book.</p>`;
  const on = body.querySelector("li.on"); if (on) on.scrollIntoView({ block: "nearest" });
}
/** A movable's path: scene by scene in story order, runs at the same place on the same strand joined. */
function pathOf(id) {
  const steps = [];
  for (const scene of storyScenes()) {
    if (!scene.present.includes(id) && !scene.things.some((thing) => thing.id === id)) continue;
    const last = steps.at(-1);
    if (last && last.place === scene.place && last.strand === scene.strand) { last.count++; continue; }
    steps.push({ place: scene.place, strand: scene.strand, first: scene, count: 1 });
  }
  return `<li style="display:block;cursor:default;padding:0"><div class="chips" style="margin:2px 0 4px 20px"><button class="chip" data-record="${esc(id)}">Record and every line</button><span class="mini">${steps.length} ${steps.length === 1 ? "stop" : "stops"}</span></div><ul class="path">${steps.map((step) => `<li data-sentence="${esc(step.first.first)}" title="${esc(step.first.when ?? "")}"><span class="lane" style="--lc:${colorOf(step.strand)}"></span><span class="where">${esc(placeName(step.place))}${step.count > 1 ? ` <span class="mini">× ${step.count}</span>` : ""}</span><span class="when">${esc(whenOf(step.first))}</span></li>`).join("")}</ul></li>`;
}
$("v-characters").addEventListener("click", (event) => {
  const sentence = event.target.closest("[data-sentence]")?.dataset.sentence; if (sentence) { reveal(sentence); return; }
  const recordOf = event.target.closest("[data-record]")?.dataset.record; if (recordOf) { showRecord(recordOf); return; }
  const id = event.target.closest("[data-char]")?.dataset.char; if (!id) return;
  selectedChar = selectedChar === id ? null : id; renderView("characters");
});
for (const button of document.querySelectorAll("#char-kind button")) button.addEventListener("click", () => { remember.set("charKind", button.dataset.kind); renderView("characters"); });

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
  setCount("places", String(world.places.length));
  body.innerHTML = branch("") + (selectedPlace ? placeDetail(selectedPlace, children) : "");
  body.dataset.open = JSON.stringify(open);
}
function placeDetail(id, children) {
  const inside = new Set([id]); const add = (p) => { for (const child of children.get(p) ?? []) { inside.add(child.id); add(child.id); } }; add(id);
  const scenes = storyScenes().filter((scene) => inside.has(scene.place));
  const people = new Map(); for (const scene of scenes) for (const who of scene.present) people.set(who, (people.get(who) ?? 0) + 1);
  return `<div class="detail"><h4>${esc(placeName(id))} · ${scenes.length} scenes</h4><div class="chips">${[...people].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([who, n]) => `<button class="chip" data-char-open="${esc(who)}">${esc(nameOf(who))} ${n}</button>`).join("")}</div>${scenes.slice(0, 80).map((scene) => `<div class="scene-row" data-sentence="${esc(scene.first)}"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorOf(scene.strand)}"></span> <span class="mini">${esc(whenOf(scene))}</span> ${scene.place !== id ? `<span class="c-place">${esc(placeName(scene.place))}</span>` : ""}</span><span class="mini">${esc(scene.present.slice(0, 5).map(nameOf).join(", "))}${scene.present.length > 5 ? ` +${scene.present.length - 5}` : ""}</span></div>`).join("")}</div>`;
}
$("v-places").addEventListener("click", (event) => {
  const sentence = event.target.closest("[data-sentence]")?.dataset.sentence; if (sentence) { reveal(sentence); return; }
  const who = event.target.closest("[data-char-open]")?.dataset.charOpen; if (who) { selectedChar = who; show("characters"); return; }
  const folder = event.target.closest("[data-fold]")?.dataset.fold, body = $("v-places"), open = JSON.parse(body.dataset.open || "{}");
  if (folder) { open[folder] = !open[folder]; remember.set(`places:${current.key}`, open); renderView("places"); return; }
  const id = event.target.closest("[data-place]")?.dataset.place; if (!id) return;
  selectedPlace = selectedPlace === id ? null : id; renderView("places");
});

/**
 * Strands as a git graph: time runs down, scene by scene in story order. Each strand keeps one lane for its life (lanes
 * are reused once a strand has ended, the leftmost free first); a strand that split from others curves out of their
 * lanes at its first scene, a strand that rejoins curves (dashed) into the lane it joins at the scene where it joined;
 * a ref label marks where a strand begins and where it joins another. A scene in the past is a hollow node.
 */
function renderStrands(body) {
  const scenes = storyScenes(), RH = 24, W = 16, rowOf = new Map(scenes.map((scene, n) => [scene.id, n]));
  const spans = new Map();
  for (const strand of world.strands) { const rows = strand.scenes.map((id) => rowOf.get(id)).filter((n) => n !== undefined).sort((a, b) => a - b); if (rows.length) spans.set(strand.id, rows); }
  const byId = new Map(world.strands.map((strand) => [strand.id, strand])), live = world.strands.filter((strand) => spans.has(strand.id)).sort((a, b) => spans.get(a.id)[0] - spans.get(b.id)[0]);
  const joinRow = (strand) => (strand.into && strand.intoAt && rowOf.has(strand.intoAt) ? rowOf.get(strand.intoAt) : strand.into ? spans.get(strand.id).at(-1) + 1 : null);
  const lane = new Map(), busy = [];
  for (const strand of live) {
    const rows = spans.get(strand.id), from = rows[0] - (strand.splitFrom.length ? 1 : 0), to = Math.max(rows.at(-1), joinRow(strand) ?? 0);
    let column = busy.findIndex((until) => until < from); if (column < 0) column = busy.length;
    busy[column] = to; lane.set(strand.id, column);
  }
  const lanes = Math.max(1, busy.length), gw = lanes * W + 12, x = (id) => 10 + (lane.get(id) ?? 0) * W, y = (row) => row * RH + RH / 2;
  const told = live.filter((strand) => !strand.past);
  setCount("strands", String(told.length));
  let svg = "";
  for (const strand of live) {
    const rows = spans.get(strand.id), color = colorOf(strand.id), cx = x(strand.id), dim = strandFocus && strandFocus !== strand.id ? ' opacity="0.25"' : "";
    svg += `<line x1="${cx}" y1="${y(rows[0])}" x2="${cx}" y2="${y(rows.at(-1))}" stroke="${color}" stroke-width="2"${dim}/>`;
    for (const parent of strand.splitFrom) {
      const p = byId.get(parent); if (!p || !spans.has(p.id)) continue;
      const before = spans.get(p.id).filter((row) => row < rows[0]).at(-1) ?? rows[0] - 1, px = x(p.id), y0 = y(Math.max(0, before)), y1 = y(rows[0]);
      svg += `<path d="M${px} ${y0} C ${px} ${y0 + (y1 - y0) * 0.6}, ${cx} ${y1 - (y1 - y0) * 0.6}, ${cx} ${y1}" fill="none" stroke="${color}" stroke-width="2"${dim}/>`;
    }
    const join = joinRow(strand);
    if (strand.into && join !== null && byId.has(strand.into)) {
      const tx = x(strand.into), y0 = y(rows.at(-1)), y1 = y(Math.min(join, scenes.length - 1));
      svg += `<path d="M${cx} ${y0} C ${cx} ${y0 + (y1 - y0) * 0.6}, ${tx} ${y1 - (y1 - y0) * 0.6}, ${tx} ${y1}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3"${dim}/>`;
    }
  }
  const joinsAt = new Map(); for (const strand of live) if (strand.into && strand.intoAt) (joinsAt.get(strand.intoAt) ?? joinsAt.set(strand.intoAt, []).get(strand.intoAt)).push(strand);
  const startsAt = new Map(live.map((strand) => [spans.get(strand.id)[0], strand]));
  const endsAt = new Map(); for (const strand of live) if (strand.into) endsAt.set(spans.get(strand.id).at(-1), strand);
  const who = (strand) => `${strand.people.slice(0, 2).map(nameOf).join(", ") || "—"}${strand.people.length > 2 ? ` +${strand.people.length - 2}` : ""}`;
  let day = null, rowsHtml = "";
  scenes.forEach((scene, r) => {
    const color = colorOf(scene.strand), cx = scene.strand && lane.has(scene.strand) ? x(scene.strand) : 10, dim = strandFocus && scene.strand !== strandFocus;
    const merge = joinsAt.has(scene.id);
    svg += scene.flashback ? `<circle cx="${cx}" cy="${y(r)}" r="4.5" fill="var(--panel)" stroke="${color}" stroke-width="2"${dim ? ' opacity="0.25"' : ""}/>` : merge ? `<circle cx="${cx}" cy="${y(r)}" r="6" fill="var(--panel)" stroke="${color}" stroke-width="2"/><circle cx="${cx}" cy="${y(r)}" r="3" fill="${color}"/>` : `<circle cx="${cx}" cy="${y(r)}" r="4.5" fill="${color}"${dim ? ' opacity="0.25"' : ""}/>`;
    const today = dayOf(scene), dayTag = today && today !== day ? `<span class="day">${esc(today)}</span>` : ""; if (today) day = today;
    const start = startsAt.get(r), end = endsAt.get(r);
    const refs = `${start && !start.past ? `<span class="sref" style="--lc:${colorOf(start.id)}" title="${esc(start.people.map(nameOf).join(", "))}">${esc(who(start))}</span>` : ""}${end ? `<span class="sref join" style="--lc:${colorOf(end.id)}">→ ${esc(who(byId.get(end.into) ?? end))}</span>` : ""}`;
    rowsHtml += `<div class="srow${dim ? " dim" : ""}" data-sentence="${esc(scene.first)}" title="${esc(`${scene.id} · ${scene.when ?? ""}`)}">${dayTag}${refs}<span class="pl">${esc(placeName(scene.place))}</span><span class="pp">${esc(scene.present.slice(0, 3).map(nameOf).join(", "))}${scene.present.length > 3 ? ` +${scene.present.length - 3}` : ""}</span></div>`;
  });
  const legend = `<div class="legend">${told.map((strand) => `<button data-strand="${esc(strand.id)}" aria-pressed="${strandFocus === strand.id}" style="--lc:${colorOf(strand.id)}" title="${esc(strand.people.map(nameOf).join(", "))}"><i></i>${esc(who(strand))} · ${strand.scenes.length}${strand.open ? "" : strand.into ? " → joins" : ""}</button>`).join("")}</div>`;
  body.innerHTML = `${legend}<div class="sgraph" style="--gw:${gw}px;--rh:${RH}px"><svg width="${gw}" height="${scenes.length * RH}" viewBox="0 0 ${gw} ${scenes.length * RH}">${svg}</svg><div class="srows">${rowsHtml}</div></div>`;
}
$("v-strands").addEventListener("click", (event) => {
  const strand = event.target.closest("[data-strand]")?.dataset.strand; if (strand) { strandFocus = strandFocus === strand ? null : strand; renderView("strands"); return; }
  const sentence = event.target.closest("[data-sentence]")?.dataset.sentence; if (sentence) reveal(sentence);
});

// ---------- The reading's details of a line: Jev's and the reading's records (the debug view). ----------
async function renderDebug(body) {
  if (!current) { body.innerHTML = `<p class="empty">Open a book that has a reading.</p>`; return; }
  if (!debugLine) { body.innerHTML = `<p class="empty">Tap a sentence in the book: its kind and how sure the reading is, who says or does it, the names and descriptions in it and whom they mean, its times, what EM listed from it, its cards, facts and problems.</p>`; setCount("debug", ""); return; }
  const id = debugLine, at = current;
  body.innerHTML = `<p class="empty">Reading the records…</p>`;
  const line = await ask(at.folder, "novel/readLine", { id: at.id, sentence: id }).catch((error) => ({ error: error.message }));
  if (debugLine !== id || current !== at) return;
  if (line.error) { body.innerHTML = `<p class="empty">${esc(line.error)}</p>`; return; }
  setCount("debug", id);
  const kind = line.kind?.kind ?? "narration";
  const chip = (entity, label, cls = "") => `<button class="chip ${cls}" data-entity="${esc(entity)}" title="Open the record">${esc(label)}</button>`;
  const who = (title, w) => (w ? `<li>${title}: ${w.id ? chip(w.id, w.label) : esc(w.label)} <small>${pct(w.confidence)}${w.settled ? "" : " · a guess"}${w.via ? ` · through "${esc(w.via)}"` : ""}</small></li>` : "");
  const section = (title, rows) => (rows.length ? `<h5>${title}</h5><ul>${rows.join("")}</ul>` : "");
  body.innerHTML = `<div class="dbg">
    <div class="head"><span>${esc(line.chapter)}${line.scene ? ` · scene ${line.scene.index + 1} <small>${esc(line.scene.type)}</small>` : ""}</span><code>${esc(id)}</code></div>
    <div class="k-${esc(kind)}"><div class="quote">${esc(line.text)}</div>
      <div><span class="kind">${esc(kind)}</span> <small>${pct(line.kind?.confidence)} sure${typeof line.kind?.turn === "number" ? ` · turn ${line.kind.turn}` : ""}</small></div>
      <div style="display:grid;gap:2px;margin-top:4px">${(line.kind?.top ?? []).map(([name, share]) => `<div class="bar k-${esc(name)}"><span>${esc(name)}</span><i style="width:${Math.round(share * 100)}%"></i><span>${pct(share)}</span></div>`).join("")}</div></div>
    ${line.role ? section(line.role.kind === "action" ? "Who does it" : "Who says it", [who(line.role.kind === "action" ? "Does it" : "Says it", line.role.who), who("To", line.role.to)].filter(Boolean)) : ""}
    ${section("People, places and things", line.references.map((r) => `<li>${chip(r.entity, r.label, `c-${r.category}`)} <small>${esc(r.how.join(", "))}${r.confidence !== null ? ` · ${pct(r.confidence)}` : ""}${r.settled ? "" : " · a guess"}${r.via ? ` · through "${esc(r.via)}"` : ""}</small></li>`))}
    ${section("Descriptions", line.descriptions.map((d) => `<li>${esc(d.text)} → ${d.entity ? chip(d.entity, d.label ?? d.entity) : "<small>no one settled</small>"} <small>${esc(d.type ?? "")} ${pct(d.confidence)}</small></li>`))}
    ${section("Times", line.times.map((t) => `<li>${esc(t.text)} <small>${esc([t.role, t.gloss].filter(Boolean).join(" · "))} ${pct(t.confidence)}</small></li>`))}
    ${section("Listed by EM", line.listed.map((l) => `<li>${esc(l.text)} <small>→ ${esc(l.outcome ?? "?")}${l.type ? ` · ${esc(l.type)}` : ""}</small></li>`))}
    ${section("Cards", line.cards.map((c) => `<li><b class="k-${esc(c.kind)}" style="color:var(--k)">${esc(c.kind)}</b> <span class="cf">${esc(c.id)}</span> <small>${c.lines} ${c.lines === 1 ? "line" : "lines"}${c.home ? ` · ${esc(c.home)}` : ""}</small>${c.people.length ? `<br><small>${c.people.map((p) => `${esc(p.label)} (${esc(p.how.join(", "))})`).join("; ")}</small>` : ""}</li>`))}
    ${section("Facts", line.facts.map((f) => `<li><span class="cf">${esc(f.id)}</span>${f.about.length ? ` <small>about ${esc(f.about.join(", "))}</small>` : ""}</li>`))}
    ${section("Problems", line.problems.map((p) => `<li class="warn">${esc(p)}</li>`))}
    ${section("Notes", line.notes.map((n) => `<li>${esc(n.text)} <small>${esc((n.at ?? "").slice(0, 16).replace("T", " "))}</small></li>`))}
  </div>`;
}
$("v-debug").addEventListener("click", (event) => { const entity = event.target.closest("[data-entity]")?.dataset.entity; if (entity) showRecord(entity); });

// ---------- Record and problems. ----------
function showRecord(entity) { record = entity; show("record"); }
async function renderRecord(body) {
  if (!current || !record) { body.innerHTML = `<p class="empty">Tap a name in the reading details, or "Record and every line" under a character, to see the record and every line that refers to it.</p>`; setCount("record", ""); return; }
  const entity = record, at = current;
  body.innerHTML = `<p class="empty">Reading the record…</p>`;
  const link = await ask(at.folder, "novel/record", { id: at.id, entity }).catch(() => null);
  const doc = link ? await ask(at.folder, "novel/document", { uri: link.uri }).catch(() => null) : null;
  const refs = await ask(at.folder, "novel/refs", { id: at.id, entity, limit: 200 }).catch(() => null);
  if (record !== entity || current !== at) return;
  setCount("record", link?.label ?? "");
  const lines = (refs?.books ?? []).map((book) => `<h4 class="mini" style="margin:12px 0 4px;text-transform:uppercase;letter-spacing:.05em">${esc(book.title)} · ${book.references} lines${book.more ? ` (first ${book.shown.length})` : ""}</h4>${book.shown.map((r) => `<div class="ref" data-line="${esc(r.line)}" data-book="${esc(book.book)}"><span class="line">${esc(r.text ?? r.line)}</span><small>${esc(r.chapterTitle ?? "")} · scene ${r.scene} · ${esc((r.how ?? []).join(", "))}${r.confidence !== undefined ? ` · ${Math.round(r.confidence * 100)}%` : ""}</small></div>`).join("")}`).join("");
  body.innerHTML = `<div class="record">${markdown(doc?.text ?? `# ${entity}`)}</div>${lines}`;
}
async function renderProblems(body) {
  if (!current) { body.innerHTML = `<p class="empty">Open a book that has a reading.</p>`; setCount("problems", ""); return; }
  const at = current;
  body.innerHTML = `<p class="empty">Reading the problems…</p>`;
  const found = await ask(at.folder, "novel/bookProblems", { id: at.id, limit: 500 }).catch((error) => ({ error: error.message }));
  if (current !== at) return;
  if (found.error) { body.innerHTML = `<p class="empty">${esc(found.error)}</p>`; return; }
  setCount("problems", String(found.total));
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
  setCount("chat", String(hostList.reduce((sum, entry) => sum + entry.sessions.length, 0)));
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
  $("chat-body").innerHTML = `<p class="note"><b>${esc(session?.title ?? "")}</b><br>${esc(entry?.name ?? "")} · ${esc(session?.cwd ?? "")} · the last ${transcript.messages.length} messages</p>${transcript.messages.map((message) => `<div class="msg ${message.role === "user" ? "user" : "assistant"}">${message.text.trim() ? esc(message.text.length > 4000 ? `${message.text.slice(0, 4000)}…` : message.text) : ""}${message.tools ? `<span class="tools">${message.tools} tool ${message.tools === 1 ? "call" : "calls"}</span>` : ""}</div>`).join("")}`;
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

// Start as it was left: day or night, the panel and its view, the widths.
daylight(remember.get("daylight", "night"));
for (const [which, key] of [["library", "--lib-w"], ["panel", "--panel-w"]]) { const width = remember.get(`width:${which}`, null); if (width) $("work").style.setProperty(key, `${width}px`); }
if (!TITLES[activeView]) activeView = "strands";
show(activeView); setPanel(remember.get("panel", true));
refresh().then(keyDots).then(() => { $("welcome").hidden = Boolean(current); renderView(activeView); });
