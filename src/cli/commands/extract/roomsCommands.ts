import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The rooms by the agent, with evidence (engine/places/room-plan.mjs; docs/v3/design.html#room-plan): every room the
 * units are set in, its kind, floor, part and openings, and where each person of each unit is in it, each decided with a
 * line of the book; code refuses a line that is not in or just before a unit set in that room. Loaded from the repository
 * this CLI runs from.
 */
interface RoomPlanModule { run(argv: string[]): Promise<unknown> }
async function repository(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = await readFile(join(directory, "package.json"), "utf8").then((text) => JSON.parse(text) as { name?: string }, () => null);
    // The repository, or Novel Console's bundled backend.
    if (pkg?.name === "novel-ontology-pi" || pkg?.name === "novel-console-backend") return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error("The world engine is not installed beside this CLI (engine/places/room-plan.mjs).");
    directory = parent;
  }
}
const roomPlan = async () => import(pathToFileURL(join(await repository(), "engine", "places", "room-plan.mjs")).href) as Promise<RoomPlanModule>;

export const ROOMS_COMMANDS = ["rooms", "room", "stage", "kind", "floor", "part", "opens", "at", "shot", "check"] as const;

/** One room-plan command; a claim the text does not show comes back as { refused: why } (never thrown), so the agent can correct it. */
export async function roomsCommand(command: string, novelDir: string, rest: string[]): Promise<unknown> {
  try { return await (await roomPlan()).run([command, novelDir, ...rest]); }
  catch (error) { if ((error as { refused?: boolean }).refused) return { refused: (error as Error).message }; throw error; }
}
