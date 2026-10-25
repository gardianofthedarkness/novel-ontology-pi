import { copyFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { recallSourceBlock } from "../../../ground/workspace/source.js";
import { BlockProcessor } from "../../../digger/processing/blockProcessor.js";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { workModelFromEnv } from "../../../ground/connectors/workModel.js";
import { resolveJevKey } from "../../../ground/connectors/secrets.js";
import { EventLog } from "../../../ground/events/log.js";
import {
  loadCorrections,
  pinsForBlock,
} from "../../../solidifier/maintenance/corrections.js";
import { appendAudit } from "../../../solidifier/maintenance/fixes.js";
import { changesetDir, loadChangeSet } from "../../../solidifier/merge/changesetStore.js";
import type { Entity } from "../../../ground/ontology/types.js";
import { loadExtractionCounts } from "../../../digger/processing/counts.js";
import { facultyOptionsFromEnv } from "../../../digger/processing/facultyOptions.js";

/**
 * `novel recall <novel-dir> <blockId>` — the recall protocol
 * (sector 09): re-run ONE block from the workspace's stored source,
 * with the reviewing agent's pinned corrections honored by the
 * miniloop, producing a FRESH held ChangeSet for re-review. The
 * superseded ChangeSet is kept beside it for audit.
 */
export async function runRecall(
  novelDir: string,
  blockId: string,
  opts: { env?: NodeJS.ProcessEnv } = {},
) {
  const env = opts.env ?? process.env;
  const facultyGraph = facultyOptionsFromEnv(env);
  const ontologyDir = join(novelDir, "ontology");
  try {
    await stat(join(ontologyDir, "manifest.json"));
  } catch {
    throw new Error(
      `No novel workspace manifest at ${join(ontologyDir, "manifest.json")}. Run \`novel init ${novelDir}\` first.`,
    );
  }
  if (!resolveJevKey(env)?.key) {
    throw new Error(
      "Jev API key missing for the recall re-run. Run `novel jev login`, set TYPESAFE_API_KEY, or set JEV_API_KEY_ENV to the name of an env var that holds it.",
    );
  }

  const block = await recallSourceBlock(novelDir, blockId);
  const existing = await loadChangeSet(novelDir, `cs_${blockId}`);
  if (existing?.status === "approved") throw new Error("Cannot recall an approved block without a canonical rollback plan; hold the new work for review instead.");
  const history = await readFile(join(novelDir, "events.jsonl"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  if (history.split("\n").filter(Boolean).map((line) => JSON.parse(line)).some((record) => record.event.type === "changeset.applied" && record.event.changesetId === `cs_${blockId}`)) {
    throw new Error("Cannot recall an already applied block without a canonical rollback plan, even if its gate status was changed to held.");
  }
  const corrections = await loadCorrections(novelDir);
  const pins = pinsForBlock(corrections, blockId);

  // Preserve the superseded changeset for audit before it is replaced.
  const csPath = join(changesetDir(novelDir), `cs_${blockId}.json`);
  let supersededKept = false;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyFile(csPath, join(changesetDir(novelDir), `cs_${blockId}.superseded-${stamp}.json`));
    supersededKept = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    supersededKept = false;
  }

  const bundle = new BundleStore(ontologyDir);
  const log = new EventLog(novelDir);
  const loadKnownEntities = async (): Promise<Entity[]> => {
    const rows = await bundle.loadFile<Entity>("entities.jsonl");
    const byId = new Map<string, Entity>();
    for (const e of rows) byId.set(e.id, e);
    return [...byId.values()];
  };
  const loadCounts = () => loadExtractionCounts(novelDir, bundle);
  let workModel = undefined;
  try {
    workModel = workModelFromEnv(env);
  } catch {
    workModel = undefined;
  }

  const processor = new BlockProcessor(bundle, jevFromEnv(env), async () => "held", {
    novelDir,
    emit: log.emit,
    loadKnownEntities,
    loadCounts,
    loadCorrections: () => loadCorrections(novelDir),
    workModel,
    facultyGraph,
    semanticReview: true,
  });
  await processor.processNovel([
    { blockId: block.id, text: block.text, chapterIndex: block.chapterIndex, sectionIndex: block.index },
  ]);
  await appendAudit(novelDir, "recall", {
    blockId,
    pins: [...pins.keys()],
    supersededKept,
  });

  const cs = await loadChangeSet(novelDir, `cs_${blockId}`);
  return {
    status: "ok",
    novelDir,
    blockId,
    changesetId: `cs_${blockId}`,
    pinsHonored: Object.keys(cs?.reviewNotes ?? {}).filter((k) =>
      k.startsWith("recall:pin:"),
    ).length,
    proposals: cs?.proposals.length ?? 0,
    supersededKept,
  };
}
