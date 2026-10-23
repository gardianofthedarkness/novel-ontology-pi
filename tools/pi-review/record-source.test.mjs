import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionBlock } from '../../dist/src/text/sectioning.js';
import { recordSource } from './record-source.mjs';

const text = '甲走进房间。\n\n「你好！」\n「再见。」\n\n甲离开房间。';
const scene = { id: 'scene_1', sentenceIds: ['b0000_s0000', 'b0000_s0001', 'b0000_s0002', 'b0000_s0003'], turns: [{ sentenceIds: ['b0000_s0001', 'b0000_s0002'] }] };
const options = { scenes: [scene], events: [], readBlock: async () => text, sectionBlock };
test('original scene and full turn text preserve whitespace and do not substitute summaries or evidence quotes', async () => {
  assert.equal((await recordSource({ ...options, id: scene.id })).text, text);
  const result = await recordSource({ ...options, id: 'view-turn:scene_1:0' });
  assert.equal(result.text, '「你好！」\n「再见。」');
  assert.equal(result.complete, true);
  assert.equal(result.contiguous, true);
  assert.equal(await recordSource({ ...options, id: 'view-turn:scene_1:9' }), null);
  assert.equal(await recordSource({ ...options, id: '../../secrets' }), null);
});
test('missing and noncontiguous provenance is explicit and arbitrary paths are never passed to the loader', async () => {
  const calls = [];
  const result = await recordSource({ ...options, id: scene.id, scenes: [{ ...scene, sentenceIds: ['b0000_s0003', '../secret', 'b0000_s0000', 'b9999_s0000'] }], readBlock: async (index) => { calls.push(index); if (index !== 0) throw new Error('PRIVATE PATH'); return text; } });
  assert.deepEqual(calls, [0, 9999]);
  assert.equal(result.complete, false);
  assert.equal(result.contiguous, false);
  assert.equal(result.missing, 2);
  assert.deepEqual(result.segments, ['甲走进房间。', '甲离开房间。']);
  assert.ok(!JSON.stringify(result).includes('PRIVATE PATH'));
});

test('expanded scene text includes all stored sentences and intervening narration without excerpt truncation', async () => {
  const original = Array.from({ length: 90 }, (_, index) => index % 3 ? `他在第${index}步停了下来。` : `“这是第${index}次说话。”`).join('\n\n');
  const references = sectionBlock(original, 0).sentences.map(sentence => sentence.id);
  const result = await recordSource({ id: 'scene_long', scenes: [{ id: 'scene_long', sentenceIds: references }], events: [], readBlock: async () => original, sectionBlock });
  assert.equal(result.text, original);
  assert.equal(result.complete, true);
  assert.equal(result.contiguous, true);
  assert.ok(result.text.includes('第89步'));
});
