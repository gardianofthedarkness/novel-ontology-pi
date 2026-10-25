// Supervisor for the Muse-host loopback relays (tools/muse-relay/).
//
// Starts the Jev relay (decision model) and the work-LLM relay, restarts a
// relay that exits unexpectedly (500 ms backoff, gives up after 5 rapid
// failures so a broken configuration is visible instead of spin-looping),
// and stops both children on SIGINT/SIGTERM. Child PIDs are written to a
// pidfile so an operator (or a test) can address a single relay.
//
// Configuration (environment, all optional except the helper paths):
//   MUSE_JEV_HELPER, MUSE_WORK_HELPER  Paths to the host's helper CLIs
//                                     (required by the relays themselves).
//   MUSE_JEV_MODEL                    Model id for the Jev helper.
//   MUSE_RELAY_HOST                   Bind host (default 127.0.0.1).
//   MUSE_JEV_PORT / MUSE_WORK_PORT    Ports (defaults 8791 / 8792).
//   MUSE_RELAY_PIDFILE                Pidfile path (default: a temp file).
//   MUSE_RELAY_MAX_RESTARTS           Rapid-failure budget (default 5).
//
// Requires python3. The relays bind loopback only by default; see README.md.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const host = process.env.MUSE_RELAY_HOST ?? "127.0.0.1";
const pidfile = process.env.MUSE_RELAY_PIDFILE ?? join(tmpdir(), "muse-relay.pids.json");
const maxRestarts = Number(process.env.MUSE_RELAY_MAX_RESTARTS ?? 5);
const children = new Map(); // name -> { proc, restarts }
let stopping = false;

function writePidfile() {
  const pids = {};
  for (const [name, entry] of children) {
    if (entry.proc.exitCode === null) pids[name] = entry.proc.pid;
  }
  writeFileSync(pidfile, JSON.stringify(pids));
}

function launch(name, script, extraEnv) {
  const proc = spawn("python3", [join(dir, script)], {
    env: { ...process.env, MUSE_RELAY_HOST: host, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  proc.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  const entry = { proc, restarts: children.get(name)?.restarts ?? 0 };
  children.set(name, entry);
  writePidfile();
  proc.on("exit", (code, signal) => {
    if (stopping) return;
    entry.restarts += 1;
    if (entry.restarts > maxRestarts) {
      console.error(`[relay] ${name} failed ${entry.restarts} times, giving up`);
      shutdown(1);
      return;
    }
    console.error(`[relay] ${name} exited (${code ?? signal}), restarting in 500ms (attempt ${entry.restarts})`);
    setTimeout(() => {
      if (!stopping) launch(name, script, extraEnv);
    }, 500);
  });
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const { proc } of children.values()) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  try {
    rmSync(pidfile, { force: true });
  } catch {
    // pidfile already gone
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

launch("jev", "jev-relay.py", { MUSE_JEV_PORT: process.env.MUSE_JEV_PORT ?? "8791" });
launch("work", "work-relay.py", { MUSE_WORK_PORT: process.env.MUSE_WORK_PORT ?? "8792" });
