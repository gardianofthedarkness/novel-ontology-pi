import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '../dist/src/ground/workspace/init.js';
import { BundleStore } from '../dist/src/ground/connectors/bundle.js';
import { buildGraphFromBundle } from '../dist/src/ground/connectors/ladybug.js';
import { cutBlocks, splitChapters } from '../dist/src/digger/intake/blocks.js';
import { sectionBlock } from '../dist/src/digger/intake/sectioning.js';

export const repository = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const fixtureDirectory = fileURLToPath(new URL('./fixtures/lantern-harbor/', import.meta.url));
const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function preparePlayground(directory) {
  const home = resolve(directory);
  await mkdir(home, { mode: 0o700 });
  const fixtureBytes = await readFile(join(fixtureDirectory, 'story.json'));
  const story = JSON.parse(fixtureBytes);
  const parts = [];
  const ranges = [];
  let offset = 0;
  const append = value => { parts.push(value); offset += value.length; };
  for (const [chapterIndex, chapter] of story.chapters.entries()) {
    append(`${chapter.title}\n\n`);
    for (const scene of chapter.scenes) {
      const text = scene.lines.join('\n');
      ranges.push({ ...scene, chapterIndex, start: offset, end: offset + text.length });
      append(`${text}\n\n`);
    }
  }
  const text = parts.join('');
  const input = join(home, 'lantern-harbor.txt');
  await writeFile(input, text, { flag: 'wx', mode: 0o600 });
  const reference = join(home, 'reference');
  const workspace = join(home, 'live');
  await initWorkspace(reference);
  await initWorkspace(workspace);
  const ontology = join(reference, 'ontology');
  const store = new BundleStore(ontology);
  await store.init({ novelId: story.id, title: story.title, schemaVersion: 1, sourceLanguages: [story.language], embeddingModel: null, embeddingDimension: null, decisionModel: 'illustrative-fixture-no-model', blocksProcessed: 0 });
  await writeFile(join(reference, 'source', 'lantern-harbor.txt'), text, { mode: 0o600 });
  for (const entity of story.entities) await store.upsertEntity({ id: entity.id, kind: entity.kind, names: [{ text: entity.name, lang: story.language, kind: 'canonical' }], properties: { fixture: story.id }, confidence: 1 });
  const metadata = join(home, 'metadata');
  await mkdir(metadata, { mode: 0o700 });
  const blocks = cutBlocks(text);
  assert.equal(blocks.length, story.chapters.length);
  const sectioned = blocks.map(block => {
    let cursor = 0;
    const sentences = sectionBlock(block.text, block.index).sentences.map(sentence => {
      const start = block.text.indexOf(sentence.text, cursor);
      assert.ok(start >= cursor);
      cursor = start + sentence.text.length;
      return { ...sentence, startOffset: start, endOffset: cursor };
    });
    return { block, sentences };
  });
  for (const block of blocks) await writeFile(join(metadata, `${block.id}.txt`), block.text, { mode: 0o600 });
  const events = [];
  for (const [index, scene] of ranges.entries()) {
    const containing = sectioned.find(({ block }) => scene.start >= block.startOffset && scene.end <= block.endOffset);
    assert.ok(containing, 'Every authored scene must fit a processing block');
    const sentences = containing.sentences.filter(sentence => sentence.startOffset + containing.block.startOffset >= scene.start && sentence.endOffset + containing.block.startOffset <= scene.end);
    assert.equal(sentences.length, scene.lines.length);
    const id = `scene_${String(index + 1).padStart(3, '0')}`;
    const sentenceIds = sentences.map(sentence => sentence.id);
    await store.upsertScene({ id, chapterIndex: scene.chapterIndex, sentenceIds, charactersPresent: scene.characters, charactersMentioned: [], turns: [], dialogues: [{ id: `card_${id}`, sentenceIds: sentenceIds.slice(1), participantIds: scene.dialogueParticipants ?? scene.characters, summary: scene.lines.slice(1).join('') }], locationId: scene.location, summary: scene.summary });
    const event = { id: `evt_${String(index + 1).padStart(3, '0')}`, timelineId: 'tl_canon', chapterIndex: scene.chapterIndex, chronologicalOrder: index + 1, eventType: 'action', summaryEn: scene.summary, evidence: { text: scene.lines[0], sentenceIds: sentenceIds.slice(0, 1) }, importance: 0.7, primaryActors: scene.characters, affectedCharacters: [], confidence: 1 };
    await store.upsertEvent(event);
    events.push(event);
    for (const character of scene.characters) {
      await store.addRelation({ fromId: character, toId: id, type: 'PRESENT_IN', properties: {}, confidence: 1 });
      await store.addRelation({ fromId: character, toId: event.id, type: 'PARTICIPATES_IN', properties: {}, confidence: 1 });
    }
    await store.addRelation({ fromId: event.id, toId: scene.location, type: 'LOCATED_AT', properties: {}, confidence: 1 });
    if (index) await store.addRelation({ fromId: events[index - 1].id, toId: event.id, type: 'PRECEDES', properties: {}, confidence: 1 });
  }
  await store.addRelation({ fromId: 'char_lin', toId: 'char_zhou', type: 'KNOWS', properties: { fixture: true }, confidence: 1 });
  await writeFile(join(ontology, 'timelines.jsonl'), JSON.stringify({ id: 'tl_canon', kind: 'Timeline', names: [{ text: '合成示例时间线', lang: 'zh', kind: 'canonical' }], properties: { fixture: true }, confidence: 1 }) + '\n');
  const chapters = splitChapters(text).map(chapter => ({ index: chapter.index, title: chapter.title, characters: chapter.text.length, blockIds: blocks.filter(block => block.chapterIndex === chapter.index).map(block => block.id) }));
  await writeFile(join(metadata, 'chapters.json'), JSON.stringify(chapters), { mode: 0o600 });
  await buildGraphFromBundle(ontology, join(ontology, 'graph.lbug'));
  const job = { minutes: 120, limits: { recallsPerBlock: 12, pendingRevisionsPerBlock: 24, commands: 8000 }, volumes: [{ id: 1, input, workspace }] };
  await writeFile(join(home, 'job.json'), JSON.stringify(job, null, 2), { mode: 0o600 });
  let revision = null;
  try { revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim(); } catch {}
  const hashes = {};
  for (const filename of ['package-lock.json', 'apps/playground/package-lock.json', 'tools/pi-review/package-lock.json']) hashes[filename] = hash(await readFile(join(repository, filename)));
  const manifest = { schemaVersion: 1, fixtureId: story.id, license: story.license, fixtureSha256: hash(fixtureBytes), sourceSha256: hash(text), gitRevision: revision, note: 'HEAD identifies the base commit, not necessarily uncommitted source. Package exports have an exact file manifest.', lockfileSha256: hashes, counts: { chapters: chapters.length, scenes: ranges.length, events: events.length, entities: story.entities.length }, source: 'original synthetic fixture; no private experiment data', modelCalls: 0 };
  await writeFile(join(home, 'dataset-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return { home, input, reference, workspace, metadata, job: join(home, 'job.json'), manifest };
}
