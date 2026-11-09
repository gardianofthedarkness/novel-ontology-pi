import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BOOK, changesSince, exportSnapshot, importBundle, latestSnapshot, libraryOf, matchingSnapshot, libraryPaths, readIndex, readSnapshot,
  restoreSnapshot, takeSnapshot, type SnapshotKind,
} from "../../../ground/workspace/universe.js";

export const UNIVERSE_USAGE = [
  "novel universe paths <library> [--book vol-<n>]",
  "novel universe snapshots <library> [--book vol-<n>]",
  "novel universe snapshot <library> --book vol-<n> --why <text> [--before]",
  "novel universe status <library> [--book vol-<n>]",
  "novel universe restore <library> <snapshot-id> [--why <text>]",
  "novel universe export <library> <snapshot-id> <out-folder|out.tgz> [--pages]",
  "novel universe import <bundle> <library> [--source vol-<n>=<book file>]...",
  "novel universe adopt <library> [--why <text>]",
].join("\n  ");

function options(args: string[], allowed: string[], repeated: string[] = []): { values: string[]; flags: Map<string, string[]> } {
  const values: string[] = [], flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith("--")) { values.push(argument); continue; }
    if (!allowed.includes(argument)) throw new Error(`Unknown flag ${argument}. Usage:\n  ${UNIVERSE_USAGE}`);
    if (["--before", "--pages"].includes(argument)) { flags.set(argument, ["true"]); continue; }
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} needs a value`);
    if (flags.has(argument) && !repeated.includes(argument)) throw new Error(`${argument} given twice`);
    flags.set(argument, [...(flags.get(argument) ?? []), value]);
  }
  return { values, flags };
}

const libraryRoot = (path: string | undefined): string => {
  if (!path) throw new Error(`Usage:\n  ${UNIVERSE_USAGE}`);
  const found = libraryOf(path);
  if (!found) throw new Error(`${path} is not in a library (a folder holding universe/, snapshots/ or vol-<n>/novel)`);
  return found.root;
};
const bookFlag = (flags: Map<string, string[]>): string | undefined => {
  const book = flags.get("--book")?.[0];
  if (book !== undefined && !BOOK.test(book)) throw new Error(`a book is named vol-<n>, not ${book}`);
  return book;
};

/** The paths of a library (and a book), as every step takes them. */
function describePaths(root: string, book?: string) {
  const paths = libraryPaths(root);
  const shown: Record<string, unknown> = { root: paths.root, universe: paths.universe, snapshots: { dir: paths.snapshots.dir, index: paths.snapshots.index, objects: paths.snapshots.objects } };
  if (book) {
    const b = paths.book(book);
    shown.book = {
      dir: b.dir, novel: b.novel, source: b.source, ontology: b.ontology, graph: b.graph, reading: b.reading, terrain: b.terrain,
      world: { ...b.world, log: b.world.log("<run>"), ledger: b.world.ledger("<run>"), smoothed: b.world.smoothed("<run>"), restrand: b.world.restrand("<run>") },
      director: { ...b.director, runs: b.director.runs("<run>") }, simulation: { ...b.simulation, page: b.simulation.page("<run>") },
    };
  }
  return shown;
}

export async function universeCommand(args: string[]): Promise<unknown> {
  const [operation, ...rest] = args;
  if (operation === "paths") {
    const { values, flags } = options(rest, ["--book"]);
    return describePaths(libraryRoot(values[0]), bookFlag(flags) ?? libraryOf(values[0])?.book ?? undefined);
  }
  if (operation === "snapshots") {
    const { values, flags } = options(rest, ["--book"]);
    const root = libraryRoot(values[0]), book = bookFlag(flags);
    return { library: root, snapshots: (await readIndex(root)).snapshots.filter(entry => !book || entry.book === book) };
  }
  if (operation === "snapshot") {
    const { values, flags } = options(rest, ["--book", "--why", "--before"]);
    const root = libraryRoot(values[0]), book = bookFlag(flags), why = flags.get("--why")?.[0];
    if (!book || !why) throw new Error("novel universe snapshot needs --book vol-<n> and --why <text>");
    const kind: SnapshotKind = flags.has("--before") ? "before" : "manual";
    const made = await takeSnapshot(root, { book, kind, why, parent: (await latestSnapshot(root, { book, kind: "before" }))?.id ?? null });
    return { id: made.id, kind: made.kind, files: Object.keys(made.files).length, books: made.books, note: kind === "before" ? `a rerun of ${book} now starts here` : undefined };
  }
  if (operation === "status") {
    const { values, flags } = options(rest, ["--book"]);
    const root = libraryRoot(values[0]), book = bookFlag(flags) ?? libraryOf(values[0])?.book ?? undefined;
    const last = await latestSnapshot(root, book ? { book, not: ["guard"] } : { not: ["guard"] });
    const before = book ? await latestSnapshot(root, { book, kind: "before" }) : null;
    const at = await matchingSnapshot(root);
    return { library: root, book: book ?? null, at, before: before?.id ?? null, last: last?.id ?? null, changedSinceLast: at ? [] : last ? await changesSince(root, last.id) : null };
  }
  if (operation === "restore") {
    const { values, flags } = options(rest, ["--why"]);
    const root = libraryRoot(values[0]);
    if (!values[1]) throw new Error("novel universe restore needs a snapshot id (novel universe snapshots lists them)");
    await readSnapshot(root, values[1]);
    return restoreSnapshot(root, values[1], { why: flags.get("--why")?.[0] ?? "" });
  }
  if (operation === "export") {
    const { values, flags } = options(rest, ["--pages"]);
    const root = libraryRoot(values[0]);
    if (!values[1] || !values[2]) throw new Error("novel universe export needs a snapshot id and an output folder or .tgz");
    return exportSnapshot(root, values[1], resolve(values[2]), { pages: flags.has("--pages") });
  }
  if (operation === "import") {
    const { values, flags } = options(rest, ["--source"], ["--source"]);
    if (!values[0] || !values[1]) throw new Error("novel universe import needs a bundle and a library folder");
    const sources = Object.fromEntries((flags.get("--source") ?? []).map(entry => { const at = entry.indexOf("="); if (at < 1) throw new Error("--source is vol-<n>=<file>"); return [entry.slice(0, at), resolve(entry.slice(at + 1))]; }));
    return importBundle(resolve(values[0]), resolve(values[1]), { sources });
  }
  if (operation === "adopt") {
    const { values, flags } = options(rest, ["--why"]);
    const root = libraryRoot(values[0]);
    // The canon's undo lives with the world engine (world-engine/review/canon.mjs); dist/src/cli/commands/extract → repository.
    const adoptModule = pathToFileURL(resolve(new URL(".", import.meta.url).pathname, "..", "..", "..", "..", "..", "world-engine", "library", "adopt.mjs")).href;
    const { adopt } = await import(adoptModule) as { adopt: (root: string, options: { why?: string }) => Promise<unknown> };
    return adopt(root, { why: flags.get("--why")?.[0] ?? "adopted" });
  }
  throw new Error(`Usage:\n  ${UNIVERSE_USAGE}`);
}
