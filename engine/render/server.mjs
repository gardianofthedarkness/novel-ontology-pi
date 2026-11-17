// The world server's render side (docs/v3/design.html §12.1): a book's world sent to native clients over a local socket.
// Frames: a 4-byte little-endian length, then that many bytes of one JSON message (protocol.mjs). The client speaks first
// with { type: "hello", token } (the token the console handed it on its command line); a wrong one is closed. Each client is
// sent the whole world, and again whenever the page changes (a director run lands a moment): a stream of the world's
// states, the change being the next state. Only on this computer (127.0.0.1).
//
// Usage on its own: node engine/render/server.mjs <book workspace> [--godot <Godot exe>] [--measure <seconds>]
//   starts the server and the Godot client (clients/godot) on it; --measure has the client time its frames and quit.
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { messagesOf } from "./protocol.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const frame = (message) => { const body = Buffer.from(JSON.stringify(message), "utf8"), head = Buffer.alloc(4); head.writeUInt32LE(body.length); return Buffer.concat([head, body]); };

/** The render server for one book's workspace: { port, token, close() }. */
export async function startRenderServer({ workspace, port = 0, token = randomBytes(16).toString("hex"), log = () => {} }) {
  const page = resolve(workspace, "stage", "simulation", "live", "page.json");
  let made = null, madeAt = 0;
  const current = async () => {
    const at = (await stat(page).catch(() => null))?.mtimeMs ?? 0;
    if (made && at === madeAt) return made;
    const data = await readFile(page, "utf8").then(JSON.parse, () => null);
    madeAt = at; made = data ? messagesOf(data).map(frame) : [frame({ type: "hello", protocol: 1, empty: "No page yet: run the director on this book." })];
    return made;
  };
  const clients = new Set();
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0), known = false;
    socket.on("data", async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const length = buffer.readUInt32LE(0), message = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8") || "null");
        buffer = buffer.subarray(4 + length);
        if (!known) {
          if (message?.type !== "hello" || message.token !== token) { socket.destroy(); return; }
          known = true; clients.add(socket);
          const started = Date.now();
          for (const part of await current()) socket.write(part);
          log(`sent the world to a client in ${Date.now() - started} ms`);
        } else if (message?.type === "measured") log(JSON.stringify(message));
      }
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  // A new moment landed: every client is sent the world again.
  let lastAt = (await stat(page).catch(() => null))?.mtimeMs ?? 0;
  const watch = setInterval(async () => {
    const at = (await stat(page).catch(() => null))?.mtimeMs ?? 0;
    if (at === lastAt || !clients.size) { lastAt = at; return; }
    lastAt = at;
    const parts = await current();
    for (const socket of clients) for (const part of parts) socket.write(part);
    log("the page changed: sent the world again");
  }, 1500);
  return { port: server.address().port, token, close: () => { clearInterval(watch); for (const socket of clients) socket.destroy(); server.close(); } };
}

/** The Godot editor binary: NOVEL_GODOT, else the newest Godot_v4*_win64.exe under ~/tools/godot. */
export function findGodot() {
  if (process.env.NOVEL_GODOT && existsSync(process.env.NOVEL_GODOT)) return process.env.NOVEL_GODOT;
  const folder = join(process.env.USERPROFILE ?? process.env.HOME ?? "", "tools", "godot");
  const found = existsSync(folder) ? readdirSync(folder).filter((name) => /^Godot_v4.*_win64(_console)?\.exe$/.test(name)).sort() : [];
  const windowed = found.filter((name) => !name.includes("_console"));
  return (windowed.at(-1) ?? found.at(-1)) ? join(folder, windowed.at(-1) ?? found.at(-1)) : null;
}

/** The Godot client (clients/godot) on a server: its process. `extra`: more of the client's own arguments. */
export function launchClient({ godot = findGodot(), port, token, project = join(repo, "clients", "godot"), extra = [], stdio = "ignore" }) {
  if (!godot) throw new Error("No Godot found: set NOVEL_GODOT or put Godot 4 in ~/tools/godot.");
  // Timing: no frame cap (the client turns vsync off itself too, but a driver may hold it unless asked at the start).
  const engine = extra.some((arg) => arg.startsWith("--measure")) ? ["--disable-vsync", "--max-fps", "0"] : [];
  if (process.env.GODOT_ENGINE_ARGS) engine.push(...process.env.GODOT_ENGINE_ARGS.split(" ").filter(Boolean));
  return spawn(godot, [...engine, "--path", project, "--", `--port=${port}`, `--token=${token}`, ...extra], { stdio, windowsHide: false });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2), workspace = args.find((arg) => !arg.startsWith("--") && !/^\d+$/.test(arg));
  const option = (name) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : null; };
  if (!workspace) { console.error("usage: node engine/render/server.mjs <book workspace> [--godot <exe>] [--measure <seconds>] [--camera x,y,z,tx,ty,tz]"); process.exit(2); }
  const server = await startRenderServer({ workspace, log: (line) => console.log(line) });
  console.log(`render server on 127.0.0.1:${server.port}`);
  const extra = [];
  if (option("measure")) extra.push(`--measure=${option("measure")}`);
  if (option("camera")) extra.push(`--camera=${option("camera")}`);
  for (const name of ["at", "msaa", "hide", "shot", "warm"]) if (option(name)) extra.push(`--${name}=${option(name)}`);
  const child = launchClient({ godot: option("godot") ?? findGodot(), port: server.port, token: server.token, extra, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("exit", (code) => { server.close(); process.exit(code ?? 0); });
}
