import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = fileURLToPath(new URL("../../tools/muse-relay/", import.meta.url));
const JEV_PORT = 18791;
const WORK_PORT = 18792;
const SUP_JEV_PORT = 18793;
const SUP_WORK_PORT = 18794;

async function post(port: number, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

async function waitUntil(label: string, check: () => Promise<boolean>, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(`${label} did not happen within ${timeoutMs}ms (last error: ${String(lastError)})`);
}

async function waitForPortDown(port: number, path: string, body: unknown, timeoutMs = 10000): Promise<void> {
  await waitUntil(`port ${port} to stop responding`, async () => {
    try {
      await post(port, path, body);
      return false;
    } catch {
      return true;
    }
  }, timeoutMs);
}

/** Mock Jev helper: echoes the normalized questions it was given. */
const JEV_MOCK = `import json, sys
args = sys.argv[1:]
questions = {}
if "--questions-json" in args:
    questions = json.loads(args[args.index("--questions-json") + 1])
print(json.dumps({"questions": questions}))
`;

/** Mock work helper: prints a completion envelope. */
const WORK_MOCK = `import json
print(json.dumps({"content": "mock completion"}))
`;

test("jev relay forwards normalized questions to the helper, stripping auth", async () => {
  const dir = await mkdtemp(join(tmpdir(), "muse-relay-jev-"));
  const helper = join(dir, "jev-mock.py");
  await writeFile(helper, JEV_MOCK);
  const relay = spawn("python3", [join(TOOLS, "jev-relay.py")], {
    env: { ...process.env, MUSE_JEV_HELPER: helper, MUSE_JEV_PORT: String(JEV_PORT) },
    stdio: "ignore",
  });
  try {
    await waitUntil("jev relay to answer", async () => {
      try {
        const { status } = await post(JEV_PORT, "/", { state: "s", questions: {} });
        return status === 200;
      } catch {
        return false;
      }
    });
    const { status, json } = await post(JEV_PORT, "/", {
      state: "once upon a time",
      questions: {
        q1: { type: "choice", instructions: "pick", criteria: ["a", "b"] },
      },
    });
    assert.equal(status, 200);
    const questions = json.questions as Record<string, { criteria: Record<string, string> }>;
    assert.deepEqual(questions.q1.criteria, { a: "a", b: "b" }, "list criteria normalize to a dict");
  } finally {
    relay.kill("SIGTERM");
  }
});

test("work relay translates OpenAI-shaped completions through the helper", async () => {
  const dir = await mkdtemp(join(tmpdir(), "muse-relay-work-"));
  const helper = join(dir, "work-mock.py");
  await writeFile(helper, WORK_MOCK);
  const relay = spawn("python3", [join(TOOLS, "work-relay.py")], {
    env: { ...process.env, MUSE_WORK_HELPER: helper, MUSE_WORK_PORT: String(WORK_PORT) },
    stdio: "ignore",
  });
  try {
    await waitUntil("work relay to answer", async () => {
      try {
        const { status } = await post(WORK_PORT, "/v1/chat/completions", { messages: [] });
        return status === 200;
      } catch {
        return false;
      }
    });
    const { status, json } = await post(WORK_PORT, "/v1/chat/completions", {
      model: "probe-model",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    });
    assert.equal(status, 200);
    const choices = json.choices as { message: { content: string } }[];
    assert.equal(choices[0].message.content, "mock completion");
    assert.equal(json.model, "probe-model", "model echoes the request");
    const wrong = await post(WORK_PORT, "/other", {});
    assert.equal(wrong.status, 404, "non-completion paths are rejected");
  } finally {
    relay.kill("SIGTERM");
  }
});

test("supervisor restarts a killed relay and stops both on SIGTERM", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "muse-relay-sup-"));
  const jevHelper = join(dir, "jev-mock.py");
  const workHelper = join(dir, "work-mock.py");
  await writeFile(jevHelper, JEV_MOCK);
  await writeFile(workHelper, WORK_MOCK);
  const pidfile = join(dir, "pids.json");
  const sup = spawn("node", [join(TOOLS, "start.mjs")], {
    env: {
      ...process.env,
      MUSE_JEV_HELPER: jevHelper,
      MUSE_WORK_HELPER: workHelper,
      MUSE_JEV_PORT: String(SUP_JEV_PORT),
      MUSE_WORK_PORT: String(SUP_WORK_PORT),
      MUSE_RELAY_PIDFILE: pidfile,
    },
    stdio: "ignore",
  });
  const killAll = () => {
    try {
      sup.kill("SIGTERM");
    } catch {
      // already gone
    }
  };
  t.after(killAll);
  const jevUp = async () => {
    try {
      const { status } = await post(SUP_JEV_PORT, "/", { state: "s", questions: {} });
      return status === 200;
    } catch {
      return false;
    }
  };
  const workUp = async () => {
    try {
      const { status } = await post(SUP_WORK_PORT, "/v1/chat/completions", { messages: [] });
      return status === 200;
    } catch {
      return false;
    }
  };
  await waitUntil("supervisor to bring up jev relay", jevUp);
  await waitUntil("supervisor to bring up work relay", workUp);
  const pidsBefore = JSON.parse(await readFile(pidfile, "utf8")) as { jev: number; work: number };
  assert.ok(pidsBefore.jev > 0 && pidsBefore.work > 0, "pidfile names both relays");
  process.kill(pidsBefore.jev, "SIGKILL");
  await waitUntil("supervisor to restart the killed jev relay", async () => {
    try {
      const pids = JSON.parse(await readFile(pidfile, "utf8")) as { jev: number };
      return pids.jev !== pidsBefore.jev && (await jevUp());
    } catch {
      return false;
    }
  });
  sup.kill("SIGTERM");
  await waitForPortDown(SUP_JEV_PORT, "/", { state: "s", questions: {} });
  await waitForPortDown(SUP_WORK_PORT, "/v1/chat/completions", { messages: [] });
});

test("relays refuse to start without a helper configured", async () => {
  for (const script of ["jev-relay.py", "work-relay.py"]) {
    const proc = spawn("python3", [join(TOOLS, script)], { env: { ...process.env, MUSE_JEV_HELPER: "", MUSE_WORK_HELPER: "" }, stdio: "ignore" });
    const code = await new Promise<number | null>((resolve) => proc.on("exit", resolve));
    assert.equal(code, 2, `${script} exits 2 when its helper is unset`);
  }
});
