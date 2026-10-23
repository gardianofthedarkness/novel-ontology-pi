import type {
  DecisionAnswer,
  DecisionQuestion,
} from "../connectors/jev.js";
import type { Sentence } from "../text/sectioning.js";

/**
 * Span segmentation (sectors 02/03, owner's design 2026-10-22).
 *
 * The decision model does not classify every sentence ("does a scene
 * begin here?" fragments scenes — the old per-sentence design produced
 * a median scene size of ONE sentence on real text). It POINTS at
 * boundaries instead. Scenes: Jev chooses where each scene STARTS over
 * long batches (80 sentences, 20 look-back); a scene's end is defined
 * by the next chosen start, so scenes tile the block exactly (scene
 * i+1 starts at scene i's end + 1 by construction). An end-pick is
 * still asked per scene — as a cross-check and as the provisional end
 * a batch-seam query can ratify: when a scene is open at a seam, ONE
 * query shown its tail text decides whether it continues into the new
 * batch or already ended. (Measured reason ends are not authoritative:
 * asked for the end of a scene whose start was imposed, Jev picks the
 * batch's last sentence at 0.95 confidence and the block collapses
 * into one scene; asked to choose starts, it finds the real joints.)
 *
 * Dialogue exchanges use start+end selection (they do not tile: most
 * of a novel is not dialogue). Spans from overlapping batches that
 * overlap by >= 3 sentences are the same exchange and merge; smaller
 * overlaps trim. Each exchange links to the ONE scene it sits in, or
 * the TWO scenes it straddles when a conversation crosses a scene cut.
 */

export type DecideFn = (
  state: string,
  questions: DecisionQuestion[],
) => Promise<DecisionAnswer[]>;

export interface SegmentationGates {
  accept: number;
  reask: number;
}

export interface SpanEscalation {
  unitId: string;
  reason: string;
}

const BATCH = 80;
const LOOKBACK = 20;
const STEP = 60;
const SEAM_TAIL = 12;

const render = (sentences: Sentence[]): string =>
  sentences.map((s) => `${s.id}: ${s.text}`).join("\n");

function choiceValue(
  answers: DecisionAnswer[],
  key: string,
): DecisionAnswer | undefined {
  return answers.find((a) => a.key === key);
}

/**
 * Tile the block into scenes. Returns spans as sentence-id arrays that
 * partition the block exactly: every sentence in exactly one scene, in
 * order.
 *
 * Authority (measured 2026-10-22, see the experiment report): Jev
 * DETECTS boundaries when it chooses where a scene STARTS; asked for
 * the end of a scene whose start was imposed on it, it punts to the
 * batch end at 0.95 confidence and the whole block collapses into one
 * scene. So boundaries are start-driven, and the owner's tiling rule
 * holds identically: scene i+1 starts exactly at scene i's end + 1,
 * because scene i's end is DEFINED by the next chosen start. The
 * end-pick is still asked for every scene — it is the cross-check
 * (a chosen start far past the provisional end flags a possible
 * missed boundary) and the seam's provisional end (an "ended" seam
 * ratifies it as the real end, and the next scene opens at end + 1).
 *
 * There is always exactly one open scene. It opens at the tiling
 * cursor (0, or the previous scene's end + 1). Per batch, Jev picks
 * scene starts inside the batch's forward region; at each batch seam,
 * one continuation query with the open scene's tail text injected
 * decides whether it flows into the new batch or already ended.
 */
export async function tileScenes(
  sentences: Sentence[],
  decide: DecideFn,
  opts: {
    stateSummary: string;
    gates: SegmentationGates;
    onSpan?: (spans: string[][]) => Promise<void>;
  },
): Promise<{
  spans: string[][];
  escalations: SpanEscalation[];
  unitConfidences: Record<string, number>;
}> {
  const escalations: SpanEscalation[] = [];
  const unitConfidences: Record<string, number> = {};
  const n = sentences.length;
  const closed: [number, number][] = [];
  if (n === 0) return { spans: [], escalations, unitConfidences };

  const spansNow = (): string[][] =>
    closed.map(([a, b]) => sentences.slice(a, b + 1).map((s) => s.id));
  const idxOf = new Map(sentences.map((s, i) => [s.id, i]));

  // The one open scene: its tiling start, and the provisional end Jev
  // picked for it (advisory until a seam ratifies it).
  let cur: { start: number; end: number | null } = { start: 0, end: null };

  const askEnd = async (regionEnd: number): Promise<void> => {
    const startId = sentences[cur.start].id;
    const key = `scene_end:${startId}`;
    const from = Math.max(cur.start, regionEnd - BATCH);
    const options = sentences.slice(from, regionEnd).map((s) => s.id);
    if (options.length === 0) return;
    const context = sentences.slice(Math.max(0, from - LOOKBACK), regionEnd);
    const answers = await decide(
      `${opts.stateSummary}\n---\n${render(context)}`,
      [
        {
          key,
          primitive: "choice",
          instructions: `A scene begins at sentence ${startId}: one continuous place, time and viewpoint. Which sentence id is the LAST sentence of this scene? If the scene continues past the last numbered sentence (${options[options.length - 1]}), pick that last sentence.`,
          options,
        },
      ],
    );
    const a = choiceValue(answers, key);
    const conf = a?.confidence ?? 0;
    unitConfidences[startId] = conf;
    if (conf < opts.gates.reask) {
      escalations.push({
        unitId: startId,
        reason: `scene end decision too uncertain (${conf.toFixed(2)})`,
      });
    }
    const picked = typeof a?.value === "string" ? idxOf.get(a.value) : undefined;
    cur.end = picked !== undefined && picked >= cur.start ? picked : regionEnd - 1;
  };

  for (let batchStart = 0; batchStart < n; batchStart += STEP) {
    const regionEnd = Math.min(n, batchStart + BATCH);

    if (batchStart > 0) {
      // Seam: ONE continuation query for the open scene, with its
      // tail text from the previous batch injected.
      const tailFrom = Math.max(cur.start, batchStart - SEAM_TAIL);
      const tail = sentences.slice(tailFrom, batchStart);
      const head = sentences.slice(batchStart, batchStart + SEAM_TAIL);
      const key = `scene_seam:${sentences[batchStart].id}`;
      const answers = await decide(
        `${opts.stateSummary}\nPREVIOUS SCENE (began at ${sentences[cur.start].id}, still open) — its most recent sentences:\n${render(tail)}\n---\nFOLLOWING PASSAGE:\n${render(head)}`,
        [
          {
            key,
            primitive: "choice",
            instructions:
              "The previous scene's most recent sentences are shown first, then the passage that follows them. Does the previous scene CONTINUE into the following passage (same place, time and viewpoint flowing on), or did it END before the passage begins?",
            options: ["continues", "ended"],
          },
        ],
      );
      const a = choiceValue(answers, key);
      const conf = a?.confidence ?? 0;
      unitConfidences[key] = conf;
      if (conf < opts.gates.reask) {
        escalations.push({
          unitId: sentences[batchStart].id,
          reason: `scene seam decision too uncertain (${conf.toFixed(2)}); defaulted to "continues"`,
        });
      }
      if (a?.value === "ended") {
        const end = Math.min(cur.end ?? batchStart - 1, batchStart - 1);
        closed.push([cur.start, Math.max(end, cur.start)]);
        await opts.onSpan?.(spansNow());
        // Tiling: the next scene opens at the ratified end + 1, even
        // though its salient start may be pointed at later.
        cur = { start: closed[closed.length - 1][1] + 1, end: null };
        if (cur.start < regionEnd) await askEnd(regionEnd);
      }
    } else {
      await askEnd(regionEnd);
    }

    // Start detection over the forward region: each chosen start
    // closes the open scene at start - 1 and opens the next there.
    const context = sentences.slice(
      Math.max(0, batchStart - LOOKBACK),
      regionEnd,
    );
    const state = `${opts.stateSummary}\n---\n${render(context)}`;
    let local = batchStart;
    for (let iter = 0; iter < 12 && local < regionEnd; iter++) {
      const anchorId = sentences[local].id;
      const key = `scene_start:${anchorId}`;
      const options = [
        ...sentences.slice(local, regionEnd).map((s) => s.id),
        "NONE",
      ];
      const answers = await decide(state, [
        {
          key,
          primitive: "choice",
          instructions: `A new scene begins where the place changes, time skips, or the viewpoint shifts. Which sentence id BEGINS the next scene at or after ${anchorId}? Pick the first sentence of the next scene, or NONE if no new scene begins in the rest of this passage.`,
          options,
        },
      ]);
      const a = choiceValue(answers, key);
      const conf = a?.confidence ?? 0;
      if (conf < opts.gates.reask) {
        escalations.push({
          unitId: anchorId,
          reason: `scene start decision too uncertain (${conf.toFixed(2)})`,
        });
      }
      if (!a || a.value === "NONE" || a.value === "") break;
      const s = typeof a.value === "string" ? idxOf.get(a.value) : undefined;
      if (s === undefined || s < local) break;
      if (s <= cur.start) {
        // Pointed at the open scene's own start: not a new boundary.
        local = s + 1;
        continue;
      }
      if (cur.end !== null && s - 1 - cur.end > 10) {
        escalations.push({
          unitId: sentences[cur.end + 1].id,
          reason: `possible missed boundary between the provisional end ${sentences[cur.end].id} and the next chosen start ${sentences[s].id}`,
        });
      }
      closed.push([cur.start, s - 1]);
      await opts.onSpan?.(spansNow());
      cur = { start: s, end: null };
      await askEnd(regionEnd);
      local = (cur.end ?? s) + 1;
    }
  }
  closed.push([cur.start, n - 1]);

  return { spans: spansNow(), escalations, unitConfidences };
}

/**
 * Select dialogue exchanges over the block and link each to the scene
 * (or two scenes, when it straddles a cut) it belongs to. Units are
 * sentence-id arrays; unitScenes[i] holds the scene-span indices for
 * units[i], one or two entries.
 */
export async function selectExchangeSpans(
  sentences: Sentence[],
  decide: DecideFn,
  opts: { stateSummary: string; gates: SegmentationGates; onBatch?: (spans: [number, number][], completeThrough: number) => Promise<void> },
): Promise<{
  spans: [number, number][];
  escalations: SpanEscalation[];
  unitConfidences: Record<string, number>;
}> {
  const escalations: SpanEscalation[] = [];
  const unitConfidences: Record<string, number> = {};
  const n = sentences.length;
  const raw: [number, number][] = [];

  for (let b = 0; b < n; b += STEP) {
    const region = sentences.slice(b, Math.min(n, b + BATCH));
    if (region.length === 0) break;
    const state = `${opts.stateSummary}\n---\n${render(region)}`;
    let local = 0;
    for (let iter = 0; iter < 12 && local < region.length; iter++) {
      const firstId = region[local].id;
      const startKey = `dlg_start:${firstId}`;
      const startOpts = [...region.slice(local).map((s) => s.id), "NONE"];
      const sa = choiceValue(
        await decide(state, [
          {
            key: startKey,
            primitive: "choice",
            instructions: `Select dialogue at sentence level: one short continuous run of actual speech. One or two brief narration or action sentences BETWEEN spoken sentences may remain inside the run. Three or more consecutive non-verbal sentences break the run: speech resuming after that gap starts another dialogue unit/turn, even with the same speakers in the same scene. Do not include a long descriptive passage merely to connect two spoken lines. Thoughts, quoted labels and descriptions are not spoken dialogue. Which sentence id BEGINS the next dialogue exchange at or after ${firstId}? Pick its first spoken sentence, including speech resuming after a long narration gap, or NONE if no speech begins in the rest of this passage.`,
            options: startOpts,
          },
        ]),
        startKey,
      );
      if (!sa || sa.value === "NONE" || sa.value === "") {
        if ((sa?.confidence ?? 0) < opts.gates.reask) escalations.push({ unitId: firstId, reason: "dialogue absence decision too uncertain" });
        break;
      }
      const sLocal = region.findIndex((s) => s.id === sa.value);
      if (sLocal < local) break;
      const confS = sa.confidence ?? 0;
      unitConfidences[region[sLocal].id] = confS;
      if (confS < opts.gates.reask) {
        escalations.push({
          unitId: region[sLocal].id,
          reason: `dialogue exchange start too uncertain (${confS.toFixed(2)})`,
        });
      }
      const endKey = `dlg_end:${region[sLocal].id}`;
      const endOpts = region.slice(sLocal).map((s) => s.id);
      const ea = choiceValue(
        await decide(state, [
          {
            key: endKey,
            primitive: "choice",
            instructions: `The sentence-level dialogue run beginning at ${region[sLocal].id} may include one or two brief non-verbal sentences only when speech resumes immediately afterward. End the run BEFORE any gap of three or more consecutive narration, action or description sentences, even if the same speakers resume in the same scene; that resumed speech starts another dialogue unit/turn. Also end when the conversation stops or the participants change entirely. Choose the LAST spoken sentence before the break, not the scene's end or the narration after speech. Which sentence id is the LAST sentence belonging to this exchange? Pick only an id from ${region[sLocal].id} to ${endOpts[endOpts.length - 1]}.`,
            options: endOpts,
          },
        ]),
        endKey,
      );
      let eLocal = region.findIndex((s) => s.id === ea?.value);
      if (eLocal < sLocal) eLocal = sLocal;
      const confE = ea?.confidence ?? 0;
      if (confE < opts.gates.reask) {
        escalations.push({
          unitId: region[sLocal].id,
          reason: `dialogue exchange end too uncertain (${confE.toFixed(2)})`,
        });
      }
      raw.push([b + sLocal, b + eLocal]);
      local = eLocal + 1;
    }
    const merged = stitchDialogueSpans(raw);
    const nextStart = b + BATCH >= n ? n : b + STEP;
    const crossing = merged.find(([start, end]) => start < nextStart && end >= nextStart);
    const through = crossing ? crossing[0] - 1 : nextStart - 1;
    await opts.onBatch?.(merged.filter(([, end]) => end <= through), through);
    if (b + BATCH >= n) break;
  }

  return { spans: stitchDialogueSpans(raw), escalations, unitConfidences };
}

function stitchDialogueSpans(raw: [number, number][]): [number, number][] {
  const sorted = raw.map(([start, end]): [number, number] => [start, end]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: [number, number][] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) {
      const overlap = last[1] - span[0] + 1;
      if (overlap >= 3) {
        if (span[1] > last[1]) last[1] = span[1];
        continue;
      }
      span[0] = last[1] + 1;
      if (span[0] > span[1]) continue;
    }
    merged.push([...span]);
  }

  return merged;
}

/**
 * Link exchange spans (index ranges) to the scene partition: the
 * scene holding the exchange's first sentence, plus the one holding
 * its last when they differ (the straddle case). Pure join — runs
 * after the scene and dialogue pipelines complete, in any order.
 */
export function linkExchangeScenes(
  sentences: Sentence[],
  spans: [number, number][],
  sceneSpans: string[][],
): number[][] {
  const idxById = new Map(sentences.map((s, i) => [s.id, i]));
  const sceneOf = new Array<number>(sentences.length).fill(-1);
  sceneSpans.forEach((span, si) => {
    for (const id of span) {
      const idx = idxById.get(id);
      if (idx !== undefined) sceneOf[idx] = si;
    }
  });
  return spans.map(([a, b]) => {
    const first = sceneOf[a];
    const lastS = sceneOf[b];
    const links = [first];
    if (lastS !== first && lastS >= 0) links.push(lastS);
    return links.filter((x) => x >= 0);
  });
}

/**
 * Select dialogue exchanges over the block and link each to the scene
 * (or two scenes, when it straddles a cut) it belongs to. Units are
 * sentence-id arrays; unitScenes[i] holds the scene-span indices for
 * units[i], one or two entries.
 */
export async function selectExchanges(
  sentences: Sentence[],
  sceneSpans: string[][],
  decide: DecideFn,
  opts: { stateSummary: string; gates: SegmentationGates },
): Promise<{
  units: string[][];
  unitScenes: number[][];
  escalations: SpanEscalation[];
  unitConfidences: Record<string, number>;
}> {
  const { spans, escalations, unitConfidences } = await selectExchangeSpans(
    sentences,
    decide,
    opts,
  );
  return {
    units: spans.map(([a, b]) => sentences.slice(a, b + 1).map((s) => s.id)),
    unitScenes: linkExchangeScenes(sentences, spans, sceneSpans),
    escalations,
    unitConfidences,
  };
}
