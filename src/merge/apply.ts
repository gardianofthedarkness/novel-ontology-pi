import type { OntologyStore } from "../ontology/store.js";
import type { ChangeSet } from "./changeset.js";
import type { Entity, OntEvent, Relation, Scene, StateChange } from "../ontology/types.js";
import type { EventSink } from "../events/types.js";

/**
 * Applies an APPROVED ChangeSet to the ontology main graph.
 * This is the only code path from miniloop output to the store, and it is
 * only reachable after the main agent approves the merge (DESIGN.md
 * §Merge gate). Held or revision-requested change sets never reach here.
 *
 * State materialization (v1, 2026-10-22): add_alias and set_state_change
 * proposals are real writes now — aliases land on the entity's name
 * forms, state deltas persist as records whose fold is the character's
 * state (decision #10). A proposal counts as deferred only when it
 * genuinely cannot be applied (an alias whose entity does not exist);
 * `changeset.merged` fires exactly when nothing was deferred.
 */
export async function applyChangeSet(
  store: OntologyStore,
  changeset: ChangeSet,
  emit?: EventSink,
): Promise<{ applied: number; processed: number; deferred: number }> {
  if (changeset.status !== "approved") {
    throw new Error(
      `Refusing to apply change set ${changeset.id}: status is ${changeset.status}, not approved.`,
    );
  }
  let processed = 0;
  const deferredProposalIds: string[] = [];
  for (const p of changeset.proposals) {
    switch (p.kind) {
      case "upsert_entity":
        await store.upsertEntity(p.payload as Entity);
        break;
      case "create_event":
        await store.upsertEvent(p.payload as OntEvent);
        break;
      case "create_scene":
        await store.upsertScene(p.payload as Scene);
        break;
      case "add_relation":
        await store.addRelation(p.payload as Relation);
        break;
      case "add_alias": {
        const payload = p.payload as { entityId: string; aliasText: string };
        const ok = await store.addAlias(payload.entityId, payload.aliasText);
        if (!ok) deferredProposalIds.push(p.id);
        break;
      }
      case "set_state_change": {
        const payload = p.payload as Omit<StateChange, "id">;
        await store.addStateChange({ ...payload, id: p.id });
        break;
      }
    }
    processed++;
  }
  if (emit) {
    await emit({ type: "changeset.applied", changesetId: changeset.id, target: "store", processed, unsupportedProposalIds: deferredProposalIds });
    if (!deferredProposalIds.length) await emit({ type: "changeset.merged", changesetId: changeset.id, target: "store" });
  }
  return { applied: processed - deferredProposalIds.length, processed, deferred: deferredProposalIds.length };
}
