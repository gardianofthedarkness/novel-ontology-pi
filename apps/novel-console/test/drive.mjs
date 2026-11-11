// Drives Novel Console for a test: node apps/novel-console/test/drive.mjs <folder>[,<folder>…] [--app <Novel Console.app>] [--shots <dir>]
// The app runs with a profile of its own (NOVEL_CONSOLE_DATA) and a key store of its own (NOVEL_SECRETS_DIR), so nothing of
// the user's is read or changed; it is driven through its debugging port (the page's own buttons, clicked in the page), and
// pictures are of its window only. Prints what it saw as JSON. No reading is started: the play button with no keys must
// open the keys dialog, and that is all it is pressed for.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), appDir = resolve(here, "..");
const argv = process.argv.slice(2), flag = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv.splice(at, 2)[1] : null; };
const take = (name) => { const at = argv.indexOf(name); if (at < 0) return false; argv.splice(at, 1); return true; };
const arrange = take("--arrange"), worldStep = take("--world"), agentArrange = take("--agent-arrange"), asUser = take("--as-user"), realAgent = take("--real-agent") || asUser;
const packaged = flag("--app"), pick = Number(flag("--book") ?? 1) - 1, agentTab = flag("--agent") ?? "claude-code"; flag("--shots");
const shotsDir = (() => { const at = process.argv.indexOf("--shots"); return at >= 0 ? resolve(process.argv[at + 1]) : null; })();
const folders = (argv[0] ?? "").split(",").filter(Boolean).map((folder) => resolve(folder));
if (!folders.length) { console.error("usage: node test/drive.mjs <folder>[,<folder>…] [--app <path to .app>] [--shots <dir>]"); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), "novel-console-")), secrets = join(profile, "secrets");
writeFileSync(join(profile, "libraries.json"), JSON.stringify({ folders }));
const port = 9400 + Math.floor(Math.random() * 400);
const binary = packaged ? join(resolve(packaged), "Contents", "MacOS", "Novel Console") : join(appDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
// Stand-ins for the two agents the console starts, each speaking as the real one does (Claude Code's stream-json, the Pi
// runner's JSON lines and a session file of its own): an arrangement makes one universe of the first two books not arranged,
// each with the series its title gives, through the folder's own novel command; a continued session answers. No real
// session is touched.
const standIn = join(profile, "agent-stand-in.mjs"), piSessions = join(profile, "pi-sessions");
writeFileSync(standIn, `#!${process.execPath}
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2), pi = args[0] !== "-p", say = (value) => console.log(JSON.stringify(value));
const novel = pi ? args[1] : process.env.NOVEL_COMMAND, folder = pi ? args[0] : process.env.NOVEL_FOLDER;
const run = (...rest) => { if (pi) say({ step: ["folder", ...rest].join(" ") }); else say({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: [novel, "folder", ...rest].join(" ") } }] } }); return JSON.parse(execFileSync(novel, ["folder", ...rest], { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } })); };
if (!pi && args.includes("--resume") && !process.env.NOVEL_COMMAND) { say({ type: "result", result: "stand-in reply", session_id: args[args.indexOf("--resume") + 1] }); process.exit(0); }
const file = pi ? (args[4] ?? join(args[3], "stand-in-" + Date.now() + ".jsonl")) : null;
if (pi) { mkdirSync(args[3], { recursive: true }); if (!args[4]) writeFileSync(file, JSON.stringify({ type: "session", id: "stand-in-pi", cwd: folder }) + "\\n"); appendFileSync(file, JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: process.env.NOVEL_ARRANGE_PROMPT ?? "" }] } }) + "\\n"); say({ session: file }); }
else say({ type: "system", subtype: "init", session_id: "stand-in-session" });
const list = run("basics", folder), loose = list.books.filter((book) => !book.placed).slice(0, 2);
const made = run("universe", folder, "Stand-in world " + Date.now() % 100000, "--why", "the stand-in's test");
for (const book of loose) run("put", folder, book.id, made.universe, "--series", book.seriesByTitle ?? "one");
const text = "Stand-in arranged " + loose.length + " books into Stand-in world.";
if (pi) { appendFileSync(file, JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } }) + "\\n"); say({ result: text, sessionFile: file, commands: loose.length + 2, refused: 0, seconds: 1 }); }
else say({ type: "result", result: text, session_id: "stand-in-session", total_cost_usd: 0 });
`, { mode: 0o700 });
// As the user (the user, 2026-11-10: "mimick user work environment ... Imagine you are the user when running tests"): the
// DMG's app opened as Finder opens it (LaunchServices: launchd's environment, nothing of this shell's), the user's own
// profile and key store, the real agents. The one stand-in: a folder the user has not added is written into the user's
// libraries list, for the one click on "Add a folder…" (a native dialog this driver cannot press).
if (asUser) {
  if (!packaged) throw new Error("--as-user needs --app <the DMG's app>.");
  const own = join(homedir(), "Library", "Application Support", "Novel Console"), listFile = join(own, "libraries.json");
  let list = { folders: [] }; try { list = JSON.parse(readFileSync(listFile, "utf8")); } catch {}
  const added = folders.filter((folder) => !list.folders.includes(folder));
  if (added.length) { mkdirSync(own, { recursive: true }); writeFileSync(listFile, JSON.stringify({ ...list, folders: [...list.folders, ...added] })); }
}
const appBinary = packaged ? `${resolve(packaged)}/Contents/MacOS/Novel Console` : null;
const child = asUser ? spawn("open", ["-n", "-a", resolve(packaged), "--args", `--remote-debugging-port=${port}`], { stdio: ["ignore", "ignore", "pipe"] }) : spawn(binary, [...(packaged ? [] : [appDir]), `--remote-debugging-port=${port}`], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, NOVEL_CONSOLE_DATA: profile, NOVEL_SECRETS_DIR: secrets, ...(realAgent ? {} : { NOVEL_CONSOLE_AGENT_COMMAND: standIn, NOVEL_CONSOLE_PI_RUNNER: standIn, NOVEL_CONSOLE_PI_SESSIONS: piSessions }), TYPESAFE_API_KEY: "", WORK_LLM_API_KEY: realAgent ? process.env.WORK_LLM_API_KEY ?? "" : "stand-in", ELECTRON_RUN_AS_NODE: "" } });
let errors = ""; child.stderr.on("data", (chunk) => { errors += chunk; });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (probe, what, most = 30000) => { for (const start = Date.now(); ;) { const value = await probe().catch(() => null); if (value) return value; if (Date.now() - start > most) throw new Error(`Timed out waiting for ${what}`); await wait(250); } };

let socket, seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((done, fail) => { const id = ++seq; pending.set(id, { done, fail }); socket.send(JSON.stringify({ id, method, params })); });
const host = (expression) => run(expression);
const run = async (expression) => { const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text); return reply.result.value; };
const picture = async (name) => { if (!shotsDir) return; mkdirSync(shotsDir, { recursive: true }); const { data } = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"), { mode: 0o600 }); };

const seen = { steps: [] }, step = (name, detail) => { seen.steps.push({ name, ...detail }); };
try {
  const page = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((entry) => entry.type === "page" && entry.url.startsWith("app://console")), "the console's window");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  socket.onmessage = (event) => { const message = JSON.parse(event.data); const entry = pending.get(message.id); if (entry) { pending.delete(message.id); message.error ? entry.fail(new Error(message.error.message)) : entry.done(message.result); } };
  await send("Runtime.enable");

  // The libraries' trees.
  const tree = await until(() => run(`(() => { const rows = [...document.querySelectorAll("#tree .node")]; return rows.some((row) => row.querySelector(".book")) ? rows.map((row) => ({ name: row.querySelector(".name").textContent, desc: row.querySelector(".desc").textContent, cls: row.className, play: Boolean(row.querySelector(".act.run")) })) : null; })()`), "the libraries' books");
  step("tree", { libraries: tree.filter((row) => row.cls.includes("lib")).length, books: tree.filter((row) => row.desc && !row.cls.includes("lib") && !row.cls.includes("group")).length, playButtons: tree.filter((row) => row.play).length });
  // The basic layer (no model): every book's row says its chapters, lines and dialogue; the series found are offered.
  const basic = await until(() => run(`(() => { const rows = [...document.querySelectorAll("#tree .node")]; const read = rows.filter((row) => /% spoken/.test(row.querySelector(".desc").textContent)).length; const series = rows.filter((row) => row.querySelector(".act") && row.querySelector(".act").textContent === "Arrange").length; return read && (series || !/Basic layer: /.test(document.getElementById("status").textContent)) ? { booksWithBasic: read, seriesFound: series, status: document.getElementById("status").textContent.replace(/[^\x20-\x7e]/g, "?") } : null; })()`), "the basic layer", 120000).catch(() => null);
  step("basic layer", basic ?? { booksWithBasic: 0 });
  await picture("1-library");
  if (arrange && basic?.seriesFound) {
    await run(`[...document.querySelectorAll("#tree .node")].find((row) => row.querySelector(".act")?.textContent === "Arrange").querySelector(".act").click()`);
    const universes = await until(() => run(`(() => { const n = [...document.querySelectorAll("#tree .node")].filter((row) => row.querySelector(".ic")?.textContent === "◎" && /books?$/.test(row.querySelector(".desc").textContent)).length; return n || null; })()`), "the arranged universe", 20000);
    step("arranged", { universes });
    await picture("1b-arranged");
  }

  // A world (a v2 library in the folder): its first book's World \u00b7 Live in the middle, its data read, a change refused when read only.
  if (worldStep) {
    await until(() => run(`document.querySelectorAll("#tree .node.world-book").length || null`), "the folder's worlds", 60000);
    const worldRows = await run(`[...document.querySelectorAll("#tree .node.world, #tree .node.world-book")].map((row) => row.textContent.replace(/[^\\x20-\\x7e]/g, "?").slice(0, 90))`);
    await run(`document.querySelector("#tree .node.world-book").click()`);
    const page = await until(() => run(`(() => { const doc = document.getElementById("worldframe").contentDocument; if (!doc || doc.title !== "World \u00b7 Live") return null; const counts = doc.getElementById("counts")?.textContent ?? "", where = doc.getElementById("where")?.textContent ?? ""; return counts || where ? { title: "World Live", counts: counts.replace(/[^\\x20-\\x7e]/g, "?").slice(0, 120), where: where.replace(/[^\\x20-\\x7e]/g, "?").slice(0, 120) } : null; })()`), "World \u00b7 Live's page", 60000).catch((error) => ({ error: error.message }));
    await wait(4000);
    const data = await run(`(async () => { const base = document.getElementById("worldframe").src.replace(/\\/play\\/world.*$/, ""); const get = async (name) => { const r = await fetch(base + "/play/" + name + "?volume=1"); return r.ok ? Object.keys(await r.json()).slice(0, 8) : r.status; }; const post = await fetch(base + "/play/settings?volume=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "fill.streets", value: {}, why: "test" }) }); return { live: await get("live.json"), review: await get("review.json"), settings: await get("settings.json"), warehouse: await get("warehouse.json"), settingsChange: post.status }; })()`);
    step("world", { worldRows, page, data, crumb: await run(`document.getElementById("crumb").textContent.replace(/[^\\x20-\\x7e]/g, "?")`) });
    await picture("1e-world");
  }
  if (agentArrange) {
    const before = await run(`[...document.querySelectorAll("#tree .node")].filter((row) => row.querySelector(".ic")?.textContent === "◎" && /books?$/.test(row.querySelector(".desc").textContent)).length`);
    // As a user: open the chat, pick the agent's tab there, then press the row's Ask.
    await run(`document.getElementById("t-chat").getAttribute("aria-pressed") === "true" || document.getElementById("t-chat").click()`);
    await until(() => run(`Boolean(document.querySelector('#hosts [data-host="${agentTab}"]'))`), "the chat's agents");
    await run(`document.querySelector('#hosts [data-host="${agentTab}"]').click()`);
    const asked = await run(`document.querySelector("#tree .node.ask-agent .act").textContent`);
    await run(`document.querySelector("#tree .node.ask-agent .act").click()`);
    // The token warning first (2026-11-11): the agent starts only when asked again there.
    await until(() => run(`!document.getElementById("toast").hidden && Boolean(document.querySelector('#toast button[data-v="go"]'))`), "the token warning");
    await run(`document.querySelector('#toast button[data-v="go"]').click()`);
    const started = Date.now();
    const midway = await until(() => run(`(() => { const steps = document.querySelectorAll("#chat-body .msg.step").length; return steps ? steps : /arranged by|stopped|signed out|cannot|Pick|its key/.test(document.getElementById("status").textContent + document.getElementById("chat-body").textContent) ? -1 : null; })()`), "the first command in the chat", realAgent ? 300000 : 30000);
    if (midway > 0) await picture("1c-agent-working");
    await until(() => run(`/arranged by|stopped|signed out|cannot|Pick|its key/.test(document.getElementById("status").textContent) && !document.querySelector("#chat-body .pending")`), "the agent's report", realAgent ? 1200000 : 30000);
    await wait(1500);
    const chat = await run(`({ title: (document.querySelector("#chat-body .note b")?.textContent ?? "").replace(/[^\\x20-\\x7e]/g, "?"), messages: document.querySelectorAll("#chat-body .msg").length, tab: document.querySelector("#hosts [aria-selected=true]")?.dataset.host, compose: !document.getElementById("compose").hidden })`);
    const report = chat.messages;
    const after = await run(`({ universes: [...document.querySelectorAll("#tree .node")].filter((row) => row.querySelector(".ic")?.textContent === "◎" && /books?$/.test(row.querySelector(".desc").textContent)).length, seriesRows: document.querySelectorAll("#tree .node.series").length, notArranged: ([...document.querySelectorAll("#tree .node.group")].map((row) => row.textContent).find((text) => /Not arranged/.test(text)) ?? "").replace(/[^0-9]/g, "") })`);
    step("arranged by an agent", { real: realAgent, agent: agentTab, asked, seconds: Math.round((Date.now() - started) / 1000), commandsSeenLive: midway, universesBefore: before, ...after, chat, status: await run(`document.getElementById("status").textContent.replace(/[^\x20-\x7e]/g, "?")`) });
    await picture("1d-agent-arranged");
  }
  // A book with a reading: the reader, a spoken line's notes, the cast, a record.
  const opened = await run(`(() => { const row = [...document.querySelectorAll("#tree .node")].filter((node) => /entries/.test(node.querySelector(".desc").textContent))[${pick}]; if (!row) return null; row.click(); return row.querySelector(".name").textContent; })()`);
  if (opened) {
    // The book opens on its first page (an EPUB's cover and plates); the reader is then sent to a spoken line, as the panel does.
    await until(() => run(`document.getElementById("reader").contentDocument?.getElementById("status")?.textContent.includes("documents loaded") || null`), "the reader's first page", 60000);
    const spoken = await run(`(async () => { const lib = (await window.novelHost.libraries())[0].path; const tree = await window.novelHost.ask(lib, "novel/tree"); const book = [...tree.universes.flatMap((u) => u.books), ...tree.unsorted].filter((b) => b.reading)[${pick}]; const view = await window.novelHost.ask(lib, "novel/read", { id: book.id }); return Object.keys(view.speakers).filter((id) => view.kinds[id] === "spoken")[30]; })()`);
    await run(`document.getElementById("reader").contentWindow.postMessage({ type: "reveal", sentence: ${JSON.stringify(spoken)} }, "*")`);
    await until(() => run(`document.getElementById("reader").contentDocument?.querySelectorAll("#book .s").length > 20`), "the reader's sentences", 90000);
    const counts = await run(`(() => { const d = document.getElementById("reader").contentDocument; return { sentences: d.querySelectorAll("#book .s").length, marks: d.querySelectorAll("#book .m").length, speakers: d.querySelectorAll("#book .who").length, pictures: d.querySelectorAll("#book img.epub").length, status: d.getElementById("status").textContent.length }; })()`);
    step("reader", counts);
    // A spoken line with a speaker, tapped.
    const tapped = await run(`(() => { const d = document.getElementById("reader").contentDocument; const who = [...d.querySelectorAll("#book .who")][3] ?? d.querySelector("#book .who"); const line = who?.nextElementSibling; if (!line) return null; line.scrollIntoView({ block: "center" }); line.click(); return line.dataset.id; })()`);
    // The line's details are the debug view's (the reader shows only the book).
    const readerNotesHidden = await run(`getComputedStyle(document.getElementById("reader").contentDocument.getElementById("notes")).display === "none"`);
    const badge = await until(() => run(`!document.getElementById("badge-debug").hidden || null`), "the debug icon's mark", 10000).catch(() => false);
    const icon = (view) => run(`document.querySelector('#leftbar [data-left="${view}"]').click()`);
    await icon("debug");
    const notes = await until(() => run(`(() => { const h = [...document.querySelectorAll("#v-debug h5")].map((x) => x.textContent); return h.length ? h : null; })()`), "the line's details", 20000);
    step("notes", { line: tapped, readerNotesHidden, debugMarked: Boolean(badge), sections: notes });
    await picture("2-debug");
    // One view at a time behind each icon: characters (a path), places (the tree and a place's scenes), strands (the graph).
    await icon("characters");
    const characters = await until(() => run(`document.querySelectorAll("#v-characters li[data-char]").length || null`), "the characters", 30000);
    await run(`document.querySelector("#v-characters li[data-char]").click()`);
    const path = await until(() => run(`document.querySelectorAll("#v-characters .path li").length || null`), "a character's path", 10000);
    const oneAtATime = await run(`[...document.querySelectorAll(".left-view")].filter((v) => getComputedStyle(v).display !== "none").length`);
    await icon("places");
    const places = await until(() => run(`document.querySelectorAll("#v-places .prow").length || null`), "the places", 10000);
    await run(`document.querySelector("#v-places .prow").click()`);
    const placeScenes = await until(() => run(`document.querySelectorAll("#v-places .scene-row").length || null`), "a place's scenes", 10000);
    await icon("strands");
    const strands = await until(() => run(`(() => { const nodes = document.querySelectorAll("#v-strands .snode").length; if (!nodes) return null; const lines = [...document.querySelectorAll("#v-strands svg line")]; const ends = lines.every((line) => [...document.querySelectorAll("#v-strands .snode")].some((c) => c.getAttribute("cx") === line.getAttribute("x2") && c.getAttribute("cy") === line.getAttribute("y2"))); return { nodes, lanes: lines.length, linesEndAtNodes: ends, curves: document.querySelectorAll("#v-strands svg path").length, tips: document.querySelectorAll("#v-strands .sref").length, legend: document.querySelectorAll("#v-strands .legend button").length }; })()`), "the strands", 10000);
    step("views", { oneAtATime, characters, path, places, placeScenes, strands });
    await picture("3-strands");
    // Where a strand forks off and where one rejoins.
    await run(`(() => { const tips = [...document.querySelectorAll("#v-strands .sref")]; (tips[1] ?? tips[0])?.scrollIntoView({ block: "center" }); })()`);
    await wait(300);
    await picture("3b-fork");
    // A strand row moves the reader; a character's record; the problems.
    await run(`document.querySelectorAll("#v-strands .snode")[40]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
    await icon("characters");
    await run(`document.querySelector("#v-characters [data-record]").click()`);
    const record = await until(() => run(`(() => { const r = document.querySelector("#v-record .record h1"); const refs = document.querySelectorAll("#v-record [data-line]").length; return r && refs ? { references: refs } : null; })()`), "the record", 20000);
    await icon("problems");
    const problems = await until(() => run(`(() => { const t = document.getElementById("v-problems").textContent; return /Reading the problems/.test(t) ? null : { listed: document.querySelectorAll("#v-problems [data-line]").length }; })()`), "the problems", 20000).catch(() => -1);
    step("record and problems", { record, problems });
    // The left strip: the outline, a search (a name from the book), the readings; the active icon folds the left panel.
    const left = (view) => run(`document.querySelector('#leftbar [data-left="${view}"]').click()`);
    await left("outline");
    const outline = await until(() => run(`document.querySelectorAll("#l-outline .node").length || null`), "the outline", 20000);
    const name = await run(`document.querySelector("#v-characters li[data-char] .nm")?.textContent ?? ""`);
    await left("search");
    await run(`(() => { const input = document.getElementById("search-text"); input.value = ${JSON.stringify("__NAME__")}.replace("__NAME__", document.querySelector("#v-characters li[data-char] .nm")?.textContent ?? ""); input.dispatchEvent(new Event("input")); })()`);
    const search = await until(() => run(`(() => { const lines = document.querySelectorAll("#l-search .hit").length; return lines ? { lines, names: document.querySelectorAll("#l-search [data-entity]").length, marked: document.querySelectorAll("#l-search mark").length } : null; })()`), "the search", 20000);
    await picture("6-search");
    await left("readings");
    const readings = await until(() => run(`(() => { const t = document.getElementById("l-readings"); return t.querySelector(".keyrow") ? { jobs: t.querySelectorAll(".job").length, notRead: t.querySelectorAll("[data-run]").length } : null; })()`), "the readings", 10000);
    await left("readings");
    const leftFolded = await run(`getComputedStyle(document.getElementById("left")).display === "none"`);
    await left("library");
    const leftBack = await run(`getComputedStyle(document.getElementById("left")).display !== "none" && document.querySelectorAll("#tree .node").length > 0`);
    step("left strip", { outline, searchedFor: name.length > 0, search, readings, leftFolded, leftBack });
    // The active icon folds the left panel; again, it opens; the right side is the chat alone; day.
    await icon("problems"); await icon("problems");
    const folded = await run(`getComputedStyle(document.getElementById("left")).display === "none" && document.getElementById("reader").getBoundingClientRect().width > 700`);
    await icon("strands");
    const reopened = await run(`getComputedStyle(document.getElementById("left")).display !== "none"`);
    const rightIsChatOnly = await run(`!document.querySelector(".activity") && [...document.querySelectorAll("#panel .panel-view")].map((v) => v.dataset.view).join() === "chat"`);
    await run(`document.getElementById("t-daylight").click()`);
    await wait(500);
    const day = await run(`[document.documentElement.dataset.daylight, document.getElementById("reader").contentDocument.documentElement.dataset.theme]`);
    step("folding and day", { foldedReaderWide: folded, reopened, rightIsChatOnly, day });
    await picture("4-day");
    await run(`document.getElementById("t-daylight").click()`);
    // The chat: the agent hosts and their sessions; a message through a stand-in command (no real session is touched).
    await run(`document.getElementById("t-chat").click()`);
    const hosts = await until(() => run(`(() => { const b = [...document.querySelectorAll("#hosts button")]; return b.length ? b.map((x) => [x.dataset.host, Number(x.querySelector(".k").textContent)]) : null; })()`), "the agent hosts", 30000);
    const claude = hosts.find(([id, n]) => id === "claude-code" && n > 0);
    let chat = { hosts };
    if (claude) {
      await run(`document.querySelector('#hosts [data-host="claude-code"]').click()`);
      await run(`document.querySelector("#chat-body [data-session]").click()`);
      const messages = await until(() => run(`document.querySelectorAll("#chat-body .msg").length || null`), "a session's messages", 20000);
      const compose = await run(`!document.getElementById("compose").hidden`);
      if (!realAgent) {
        await run(`(() => { document.getElementById("compose-text").value = "stand-in test message"; document.getElementById("compose").requestSubmit(); })()`);
        await until(() => run(`!document.getElementById("pending") || /Not sent/.test(document.getElementById("pending").textContent) ? true : null`), "the stand-in reply", 20000);
      }
      chat = { hosts, messages, compose, sentThroughStandIn: realAgent ? "skipped (real agent)" : await run(`!document.querySelector("#chat-body .pending")`) };
    }
    step("chat", chat);
    await picture("5-chat");
    await icon("strands");
  }

  // A book with no reading: its play button with no keys opens the keys dialog (nothing is started).
  // Only with no keys: with keys entered, a play button starts a paid reading, which is the user's button, never a test's.
  const keyed = await host(`novelHost.keys().then((keys) => Boolean(keys.jev || keys.work))`);
  const play = !keyed && await run(`(() => { const button = [...document.querySelectorAll("#tree .act.run")].find((item) => item.textContent.trim() === "\u25b6"); if (!button) return false; button.click(); return true; })()`);
  if (keyed) step("play without keys", { skipped: "keys are entered: a play button would start a paid reading" });
  if (play) {
    const dialog = await until(() => run(`document.getElementById("keys-dialog").open || null`), "the keys dialog", 10000).catch(() => false);
    const states = await run(`[document.getElementById("state-jev").textContent, document.getElementById("state-work").textContent]`);
    step("play without keys", { keysDialog: Boolean(dialog), states });
    await picture("4-keys");
    await run(`document.querySelector('#keys-form button[value="cancel"]').click()`);
  }
  seen.ok = true;
} catch (error) {
  seen.ok = false; seen.error = String(error.stack ?? error);
  await picture("failure").catch(() => {});
} finally {
  seen.stderr = errors.split("\n").filter((line) => /error|uncaught/i.test(line)).slice(-6);
  try { socket?.close(); } catch {}
  if (asUser) { try { execFileSync("pkill", ["-f", appBinary]); } catch {} } else child.kill();
  console.log(JSON.stringify(seen, null, 1));
  process.exit(seen.ok ? 0 : 1);
}
