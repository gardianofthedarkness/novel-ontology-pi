// Evidence packs for the review by Jev (docs/v2/jev-review.md §4, R2): for each held item, the lines the answer can rest on.
// Measured on W12 against the 409 lines Pi cited (2026-11-06): the lines ±20 round the item, opened by id, then each
// person's names searched by nearness within ±100 lines, up to 50 lines, hold 90% of them (±10 and 50: 87%; ±30 and 60:
// 93%), in packs of about 63 lines. Embedding search (bge-small; bge-m3 dense, learned sparse and ColBERT, fused or not)
// added nothing at that size, so a pack has none.
// An item with no line of its own (identity) gets each person's own lines in the scenes the question names.
// Pure: the book's sentences, the reading and the world log in; a pack out.

export const WINDOW = 20, NEAR = 100, SEARCHED = 50, OWN = 30;
const SENTENCE = /\b(b\d{4}_s\d{4})\b/;
const SCENE = /scene_\d{6}/g;

/** The book in reading order: `ids`, `pos` (id → index) and `text` (id → sentence). */
export function bookOf(sentences) {
  const ids = sentences.map(sentence => sentence.id);
  return { ids, pos: new Map(ids.map((id, n) => [id, n])), text: new Map(sentences.map(sentence => [sentence.id, sentence.text])) };
}

/**
 * Who is who: each id's names (the ontology's names, a slot's label and names), kind, and own lines: a slot's sentences,
 * the lines the reading resolved a mention of them in (`references`), and the lines it has them say (`roles`).
 */
export function peopleOf({ entities = [], slots = [], references = [], roles = {} }) {
  const out = new Map();
  for (const entity of entities) {
    const names = (entity.names ?? []).map(name => (typeof name === 'string' ? name : name?.text)).filter(Boolean);
    out.set(entity.id, { name: names[0] ?? entity.id, names: [...new Set(names)], kind: entity.kind, sentences: [] });
  }
  for (const slot of slots) out.set(slot.id, { name: slot.label ?? slot.names?.[0] ?? slot.id, names: [...new Set([slot.label, ...(slot.names ?? [])].filter(Boolean))], kind: slot.kind, sentences: [...(slot.sentences ?? [])] });
  for (const reference of references) if (reference.entity && out.has(reference.entity)) out.get(reference.entity).sentences.push(...(reference.sentences ?? []));
  for (const [line, role] of Object.entries(roles)) if (role?.who?.id && out.has(role.who.id)) out.get(role.who.id).sentences.push(line);
  for (const person of out.values()) person.sentences = [...new Set(person.sentences)];
  return out;
}

/** An item's own line: its line, its first line, or its card's first sentence (a card id is "kind:b…_s…" or "…#n"). */
export function anchorOf(item) {
  const line = item.line ?? item.lines?.[0] ?? null;
  if (line) return line;
  const card = item.card ?? item.cards?.[0] ?? null;
  return card ? card.split(':').slice(1).join(':').split('#')[0] : null;
}

/** The searchable names of `ids`: two characters or more (a single character finds everything). */
const namesFor = (ids, people) => [...new Set(ids.flatMap(id => people.get(id)?.names ?? []))].filter(name => [...name].length >= 2);

/**
 * The pack for `item`: `lines` (ids, the most needed first: the item's own, the window, then the searched by nearness),
 * `anchor`, and how each line came in. `card` gives a card's sentences (`reading.cards` by id); `names` adds the names of
 * more people to search (the options of who-speaks).
 */
export function packFor(item, { book, people, cards = new Map(), scenes = new Map(), more = [] }, { window = WINDOW, near = NEAR, searched = SEARCHED, own = OWN } = {}) {
  const picked = new Map(), take = (id, why) => { if (book.pos.has(id) && !picked.has(id)) picked.set(id, why); };
  const anchor = anchorOf(item), at = anchor ? book.pos.get(anchor) : undefined;
  const ids = [...new Set([...(item.subjects ?? []), ...more])].filter(id => !String(id).startsWith('crowd:'));
  const names = namesFor(ids, people);
  if (at !== undefined) {
    take(anchor, 'item');
    for (const line of item.lines ?? []) take(line, 'item');
    for (const card of item.cards ?? []) for (const line of cards.get(card)?.sentences ?? []) take(line, 'card');
    for (let d = 1; d <= window; d++) { take(book.ids[at - d], 'window'); take(book.ids[at + d], 'window'); }
    // Each name's lines within `near`, the nearest first.
    const hits = [];
    for (let d = window + 1; d <= near; d++) for (const n of [at - d, at + d]) {
      const id = book.ids[n];
      if (id && names.some(name => book.text.get(id).includes(name))) hits.push(id);
    }
    for (const id of hits.slice(0, searched)) take(id, 'searched');
  } else {
    // No line of its own: each person's own lines (their slot, the mentions the reading resolved to them, what they say)
    // and the lines naming them, anywhere in the book, the nearest the scenes the question names first; then lines naming
    // two of them. (W12: Pi's lines for "are these two one person" lay outside the scenes it was given.)
    for (const line of item.evidence ?? []) { const match = String(line).match(SENTENCE); if (match) take(match[1], 'item'); }
    const named = new Set([...(item.question ?? '').matchAll(SCENE)].map(match => match[0]).concat((item.evidence ?? []).flatMap(entry => [...String(entry).matchAll(SCENE)].map(match => match[0]))));
    const centre = [...named].flatMap(scene => scenes.get(scene)?.sentences ?? []).map(line => book.pos.get(line)).filter(n => n !== undefined).sort((a, b) => a - b);
    const away = line => { const n = book.pos.get(line); return centre.length ? Math.min(...centre.map(c => Math.abs(c - n))) : n; };
    const naming = id => { const mine = namesFor([id], people); return mine.length ? book.ids.filter(line => mine.some(name => book.text.get(line).includes(name))) : []; };
    for (const id of ids) {
      const lines = [...new Set([...(people.get(id)?.sentences ?? []), ...naming(id)])].filter(line => book.pos.has(line));
      for (const line of lines.sort((a, b) => away(a) - away(b)).slice(0, own)) take(line, `own:${id}`);
    }
    const both = book.ids.filter(line => ids.filter(id => namesFor([id], people).some(name => book.text.get(line).includes(name))).length >= 2);
    for (const line of both.sort((a, b) => away(a) - away(b)).slice(0, own)) take(line, 'both');
  }
  return { anchor, lines: [...picked.keys()], why: Object.fromEntries(picked), names };
}

/** The share of `cited` lines (Pi's) a pack holds, for R2's check. */
export const recall = (pack, cited) => (cited.length ? cited.filter(line => pack.lines.includes(line)).length / cited.length : null);

// who-speaks (§12's fixes, the user 2026-11-07: "Fix it"): one speaker for one quote, the speaker among the options, and
// each candidate's voice. W12: 7 of Jev's 11 confident errors were one quote run given to 10032 (who marks her lines
// with "Misaka"), 12 lines' right speaker was not among the options, and 4 lines of one shout split.
const OPENS = new Set(['“', '「']), CLOSES = new Set(['”', '」']);
export const QUOTE_MOST = 12;

/** Each line inside a quotation, by the line its quotation opens on (a quote left open more than 12 lines is dropped). */
export function quoteSpans(book) {
  const spans = new Map();
  let open = null, length = 0;
  for (const id of book.ids) {
    let span = open;
    for (const ch of book.text.get(id)) {
      if (OPENS.has(ch) && open === null) { open = id; length = 0; if (span === null) span = id; }
      else if (CLOSES.has(ch)) open = null;
    }
    if (span !== null) spans.set(id, span);
    if (open !== null && ++length > QUOTE_MOST) open = null;
  }
  return spans;
}

/**
 * The people near a line, the nearest first: the reading's sure speakers and listeners within `radius` lines, and the
 * named characters (not slots: a slot's label, "a girl", is in every scene) those lines name. At most `most`.
 */
export function nearbyPeople(line, { book, people, roles = {} }, { radius = 10, sure = 0.6, most = 6 } = {}) {
  const at = book.pos.get(line);
  if (at === undefined) return [];
  const named = [...people.entries()].filter(([id, person]) => id.startsWith('char_') && (person.names ?? []).some(name => [...name].length >= 2));
  const out = new Map();
  for (let d = 0; d <= radius; d++) for (const n of d ? [at - d, at + d] : [at]) {
    const id = book.ids[n];
    if (!id) continue;
    const role = roles[id];
    if (role?.who?.id && (role.who.confidence ?? 0) >= sure && !out.has(role.who.id)) out.set(role.who.id, d);
    if (role?.to?.id && !out.has(role.to.id)) out.set(role.to.id, d);
    for (const [pid, person] of named) if (!out.has(pid) && person.names.some(name => [...name].length >= 2 && book.text.get(id).includes(name))) out.set(pid, d);
  }
  return [...out.keys()].slice(0, most);
}

/**
 * Voices from the lines the reading is sure of (`lines`: { who, quote, scene }): per person, each word piece (voices.mjs
 * gramsOf) with the lines and the scenes it is in; and how many lines carry each piece in all.
 */
export function voicesOf(lines, gramsOf) {
  const by = new Map(), all = new Map();
  for (const { who, quote, scene } of lines) {
    const own = by.get(who) ?? by.set(who, { lines: 0, grams: new Map() }).get(who);
    own.lines++;
    for (const gram of new Set(gramsOf(quote))) {
      const entry = own.grams.get(gram) ?? own.grams.set(gram, { count: 0, scenes: new Set() }).get(gram);
      entry.count++; entry.scenes.add(scene); all.set(gram, (all.get(gram) ?? 0) + 1);
    }
  }
  return { by, all, lines: lines.length };
}

/**
 * A person's voice marks: the word pieces (2–3 characters) their lines carry far more often than anyone's, said in at
 * least `scenes` different scenes (a habit, not one conversation's topic), at most `top`.
 */
export function voiceMarks(voices, who, { top = 6, least = 3, scenes = 3 } = {}) {
  const own = voices?.by.get(who);
  if (!own) return [];
  return [...own.grams.entries()].filter(([gram, entry]) => entry.count >= least && entry.scenes.size >= scenes && [...gram.replace(/[\^$]/g, '')].length >= 2)
    .map(([gram, entry]) => ({ gram, lift: (entry.count / own.lines) / (voices.all.get(gram) / Math.max(1, voices.lines)) }))
    .filter(entry => entry.lift >= 2).sort((a, b) => b.lift - a.lift).slice(0, top)
    .map(entry => entry.gram.replace(/^\^/, 'opens with ').replace(/\$$/, ' (at the end)'));
}
