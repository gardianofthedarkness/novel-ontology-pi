// The extension's test in the installed editor: node archive/novel-vscode/test/launch.mjs [folder]
// With no folder it builds a small shelf (two books of one world with readings, an EPUB of another) and arranges it.
// The editor runs apart from any open window (its own user data and extensions folders, under the system's temp).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, "..", "..", "..");
const load = (path) => import(pathToFileURL(join(repository, "dist", path)).href);

function editor() {
  if (process.env.VSCODE_BIN) return process.env.VSCODE_BIN;
  const fixed = "/Applications/Visual Studio Code.app/Contents/MacOS/Electron";
  if (existsSync(fixed)) return fixed;
  for (const directory of (process.env.PATH ?? "").split(":")) {
    const code = join(directory, "code");
    if (existsSync(code)) { const binary = resolve(dirname(realpathSync(code)), "..", "..", "..", "MacOS", "Electron"); if (existsSync(binary)) return binary; }
  }
  throw new Error("No editor found: set VSCODE_BIN to its executable.");
}

// --shots <dir>: also keep pictures of the editor's own window (through its debugging port; nothing else on screen is read).
const argv = process.argv.slice(2), shotsAt = argv.indexOf("--shots"), shots = shotsAt >= 0 ? resolve(argv[shotsAt + 1]) : null;
if (shotsAt >= 0) argv.splice(shotsAt, 2);
let folder = argv[0] ? resolve(argv[0]) : null;
if (!folder) {
  const { shelf } = await load("test/v3-fixture.js"), { scanFolder, universeAdd, putBook, linkReading } = await load("src/library/folder.js");
  const made = await shelf(); folder = made.folder;
  await scanFolder(folder); await universeAdd(folder, "The Lighthouse");
  await putBook(folder, "keeper-1.txt", "the-lighthouse"); await putBook(folder, "keeper-2.txt", "the-lighthouse");
  await linkReading(folder, "keeper-1.txt", made.one.novel); await linkReading(folder, "keeper-2.txt", made.two.novel);
}
const scratch = mkdtempSync(join(tmpdir(), "novel-vscode-")), out = join(scratch, "result.json");
const args = [folder, `--extensionDevelopmentPath=${resolve(here, "..")}`, `--extensionTestsPath=${join(here, "run.js")}`, `--user-data-dir=${join(scratch, "data")}`, `--extensions-dir=${join(scratch, "extensions")}`,
  "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--new-window"];
const port = 9300 + Math.floor(Math.random() * 600);
if (shots) { mkdirSync(shots, { recursive: true }); for (const name of readdirSync(shots)) if (/\.(ready|done)$/.test(name)) rmSync(join(shots, name)); args.push(`--remote-debugging-port=${port}`); }
const child = spawn(editor(), args, { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, NOVEL_TEST_OUT: out, ...(shots ? { NOVEL_TEST_SHOTS: shots } : {}), ELECTRON_RUN_AS_NODE: undefined } });

/** A picture of the editor's window, asked of the window itself. */
async function picture(file) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(), page = pages.find((entry) => entry.type === "page" && /workbench/.test(entry.url)) ?? pages.find((entry) => entry.type === "page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const data = await new Promise((done) => { socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id === 1) done(message.result.data); }; socket.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } })); });
  writeFileSync(file, Buffer.from(data, "base64")); socket.close();
}
const watcher = shots ? setInterval(async () => {
  for (const name of readdirSync(shots).filter((entry) => entry.endsWith(".ready"))) {
    const base = name.slice(0, -6);
    if (existsSync(join(shots, `${base}.done`))) continue;
    await picture(join(shots, `${base}.png`)).catch((error) => { errors += `\npicture ${base}: ${error.message}`; });
    writeFileSync(join(shots, `${base}.done`), "");
  }
}, 300) : null;
let errors = "";
child.stderr.on("data", (chunk) => { errors += chunk; });
const timer = setTimeout(() => { errors += "\nTimed out after 420 seconds."; child.kill(); }, 420000);
child.on("exit", (code) => {
  clearTimeout(timer); if (watcher) clearInterval(watcher);
  const result = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { ok: false, error: `The editor wrote no result (exit ${code}).\n${errors.split("\n").filter((line) => /error|fail/i.test(line)).slice(-8).join("\n")}` };
  console.log(JSON.stringify({ folder, exit: code, ...result }, null, 1));
  process.exit(result.ok && code === 0 ? 0 : 1);
});
