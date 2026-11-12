import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The place tree by the agent, with evidence (engine/places/place-tree.mjs; docs/v3/design.html#place-tree-agent): the
 * main agent looks at the reading's place tree and its units' places, decides each with a line of the book, and code
 * refuses any claim the text does not show. Loaded from the repository this CLI runs from.
 */
interface PlaceTreeModule { run(argv: string[]): Promise<unknown> }
async function repository(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = await readFile(join(directory, "package.json"), "utf8").then((text) => JSON.parse(text) as { name?: string }, () => null);
    // The repository, or Novel Console's bundled backend.
    if (pkg?.name === "novel-ontology-pi" || pkg?.name === "novel-console-backend") return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error("The world engine is not installed beside this CLI (engine/places/place-tree.mjs).");
    directory = parent;
  }
}
const placeTree = async () => import(pathToFileURL(join(await repository(), "engine", "places", "place-tree.mjs")).href) as Promise<PlaceTreeModule>;

export const PLACES_COMMANDS = ["tree", "place", "unit", "units", "moves", "setting", "mention", "drop", "hold", "set", "same", "nowhere", "wide", "merge", "travel", "check", "apply"] as const;

/** One place-tree command; a claim the text does not show comes back as { refused: why } (never thrown), so the agent can correct it. */
export async function placesCommand(command: string, novelDir: string, rest: string[]): Promise<unknown> {
  try { return await (await placeTree()).run([command, novelDir, ...rest]); }
  catch (error) { if ((error as { refused?: boolean }).refused) return { refused: (error as Error).message }; throw error; }
}
