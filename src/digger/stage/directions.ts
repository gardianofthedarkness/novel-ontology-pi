import type { DecisionQuestion } from "../../ground/connectors/jev.js";

/**
 * The direction a person sets off in, as Jev is asked it over the rendered
 * view (arrows drawn at the person): the 14 directions of the cube (6 axial,
 * 8 diagonal; the 4 rising diagonals launch them into the air, under
 * gravity), 4 "direct" ones for people with powers (straight to where they
 * are going, ignoring gravity and walls), going with someone already handled
 * in this event, or not moving. Directions are relative to the view: right,
 * left, toward the viewer, away, up, down.
 */
const AXES = { right: [1, 0, 0], left: [-1, 0, 0], toward: [0, 1, 0], away: [0, -1, 0], up: [0, 0, 1], down: [0, 0, -1] } as const;
const DIAGONALS = [["right", "toward"], ["right", "away"], ["left", "toward"], ["left", "away"]] as const;
export const DIRECTION_OPTIONS = [
  ...Object.keys(AXES),
  ...DIAGONALS.map(([side, depth]) => `up-${side}-${depth}`),
  ...DIAGONALS.map(([side, depth]) => `down-${side}-${depth}`),
  ...DIAGONALS.map(([side, depth]) => `direct-${side}-${depth}`),
];
export const DIRECTION_VECTORS: Record<string, [number, number, number]> = Object.fromEntries([
  ...Object.entries(AXES),
  ...DIAGONALS.flatMap(([side, depth]) => (["up", "down", "direct"] as const).map((rise) => [`${rise}-${side}-${depth}`, [AXES[side][0], AXES[depth][1], rise === "down" ? -1 : 1]])),
]);
export const isDirect = (option: string) => option.startsWith("direct-");

/** The direction question for one person in one event; `handled` are the people already asked in it, whom they may go with. */
export function directionQuestion(key: string, person: string, handled: string[]): DecisionQuestion {
  const withOthers = handled.map((name) => `with:${name}`);
  return {
    key, primitive: "choice", options: [...DIRECTION_OPTIONS, ...withOthers, "none"],
    instructions: [
      `Which way does ${person} set off in this event, as seen in the picture (right, left, toward the viewer, away from it, up, down)?`,
      "Axial and diagonal directions are moves on foot; an up-diagonal is a jump or leap that flies under gravity, a down-diagonal a drop or a descent.",
      `Choose a direct-* direction only when the text directly says or shows that ${person} uses a superhuman ability for this move (flying, teleporting, being launched by their power). Without that evidence in the text, never choose direct-*.`,
      withOthers.length ? `Choose with:<name> when ${person} moves together with someone already placed in this event.` : "",
      "Choose none when they do not move.",
    ].filter(Boolean).join(" "),
  };
}
