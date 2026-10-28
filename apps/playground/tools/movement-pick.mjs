// Prototype: let Jev tell a place's movement chain, then check it physically.
// For each scene: does it say where each person starts (else they start at the
// building's centre), and where. For each event: who changes spot (a yes/no
// per person), then for those who do, the spot they end at, how (walk, run,
// sneak, climb up, go down, fall, teleport, dragged) and which way (up, down,
// same level, out, in). Each event is asked with everyone's current spot, so
// the moves chain. Then solveChain (holoNav.ts) finds each person's likeliest
// chain that physically holds — going down needs height, climbing needs to
// start lower, underground only when said — revising an assumed start
// backwards when the later moves cannot follow from it.
//
//   npm run build   (repo root: the stage modules are read from dist/)
//   node apps/playground/tools/movement-pick.mjs <live.json> <time-place.json> <place label> <volume> <secrets.js of a built CLI> <plan-out.json>
//
// Jev answers typed questions only (no text), against one shared state per
// request. Text only; the plan is a proposal for the view, not a fact.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const [liveFile, timePlaceFile, label, volumeArg, secretsModule, outFile] = process.argv.slice(2);
const dist = fileURLToPath(new URL("../../../dist/apps/playground/src/data/", import.meta.url));
const { placeScript } = await import(pathToFileURL(`${dist}holoScript.js`).href);
const { navGrid, centreSpot, solveChain, MANNERS, DIRECTIONS, DIRECTION_HINT } = await import(pathToFileURL(`${dist}holoNav.js`).href);
const { ARCHITECTURE_LABEL } = await import(pathToFileURL(`${dist}placeArchitecture.js`).href);
const live = JSON.parse(fs.readFileSync(liveFile, "utf8")), data = JSON.parse(fs.readFileSync(timePlaceFile, "utf8"));
const place = data.places.find((entry) => entry.label === label || entry.id === label);
if (!place) throw new Error(`No place ${label}`);
const script = placeScript(data, live.world, place.id, Number(volumeArg));
const kind = script.places[0].kind;
if (!kind) throw new Error(`${label} names no building`);
const grid = navGrid(kind);
// Destinations a reader would name; the stairwells are only the way between floors.
const spots = grid.spots.filter((spot) => !spot.id.startsWith("stairs-"));
const spotLabel = new Map(grid.spots.map((spot) => [spot.id, spot.label]));
const nameOf = new Map(script.actors.map((actor) => [actor.id, actor.label]));

const { resolveJevKey } = await import(pathToFileURL(secretsModule).href);
const key = resolveJevKey()?.key;
if (!key) throw new Error("No Jev key: run `novel jev login` or set TYPESAFE_API_KEY");
const endpoint = process.env.JEV_ENDPOINT || "https://api.typesafe.ai/v1/systemone", model = process.env.JEV_MODEL || "jev-1.13.0";
let calls = 0, millis = 0;
async function decide(state, questions) {
  const started = Date.now();
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, state, questions }), signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  calls++; millis += Date.now() - started;
  if (!response.ok) throw new Error(`Jev ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).answers ?? {};
}

const where = `${script.title} is a ${ARCHITECTURE_LABEL[kind].toLowerCase()}. Its spots: ${spots.map((spot) => `${spot.label} (${spot.hint})`).join("; ")}.`;
const spotChoice = (instructions) => ({ type: "choice", instructions, criteria: Object.fromEntries(spots.map((spot) => [spot.id, `${spot.label}: ${spot.hint}`])) });
const plan = { place: place.id, kind, starts: {}, moves: {}, notes: {}, log: [] };
const centre = centreSpot(grid);
const top = (probabilities) => Object.entries(probabilities ?? {}).sort((first, second) => second[1] - first[1])[0]?.[0];
const scenes = [...new Set(script.beats.map((beat) => beat.sceneId))];
for (const sceneId of scenes) {
  const beats = script.beats.filter((beat) => beat.sceneId === sceneId), opening = beats[0];
  const cast = opening.present.filter((id) => nameOf.has(id));
  if (!cast.length) continue;
  // Known spots only: an assumed start (the centre) is for drawing, not evidence — telling Jev "4F" anchors its answers there.
  const now = new Map(), known = new Set(), chains = new Map();
  // Where each person is when the scene opens — and whether the scene says so at all.
  const starts = await decide(`${where}\nScene: ${opening.text}\nIt begins: ${beats.slice(1, 4).map((beat) => beat.text).join(" / ")}\nPeople in the scene: ${cast.map((id) => nameOf.get(id)).join(", ")}.`,
    Object.fromEntries(cast.flatMap((id) => [
      [`stated_${id}`, { type: "noul", instructions: `Does the scene's opening say or clearly show where in ${script.title} ${nameOf.get(id)} is (which floor, room, door, or outside)? Only being "in the building" is not saying where.` }],
      [`start_${id}`, spotChoice(`Where is ${nameOf.get(id)} when this scene opens? Use the first things the scene says they do or see.`)],
    ])));
  for (const id of cast) {
    const stated = starts[`stated_${id}`]?.noul ?? 0, said = starts[`start_${id}`]?.probabilities ?? {};
    chains.set(id, { start: said, stated, steps: [], beats: [], p: [] });
    // Not said where: the centre of the building, until the chain says otherwise.
    now.set(id, stated >= 0.5 ? top(said) ?? centre : centre);
    if (stated >= 0.5) known.add(id);
  }
  for (const beat of beats.slice(1)) {
    const people = [...new Set([...beat.actors, ...cast])].filter((id) => nameOf.has(id));
    for (const id of people) if (!now.has(id)) { now.set(id, centre); chains.set(id, { start: {}, stated: 0, steps: [], beats: [], p: [] }); }
    const state = `${where}\nScene: ${opening.text}\nWhere people are now: ${people.map((id) => `${nameOf.get(id)} — ${known.has(id) ? spotLabel.get(now.get(id)) : "somewhere in the building (not stated)"}`).join("; ")}.\nThis event: ${beat.text}`;
    // 1. Who changes spot in this event.
    const who = await decide(state, Object.fromEntries(people.map((id) => [`moves_${id}`, { type: "noul", instructions: `In this event, does ${nameOf.get(id)} go to a different spot of the place (walk, run, climb, go down, fall, get dragged or teleport)? Talking, looking, or acting in place is not moving.` }])));
    // Someone the event names moves on an even chance; anyone else (an unnamed "大叔") only when Jev is sure.
    const movers = people.filter((id) => (who[`moves_${id}`]?.noul ?? 0) >= (beat.actors.includes(id) ? 0.5 : 0.8));
    plan.log.push({ beat: beat.id, text: beat.text.slice(0, 60), who: Object.fromEntries(people.map((id) => [nameOf.get(id), Math.round((who[`moves_${id}`]?.noul ?? 0) * 100) / 100])) });
    if (!movers.length) continue;
    // 2. Where they end up, how, and which way.
    const how = await decide(state, Object.fromEntries(movers.flatMap((id) => [
      [`to_${id}`, spotChoice(`Where is ${nameOf.get(id)} at the end of this event?`)],
      [`how_${id}`, { type: "choice", instructions: `How does ${nameOf.get(id)} get there?`, criteria: Object.fromEntries(MANNERS.map((manner) => [manner, manner])) }],
      [`dir_${id}`, { type: "choice", instructions: `Which way does ${nameOf.get(id)} go in this event?`, criteria: Object.fromEntries(DIRECTIONS.map((direction) => [direction, DIRECTION_HINT[direction]])) }],
    ])));
    for (const id of movers) {
      const chain = chains.get(id), to = how[`to_${id}`]?.probabilities ?? {};
      chain.steps.push({ to, how: how[`how_${id}`]?.choice ?? "walk", direction: how[`dir_${id}`]?.probabilities ?? {}, p: who[`moves_${id}`]?.noul ?? 0.5 });
      chain.beats.push(beat.id); chain.p.push(Math.round((who[`moves_${id}`]?.noul ?? 0) * 100) / 100);
      plan.log.at(-1).asked = { ...(plan.log.at(-1).asked ?? {}), [nameOf.get(id)]: { to: Object.entries(to).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([spot, value]) => `${spotLabel.get(spot)} ${value}`).join(", "), how: how[`how_${id}`]?.choice, dir: top(how[`dir_${id}`]?.probabilities) } };
      // Provisional, for the next question's "where people are now": the likeliest spot elsewhere.
      now.set(id, Object.entries(to).filter(([spot]) => !known.has(id) || spot !== now.get(id)).sort((first, second) => second[1] - first[1])[0]?.[0] ?? now.get(id));
      known.add(id);
    }
  }
  // 3. Each person's likeliest chain that physically holds.
  plan.starts[sceneId] = {}; plan.notes[sceneId] = {};
  for (const [id, chain] of chains) {
    const solved = solveChain(grid, chain);
    if (cast.includes(id) || chain.steps.length) plan.starts[sceneId][id] = solved.start;
    plan.notes[sceneId][id] = { stated: Math.round(chain.stated * 100) / 100, assumed: solved.assumed, revised: solved.revised, ...(solved.why ? { why: solved.why } : {}) };
    chain.steps.forEach((step, index) => {
      if (solved.dropped[index]) return;
      const jev = top(step.to), to = solved.spots[index + 1];
      (plan.moves[chain.beats[index]] ??= []).push({ actor: id, to, how: step.how, p: chain.p[index], ...(to !== jev ? { jev, revised: true } : {}) });
    });
    if (chain.steps.length) plan.log.push({ scene: sceneId, person: nameOf.get(id), start: `${spotLabel.get(solved.start)}${solved.assumed ? " (not stated)" : ""}${solved.revised ? ` ↶ revised: ${solved.why}` : ""}`, chain: solved.spots.map((spot, index) => index && solved.dropped[index - 1] ? "(stays)" : `${spotLabel.get(spot)}${index && solved.overruled[index - 1] ? `*` : ""}`).join(" → ") });
  }
}
fs.writeFileSync(outFile, JSON.stringify(plan, null, 2));
console.log(`${label} (${kind}): ${scenes.length} scenes, ${Object.values(plan.moves).flat().length} moves · ${calls} Jev calls, ${Math.round(millis / Math.max(1, calls))} ms each`);
