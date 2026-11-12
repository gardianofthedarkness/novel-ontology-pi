// Tests for the place tree by the agent: every decision needs a line of the book that shows it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, namesAlone, placedScenes, movesOf, checkOf } from './place-tree.mjs';

const CITY = '\u5b66\u56ed\u90fd\u5e02', KYOTO = '\u4eac\u90fd', TOKYO = '\u4e1c\u4eac\u90fd';
function stores() {
  const lines = [
    ['s1', '\u4e0a\u6761\u8d70\u5728\u5b66\u56ed\u90fd\u5e02\u7684\u8857\u4e0a\u3002'], ['s2', '\u4ed6\u56de\u5230\u5bbf\u820d\u95e8\u53e3\u3002'], ['s3', '\u4e1c\u4eac\u90fd\u7684\u65b0\u95fb\u3002'], ['s4', '\u4ed6\u60f3\u8d77\u4eac\u90fd\u7684\u5bfa\u5e99\u3002'],
    ['s5', '\u623f\u95f4\u91cc\u5f88\u5b89\u9759\u3002'], ['s6', '\u4ed6\u5750\u4e0a\u98de\u673a\u53bb\u4eac\u90fd\u3002'],
  ];
  const text = new Map(lines.map(([id, t]) => [id, { text: t }]));
  const order = lines.map(([id]) => id);
  return {
    text, order, at: new Map(order.map((id, n) => [id, n])), entity: new Map(),
    sceneLines: new Map([['u1', ['s1']], ['u2', ['s2']], ['u3', ['s3', 's4']], ['u4', ['s5']], ['u5', ['s6']]]),
    original: {
      places: {
        city: { label: CITY, scale: 'city' }, kyoto: { label: KYOTO, scale: 'city' },
        'pool:city': { label: CITY + ' \u00b7 pool', parent: 'city', scale: 'district' },
        'pool:kyoto': { label: KYOTO + ' \u00b7 pool', parent: 'kyoto', scale: 'district' },
        'unnamed:dorm': { label: '\u7537\u751f\u5bbf\u820d (scene 2)', parent: 'pool:kyoto', scale: 'building', unnamed: true },
      },
      scenes: [
        { id: 'u1', chapter: 1, place: 'city', present: ['a'] }, { id: 'u2', chapter: 1, place: 'unnamed:dorm', present: ['a'] },
        { id: 'u3', chapter: 1, place: 'kyoto', present: ['a'] }, { id: 'u4', chapter: 1, place: 'unnamed:dorm', present: ['a'] },
        { id: 'u5', chapter: 1, place: 'kyoto', present: ['a'] },
      ],
    },
    decisions: { version: 1, places: {}, units: {}, holds: {}, travels: {}, log: [] },
  };
}
const args = (positional, more = {}) => ({ positional, ...more });
const refused = fn => assert.throws(fn, e => e.refused === true);

test('a name inside a longer place name is not that place', () => {
  assert.equal(namesAlone('\u4e1c\u4eac\u90fd\u7684\u65b0\u95fb\u3002', KYOTO), false);
  assert.equal(namesAlone('\u4ed6\u60f3\u8d77\u4eac\u90fd\u7684\u5bfa\u5e99\u3002', KYOTO), true);
});

test('a setting needs a line that names it; a mention or drop is turned back only with --override', () => {
  const s = stores();
  refused(() => decide(s, 'setting', args(['kyoto'], { line: 's3', why: 'Tokyo news' })));
  decide(s, 'setting', args(['city'], { line: 's1', why: 'he walks its streets' }));
  decide(s, 'drop', args(['kyoto'], { why: 'only remembered' }));
  refused(() => decide(s, 'setting', args(['kyoto'], { line: 's4', why: 'temple' })));
  decide(s, 'mention', args(['kyoto'], { why: 'only remembered', override: true }));
  assert.equal(s.decisions.places.kyoto.status, 'mention');
});

test('units under a mention lose their place until held or set, and the head noun of an unnamed place is its name', () => {
  const s = stores();
  decide(s, 'setting', args(['city'], { line: 's1', why: 'streets' }));
  decide(s, 'mention', args(['kyoto'], { why: 'only remembered' }));
  assert.equal(placedScenes(s).find(u => u.id === 'u2').place, null);
  decide(s, 'hold', args(['unnamed:dorm', 'pool:city'], { line: 's2', why: 'his dorm is in the city' }));
  assert.equal(placedScenes(s).find(u => u.id === 'u2').place, 'unnamed:dorm');
  refused(() => decide(s, 'set', args(['u4', 'unnamed:dorm'], { line: 's1', why: 'too far before' })));
  decide(s, 'same', args(['u4', 'u2'], { why: 'still in the dorm' }));
  assert.equal(placedScenes(s).find(u => u.id === 'u4').place, 'unnamed:dorm');
});

test('a change of city with no travel line is an unproved move until a line shows the journey', () => {
  const s = stores();
  decide(s, 'setting', args(['city'], { line: 's1', why: 'streets' }));
  decide(s, 'setting', args(['kyoto'], { line: 's6', why: 'he flies there' }));
  assert.ok(movesOf(s).some(m => m.to === 'u2'));
  refused(() => decide(s, 'travel', args(['u2', 'a'], { line: 's6', why: 'not near' })));
  decide(s, 'travel', args(['u5', 'a'], { line: 's6', why: 'by plane' }));
  assert.ok(!movesOf(s).some(m => m.to === 'u5'));
  assert.ok(checkOf(s).unprovedMoves >= 1);
});
