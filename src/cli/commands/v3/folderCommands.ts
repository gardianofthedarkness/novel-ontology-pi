/**
 * `novel folder`: the opened folder as a workspace of novels, for an agent's command line (docs/v3/design.html#workspace; the user,
 * 2026-11-10: "when we use agent clis to arrange them, they are separated into universes and sorted out"). The language
 * server answers an editor from the same state and the same index.
 */
import { resolve } from "node:path";
import { folderTree, linkReading, putBook, scanFolder, takeBook, universeAdd, universeRemove } from "../../../library/folder.js";
import { NovelServer, serve } from "../../../server/server.js";
import { NovelWorkspace } from "../../../library/workspace.js";
import { keyStatus, readingStatus, setKey, startReading, stopReading } from "../../../server/reading.js";
import { basicList, basicStep } from "../../../library/basic.js";

export const FOLDER_USAGE = [
  "Usage: novel folder scan <folder>",
  "       novel folder show <folder> [--opening N]",
  "       novel folder universe <folder> <name> [--why <text>] [--rename <new name>] [--remove]",
  "       novel folder put <folder> <file> <universe> [--at N] [--title <text>] [--series <name>]",
  "       novel folder basics <folder>   (every book's basic layer: title, author, language, series and volume by title, names by pattern; where it is placed)",
  "       novel folder take <folder> <file>",
  "       novel folder link <folder> <file> <novel-dir> [--reading <data.json>] [--force] | unlink <folder> <file>",
  "       novel folder chapters <folder> <file> [--depth chapters|parts|cards]",
  "       novel folder cast <folder> <file> [--query <text>] [--category person|place|thing|concept] [--limit N]",
  "       novel folder who <folder> <file> <name or id>",
  "       novel folder refs <folder> <file> <name or id> [--how named|described|speaks|acts|addressed|mentioned] [--chapter N] [--scene N] [--guesses] [--via] [--universe] [--from N] [--limit N]",
  "       novel folder line <folder> <file> <line id> [--around N]",
  "       novel folder problems <folder> <file> [--limit N]",
  "       novel folder keys <folder> [--jev | --work]   (with a key flag, the key is read from standard input)",
  "       novel folder read <folder> <file> [--stand-in <module>]   (the book's reading, in a process of its own)",
  "       novel folder reading <folder> <file> [--stop]",
  "       novel folder serve <folder>",
].join("\n");

const VALUED = ["--opening", "--why", "--rename", "--at", "--title", "--reading", "--depth", "--query", "--category", "--limit", "--how", "--chapter", "--scene", "--from", "--around", "--stand-in", "--series"];
const SWITCHES = ["--remove", "--guesses", "--via", "--universe", "--force", "--jev", "--work", "--stop"];

export async function folderCommand(args: string[]): Promise<unknown> {
  const sub = args[0], plain: string[] = [], flags = new Map<string, string>(), on = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    if (VALUED.includes(args[i])) { if (i + 1 >= args.length) throw new Error(`${args[i]} needs a value.\n${FOLDER_USAGE}`); flags.set(args[i], args[++i]); }
    else if (SWITCHES.includes(args[i])) on.add(args[i]);
    else if (args[i].startsWith("--")) throw new Error(`Unknown option ${args[i]}.\n${FOLDER_USAGE}`);
    else plain.push(args[i]);
  }
  const number = (name: string): number | undefined => { const raw = flags.get(name); if (raw === undefined) return undefined; const value = Number(raw); if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number.`); return value; };
  const need = (count: number) => { if (plain.length < count) throw new Error(FOLDER_USAGE); };
  need(1);
  const folder = resolve(plain[0]), workspace = () => new NovelWorkspace(folder);
  switch (sub) {
    case "scan": return scanFolder(folder);
    case "show": return folderTree(folder, { opening: number("--opening") });
    case "universe": need(2); return on.has("--remove") ? universeRemove(folder, plain[1]) : universeAdd(folder, plain[1], { why: flags.get("--why"), rename: flags.get("--rename") });
    case "put": need(3); return putBook(folder, plain[1], plain[2], { at: number("--at"), title: flags.get("--title"), series: flags.get("--series") });
    case "basics": { let step; do { step = await basicStep(folder, 6); } while (step.left > 0); return basicList(folder); }
    case "take": need(2); return takeBook(folder, plain[1]);
    case "link": need(3); return linkReading(folder, plain[1], plain[2], flags.get("--reading"), { force: on.has("--force") });
    case "unlink": need(2); return linkReading(folder, plain[1], null);
    case "chapters": { need(2); const depth = flags.get("--depth") ?? "parts"; if (depth !== "chapters" && depth !== "parts" && depth !== "cards") throw new Error("--depth is chapters, parts or cards."); return workspace().chapters(plain[1], depth); }
    case "cast": need(2); return workspace().cast(plain[1], { query: flags.get("--query"), category: flags.get("--category"), limit: number("--limit") });
    case "who": need(3); return workspace().who(plain[1], plain.slice(2).join(" "));
    case "refs": need(3); return workspace().refs(plain[1], plain.slice(2).join(" "), { how: flags.get("--how"), chapter: number("--chapter"), scene: number("--scene"), guesses: on.has("--guesses"), via: on.has("--via"), universe: on.has("--universe"), from: number("--from"), limit: number("--limit") });
    case "line": need(3); return workspace().lineOf(plain[1], plain[2], number("--around"));
    case "problems": need(2); return workspace().problems(plain[1], { limit: number("--limit") });
    // The keys go in by standard input, so they are never in a command line or a shell's history.
    case "keys": {
      const which = on.has("--jev") ? "jev" : on.has("--work") ? "work" : null;
      if (!which) return keyStatus();
      const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return setKey(which, Buffer.concat(chunks).toString("utf8"));
    }
    case "read": need(2); return startReading(folder, plain[1], { standIn: flags.get("--stand-in") });
    case "reading": need(2); return on.has("--stop") ? stopReading(folder, plain[1]) : readingStatus(folder, plain[1]);
    case "serve": return new Promise<never>(() => { serve(new NovelServer(folder), process.stdin, process.stdout, (code) => process.exit(code)); });
    default: throw new Error(FOLDER_USAGE);
  }
}
