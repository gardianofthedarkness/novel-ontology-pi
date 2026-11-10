#!/usr/bin/env node
/**
 * novel — the CLI half of the Skill + CLI bundle.
 *
 * The Pi agent (guided by skills/novel-ontology/SKILL.md) calls ONLY this
 * CLI. The CLI owns all functionality: sectioning, the System 1 miniloop,
 * extraction, the merge gate, and the database connectors.
 * All commands print JSON by default; add --pretty for humans.
 */
import { describeError, EXIT_CODES, NovelError } from "../ground/errors.js";
import { ERROR_CATALOG } from "../ground/errorCatalog.js";
import { diagnose } from "./diagnose.js";
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { EventLog } from "../ground/events/log.js";
import { watchCommand } from "../ground/watch/command.js";
import { loadConfig } from "./config.js";
import {
  novelQuery,
  novelSearch,
  novelState,
  timelineList,
  timelineShow,
  DEFAULT_MIN_IMPORTANCE,
  DEFAULT_SEARCH_LIMIT,
} from "./commands/shared/queryCommands.js";
import { llmPing, llmProbe } from "./commands/shared/llmCommands.js";
import { ingestNovel } from "./commands/extract/ingestCommands.js";
import { libraryCommand } from "./commands/extract/libraryCommands.js";
import { universeCommand } from "./commands/extract/universeCommands.js";
import { emShow, emSweep } from "./commands/extract/emCommands.js";
import { calendarCommand } from "./commands/extract/calendarCommands.js";
import {
  listCausalityCandidates,
  proposeCausalityLink,
  runCausalitySweep,
} from "./commands/extract/causalityCommands.js";
import { runFix } from "./commands/extract/fixCommands.js";
import { runRecall } from "./commands/extract/recallCommands.js";
import {
  jevLogin,
  jevLogout,
  jevPing,
  jevStatus,
} from "./commands/shared/jevCommands.js";
import { resolveJevKey } from "../ground/connectors/secrets.js";
import { inspectNovel } from "./commands/extract/inspectCommands.js";
import { albumImport, albumList, albumPortraits } from "./commands/extract/albumCommands.js";
import { albumAssign } from "./commands/extract/portraitCommands.js";
import { evalExtract, evalRun } from "./commands/extract/evalCommands.js";
import { evalDialogueCards } from "./commands/extract/dialogueEval.js";
import { evalStoryOrder } from "./commands/extract/storyOrderEval.js";
import { sectionBlock } from "../digger/intake/sectioning.js";
import { cutBlocks } from "../digger/intake/blocks.js";
import { initWorkspace } from "../ground/workspace/init.js";
import { buildGraphFromBundle, LadybugStore } from "../ground/connectors/ladybug.js";
import { exportBundle, importBundle } from "../ground/connectors/bundleTransfer.js";
import { reviewPage } from "../solidifier/merge/reviewPage.js";
import { reviseProposals } from "../solidifier/merge/revise.js";
import { decideFacts, semanticPage } from "../solidifier/merge/semanticCommands.js";
import { causalityEvidence } from "../solidifier/causality/evidence.js";
import { universeCausalityCommand } from "./commands/extract/universeCausalityCommands.js";
import { reviewCommand } from "./commands/extract/reviewCommands.js";
import { approveBook } from "../solidifier/merge/approve.js";
import { atlasCommand } from "./commands/extract/atlasCommands.js";
import { checklistCommand } from "./commands/extract/checklistCommands.js";
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
import { modelBind, modelBrief, modelCheck, modelList, modelNominate, modelParts, modelPut, modelShow, modelUse, modelWrite } from "./commands/extract/modelCommands.js";
import { readingShow, sourceEpub, worldApply, worldCanon, worldHeld, worldLogShow, worldUndo } from "./commands/extract/worldReviewCommands.js";
import { STAGE_USAGE, stageArchitecture, stageLandscape, stageLines, stageMovement, stageObjects, stagePrep, stageScale, stageShow } from "./commands/extract/stageCommands.js";
import { TIMEPLACE_USAGE, timeplaceAfterApprove, timeplaceRun, timeplaceShow, timeplaceStrands, timeplaceTree } from "./commands/extract/timeplaceCommands.js";
import {
  listChangeSets,
  loadChangeSet,
  setChangeSetStatus,
} from "../solidifier/merge/changesetStore.js";

const COMMANDS: Record<string, string> = {
  "novel review show|evidence|decide|apply <root> <packet> --scope book|universe|library [--universe <id>]": "One semantic gate for every faculty: paged assertions/evidence, revision-bound accept|hold|reject, staged decisions, explicit apply. Evidence uses --fact; mutations use --revision; decide uses --decisions '<JSON>'. Unreviewed assertions remain held.",
  "novel init <path>": "Create a novel workspace + bundle manifest",
  "novel library init <library-dir>": "Create a private, versioned multi-file library; no model calls",
  "novel universe snapshots|snapshot|status|restore <library> ...": "A universe's snapshots: one before each book's first run (where a rerun starts) and one after each run; restore puts a snapshot back (what it replaces is snapshotted first)",
  "novel universe export <library> <snapshot> <out.tgz>": "Pack a run's result (with the snapshot before it) for another user; the books' text is not included",
  "novel universe import <bundle> <library> [--source vol-<n>=<file>]": "Start a universe from another user's bundle; your copy of each book is checked by sha256",
  "novel universe paths|adopt <library>": "The library's fixed paths; adopt gives a library made before snapshots its first ones",
  "novel library add <library-dir> <file.epub|file.txt> [--title <title>]": "Register an immutable source by content hash; identical files deduplicate",
  "novel library show <library-dir> [--series <id> | --universe <id> | --continuity <id>]": "Inspect source identities, reviewed organization and reading order; scoped results exclude unresolved assignments",
  "novel library evidence <library-dir> <source-id> [--offset N --limit N]": "Read up to 2000 original-language characters for organization evidence; no model calls",
  "novel library propose <library-dir> [<organization.json> | --organization '<JSON>'] --revision <catalog-revision>": "Validate an evidence-backed organization plan without applying it",
  "novel library plan <library-dir> <plan-id>": "Read the complete immutable proposal, review revision and stale status before deciding",
  "novel library decide <library-dir> <plan-id> --revision <plan-revision> --decision approve|hold|reject --reason <text>": "Record an audited independent review; only approve changes library organization, never ontology facts",
  "novel library prepare <library-dir> <source-id>": "Create one isolated source-bound workspace, including offline EPUB intake; never ingest or start a model",
  "novel library history <library-dir>": "List immutable library checkpoints; restore organization by proposing a new reviewed plan",
  "novel watch <novel-dir> [--port N]": "Read-only loopback SSE over the processing event log",
  "novel section <file>": "Deterministic sentence sectioning only (free, testable)",
  "novel blocks <file> [--size N]": "Chapter detection + block cutting map (no models)",
  "novel init <path> --world-first": "A world-first workspace: its base layer is applied without fact review, and the world loop decides presence, place, time and dialogue (docs/world-first-design.md)",
  "novel ingest <novel-dir> <file> [--auto-approve | --base-layer] [--max-blocks N] [--block-size N] [--no-extract] [--no-causality] [--time-place]":
    "Full loop: blocks -> miniloop (live Jev) -> extraction (work LLM, when configured) -> ChangeSets -> merge gate -> graph. Default stops at the first gate; --auto-approve applies every ChangeSet. Causality waits for story time and strands: ingest only marks the causality sweep pending (novel checklist runs it after them); --no-causality skips even that",
  "novel causality candidates <novel-dir> [--unit ID] [--chapter N] [--limit N]":
    "List hybrid-nominated CAUSES candidates (graph patterns + embedding top-K) for agent adjudication. No proposals are created.",
  "novel causality propose <novel-dir> <from> <to> [--reason \"...\"]":
    "Agent-adjudicated CAUSES proposal (event or dialogue-card ids). Lands in a pending_review changeset for the gate; refuses self-links, existing links, and order-contradicted directions.",
  "novel causality evidence <novel-dir> <from> <to> [--changeset ID] [--offset N --limit N]":
    "Read revision-bound original source passages for both causal endpoints; missing provenance is explicit.",
  "novel causality universe candidates|sweep|evidence|propose|show|decide|list <library-dir> <universe-id> ...":
    "Cross-file causal ledger for reviewed universe/continuity membership; qualified IDs, independent source review, bounded Jev batches, no book database fusion.",
  "novel timeplace run <novel-dir> [--mode hybrid|llm|programmatic] [--no-jev] [--chapter N] [--limit N] [--max-calls N] [--max-questions N] [--cache dir] [--out file] [--propose] [--force]":
    "Time-place faculty (phase 1): time words and places become TimePoint/Location entities that scenes belong to; Jev marks flashback signs; code builds periods and an estimated story order. By default runs only scenes without time facts, continuing the book's stored periods (as at birth); --force re-runs selected scenes from scratch. Writes a report; --propose saves a pending_review ChangeSet. Never writes canon. `novel changeset approve ... --time-place` runs it for a just-approved block.",
  "novel timeplace tree <novel-dir> [--no-jev] [--max-questions N] [--cache dir] [--out file] [--propose]":
    "Place-tree sweep (phase 2): nominate place pairs (name prefix, same sentence, same scene), let Jev judge which is inside which, and with --propose save a pending ChangeSet of PART_OF links (one parent per place) for the shared review gate. Never writes canon.",
  "novel checklist <novel-dir> [--input <file>] | novel checklist <library-dir> --universe <universe-id>":
    "What a completed analysis still lacks, in dependency order: each faculty's status (done/todo/review/blocked/optional), counts and the exact next command. Read-only. Run it first when asked to inspect a novel, continue, or find missing pieces.",
  "novel atlas sweep <library-dir> <universe-id> [--propose] [--no-jev] [--max-questions N]":
    "Universe atlas (phase 3): nominate places across a universe's books (same name, scoped generic places, name prefix), let Jev judge same place / inside / neither, and with --propose save a pending ua_ packet for `novel review ... --scope universe --universe <id>`. Book databases are never fused.",
  "novel atlas show <library-dir> <universe-id>":
    "The universe's places: one per cluster of book places, with its path through the universe place tree.",
  "novel timeplace strands <novel-dir> [--ask] [--max-questions N] [--min-impact N] [--cache dir] [--out file]":
    "Story strands from stored story time: parallel scenes, splits and meetings checked against places; plans \"who is present?\" questions only where a borrowed cast creates a strand link (free), and asks them with --ask (work model, 4 scenes per call), at most --max-questions (default 30), only in chapters of at least --min-impact scenes (default 8); report only, no canon writes",
  "novel sim strands|pick|run|show <novel-dir> [--auto N] [--strand id] [--max-calls N] [--accept]":
    "The stage simulation (view data, never canon): `strands` ranks the book's story lines by the scenes the engine would simulate; `pick` simulates those lines live, event by event (headless Chrome): on a picture of each event as it begins, Jev decides where the people go, where the things it mentions stand and where its fight hits and how big, the next event beginning from what those answers made, within --max-calls, keeping every decision for the runs; `run` (no model calls) runs the engine (buildings as skeletons from the place tree, the per-fork walk with the path-integral sampler, placed things, damage) on the first N lines (--auto N) or one (--strand id) and keeps each as a versioned run with the player's data (a line's first run is its accepted one; --accept takes this run instead); `show` lists each line's accepted run and whether it was made from the book as it is now. The viewer plays accepted runs at play/, and what a running pick or run is doing at play/live.",
  "novel stage show|lines|objects|scale|architecture|movement|prep <novel-dir> [--no-jev] [--no-work] [--max-calls N] [--cache dir] [--force] [--line scene-id]":
    "Read mode's stage (view inputs, never canon, no review; run on request, apart from the book's analysis, from reviewed canon only: each paid step waits for the analysis steps it builds on unless --force): `scale` sizes each place of the tree, region to room (one Jev choice per place; the stage builds places by it); `objects` lists the buildings and large visible things each staged scene puts in its place, matched to what the stage can draw (work model, a few scenes per call, within --max-calls); `lines` shows the timeline as the simulation walks it, story line by story line (each scene's own cast and where each person comes from; --line lists one line's scenes; no model calls; not `novel fork`, which branches the story); `architecture` picks each place's building, a sub-kind of place (name shortlist, then Jev picks among pictures); `movement` asks Jev who moves where inside each scene's building and how (needs the whole file extracted and the buildings picked; --max-calls bounds a run, never exceeded: `novel stage show` gives maxRequests, enough to finish in one run; answers are kept and later runs continue); `prep` is the animation prep, last of all once every analysis step is done and both reports are current: each chain checked physically, one movement plan per place (no model calls). Answers are reused while their inputs stay the same.",
  "novel timeplace show <novel-dir>":
    "Applied time periods in story order, places as paths through the place tree, and the tree's links.",
  "novel causality sweep <novel-dir> [--limit N]":
    "On-demand systematic sweep: Jev-determined CAUSES pass over the whole universe (same machinery as the ingest chapter-close sweep).",
  "novel calendar show|build <novel-dir> | <library-dir> --universe <id>":
    "The universe calendar: one clock for every book of a universe. Each story period on its day (clock time or part of the day; undated ones as a range between dated neighbours); books as marks on it; years nobody states are relative (Year 1 = first dated book) and a book whose dates go back is raised for review (ut_ packet). Rebuilt after every story-time apply; no model calls.",
  "novel em show|sweep <novel-dir> [--limit N]":
    "Universal EM: one shared character list per universe (the library's, or the book's own when standalone). show: this book's people and identity matches awaiting review; sweep: check every character of the book against the book and the universe (full proper names join automatically, confident Jev matches merge, less confident ones become a um_ review packet).",
  "novel fix merge|rename|add-form|relate|unrelate|remove-entity|remove-event <novel-dir> ...":
    "Pointwise maintenance over the bundle (audited in maintenance.jsonl, graph rebuilt): merge two entities, rename, add a name form, relate/unrelate, remove a record",
  "novel fix correct <novel-dir> --block <id> --key <decision-key> --value <v>":
    "Pin a System 1 decision for a block (recall protocol): the re-run honors the pin instead of re-deciding",
  "novel fix corrections <novel-dir>": "List the pinned corrections in a workspace",
  "novel recall <novel-dir> <blockId>":
    "Recall System 1 for one block: re-run it from the stored source with pinned corrections honored; a fresh held ChangeSet replaces the superseded one (kept for audit)",
  "novel miniloop run|inspect": "Run the Jev miniloop; inspect per-window decisions",
  "novel changeset list|show|approve|hold|revise <novel-dir> [id]":
    "The merge gate: review accumulated proposals before they touch the main graph",
  "novel changeset show <novel-dir> <id> [--summary | --offset N --limit N [--notes]]":
    "Read a bounded proposal or review-note page; follow page.nextOffset until null",
  "novel changeset facts <novel-dir> <id> [--summary | --offset N --limit N | --fact <fact-id>]":
    "Read compact consequential assertions with source excerpts, or page one fact's full evidence; boundaries and minor event detection are code-validated",
  "novel changeset decide <novel-dir> <id> --revision <hash> --decisions '<JSON>'":
    "Record at most 50 source-grounded accept/hold/reject decisions; optional replacement changes only that fact. Unreviewed facts remain held",
  "novel graph build <bundle-dir> [db-path]": "(Re)build the Ladybug store from the bundle",
  "novel graph query <db-path> <cypher>": "Raw Cypher against the Ladybug store",
  "novel graph stats <db-path>": "Node/relation counts per table",
  "novel query <novel-dir> <cypher>": "OntologyStore query (graph traversal)",
  "novel source grep <novel-dir> <regex> [--limit N]": "Original sentences matching a regular expression, with sentence and scene ids (read-only)",
  "novel source similar <novel-dir> <text> [--limit N]": "The original passages most like a text (lexical retrieval), with sentence and scene ids (read-only)",
  "novel world pool|batch|answer <novel-dir> …": "World-first review pool: what the world flagged, a batch for the main agent, and its answers (novel world answer <dir> <batch> <item> <option> --reason <text>)",
  "novel world log <novel-dir> --scene|--person|--card <id> [--run <id>]": "The world log of the last director run: who was where, moves, meetings, blasts, and the laws' verdicts (read-only)",
  "novel world held <novel-dir> [--run <id>] [--budget N]": "A director run's held items (what the laws could not settle, and the user's notes) into the review pool, one batch per scene by reach",
  "novel world apply <novel-dir>": "The main agent's answers into the pins the director plays by, under the laws (what they turn back returns to the pool)",
  "novel folder scan|show|universe|put|take|link|unlink|chapters|cast|who|refs|line|problems|serve <folder> …": "v3: the opened folder as a workspace of novels (docs/v3/workspace.md): every EPUB and text file under it found (scan); the folder as universes, their books in order and the unsorted files, with each file's first lines for sorting (show [--opening N]); a universe made, renamed or removed (universe <name> [--why t] [--rename n] [--remove]); a file put into a universe at a place in its order, or taken out (put <file> <universe> [--at N] [--title t]; take <file>); an existing reading linked to a book, read-only (link <file> <novel-dir> [--reading data.json]; unlink); a book's chapters and smaller parts (chapters <file> [--depth chapters|parts|cards]); its people, places, things and concepts (cast <file> [--query t]); one entry's record (who <file> <name or id>); every line that refers to it, with how and how sure (refs <file> <name or id> [--how h] [--chapter N] [--scene N] [--guesses] [--via] [--universe] [--limit N], 30 shown unless --limit says more); a line with the lines around it (line <file> <line id>); the reading's doubtful credits (problems <file>); the language server over stdio (serve)",
  "novel volume status|run|log|done <novel-dir> …": "A whole volume step by step (novel-volume skill): each step's status (status); the steps from the first not done up to the agent's look pass, or one step, or up to a step, started in the background (run [--step <id> | --until <id>]); a step's log (log <step> [--lines N]); the agent's look pass marked done (done look --why t)",
  "novel strands register|inherit|set|keep|show <novel-dir> …": "What a book carries into the next, per strand (docs/v2/borrow-and-spawn.md §4.5): the book's strands at its end into the universe's registry (register [--run <id>]); at the next book's reading each open strand of the last book inherited (its damage to buildings that are not nominated stays) or closed (they stand whole) (inherit [--work] [--dry]); the main agent's override (set <strand key> inherited|closed --why t [--into <key>]); a run's damage into the universe building by building (keep --run <id>); the registry and the damage in force (show)",
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
  "novel search <novel-dir> <text> [--limit N]":
    "Graph-first text search (Cypher CONTAINS scan)",
  "novel state <novel-dir> <character-id> [--at <event-id>]":
    "Character state at a point — the deterministic fold of state deltas (bundle)",
  "novel timeline list|show <novel-dir> [timeline-id]":
    "Browse timelines / time points (chapter / event, by importance)",
  "novel fork create --at <event-id> --label <name>": "Fork a parallel universe at a time point",
  "novel simulate <character> [--branch <id>]": "Character simulation on canon or a branch",
  "novel bundle export <novel-dir> <out-dir>":
    "Export the portable bundle (JSONL + manifest; graph DB and secrets excluded)",
  "novel bundle import <bundle-dir> <target-dir>":
    "Import a bundle into a new novel dir (validates first; never overwrites)",
  "novel graph reindex": "Deferred: no vector/FTS indexes in the graph-first phase",
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
  "novel album import <novel-dir> <epub-file>":
    "Pre-process at intake: spine-walk an EPUB in reading order, images to assets/, extracted text to source/ (ingest that file), sentence-identity anchors to ontology/illustrations.jsonl",
  "novel album list <novel-dir> [--block-size N]":
    "List illustrations with each anchor resolved to chapter / block / sentence / scene (scene once the block is ingested)",
  "novel album portraits <novel-dir>":
    "Portrait finalization: EM-merge follow, birth fold-match binding, then reviewer tasks for characters still without a portrait (skipped when the host is known not to support visual input; portraits stay hidden until bound)",
  "novel album assign <novel-dir> [--check]":
    "After full-volume extraction/application: local OCR/head crops and unique character assignment; --check reports readiness/dependencies without writes. Preserves existing portraits; ambiguous matches stay unassigned.",
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

  if (cmd === "init") {
    const worldFirst = positional.includes("--world-first");
    if (!sub?.trim() || sub.startsWith("--") || positional.length !== (worldFirst ? 3 : 2)) {
      throw new Error("Usage: novel init <path> [--world-first] [--pretty]");
    }
    out(await initWorkspace(sub, { worldFirst }), pretty);
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

  if (cmd === "library") {
    out(await libraryCommand(positional.slice(1)), pretty);
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

  if (cmd === "album") {
    if (sub === "assign" && positional[2] && (positional.length === 3 || positional.length === 4 && positional[3] === "--check")) {
      out(await albumAssign(positional[2], positional[3] === "--check"), pretty);
      return;
    }
    if (sub === "import" && positional.length === 4 && positional[2] && positional[3] && !positional[3].startsWith("--")) {
      out(await albumImport(positional[2], positional[3]), pretty);
      return;
    }
    if (sub === "list" && positional[2] && (positional.length === 3 || positional.length === 5 && positional[3] === "--block-size")) {
      const rawSize = flag(positional, "--block-size");
      const blockSize = rawSize === undefined ? undefined : Number(rawSize);
      if (blockSize !== undefined && (!Number.isInteger(blockSize) || blockSize < 100)) {
        throw new Error(`novel album list --block-size must be an integer >= 100 (got: ${rawSize})`);
      }
      out(await albumList(positional[2], blockSize), pretty);
      return;
    }
    if (sub === "portraits" && positional.length === 3 && positional[2]) {
      out(await albumPortraits(positional[2]), pretty);
      return;
    }
    throw new Error("Usage: novel album import <novel-dir> <epub-file> | novel album list <novel-dir> [--block-size N] | novel album portraits <novel-dir> | novel album assign <novel-dir> [--check]");
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

  if (cmd === "watch") {
    await watchCommand(positional.slice(1));
    return;
  }

  if (cmd === "section" && sub) {
    const text = await readFile(sub, "utf8");
    const { sentences, paragraphCount } = sectionBlock(text, 0);
    out({ file: sub, paragraphCount, sentences }, pretty);
    return;
  }

  if (cmd === "blocks" && sub) {
    const text = await readFile(sub, "utf8");
    const size = Number(flag(positional, "--size") ?? 24000);
    const blocks = cutBlocks(text, size);
    out(
      {
        file: sub,
        blockCount: blocks.length,
        blocks: blocks.map((b) => ({
          id: b.id,
          chapterIndex: b.chapterIndex,
          chapterTitle: b.chapterTitle,
          startOffset: b.startOffset,
          endOffset: b.endOffset,
          charCount: b.charCount,
          opening: b.text.slice(0, 40).replace(/\n/g, " "),
        })),
      },
      pretty,
    );
    return;
  }

  if (cmd === "graph" && sub === "build" && positional[2]) {
    const bundleDir = positional[2];
    const dbPath = positional[3] ?? join(bundleDir, "graph.lbug");
    const counts = await buildGraphFromBundle(bundleDir, dbPath, new EventLog(dirname(resolve(bundleDir))).emit);
    out({ status: "built", bundleDir, dbPath, counts }, pretty);
    return;
  }

  if (cmd === "graph" && sub === "query" && positional[2] && positional[3]) {
    const store = new LadybugStore(positional[2]);
    const rows = await store.run(positional.slice(3).join(" "));
    out({ rows }, pretty);
    await store.close();
    return;
  }

  if (cmd === "graph" && sub === "stats" && positional[2]) {
    const store = new LadybugStore(positional[2]);
    const tables = [
      "Character", "Location", "Organization", "Item", "Concept", "TimePoint",
      "Event", "Scene", "Timeline", "Branch",
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const rows = await store.run(`MATCH (n:${t}) RETURN count(n) AS c`);
      counts[t] = Number(rows[0]?.c ?? 0);
    }
    out({ dbPath: positional[2], counts }, pretty);
    await store.close();
    return;
  }

  if (cmd === "review") { out(await reviewCommand(positional.slice(1)), pretty); return; }

  if (cmd === "changeset" && sub && positional[2]) {
    const novelDir = positional[2];
    if (sub === "list") {
      const all = await listChangeSets(novelDir);
      out(
        {
          novelDir,
          changesets: all.map((c) => ({
            id: c.id,
            blockId: c.blockId,
            status: c.status,
            proposals: c.proposals.length,
            createdAt: c.createdAt,
          })),
        },
        pretty,
      );
      return;
    }
    const id = positional[3];
    if (!id) throw new Error(`changeset ${sub} needs a changeset id`);
    if (sub === "facts") {
      const options = positional.slice(4);
      for (let index = 0; index < options.length; index++) {
        if (options[index] === "--summary") continue;
        if (["--offset", "--limit", "--fact"].includes(options[index]) && options[index + 1]) { index++; continue; }
        throw new Error("Unsupported fact page option");
      }
      out(await semanticPage(novelDir, id, { summary: options.includes("--summary"), factId: flag(options, "--fact"), offset: flag(options, "--offset") === undefined ? undefined : Number(flag(options, "--offset")), limit: flag(options, "--limit") === undefined ? undefined : Number(flag(options, "--limit")) }), pretty);
      return;
    }
    if (sub === "decide") {
      const options = positional.slice(4);
      if (options.length !== 4 || !flag(options, "--revision") || !flag(options, "--decisions") || new Set([options[0], options[2]]).size !== 2 || ![options[0], options[2]].every(option => ["--revision", "--decisions"].includes(option))) throw new Error("Use --revision <current hash> --decisions '<JSON array>'");
      out(await decideFacts(novelDir, id, flag(options, "--revision")!, JSON.parse(flag(options, "--decisions")!)), pretty);
      return;
    }
    if (sub === "show") {
      const changeset = await loadChangeSet(novelDir, id);
      const options = positional.slice(4);
      for (let index = 0; index < options.length; index++) {
        if (["--summary", "--notes"].includes(options[index])) continue;
        if (["--offset", "--limit"].includes(options[index]) && /^\d+$/.test(options[index + 1] ?? "")) { index++; continue; }
        throw new Error("Usage: novel changeset show <novel-dir> <id> [--summary | --offset N --limit N [--notes]]");
      }
      out(options.length ? reviewPage(changeset, {
        offset: flag(options, "--offset") === undefined ? undefined : Number(flag(options, "--offset")),
        limit: flag(options, "--limit") === undefined ? undefined : Number(flag(options, "--limit")),
        notes: options.includes("--notes"), summary: options.includes("--summary"),
      }) : changeset, pretty);
      return;
    }
    if (sub === "hold") {
      const cs = await setChangeSetStatus(novelDir, id, "held");
      out({ id: cs.id, status: cs.status }, pretty);
      return;
    }
    if (sub === "revise") {
      const options = positional.slice(4);
      if (options.length !== 4 || !flag(options, "--edits") || !flag(options, "--reason")) throw new Error("Usage: novel changeset revise <dir> <id> --edits '<JSON>' --reason '<source-grounded reason>'");
      for (let index = 0; index < options.length; index += 2) if (!["--edits", "--reason"].includes(options[index])) throw new Error("Unsupported revision option.");
      out(await reviseProposals(novelDir, id, JSON.parse(flag(options, "--edits")!), flag(options, "--reason")!), pretty);
      return;
    }
    if (sub === "approve") {
      const application = await approveBook(novelDir, id);
      const cs = await loadChangeSet(novelDir, id);
      let timePlace: Record<string, unknown> | null = null;
      if (positional.includes("--time-place")) {
        try { timePlace = await timeplaceAfterApprove(novelDir, cs); }
        catch (error) { timePlace = { error: error instanceof Error ? error.message : String(error) }; }
      }
      out(
        { ...application, ...(timePlace ? { timePlace } : {}) },
        pretty,
      );
      return;
    }
  }

  if (cmd === "ingest") {
    const novelDir = positional[1];
    const file = positional[2];
    if (!novelDir || !file || file.startsWith("--")) {
      throw new Error(
        "Usage: novel ingest <novel-dir> <file> [--auto-approve | --base-layer] [--max-blocks N] [--block-size N] [--no-extract] [--no-causality] [--time-place]",
      );
    }
    const maxBlocksRaw = flag(positional, "--max-blocks");
    const maxBlocks = maxBlocksRaw === undefined ? undefined : Number(maxBlocksRaw);
    if (maxBlocks !== undefined && (!Number.isInteger(maxBlocks) || maxBlocks < 1)) {
      throw new Error(`novel ingest --max-blocks must be a positive integer (got: ${maxBlocksRaw})`);
    }
    const blockSizeRaw = flag(positional, "--block-size");
    const blockSize = blockSizeRaw === undefined ? undefined : Number(blockSizeRaw);
    if (blockSize !== undefined && (!Number.isInteger(blockSize) || blockSize < 100)) {
      throw new Error(`novel ingest --block-size must be an integer >= 100 (got: ${blockSizeRaw})`);
    }
    out(
      await ingestNovel(novelDir, file, {
        autoApprove: positional.includes("--auto-approve"),
        baseLayer: positional.includes("--base-layer"),
        maxBlocks,
        blockSize,
        noExtract: positional.includes("--no-extract"),
        noCausality: positional.includes("--no-causality"),
        timePlace: positional.includes("--time-place"),
      }),
      pretty,
    );
    return;
  }

  if (cmd === "timeplace") {
    const novelDir = positional[2];
    if (!["run", "tree", "show", "strands"].includes(sub ?? "") || !novelDir || novelDir.startsWith("--")) throw new Error(`Usage: ${TIMEPLACE_USAGE}`);
    if (sub === "show") { out(await timeplaceShow(novelDir), pretty); return; }
    const valued = sub === "tree" ? ["--max-questions", "--out", "--cache"] : sub === "strands" ? ["--max-questions", "--min-impact", "--out", "--cache"] : ["--mode", "--chapter", "--limit", "--max-calls", "--max-questions", "--out", "--cache"], switches = sub === "tree" ? ["--no-jev", "--propose"] : sub === "strands" ? ["--ask"] : ["--no-jev", "--propose", "--force"];
    const seen = new Set<string>();
    for (let index = 3; index < positional.length; index++) {
      const name = positional[index];
      if (seen.has(name) || ![...valued, ...switches].includes(name)) throw new Error(`Usage: ${TIMEPLACE_USAGE}`);
      seen.add(name);
      if (valued.includes(name)) { const value = positional[++index]; if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`); }
    }
    const number = (name: string) => { const value = flag(positional, name); if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`); return parsed; };
    if (sub === "strands") { out(await timeplaceStrands(novelDir, { ask: positional.includes("--ask"), maxQuestions: number("--max-questions"), minImpact: number("--min-impact"), out: flag(positional, "--out"), cache: flag(positional, "--cache") }), pretty); return; }
    if (sub === "tree") { out(await timeplaceTree(novelDir, { jev: !positional.includes("--no-jev"), maxQuestions: number("--max-questions"), out: flag(positional, "--out"), cache: flag(positional, "--cache"), propose: positional.includes("--propose") }), pretty); return; }
    out(await timeplaceRun(novelDir, {
      mode: flag(positional, "--mode") as "hybrid" | "llm" | "programmatic" | undefined,
      jev: !positional.includes("--no-jev"), chapter: number("--chapter"), limit: number("--limit"),
      maxCalls: number("--max-calls"), maxQuestions: number("--max-questions"), out: flag(positional, "--out"), cache: flag(positional, "--cache"),
      propose: positional.includes("--propose"), force: positional.includes("--force"),
    }), pretty);
    return;
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

  if (cmd === "stage") {
    const novelDir = positional[2];
    if (!["show", "lines", "objects", "scale", "landscape", "architecture", "movement", "prep"].includes(sub ?? "") || !novelDir || novelDir.startsWith("--")) throw new Error(`Usage: ${STAGE_USAGE}`);
    const valued = sub === "movement" || sub === "objects" ? ["--max-calls", "--cache"] : sub === "architecture" || sub === "scale" || sub === "landscape" ? ["--cache"] : sub === "lines" ? ["--line"] : [], switches = sub === "prep" ? ["--force"] : sub === "scale" || sub === "landscape" ? ["--no-jev"] : sub === "show" || sub === "lines" ? [] : sub === "objects" ? ["--no-work", "--no-jev", "--force"] : ["--no-jev", "--force"];
    const seen = new Set<string>();
    for (let index = 3; index < positional.length; index++) {
      const name = positional[index];
      if (seen.has(name) || ![...valued, ...switches].includes(name)) throw new Error(`Usage: ${STAGE_USAGE}`);
      seen.add(name);
      if (valued.includes(name)) { const value = positional[++index]; if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`); }
    }
    const maxCalls = flag(positional, "--max-calls");
    if (maxCalls !== undefined && (!/^\d+$/.test(maxCalls) || Number(maxCalls) < 1)) throw new Error("--max-calls must be a positive integer.");
    const options = { jev: !positional.includes("--no-jev"), cache: flag(positional, "--cache"), maxCalls: maxCalls === undefined ? undefined : Number(maxCalls), force: positional.includes("--force") };
    out(await (sub === "show" ? stageShow(novelDir) : sub === "objects" ? stageObjects(novelDir, { ...options, work: !positional.includes("--no-work") }) : sub === "lines" ? stageLines(novelDir, { line: flag(positional, "--line") }) : sub === "scale" ? stageScale(novelDir, options) : sub === "landscape" ? stageLandscape(novelDir, options) : sub === "architecture" ? stageArchitecture(novelDir, options) : sub === "movement" ? stageMovement(novelDir, options) : stagePrep(novelDir, options)), pretty);
    return;
  }

  if (cmd === "checklist") { out(await checklistCommand(positional.slice(1)), pretty); return; }

  if (cmd === "atlas") { out(await atlasCommand(positional.slice(1)), pretty); return; }

  if (cmd === "causality") {
    const sub = positional[1];
    if (sub === "universe") { out(await universeCausalityCommand(positional.slice(2)), pretty); return; }
    const novelDir = positional[2];
    if (!sub || !novelDir || novelDir.startsWith("--")) {
      throw new Error(
        "Usage: novel causality candidates <novel-dir> [--unit ID] [--chapter N] [--limit N] | novel causality propose <novel-dir> <from> <to> [--reason \"...\"] | novel causality sweep <novel-dir>",
      );
    }
    const optionStart = ["propose", "evidence"].includes(sub) ? 5 : 3;
    const allowed = sub === "candidates" ? ["--unit", "--chapter", "--limit"] : sub === "propose" ? ["--reason"] : sub === "evidence" ? ["--changeset", "--offset", "--limit"] : sub === "sweep" ? ["--limit"] : [];
    const seen = new Set<string>();
    for (let index = optionStart; index < positional.length; index += 2) {
      const name = positional[index], value = positional[index + 1];
      if (!allowed.includes(name) || seen.has(name) || !value || value.startsWith("--")) throw new Error("Causality options require unique supported flags and values.");
      seen.add(name);
    }
    if (sub === "evidence") {
      if (!positional[3] || !positional[4]) throw new Error("Causal evidence needs from and to IDs.");
      out(await causalityEvidence(novelDir, positional[3], positional[4], {
        changesetId: flag(positional, "--changeset"),
        offset: flag(positional, "--offset") === undefined ? undefined : Number(flag(positional, "--offset")),
        limit: flag(positional, "--limit") === undefined ? undefined : Number(flag(positional, "--limit")),
      }), pretty);
      return;
    }
    if (sub === "candidates") {
      const chapterRaw = flag(positional, "--chapter");
      const limitRaw = flag(positional, "--limit");
      out(
        await listCausalityCandidates(novelDir, {
          unitId: flag(positional, "--unit"),
          chapterIndex: chapterRaw === undefined ? undefined : Number(chapterRaw),
          limit: limitRaw === undefined ? undefined : Number(limitRaw),
        }),
        pretty,
      );
      return;
    }
    if (sub === "propose") {
      const fromId = positional[3];
      const toId = positional[4];
      if (!fromId || !toId) throw new Error("Usage: novel causality propose <novel-dir> <from> <to> [--reason \"...\"]");
      out(
        await proposeCausalityLink(novelDir, fromId, toId, { reason: flag(positional, "--reason") }),
        pretty,
      );
      return;
    }
    if (sub === "sweep") {
      out(await runCausalitySweep(novelDir, { limit: flag(positional, "--limit") === undefined ? undefined : Number(flag(positional, "--limit")) }), pretty);
      return;
    }
    throw new Error(`Unknown causality subcommand ${sub} (candidates | propose | sweep)`);
  }

  if (cmd === "calendar") {
    out(await calendarCommand(positional.slice(1)), pretty);
    return;
  }

  if (cmd === "em") {
    const [sub, novelDir] = [positional[1], positional[2]];
    if (!novelDir || novelDir.startsWith("--") || !["show", "sweep"].includes(sub ?? "")) throw new Error("Usage: novel em show|sweep <novel-dir> [--limit N]");
    const limit = flag(positional, "--limit");
    if (limit !== undefined && !(Number.isInteger(Number(limit)) && Number(limit) > 0)) throw new Error("--limit must be a positive integer");
    out(sub === "show" ? await emShow(novelDir) : await emSweep(novelDir, { limit: limit === undefined ? undefined : Number(limit) }), pretty);
    return;
  }

  if (cmd === "fix" && sub) {
    const novelDir = positional[2];
    if (!novelDir || novelDir.startsWith("--")) {
      throw new Error(
        "Usage: novel fix <op> <novel-dir> [args] — ops: merge, rename, add-form, relate, unrelate, remove-entity, remove-event, correct, corrections",
      );
    }
    const flagNames = ["--reason", "--kind", "--block", "--key", "--value"];
    const rest: string[] = [];
    for (let i = 3; i < positional.length; i++) {
      if (flagNames.includes(positional[i])) {
        i++; // skip the flag's value
        continue;
      }
      if (positional[i].startsWith("--")) continue;
      rest.push(positional[i]);
    }
    out(
      await runFix(novelDir, sub, rest, {
        reason: flag(positional, "--reason"),
        kind: flag(positional, "--kind"),
        block: flag(positional, "--block"),
        key: flag(positional, "--key"),
        value: flag(positional, "--value"),
      }),
      pretty,
    );
    return;
  }

  if (cmd === "recall") {
    const novelDir = positional[1];
    const blockId = positional[2];
    if (!novelDir || !blockId || blockId.startsWith("--")) {
      throw new Error("Usage: novel recall <novel-dir> <blockId>");
    }
    out(await runRecall(novelDir, blockId), pretty);
    return;
  }

  if (cmd === "bundle" && sub === "export" && positional[2] && positional[3]) {
    const result = await exportBundle(positional[2], positional[3]);
    out({ status: "exported", ...result }, pretty);
    return;
  }

  if (cmd === "bundle" && sub === "import" && positional[2] && positional[3]) {
    const result = await importBundle(positional[2], positional[3]);
    out({ status: "imported", ...result }, pretty);
    return;
  }

  if (cmd === "query") {
    const novelDir = positional[1];
    const cypher = positional.slice(2).join(" ");
    if (!novelDir || !cypher) {
      throw new Error("Usage: novel query <novel-dir> <cypher>");
    }
    out(await novelQuery(novelDir, cypher), pretty);
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

  if (cmd === "search") {
    const novelDir = positional[1];
    const text = restText(positional.slice(2), ["--limit"]);
    if (!novelDir || !text) {
      throw new Error("Usage: novel search <novel-dir> <text> [--limit N]");
    }
    const rawLimit = flag(positional, "--limit");
    const limit =
      rawLimit === undefined ? DEFAULT_SEARCH_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(
        `novel search --limit must be a positive integer (got: ${rawLimit})`,
      );
    }
    out(await novelSearch(novelDir, text, limit), pretty);
    return;
  }

  if (cmd === "state") {
    const novelDir = positional[1];
    const characterId = positional[2];
    if (!novelDir || !characterId) {
      throw new Error("Usage: novel state <novel-dir> <character-id> [--at <event-id>]");
    }
    const at = flag(positional, "--at");
    out(await novelState(novelDir, characterId, at), pretty);
    return;
  }

  if (cmd === "timeline" && (sub === "list" || sub === "show")) {
    const novelDir = positional[2];
    if (!novelDir) {
      throw new Error(
        "Usage: novel timeline list|show <novel-dir> [timeline-id]",
      );
    }
    if (sub === "list") {
      out(await timelineList(novelDir), pretty);
      return;
    }
    const timelineId = positional[3];
    if (!timelineId || timelineId.startsWith("--")) {
      throw new Error(
        "Usage: novel timeline show <novel-dir> <timeline-id> [--min-importance N]",
      );
    }
    const rawMin = flag(positional, "--min-importance");
    const minImportance =
      rawMin === undefined ? DEFAULT_MIN_IMPORTANCE : Number(rawMin);
    if (!Number.isFinite(minImportance) || minImportance < 0 || minImportance > 1) {
      throw new Error(
        `novel timeline show --min-importance must be a number between 0 and 1 (got: ${rawMin})`,
      );
    }
    out(await timelineShow(novelDir, timelineId, minImportance), pretty);
    return;
  }

  // Everything else is specified in DESIGN.md and lands incrementally.
  out(
    {
      status: "not_implemented",
      command: positional.join(" "),
      note: "See DESIGN.md for the command contract; the roadmap page tracks what has landed.",
    },
    pretty,
  );
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
