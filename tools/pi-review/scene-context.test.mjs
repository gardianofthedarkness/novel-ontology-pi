import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneContext } from './scene-context.mjs';

const node = (id, kind, state = 'canon') => ({ id, label: id, kind, state, parent: 'chapter_0' });
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
