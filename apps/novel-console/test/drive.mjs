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
const packaged = flag("--app"); flag("--shots");
const shotsDir = (() => { const at = process.argv.indexOf("--shots"); return at >= 0 ? resolve(process.argv[at + 1]) : null; })();
const folders = (argv[0] ?? "").split(",").filter(Boolean).map((folder) => resolve(folder));
if (!folders.length) { console.error("usage: node test/drive.mjs <folder>[,<folder>…] [--app <path to .app>] [--shots <dir>]"); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), "novel-console-")), secrets = join(profile, "secrets");
writeFileSync(join(profile, "libraries.json"), JSON.stringify({ folders }));
const port = 9400 + Math.floor(Math.random() * 400);
const binary = packaged ? join(resolve(packaged), "Contents", "MacOS", "Novel Console") : join(appDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
const child = spawn(binary, [...(packaged ? [] : [appDir]), `--remote-debugging-port=${port}`], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, NOVEL_CONSOLE_DATA: profile, NOVEL_SECRETS_DIR: secrets, TYPESAFE_API_KEY: "", WORK_LLM_API_KEY: "", ELECTRON_RUN_AS_NODE: "" } });
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
  const opened = await run(`(() => { const row = [...document.querySelectorAll("#tree .node")].find((node) => /entries/.test(node.querySelector(".desc").textContent)); if (!row) return null; row.click(); return row.querySelector(".name").textContent; })()`);
  if (opened) {
    // The book opens on its first page (an EPUB's cover and plates); the reader is then sent to a spoken line, as the panel does.
    await until(() => run(`document.getElementById("reader").contentDocument?.getElementById("status")?.textContent.includes("documents loaded") || null`), "the reader's first page", 60000);
    const spoken = await run(`(async () => { const lib = (await window.novelHost.libraries())[0].path; const tree = await window.novelHost.ask(lib, "novel/tree"); const book = [...tree.universes.flatMap((u) => u.books), ...tree.unsorted].find((b) => b.reading); const view = await window.novelHost.ask(lib, "novel/read", { id: book.id }); return Object.keys(view.speakers).filter((id) => view.kinds[id] === "spoken")[30]; })()`);
    await run(`document.getElementById("reader").contentWindow.postMessage({ type: "reveal", sentence: ${JSON.stringify(spoken)} }, "*")`);
    await until(() => run(`document.getElementById("reader").contentDocument?.querySelectorAll("#book .s").length > 20`), "the reader's sentences", 90000);
    const counts = await run(`(() => { const d = document.getElementById("reader").contentDocument; return { sentences: d.querySelectorAll("#book .s").length, marks: d.querySelectorAll("#book .m").length, speakers: d.querySelectorAll("#book .who").length, pictures: d.querySelectorAll("#book img.epub").length, status: d.getElementById("status").textContent.length }; })()`);
    step("reader", counts);
    // A spoken line with a speaker, tapped.
    const tapped = await run(`(() => { const d = document.getElementById("reader").contentDocument; const who = [...d.querySelectorAll("#book .who")][3] ?? d.querySelector("#book .who"); const line = who?.nextElementSibling; if (!line) return null; line.scrollIntoView({ block: "center" }); line.click(); return line.dataset.id; })()`);
    const notes = await until(() => run(`(() => { const d = document.getElementById("reader").contentDocument; const h = [...d.querySelectorAll("#notes h2")].map((x) => x.textContent); return h.length ? h : null; })()`), "the notes", 20000);
    step("notes", { line: tapped, sections: notes });
    await picture("2-reader");
    const cast = await until(() => run(`(() => { const items = document.querySelectorAll("#panel-body li[data-entity]"); return items.length ? items.length : null; })()`), "the cast");
    await run(`document.querySelector("#panel-body li[data-entity]").click()`);
    const record = await until(() => run(`(() => { const r = document.querySelector("#panel-body .record h1"); const refs = document.querySelectorAll("#panel-body li[data-line]").length; return r && refs ? { title: r.textContent.length > 0, references: refs } : null; })()`), "the record", 20000);
    step("panel", { cast, record });
    await picture("3-record");
    // A reference in the panel moves the reader.
    await run(`document.querySelectorAll("#panel-body li[data-line]")[5]?.click()`);
    await wait(1500);
    await run(`document.querySelector('.tabs button[data-tab="problems"]').click()`);
    const problems = await until(() => run(`(() => { const body = document.getElementById("panel-body"); return /problem|No problems/.test(body.textContent) && !/Reading the problems/.test(body.textContent) ? document.querySelectorAll("#panel-body li").length : null; })()`), "the problems", 20000).catch(() => -1);
    step("problems", { listed: problems });
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
