/**
 * The director's questions (docs/v2/director-camera.md §2; the user's design, 2026-11-02): for one person in one action
 * card, which way they go (the fourteen lettered arrows, stays, or with someone), then where (a spot inside the chosen
 * arrow's wedge, or none of these), and only when no spot fits, a rough box on a plan, then the exact box and its height.
 * The text is the card's own lines as written, the lines before it, the scene's lines that name the mover or say where,
 * its description lines, and where everyone stands now; every line keeps its sentence id, and the direction's answer says
 * which line it rests on. Pictures come with the request (the camera operator's shots, src/v2/context/camera.ts).
 */
import type { DecisionQuestion } from "../../ground/connectors/jev.js";
import type { Item, Mode, Source } from "./engine.js";

export interface Line { id: string; text: string }
export interface MoveFocus {
  scene: { id: string; place: string; when: string | null };
  /** The card being played: its own sentences, as written. */
  card: { id: string; lines: Line[] };
  mover: { id: string; name: string };
  /** The scene's other lines Jev reads (before the card, naming the mover, saying where, describing the place). */
  lines: Line[];
  /** Where everyone in the scene stands now, in words. */
  now: Record<string, string>;
  /** What each picture shows. */
  pictures: Record<string, string>;
}
export interface DirectionFocus extends MoveFocus {
  /** Each arrow: its letter, and what it points at (the first thing it meets). */
  arrows: { letter: string; said: string }[];
  /** The others present, for "goes with". */
  others: { id: string; name: string }[];
}
export interface SpotFocus extends MoveFocus { direction: string; spots: { letter: string; said: string }[] }
export interface HeightFocus extends MoveFocus { direction: string; slices: { letter: string; said: string }[] }

/** How a move goes: its reach comes from it (camera.ts REACH). */
export const WAYS = ["step", "walk", "run", "leap", "flight"] as const;

const fixed = <F>(name: string, of: (focus: F) => Record<string, unknown>): Source<F, unknown> => ({ name, key: name, quota: 0, keep: true, collect: (focus) => Object.entries(of(focus)).map(([id, fields]): Item => ({ id, score: 1, fields })) });
const text = <F extends MoveFocus>(): Source<F, unknown>[] => [
  fixed<F>("card", (focus) => Object.fromEntries(focus.card.lines.map((line) => [line.id, line.text]))),
  // The scene's other lines: ranked as given (nearest the card first), cut first when over budget.
  { name: "scene", key: "scene", quota: 40, ranked: true, collect: (focus) => focus.lines.map((line, n): Item => ({ id: line.id, score: 1 - n / 1000, fields: line.text })) },
  fixed<F>("now", (focus) => focus.now),
  fixed<F>("pictures", (focus) => focus.pictures),
];
const lead = (focus: MoveFocus) => `In scene ${Number(focus.scene.id.slice(-3)) || focus.scene.id} (${focus.scene.place}${focus.scene.when ? `, ${focus.scene.when}` : ""}), the card's lines (card) are being played. ${focus.mover.name} is the person asked about.`;

/**
 * First, from the text alone (no picture): does the person go somewhere else in this card, or act where they are? The
 * arrows are asked only of those who go (the first run, 2026-11-02: asked straight away on the arrows, Jev answered
 * "stays" 45 times in 50, walks through streets among them).
 */
export const moveWhetherMode: Mode<MoveFocus, unknown> = {
  name: "move-whether",
  task: (focus) => `${lead(focus)} In this card, does ${focus.mover.name} go somewhere else (walk, run, come, leave, follow, jump, climb, fly, get carried), or act where they already are (speak, look, think, pick up, hold, hit someone beside them)?`,
  sources: text<MoveFocus>().filter((source) => source.name !== "pictures"),
  cutOrder: ["scene"],
  questions: (focus) => [
    { key: "moves", primitive: "choice", instructions: `Does ${focus.mover.name} go somewhere else in this card?`, options: ["goes", "stays"], optionHints: { goes: "changes place: walks, runs, comes, leaves, follows, jumps, climbs, flies, is carried", stays: "acts where they already are" } },
    { key: "line", primitive: "choice", instructions: "Which line says so?", options: [...focus.card.lines, ...focus.lines].map((line) => line.id) },
    { key: "breaks", primitive: "choice", instructions: "Does this card break, blast or wreck something (a wall, a building, the ground, a car)?", options: ["yes", "no"], optionHints: { yes: "something is broken, blasted or wrecked in this card", no: "nothing is broken" } },
  ] as DecisionQuestion[],
  budget: 12000,
};

export const moveDirectionMode: Mode<DirectionFocus, unknown> = {
  name: "move-direction",
  task: (focus) => `${lead(focus)} ${focus.mover.name} goes somewhere else in this card. Which way, as the picture "arrows" shows it: one of the lettered arrows out of them (each said by what it points at), or with someone? And how, and which line says so.`,
  sources: [...text<DirectionFocus>(), fixed<DirectionFocus>("arrows", (focus) => Object.fromEntries(focus.arrows.map((arrow) => [arrow.letter, arrow.said])))],
  cutOrder: ["scene"],
  questions: (focus) => {
    const options = [...focus.arrows.map((arrow) => arrow.letter), ...focus.others.map((other) => `with:${other.id}`)];
    const hints = Object.fromEntries([...focus.arrows.map((arrow) => [arrow.letter, `arrow ${arrow.letter}: ${arrow.said}`]), ...focus.others.map((other) => [`with:${other.id}`, `goes with ${other.name}, to where they go`])]);
    const lines = [...focus.card.lines, ...focus.lines].map((line) => line.id);
    return [
      { key: "direction", primitive: "choice", instructions: `Which way does ${focus.mover.name} go?`, options, optionHints: hints },
      { key: "how", primitive: "choice", instructions: `How do they go (a step, a walk, a run, a leap, a flight)?`, options: [...WAYS], optionHints: { step: "a step or two", walk: "walking", run: "running", leap: "a jump or leap, a climb", flight: "flying, carried through the air by a power" } },
      { key: "line", primitive: "choice", instructions: "Which line says where they go (or that they stay)?", options: lines },
    ] as DecisionQuestion[];
  },
  budget: 12000,
};

export const moveSpotMode: Mode<SpotFocus, unknown> = {
  name: "move-spot",
  task: (focus) => `${lead(focus)} They go ${focus.direction}, the shaded wedge on picture "wedge". Where do they end up in this card: one of the spots (spots), or none of these when the text puts them somewhere the spots do not name?`,
  sources: [...text<SpotFocus>(), fixed<SpotFocus>("spots", (focus) => Object.fromEntries(focus.spots.map((spot) => [spot.letter, spot.said])))],
  cutOrder: ["scene"],
  questions: (focus) => [{ key: "spot", primitive: "choice", instructions: `Where does ${focus.mover.name} end up?`, options: [...focus.spots.map((spot) => spot.letter), "none"], optionHints: Object.fromEntries([...focus.spots.map((spot) => [spot.letter, `${spot.letter}: ${spot.said}`]), ["none", "none of these spots"]]) }] as DecisionQuestion[],
  budget: 12000,
};

export const moveRoughMode: Mode<MoveFocus & { direction: string }, unknown> = {
  name: "move-rough",
  task: (focus) => `${lead(focus)} They go ${focus.direction}. Box roughly where they end up on picture "plan" (straight down, north up, a metre grid; the arrow and its wedge drawn).`,
  sources: text<MoveFocus & { direction: string }>(),
  cutOrder: ["scene"],
  questions: (focus) => [{ key: "box", primitive: "box", instructions: `Box roughly where ${focus.mover.name} ends up on picture "plan".` }] as DecisionQuestion[],
  budget: 12000,
};

export const moveExactMode: Mode<HeightFocus, unknown> = {
  name: "move-exact",
  task: (focus) => `${lead(focus)} They go ${focus.direction}, about where the rough box was. Picture "plan" is that place close up, straight down, a grid of one metre; picture "heights" is its column from the side, its heights lettered (heights). Box exactly where they end up on "plan", and say at which height.`,
  sources: [...text<HeightFocus>(), fixed<HeightFocus>("heights", (focus) => Object.fromEntries(focus.slices.map((slice) => [slice.letter, slice.said])))],
  cutOrder: ["scene"],
  questions: (focus) => [
    { key: "box", primitive: "box", instructions: `Box exactly where ${focus.mover.name} ends up on picture "plan".` },
    { key: "height", primitive: "choice", instructions: "At which height?", options: focus.slices.map((slice) => slice.letter), optionHints: Object.fromEntries(focus.slices.map((slice) => [slice.letter, `${slice.letter}: ${slice.said}`])) },
  ] as DecisionQuestion[],
  budget: 12000,
};

/**
 * The director's pass (docs/v2/director-camera.md §7a; the user, 2026-11-02: a mini Jev call, not a word list): which
 * narration and description sentences the animation should show. Each sentence is asked on its own with only the line
 * either side and the people present: does someone change place in it, do something visible where they are, or is there
 * nothing to show; and who. Batched by scene. The reading's sentence kinds stay as they are: a sentence the pass says moves
 * someone is played as an action card, its mover the one it names.
 */
export interface PassFocus {
  scene: { id: string; place: string };
  people: { id: string; name: string }[];
  batch: { id: string; before: string; text: string; after: string }[];
}
export const SHOWS = { moves: "someone who matters changes place in it: walks, runs, arrives, comes in, goes out, leaves, climbs, jumps, flies, is carried", acts: "someone who matters does something visible where they are: falls, hits, grabs, hides, turns, sits down", none: "nothing to show: a feeling, a thought, commentary, how someone looks, the background, something only planned, imagined, said or remembered, a figure of speech" } as const;
export const directorPassMode: Mode<PassFocus, unknown> = {
  name: "director-pass",
  task: (focus) => `Sentences of a novel's scene (${focus.scene.place}), each with the line before and after it (sentences). For each sentence's own text (the lines before and after are only there to tell who and what it means; what they say is not this sentence's), should an animation of the scene show it, and who does it (people: those present)?`,
  definitions: () => ({ shows: { ...SHOWS } }),
  sources: [
    fixed<PassFocus>("people", (focus) => Object.fromEntries(focus.people.map((person) => [person.id, person.name]))),
    fixed<PassFocus>("sentences", (focus) => Object.fromEntries(focus.batch.map((entry) => [entry.id, { before: entry.before, text: entry.text, after: entry.after }]))),
  ],
  cutOrder: [],
  questions: (focus) => focus.batch.flatMap((entry) => [
    { key: `${entry.id}|show`, primitive: "choice", instructions: `What does an animation show of sentences.${entry.id}.text? (shows)`, options: Object.keys(SHOWS), optionHints: { moves: "someone changes place", acts: "someone does something visible in place", none: "nothing to show" } },
    { key: `${entry.id}|who`, primitive: "choice", instructions: `Who does it in sentences.${entry.id}.text (the one it names, or means when it leaves them out)?`, options: [...focus.people.map((person) => person.id), "all", "none"], optionHints: Object.fromEntries([...focus.people.map((person) => [person.id, person.name]), ["all", "they: everyone present"], ["none", "no one present who matters"]]) },
  ]) as DecisionQuestion[],
  budget: 14000,
};

/**
 * Does a scene go straight on from the one before (the user, 2026-11-02: people jumped between scenes that tell one
 * continuous story)? Asked from the text alone: the end of the scene before and the start of this one, and who is in each.
 * Yes: everyone in both carries on from where they ended; no: the scene's own starts (spawning's).
 */
export interface GoesOnFocus { before: { id: string; place: string; lines: Line[]; people: string[] }; now: { id: string; place: string; lines: Line[]; people: string[] } }
export const sceneGoesOnMode: Mode<GoesOnFocus, unknown> = {
  name: "scene-goes-on",
  task: (focus) => `Two scenes of a novel, one after the other: the end of the first (before, set in ${focus.before.place}) and the start of the next (now, set in ${focus.now.place}). Does the next scene go straight on from the first, the same moment carrying on with the people where they were (the narration may only have turned to someone else there), or is it a jump to another time or place?`,
  sources: [
    fixed<GoesOnFocus>("before", (focus) => ({ people: focus.before.people.join(", "), ...Object.fromEntries(focus.before.lines.map((line) => [line.id, line.text])) })),
    fixed<GoesOnFocus>("now", (focus) => ({ people: focus.now.people.join(", "), ...Object.fromEntries(focus.now.lines.map((line) => [line.id, line.text])) })),
  ],
  cutOrder: [],
  questions: () => [{ key: "goes_on", primitive: "choice", instructions: "Does the next scene go straight on from the first?", options: ["yes", "no"], optionHints: { yes: "the same moment carries on: the people go on from where they were", no: "a jump: another time, another place, or other people" } }] as DecisionQuestion[],
  budget: 8000,
};
