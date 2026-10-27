import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import { buildGraphFromBundle } from "../../ground/connectors/ladybug.js";
import { jevFromEnv } from "../../ground/connectors/jev.js";
import { EventLog } from "../../ground/events/log.js";
import { markCausalitySweepPending } from "../causality/faculty.js";
import { runEmPassAfterApply } from "../matching/emFaculty.js";
import { treeViolation } from "../../ground/ontology/placeTree.js";
import type { Relation } from "../../ground/ontology/types.js";
import { applyChangeSet } from "./apply.js";
import { loadChangeSet, setChangeSetStatus } from "./changesetStore.js";
import { prepareSemantic } from "./semanticCommands.js";
import { materializeSemantic } from "./semantic.js";

export async function approveBook(directory: string, id: string, env: NodeJS.ProcessEnv = process.env) {
  const pending = await loadChangeSet(directory, id);
  if (pending.status === "approved") throw new Error("Packet already approved; do not apply twice");
  const context = pending.reviewSource ? await prepareSemantic(directory, pending) : undefined;
  const projection = context ? materializeSemantic(pending, context.entities, context.objects) : null;
  const verifiedFacts = projection?.verifiedFacts;
  const ontology = join(directory, "ontology");
  if (projection) {
    // Places form a strict tree: re-check at apply time, not only at decide
    // time. Another packet may have applied a conflicting parent since this
    // packet was decided (the semantic context digest binds entities and
    // objects, not relations), so a decide-time check alone lets two parents
    // land. Fail closed before anything is written or the packet approved.
    const adding = projection.proposals.filter((proposal) => proposal.kind === "add_relation").map((proposal) => proposal.payload as Relation).filter((relation) => relation.type === "PART_OF");
    if (adding.length) {
      const stored = await new BundleStore(ontology).loadFile<Relation>("relations.jsonl");
      const violation = treeViolation(stored, adding);
      if (violation) throw new Error(violation);
    }
  }
  const packet = await setChangeSetStatus(directory, id, "approved");
  const emit = new EventLog(directory).emit;
  const application = await applyChangeSet(new BundleStore(ontology), packet, emit, context);
  let entityMatching: Awaited<ReturnType<typeof runEmPassAfterApply>> = null;
  try { entityMatching = await runEmPassAfterApply({ novelDir: directory, decisions: jevFromEnv(env), changeset: packet, events: emit }); } catch {}
  try { await markCausalitySweepPending(directory); } catch {}
  const graph = await buildGraphFromBundle(ontology, join(ontology, "graph.lbug"), emit);
  return { id, status: packet.status, ...application, ...(verifiedFacts !== undefined ? { verifiedFacts } : {}), graph, ...(entityMatching ? { entityMatching: { nominated: entityMatching.nominated, merged: entityMatching.merged.length, distinct: entityMatching.distinct.length, uncertain: entityMatching.uncertain.length } } : {}) };
}
