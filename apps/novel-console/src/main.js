// Novel Console (docs/v3/console.md; the user, 2026-11-10: "Let's do electron then"): our own Mac app for reading novels.
// The window is the console; each library folder the user adds gets a novel server (dist/src/v3/server.js, the same JSON-RPC
// the editor extension spoke) run by this app's own Node; the console and the reader are served from app:// so they share an
// origin and nothing is loaded from outside. Keys go to the Mac's secure store through the reading module, never to a page.
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
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
const ALLOWED = new Set(["novel/scan", "novel/tree", "novel/book", "novel/cast", "novel/document", "novel/record", "novel/refs", "novel/bookProblems", "novel/world",
  "novel/read", "novel/readDocument", "novel/readLine", "novel/readPortrait", "novel/locate", "novel/sentenceAt", "novel/startReading", "novel/reading", "novel/stopReading"]);
const reading = () => import(pathToFileURL(path.join(backend, "dist", "src", "v3", "reading.js")).href);

ipcMain.handle("libraries", () => listing());
ipcMain.handle("addLibrary", async (event, given) => {
  let folder = given;
  if (!folder) {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: "Add a folder of books", buttonLabel: "Add", properties: ["openDirectory", "createDirectory"] });
    if (picked.canceled || !picked.filePaths[0]) return listing();
    folder = picked.filePaths[0];
  }
  folder = path.resolve(folder);
  if (!libraries().includes(folder)) keep([...libraries(), folder]);
  const server = serverOf(folder); await server.ready; await server.request("novel/scan");
  return listing();
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
ipcMain.handle("sendToSession", (event, key, text) => agents.send(key, text));
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
