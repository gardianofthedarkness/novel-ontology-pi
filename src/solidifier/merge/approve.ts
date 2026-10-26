import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import { buildGraphFromBundle } from "../../ground/connectors/ladybug.js";
import { jevFromEnv } from "../../ground/connectors/jev.js";
import { EventLog } from "../../ground/events/log.js";
import { markCausalitySweepPending } from "../causality/faculty.js";
import { runEmPassAfterApply } from "../matching/emFaculty.js";
import { applyChangeSet } from "./apply.js";
import { loadChangeSet, setChangeSetStatus } from "./changesetStore.js";
import { prepareSemantic } from "./semanticCommands.js";
import { materializeSemantic } from "./semantic.js";

export async function approveBook(directory: string, id: string, env: NodeJS.ProcessEnv = process.env) {
  const pending = await loadChangeSet(directory, id);
  if (pending.status === "approved") throw new Error("Packet already approved; do not apply twice");
  const context = pending.reviewSource ? await prepareSemantic(directory, pending) : undefined;
  const verifiedFacts = context ? materializeSemantic(pending, context.entities, context.objects).verifiedFacts : undefined;
  const packet = await setChangeSetStatus(directory, id, "approved");
  const ontology = join(directory, "ontology");
  const emit = new EventLog(directory).emit;
  const application = await applyChangeSet(new BundleStore(ontology), packet, emit, context);
  let entityMatching: Awaited<ReturnType<typeof runEmPassAfterApply>> = null;
  try { entityMatching = await runEmPassAfterApply({ novelDir: directory, decisions: jevFromEnv(env), changeset: packet, events: emit }); } catch {}
  try { await markCausalitySweepPending(directory); } catch {}
  const graph = await buildGraphFromBundle(ontology, join(ontology, "graph.lbug"), emit);
  return { id, status: packet.status, ...application, ...(verifiedFacts !== undefined ? { verifiedFacts } : {}), graph, ...(entityMatching ? { entityMatching: { nominated: entityMatching.nominated, merged: entityMatching.merged.length, distinct: entityMatching.distinct.length, uncertain: entityMatching.uncertain.length } } : {}) };
}
