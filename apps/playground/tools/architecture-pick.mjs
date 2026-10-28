// Prototype: let Jev pick each place's building from pictures of the kinds its
// name shortlists (src/data/placeArchitecture.ts), or "none".
//
//   node apps/playground/tools/architecture-pick.mjs <time-place.json> <candidates dir> <secrets.js of a built CLI> [place label ...]
//
// <time-place.json> is a TimePlaceProjection (places + scenes); <candidates dir>
// holds <kind>.png renders (architecture-gallery.html?kinds=<kind>&columns=1&still&bare).
// One request per place (one picture per shortlisted kind, at most four).
// Image input is a TypeSafe "danger zone" feature (experimental), so picks are
// proposals to record on the place, not facts. Prints JSON lines.
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { architectureCandidates } from "../src/data/placeArchitecture.ts";

const [projectionFile, candidatesDir, secretsModule, ...only] = process.argv.slice(2);
const projection = JSON.parse(fs.readFileSync(projectionFile, "utf8"));
const { resolveJevKey } = await import(pathToFileURL(secretsModule).href);
const key = resolveJevKey()?.key;
if (!key) throw new Error("No Jev key: run `novel jev login` or set TYPESAFE_API_KEY");
const endpoint = process.env.JEV_ENDPOINT || "https://api.typesafe.ai/v1/systemone";
const model = process.env.JEV_MODEL || "jev-1.13.0";

const names = projection.names ?? {};
const sceneLabel = new Map((projection.scenes ?? []).map((scene) => [scene.id, scene.label]));
const picture = (kind) => fs.readFileSync(join(candidatesDir, `${kind}.png`)).toString("base64");

for (const place of projection.places) {
  if (only.length && !only.includes(place.label)) continue;
  const shortlist = architectureCandidates(place.label);
  if (!shortlist.length) { console.log(JSON.stringify({ place: place.label, shortlist, pick: null, reason: "name hints at no building" })); continue; }
  const inside = (place.path ?? []).slice(0, -1).map((id) => names[id] ?? id).join(" › ");
  const scenes = place.sceneIds.slice(0, 3).map((id) => sceneLabel.get(id)).filter(Boolean);
  const description = `A novel names a place "${place.label}"${inside ? `, inside ${inside}` : ""}.${scenes.length ? ` Scenes there: ${scenes.join("; ")}.` : ""}`;
  const letters = shortlist.map((_, index) => `picture_${String.fromCharCode(97 + index)}`);
  const body = {
    model,
    state: { place: description, ...Object.fromEntries(letters.map((letter) => [letter, `${letter}_image`])) },
    assets: Object.fromEntries(shortlist.map((kind, index) => [`${letters[index]}_image`, { type: "image", format: "png", data_base64: picture(kind) }])),
    questions: {
      building: {
        type: "choice",
        instructions: "The pictures are monochrome hologram line drawings of places on a map. Which one best represents the place in `place`: a single building, a site, or a whole district or city? Pick none only when no picture fits at all.",
        // Neutral option names: the pictures, not the words, have to decide.
        criteria: { ...Object.fromEntries(letters.map((letter) => [letter, `the building in \`${letter}\``])), none: "none of the pictures fits this place" },
      },
    },
  };
  const started = Date.now();
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "TypeSafe-Danger-Zone-Images": "true" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  if (!response.ok) { console.log(JSON.stringify({ place: place.label, shortlist, status: response.status, error: text.slice(0, 400) })); continue; }
  const answer = JSON.parse(text).answers?.building ?? {};
  const kindOf = (option) => option === "none" ? "none" : shortlist[letters.indexOf(option)] ?? null;
  const probabilities = answer.probabilities ? Object.fromEntries(Object.entries(answer.probabilities).map(([option, value]) => [kindOf(option), Math.round(value * 1000) / 1000])) : null;
  console.log(JSON.stringify({ place: place.label, shortlist, pick: kindOf(answer.choice), confidence: answer.confidence ?? null, probabilities, ms: Date.now() - started }));
}
