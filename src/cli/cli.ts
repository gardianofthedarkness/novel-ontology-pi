#!/usr/bin/env node
/**
 * novel — the CLI half of the Skill + CLI bundle.
 *
 * What a user's agent runs (skills/novel-folder: the folder, its books, who is who and where they are cited; shipped
 * with Novel Console, which installs the command), plus v2's world pipeline (skills/novel-volume, skills/novel-models)
 * and our own evaluations. v1's commands (library, ingest, changeset, review, causality, timeplace, stage, graph,
 * query and the rest) were archived on 2026-11-11 with the CLI as it stood: archive/cli/.
 * All commands print JSON by default; add --pretty for humans.
 */
import { describeError, EXIT_CODES, NovelError } from "../ground/errors.js";
import { ERROR_CATALOG } from "../ground/errorCatalog.js";
import { diagnose } from "./diagnose.js";
import { join, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { llmPing, llmProbe } from "./commands/shared/llmCommands.js";
import { universeCommand } from "./commands/extract/universeCommands.js";
import {
  jevLogin,
  jevLogout,
  jevPing,
  jevStatus,
} from "./commands/shared/jevCommands.js";
import { resolveJevKey } from "../ground/connectors/secrets.js";
import { inspectNovel } from "./commands/extract/inspectCommands.js";
import { evalExtract, evalRun } from "./commands/extract/evalCommands.js";
import { evalDialogueCards } from "./commands/extract/dialogueEval.js";
import { evalStoryOrder } from "./commands/extract/storyOrderEval.js";
import { SIM_USAGE, simPick, simRun, simShow, simStrands, simTerrain } from "./commands/extract/simCommands.js";
import { sourceGrep, sourceSimilar } from "./commands/extract/sourceCommands.js";
import { worldAnswer, worldBatch, worldPool } from "./commands/extract/worldCommands.js";
import { castAsk, castMerge, castReview, castSheet, castShow, sky } from "./commands/extract/castCommands.js";
import { strandsInherit, strandsKeep, strandsRegister, strandsSet, strandsShow } from "./commands/extract/strandCommands.js";
import { volumeDone, volumeLog, volumeRun, volumeStatus } from "./commands/extract/volumeCommands.js";
import { folderCommand } from "./commands/v3/folderCommands.js";
import { settingsDiff, settingsExplain, settingsProfileApply, settingsProfileList, settingsProfileSave, settingsSet, settingsShow, settingsUnset } from "./commands/extract/settingsCommands.js";
import { warehouseAdd, warehouseFetch, warehouseFind, warehouseInteract, warehouseList, warehouseRefresh, warehouseShow, warehouseUse } from "./commands/extract/warehouseCommands.js";
import { lookContext } from "./commands/extract/lookCommands.js";
import { PLACES_COMMANDS, placesCommand } from "./commands/extract/placesCommands.js";
import { modelBind, modelBrief, modelCheck, modelList, modelNominate, modelParts, modelPut, modelShow, modelUse, modelWrite } from "./commands/extract/modelCommands.js";
import { readingShow, sourceEpub, worldApply, worldCanon, worldHeld, worldLogShow, worldUndo } from "./commands/extract/worldReviewCommands.js";

const COMMANDS: Record<string, string> = {
  "novel universe snapshots|snapshot|status|restore <library> ...": "A universe's snapshots: one before each book's first run (where a rerun starts) and one after each run; restore puts a snapshot back (what it replaces is snapshotted first)",
  "novel universe export <library> <snapshot> <out.tgz>": "Pack a run's result (with the snapshot before it) for another user; the books' text is not included",
  "novel universe import <bundle> <library> [--source vol-<n>=<file>]": "Start a universe from another user's bundle; your copy of each book is checked by sha256",
  "novel universe paths|adopt <library>": "The library's fixed paths; adopt gives a library made before snapshots its first ones",
  "novel sim strands|pick|run|show <novel-dir> [--auto N] [--strand id] [--max-calls N] [--accept]":
    "The stage simulation (view data, never canon): `strands` ranks the book's story lines by the scenes the engine would simulate; `pick` simulates those lines live, event by event (headless Chrome): on a picture of each event as it begins, Jev decides where the people go, where the things it mentions stand and where its fight hits and how big, the next event beginning from what those answers made, within --max-calls, keeping every decision for the runs; `run` (no model calls) runs the engine (buildings as skeletons from the place tree, the per-fork walk with the path-integral sampler, placed things, damage) on the first N lines (--auto N) or one (--strand id) and keeps each as a versioned run with the player's data (a line's first run is its accepted one; --accept takes this run instead); `show` lists each line's accepted run and whether it was made from the book as it is now. The viewer plays accepted runs at play/, and what a running pick or run is doing at play/live.",
  "novel source grep <novel-dir> <regex> [--limit N]": "Original sentences matching a regular expression, with sentence and scene ids (read-only)",
  "novel source similar <novel-dir> <text> [--limit N]": "The original passages most like a text (lexical retrieval), with sentence and scene ids (read-only)",
  "novel world pool|batch|answer <novel-dir> …": "World-first review pool: what the world flagged, a batch for the main agent, and its answers (novel world answer <dir> <batch> <item> <option> --reason <text>)",
  "novel world log <novel-dir> --scene|--person|--card <id> [--run <id>]": "The world log of the last director run: who was where, moves, meetings, blasts, and the laws' verdicts (read-only)",
  "novel world held <novel-dir> [--run <id>] [--budget N]": "A director run's held items (what the laws could not settle, and the user's notes) into the review pool, one batch per scene by reach",
  "novel world apply <novel-dir>": "The main agent's answers into the pins the director plays by, under the laws (what they turn back returns to the pool)",
  "novel folder scan|show|universe|put|take|link|unlink|chapters|cast|who|refs|line|problems|serve <folder> …": "v3: the opened folder as a workspace of novels (docs/v3/design.html#workspace): every EPUB and text file under it found (scan); the folder as universes, their books in order and the unsorted files, with each file's first lines for sorting (show [--opening N]); a universe made, renamed or removed (universe <name> [--why t] [--rename n] [--remove]); a file put into a universe at a place in its order, or taken out (put <file> <universe> [--at N] [--title t]; take <file>); an existing reading linked to a book, read-only (link <file> <novel-dir> [--reading data.json]; unlink); a book's chapters and smaller parts (chapters <file> [--depth chapters|parts|cards]); its people, places, things and concepts (cast <file> [--query t]); one entry's record (who <file> <name or id>); every line that refers to it, with how and how sure (refs <file> <name or id> [--how h] [--chapter N] [--scene N] [--guesses] [--via] [--universe] [--limit N], 30 shown unless --limit says more); a line with the lines around it (line <file> <line id>); the reading's doubtful credits (problems <file>); the language server over stdio (serve)",
  "novel volume status|run|log|done <novel-dir> …": "A whole volume step by step (novel-volume skill): each step's status (status); the steps from the first not done up to the agent's look pass, or one step, or up to a step, started in the background (run [--step <id> | --until <id>]); a step's log (log <step> [--lines N]); the agent's look pass marked done (done look --why t)",
  "novel places tree|place|unit|units|moves|check|apply <novel-dir> | setting|mention|drop|hold|set|same|travel <novel-dir> … --why t [--line id]": "The place tree by the agent, with evidence (docs/v3/design.html#place-tree-agent): after the reading and before terrain, each city or district made a setting (a line that puts something there), a mention or dropped; an unnamed place held under its parent; a unit set at a place (a line in it or just before) or the same as an earlier unit; a change of city shown by a travel line. Every claim is checked against the text; refused claims come back with why. check lists what is left; apply rebuilds the world script from the reading's own (kept as script.reading.json)",
  "novel strands register|inherit|set|keep|show <novel-dir> …": "What a book carries into the next, per strand (docs/v3/design.html#borrow-and-spawn §4.5): the book's strands at its end into the universe's registry (register [--run <id>]); at the next book's reading each open strand of the last book inherited (its damage to buildings that are not nominated stays) or closed (they stand whole) (inherit [--work] [--dry]); the main agent's override (set <strand key> inherited|closed --why t [--into <key>]); a run's damage into the universe building by building (keep --run <id>); the registry and the damage in force (show)",
  "novel cast show|merge|sheet|ask|review <novel-dir> …": "The cast's review: the cast and their ability sheets (show [<char>]); two entries made one person in the reading, its views, the ontology and the universe's sheets (merge <keep> <merged> --reason t [--reading <data.json>]... [--dry]); one person's ability sheet (sheet <char> --sheet '<JSON>' | --none --reason t [--evidence <ids>]); two people raised as one for the agent (ask <a> <b> --why t); the cast's questions in batches in the world's review pool (review [--size N] [--least-cards N] [--send <console-dir>]), answered with novel world answer, done by novel world apply",
  "novel sky build|show <novel-dir> [--dry] [--cache <dir>]": "The story sky: each unit's time of day and weather into sky.json beside the reading the director plays (build: Jev, cents, cached; --dry counts only); show: what it holds",
  "novel settings show <novel-dir> [<prefix>] [--place <id>] [--changed]": "The world generator's settings (config/world.schema.json) as they resolve for a book: defaults < universe < book < place, each with where it came from",
  "novel settings explain <key|table>": "A setting's meaning, unit, range, kind, which layers may set it, where it is used and when a change takes effect",
  "novel settings set <novel-dir> <key> '<JSON>' [--place <id>] [--layer universe|book] [--table] --why <text> [--before]": "Check a value against the schema, write it to its layer, log why; --before takes the book's new before snapshot (a full rerun restores the latest)",
  "novel settings unset <novel-dir> <key> [--place <id>] [--layer universe|book] [--table] --why <text> [--before]": "Take an override out: the value falls back to the layer below",
  "novel settings diff <novel-dir> [--from <snapshot-id>]": "Every override in force, or what changed in the settings files since a snapshot",
  "novel settings profile save|apply|list <novel-dir> [<name>] --why <text> [--before]": "A profile is a named set of overrides and nothing more (<universe>/profiles/<name>.json): save the overrides in force as one, apply one through the schema, list them",
  "novel look context <novel-dir> [--place <id>] [--top N]": "The look pass (after the reading, before the terrain loop): the place tree top down with each place's environment sentences, the words a setting answers, the warehouse parts the text names, and the keys a place may set; then novel settings set | novel warehouse use ... --place <id> --why <sentence ids>",
  "novel warehouse list [--source <name>] [<novel-dir>]": "The model warehouse's sources (gkNextEngine's kits, the baked CC0 packs, the universe's own models, yours) with counts by category and licences",
  "novel warehouse add <name> <folder> --licence <SPDX> --why <text> [--from <url>] [--kind scad|gltf] [--categories '<json>'] [--allowed-by <text>]": "Register a folder of SCAD kits or glTF files already on disk and build its catalogue (OpenSCAD evaluates each module; glTF files are measured and baked); CC0, MIT, Apache, BSD and CC-BY-4.0 pass, any other licence only with the user's recorded OK",
  "novel warehouse fetch <name> <https-url> --licence <SPDX> --ok '<the user\'s words>' --why <text> [--path <folder>] [--limit <MB>]": "Download a git repository (or one folder of it) or a zip into its own new folder under the packs root, LICENSE and SOURCE.txt kept, then add it. Never without the user's OK: ask them first with the name, licence and size",
  "novel warehouse refresh <name>": "Rebuild a source's catalogue",
  "novel warehouse find '<words>' [--kind '<thing kind>'] [--category <c>] [--size <m>] [--source <name>] [--top N] [<novel-dir>]": "Parts ranked for a few words over every catalogue: an exact name (a model's label, given at birth) first, then name, category, the kind's categories and size closeness, as <source>:<part>",
  "novel warehouse show <source>:<part> [<novel-dir>]": "A part's record and its mesh's size",
  "novel warehouse interact <source>:<part>|'<kind>' [<json sheet>] <novel-dir> [--why <text>] [--before]": "A part's interaction sheet as it resolves for the book (solid, layer, seats, crash degree and radius, what it becomes when broken, its wreck part); with a JSON sheet and --why, the book's override, written as the models.interact setting",
  "novel warehouse use <source>:<part> for <slot> <novel-dir> --why <text> [--place <id>] [--before] [--floors a b]": "Connect a part to a slot of the world's configuration: prop:<kind> (fill.props), vehicle:<kind> (models.vehicles), kind:<thing kind> (models.parts), use:<building use> or role:<role> (the models.uses table); written through the settings schema",
  "novel model nominate <novel-dir> [--reading <data.json>] [--top N]": "Rank the book's things (scenes, sentences, kind); the important, well-described ones get a model of their own, the rest a warehouse part (no model call)",
  "novel model list <novel-dir> [--state todo|made|failed|part]": "The nominated things and their models' state",
  "novel model brief <novel-dir> <thing>": "What a writer needs for one thing: its lines, kind, the reading's size, the contract and its checks",
  "novel model write <novel-dir> <thing> | --all [--limit N]": "The work model writes the model as OpenSCAD code, checked; the check's problems go back to it (work model, a few cents a book)",
  "novel model put <novel-dir> <thing> <file.scad|-> [--by <who>]": "Your own model code, held to the same contract",
  "novel model check <novel-dir> <thing> | --all": "Check kept models again against the contract as it stands (OpenSCAD, manifold-3d) and update their records; no model call",
  "novel model show <novel-dir> <thing>": "A model's code and record",
  "novel model use <novel-dir> <thing> <source>:<part> [--why <text>]": "Bind a thing to a warehouse part instead of writing one (kit:<module>, pack:<model>, own:<id>, or a registered source's part)",
  "novel model bind <novel-dir> [--limit N]": "The work model binds each thing that takes a part to the closest kit part (gkNextEngine's SCAD kits, MIT), rendered and checked",
  "novel model parts '<kind>'": "The kit parts a kind of thing may take, with their sizes (for choosing by hand)",
  "novel world canon <novel-dir> [--run <id>]": "What a director run settled into canon by its gates: presence, place, speakers, where each person is, strands (undoable)",
  "novel world undo <novel-dir> --run <id>": "A director run's writes to canon taken back, each record to what it replaced",
  "novel reading <novel-dir> card|scene|line <id>": "The v2 reading of a card, a scene or a line: kinds, speakers and how sure, people, place and time, with the text (read-only)",
  "novel source epub <novel-dir> [--doc N] [--grep <regex>] [--offset N] [--limit N]": "The original EPUB as published: its documents, one document's paragraphs, or the paragraphs matching (read-only)",
  "novel llm ping": "Work-LLM smoke test: one tiny completion (reachability, latency, usage)",
  "novel llm probe": "Work-LLM smoke test: JSON-mode reply, validated",
  "novel jev login [--from-env]": "Store the Jev key in the secure store (hidden prompt; never printed)",
  "novel jev status": "Jev key status: source only (env / secure store / indirection), never the value",
  "novel jev logout": "Remove the Jev key from the secure store",
  "novel jev ping": "Jev smoke test: one tiny live decision via the resolved key",
  "novel explain <error-code> | novel explain --list":
    "What an error code means, why it happens and how to fix it (every failure's report names its code).",
  "novel inspect <novel-dir>":
    "Corpus diagnostics over a novel bundle (counts, coverage, integrity tallies — no judgments)",
  "novel eval run <dataset-dir> <predictions-dir>":
    "Score prediction files against a golden-chapter dataset (precision/recall; metrics only, no thresholds)",
  "novel eval dialogues <gold-cards.json> <predicted-cards.json>":
    "Score exchange-level participants: correct/wrong/missing, unknown cards and source-span matching; no model calls",
  "novel eval story-order <gold.json> <predicted.json> [--timeplace] [--ties]":
    "Score story order pair by pair (before / after / parallel) against a strand gold; --timeplace reads a time-place run report as the prediction (--ties leaves scenes of one period unordered); no model calls",
  "novel eval extract <novel-dir> <predictions-dir>":
    "Project an ingested bundle's ontology into a per-chapter predictions dir for eval run (records as stored; no model calls)",
  "novel config": "Show model routing config (keys via env / secure store only)",
};

function out(obj: unknown, pretty: boolean): void {
  console.log(pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** Join the remaining args into one string, skipping flags and their values. */
function restText(args: string[], flagsWithValues: string[]): string {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flagsWithValues.includes(args[i])) i++;
    else kept.push(args[i]);
  }
  return kept.join(" ");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pretty = args.includes("--pretty");
  const positional = args.filter((a) => a !== "--pretty");
  const [cmd, sub] = positional;

  if (!cmd || cmd === "help" || cmd === "--help") {
    out({ tool: "novel", commands: COMMANDS }, true);
    return;
  }

  if (cmd === "config") {
    const resolved = resolveJevKey();
    out(
      loadConfig(process.env, {
        jevKeySource:
          resolved && resolved.source !== "env" ? resolved.source : null,
      }),
      pretty,
    );
    return;
  }

  if (cmd === "universe") {
    out(await universeCommand(positional.slice(1)), pretty);
    return;
  }

  if (cmd === "jev") {
    if (sub === "login") {
      out(
        await jevLogin(process.env, {
          fromEnv: positional.includes("--from-env"),
        }),
        pretty,
      );
      return;
    }
    if (sub === "status") {
      out(jevStatus(), pretty);
      return;
    }
    if (sub === "logout") {
      out(jevLogout(), pretty);
      return;
    }
    if (sub === "ping") {
      out(await jevPing(), pretty);
      return;
    }
    throw new Error("Usage: novel jev login|status|logout|ping");
  }

  if (cmd === "llm") {
    if (sub === "ping") {
      out(await llmPing(), pretty);
      return;
    }
    if (sub === "probe") {
      out(await llmProbe(), pretty);
      return;
    }
    throw new Error("Usage: novel llm ping|probe");
  }

  if (cmd === "explain") {
    // The long explanation of an error code (like rustc --explain); --list prints every code.
    if (sub === "--list" || !sub) { out(Object.fromEntries(Object.entries(ERROR_CATALOG).map(([code, entry]) => [code, `${entry.aspect}: ${entry.title}`])), pretty); return; }
    const entry = ERROR_CATALOG[sub.toUpperCase()];
    if (!entry) throw new NovelError(`Unknown error code ${sub}; novel explain --list shows them all.`, { aspect: "usage", code: "INVALID_ARGUMENT", hint: "Use a code from novel explain --list." });
    out({ code: sub.toUpperCase(), ...entry }, pretty);
    return;
  }

  if (cmd === "inspect") {
    if (!sub || sub.startsWith("--")) {
      throw new Error("Usage: novel inspect <novel-dir>");
    }
    out(await inspectNovel(sub), pretty);
    return;
  }

  if (cmd === "eval") {
    if (sub === "dialogues" && positional.length === 4) {
      out(await evalDialogueCards(positional[2], positional[3]), pretty);
      return;
    }
    if (sub === "story-order" && positional[2] && positional[3]) {
      out(await evalStoryOrder(positional[2], positional[3], { timeplace: positional.includes("--timeplace"), ties: positional.includes("--ties") }), pretty);
      return;
    }
    if (sub === "run" && positional[2] && positional[3]) {
      out(await evalRun(positional[2], positional[3]), pretty);
      return;
    }
    if (sub === "extract" && positional[2] && positional[3]) {
      out(await evalExtract(positional[2], positional[3]), pretty);
      return;
    }
    throw new Error("Usage: novel eval run <dataset-dir> <predictions-dir> | novel eval extract <novel-dir> <predictions-dir> | novel eval dialogues <gold-cards.json> <predicted-cards.json> | novel eval story-order <gold.json> <predicted.json> [--timeplace] [--ties]");
  }

  if (cmd === "sim") {
    const novelDir = positional[2];
    if (!["strands", "terrain", "pick", "run", "show"].includes(sub ?? "") || !novelDir || novelDir.startsWith("--")) throw new Error(`Usage: ${SIM_USAGE}`);
    const valued = sub === "run" ? ["--auto", "--strand", "--pace", "--from"] : sub === "pick" ? ["--auto", "--strand", "--max-calls"] : sub === "terrain" ? ["--turns", "--parts", "--from", "--until"] : [], switches = sub === "run" ? ["--accept", "--force"] : sub === "terrain" ? ["--sites", "--run", "--spawn", "--resettle"] : [];
    const seen = new Set<string>();
    for (let index = 3; index < positional.length; index++) {
      const name = positional[index];
      if (seen.has(name) || ![...valued, ...switches].includes(name)) throw new Error(`Usage: ${SIM_USAGE}`);
      seen.add(name);
      if (valued.includes(name)) { const value = positional[++index]; if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`); }
    }
    const auto = flag(positional, "--auto");
    if (auto !== undefined && (!/^\d+$/.test(auto) || Number(auto) < 1 || Number(auto) > 20)) throw new Error("--auto must be a whole number from 1 to 20.");
    const maxCalls = flag(positional, "--max-calls");
    if (maxCalls !== undefined && (!/^\d+$/.test(maxCalls) || Number(maxCalls) < 1 || Number(maxCalls) > 500)) throw new Error("--max-calls must be a whole number from 1 to 500.");
    const pace = flag(positional, "--pace");
    if (pace !== undefined && (!/^\d+(\.\d+)?$/.test(pace) || Number(pace) > 30)) throw new Error("--pace must be seconds per moment, from 0 to 30.");
    const lines = { auto: auto === undefined ? undefined : Number(auto), strand: flag(positional, "--strand") };
    const turns = flag(positional, "--turns");
    if (turns !== undefined && (!/^\d+$/.test(turns) || Number(turns) < 1 || Number(turns) > 3)) throw new Error("--turns must be 1, 2 or 3.");
    const parts = flag(positional, "--parts");
    if (parts !== undefined && (!/^\d+$/.test(parts) || Number(parts) < 1)) throw new Error("--parts must be a whole number, 1 or more.");
    const level = flag(positional, "--from"), until = flag(positional, "--until");
    if (sub === "terrain" && [level, until].some((value) => value !== undefined && !["city", "district", "street", "building"].includes(value))) throw new Error("--from and --until must be city, district, street or building.");
    if (sub === "terrain") { out(await simTerrain(novelDir, { turns: turns === undefined ? undefined : Number(turns), sites: positional.includes("--sites"), run: positional.includes("--run"), parts: parts === undefined ? undefined : Number(parts), spawn: positional.includes("--spawn"), from: level, until, resettle: positional.includes("--resettle") }), pretty); return; }
    out(await (sub === "strands" ? simStrands(novelDir) : sub === "show" ? simShow(novelDir) : sub === "pick" ? simPick(novelDir, { ...lines, maxCalls: maxCalls === undefined ? undefined : Number(maxCalls) }) : simRun(novelDir, { ...lines, from: flag(positional, "--from"), accept: positional.includes("--accept"), force: positional.includes("--force"), pace: pace === undefined ? undefined : Number(pace) })), pretty);
    return;
  }

  if (cmd === "reading") {
    const novelDir = positional[1];
    if (!novelDir || !positional[2] || !positional[3]) throw new Error("Usage: novel reading <novel-dir> card|scene|line <id>");
    out(await readingShow(novelDir, positional[2], positional[3]), pretty);
    return;
  }

  if (cmd === "source" && sub === "epub") {
    const novelDir = positional[2], number = (name: string) => { const value = flag(positional, name); if (value === undefined) return undefined; if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number.`); return Number(value); };
    if (!novelDir) throw new Error("Usage: novel source epub <novel-dir> [--doc N] [--grep <regex>] [--offset N] [--limit N]");
    out(await sourceEpub(novelDir, { doc: number("--doc"), grep: flag(positional, "--grep"), offset: number("--offset"), limit: number("--limit") }), pretty);
    return;
  }

  if (cmd === "source") {
    const novelDir = positional[2];
    if (!["grep", "similar"].includes(sub ?? "") || !novelDir) throw new Error("Usage: novel source grep|similar <novel-dir> <regex|text> [--limit N]");
    const text = restText(positional.slice(3), ["--limit"]), rawLimit = flag(positional, "--limit"), limit = rawLimit === undefined ? (sub === "grep" ? 20 : 10) : Number(rawLimit);
    if (!text) throw new Error(`Usage: novel source ${sub} <novel-dir> <${sub === "grep" ? "regex" : "text"}> [--limit N]`);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("--limit must be a whole number from 1 to 50.");
    out(await (sub === "grep" ? sourceGrep(novelDir, text, limit) : sourceSimilar(novelDir, text, limit)), pretty);
    return;
  }

  if (cmd === "folder") {
    out(await folderCommand(positional.slice(1)), pretty);
    return;
  }

  if (cmd === "volume") {
    const novelDir = positional[2], usage = "Usage: novel volume status <novel-dir> | run <novel-dir> [--step <id> | --until <id>] | log <novel-dir> <step> [--lines N] | done <novel-dir> <step> --why <text>";
    if (!["status", "run", "log", "done"].includes(sub ?? "") || !novelDir || novelDir.startsWith("--")) throw new Error(usage);
    if (sub === "status") { out(await volumeStatus(novelDir), pretty); return; }
    if (sub === "run") { out(await volumeRun(novelDir, { step: flag(positional, "--step"), until: flag(positional, "--until") }), pretty); return; }
    if (sub === "log") { if (!positional[3]) throw new Error(usage); const lines = flag(positional, "--lines"); out(await volumeLog(novelDir, positional[3], lines === undefined ? undefined : Number(lines)), pretty); return; }
    const why = flag(positional, "--why"); if (!positional[3] || !why) throw new Error(usage);
    out(await volumeDone(novelDir, positional[3], why), pretty);
    return;
  }

  if (cmd === "strands") {
    const novelDir = positional[2], usage = "Usage: novel strands register <novel-dir> [--run <id>] [--reading <data.json>] [--dry] | inherit <novel-dir> [--reading <data.json>] [--work] [--dry] | set <novel-dir> <strand key> inherited|closed --why <text> [--into <key>] | keep <novel-dir> --run <id> [--dry] | show <novel-dir>";
    if (!["register", "inherit", "set", "keep", "show"].includes(sub ?? "") || !novelDir || novelDir.startsWith("--")) throw new Error(usage);
    if (sub === "register") { out(await strandsRegister(novelDir, { run: flag(positional, "--run"), reading: flag(positional, "--reading"), dry: positional.includes("--dry") }), pretty); return; }
    if (sub === "inherit") { out(await strandsInherit(novelDir, { reading: flag(positional, "--reading"), work: positional.includes("--work"), dry: positional.includes("--dry") }), pretty); return; }
    if (sub === "set") { const why = flag(positional, "--why"); if (!positional[3] || !positional[4] || !why) throw new Error(usage); out(await strandsSet(novelDir, positional[3], positional[4], why, flag(positional, "--into")), pretty); return; }
    if (sub === "keep") { const run = flag(positional, "--run"); if (!run) throw new Error(usage); out(await strandsKeep(novelDir, { run, dry: positional.includes("--dry") }), pretty); return; }
    out(await strandsShow(novelDir), pretty);
    return;
  }

  if (cmd === "cast") {
    const novelDir = positional[2];
    if (!["show", "merge", "sheet", "ask", "review"].includes(sub ?? "") || !novelDir) throw new Error("Usage: novel cast show <novel-dir> [<char>] | merge <novel-dir> <keep> <merged> --reason <text> [--reading <data.json>]... [--dry] | sheet <novel-dir> <char> --sheet '<JSON>' | --none --reason <text> [--evidence <ids>] | ask <novel-dir> <a> <b> --why <text> | review <novel-dir> [--size N] [--least-cards N] [--send <console-dir>]");
    const all = (name: string) => positional.flatMap((value, n) => (value === name && positional[n + 1] ? [positional[n + 1]] : []));
    const number = (name: string) => { const value = flag(positional, name); return value === undefined ? undefined : Number(value); };
    if (sub === "show") { out(await castShow(novelDir, positional[3]?.startsWith("--") ? undefined : positional[3]), pretty); return; }
    if (sub === "merge") { if (!positional[3] || !positional[4]) throw new Error("Usage: novel cast merge <novel-dir> <keep> <merged> --reason <text> [--reading <data.json>]... [--dry]"); out(await castMerge(novelDir, positional[3], positional[4], { reason: flag(positional, "--reason"), readings: all("--reading"), dry: positional.includes("--dry") }), pretty); return; }
    if (sub === "sheet") { if (!positional[3]) throw new Error("Usage: novel cast sheet <novel-dir> <char> --sheet '<JSON>' | --none --reason <text> [--evidence <ids>]"); out(await castSheet(novelDir, positional[3], { sheet: flag(positional, "--sheet"), none: positional.includes("--none"), reason: flag(positional, "--reason"), evidence: flag(positional, "--evidence") }), pretty); return; }
    if (sub === "ask") { if (!positional[3] || !positional[4]) throw new Error("Usage: novel cast ask <novel-dir> <a> <b> --why <text>"); out(await castAsk(novelDir, positional[3], positional[4], flag(positional, "--why")), pretty); return; }
    out(await castReview(novelDir, { size: number("--size"), least: number("--least-cards"), send: flag(positional, "--send") }), pretty);
    return;
  }

  if (cmd === "model") {
    const novelDir = positional[2], usage = "Usage: novel model nominate|list|brief|write|put|check|use|show <novel-dir> ... (novel help)";
    if (sub === "parts") { if (!novelDir) throw new Error("novel model parts '<kind>' (e.g. 'a small weapon')"); out(await modelParts(novelDir), pretty); return; }
    if (!["nominate", "list", "brief", "write", "put", "check", "use", "show", "bind"].includes(sub ?? "") || !novelDir) throw new Error(usage);
    if (sub === "bind") { out(await modelBind(novelDir, { limit: flag(positional, "--limit") === undefined ? undefined : Number(flag(positional, "--limit")) }), pretty); return; }
    const thing = positional[3] && !positional[3].startsWith("--") ? positional[3] : undefined, number = (name: string) => { const value = flag(positional, name); return value === undefined ? undefined : Number(value); };
    if (sub === "nominate") { out(await modelNominate(novelDir, { reading: flag(positional, "--reading"), top: number("--top") }), pretty); return; }
    if (sub === "list") { out(await modelList(novelDir, { state: flag(positional, "--state") }), pretty); return; }
    if (sub === "write") { if (!thing && !positional.includes("--all")) throw new Error("novel model write <novel-dir> <thing> | --all [--limit N]"); out(await modelWrite(novelDir, thing ?? null, { all: positional.includes("--all"), limit: number("--limit") }), pretty); return; }
    if (sub === "check") { if (!thing && !positional.includes("--all")) throw new Error("novel model check <novel-dir> <thing> | --all"); out(await modelCheck(novelDir, thing ?? null), pretty); return; }
    if (!thing) throw new Error(usage);
    if (sub === "brief") { out(await modelBrief(novelDir, thing), pretty); return; }
    if (sub === "put") { if (!positional[4]) throw new Error("novel model put <novel-dir> <thing> <file.scad|->"); out(await modelPut(novelDir, thing, positional[4], { by: flag(positional, "--by") }), pretty); return; }

    if (sub === "use") { if (!positional[4]) throw new Error("novel model use <novel-dir> <thing> kit:<module>|pack:<model>"); out(await modelUse(novelDir, thing, positional[4], { why: flag(positional, "--why") }), pretty); return; }
    out(await modelShow(novelDir, thing), pretty);
    return;
  }

  if (cmd === "settings") {
    const usage = "Usage: novel settings show <novel-dir> [<prefix>] [--place <id>] [--changed] | explain <key> | set <novel-dir> <key> '<JSON>' [--place <id>] [--layer universe|book] [--table] --why <text> [--before] | unset <novel-dir> <key> [...] --why <text> | diff <novel-dir> [--from <snapshot>] | profile save|apply|list <novel-dir> [<name>] --why <text> [--before]";
    if (sub === "explain") { if (!positional[2]) throw new Error(usage); out(settingsExplain(positional[2]), pretty); return; }
    if (sub === "profile") {
      const what = positional[2], dir = positional[3], name = positional[4] && !positional[4].startsWith("--") ? positional[4] : undefined;
      if (!["save", "apply", "list"].includes(what ?? "") || !dir) throw new Error("novel settings profile save|apply|list <novel-dir> [<name>] --why <text> [--before]");
      if (what === "list") { out(await settingsProfileList(dir), pretty); return; }
      if (!name) throw new Error(`novel settings profile ${what} <novel-dir> <name> --why <text>`);
      out(what === "save" ? await settingsProfileSave(dir, name, { why: flag(positional, "--why") }) : await settingsProfileApply(dir, name, { why: flag(positional, "--why"), before: positional.includes("--before") }), pretty);
      return;
    }
    const novelDir = positional[2];
    if (!["show", "set", "unset", "diff"].includes(sub ?? "") || !novelDir) throw new Error(usage);
    const layer = flag(positional, "--layer") as "universe" | "book" | undefined, place = flag(positional, "--place"), why = flag(positional, "--why");
    if (layer && !["universe", "book"].includes(layer)) throw new Error("--layer is universe or book (a place is --place <id>)");
    const common = { place, layer, why, before: positional.includes("--before"), isTable: positional.includes("--table") };
    if (sub === "show") { const prefix = positional[3] && !positional[3].startsWith("--") ? positional[3] : undefined; out(await settingsShow(novelDir, { prefix, place, changed: positional.includes("--changed") }), pretty); return; }
    if (sub === "set") { if (!positional[3] || positional[4] === undefined) throw new Error(usage); out(await settingsSet(novelDir, positional[3], positional[4], common), pretty); return; }
    if (sub === "unset") { if (!positional[3]) throw new Error(usage); out(await settingsUnset(novelDir, positional[3], common), pretty); return; }
    out(await settingsDiff(novelDir, { from: flag(positional, "--from") }), pretty);
    return;
  }

  if (cmd === "places") {
    const novelDir = positional[2];
    if (!(PLACES_COMMANDS as readonly string[]).includes(sub ?? "") || !novelDir || novelDir.startsWith("--")) throw new Error("Usage: novel places tree|place|unit|units|moves|check|apply <novel-dir> [...] | setting|mention|drop|hold|set|same|nowhere|travel <novel-dir> ... --why <text> [--line <sentence id>] [--through <unit>] [--override]");
    const result = await placesCommand(sub as string, novelDir, positional.slice(3));
    if (typeof result === "string") console.log(result); else out(result, pretty);
    if (result && typeof result === "object" && "refused" in result) process.exitCode = 3;
    return;
  }

  if (cmd === "look") {
    const novelDir = positional[2];
    if (sub !== "context" || !novelDir) throw new Error("Usage: novel look context <novel-dir> [--place <id>] [--top N]");
    const top = flag(positional, "--top");
    out(await lookContext(novelDir, { place: flag(positional, "--place"), top: top === undefined ? undefined : Number(top) }), pretty);
    return;
  }

  if (cmd === "warehouse") {
    const usage = "Usage: novel warehouse list [--source <name>] [<novel-dir>] | add <name> <folder> --licence <SPDX> --why <text> [...] | fetch <name> <url> --licence <SPDX> --ok '<words>' --why <text> [--path <folder>] [--limit <MB>] | refresh <name> | find '<words>' [--kind '<thing kind>'] [...] | show <source>:<part> | use <source>:<part> for <slot> <novel-dir> --why <text> [--place <id>] [--before] [--floors a b] | interact <source>:<part>|'<kind>' ['<json>'] <novel-dir> [--why <text>] [--before]";
    const number = (name: string) => { const value = flag(positional, name); return value === undefined ? undefined : Number(value); }, free = (n: number) => (positional[n] && !positional[n].startsWith("--") ? positional[n] : undefined);
    // A trailing book folder after the flags (novel warehouse find '<words>' --top 5 <novel-dir>): the last token, unless it is a flag or a flag's value.
    const VALUE_FLAGS = new Set(["--kind", "--category", "--size", "--source", "--top", "--licence", "--why", "--from", "--categories", "--allowed-by", "--unit", "--ok", "--path", "--limit", "--place", "--floors"]);
    const trailing = (from: number) => { const last = positional.at(-1); return positional.length > from && last && !last.startsWith("--") && !VALUE_FLAGS.has(positional.at(-2) ?? "") ? last : undefined; };
    const json = (name: string) => { const value = flag(positional, name); if (value === undefined) return undefined; try { return JSON.parse(value) as Record<string, string>; } catch { throw new Error(`${name} takes JSON`); } };
    if (sub === "list") { out(await warehouseList({ source: flag(positional, "--source"), novelDir: trailing(2) }), pretty); return; }
    if (sub === "add") { if (!free(2) || !free(3)) throw new Error(usage); out(await warehouseAdd(positional[2], positional[3], { licence: flag(positional, "--licence") ?? "", why: flag(positional, "--why") ?? "", url: flag(positional, "--from") ?? null, kind: flag(positional, "--kind") as "scad" | "gltf" | undefined, categories: json("--categories"), allowedBy: flag(positional, "--allowed-by"), unit: flag(positional, "--unit") as "m" | "kit" | undefined }), pretty); return; }
    if (sub === "fetch") { if (!free(2) || !free(3)) throw new Error(usage); out(await warehouseFetch(positional[2], positional[3], { licence: flag(positional, "--licence") ?? "", why: flag(positional, "--why") ?? "", ok: flag(positional, "--ok") ?? "", path: flag(positional, "--path"), limitMB: number("--limit"), kind: flag(positional, "--kind") as "scad" | "gltf" | undefined, categories: json("--categories"), allowedBy: flag(positional, "--allowed-by"), unit: flag(positional, "--unit") as "m" | "kit" | undefined }), pretty); return; }
    if (sub === "refresh") { if (!free(2)) throw new Error(usage); out(await warehouseRefresh(positional[2]), pretty); return; }
    if (sub === "find") { if (!free(2)) throw new Error(usage); out(await warehouseFind(positional[2], { kind: flag(positional, "--kind"), category: flag(positional, "--category"), size: number("--size"), source: flag(positional, "--source"), top: number("--top"), novelDir: trailing(3) }), pretty); return; }
    if (sub === "show") { if (!free(2)) throw new Error(usage); out(await warehouseShow(positional[2], { novelDir: trailing(3) }), pretty); return; }
    if (sub === "interact") {
      const key = free(2); if (!key) throw new Error(usage);
      const withSheet = positional[4] && !positional[4].startsWith("--") ? true : false, novelDir = withSheet ? positional[4] : free(3);
      if (!novelDir) throw new Error("novel warehouse interact <source>:<part>|'<kind>' ['<json sheet>'] <novel-dir> [--why <text>] [--before]");
      out(await warehouseInteract(novelDir, key, withSheet ? positional[3] : undefined, { why: flag(positional, "--why"), before: positional.includes("--before") }), pretty);
      return;
    }
    if (sub === "use") {
      if (!free(2) || positional[3] !== "for" || !free(4) || !free(5)) throw new Error(usage);
      const floorsAt = positional.indexOf("--floors"), floors = floorsAt >= 0 ? [Number(positional[floorsAt + 1]), Number(positional[floorsAt + 2])] as [number, number] : undefined;
      if (floors && floors.some((v) => !Number.isFinite(v))) throw new Error("--floors takes two numbers: the least and the most floors the part stands for");
      out(await warehouseUse(positional[5], positional[2], positional[4], { why: flag(positional, "--why"), place: flag(positional, "--place"), before: positional.includes("--before"), floors }), pretty);
      return;
    }
    throw new Error(usage);
  }

  if (cmd === "sky") {
    const novelDir = positional[2];
    if (!["build", "show"].includes(sub ?? "") || !novelDir) throw new Error("Usage: novel sky build|show <novel-dir> [--dry] [--cache <dir>]");
    out(await sky(novelDir, sub!, { dry: positional.includes("--dry"), cache: flag(positional, "--cache") }), pretty);
    return;
  }

  if (cmd === "world") {
    const novelDir = positional[2];
    if (!["pool", "batch", "answer", "log", "held", "apply", "canon", "undo"].includes(sub ?? "") || !novelDir) throw new Error("Usage: novel world pool <novel-dir> | batch <novel-dir> <batch-id> | answer <novel-dir> <batch-id> <item> <option> --reason <text> | log <novel-dir> --scene|--person|--card <id> | held <novel-dir> [--run <id>] [--budget N] | apply <novel-dir> | canon <novel-dir> [--run <id>] | undo <novel-dir> --run <id>");
    if (sub === "pool") { out(await worldPool(novelDir), pretty); return; }
    if (sub === "log") { out(await worldLogShow(novelDir, { scene: flag(positional, "--scene"), person: flag(positional, "--person"), card: flag(positional, "--card"), run: flag(positional, "--run") }), pretty); return; }
    if (sub === "held") { const budget = flag(positional, "--budget"); out(await worldHeld(novelDir, { run: flag(positional, "--run"), budget: budget === undefined ? undefined : Number(budget) }), pretty); return; }
    if (sub === "apply") { out(await worldApply(novelDir), pretty); return; }
    if (sub === "canon") { out(await worldCanon(novelDir, { run: flag(positional, "--run") }), pretty); return; }
    if (sub === "undo") { out(await worldUndo(novelDir, { run: flag(positional, "--run") }), pretty); return; }
    if (sub === "batch") { if (!positional[3]) throw new Error("Usage: novel world batch <novel-dir> <batch-id>"); out(await worldBatch(novelDir, positional[3]), pretty); return; }
    const reason = flag(positional, "--reason");
    if (!positional[3] || !positional[4] || !positional[5] || positional[5].startsWith("--") || !reason) throw new Error("Usage: novel world answer <novel-dir> <batch-id> <item> <option> --reason <text>");
    out(await worldAnswer(novelDir, positional[3], positional[4], positional[5], reason), pretty);
    return;
  }

  // Not a command (any more): v1's commands live in archive/cli/ (2026-11-11).
  throw new NovelError(`Unknown command: novel ${positional.join(" ")}`, { aspect: "usage", code: "INVALID_ARGUMENT", hint: "novel help lists the commands; v1's (library, ingest, changeset, review, causality, timeplace, stage, graph, query, …) were archived: archive/cli/." });
}

main().catch(async (err) => {
  // One agent-readable report: what kind of failure (aspect, code), why, the evidence the CLI
  // observed, where the problem is and graded fixes (`novel explain <code>` for the long form).
  const argv = process.argv.slice(2).filter((value) => value !== "--pretty");
  const base = describeError(err, argv);
  const report = await diagnose(base, argv).catch(() => base);
  console.error(JSON.stringify(report));
  process.exit(EXIT_CODES[report.aspect]);
});
