import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneContext } from './scene-context.mjs';

const node = (id, kind, state = 'canon') => ({ id, label: id, kind, state, parent: 'chapter_0' });
test('one exchange sphere links every stored member without inventing directed speech or presence', () => {
  const nodes = [node('scene_1', 'scene'), node('char_1', 'character'), node('char_2', 'character')];
  const scenes = [{ id: 'scene_1', chapterIndex: 0, sentenceIds: ['s1', 's2'], turns: [], dialogues: [{ id: 'card_1', sentenceIds: ['s1', 's2'], participantIds: ['char_1', 'char_2'], summary: '两人交谈。' }] }];
  const result = sceneContext(nodes, [], scenes, []);
  const card = result.nodes.find(entry => entry.id === 'view-card:scene_1:0');
  assert.deepEqual(card.dialogue.participantIds, ['char_1', 'char_2']);
  assert.equal(card.dialogue.speakerId, undefined);
  assert.equal(card.summary, '两人交谈。');
  assert.equal(result.edges.filter(edge => edge.relationLabel === 'Dialogue participant').length, 2);
  assert.ok(!result.edges.some(edge => edge.kind === 'speaks' || edge.relationLabel === 'Present in scene'));
  assert.equal(sceneContext(result.nodes, result.edges, scenes, []).nodes.length, result.nodes.length);
  assert.ok(!JSON.stringify(result).includes('sentenceIds'));
});
test('a stored faculty scene summary is visible without needing an event excerpt', () => {
  const result = sceneContext([node('scene_1', 'scene')], [], [{ id: 'scene_1', chapterIndex: 0, sentenceIds: ['private_source_id'], summary: '人物相遇，交谈后分开。' }], []);
  assert.equal(result.nodes[0].summary, '人物相遇，交谈后分开。');
  assert.equal(result.nodes[0].label, '人物相遇，交谈后分开。');
  assert.ok(!JSON.stringify(result).includes('private_source_id'));
});
test('scene links and readable summaries come from actual shared evidence and stored rosters', () => {
  const nodes = [node('scene_1', 'scene'), node('evt_1', 'event'), node('char_1', 'character'), node('char_2', 'character'), node('loc_1', 'location')];
  const scenes = [{ id: 'scene_1', chapterIndex: 0, sentenceIds: ['section1_sentence1'], charactersPresent: ['char_1'], charactersMentioned: ['char_2'], locationId: 'loc_1' }];
  const events = [{ id: 'evt_1', chapterIndex: 0, chronologicalOrder: 1, summaryEn: '甲推开门，乙在叙述中被提及。', evidence: { text: 'PRIVATE-RAW-QUOTE', sentenceIds: ['section1_sentence1'] }, primaryActors: ['char_1'] }];
  const before = JSON.stringify({ nodes, scenes, events });
  const result = sceneContext(nodes, [], scenes, events);
  assert.equal(result.nodes[0].label, events[0].summaryEn);
  assert.equal(result.nodes[0].summary, events[0].summaryEn);
  assert.equal(result.nodes[1].summary, events[0].summaryEn);
  assert.ok(result.edges.some((edge) => edge.from === 'scene_1' && edge.to === 'evt_1' && edge.derived));
  assert.equal(result.edges.find((edge) => edge.from === 'char_2').relationLabel, 'Mentioned in scene');
  assert.equal(result.edges.find((edge) => edge.from === 'char_2').kind, 'cross');
  assert.ok(!JSON.stringify(result).includes('sentenceIds'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE-RAW-QUOTE'));
  assert.equal(JSON.stringify({ nodes, scenes, events }), before);
});

test('different chapters, absent evidence and missing endpoints never manufacture memberships or summaries', () => {
  const result = sceneContext([node('scene_1', 'scene'), node('evt_1', 'event')], [], [{ id: 'scene_1', chapterIndex: 0, sentenceIds: ['same'], charactersPresent: ['missing'] }], [{ id: 'evt_1', chapterIndex: 1, summaryEn: 'Other chapter', evidence: { sentenceIds: ['same'] } }]);
  assert.equal(result.nodes[0].summary, undefined);
  assert.equal(result.nodes[0].label, 'scene_1');
  assert.equal(result.edges.length, 0);
});

test('working scene memberships remain ghosts and repeated snapshots do not duplicate derived links', () => {
  const nodes = [node('scene_1', 'scene', 'proposed'), node('evt_1', 'event', 'held')];
  const scenes = [{ id: 'scene_1', chapterIndex: 0, sentenceIds: ['s1'] }];
  const events = [{ id: 'evt_1', chapterIndex: 0, summaryEn: '实际摘要', evidence: { sentenceIds: ['s1'] } }];
  const result = sceneContext(nodes, [], scenes, events);
  assert.equal(result.edges[0].state, 'held');
  assert.equal(sceneContext(result.nodes, result.edges, scenes, events).edges.length, 1);
});

test('each stored spoken turn gets one stable sphere without exporting source quotations or inferring presence', () => {
  const nodes = [{ ...node('scene_1', 'scene', 'proposed'), chrono: 2 }, node('char_1', 'character'), node('evt_1', 'dialogue')];
  nodes[1].label = '上条当麻';
  const scenes = [{ id: 'scene_1', chapterIndex: 0, sentenceIds: ['s1'], turns: [{ speakerId: 'char_1', sentenceIds: ['s1'] }, { speakerId: null, sentenceIds: ['s2'] }] }];
  const events = [{ id: 'evt_1', chapterIndex: 0, summaryEn: '原文语言的摘要', evidence: { text: 'PRIVATE QUOTE', sentenceIds: ['s1'] } }];
  const before = JSON.stringify({ nodes, scenes, events });
  const result = sceneContext(nodes, [], scenes, events);
  const turns = result.nodes.filter((entry) => entry.dialogue);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].dialogue.speakerLabel, '上条当麻');
  assert.equal(turns[0].summary, '原文语言的摘要');
  assert.equal(turns[0].dialogue.text, undefined);
  assert.equal(turns[1].summary, undefined);
  assert.equal(turns[1].dialogue.speakerId, null);
  assert.ok(turns.every((entry) => entry.state === 'proposed'));
  assert.ok(turns[0].chrono < turns[1].chrono);
  assert.ok(!result.edges.some((entry) => entry.relationLabel === 'Present in scene'));
  assert.equal(sceneContext(result.nodes, result.edges, scenes, events).nodes.length, result.nodes.length);
  assert.ok(!JSON.stringify(result).includes('sentenceIds'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE QUOTE'));
  assert.equal(JSON.stringify({ nodes, scenes, events }), before);
});
