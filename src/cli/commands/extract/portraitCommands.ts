import { spawn } from "node:child_process";
import { open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cutBlocks } from "../../../digger/intake/blocks.js";
import { loadPortraits } from "../../../digger/intake/album/portraits.js";
import { sourceHash, storedSource } from "../../../ground/workspace/source.js";
import type { Entity } from "../../../ground/ontology/types.js";
import { albumPortraits } from "./albumCommands.js";

async function rows(path: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(path, "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function cropperPath(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (pkg.name === "novel-ontology-pi") return join(directory, "tools", "album-portraits", "portraits.py");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Portrait cropper not installed with this CLI");
    directory = parent;
  }
}

async function cropper(novelDir: string, check: boolean, env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const childEnv: NodeJS.ProcessEnv = { PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" };
  for (const key of ["PATH", "HOME", "TMPDIR", "XDG_CACHE_HOME", "HF_HOME", "HF_HUB_CACHE", "HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE"]) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  const script = await cropperPath();
  return new Promise((resolveResult, reject) => {
    const child = spawn(env.NOVEL_PORTRAIT_PYTHON || "python3", [script, novelDir, ...(check ? ["--check"] : [])], {
      env: childEnv, stdio: ["ignore", "pipe", "pipe"], timeout: check ? 15000 : 300000, killSignal: "SIGKILL",
    });
    const stop = () => { child.kill("SIGKILL"); };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let oversized = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 256000) { oversized = true; child.kill("SIGKILL"); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.once("error", () => reject(new Error("Portrait Python unavailable; configure NOVEL_PORTRAIT_PYTHON on the host")));
    child.once("close", (code) => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      if (code !== 0 || oversized) { reject(new Error("Portrait cropper failed or exceeded its budget; existing assignments were preserved. Check the local Python installation, cached models and album assets.")); return; }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
        resolveResult(value);
      }
      catch { reject(new Error("Portrait cropper returned an invalid result")); }
    });
  });
}

export async function portraitReadiness(novelDir: string) {
  const source = await storedSource(novelDir);
  if (!source) return { ready: false, reason: "source_binding_required" };
  const text = await readFile(join(novelDir, "source", source.file), "utf8");
  if (sourceHash(text) !== source.sha256) throw new Error("Stored source changed; restore before portrait assignment");
  const blocks = cutBlocks(text, source.blockSize);
  const audit = await rows(join(novelDir, "events.jsonl"));
  const applied = new Set(audit.flatMap((row) => {
    const event = row.event as { type?: string; changesetId?: string } | undefined;
    return event?.type === "changeset.applied" ? [event.changesetId] : [];
  }));
  let unfinished = 0;
  for (const block of blocks) {
    let packet;
    try { packet = JSON.parse(await readFile(join(novelDir, "changesets", `cs_${block.id}.json`), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (packet?.status !== "approved" || !applied.has(`cs_${block.id}`)) unfinished++;
  }
  if (!blocks.length || unfinished) return { ready: false, reason: "finish_volume_extraction_and_review", unfinishedBlocks: unfinished };
  const illustrations = await rows(join(novelDir, "ontology", "illustrations.jsonl"));
  if (!illustrations.length) return { ready: false, reason: "album_missing_use_matching_epub_intake" };
  const byId = new Map<string, Entity>();
  for (const entity of await rows(join(novelDir, "ontology", "entities.jsonl"))) byId.set(entity.id as string, entity as unknown as Entity);
  const characters = [...byId.values()].filter((entity) => entity.kind === "Character");
  const portraits = await loadPortraits(novelDir);
  const bound = new Set(portraits.map((portrait) => portrait.entityId));
  return { ready: true, characters: characters.length, pictures: illustrations.length, withoutPortrait: characters.filter((character) => !bound.has(character.id)).length };
}

export async function albumAssign(novelDir: string, check = false, env: NodeJS.ProcessEnv = process.env) {
  const workspace = await realpath(resolve(novelDir));
  if (await realpath(join(workspace, "ontology")) !== join(workspace, "ontology")) throw new Error("Portrait metadata directory must not be a symlink");
  const lockPath = join(workspace, "ontology", ".portrait-assignment.lock");
  const lock = check ? null : await open(lockPath, "wx", 0o600);
  try {
    const readiness = await portraitReadiness(workspace);
    if (!readiness.ready) return { status: "blocked", ...readiness };
    if (readiness.characters === 0) return { status: check ? "ready" : "complete", ...readiness, bound: 0, pendingCharacters: 0, reason: "no_canonical_characters" };
    const dependencies = await cropper(workspace, true, env);
    const available = dependencies.ready === true;
    if (check || !available) return { ...readiness, ready: available, status: available ? "ready" : "setup_required", dependencies };
    await albumPortraits(workspace, env);
    const generation = await cropper(workspace, false, env);
    const finalization = await albumPortraits(workspace, env);
    const portraits = await loadPortraits(workspace);
    return {
      status: "complete", generation,
      bound: portraits.filter((portrait) => portrait.entityId !== null).length,
      pendingCharacters: finalization.unboundCharacters.length,
      pending: finalization.unboundCharacters.slice(0, 20),
      visualFallbackAvailable: finalization.tasks.some((task) => task.hostSupportsVisualInput === true),
      metadata: "ontology/portraits.jsonl",
    };
  } finally {
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}
