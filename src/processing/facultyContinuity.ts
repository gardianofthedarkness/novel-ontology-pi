import type { ChangeProposal } from "../merge/changeset.js";
import type { OntologyStore } from "../ontology/store.js";
import type { CharacterStateAtPoint, OntEvent, StateChange } from "../ontology/types.js";
import { foldStateAt, latestEvent } from "../ontology/state.js";

export async function previewFacultyStates(store: OntologyStore, proposals: ChangeProposal[]): Promise<CharacterStateAtPoint[]> {
  const events = proposals.filter(proposal => proposal.kind === "create_event").map(proposal => proposal.payload as OntEvent);
  const last = latestEvent(events);
  if (!last) return [];
  const deltas = proposals.filter(proposal => proposal.kind === "set_state_change").map(proposal => ({ ...proposal.payload as unknown as StateChange, id: proposal.id }));
  const prior = latestEvent(await store.listEvents("tl_canon", 0));
  const owners = [...new Set(deltas.map(delta => delta.characterId))];
  return Promise.all(owners.map(async characterId => {
    const initial = prior ? await store.getStateAt(characterId, prior.id) : null;
    const seed: StateChange[] = initial && prior ? [{
      id: `faculty-seed:${characterId}`, characterId, afterEventId: prior.id,
      emotions: initial.emotions, knowledgeAdd: initial.knowledge, goalsAdd: initial.goals,
      relationships: initial.relationships, location: initial.location,
      possessionsAdd: initial.possessions, possessionsRemove: [],
    }] : [];
    return foldStateAt(characterId, last.id, prior ? [prior, ...events] : events, [...seed, ...deltas])!;
  }));
}
