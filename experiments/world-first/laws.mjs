// The world's laws over events, things and knowledge (docs/world-first-design.md §4.7–4.9). Presence, place and time are
// world.mjs's; these check what the base layer says people did against where the world has them:
// - Actors are there: an event's actor the world does not have in the scene is added when Jev thought it likely (the
//   presence was missed), and flagged otherwise.
// - Things are held by one person: a thing someone picks up while someone else still holds it (nobody dropped it) is a
//   conflict; a thing is wherever its holder is.
// - Knowledge flows: someone learns something only by being in the scene where it happens, or by hearing it in a dialogue
//   of that scene (a party, or a listener of a public or group node); anything else is learned off the page, flagged.

/** Event actors against the scene: who to add (likely there, `chance` at least `floor`) and who to flag. */
export function actors({ events, inScene, chance, elsewhere, floor = 0.3 }) {
  const add = new Set(), flags = [];
  for (const event of events) for (const id of event.actors) {
    if (inScene.includes(id) || add.has(id)) continue;
    if (elsewhere(id)) flags.push({ event: event.id, person: id, law: 'actor elsewhere at this time' });
    else if ((chance(id) ?? 0) >= floor) add.add(id);
    else flags.push({ event: event.id, person: id, law: 'actor not in the scene' });
  }
  return { add: [...add], flags };
}

/** Who holds each thing, event by event in story order (`order` maps an event id to its place in the world); conflicts where a thing is picked up while held. */
export function things(states, order) {
  const holder = new Map(), flags = [];
  for (const state of [...states].filter(entry => order.has(entry.after)).sort((a, b) => order.get(a.after) - order.get(b.after))) {
    for (const thing of state.drops) if (holder.get(thing) === state.person) holder.delete(thing);
    for (const thing of state.holds) {
      const before = holder.get(thing);
      if (before && before !== state.person) flags.push({ event: state.after, person: state.person, thing, law: `picked up while ${before} holds it` });
      holder.set(thing, state.person);
    }
  }
  return { holder: Object.fromEntries(holder), flags };
}

/** Knowledge learned against the scene it happens in: `sceneOf` an event's scene, `heard(scene)` everyone in the scene or hearing its dialogues. */
export function knowledge(states, sceneOf, heard) {
  const flags = [];
  for (const state of states) {
    if (!state.learns.length) continue;
    const scene = sceneOf.get(state.after);
    if (scene && !heard(scene).has(state.person)) flags.push({ event: state.after, person: state.person, learns: state.learns.slice(0, 2), law: 'learned off the page (not in the scene, not in its dialogues)' });
  }
  return flags;
}
