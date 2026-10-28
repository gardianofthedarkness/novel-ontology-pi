// Prototype: let Jev tell a place's movement chain — for each scene, where its
// people start; for each event, who changes spot (a yes/no per person), then
// for those who do, where they end up (a spot of the building's nav grid) and
// how (walk, run, sneak, climb up, go down, fall, teleport, dragged). Each
// event is asked with everyone's current spot, so the moves chain.
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
const { navGrid, MANNERS } = await import(pathToFileURL(`${dist}holoNav.js`).href);
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
const plan = { place: place.id, kind, starts: {}, moves: {}, log: [] };
const scenes = [...new Set(script.beats.map((beat) => beat.sceneId))];
for (const sceneId of scenes) {
  const beats = script.beats.filter((beat) => beat.sceneId === sceneId), opening = beats[0];
  const cast = opening.present.filter((id) => nameOf.has(id));
  if (!cast.length) continue;
  const now = new Map();
  // Where each person is when the scene opens.
  const starts = await decide(`${where}\nScene: ${opening.text}\nIt begins: ${beats.slice(1, 4).map((beat) => beat.text).join(" / ")}\nPeople in the scene: ${cast.map((id) => nameOf.get(id)).join(", ")}.`,
    Object.fromEntries(cast.map((id) => [`start_${id}`, spotChoice(`Where is ${nameOf.get(id)} when this scene opens? Use the first things the scene says they do or see.`)])));
  for (const id of cast) now.set(id, starts[`start_${id}`]?.choice ?? spots[0].id);
  plan.starts[sceneId] = Object.fromEntries(now);
  for (const beat of beats.slice(1)) {
    const people = [...new Set([...beat.actors, ...cast])].filter((id) => nameOf.has(id));
    for (const id of people) if (!now.has(id)) now.set(id, plan.starts[sceneId][id] ?? spots[0].id);
    const state = `${where}\nScene: ${opening.text}\nWhere people are now: ${people.map((id) => `${nameOf.get(id)} — ${spotLabel.get(now.get(id))}`).join("; ")}.\nThis event: ${beat.text}`;
    // 1. Who changes spot in this event.
    const who = await decide(state, Object.fromEntries(people.map((id) => [`moves_${id}`, { type: "noul", instructions: `In this event, does ${nameOf.get(id)} go to a different spot of the place (walk, run, climb, go down, fall, get dragged or teleport)? Talking, looking, or acting in place is not moving.` }])));
    // Someone the event names moves on an even chance; anyone else (an unnamed "大叔") only when Jev is sure.
    const movers = people.filter((id) => (who[`moves_${id}`]?.noul ?? 0) >= (beat.actors.includes(id) ? 0.5 : 0.8));
    plan.log.push({ beat: beat.id, text: beat.text.slice(0, 60), who: Object.fromEntries(people.map((id) => [nameOf.get(id), Math.round((who[`moves_${id}`]?.noul ?? 0) * 100) / 100])) });
    if (!movers.length) continue;
    // 2. Where they end up, and how they get there.
    const how = await decide(state, Object.fromEntries(movers.flatMap((id) => [
      [`to_${id}`, spotChoice(`Where is ${nameOf.get(id)} at the end of this event?`)],
      [`how_${id}`, { type: "choice", instructions: `How does ${nameOf.get(id)} get there?`, criteria: Object.fromEntries(MANNERS.map((manner) => [manner, manner])) }],
    ])));
    // Someone who moves ends up somewhere else: the likeliest spot other than where they stand.
    const elsewhere = (id) => Object.entries(how[`to_${id}`]?.probabilities ?? {}).filter(([spot]) => spot !== now.get(id)).sort((first, second) => second[1] - first[1])[0]?.[0];
    plan.moves[beat.id] = movers.map((id) => ({ actor: id, to: how[`to_${id}`]?.choice !== now.get(id) ? how[`to_${id}`]?.choice : elsewhere(id), how: how[`how_${id}`]?.choice ?? "walk", p: Math.round((who[`moves_${id}`]?.noul ?? 0) * 100) / 100 }))
      .filter((move) => move.to && move.to !== now.get(move.actor));
    for (const move of plan.moves[beat.id]) now.set(move.actor, move.to);
    plan.log.at(-1).moves = plan.moves[beat.id].map((move) => `${nameOf.get(move.actor)}: ${spotLabel.get(move.to)} (${move.how})`);
  }
}
fs.writeFileSync(outFile, JSON.stringify(plan, null, 2));
console.log(`${label} (${kind}): ${scenes.length} scenes, ${Object.values(plan.moves).flat().length} moves · ${calls} Jev calls, ${Math.round(millis / Math.max(1, calls))} ms each`);
