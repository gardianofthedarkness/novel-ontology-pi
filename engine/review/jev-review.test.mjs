import test from 'node:test';
import assert from 'node:assert/strict';
import { bookOf, packFor, peopleOf, recall } from './evidence.mjs';
import { asAsked, evidenceQuestion, focusOf, modeOf, NO_LINE, questionsOf, readAnswer, route, STAND, STRICT } from './jev-review.mjs';

const line = n => `b0001_s${String(n).padStart(4, '0')}`;
const sentences = Array.from({ length: 300 }, (_, n) => ({ id: line(n), text: n === 150 ? 'Alice said hello.' : n === 40 ? 'Bob waved at Alice.' : n === 190 ? 'Alice nodded.' : n === 260 ? 'Alice again.' : `line ${n}` }));
const book = bookOf(sentences);
const people = peopleOf({ entities: [{ id: 'char_1', names: [{ text: 'Alice' }], kind: 'Character' }, { id: 'char_2', names: ['Bob'], kind: 'Character' }], slots: [{ id: 'slot_9_1', label: 'the girl', kind: 'person', sentences: [line(45)] }], references: [{ entity: 'char_2', sentences: [line(41)] }], roles: { [line(150)]: { kind: 'spoken', who: { id: 'char_1', confidence: 0.4 }, to: { id: 'char_2' } } } });

test('a pack: the item\'s line, the window by id, then the names by nearness within ±100 (none farther)', () => {
  const pack = packFor({ kind: 'who-speaks', line: line(150), subjects: ['char_1'] }, { book, people }, { window: 5, searched: 10 });
  assert.equal(pack.anchor, line(150));
  assert.equal(pack.lines[0], line(150));
  for (let d = -5; d <= 5; d++) assert.ok(pack.lines.includes(line(150 + d)));
  assert.ok(pack.lines.includes(line(190)), 'Alice named 40 lines on');
  assert.ok(!pack.lines.includes(line(260)), 'more than 100 lines away');
  assert.ok(!pack.lines.includes(line(40)), 'Bob is not searched for Alice');
  assert.equal(recall(pack, [line(150), line(260)]), 0.5);
});

test('a pack with no line of its own (identity): each person\'s own lines and names, the nearest the scenes asked first', () => {
  const scenes = new Map([['scene_000009', { sentences: [line(44), line(45), line(46)] }]]);
  const pack = packFor({ kind: 'identity', subjects: ['slot_9_1', 'char_2'], question: 'Are the girl (slot_9_1) and Bob the same? scene_000009' }, { book, people, scenes });
  assert.equal(pack.anchor, null);
  assert.ok([line(45), line(41), line(40)].every(id => pack.lines.includes(id)), pack.lines.join(' '));
});

test('a card id with "#n" anchors on its sentence', () => {
  assert.equal(packFor({ kind: 'reach', card: 'action:b0001_s0150#2', subjects: [] }, { book, people }).anchor, line(150));
});

test('who-speaks is asked with the repaired options: the one spoken to included, the crowd one option, "unnamed" folded', () => {
  const ledger = new Map([['r:s1', { value: { candidates: ['char_1', 'crowd:9:1', 'crowd:9:2', 'unnamed'], to: 'char_2' } }]]);
  const asked = asAsked({ id: 'wi_1', kind: 'who-speaks', ledger: 'r:s1', line: line(150), subjects: ['char_1'], options: ['char_1', 'none of them'], question: 'Who says it?' }, { ledger });
  assert.deepEqual(asked.options, ['char_1', 'char_2', 'someone in the crowd', 'a voice from elsewhere', 'someone unnamed']);
});

test('the request: the item, the lines in reading order with the reading\'s speaker, the evidence over the lines kept', async () => {
  const item = { id: 'wi_1', kind: 'who-speaks', line: line(150), subjects: ['char_1', 'char_2'], options: ['char_1', 'char_2', 'a voice from elsewhere'], optionHints: {}, question: 'Who says it?' };
  const pack = packFor(item, { book, people }, { window: 3, searched: 5 });
  const focus = focusOf(item, pack, { book, people, roles: { [line(150)]: { kind: 'spoken', who: { id: 'char_1', confidence: 0.4 }, to: { id: 'char_2' } } } });
  const mode = modeOf('who-speaks');
  const [verdict, ...more] = questionsOf(focus);
  assert.deepEqual([verdict.options, more], [item.options, []]);
  assert.equal(verdict.optionHints.char_1, 'Alice');
  // The evidence, asked after the verdict and with it: each line by its words, not its bare id.
  const evidence = evidenceQuestion(focus, focus.lines.map(entry => entry.id).reverse(), { value: 'char_1', hint: 'Alice' });
  assert.equal(evidence.options.at(-1), NO_LINE);
  assert.deepEqual(evidence.options.slice(0, -1), [...evidence.options.slice(0, -1)].sort());
  assert.match(evidence.instructions, /is: Alice\./);
  assert.equal(evidence.optionHints[line(150)], 'Alice: Alice said hello.');
  assert.match(evidenceQuestion(focus, [line(150)]).instructions, /your answer/);
  const document = mode.render({ task: 't', lines: Object.fromEntries([...focus.lines].reverse().map(({ id, fields }) => [id, fields])) });
  assert.deepEqual(Object.keys(document.lines), Object.keys(document.lines).sort());
  assert.match(focus.lines.find(entry => entry.id === line(150)).fields.said_by, /Alice \(char_1, 0.4\)/);
});

test('routing: Jev stands at 0.5 or more; below, the work model\'s answer is used, and a disagreement goes to Pi', () => {
  const item = { kind: 'who-speaks' };
  assert.deepEqual(route(item, { jev: { value: 'a', confidence: STAND }, jevLine: { value: line(1) } }), { verdict: 'a', line: line(1), by: 'jev', stands: true, escalate: [] });
  const agreed = route(item, { jev: { value: 'a', confidence: 0.3 }, jevLine: { value: line(1) }, work: { value: 'a' }, workLine: { value: line(2) } });
  assert.deepEqual([agreed.by, agreed.line, agreed.stands], ['work', line(2), true]);
  assert.equal(route(item, { jev: { value: 'a', confidence: 0.3 }, jevLine: { value: line(1) }, work: { value: 'b' }, workLine: { value: line(2) } }).stands, false);
  assert.match(route(item, { jev: { value: 'a', confidence: 0.9 }, jevLine: { value: NO_LINE } }).escalate[0], /no line/);
  assert.match(route(item, { jev: { value: 'a', confidence: 0.9 }, jevLine: { value: line(1) }, law: 'L2: x' }).escalate[0], /L2/);
});

test('routing: identity stands only with Jev at 0.8 or more and the work model agreeing', () => {
  const item = { kind: 'identity' };
  assert.equal(route(item, { jev: { value: 'same', confidence: STRICT }, jevLine: { value: line(1) }, work: { value: 'same' } }).stands, true);
  assert.equal(route(item, { jev: { value: 'same', confidence: 0.79 }, jevLine: { value: line(1) }, work: { value: 'same' } }).stands, false);
  assert.equal(route(item, { jev: { value: 'same', confidence: 0.95 }, jevLine: { value: line(1) }, work: { value: 'different' } }).stands, false);
});

test('an answer read from the replies: the pick, how sure, the runner-up', () => {
  const answer = readAnswer([{ key: 'verdict', value: 'a', confidence: 0.6, distribution: { a: 0.6, b: 0.3, c: 0.1 } }], 'verdict');
  assert.deepEqual([answer.value, answer.confidence, answer.runnerUp, answer.runnerUpP], ['a', 0.6, 'b', 0.3]);
  assert.equal(readAnswer([], 'verdict'), null);
});

// §16: who-speaks fixes.
import { nearbyPeople, quoteSpans, voiceMarks, voicesOf } from './evidence.mjs';
import { askedQuote, quoteGroups } from './jev-review.mjs';
import { gramsOf } from './voices.mjs';

test('a quotation over several lines is one span, opened where its mark opens; a quote left open is dropped', () => {
  const q = bookOf([['a', 'narration'], ['b', '“one'], ['c', 'two'], ['d', 'three”'], ['e', '“short”'], ['f', 'after'], ['g', '“open'], ...Array.from({ length: 14 }, (_, n) => [`h${n}`, 'x'])].map(([id, text]) => ({ id, text })));
  const spans = quoteSpans(q);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map(id => spans.get(id) ?? null), [null, 'b', 'b', 'b', 'e', null]);
  assert.equal(spans.get('h13'), undefined, 'not past 12 lines');
});

test('the people near a line: sure speakers and listeners, then named characters, never slot labels', () => {
  const near = nearbyPeople(line(150), { book, people, roles: { [line(148)]: { kind: 'spoken', who: { id: 'char_2', confidence: 0.9 }, to: { id: 'slot_9_1' } } } }, { radius: 35 });
  assert.deepEqual(near, ['char_1', 'char_2', 'slot_9_1'], 'the line itself names Alice; then the speaker and listener 2 lines off');
});

test('a voice: pieces said far more than anyone’s, across scenes, not one conversation’s topic', () => {
  const lines = [
    ...[1, 2, 3, 4].map(n => ({ who: 'a', quote: `misaka says ${n}`, scene: `s${n}` })),
    ...[1, 2, 3].map(n => ({ who: 'a', quote: `darts darts ${n}`, scene: 's1' })),
    ...Array.from({ length: 20 }, (_, n) => ({ who: 'b', quote: `plain talk ${n}`, scene: `s${n}` })),
  ];
  const marks = voiceMarks(voicesOf(lines, gramsOf), 'a');
  assert.ok(marks.some(mark => mark.includes('mi')), marks.join('|'));
  assert.ok(!marks.some(mark => mark.includes('da')), 'darts is one scene’s topic');
});

test('a quote’s who-speaks items are asked as one, every line, every option', () => {
  const q = bookOf([['b1_s1', '“one'], ['b1_s2', 'two”'], ['b1_s3', '“three”']].map(([id, text]) => ({ id, text })));
  const items = [{ id: 'x', kind: 'who-speaks', scene: 's', line: 'b1_s2', subjects: ['c2'], options: ['c2'] }, { id: 'y', kind: 'who-speaks', scene: 's', line: 'b1_s1', subjects: ['c1'], options: ['c1'] }, { id: 'z', kind: 'who-speaks', scene: 's', line: 'b1_s3', subjects: ['c1'], options: ['c1'] }];
  const groups = quoteGroups(items, { book: q, spans: quoteSpans(q) });
  assert.deepEqual(groups.map(group => group.map(item => item.id)), [['y', 'x'], ['z']]);
  const asked = askedQuote(groups[0]);
  assert.deepEqual([asked.lines, asked.subjects, asked.group], [['b1_s1', 'b1_s2'], ['c1', 'c2'], ['y', 'x']]);
  assert.match(asked.question, /one quotation/);
  assert.equal(askedQuote(groups[1]), groups[1][0]);
});

test('who-speaks options widened by the reading’s guess and the people near the line', () => {
  const ledger = new Map([['r:s1', { value: { candidates: ['char_1'], to: null } }]]);
  const asked = asAsked({ id: 'wi_1', kind: 'who-speaks', ledger: 'r:s1', line: line(150), subjects: ['char_1'], options: [] }, { ledger, book, people, roles: { [line(150)]: { kind: 'spoken', who: { id: null, answer: 'char_2', confidence: 0.3 } } } });
  assert.deepEqual(asked.options.slice(0, 2), ['char_1', 'char_2']);
});
