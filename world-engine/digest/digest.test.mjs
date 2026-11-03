import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWindow, checkScene, digestScene, metered, windowsOf } from './digest.mjs';
import { bestFor, binding, holds, TYPE } from './facts.mjs';
import { losesMotion } from '../director/system2.mjs';

test('windows never cut a card', () => {
  const sentences = Array.from({ length: 10 }, (_, n) => `s${n}`), cardOf = new Map([['s2', 'c'], ['s3', 'c'], ['s4', 'c']]);
  assert.deepEqual(windowsOf(sentences, cardOf, 3).map(window => window.length), [5, 3, 2], 'the first window runs on to the end of the card it would cut');
});

test('a window\'s entries keep only known people, lines and values', () => {
  const reply = { moves: [{ sentence: 's1', who: 'a', motion: 'step', toward: 'b', how: 'run', basis: 'stated', sure: 0.9 }, { sentence: 's9', who: 'a', motion: 'step' }, { sentence: 's1', who: 'z', motion: 'step' }, { sentence: 's1', who: 'a', motion: 'teleport' }],
    facts: [{ sentence: 's1', who: 'a', kind: 'indoors', basis: 'implied', sure: 0.8 }, { sentence: 's1', who: 'a', kind: 'near', value: 'a' }, { sentence: 's1', who: 'a', kind: 'floor', value: '3', sure: 2 }, { sentence: 's1', who: 'a', kind: 'feature', value: 'chimney' }],
    items: [{ sentence: 's1', item: '手机', event: 'held', who: 'a', size: 0.15 }, { sentence: 's1', item: '', event: 'held' }], talk: [{ sentence: 's1', kind: 'remote' }, { sentence: 's1', kind: 'telepathy' }],
    background: [{ sentence: 's1', who: 'crowd', doing: 'strolling' }] };
  const out = checkWindow(reply, { people: ['a', 'b'], sentences: ['s1', 's2'] });
  assert.equal(out.moves.length, 1); assert.equal(out.moves[0].toward, 'b');
  assert.deepEqual(out.facts.map(fact => [fact.kind, fact.value, fact.sure]), [['indoors', null, 0.8], ['floor', 3, 1]]);
  assert.equal(out.items.length, 1); assert.deepEqual(out.talk, [{ sentence: 's1', kind: 'remote' }]); assert.equal(out.background[0].who, 'crowd');
  assert.equal(checkScene({ people: [{ who: 'a', doing: 'strolling', holding: ['伞'] }, { who: 'q' }], background: { crowd: 'many' } }, { people: ['a'] }).people.length, 1);
});

test('a scene digested: the scene first, then its windows with it; a failed window leaves its lines unread', async () => {
  const asked = [];
  const work = metered({ modelId: 'fake', async generateWithUsage({ prompt }) {
    const request = JSON.parse(prompt); asked.push(request.passage ? 'window' : 'scene');
    if (!request.passage) return { content: JSON.stringify({ summary: 'they walk', people: [{ who: 'a', doing: 'strolling' }], background: { doing: 'strolling', crowd: 'few' }, memory: 'a walks' }), usage: { promptTokens: 10, completionTokens: 5 } };
    if (request.passage[0].id === 's30') throw new Error('down');
    return { content: JSON.stringify({ moves: request.passage.map(line => ({ sentence: line.id, who: 'a', motion: 'step', sure: 0.7 })) }), usage: { promptTokens: 20, completionTokens: 8 } };
  } });
  const sentences = Array.from({ length: 40 }, (_, n) => `s${n}`);
  const result = await digestScene(work, { scene: { id: 'x', sentences }, line: id => `line ${id}`, kind: () => 'narration', people: [{ id: 'a', name: 'A' }] });
  assert.equal(asked[0], 'scene'); assert.equal(result.digest.people[0].doing, 'strolling');
  assert.equal(result.moves.length, 30); assert.deepEqual(result.failed, ['window 2']); assert.equal(result.covered.length, 30);
  assert.equal(work.usage.requests, 3); assert.equal(work.usage.failed, 1); assert.equal(work.usage.prompt, 30, "the failed request used nothing");
});

test('facts are regions: indoors, a floor, near someone, by a window; the best spot fits more and is near', () => {
  const street = { x: 0, y: 0, z: 0, type: TYPE.outdoor, edge: 99, door: 99, street: true }, room = { x: 6, y: 6, z: 0, type: TYPE.room, edge: 1, door: 99 }, hall = { x: 4, y: 0, z: 0, type: TYPE.circulation, edge: 2, door: 2 };
  assert.equal(holds({ kind: 'indoors' }, street), false); assert.equal(holds({ kind: 'indoors' }, room), true); assert.equal(holds({ kind: 'indoors' }, { ...room, type: TYPE.underground }), false, 'a basement is not indoors unless said');
  assert.equal(holds({ kind: 'floor', value: 3 }, room), true); assert.equal(holds({ kind: 'floor', value: 'ground' }, room), false);
  assert.equal(holds({ kind: 'feature', value: 'window' }, room), true); assert.equal(holds({ kind: 'feature', value: 'window' }, { ...street, edge: 2 }), true); assert.equal(holds({ kind: 'feature', value: 'door' }, hall), true);
  assert.equal(holds({ kind: 'near', value: 'b' }, street, () => [2, 0, 1]), true); assert.equal(holds({ kind: 'near', value: 'b' }, street, () => null), null);
  assert.equal(binding({ basis: 'implied', sure: 0.6 }), false); assert.equal(binding({ basis: 'stated', sure: 0.6 }), true);
  const indoors = [{ kind: 'indoors', basis: 'implied', sure: 0.8 }];
  assert.equal(bestFor(indoors, street, [room, hall]), hall, 'indoors: the nearer of the two');
  assert.equal(bestFor(indoors, room, [hall]), null, 'already agrees: no move');
});

test('system 2 keeps motion: the work model may not take a move away', () => {
  assert.equal(losesMotion('b0001_s0002|show', 'moves', 'none'), true);
  assert.equal(losesMotion('moves', 'goes', 'stays'), true);
  assert.equal(losesMotion('moves', 'stays', 'goes'), false);
  assert.equal(losesMotion('direction', 'A', 'stays'), false);
});

test('things are objects: not body parts, people, or names in English', async () => {
  const { isThing } = await import('./digest.mjs');
  assert.deepEqual(['手机', '右手', '指尖', '幼女', '幼女的书包', 'a phone', '幼女 in a car', '伞'].map(name => isThing(name, ['幼女', '御坂美琴'])), [true, false, false, false, true, false, false, true]);
});

test('scale and view: a beat\'s zoom and metres agree, its angle and reach from their lists; a failed beat a street, unsure', async () => {
  const { checkScale, scaleBeats } = await import('./digest.mjs');
  assert.deepEqual(checkScale({ zoom: 'district', metres: 20, angle: 'aerial', reach: '300 m – 2 km', sure: 0.8 }), { zoom: 'district', metres: 500, angle: 'aerial', from: null, reach: '300 m – 2 km', sure: 0.8 });
  const work = { generate: async ({ prompt }) => { const { beat } = JSON.parse(prompt); if (beat.type === 'catastrophe') throw new Error('down'); return JSON.stringify({ zoom: beat.type === 'traversal' ? 'block' : 'room', metres: 250, angle: 'high', reach: '50–300 m' }); } };
  const out = await scaleBeats(work, { scene: { id: 's' }, beats: [{ n: 4, type: 'traversal', lead: 'mega', sentences: ['x'] }, { n: 5, type: 'catastrophe', lead: 'combat', sentences: ['y'] }], line: () => '', kind: () => null, people: [] });
  assert.deepEqual(out.map(entry => [entry.n, entry.zoom, entry.metres]), [[4, 'block', 250], [5, 'street', 80]]);
  assert.equal(out[1].failed, true);
});

test('journeys: known people and lines only, a destination required, the manner from its list', async () => {
  const { checkJourneys } = await import('./digest.mjs');
  const out = checkJourneys({ journeys: [{ sentence: 's1', who: 'a', to: 'loc_000012', manner: 'leaps between roofs', distance: '300 m – 2 km', sure: 0.9 }, { sentence: 's1', who: 'z', to: 'x' }, { sentence: 's9', who: 'a', to: 'x' }, { sentence: 's1', who: 'a' }, { sentence: 's1', who: 'a', to: 'the bridge', manner: 'teleport' }] }, { people: ['a'], sentences: ['s1'] });
  assert.deepEqual(out.map(entry => [entry.to, entry.manner, entry.distance]), [['loc_000012', 'leaps between roofs', '300 m – 2 km'], ['the bridge', 'walk', '50–300 m']]);
});

test('exchanges: a person on one side at least, known lines, values from their lists, the knock-back bounded', async () => {
  const { checkExchanges } = await import('./digest.mjs');
  const out = checkExchanges({ exchanges: [{ sentence: 's1', attacker: 'a', target: 'b', attack: 'beam or laser', shape: 'line or beam', range: 'far (under 100 m)', outcome: 'hit', knockback: 400, condition: 'unconscious', sure: 0.7 }, { sentence: 's1', attacker: 'x', target: 'y' }, { sentence: 's1', attacker: null, target: 'b', attack: 'the ground or a building itself', outcome: 'dodged' }] }, { people: ['a', 'b'], sentences: ['s1'] });
  assert.deepEqual(out.map(entry => [entry.attacker, entry.attack, entry.knockback, entry.condition]), [['a', 'beam or laser', 60, 'unconscious'], [null, 'the ground or a building itself', 0, null]]);
});

test('talk: channels and formations from their lists, a formation of two or more known people', async () => {
  const { checkTalk, CHANNELS } = await import('./digest.mjs');
  const out = checkTalk({ exchanges: [{ sentence: 's1', who: 'a', with: ['b', 'z'], channel: 'phone', sure: 0.9 }, { sentence: 's1', who: 'a', channel: 'carrier pigeon' }], formations: [{ sentence: 's1', who: ['a', 'b', 'a'], formation: 'facing' }, { sentence: 's1', who: ['a'], formation: 'a ring' }], attention: [{ sentence: 's1', who: 'a', looksAt: 'a' }, { sentence: 's1', who: 'b', looksAt: 'a' }] }, { people: ['a', 'b'], sentences: ['s1'] });
  assert.deepEqual(out.exchanges.map(entry => [entry.channel, entry.with]), [['phone', ['b']]]);
  assert.equal(CHANNELS[out.exchanges[0].channel], 'remote');
  assert.deepEqual(out.formations.map(entry => [entry.who, entry.formation]), [[['a', 'b'], 'facing']]);
  assert.deepEqual(out.attention, [{ sentence: 's1', who: 'b', looksAt: 'a' }]);
});
