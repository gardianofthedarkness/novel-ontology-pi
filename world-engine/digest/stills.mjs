// The stills cast (docs/v3/design.html#stills; the user, 2026-11-05: "we need to provide any cast who analyze the pictures enough
// context to extract useful information out of it"). A pre-film cast after the reading and its notes: each of the book's
// story pictures, with its faces lettered and its text read (tools/album-portraits/stills.py), the book's portraits as a
// gallery, and the text around it both ways (the units before and after the one it stands in, raw, with their people,
// places, times and what the script supervisor noted), asked of Jev in one request: what kind of picture it is, which card
// of the text it shows (v1 placed a picture between its anchor's unit and the next; the card is that made exact, before or
// after), who each face is and in which card's moment, the setting, the time of day, the weather, what is going on, and
// what each line of its text is. Its notes go into the pre-film notes as each other cast's are; its words stay with the
// book (pictures-text.json). It decides nothing for another cast: each reads it as evidence, basis `picture`.
import { SETTINGS, GROUND_SETTINGS } from './set-dresser.mjs';

export const PICTURE_KINDS = {
  moment: 'one moment of the story: the people as they are in one card of the text',
  moments: 'several moments in one picture (panels, or people shown in different places)',
  summary: 'a summary or a memory of what came before: not one moment',
  posed: 'the characters posed for the reader: no moment of the story',
};
export const TIMES = { night: 'night', 'dawn or dusk': 'dawn or dusk', day: 'day', 'not shown': 'not shown' };
export const WEATHER = { snow: 'snow falling or lying', rain: 'rain', clear: 'clear or no weather to see', 'not shown': 'not shown (indoors, or no sky)' };
export const ACTIONS = {
  talking: 'talking or listening', fighting: 'fighting: blows, powers, a standoff', travelling: 'walking, running, chasing or fleeing somewhere',
  riding: 'riding a vehicle or carried by someone', resting: 'sitting, lying, waiting', posing: 'facing the reader, posed', other: 'something else',
};
export const TEXT_KINDS = {
  said: 'a line someone says (in a speech bubble or beside them)', caption: 'a caption or a description of a person (who they are)',
  sign: 'a sign or a label: a shop, a street, a station, a building', written: 'something written on a screen, a clock, a paper or a phone',
  sound: 'a sound effect', noise: 'no words: decoration, or unreadable',
};
export const PLACE_SETTINGS = { ...Object.fromEntries(Object.keys(SETTINGS).filter(key => key !== 'not said').map(key => [key, SETTINGS[key]])), 'not shown': 'the picture does not show where' };
const NOT = { else: 'someone_else', none: 'not_a_person' };

const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
/** Where a box stands in the picture, in words. */
export const whereIn = box => {
  const x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2;
  return `${x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'centre'}, ${y < 0.34 ? 'top' : y > 0.66 ? 'bottom' : 'middle'}`;
};

/**
 * The brief: the units around the picture (its own, and `window` before and after in reading order), their sentences
 * (raw, the nearest `most` to the picture), their cards and people, and what each unit is about, where and when.
 */
/** Words that describe how someone looks (hair, eyes, clothes, a hat, goggles, a scarf, a coat, a nun's habit, a uniform, an eyepatch). */
export const LOOKS = /[\u53d1\u773c\u77b3\u8863\u670d\u88d9\u5e3d\u889c]|\u62a4\u76ee\u955c|\u56f4\u5dfe|\u5916\u5957|\u4fee\u5973|\u5236\u670d|\u773c\u7f69/;

/**
 * Each candidate's own evidence (the user, 2026-11-05: "facts need to be drawn for the candidates"): how the book
 * describes them (sentences naming them with words of looks, nearest the picture first), the reading's facts about them
 * before it (latest first), and the introduction's line.
 */
export function candidateEvidence({ reading, text, people, at, order, looks = 3, facts = 2 }) {
  const formsOf = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, [...new Set([...(entity.proper ?? []), ...(entity.names ?? [])])].filter(form => form.length >= 2)]));
  const out = {};
  for (const id of people) {
    const forms = formsOf.get(id) ?? [], seen = (reading.chart?.entities ?? []).find(entity => entity.id === id)?.seen ?? [];
    // A word of looks beside one of their names (within a few characters of it), not anywhere in a sentence that names them.
    const beside = sentence => { const line = text(sentence); return forms.some(form => { for (let k = line.indexOf(form); k >= 0; k = line.indexOf(form, k + 1)) if (LOOKS.test(line.slice(Math.max(0, k - 10), k + form.length + 14))) return true; return false; }); };
    const described = seen.filter(beside).sort((a, b) => Math.abs(order(a) - at) - Math.abs(order(b) - at)).slice(0, looks);
    const known = (reading.facts ?? []).filter(fact => fact.about?.some(entry => entry.id === id) && order(fact.first) < at).sort((a, b) => order(b.first) - order(a.first)).slice(0, facts);
    out[id] = { looks: described.map(sentence => clip(text(sentence), 90)), facts: known.map(fact => clip(fact.sentences.map(text).join(''), 120)) };
  }
  return out;
}

/**
 * The groups the candidates were last seen in together (the user, 2026-11-05: "if multiple characters appear they should
 * search for a recent group they appear together, and hence implying they are together when the world doesn't"): each
 * unit's named candidates present (its cards' people), from `back` units before the picture to two after, as distinct
 * sets of two to ten, the most recent first, with how many units each was seen in.
 */
export function recentGroups({ reading, people, unitIndex, back = 40, most = 6 }) {
  const wanted = new Set(people.filter(id => id.startsWith('char_'))), unitOfSentence = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
  const present = new Map();
  for (const card of reading.cards) { const unit = unitOfSentence.get(card.first); for (const entry of card.people ?? []) { const id = entry.id ?? entry; if (wanted.has(id)) (present.get(unit) ?? present.set(unit, new Set()).get(unit)).add(id); } }
  const groups = new Map();
  for (let k = Math.min(reading.scenes.length - 1, unitIndex + 2); k >= Math.max(0, unitIndex - back); k--) {
    const unit = reading.scenes[k].id, set = [...(present.get(unit) ?? [])].sort();
    if (set.length < 2 || set.length > 10) continue;
    const key = set.join('+'), entry = groups.get(key) ?? { people: set, units: 0, last: unit, before: unitIndex - k };
    entry.units++; groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => a.before - b.before || b.units - a.units).slice(0, most).map(({ people: who, units, last, before }) => ({ people: who, units, last, ...(before < 0 ? { after: -before } : { before }) }));
}

/**
 * The confirmed references nearest this picture's faces, one a candidate (a face of theirs named surely in another of the
 * book's pictures, as the matcher found it nearest one of this picture's faces): sent as `reference_<id>`.
 */
export function nearestReferences(prep) {
  const best = new Map();
  for (const face of prep.faces) for (const [id, difference] of Object.entries(face.match ?? {})) {
    const ref = face.matchBy?.[id];
    if (!String(ref ?? '').startsWith('face:')) continue;
    if (!best.has(id) || difference < best.get(id).difference) best.set(id, { ref, difference });
  }
  return best;
}

/**
 * A face named surely enough to be a reference for others (ground truth for the matcher): Jev's answer at `least` or
 * surer, and the matcher agreeing (the person Jev named is its nearest, or within its close range). Two signals, so one
 * sure mistake does not become a reference (vol 1's ill_0015: the matcher sure Anna's face was Kamijou's; Jev not).
 */
export function confirmedFaces(note, prep, { least = 0.85, threshold = 0.178 } = {}) {
  return note.faces.filter(face => {
    if (!face.who?.startsWith('char_') || face.sure < least) return false;
    const match = prep.faces.find(entry => entry.letter === face.letter)?.match ?? {}, ranked = Object.entries(match).sort((a, b) => a[1] - b[1]);
    return ranked[0]?.[0] === face.who || (match[face.who] ?? Infinity) <= threshold * 1.4;
  }).map(face => ({ entityId: face.who, picture: note.id, letter: face.letter, sure: face.sure, difference: prep.faces.find(entry => entry.letter === face.letter)?.match?.[face.who] ?? null }));
}

export function stillsBrief({ reading, text, picture, prep, gallery = [], notes = null, intro = null, window = 2, most = 160, threshold = null }) {
  const referenceOf = new Map([...nearestReferences(prep).keys()].map(id => [id, `reference_${id}`]));
  const unitOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
  const at = Math.max(0, reading.scenes.findIndex(scene => scene.id === unitOf.get(picture.sentenceId)));
  const units = reading.scenes.slice(Math.max(0, at - window), at + window + 1), inUnits = new Set(units.map(unit => unit.id));
  const ids = units.flatMap(unit => unit.sentences), anchor = Math.max(0, ids.indexOf(picture.sentenceId));
  const kept = new Set(ids.map((id, k) => [id, Math.abs(k - anchor)]).sort((a, b) => a[1] - b[1]).slice(0, most).map(([id]) => id));
  const cards = reading.cards.filter(card => inUnits.has(unitOf.get(card.first)) && card.sentences.some(id => kept.has(id)));
  const names = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
  for (const slot of reading.slots ?? []) names.set(slot.id, slot.label ?? slot.names?.[0] ?? slot.id);
  const portraitOf = new Map(gallery.map(entry => [entry.entityId, `portrait_${entry.entityId}`]));
  const introOf = new Map((intro?.cast ?? []).filter(entry => entry.entity).map(entry => [entry.entity, entry.line ?? null]));
  const people = [...new Set([...cards.flatMap(card => (card.people ?? []).map(entry => entry.id ?? entry)), ...gallery.map(entry => entry.entityId)])].filter(id => /^(char_|slot_)/.test(id) && names.has(id));
  const placeOf = new Map((reading.places?.settings ?? []).map(entry => [entry.scene, entry.place])), timeOf = new Map((reading.time?.scenes ?? []).map(entry => [entry.scene, entry.when ?? null]));
  const sentenceOrder = new Map(reading.scenes.flatMap(scene => scene.sentences).map((id, k) => [id, k])), order = id => sentenceOrder.get(id) ?? -1;
  const evidence = candidateEvidence({ reading, text, people, at: order(picture.sentenceId), order });
  const state = {
    // Each face against the portraits of the people who could be in it (CCIP, tools/album-portraits/stills.py): the model's
    // difference, under its threshold the same character; the nearest three.
    faces: Object.fromEntries(prep.faces.map(face => [face.letter, {
      where: whereIn(face.box), height: `${Math.round((face.box.bottom - face.box.top) * 100)}% of the picture`,
      ...(face.match ? { portraitMatch: Object.entries(face.match).filter(([id]) => people.includes(id)).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([id, difference]) => ({ who: id, difference, against: String(face.matchBy?.[id] ?? '').startsWith('face:') ? 'a face of theirs confirmed in another of the book\'s pictures' : 'their portrait', verdict: threshold === null ? null : difference <= threshold ? 'same character' : difference <= threshold * 1.4 ? 'close' : 'unlike' })) } : {}),
    }])),
    ...(prep.turnedAway ? { turnedAway: `${prep.turnedAway} more ${prep.turnedAway === 1 ? 'person' : 'people'} with their face turned away (not lettered, not asked)` } : {}),
    texts: Object.fromEntries(prep.texts.map(entry => [entry.ref, { text: entry.text, where: whereIn(entry.box) }])),
    people: Object.fromEntries(people.map(id => [id, { name: names.get(id), ...(portraitOf.has(id) ? { portrait: portraitOf.get(id) } : {}), ...(referenceOf.has(id) ? { reference: referenceOf.get(id) } : {}), ...(introOf.get(id) ? { introduced: clip(introOf.get(id), 80) } : {}), ...(evidence[id]?.looks.length ? { looks: evidence[id].looks } : {}), ...(evidence[id]?.facts.length ? { facts: evidence[id].facts } : {}) }])),
    groups: recentGroups({ reading, people, unitIndex: at }),
    units: Object.fromEntries(units.map(unit => [unit.id, {
      ...(unit.id === unitOf.get(picture.sentenceId) ? { picture: `stands after ${picture.sentenceId}` } : {}),
      kind: unit.type ?? null, where: names.get(placeOf.get(unit.id)) ?? placeOf.get(unit.id) ?? null, when: timeOf.get(unit.id) ?? null,
      ...(notes?.units?.[unit.id]?.scriptSupervisor?.digest?.summary ? { about: clip(notes.units[unit.id].scriptSupervisor.digest.summary, 300) } : {}),
    }])),
    cards: Object.fromEntries(cards.map(card => [card.id, { unit: unitOf.get(card.first), kind: card.kind, from: card.first, to: card.last, people: (card.people ?? []).map(entry => entry.id ?? entry).filter(id => people.includes(id)) }])),
    passage: Object.fromEntries(ids.filter(id => kept.has(id)).map(id => [id, clip(text(id), 120)])),
  };
  return { units, cards, people, state };
}

/** The questions, each a choice: the picture's kind and card; each face's person and card; the setting, time, weather, action; each text's kind and whose. */
export function stillsQuestions({ prep, cards, people, gallery = [] }) {
  const cardOptions = [...cards.map(card => card.id), 'none'], personOptions = [...people, NOT.else, NOT.none], faceOptions = [...prep.faces.map(face => face.letter), 'none'];

  const choice = (key, instructions, options, optionHints) => ({ key, primitive: 'choice', instructions, options, ...(optionHints ? { optionHints } : {}) });
  return [
    choice('kind', 'What kind of picture is `picture`?', Object.keys(PICTURE_KINDS), PICTURE_KINDS),
    choice('card', 'Which card of the text does `picture` show (its main moment; the picture may stand before or after the text it shows)? none if no card.', cardOptions),
    ...prep.faces.flatMap(face => [
      // One decision with everything before it (the user, 2026-11-05: the portrait matching, the facts and the groups "all
      // given as context to jev, he should be able to do better"): the face alone, each candidate's own portrait as its own
      // picture (named by the person: a sheet of labelled portraits was misread, vol 1's ill_0011), the matcher's scores, how
      // the book describes them, and the groups seen together.
      choice(`who:${face.letter}`, `Who is the person in \`face_${face.letter}\` (boxed ${face.letter} in \`picture\`)? Compare the face with each person's own portrait picture (\`people.*.portrait\` names it) and the matcher's \`faces.${face.letter}.portraitMatch\`; then with how the book describes them (\`looks\`, \`facts\`, \`introduced\`), and with \`groups\` (several faces together are most likely a group seen together).`, personOptions),
      choice(`card:${face.letter}`, `Which card's moment is face ${face.letter} in?`, cardOptions),
    ]),
    choice('setting', 'Where is the main moment of `picture` set?', Object.keys(PLACE_SETTINGS), PLACE_SETTINGS),
    choice('time', 'What time of day does `picture` show?', Object.keys(TIMES), TIMES),
    choice('weather', 'What weather does `picture` show?', Object.keys(WEATHER), WEATHER),
    choice('action', 'What are the people of `picture` doing?', Object.keys(ACTIONS), ACTIONS),
    ...prep.texts.flatMap(entry => [
      choice(`text:${entry.ref}`, `What is text ${entry.ref} of \`picture\`?`, Object.keys(TEXT_KINDS), TEXT_KINDS),
      choice(`whose:${entry.ref}`, `If text ${entry.ref} is said by someone in \`picture\`, which face says it?`, faceOptions),
    ]),
  ];
}

const squeeze = value => String(value ?? '').replace(/[\s\u3000"'“”\u300c\u300d‘’\uff0c\u3002\uff01\uff1f!?,.…—-]/g, '');
/** The window's sentence a line said in the picture repeats: the one holding it (four characters or more), else none. */
export function sentenceSaying(line, ids, text) {
  const words = squeeze(line);
  if (words.length < 4) return null;
  return ids.find(id => squeeze(text(id)).includes(words)) ?? ids.find(id => { const own = squeeze(text(id)); return own.length >= 4 && words.includes(own); }) ?? null;
}

/** The picture's note from Jev's replies: each answer with how sure, the people near each other, its text routed by kind (words left out). */
export function stillsNote({ picture, prep, replies, cards, text, unitOf, gallery = [], least = 0.5 }) {
  const get = key => { const reply = replies.find(entry => entry.key === key); return reply ? { value: reply.value, sure: Number(Number(reply.confidence ?? 0).toFixed(2)) } : null; };
  const unitOfCard = id => (id && id !== 'none' ? unitOf(id) ?? null : null);
  const main = get('card'), kind = get('kind');
  const faces = prep.faces.map(face => {
    const asked = get(`who:${face.letter}`), at = get(`card:${face.letter}`), who = asked ? { ...asked, by: 'jev' } : null;
    const person = who && who.value !== NOT.else && who.value !== NOT.none && who.sure >= least ? who.value : null;
    const card = at && at.value !== 'none' ? at.value : main?.value !== 'none' ? main?.value ?? null : null;
    const match = face.match ? Object.entries(face.match).sort((a, b) => a[1] - b[1])[0] : null;
    return { letter: face.letter, box: face.box, who: person, sure: who?.sure ?? 0, by: who?.by ?? null, said: who?.value ?? null, matcher: match ? { who: match[0], difference: match[1] } : null, card, unit: unitOfCard(card) };
  });
  // One person is in one moment once: two faces of the same moment named the same person keep the surer, the other is
  // left unnamed (vol 1: Kamijou's four confirmed faces made the matcher read Anna's face, touching his, as his).
  // One moment: the same card, a picture of one moment, or faces side by side (within one and a half faces).
  const oneMoment = (a, b) => {
    if (a.card === b.card || kind?.value === 'moment') return true;
    const size = ((a.box.bottom - a.box.top) + (b.box.bottom - b.box.top)) / 2;
    return Math.hypot((a.box.left + a.box.right - b.box.left - b.box.right) / 2, (a.box.top + a.box.bottom - b.box.top - b.box.bottom) / 2) <= 1.5 * size;
  };
  for (const face of faces) {
    const twin = faces.find(other => other !== face && other.who && other.who === face.who && oneMoment(face, other) && (other.sure > face.sure || (other.sure === face.sure && other.letter < face.letter)));
    if (face.who && twin) { face.twinOf = twin.letter; face.who = null; }
  }
  // Together: two people the picture shows in the same moment are there together, whatever the world had (the user,
  // 2026-11-05: "implying they are together when the world doesn't"); close where their faces are within two and a half faces.
  const near = [];
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const a = faces[i], b = faces[j];
    if (!a.who || !b.who || a.who === b.who || !a.card || a.card !== b.card) continue;
    const size = ((a.box.bottom - a.box.top) + (b.box.bottom - b.box.top)) / 2, dx = (a.box.left + a.box.right - b.box.left - b.box.right) / 2, dy = (a.box.top + a.box.bottom - b.box.top - b.box.bottom) / 2;
    near.push({ a: a.who, b: b.who, card: a.card, sure: Math.min(a.sure, b.sure), close: Math.hypot(dx, dy) <= 2.5 * size });
  }
  const cardIds = cards.flatMap(card => card.sentences);
  const texts = prep.texts.map(entry => {
    const what = get(`text:${entry.ref}`), whose = get(`whose:${entry.ref}`), face = faces.find(f => f.letter === whose?.value);
    const said = what?.value === 'said' ? sentenceSaying(entry.text, cardIds, text) : null;
    return { ref: entry.ref, kind: what?.value ?? null, sure: what?.sure ?? 0, ...(what?.value === 'said' ? { who: face?.who ?? null, sentence: said } : {}), card: face?.card ?? main?.value ?? null };
  });
  return {
    id: picture.id, anchor: picture.sentenceId, kind: kind?.value ?? null, kindSure: kind?.sure ?? 0,
    card: main && main.value !== 'none' ? main.value : null, cardSure: main?.sure ?? 0, unit: unitOfCard(main?.value),
    faces, near, setting: get('setting'), time: get('time'), weather: get('weather'), action: get('action'), texts,
  };
}

/** What the setting says of where people are, as the notes' fact kinds: indoors, outdoors, underground; else none. */
export const settingFact = setting => (setting === 'indoors' ? 'indoors' : setting === 'underground' ? 'underground' : setting && setting !== 'not shown' && (GROUND_SETTINGS.includes(setting) || ['park', 'waterside'].includes(setting)) ? 'outdoors' : null);

/** The picture's facts, as the script supervisor's notes have them (basis `picture`): where each person in it is, and who is near whom. */
export function pictureFacts(note, firstOf, unitOf, least = 0.5) {
  const out = [], where = settingFact(note.setting?.value);
  for (const face of note.faces) if (face.who && face.card && where && (note.setting?.sure ?? 0) >= least) out.push({ sentence: firstOf(face.card), who: face.who, kind: where, value: null, basis: 'picture', sure: Math.min(face.sure, note.setting.sure), picture: note.id, unit: unitOf(face.card) });
  for (const pair of note.near) if (pair.card && pair.sure >= least) out.push({ sentence: firstOf(pair.card), who: pair.a, kind: 'near', value: pair.b, basis: 'picture', sure: pair.sure, picture: note.id, unit: unitOf(pair.card) });
  return out.filter(fact => fact.sentence);
}

/** The pictures merged into the pre-film notes: each unit a picture shows gains it (`stills`), its script supervisor the picture's facts. */
export function withPictures(notes, file) {
  if (!notes?.units || !file?.pictures) return notes;
  for (const note of file.pictures) {
    const units = new Set([note.unit, ...note.faces.map(face => face.unit)].filter(Boolean));
    for (const unit of units) {
      if (!notes.units[unit]) continue;
      const entry = notes.units[unit];
      entry.stills = [...(entry.stills ?? []), note];
      const facts = (note.facts ?? []).filter(fact => fact.unit === unit);
      if (facts.length && entry.scriptSupervisor) entry.scriptSupervisor = { ...entry.scriptSupervisor, facts: [...(entry.scriptSupervisor.facts ?? []), ...facts] };
    }
  }
  return notes;
}
