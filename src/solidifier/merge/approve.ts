import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import { buildGraphFromBundle } from "../../ground/connectors/ladybug.js";
import { jevFromEnv } from "../../ground/connectors/jev.js";
import { EventLog } from "../../ground/events/log.js";
import { observeDecisions } from "../../ground/events/observe.js";
import { markCausalitySweepPending } from "../causality/faculty.js";
import { runIdentityAfterApply } from "../identity/afterApply.js";
import { castScope } from "../identity/cast.js";
import { syncThings } from "../identity/things.js";
import { buildCalendar } from "../calendar/calendar.js";
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
  // Universal EM: the book joins the shared character list; its new characters are checked against the book and the universe.
  let identity: Awaited<ReturnType<typeof runIdentityAfterApply>> | { error: string } | null = null;
  try { identity = await runIdentityAfterApply({ novelDir: directory, decisions: observeDecisions(jevFromEnv(env), emit, { blockId: packet.blockId }), changeset: packet, events: emit, env }); } catch (error) { identity = { error: error instanceof Error ? error.message : String(error) }; }
  // Named buildings and things (stage objects): the book's reviewed ones join the universe's list of things.
  let things: Awaited<ReturnType<typeof syncThings>> | { error: string } | null = null;
  if (packet.blockId === "stage-objects") try { things = await syncThings(directory, env); } catch (error) { things = { error: error instanceof Error ? error.message : String(error) }; }
  // Named buildings and things, and places' landscapes, add no events, scenes, story time or causes: the causality sweep has nothing new to read.
  if (packet.blockId !== "stage-objects" && packet.blockId !== "stage-landscape") try { await markCausalitySweepPending(directory); } catch {}
  // Story time changed: the universe calendar (the one clock) is rebuilt. No model calls.
  let calendar: { entries: number; questions: number } | { error: string } | null = null;
  if (packet.proposals.some((proposal) => proposal.kind === "upsert_entity" && (proposal.payload as { kind?: string }).kind === "TimePoint" || proposal.kind === "add_relation" && (proposal.payload as Relation).type === "OCCURS_DURING")) {
    try { const built = await buildCalendar(await castScope(directory, env)); calendar = { entries: built.entries.length, questions: built.questions.length }; } catch (error) { calendar = { error: error instanceof Error ? error.message : String(error) }; }
  }
  const graph = await buildGraphFromBundle(ontology, join(ontology, "graph.lbug"), emit);
  return { id, status: packet.status, ...application, ...(verifiedFacts !== undefined ? { verifiedFacts } : {}), graph, ...(identity ? { identity } : {}), ...(things ? { things } : {}), ...(calendar ? { calendar } : {}) };
}
