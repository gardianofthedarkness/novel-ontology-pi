import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Entity, NameForm } from "../../ground/ontology/types.js";
import { libraryShow } from "../../ground/workspace/library.js";
import type { UniverseBindingConfig } from "../causality/universe.js";

/** The host's library bindings (`NOVEL_CAUSAL_BINDINGS`), read here so identity and the calendar do not import causality. */
const universeBindings = async (env: NodeJS.ProcessEnv): Promise<UniverseBindingConfig | undefined> => env.NOVEL_CAUSAL_BINDINGS ? JSON.parse(await readFile(env.NOVEL_CAUSAL_BINDINGS, "utf8")) as UniverseBindingConfig : undefined;

/**
 * The universe cast: ONE shared character list for a whole universe.
 *
 * Every book of the universe keeps its own records (its graph needs them),
 * but who a character IS lives here: a person with every name form any
 * book has reviewed for them, and the book records that are that person
 * (members). Identity work (universal EM) resolves names against this
 * list, so the second book to meet a character meets the same person the
 * first book met. A book outside any library is a universe of one.
 *
 * Stored at `<library>/cast/<universe>.json` (`<book>/cast/book.json` for
 * a standalone book), written atomically.
 */
export interface CastForm {
  text: string;
  kind: NameForm["kind"] | "description";
}
export interface CastMember { sourceId: string; entityId: string }
export interface CastPerson {
  id: string;
  /** Display name: the best full name any member has. */
  name: string;
  forms: CastForm[];
  members: CastMember[];
}
export interface CastMergeRecord { keep: string; drop: string; method: "full-name" | "jev" | "review"; confidence: number; reason: string; at: string }
/** Two book records judged to be different people; not asked again. */
export interface CastDistinct { a: string; b: string; reason: string; at: string }
export interface CastFile {
  version: 1;
  universeId: string;
  nextId: number;
  persons: CastPerson[];
  merges: CastMergeRecord[];
  distinct: CastDistinct[];
}
export interface CastBook { sourceId: string; workspace: string; title: string; readingOrder: number | null }
export interface CastScope {
  /** Where the cast lives: the library, or the book itself when standalone. */
  root: string;
  universeId: string;
  /** This book's source id ("book" when standalone). */
  sourceId: string;
  books: CastBook[];
  standalone: boolean;
}

export const STANDALONE = "book";
/** A book record's universe-wide reference. */
export const memberRef = (member: CastMember) => `${member.sourceId}::${member.entityId}`;
export const castPath = (scope: Pick<CastScope, "root" | "universeId">) => join(scope.root, "cast", `${scope.universeId}.json`);

/** The cast this book belongs to: its universe through the host's library bindings, else the book alone. */
export async function castScope(novelDir: string, env: NodeJS.ProcessEnv = process.env, config?: UniverseBindingConfig): Promise<CastScope> {
  const workspace = resolve(novelDir);
  const standalone: CastScope = { root: workspace, universeId: STANDALONE, sourceId: STANDALONE, books: [{ sourceId: STANDALONE, workspace, title: "this book", readingOrder: null }], standalone: true };
  const bindings = config ?? await universeBindings(env).catch(() => undefined);
  const binding = bindings?.bindings.find((entry) => resolve(entry.workspace) === workspace);
  if (!bindings || !binding) return standalone;
  const catalog = await libraryShow(bindings.directory).catch(() => null);
  const assignment = catalog?.organization.assignments.find((entry) => entry.sourceId === binding.sourceId && entry.status === "confirmed");
  const universeId = catalog?.organization.continuities.find((entry) => entry.id === assignment?.continuityId)?.universeId;
  if (!universeId) return standalone;
  const members = await libraryShow(bindings.directory, { kind: "universe", id: universeId });
  const books = members.sources.flatMap((source) => {
    const bound = bindings.bindings.find((entry) => entry.sourceId === source.id);
    return bound ? [{ sourceId: source.id, workspace: resolve(bound.workspace), title: source.title ?? source.id, readingOrder: source.assignment.readingOrder ?? null }] : [];
  });
  return { root: resolve(bindings.directory), universeId, sourceId: binding.sourceId, books, standalone: false };
}

export async function loadCast(scope: Pick<CastScope, "root" | "universeId">): Promise<CastFile> {
  try {
    const parsed = JSON.parse(await readFile(castPath(scope), "utf8")) as CastFile;
    if (parsed.version !== 1 || parsed.universeId !== scope.universeId) throw new Error("Cast file belongs to another universe or version.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, universeId: scope.universeId, nextId: 1, persons: [], merges: [], distinct: [] };
    throw error;
  }
}

export async function saveCast(scope: Pick<CastScope, "root" | "universeId">, cast: CastFile): Promise<void> {
  const path = castPath(scope);
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(cast, null, 1), { mode: 0o600 });
  await rename(temporary, path);
}

// --- name forms ---------------------------------------------------------

/** Person nouns that make a form a description ("双辫少女", "戴眼镜的大叔"), not a name. */
const PERSON_NOUNS = ["老师", "教师", "医生", "护士", "警官", "店员", "司机", "少女", "少年", "女孩", "男孩", "女人", "男人", "大叔", "大婶", "老人", "老头", "老爷爷", "老奶奶", "青年", "幼女", "女性", "男性", "学生", "女生", "男生", "姐姐", "妹妹", "哥哥", "弟弟", "修女", "孩子", "小鬼", "家伙", "美女", "淑女", "女士", "先生", "大小姐", "小姑娘", "初中生", "高中生", "职员", "警卫", "士兵", "人"];
/** Endings that address or rank a person ("小姐", "长官"): a name plus one of these is not a fuller name. */
const HONORIFICS = ["小姐", "先生", "女士", "同学", "老师", "大人", "阁下", "前辈", "学姐", "学长", "长官", "小朋友", "酱", "君", "桑", "殿", "大姐", "大哥", "姐", "哥", "妹", "弟"];
/** A name with an address or rank ending ("晓月同学", "林队长"). */
export const hasHonorific = (text: string) => HONORIFICS.some((ending) => text.length > ending.length && text.endsWith(ending));
export const GENERIC_NAMES = new Set(["少年", "少女", "幼女", "女孩", "男孩", "修女", "男人", "女人", "老师", "医生", "护士", "姐姐", "妹妹", "哥哥", "弟弟", "大小姐", "小姑娘", "那家伙", "大叔", "老人", "青年"]);

/** A bare person noun ("少女", "大叔"): says nothing about which person. */
export const isPersonNoun = (text: string) => GENERIC_NAMES.has(text) || PERSON_NOUNS.includes(text) || PERSON_NOUNS.some((noun) => text.endsWith(noun) && text.length <= noun.length + 1);

export function isDescription(text: string): boolean {
  return text.includes("的") || GENERIC_NAMES.has(text) || PERSON_NOUNS.some((noun) => text.length > noun.length && text.endsWith(noun));
}

/** Matching keys of a form: "X（Y）" also answers to X and Y. */
export function formKeys(text: string): string[] {
  const clean = text.trim().replace(/\s+/g, " ");
  const bracket = clean.match(/^(.+?)[（(](.+?)[)）]$/);
  return [...new Set([clean, ...(bracket ? [bracket[1].trim(), bracket[2].trim()] : [])])].filter(Boolean);
}

/**
 * A person's full proper names: the records' own names (canonical, not
 * descriptions or generic words), and longer forms that extend one of them
 * ("林晓" → "林晓月", "X" → "X·Y"). Epithets and titles ("新任会长",
 * "值日班长小朋友") are not names: they can pass to someone else. A name
 * contained in another full name is a short form ("晓月" in "林晓月").
 */
export function fullNames(forms: CastForm[]): string[] {
  const nameLike = (form: CastForm) => form.kind !== "description" && form.kind !== "title" && !isDescription(form.text) && !GENERIC_NAMES.has(form.text.trim());
  const own = [...new Set(forms.filter((form) => form.kind === "canonical" && nameLike(form)).flatMap((form) => formKeys(form.text)))];
  const extends_ = (text: string, name: string) => text.startsWith(name) && text.length > name.length && !HONORIFICS.includes(text.slice(name.length)) && !text.slice(name.length).includes("的");
  const extended = forms.filter((form) => form.kind !== "canonical" && nameLike(form) && own.some((name) => extends_(form.text.trim(), name))).map((form) => form.text.trim());
  const texts = [...new Set([...own, ...extended])];
  // Contained in another name is a short form — unless it is that name's bracketed variant ("X（Y）" is also X and Y).
  const maximal = texts.filter((text) => !texts.some((other) => other !== text && other.includes(text) && !formKeys(other).includes(text)));
  return [...new Set(maximal.flatMap(formKeys))].filter((text) => [...text].length >= 2 && !GENERIC_NAMES.has(text));
}

export const castForms = (entity: Pick<Entity, "names">): CastForm[] => entity.names.map((name) => ({ text: name.text, kind: name.kind !== "title" && isDescription(name.text) ? "description" : name.kind }));

/** Full name → the persons that have it (more than one: not unique, never binds by itself). */
export function fullNameOwners(persons: CastPerson[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const person of persons) for (const name of fullNames(person.forms)) owners.set(name, (owners.get(name) ?? new Set()).add(person.id));
  return owners;
}

// --- persons ------------------------------------------------------------

export const personOf = (cast: CastFile, sourceId: string, entityId: string) => cast.persons.find((person) => person.members.some((member) => member.sourceId === sourceId && member.entityId === entityId));

function addForms(person: CastPerson, forms: CastForm[]) {
  for (const form of forms) {
    const known = person.forms.find((entry) => entry.text === form.text);
    if (!known) person.forms.push(form);
    else if (form.kind === "canonical" && known.kind !== "canonical") known.kind = "canonical";
  }
  // Display name: a record's own name that is a full name, else the first record name, else any full name.
  const own = person.forms.filter((form) => form.kind === "canonical").map((form) => form.text);
  const full = fullNames(person.forms);
  person.name = own.find((text) => full.includes(text)) ?? own[0] ?? full[0] ?? person.forms[0]?.text ?? person.name;
}

export function newPerson(cast: CastFile, member: CastMember, forms: CastForm[]): CastPerson {
  const person: CastPerson = { id: `p_${String(cast.nextId++).padStart(6, "0")}`, name: forms[0]?.text ?? member.entityId, forms: [], members: [member] };
  addForms(person, forms);
  cast.persons.push(person);
  return person;
}

export function joinPerson(person: CastPerson, member: CastMember, forms: CastForm[]) {
  if (!person.members.some((known) => known.sourceId === member.sourceId && known.entityId === member.entityId)) person.members.push(member);
  addForms(person, forms);
}

/** Two persons are one: the drop's members and forms move to the keep. */
export function mergePersons(cast: CastFile, keepId: string, dropId: string, record: Omit<CastMergeRecord, "keep" | "drop" | "at">) {
  if (keepId === dropId) return;
  const keep = cast.persons.find((person) => person.id === keepId), drop = cast.persons.find((person) => person.id === dropId);
  if (!keep || !drop) throw new Error("Unknown cast person.");
  for (const member of drop.members) joinPerson(keep, member, []);
  addForms(keep, drop.forms);
  cast.persons = cast.persons.filter((person) => person.id !== dropId);
  cast.merges.push({ keep: keepId, drop: dropId, ...record, at: new Date().toISOString() });
}

/** A book record left the book (merged into another record of the same book). */
export function removeMember(cast: CastFile, sourceId: string, entityId: string) {
  for (const person of cast.persons) person.members = person.members.filter((member) => !(member.sourceId === sourceId && member.entityId === entityId));
  cast.persons = cast.persons.filter((person) => person.members.length > 0);
}

/** The record a book record became: follows merges inside the book (a merged record's references moved to its survivor). */
export function survivor(cast: CastFile, sourceId: string, entityId: string): string {
  let current = memberRef({ sourceId, entityId });
  for (let step = 0; step < 64; step++) {
    const next = cast.merges.find((merge) => merge.drop === current && merge.keep.includes("::"))?.keep;
    if (!next) break;
    current = next;
  }
  return current.slice(current.indexOf("::") + 2);
}

export const isDistinct = (cast: CastFile, a: string, b: string) => cast.distinct.some((entry) => (entry.a === a && entry.b === b) || (entry.a === b && entry.b === a));
export function markDistinct(cast: CastFile, a: string, b: string, reason: string) {
  if (!isDistinct(cast, a, b)) cast.distinct.push({ a, b, reason, at: new Date().toISOString() });
}

/**
 * Bring one book's characters into the cast. A record already a member
 * stays and contributes its forms; a record extraction bound to a person
 * (`properties.person`) joins it; a record whose full proper name belongs
 * to exactly one person elsewhere in the universe joins that person
 * (automatic: a full name is the same person); anyone else becomes a new
 * person. Records gone from the book leave the cast.
 */
export function syncBook(cast: CastFile, sourceId: string, entities: Entity[]): { joined: { entityId: string; personId: string; method: "bound" | "full-name" }[]; created: string[] } {
  const characters = entities.filter((entity) => entity.kind === "Character");
  const present = new Set(characters.map((entity) => entity.id));
  for (const person of cast.persons) person.members = person.members.filter((member) => member.sourceId !== sourceId || present.has(member.entityId));
  cast.persons = cast.persons.filter((person) => person.members.length > 0);
  const joined: { entityId: string; personId: string; method: "bound" | "full-name" }[] = [], created: string[] = [];
  for (const entity of characters) {
    const forms = castForms(entity), member = { sourceId, entityId: entity.id };
    const current = personOf(cast, sourceId, entity.id);
    if (current) { addForms(current, forms); continue; }
    const bound = typeof entity.properties?.person === "string" ? cast.persons.find((person) => person.id === entity.properties.person) : undefined;
    if (bound && !bound.members.some((known) => known.sourceId === sourceId)) { joinPerson(bound, member, forms); joined.push({ entityId: entity.id, personId: bound.id, method: "bound" }); continue; }
    // Persons with no record in this book yet: a full name they share uniquely is the same person.
    const owners = fullNameOwners(cast.persons.filter((person) => !person.members.some((known) => known.sourceId === sourceId)));
    const matches = new Set(fullNames(forms).flatMap((name) => owners.get(name)?.size === 1 ? [...owners.get(name)!] : []));
    if (matches.size === 1) {
      const person = cast.persons.find((entry) => entry.id === [...matches][0])!;
      joinPerson(person, member, forms);
      cast.merges.push({ keep: person.id, drop: memberRef(member), method: "full-name", confidence: 1, reason: `Full name ${fullNames(forms).join(" / ")}`, at: new Date().toISOString() });
      joined.push({ entityId: entity.id, personId: person.id, method: "full-name" });
      continue;
    }
    created.push(newPerson(cast, member, forms).id);
  }
  return { joined, created };
}

/** The cast scope seen from its root: a library and one of its universes, or a standalone book. */
export async function rootCastScope(root: string, universeId: string, env: NodeJS.ProcessEnv = process.env): Promise<CastScope> {
  const directory = resolve(root);
  if (universeId === STANDALONE) return { root: directory, universeId, sourceId: STANDALONE, books: [{ sourceId: STANDALONE, workspace: directory, title: "this book", readingOrder: null }], standalone: true };
  const bindings = await universeBindings(env).catch(() => undefined);
  if (bindings && resolve(bindings.directory) !== directory) throw new Error("Universe bindings belong to another library.");
  const members = await libraryShow(directory, { kind: "universe", id: universeId });
  const books = members.sources.flatMap((source) => {
    const bound = bindings?.bindings.find((entry) => entry.sourceId === source.id);
    return bound || !bindings ? [{ sourceId: source.id, workspace: resolve(bound?.workspace ?? source.workspace), title: source.title ?? source.id, readingOrder: source.assignment.readingOrder ?? null }] : [];
  });
  return { root: directory, universeId, sourceId: "", books, standalone: false };
}
