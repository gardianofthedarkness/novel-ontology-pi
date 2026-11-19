import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grams, overlaps, labelOf, fullNameShared } from './cast.mjs';

// Made-up names, CJK written as escapes so no book's characters are in the repository.
const FULL = '\u6797\u6653\u6708', SHORT = '\u6797\u6653', TITLED = '\u533b\u751f\u6797\u6653', OTHER = '\u738b\u660e';

test('a name is its runs of two characters (CJK) or its words (other scripts)', () => {
  assert.deepEqual([...grams(FULL)], [SHORT, '\u6653\u6708']);
  assert.deepEqual([...grams('Stiyl Magnus')], ['stiyl', 'magnus']);
  assert.deepEqual([...grams('Al')], [], 'too short to say anything');
});

test('candidates share a run of two characters, not a single one', () => {
  assert.ok(overlaps([FULL], [TITLED]));
  assert.ok(!overlaps([FULL], [OTHER]));
  assert.ok(overlaps(['Stiyl'], ['stiyl magnus']));
});

test('a full name shared is evidence; a shared short form is not', () => {
  const person = { forms: [FULL, SHORT] }, again = { forms: [FULL] }, titled = { forms: [TITLED, SHORT] };
  assert.equal(labelOf(person.forms), FULL);
  assert.ok(fullNameShared(person, again));
  assert.ok(!fullNameShared(person, titled), 'only the family name is shared');
});
