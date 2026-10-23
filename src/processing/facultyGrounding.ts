import type { ChangeProposal } from "../merge/changeset.js";
import type { Entity, OntEvent, Scene, StateChange } from "../ontology/types.js";
import type { Sentence } from "../text/sectioning.js";

export function groundFacultyProposals(proposals: ChangeProposal[], knownEntities: Entity[], sentences: Sentence[]): Record<string, string> {
  const notes: Record<string, string> = {};
  const entities = new Map(knownEntities.map(entity => [entity.id, entity]));
  for (const proposal of proposals) if (proposal.kind === "upsert_entity") entities.set((proposal.payload as Entity).id, proposal.payload as Entity);
  const events = new Map(proposals.filter(proposal => proposal.kind === "create_event").map(proposal => { const event = proposal.payload as OntEvent; return [event.id, event]; }));
  const references = new Set(sentences.map(sentence => sentence.id));
  const owners = new Map<string, number>();
  let previousOrder = -Infinity;
  for (const proposal of proposals) {
    if (proposal.kind === "create_scene") {
      const scene = proposal.payload as Scene;
      for (const id of scene.sentenceIds) owners.set(id, (owners.get(id) ?? 0) + 1);
      if (scene.sentenceIds.some(id => !references.has(id))) notes[`faculty:grounding:${proposal.id}:source`] = "Scene has unknown source references; review required.";
      for (const turn of scene.turns) {
        if (turn.sentenceIds.some(id => !scene.sentenceIds.includes(id))) notes[`faculty:grounding:${proposal.id}:turn`] = "Turn references leave their scene; review required.";
        if (turn.speakerId && entities.get(turn.speakerId)?.kind !== "Character") notes[`faculty:grounding:${proposal.id}:speaker`] = "Turn speaker does not resolve to a Character; review required.";
      }
      for (const card of scene.dialogues ?? []) {
        if (card.sentenceIds.some(id => !scene.sentenceIds.includes(id))) notes[`faculty:grounding:${proposal.id}:dialogue`] = "Dialogue card references leave their scene; review required.";
        if ([...card.participantIds, ...card.unresolvedParticipantIds ?? []].some(id => entities.get(id)?.kind !== "Character")) notes[`faculty:grounding:${proposal.id}:members`] = "Dialogue membership does not resolve to a Character; review required.";
      }
    }
    if (proposal.kind === "create_event") {
      const event = proposal.payload as OntEvent;
      if (!event.evidence.sentenceIds.length || event.evidence.sentenceIds.some(id => !references.has(id))) notes[`faculty:grounding:${proposal.id}:evidence`] = "Event lacks resolvable source evidence; review required.";
      if (event.chronologicalOrder <= previousOrder) notes[`faculty:grounding:${proposal.id}:order`] = "Event narrative ordering is not strictly increasing; review required.";
      previousOrder = event.chronologicalOrder;
    }
    if (proposal.kind === "set_state_change") {
      const state = proposal.payload as unknown as StateChange;
      if (entities.get(state.characterId)?.kind !== "Character" || !events.has(state.afterEventId) || Object.keys(state.relationships).some(id => entities.get(id)?.kind !== "Character")) notes[`faculty:grounding:${proposal.id}:state`] = "State owner, originating event or relationship target is unresolved; review required. No state was silently dropped or reassigned.";
    }
  }
  if (sentences.some(sentence => owners.get(sentence.id) !== 1)) notes["faculty:grounding:coverage"] = "Source sentences are not covered by exactly one proposed scene; review required.";
  return notes;
}
