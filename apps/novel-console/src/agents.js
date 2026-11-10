// The chat panel's sessions (docs/v3/plan.md §1.5a): the agent hosts the adapter registry knows (src/adapters/hosts.ts),
// each host's existing sessions on this Mac read where the host keeps them, and a message sent on into a session when the
// host's command line can resume it. Read: Claude Code (~/.claude/projects), Codex (~/.codex/sessions), Gemini CLI
// (~/.gemini/tmp), Pi (~/.pi/agent/sessions and the console hosts' run folders). Continued: Claude Code, with `claude -p
// --resume <id>` in the session's own folder (Gemini resumes only by an index within its project, whose folder its files
// do not name; Codex's command is not installed here). Nothing is sent anywhere but to the host's own command.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile, spawn } = require("node:child_process");

const home = os.homedir();
const MOST = 40, TAIL = 3 * 1024 * 1024, HEAD = 256 * 1024;
const exists = (file) => { try { fs.accessSync(file); return true; } catch { return false; } };
const list = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const stat = (file) => { try { return fs.statSync(file); } catch { return null; } };
const clip = (text, most = 90) => { const line = String(text ?? "").replace(/\s+/g, " ").trim(); return line.length > most ? `${line.slice(0, most - 1)}…` : line; };
/** A file's first and last bytes (session files can be very large). */
function slice(file, size, fromEnd) {
  const info = stat(file); if (!info) return "";
  const length = Math.min(size, info.size), buffer = Buffer.alloc(length), fd = fs.openSync(file, "r");
  try { fs.readSync(fd, buffer, 0, length, fromEnd ? info.size - length : 0); } finally { fs.closeSync(fd); }
  const text = buffer.toString("utf8");
  return fromEnd && info.size > length ? text.slice(text.indexOf("\n") + 1) : text;
}
const lines = (text) => text.split("\n").flatMap((line) => { if (!line.trim()) return []; try { return [JSON.parse(line)]; } catch { return []; } });
const blockText = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.filter((block) => block && (block.type === "text" || block.type === "input_text" || block.type === "output_text")).map((block) => block.text).join("\n") : "");
const toolCount = (content) => (Array.isArray(content) ? content.filter((block) => block?.type === "tool_use" || block?.type === "function_call").length : 0);
const which = (name) => (process.env.PATH ?? "").split(":").concat(["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local", "bin")]).map((dir) => path.join(dir, name)).find((file) => exists(file)) ?? null;

// Each host: where its sessions are, how one is listed and read, whether it can be continued.
const HOSTS = {
  "claude-code": {
    files: () => list(path.join(home, ".claude", "projects")).filter((entry) => entry.isDirectory()).flatMap((dir) => list(path.join(home, ".claude", "projects", dir.name)).filter((entry) => entry.name.endsWith(".jsonl")).map((entry) => path.join(home, ".claude", "projects", dir.name, entry.name))),
    summary(file) {
      const head = lines(slice(file, HEAD, false)), tail = lines(slice(file, HEAD, true));
      const title = [...tail].reverse().find((entry) => entry.type === "custom-title" && entry.customTitle)?.customTitle
        ?? head.find((entry) => entry.type === "user" && typeof entry.message?.content === "string" && !entry.isMeta)?.message.content;
      const cwd = head.find((entry) => entry.cwd)?.cwd ?? tail.find((entry) => entry.cwd)?.cwd ?? null;
      return { id: path.basename(file, ".jsonl"), title: clip(title || "(untitled)"), cwd };
    },
    read(file) {
      return lines(slice(file, TAIL, true)).flatMap((entry) => {
        if ((entry.type !== "user" && entry.type !== "assistant") || entry.isMeta || entry.isSidechain) return [];
        const content = entry.message?.content, text = blockText(content), tools = toolCount(content);
        if (!text.trim() && !tools) return [];
        if (entry.type === "user" && Array.isArray(content) && content.every((block) => block?.type === "tool_result")) return [];
        return [{ role: entry.type, text, tools, at: entry.timestamp ?? null }];
      });
    },
    command: () => which("claude"),
    send(command, session, text) { return run(command, ["-p", "--resume", session.id, "--output-format", "json", text], session.cwd, (out) => { try { return JSON.parse(out).result ?? out; } catch { return out; } }); },
  },
  codex: {
    files: () => walk(path.join(home, ".codex", "sessions"), (name) => name.endsWith(".jsonl"), 4),
    summary(file) {
      const head = lines(slice(file, HEAD, false)), meta = head.find((entry) => entry.type === "session_meta")?.payload ?? {};
      const first = head.find((entry) => entry.type === "response_item" && entry.payload?.type === "message" && entry.payload.role === "user" && !/^<(environment_context|user_instructions)/.test(blockText(entry.payload.content).trim()));
      return { id: meta.id ?? path.basename(file, ".jsonl"), title: clip(first ? blockText(first.payload.content) : "(untitled)"), cwd: meta.cwd ?? null };
    },
    read(file) {
      return lines(slice(file, TAIL, true)).flatMap((entry) => {
        const item = entry.payload;
        if (entry.type !== "response_item" || item?.type !== "message" || (item.role !== "user" && item.role !== "assistant")) return [];
        const text = blockText(item.content);
        if (!text.trim() || /^<(environment_context|user_instructions)/.test(text.trim())) return [];
        return [{ role: item.role, text, tools: 0, at: entry.timestamp ?? null }];
      });
    },
    command: () => null,
  },
  "gemini-cli": {
    files: () => list(path.join(home, ".gemini", "tmp")).filter((entry) => entry.isDirectory()).flatMap((dir) => list(path.join(home, ".gemini", "tmp", dir.name, "chats")).filter((entry) => entry.name.endsWith(".json")).map((entry) => path.join(home, ".gemini", "tmp", dir.name, "chats", entry.name))),
    summary(file) {
      let data = {}; try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
      const first = (data.messages ?? []).find((message) => message.type === "user");
      return { id: data.sessionId ?? path.basename(file, ".json"), title: clip(first ? (typeof first.content === "string" ? first.content : blockText(first.content)) : "(untitled)"), cwd: null };
    },
    read(file) {
      let data = {}; try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
      return (data.messages ?? []).filter((message) => message.type === "user" || message.type === "gemini").map((message) => ({ role: message.type === "user" ? "user" : "assistant", text: typeof message.content === "string" ? message.content : blockText(message.content), tools: (message.toolCalls ?? []).length, at: message.timestamp ?? null })).filter((message) => message.text.trim() || message.tools);
    },
    command: () => null,
  },
  pi: {
    files: () => [path.join(home, ".pi", "agent", "sessions"), ...piRunFolders()].flatMap((dir) => walk(dir, (name) => name.endsWith(".jsonl"), 2)),
    summary(file) {
      const head = lines(slice(file, HEAD, false)), meta = head.find((entry) => entry.type === "session") ?? {};
      const first = head.find((entry) => entry.type === "message" && entry.message?.role === "user");
      return { id: meta.id ?? path.basename(file, ".jsonl"), title: clip(first ? blockText(first.message.content) : "(untitled)"), cwd: meta.cwd ?? null };
    },
    read(file) {
      return lines(slice(file, TAIL, true)).flatMap((entry) => {
        const message = entry.type === "message" ? entry.message : null;
        if (!message || (message.role !== "user" && message.role !== "assistant")) return [];
        const text = blockText(message.content), tools = Array.isArray(message.content) ? message.content.filter((block) => block?.type === "toolCall").length : 0;
        return text.trim() || tools ? [{ role: message.role, text, tools, at: entry.timestamp ?? null }] : [];
      });
    },
    command: () => null,
  },
};
const NOTES = {
  codex: "Read only: Codex's command is not installed on this Mac.",
  "gemini-cli": "Read only: Gemini resumes a session only by its number within its own project folder, which its files do not name.",
  pi: "Read only: Pi's sessions belong to the console host that ran them.",
  "claude-code": "Read only: the claude command was not found.",
};
/** The Pi host's own sessions: each console host keeps them in its library's run folders (runtime/<run>/sessions). */
function piRunFolders() {
  const roots = [path.join(home, "claude-world-first")];
  return roots.flatMap((root) => list(root).filter((entry) => entry.isDirectory()).flatMap((library) => list(path.join(root, library.name, "runtime")).filter((entry) => entry.isDirectory()).map((run) => path.join(root, library.name, "runtime", run.name, "sessions")).filter((dir) => exists(dir))));
}
function walk(dir, keep, depth) {
  if (depth < 0) return [];
  return list(dir).flatMap((entry) => { const full = path.join(dir, entry.name); return entry.isDirectory() ? walk(full, keep, depth - 1) : keep(entry.name) ? [full] : []; });
}
function run(command, args, cwd, shape) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: cwd && exists(cwd) ? cwd : home, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(shape(out.trim())) : reject(new Error(clip(err || out || `exited ${code}`, 400)))));
  });
}

/** The hosts as the adapter registry lists them, each with its sessions found here (newest first) and whether it can be continued. */
async function hosts(registry) {
  const names = new Map(registry.map((host) => [host.id, String(host.label ?? host.id).replace(/\s*\(.*\)$/, "")]));
  const ids = [...new Set([...registry.map((host) => host.id), ...Object.keys(HOSTS)])];
  return ids.map((id) => {
    const host = HOSTS[id];
    if (!host) return { id, name: names.get(id) ?? id, sessions: [], read: false, continues: false, note: "No sessions of this host are kept on this Mac." };
    const files = host.files().map((file) => ({ file, info: stat(file) })).filter((entry) => entry.info && entry.info.size > 0).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs).slice(0, MOST);
    const sessions = files.map(({ file, info }) => { try { return { ...host.summary(file), updated: info.mtime.toISOString(), size: info.size, key: `${id}|${file}` }; } catch { return null; } }).filter(Boolean);
    const command = host.command();
    const continues = Boolean(command && host.send);
    return { id, name: names.get(id) ?? id, sessions, read: true, continues, note: continues ? null : NOTES[id] ?? "Read only here." };
  });
}
/** One session's messages (its last few megabytes). */
function transcript(key) {
  const [id, file] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)], host = HOSTS[id];
  if (!host || !host.files().includes(file)) throw new Error("No such session.");
  // Runs of messages that only called tools are joined into one ("12 tool calls").
  const messages = [];
  for (const message of host.read(file)) {
    const last = messages.at(-1);
    if (last && !message.text.trim() && !last.text.trim() && last.role === message.role) { last.tools += message.tools; continue; }
    messages.push({ ...message });
  }
  return { key, messages: messages.slice(-80) };
}
/** A message sent on into a session through its host's own command; resolves with the reply. */
async function send(key, text) {
  const [id, file] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)], host = HOSTS[id];
  if (!host || !host.files().includes(file)) throw new Error("No such session.");
  const command = process.env.NOVEL_CONSOLE_AGENT_COMMAND || host.command();
  if (!command || !host.send) throw new Error("This host's sessions can be read here but not continued.");
  if (!String(text ?? "").trim()) throw new Error("The message is empty.");
  return { reply: await host.send(command, host.summary(file), String(text)) };
}
module.exports = { hosts, transcript, send };
