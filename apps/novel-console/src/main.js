// Novel Console (docs/v3/design.html#console; the user, 2026-11-10: "Let's do electron then"): our own Mac app for reading novels.
// The window is the console; each library folder the user adds gets a novel server (dist/src/v3/server.js, the same JSON-RPC
// the editor extension spoke) run by this app's own Node; the console and the reader are served from app:// so they share an
// origin and nothing is loaded from outside. Keys go to the Mac's secure store through the reading module, never to a page.
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { fork, spawn } = require("node:child_process");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

// The backend: the repository's built code beside the app in development, its copy in the app's resources when packaged.
const backend = app.isPackaged ? path.join(process.resourcesPath, "backend") : path.resolve(__dirname, "..", "..", "..");
const serverScript = path.join(backend, "dist", "src", "v3", "server.js");
const readerTemplate = path.join(backend, "apps", "reader", "reader.html");
const store = () => path.join(app.getPath("userData"), "libraries.json");
const log = (...parts) => { try { fs.appendFileSync(path.join(app.getPath("userData"), "console.log"), `${new Date().toISOString()} ${parts.join(" ")}\n`); } catch {} };

// A separate profile for tests (its libraries and storage apart from the user's).
if (process.env.NOVEL_CONSOLE_DATA) app.setPath("userData", path.resolve(process.env.NOVEL_CONSOLE_DATA));

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** A novel server for one folder: Content-Length frames over the child's stdin and stdout. */
class Server {
  constructor(folder) {
    this.folder = folder; this.next = 1; this.waiting = new Map(); this.pending = Buffer.alloc(0); this.closed = false;
    this.child = fork(serverScript, [folder], { silent: true, cwd: backend, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    this.child.stdout.on("data", (chunk) => this.read(chunk));
    this.child.stderr.on("data", (chunk) => log(`[server ${path.basename(folder)}]`, String(chunk).trimEnd()));
    this.child.on("exit", (code) => { this.closed = true; log(`server for ${folder} stopped (${code})`); for (const entry of this.waiting.values()) entry.reject(new Error("The novel server stopped.")); this.waiting.clear(); });
    this.ready = this.request("initialize", { processId: process.pid, rootUri: pathToFileURL(folder).href, capabilities: {} }).then(() => this.notify("initialized"));
  }
  read(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      const head = this.pending.indexOf("\r\n\r\n");
      if (head < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.pending.subarray(0, head).toString("ascii"))?.[1]);
      if (this.pending.length < head + 4 + length) return;
      const message = JSON.parse(this.pending.subarray(head + 4, head + 4 + length).toString("utf8"));
      this.pending = this.pending.subarray(head + 4 + length);
      const entry = message.id !== undefined && message.id !== null ? this.waiting.get(message.id) : null;
      if (!entry) continue;
      this.waiting.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    }
  }
  send(message) { const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8"); this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body])); }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("The novel server is not running."));
    const id = this.next++;
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.send({ id, method, params }); });
  }
  notify(method, params = {}) { if (!this.closed) this.send({ method, params }); }
  stop() { if (this.closed) return; this.request("shutdown").then(() => this.notify("exit"), () => {}); setTimeout(() => { if (!this.closed) this.child.kill(); }, 1500); }
}

// The libraries: folders the user added, kept between launches.
const servers = new Map();
const libraries = () => { try { return JSON.parse(fs.readFileSync(store(), "utf8")).folders.filter((folder) => typeof folder === "string"); } catch { return []; } };
const keep = (folders) => { fs.mkdirSync(path.dirname(store()), { recursive: true }); fs.writeFileSync(store(), JSON.stringify({ folders }, null, 2)); };
const serverOf = (folder) => {
  if (!libraries().includes(folder)) throw new Error("That folder is not one of the console's libraries.");
  if (!servers.has(folder) || servers.get(folder).closed) servers.set(folder, new Server(folder));
  return servers.get(folder);
};
const listing = () => libraries().map((folder) => ({ path: folder, name: path.basename(folder), exists: fs.existsSync(folder) }));

// What a page may ask the server: the novel requests, never a key's entry (that goes through setKeys below).
const ALLOWED = new Set(["novel/scan", "novel/tree", "novel/book", "novel/cast", "novel/document", "novel/record", "novel/refs", "novel/bookProblems", "novel/world", "novel/search", "novel/basicStep", "novel/basic", "novel/series", "novel/arrange",
  "novel/read", "novel/readDocument", "novel/readLine", "novel/readPortrait", "novel/locate", "novel/sentenceAt", "novel/startReading", "novel/reading", "novel/stopReading"]);
const reading = () => import(pathToFileURL(path.join(backend, "dist", "src", "v3", "reading.js")).href);

ipcMain.handle("libraries", () => listing());
ipcMain.handle("addLibrary", async (event, given) => {
  let folder = given;
  if (!folder) {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: "Add a folder of books", buttonLabel: "Add", defaultPath: app.getPath("documents"), properties: ["openDirectory", "createDirectory"] });
    if (picked.canceled || !picked.filePaths[0]) return listing();
    folder = picked.filePaths[0];
  }
  folder = path.resolve(folder);
  if (!libraries().includes(folder)) keep([...libraries(), folder]);
  // A folder the console opens picks up EPUBs by itself; text files come in one by one (Import).
  const server = serverOf(folder); await server.ready; await server.request("novel/scan", { found: ["epub"] });
  return listing();
});
ipcMain.handle("importText", async (event, folder) => {
  if (!libraries().includes(folder)) throw new Error("That folder is not one of the console's libraries.");
  const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: "Import text files as books", buttonLabel: "Import", defaultPath: folder, properties: ["openFile", "multiSelections"], filters: [{ name: "Text", extensions: ["txt", "md"] }] });
  if (picked.canceled || !picked.filePaths.length) return null;
  const outside = picked.filePaths.filter((file) => path.relative(folder, file).startsWith(".."));
  if (outside.length) throw new Error(`Only files inside ${path.basename(folder)} can be imported (${outside.length} were outside it).`);
  const server = serverOf(folder); await server.ready;
  return server.request("novel/import", { paths: picked.filePaths.map((file) => path.relative(folder, file)) });
});
ipcMain.handle("removeLibrary", (event, folder) => { servers.get(folder)?.stop(); servers.delete(folder); keep(libraries().filter((entry) => entry !== folder)); return listing(); });
ipcMain.handle("ask", async (event, folder, method, params) => {
  if (!ALLOWED.has(method)) throw new Error(`The console does not ask ${method}.`);
  const server = serverOf(folder); await server.ready;
  return server.request(method, params || {});
});
ipcMain.handle("keys", async () => (await reading()).keyStatus());
ipcMain.handle("setKeys", async (event, keys) => {
  const module = await reading();
  for (const which of ["jev", "work"]) if (typeof keys?.[which] === "string" && keys[which].trim()) module.setKey(which, keys[which]);
  return module.keyStatus();
});
// The chat panel: the agent hosts the adapter registry lists, their sessions here, a message sent on into one.
const agents = require("./agents.js");
const registry = async () => { try { return (await import(pathToFileURL(path.join(backend, "dist", "src", "adapters", "hosts.js")).href)).listAgentHosts(); } catch { return []; } };
ipcMain.handle("agents", async () => agents.hosts(await registry()));
ipcMain.handle("transcript", (event, key) => agents.transcript(key));
ipcMain.handle("sendToSession", async (event, key, text) => {
  // A Pi session the console started: continued by Pi in its folder, with the same one tool.
  if (String(key).startsWith("pi|")) {
    const session = agents.sessionOf(key);
    if (!session.continues || !libraries().includes(session.cwd)) throw new Error("This Pi session can be read here but not continued.");
    if (!String(text ?? "").trim()) throw new Error("The message is empty.");
    const reply = await runPi({ folder: session.cwd, novel: folderNovel(session.cwd), skill: folderSkill(), prompt: String(text), sessionFile: session.file });
    if (reply.error) throw new Error(reply.error);
    return { reply: reply.result };
  }
  return agents.send(key, text);
});
// One click: an agent arranges a library folder (universes, series, reading order) with the novel folder commands only, as
// v1's library stage had the agent do it (the user, 2026-11-10: "one click a bottom to ask the agent session to arrange our
// work space"). Which agent is the user's: the one open in the chat (the user: "User is free to activate on whichever
// window using"), Claude Code or Pi; a session of it open there is continued, else a new one starts. Each command it runs
// is sent to the window as it runs. The folder gets its own `novel` command in .novel/bin, run by this app's Node.
const arranging = new Map();
function folderNovel(folder) {
  const bin = path.join(folder, ".novel", "bin"), novel = path.join(bin, "novel");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(novel, `#!/bin/sh\n# Novel Console's novel command for this folder (an agent's only tool when it arranges it).\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${path.join(backend, "dist", "src", "cli", "cli.js")}" "$@"\n`, { mode: 0o755 });
  return novel;
}
const folderSkill = () => path.join(backend, "skills", "novel-folder", "SKILL.md");
ipcMain.handle("arrangeWithAgent", async (event, folder, options = {}) => {
  if (!libraries().includes(folder)) throw new Error("That folder is not one of the console's libraries.");
  if (arranging.has(folder)) return arranging.get(folder);
  const agent = options.agent;
  if (agent !== "claude-code" && agent !== "pi") throw new Error("Pick Claude Code or Pi in the chat: the console can start only those two.");
  const session = options.session ? agents.sessionOf(options.session) : null;
  if (session && (session.host !== agent || !session.continues)) throw new Error("That session cannot be continued here.");
  const novel = folderNovel(folder), skill = folderSkill();
  const prompt = [
    `Arrange the novels in this folder for Novel Console: ${folder}`,
    `Read the skill first: ${skill} (section 1, "Arrange the folder").`,
    `The novel command is ${novel}. Run it as \`${novel} folder <verb> "${folder}" ...\` (start with \`${novel} folder basics "${folder}"\`). It is the only command you may run; it never moves or changes the user's files.`,
    "The folder may already have universes (some made by grouping titles only): keep what is right and fix what is not.",
    "Put every book you can place, each with its series, in reading order; leave the rest unsorted.",
    "End with a short report: each universe with its series and books in order, and the books left unsorted and why.",
  ].join("\n");
  const onStep = (step) => { if (!event.sender.isDestroyed()) event.sender.send("agentStep", { folder, agent, ...step }); };
  const run = (agent === "pi"
    ? runPi({ folder, novel, skill, prompt: prompt.replace(/\(section 1[^)]*\)\./, "(section 1): read it with cat."), sessionFile: session?.file, onStep })
    : agents.startSession(prompt, session?.cwd ?? folder, [`Bash(${novel}:*)`, "Read", "Grep", "Glob"], { NOVEL_COMMAND: novel, NOVEL_FOLDER: folder }, { resume: session?.id, onStep }).then((reply) => ({ ...reply, by: "claude-code" })))
    .finally(() => arranging.delete(folder));
  arranging.set(folder, run);
  return run;
});
/** Pi on the work model (tools/pi-review/folder-arrange.mjs): a session of the console's own, new or continued, whose one tool
 * runs the folder's novel command; each step and the session's file go to onStep. */
async function runPi({ folder, novel, skill, prompt, sessionFile = null, onStep = () => {} }) {
  const secrets = await import(pathToFileURL(path.join(backend, "dist", "src", "ground", "connectors", "secrets.js")).href);
  const key = process.env.WORK_LLM_API_KEY?.trim() || secrets.getStoredSecret("work-llm");
  if (!key) throw new Error("Pi works on the work model: enter its key with the key button, then press Ask again.");
  const script = process.env.NOVEL_CONSOLE_PI_RUNNER || path.join(backend, "tools", "pi-review", "folder-arrange.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, folder, novel, skill, agents.piConsoleSessions(), ...(sessionFile ? [sessionFile] : [])], { cwd: folder, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", WORK_LLM_API_KEY: key, NOVEL_ARRANGE_PROMPT: prompt } });
    let buffer = "", err = "", reply = null;
    const line = (text) => {
      let entry; try { entry = JSON.parse(text); } catch { return; }
      if (entry.session !== undefined) onStep({ session: entry.session });
      else if (entry.step !== undefined) onStep({ step: String(entry.step) });
      else reply = entry;
    };
    child.stdout.on("data", (chunk) => { buffer += chunk; for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) { line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); } });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", () => {
      if (buffer.trim()) line(buffer);
      if (!reply) { reject(new Error(`Pi stopped: ${(err || "no reply").trim().slice(-300).replace(/sk-[A-Za-z0-9]{8,}/g, "sk-…")}`)); return; }
      if (reply.error) { resolve({ by: "pi", result: reply.error, error: reply.error }); return; }
      resolve({ by: "pi", result: reply.result, sessionFile: reply.sessionFile, commands: reply.commands, refused: reply.refused, seconds: reply.seconds, error: null });
    });
  });
}
ipcMain.handle("reveal", (event, folder) => { if (libraries().includes(folder)) shell.showItemInFolder(folder); });
ipcMain.handle("version", () => ({ app: app.getVersion(), electron: process.versions.electron, backend: app.isPackaged ? "bundled" : backend }));

/** The console's own files, and the reader rendered for a book (its policy, a fresh nonce, where it opens). */
function serve(request) {
  const url = new URL(request.url);
  if (url.host === "console" && url.pathname === "/reader") return reader(url);
  if (url.host === "console") {
    const name = url.pathname.replace(/^\/+/, "") || "console.html";
    if (!/^[a-z-]+\.(html|css|js|svg)$/.test(name)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, name)).href);
  }
  return new Response("Not found", { status: 404 });
}
/** The reader rendered for one book, on the console's own origin (the console follows it and answers its requests). */
function reader(url) {
  {
    const nonce = crypto.randomBytes(16).toString("base64").replace(/[^A-Za-z0-9]/g, "");
    const boot = { id: url.searchParams.get("id") || "", at: url.searchParams.get("at") || null, host: "console" };
    const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const html = fs.readFileSync(readerTemplate, "utf8").replace("__CSP__", csp).replace(/__NONCE__/g, nonce).replace("/*BOOT*/null", JSON.stringify(boot).replace(/</g, "\\u003c"));
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

function open() {
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600, title: "Novel Console", titleBarStyle: "hiddenInset", backgroundColor: "#16171c",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  window.webContents.on("will-navigate", (event, url) => { if (!url.startsWith("app://")) event.preventDefault(); });
  window.loadURL("app://console/console.html");
  return window;
}

app.whenReady().then(() => {
  protocol.handle("app", serve);
  if (!fs.existsSync(serverScript)) dialog.showErrorBox("Novel Console", `The novel server is missing (${serverScript}). Build the repository (npm run build) or reinstall the app.`);
  open();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) open(); });
});
app.on("window-all-closed", () => { for (const server of servers.values()) server.stop(); app.quit(); });
