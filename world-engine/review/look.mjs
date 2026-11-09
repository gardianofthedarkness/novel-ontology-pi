// Looks for the review by Jev (docs/v2/jev-review.md §14; the user, 2026-11-07: Jev choosing how to observe and how
// closely, then "do the with agility test"). Instead of one fixed pack, Jev starts from the item's own line and the few
// lines round it, and chooses, look by look, what to read next or to answer: a menu the harness builds from what has been
// read (Pi's W12 moves were nearly all of this kind: open lines by id, a name searched, who said what), each move said
// with what it reads and what it costs. Two moves change how closely it is read rather than what: the work model (a
// larger, slower reader whose answer joins what Jev sees) and the main agent (Pi: the item goes on). Pure: the book, the
// people and the reading's speakers in; lines out.

export const START = 5, LOOKS = 4, STEP = 10, NEAR = 100, NAMED = 10, SAID = 8, SCENE = 30, OWN = 5;
const SCENE_ID = /scene_\d{6}/g;

const namesOf = (id, people) => (people.get(id)?.names ?? []).filter(name => [...name].length >= 2);
const personOf = id => id && !String(id).startsWith('crowd:') && !['unnamed', 'none'].includes(String(id));

/** The people a look can follow: the item's subjects and whom its line is said to (at most 8). */
export const followed = (item, people) => [...new Set([...(item.subjects ?? []), ...(item.to ? [item.to] : [])])].filter(id => personOf(id) && people.has(id)).slice(0, 8);

/** The scenes an item names (an identity item has no line of its own, only the scenes the two were seen in). */
const scenesNamed = item => [...new Set([...String(item.question ?? '').matchAll(SCENE_ID), ...(item.evidence ?? []).flatMap(entry => [...String(entry).matchAll(SCENE_ID)])].map(match => match[0]))];

/**
 * Where the looks start: the item's line and `START` lines each side (`lo`..`hi`, the block read round it), or, with no
 * line of its own, each person's own `OWN` lines nearest the scenes the question names.
 */
export function startOf(item, { book, people, scenes = new Map() }, anchor) {
  const seen = new Map(), at = anchor ? book.pos.get(anchor) : undefined;
  const take = (id, why) => { if (id && book.pos.has(id) && !seen.has(id)) seen.set(id, why); };
  const centre = scenesNamed(item).flatMap(scene => scenes.get(scene)?.sentences ?? []).map(line => book.pos.get(line)).filter(n => n !== undefined);
  const state = { item, anchor: at === undefined ? null : anchor, at, seen, lo: at, hi: at, centre, done: [], notes: [] };
  if (at !== undefined) {
    take(anchor, 'item');
    for (const line of item.lines ?? []) take(line, 'item');
    state.lo = Math.max(0, at - START); state.hi = Math.min(book.ids.length - 1, at + START);
    for (let n = state.lo; n <= state.hi; n++) take(book.ids[n], 'start');
  } else for (const id of followed(item, people)) for (const line of ownLines(state, id, { book, people }).slice(0, OWN)) take(line, `own:${id}`);
  return state;
}

/** How far a line is from what the item is about: its own line, else the scenes it names. */
const away = (state, n) => (state.at !== undefined ? Math.abs(n - state.at) : state.centre.length ? Math.min(...state.centre.map(c => Math.abs(c - n))) : n);
const unseen = (state, lines) => lines.filter(line => !state.seen.has(line));
const nearest = (state, lines, { book }) => [...lines].sort((a, b) => away(state, book.pos.get(a)) - away(state, book.pos.get(b)));

/** A person's own lines: what the reading has them say, its mentions resolved to them, a slot's own sentences. */
function ownLines(state, id, { book, people }) {
  return nearest(state, unseen(state, (people.get(id)?.sentences ?? []).filter(line => book.pos.has(line))), { book });
}
/** The lines naming a person, within `NEAR` of the item (anywhere when it has no line), nearest first. */
function namingLines(state, id, { book, people }) {
  const names = namesOf(id, people);
  if (!names.length) return [];
  const range = state.at !== undefined ? book.ids.slice(Math.max(0, state.at - NEAR), state.at + NEAR + 1) : book.ids;
  return nearest(state, unseen(state, range.filter(line => names.some(name => book.text.get(line).includes(name)))), { book });
}
/** The lines a person says by the reading's speakers, nearest first. */
function saidLines(state, id, { book, roles = {} }) {
  return nearest(state, unseen(state, Object.entries(roles).filter(([line, role]) => role?.who?.id === id && book.pos.has(line)).map(([line]) => line)), { book });
}
/** The scene the item's line is in, by its sentences. */
const sceneOf = (state, { scenes = new Map() }) => (state.anchor ? [...scenes.values()].find(scene => scene.sentences?.includes(state.anchor)) ?? null : null);

/**
 * The moves open now, each with its words (what it reads, what it costs): answer; the lines before or after the block
 * read; each person's name searched; what each person says; the rest of the scene; the work model (once); the main agent.
 */
export function menuOf(state, ctx, { work = false } = {}) {
  const { book, people } = ctx, name = id => people.get(id)?.name ?? id, out = [];
  out.push({ key: 'answer', hint: `answer now from the ${state.seen.size} lines read`, cost: 0 });
  if (state.at !== undefined && state.lo > 0) out.push({ key: 'before', hint: `read the ${STEP} lines before ${book.ids[state.lo]}`, cost: 1 });
  if (state.at !== undefined && state.hi < book.ids.length - 1) out.push({ key: 'after', hint: `read the ${STEP} lines after ${book.ids[state.hi]}`, cost: 1 });
  for (const id of followed(state.item, people)) {
    const naming = namingLines(state, id, ctx).length, said = saidLines(state, id, ctx).length;
    if (naming) out.push({ key: `name:${id}`, hint: `read lines naming ${name(id)} ${state.at !== undefined ? `within ${NEAR} lines of the item` : 'in the book, nearest the scenes asked'} (the nearest ${Math.min(NAMED, naming)} of ${naming} not read)`, cost: 1 });
    if (said) out.push({ key: `said:${id}`, hint: `read lines ${name(id)} says, by the reading (the nearest ${Math.min(SAID, said)} of ${said} not read)`, cost: 1 });
  }
  const scene = sceneOf(state, ctx), rest = scene ? unseen(state, scene.sentences.filter(line => book.pos.has(line))).length : 0;
  if (rest) out.push({ key: 'scene', hint: `read the rest of ${scene.id} (${Math.min(SCENE, rest)} of ${rest} lines not read, nearest first)`, cost: 1 });
  if (work && !state.done.some(look => look.move === 'work')) out.push({ key: 'work', hint: 'ask the work model, a larger and slower reader, for its answer on the lines read; its answer is added (once)', cost: 3 });
  out.push({ key: 'pi', hint: 'hand the item to the main agent (Pi): the book as read here cannot settle it', cost: 10 });
  return out;
}

/** The look question: answer, or read more first, of the moves open. */
export function lookQuestion(state, menu, left) {
  return { key: 'look', primitive: 'choice', instructions: `To answer "${String(state.item.question).slice(0, 220)}": answer now, or read more first? ${left} look${left === 1 ? '' : 's'} left. Pick the move most likely to show the answer.`, options: menu.map(move => move.key), optionHints: Object.fromEntries(menu.map(move => [move.key, move.hint])) };
}

/** A reading move carried out: the lines it adds (most needed first), and the block widened for before and after. */
export function lookAt(state, move, ctx) {
  const { book } = ctx, added = [];
  const add = (lines, why) => { for (const line of lines) if (line && !state.seen.has(line)) { state.seen.set(line, why); added.push(line); } };
  const [kind, id] = move.split(':');
  if (kind === 'before') { const lo = Math.max(0, state.lo - STEP); add(book.ids.slice(lo, state.lo).reverse(), 'before'); state.lo = lo; }
  else if (kind === 'after') { const hi = Math.min(book.ids.length - 1, state.hi + STEP); add(book.ids.slice(state.hi + 1, hi + 1), 'after'); state.hi = hi; }
  else if (kind === 'name') add(namingLines(state, id, ctx).slice(0, NAMED), `name:${id}`);
  else if (kind === 'said') add(saidLines(state, id, ctx).slice(0, SAID), `said:${id}`);
  else if (kind === 'scene') { const scene = sceneOf(state, ctx); add(nearest(state, unseen(state, (scene?.sentences ?? []).filter(line => book.pos.has(line))), ctx).slice(0, SCENE), 'scene'); }
  state.done.push({ move, added: added.length });
  return added;
}

/** The pack the looks made, as evidence.mjs's packs are: the lines in the order read, with how each came in. */
export const packOf = state => ({ anchor: state.anchor, lines: [...state.seen.keys()], why: Object.fromEntries(state.seen) });
