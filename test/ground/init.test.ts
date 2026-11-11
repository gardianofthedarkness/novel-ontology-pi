import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BundleStore, type BundleManifest } from "../../src/ground/connectors/bundle.js";
import { listChangeSets } from "../../src/canon/gate/changesetStore.js";
import { initWorkspace } from "../../src/ground/workspace/init.js";

const cli = fileURLToPath(new URL("../../src/cli/cli.js", import.meta.url));

async function tempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-init-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function run(cwd: string, args: string[], model = "") {
  // Fail any accidental model request, even without credentials.
  const noNetwork = "data:text/javascript," + encodeURIComponent(
    'globalThis.fetch = () => { throw new Error("Unexpected network request"); };',
  );
  const result = spawnSync(process.execPath, ["--import", noNetwork, cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      TYPESAFE_API_KEY: "",
      WORK_LLM_API_KEY: "",
      JEV_MODEL: model,
    },
  });
  assert.ifError(result.error);
  return result;
}

test("concurrent initialization allows only one writer and generates distinct novel IDs", async (t) => {
  const root = await tempRoot(t);
  const novelDir = join(root, "race");
  const results = await Promise.allSettled([initWorkspace(novelDir), initWorkspace(novelDir)]);
  const successes = results.filter((r) => r.status === "fulfilled");
  assert.equal(successes.length, 1);
  const failure = results.find((r) => r.status === "rejected");
  assert.equal((failure?.reason as NodeJS.ErrnoException).code, "EEXIST");
  const first = JSON.parse(await readFile(join(novelDir, "ontology", "manifest.json"), "utf8"));
  const second = await initWorkspace(join(root, "other"));
  assert.notEqual(first.novelId, second.manifest.novelId);
});
