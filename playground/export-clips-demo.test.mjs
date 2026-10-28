import test from 'node:test';
import assert from 'node:assert/strict';
import { inlinePage, trimPlace } from './export-clips-demo.mjs';

const beat = (sceneId, record, extra = {}) => ({ id: `${sceneId}:${record}`, kind: record === 'card' ? 'scene' : 'event', sceneId, placeId: 'loc_1', title: record, text: record, actors: [`char_${record}`], present: [], conflict: false, scene: 1, ...extra });

test('a place keeps only what its clips play: scene card to last beat, no quotes or source positions', () => {
  const beats = [beat('s1', 'card'), beat('s1', 'e1'), beat('s1', 'e2', { quote: '原话', source: { from: 1, to: 2 } }), beat('s1', 'e3'), beat('s2', 'card'), beat('s2', 'e1'), beat('s3', 'card'), beat('s3', 'e1'), beat('s3', 'e2')];
  const script = { title: 'Tower', places: [{ id: 'loc_1', label: 'Tower', kind: 'skyscraper', x: 0, z: 0, scenes: 3 }], actors: [...new Set(beats.map(entry => entry.actors[0]))].map(id => ({ id, label: id, color: '#fff', beats: 1 })), beats };
  const plan = { place: 'loc_1', kind: 'skyscraper', starts: { s1: { char_e1: '1f-hall' }, s2: {}, s3: {} }, moves: { 's1:e2': [{ actor: 'char_e2', to: '2f-hall', how: 'walk', p: 1 }], 's2:e1': [{ actor: 'char_e1', to: '1f-hall', how: 'run', p: 1 }], 's3:e2': [{ actor: 'char_e2', to: '3f-hall', how: 'walk', p: 1 }] } };
  const clip = (sceneId, from, to) => ({ id: `loc_1:${sceneId}`, placeId: 'loc_1', sceneId, title: sceneId, scene: 'Scene 1', place: 'Tower', kind: 'skyscraper', from, to, moves: 1, movers: 1, at: from });
  // Clips arrive in reading order of the book, not of the place's script.
  const { clips, script: kept, plan: moves } = trimPlace([clip('s3', 7, 8), clip('s1', 1, 2)].map(entry => ({ clip: entry, script, plan })));
  assert.deepEqual(kept.beats.map(entry => entry.id), ['s1:card', 's1:e1', 's1:e2', 's3:card', 's3:e1', 's3:e2']);
  assert.deepEqual(clips.map(entry => [entry.sceneId, entry.from, entry.to]), [['s1', 1, 2], ['s3', 4, 5]]);
  assert.ok(kept.beats.every(entry => !('quote' in entry) && !('source' in entry)));
  assert.deepEqual(Object.keys(moves.moves), ['s1:e2', 's3:e2']);
  assert.deepEqual(Object.keys(moves.starts), ['s1', 's3']);
  assert.deepEqual(kept.actors.map(actor => actor.id).sort(), ['char_card', 'char_e1', 'char_e2']);
});

test('the page inlines its script, style and clips, and never carries a private viewer path', () => {
  const html = '<!doctype html>\n<html lang="zh">\n<head><meta charset="UTF-8" /><title>Holo Stage Clips</title>\n<script type="module" crossorigin src="./assets/a.js"></script>\n<link rel="stylesheet" crossorigin href="./assets/a.css">\n</head>\n<body>\n<div id="root"></div>\n<script type="application/json" id="clips-data"></script>\n</body>\n</html>\n';
  const page = inlinePage(html, { script: 'const tag = "</script>";', style: '.a{}', data: { books: [{ title: '</script><b>' }] } });
  assert.match(page, /<style>\.a\{\}<\/style>/);
  assert.ok(page.includes('const tag = "<\\/script>";'));
  assert.ok(page.includes('\\u003c/script>\\u003cb>'));
  assert.ok(!page.includes('src="./assets/a.js"'));
  const fragment = inlinePage(html, { script: '', style: '', data: { books: [] }, fragment: true });
  assert.ok(fragment.startsWith('<title>Holo Stage Clips</title>') && !/<(?:!doctype|html|head|body)\b/i.test(fragment));
  assert.throws(() => inlinePage(html, { script: '', style: '', data: { books: [{ title: `/view/${'a'.repeat(43)}/` }] } }), /private viewer path/);
});
