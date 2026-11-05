import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureFacts, sentenceSaying, settingFact, stillsBrief, stillsNote, stillsQuestions, withPictures, whereIn } from './stills.mjs';

// Five units of two sentences each; the picture stands after the third unit's first sentence.
const scenes = Array.from({ length: 5 }, (_, k) => ({ id: `u${k}`, type: 'routine', sentences: [`s${k * 2}`, `s${k * 2 + 1}`] }));
const cards = scenes.map((scene, k) => ({ id: `c${k}`, kind: k === 3 ? 'action' : 'dialogue', first: scene.sentences[0], last: scene.sentences[1], sentences: scene.sentences, people: [{ id: 'char_1' }, ...(k >= 2 ? [{ id: 'char_2' }] : [])] }));
const reading = { scenes, cards, chart: { entities: [{ id: 'char_1', proper: ['Kamijou'], names: ['Kamijou'] }, { id: 'char_2', proper: ['Index'], names: ['Index'] }] }, slots: [], places: { settings: [] }, time: { scenes: [] } };
const words = { s6: 'Index said: I am hungry, Touma.', s7: 'He sighed.' };
const text = id => words[id] ?? `Sentence ${id}.`;
const picture = { id: 'ill_0001', sentenceId: 's4' };
const prep = { faces: [{ letter: 'A', box: { left: 0.1, top: 0.1, right: 0.3, bottom: 0.3 } }, { letter: 'B', box: { left: 0.35, top: 0.1, right: 0.55, bottom: 0.3 } }], texts: [{ ref: 't1', text: 'I am hungry', box: { left: 0.6, top: 0.1, right: 0.8, bottom: 0.2 } }] };
const gallery = [{ label: 'P1', entityId: 'char_1' }, { label: 'P2', entityId: 'char_2' }];

test('the brief: the units both ways round the picture, raw, their cards and people, faces and texts placed in words', () => {
  const brief = stillsBrief({ reading, text, picture, prep, gallery, window: 1 });
  assert.deepEqual(brief.units.map(unit => unit.id), ['u1', 'u2', 'u3'], 'its own unit and one each way');
  assert.deepEqual(Object.keys(brief.state.passage), ['s2', 's3', 's4', 's5', 's6', 's7']);
  assert.equal(brief.state.units.u2.picture, 'stands after s4');
  assert.deepEqual(brief.state.people.char_2, { name: 'Index', portrait: 'P2' });
  assert.equal(brief.state.faces.A.where, 'left, top');
  assert.equal(whereIn({ left: 0.7, top: 0.7, right: 0.9, bottom: 0.9 }), 'right, bottom');
});

test('the questions: the picture by the face alone first (portraits), then by the text; each text what it is and whose', () => {
  const brief = stillsBrief({ reading, text, picture, prep, gallery, window: 1 });
  const keys = stillsQuestions({ prep, cards: brief.cards, people: brief.people, gallery }).map(question => question.key);
  assert.deepEqual(keys, ['kind', 'card', 'portrait:A', 'who:A', 'card:A', 'portrait:B', 'who:B', 'card:B', 'setting', 'time', 'weather', 'action', 'text:t1', 'whose:t1']);
});

test("the note: a portrait's answer before the text's; people near each other; a said line matched to the sentence that holds it; facts by basis picture", () => {
  const brief = stillsBrief({ reading, text, picture, prep, gallery, window: 1 });
  const replies = [
    { key: 'kind', value: 'moment', confidence: 0.9 }, { key: 'card', value: 'c3', confidence: 0.7 },
    { key: 'portrait:A', value: 'P1', confidence: 0.9 }, { key: 'who:A', value: 'char_2', confidence: 0.95 }, { key: 'card:A', value: 'c3', confidence: 0.8 },
    { key: 'portrait:B', value: 'none', confidence: 0.8 }, { key: 'who:B', value: 'char_2', confidence: 0.7 }, { key: 'card:B', value: 'c3', confidence: 0.8 },
    { key: 'setting', value: 'indoors', confidence: 0.9 }, { key: 'time', value: 'night', confidence: 0.8 }, { key: 'weather', value: 'not shown', confidence: 0.8 }, { key: 'action', value: 'talking', confidence: 0.8 },
    { key: 'text:t1', value: 'said', confidence: 0.9 }, { key: 'whose:t1', value: 'B', confidence: 0.8 },
  ];
  const unitOf = id => ({ c1: 'u1', c2: 'u2', c3: 'u3' })[id] ?? null, firstOf = id => brief.cards.find(card => card.id === id)?.first ?? null;
  const note = stillsNote({ picture, prep, replies, cards: brief.cards, text, unitOf, gallery });
  assert.deepEqual(note.faces.map(face => [face.letter, face.who, face.by]), [['A', 'char_1', 'portrait'], ['B', 'char_2', 'text']], 'the face before the text');
  assert.equal(note.unit, 'u3');
  assert.deepEqual(note.near.map(pair => [pair.a, pair.b]), [['char_1', 'char_2']]);
  assert.deepEqual(note.texts[0], { ref: 't1', kind: 'said', sure: 0.9, who: 'char_2', sentence: 's6', card: 'c3' });
  const facts = pictureFacts(note, firstOf, unitOf);
  assert.deepEqual(facts.map(fact => [fact.who, fact.kind, fact.value, fact.basis, fact.sentence]), [['char_1', 'indoors', null, 'picture', 's6'], ['char_2', 'indoors', null, 'picture', 's6'], ['char_1', 'near', 'char_2', 'picture', 's6']]);
  // Into the notes: the unit it shows gains it, its script supervisor the facts.
  const notes = { units: { u3: { scriptSupervisor: { facts: [{ kind: 'outdoors' }] } } } };
  withPictures(notes, { pictures: [{ ...note, facts }] });
  assert.equal(notes.units.u3.stills.length, 1);
  assert.equal(notes.units.u3.scriptSupervisor.facts.length, 4);
});

test('a said line is found in the sentence holding it; settings say where people are', () => {
  assert.equal(sentenceSaying('hungry', ['s6', 's7'], text), 's6');
  assert.equal(sentenceSaying('ah', ['s6'], text), null, 'too short to tell');
  assert.equal(settingFact('indoors'), 'indoors');
  assert.equal(settingFact('high-rise'), 'outdoors');
  assert.equal(settingFact('not shown'), null);
});
