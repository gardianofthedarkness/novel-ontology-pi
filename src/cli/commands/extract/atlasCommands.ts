import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { universeBindings } from "../../../solidifier/causality/universe.js";
import { atlasContext, atlasSweep, atlasView } from "../../../solidifier/atlas/universeAtlas.js";

export const ATLAS_USAGE = "novel atlas sweep <library-dir> <universe-id> [--propose] [--no-jev] [--max-questions N] | novel atlas show <library-dir> <universe-id>";

/**
 * `novel atlas sweep|show` — the universe atlas (time-place phase 3).
 * `sweep` nominates place pairs across the universe's books, lets Jev judge
 * same place / inside / neither, and with --propose saves a pending `ua_`
 * packet for `novel review ... --scope universe --universe <id>`. `show`
 * prints the universe places: one per cluster of books, with its path.
 */
export async function atlasCommand(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  const [operation, directory, universeId, ...rest] = args;
  if (!["sweep", "show"].includes(operation) || !directory || !universeId || universeId.startsWith("--")) throw new Error(`Usage: ${ATLAS_USAGE}`);
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index];
    const allowed = operation === "sweep" ? ["--propose", "--no-jev", "--max-questions"] : [];
    if (!allowed.includes(name) || flags.has(name)) throw new Error(`Usage: ${ATLAS_USAGE}`);
    if (name === "--max-questions") { const value = rest[++index]; if (!/^\d+$/.test(value ?? "") || Number(value) < 1 || Number(value) > 200) throw new Error("--max-questions must be 1..200."); flags.set(name, value); }
    else flags.set(name, true);
  }
  const config = await universeBindings(env);
  if (operation === "show") {
    const view = await atlasView(directory, universeId, config);
    const label = new Map<string, string>();
    const context = await atlasContext(directory, universeId, config);
    for (const place of context.places) label.set(place.qualified, place.label);
    const parent = new Map(view.places.map((place) => [place.id, place.parent]));
    const path = (id: string) => { const steps: string[] = []; const seen = new Set<string>(); for (let at: string | null | undefined = id; at && !seen.has(at); at = parent.get(at)) { seen.add(at); steps.unshift(label.get(at) ?? at); } return steps.join(" › "); };
    return {
      universe: view.title, books: view.books.map((book) => `${book.readingOrder ?? "?"}. ${book.title}${book.processed ? "" : " (no database)"} [${book.continuityId ?? "no continuity"}]`),
      places: view.places.filter((place) => place.members.length > 1 || place.parent).map((place) => `${path(place.id)} ×${place.members.length} book place(s)${place.proposed || place.parentProposed ? " (proposed)" : ""}`),
      conflicts: view.conflicts,
    };
  }
  const context = await atlasContext(directory, universeId, config);
  const result = await atlasSweep(context, { decisions: flags.has("--no-jev") ? undefined : jevFromEnv(env), maxQuestions: flags.has("--max-questions") ? Number(flags.get("--max-questions")) : undefined, propose: flags.has("--propose") });
  const label = (qualified: string) => { const place = context.byQualified.get(qualified); return `${place?.label ?? qualified} (${context.books.find((book) => book.sourceId === place?.sourceId)?.title ?? "?"})`; };
  return {
    universe: context.title, candidates: result.candidates, asked: result.asked, packetId: result.packetId,
    proposals: result.proposals.map((proposal) => `${label(proposal.a)} ${proposal.kind === "same_place" ? "=" : "⊂"} ${label(proposal.b)} (${proposal.confidence.toFixed(2)}, ${proposal.method})`),
    notes: result.notes, usage: { decisionQuestions: result.asked },
  };
}
