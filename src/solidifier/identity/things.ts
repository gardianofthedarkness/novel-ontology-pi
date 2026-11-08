import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import type { Entity } from "../../ground/ontology/types.js";
import { castScope, formKeys, memberRef, type CastBook, type CastMember, type CastScope } from "./cast.js";
import type { PoolEntry } from "./recommender.js";

/**
 * The universe's named buildings and large things: ONE shared list beside
 * the character list (cast.ts), so the second book to name a thing names
 * the same thing the first book did. Every book keeps its own records (a
 * building is a Location in its place tree, a thing an Item); what a thing
 * IS lives here: every name form a book reviewed for it, and the book
 * records that are it.
 *
 * A record joins when its book applies a reviewed stage-objects packet:
 * one the identity check bound at birth to a thing of the list
 * (`properties.universalId`) becomes its member; any other is a new thing.
 * Stored at `<library>/cast/<universe>.things.json` (`<book>/cast/book.things.json`
 * for a standalone book), written atomically.
 */
export type ThingKind = "building" | "object";
export interface UniversalThing { id: string; name: string; kind: ThingKind; forms: string[]; members: CastMember[] }
export interface ThingsFile { version: 1; universeId: string; nextId: number; things: UniversalThing[] }

export const thingsPath = (scope: Pick<CastScope, "root" | "universeId">) => join(scope.root, "cast", `${scope.universeId}.things.json`);
/** A universe thing's reference in an identity pool. */
export const thingRef = (id: string) => `thing:${id}`;
/** Whether a book record is one of the stage's named buildings or things (stage objects), and which kind. */
export const thingKindOf = (entity: Entity): ThingKind | null => entity.kind === "Item" ? "object" : entity.kind === "Location" && entity.properties.source === "stage-objects" ? "building" : null;

export async function loadThings(scope: Pick<CastScope, "root" | "universeId">): Promise<ThingsFile> {
  try {
    const parsed = JSON.parse(await readFile(thingsPath(scope), "utf8")) as ThingsFile;
    if (parsed.version !== 1 || parsed.universeId !== scope.universeId) throw new Error("Things list belongs to another universe or version.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, universeId: scope.universeId, nextId: 1, things: [] };
    throw error;
  }
}

export async function saveThings(scope: Pick<CastScope, "root" | "universeId">, file: ThingsFile): Promise<void> {
  const path = thingsPath(scope);
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(file, null, 1), { mode: 0o600 });
  await rename(temporary, path);
}

const namesOf = (entity: Entity) => [...new Set(entity.names.flatMap((form) => formKeys(form.text)))];
const nameOf = (entity: Entity) => entity.names.find((form) => form.kind === "canonical")?.text ?? entity.names[0]?.text ?? entity.id;

/** The book's records join the list (idempotent): bound ones as members of their thing, the rest as new things. */
export function joinThings(file: ThingsFile, sourceId: string, entities: Entity[]): { joined: number; added: number } {
  let joined = 0, added = 0;
  for (const entity of entities) {
    const kind = thingKindOf(entity);
    if (!kind) continue;
    const member: CastMember = { sourceId, entityId: entity.id };
    const current = file.things.find((thing) => thing.members.some((entry) => memberRef(entry) === memberRef(member)));
    const bound = typeof entity.properties.universalId === "string" ? file.things.find((thing) => thingRef(thing.id) === entity.properties.universalId) : undefined;
    const thing = current ?? bound;
    if (thing) {
      if (!current) { thing.members.push(member); joined++; }
      thing.forms = [...new Set([...thing.forms, ...namesOf(entity)])];
      continue;
    }
    file.things.push({ id: `thing_${file.nextId++}`, name: nameOf(entity), kind, forms: namesOf(entity), members: [member] });
    added++;
  }
  return { joined, added };
}

/** After a stage-objects packet applies: the book's named buildings and things join the universe's list. */
export async function syncThings(novelDir: string, env: NodeJS.ProcessEnv = process.env): Promise<{ joined: number; added: number; list: string }> {
  const scope = await castScope(novelDir, env), file = await loadThings(scope);
  const entities = [...new Map((await new BundleStore(join(novelDir, "ontology")).loadFile<Entity>("entities.jsonl")).map((entity) => [entity.id, entity])).values()];
  const result = joinThings(file, scope.sourceId, entities.filter((entity) => entity.properties.source === "stage-objects"));
  await saveThings(scope, file);
  return { ...result, list: thingsPath(scope) };
}

/**
 * The identity pool for new names of one kind: this book's records of that
 * kind (any Item; any Location for a building, since a named building may
 * already be a place of the tree) and the universe's things not yet in this
 * book. Labels are made unique, since they are the answers.
 */
export function thingPool(input: { book: Entity[]; things?: ThingsFile | null; sourceId: string; books?: CastBook[]; kind: ThingKind; generic: (name: string) => boolean }): PoolEntry[] {
  const entries: PoolEntry[] = [];
  const titles = new Map((input.books ?? []).map((book) => [book.sourceId, book.title]));
  const full = (forms: string[]) => forms.filter((form) => [...form].length >= 2 && !input.generic(form));
  for (const entity of input.book.filter((entry) => input.kind === "object" ? entry.kind === "Item" : entry.kind === "Location")) {
    const universal = input.things?.things.find((thing) => thing.members.some((member) => member.sourceId === input.sourceId && member.entityId === entity.id));
    const forms = [...new Set([...namesOf(entity), ...(universal?.forms ?? [])])];
    entries.push({ ref: entity.id, kind: "book", name: nameOf(entity), label: nameOf(entity), forms, full: full(namesOf(entity)), where: entity.kind === "Location" && entity.properties.source !== "stage-objects" ? "a place in this book" : "this book" });
  }
  for (const thing of input.things?.things ?? []) {
    if (thing.kind !== input.kind || thing.members.some((member) => member.sourceId === input.sourceId)) continue;
    const books = [...new Set(thing.members.map((member) => member.sourceId))];
    entries.push({ ref: thingRef(thing.id), kind: "universe", name: thing.name, label: thing.name, forms: thing.forms, full: full(thing.forms), where: books.map((id) => titles.get(id) ?? id).join(", ") });
  }
  const seen = new Map<string, number>();
  for (const entry of entries) seen.set(entry.label, (seen.get(entry.label) ?? 0) + 1);
  for (const entry of entries) if (seen.get(entry.label)! > 1) entry.label = `${entry.label} (${entry.where})`;
  return entries;
}

/** How likely a candidate's names are a new name's: the same form 1, one inside the other 0.8, a shared run of two or more characters 0.4. */
export function nameAffinity(name: string, forms: string[]): number {
  const clean = (text: string) => text.replace(/\s+/g, "").toLowerCase(), target = clean(name);
  let best = 0;
  for (const form of forms.map(clean)) {
    if (!form) continue;
    if (form === target) return 1;
    if ([...form].length >= 2 && [...target].length >= 2 && (form.includes(target) || target.includes(form))) best = Math.max(best, 0.8);
    else for (let index = 0; index + 2 <= [...target].length; index++) if (form.includes([...target].slice(index, index + 2).join(""))) { best = Math.max(best, 0.4); break; }
  }
  return best;
}
