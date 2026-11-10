// Drives Novel Console for a test: node apps/novel-console/test/drive.mjs <folder>[,<folder>…] [--app <Novel Console.app>] [--shots <dir>]
// The app runs with a profile of its own (NOVEL_CONSOLE_DATA) and a key store of its own (NOVEL_SECRETS_DIR), so nothing of
// the user's is read or changed; it is driven through its debugging port (the page's own buttons, clicked in the page), and
// pictures are of its window only. Prints what it saw as JSON. No reading is started: the play button with no keys must
// open the keys dialog, and that is all it is pressed for.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), appDir = resolve(here, "..");
const argv = process.argv.slice(2), flag = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv.splice(at, 2)[1] : null; };
const packaged = flag("--app"), pick = Number(flag("--book") ?? 1) - 1; flag("--shots");
const shotsDir = (() => { const at = process.argv.indexOf("--shots"); return at >= 0 ? resolve(process.argv[at + 1]) : null; })();
const folders = (argv[0] ?? "").split(",").filter(Boolean).map((folder) => resolve(folder));
if (!folders.length) { console.error("usage: node test/drive.mjs <folder>[,<folder>…] [--app <path to .app>] [--shots <dir>]"); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), "novel-console-")), secrets = join(profile, "secrets");
writeFileSync(join(profile, "libraries.json"), JSON.stringify({ folders }));
const port = 9400 + Math.floor(Math.random() * 400);
const binary = packaged ? join(resolve(packaged), "Contents", "MacOS", "Novel Console") : join(appDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
// A stand-in for the agents' command: the chat's send is tested without touching any real session.
const standIn = join(profile, "agent-stand-in.sh");
writeFileSync(standIn, "#!/bin/sh\necho '{\"result\":\"stand-in reply\"}'\n", { mode: 0o700 });
const child = spawn(binary, [...(packaged ? [] : [appDir]), `--remote-debugging-port=${port}`], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, NOVEL_CONSOLE_DATA: profile, NOVEL_SECRETS_DIR: secrets, NOVEL_CONSOLE_AGENT_COMMAND: standIn, TYPESAFE_API_KEY: "", WORK_LLM_API_KEY: "", ELECTRON_RUN_AS_NODE: "" } });
let errors = ""; child.stderr.on("data", (chunk) => { errors += chunk; });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (probe, what, most = 30000) => { for (const start = Date.now(); ;) { const value = await probe().catch(() => null); if (value) return value; if (Date.now() - start > most) throw new Error(`Timed out waiting for ${what}`); await wait(250); } };

let socket, seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((done, fail) => { const id = ++seq; pending.set(id, { done, fail }); socket.send(JSON.stringify({ id, method, params })); });
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
  await picture("1-library");

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
      await run(`(() => { document.getElementById("compose-text").value = "stand-in test message"; document.getElementById("compose").requestSubmit(); })()`);
      await until(() => run(`!document.getElementById("pending") || /Not sent/.test(document.getElementById("pending").textContent) ? true : null`), "the stand-in reply", 20000);
      chat = { hosts, messages, compose, sentThroughStandIn: await run(`!document.querySelector("#chat-body .pending")`) };
    }
    step("chat", chat);
    await picture("5-chat");
    await icon("strands");
  }

  // A book with no reading: its play button with no keys opens the keys dialog (nothing is started).
  const play = await run(`(() => { const button = document.querySelector("#tree .act.run"); if (!button) return false; button.click(); return true; })()`);
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
  child.kill();
  console.log(JSON.stringify(seen, null, 1));
  process.exit(seen.ok ? 0 : 1);
}
