// The v2 reading flow on a workspace's book (docs/v3/design.html#world-engine-v2 §2, the user's sketch of 2026-10-30): the sentences
// go to scene tiling, sentence kinds and listing at once; then EM batch by batch, the card scan, each scene's context, story
// time (time words, periods, the calendar) and EM² (who says or does each line, who each description of a person means).
// Writes <out>/v2/ (the data as YAML, by docs/v3/design.html#schema: scenes, cards, chart, EM, contexts, roles, references, slots,
// facts, time, and log.yaml with every step's
// requests and time) and <out>/base/ (the world loop's input: experiments/world-first/run.mjs runs on it as it is).
// Jev's and the work model's replies are cached under <out>/cache, so a rerun pays only for what changed.
//
//   npm run build
//   JEV_MODEL=jev-1.14.0 WORK_LLM_MODEL=deepseek-chat node engine/reading/read.mjs <novel-dir> <out-dir> [--blocks 1-2]
//     [--lister model|lexicon] [--lexicon <roster.json>] [--epub <book.epub>]
// --epub: the book's album as part of the reading (<out>/v2/album, <out>/v2/front.json; src/reading/album/inReading.ts): its pictures on the
// sentences read, its front and back matter, the faces on its plates bound to the chart's people (NOVEL_PORTRAIT_PYTHON).
// --lister lexicon lists by string match the name forms of a roster (an earlier base layer's roster.json) and the times the
// time lexicon finds: a stand-in for the work model, never finding a name the roster does not have.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);

export async function read(novelDir, outDir, { blocks: range = null, lister: listerKind = 'model', lexicon = null, decisions = null, work = null, epub = null } = {}) {
  const { loadBlocks, worldBase } = await load('dist/src/reading/base.js');
  const { readFlow } = await load('dist/src/reading/flow.js');
  const { modelLister, lexiconLister } = await load('dist/src/reading/listing.js');
  const { yamlDocument } = await load('dist/src/reading/yaml.js');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions, cachedWork } = await load('dist/src/reading/v1/timeplace/cache.js');
  const all = await loadBlocks(novelDir);
  const blocks = range ? all.filter(block => { const n = Number(block.id.slice(1)); return n >= range[0] && n <= range[1]; }) : all;
  // Real calls are counted below the cache.
  const paid = { jev: 0, work: 0 };
  // What the paid requests carried, for their price: Jev bills input tokens and reports none here, so its states and
  // questions are measured as sent (characters, and how many are CJK); the work model reports its own tokens.
  const usage = { jev: { requests: 0, chars: 0, cjk: 0, reported: [] }, work: { requests: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0 } };
  const live = decisions ?? jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (state, questions, ...rest) => {
    paid.jev++;
    const sent = JSON.stringify({ state, questions });
    usage.jev.requests++; usage.jev.chars += sent.length; usage.jev.cjk += (sent.match(/[\u3000-\u9fff\uff00-\uffef]/g) ?? []).length;
    return live.decide(state, questions, ...rest);
  } }, join(outDir, 'cache'));
  let lister;
  if (listerKind === 'lexicon') {
    const roster = JSON.parse(await readFile(lexicon, 'utf8'));
    lister = lexiconLister([...(roster.characters ?? []), ...(roster.places ?? []), ...(roster.things ?? [])].flatMap(entry => entry.names ?? []));
  } else {
    const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js');
    const model = work ?? workModelFromEnv(process.env), cached = cachedWork({ modelId: model.modelId, generate: async request => {
      paid.work++;
      if (!model.generateWithInfo) return model.generate(request);
      const reply = await model.generateWithInfo(request);
      usage.work.requests++; usage.work.promptTokens += reply.usage.promptTokens ?? 0; usage.work.completionTokens += reply.usage.completionTokens ?? 0; usage.work.cacheHitTokens += reply.usage.cacheHitTokens ?? 0;
      return reply.text;
    } }, join(outDir, 'cache'));
    lister = modelLister(cached);
  }
  const started = Date.now();
  // Which steps send each option's meaning once a request (src/reading/hints.ts): by default the flow's (HINTS_ONCE_STEPS);
  // V2_HINTS=inline none, V2_HINTS=once every step but the tiling, V2_HINTS=once:<step>,<step> those (by their log name).
  const hints = process.env.V2_HINTS;
  const hintsOnce = hints === 'inline' ? false : hints === 'once' ? true : hints?.startsWith('once:') ? hints.slice(5).split(',') : undefined;
  // The book's introduction (src/reading/front.ts): with the EPUB, its front matter read into its parts by rule and
  // given to the flow as standing knowledge (the cast's names and lines, the synopsis), before the book is read. Its words
  // stay in front.json (the book's, never exported); data.json keeps who it named and which facts stood for it.
  let intro = null;
  if (epub) {
    const { bookMatter } = await load('dist/src/reading/album/inReading.js'), { introParts } = await load('dist/src/reading/front.js');
    intro = introParts(bookMatter(blocks.flatMap(block => block.sentences), await readFile(resolve(epub))));
    console.error(`introduction: ${intro.cast.length} people introduced, synopsis ${intro.synopsis.length} paragraphs, afterword ${intro.afterword.length}`);
  }
  const result = await readFlow(blocks, (state, questions) => jev.decide(state, questions), lister, { hintsOnce, intro, onStep: step => console.error(`${step.step}: ${step.requests} requests, ${step.ms} ms`) });
  const text = new Map(blocks.flatMap(block => block.sentences.map(sentence => [sentence.id, sentence.text])));
  const base = worldBase(result, id => text.get(id) ?? '');
  const v2 = join(outDir, 'v2'), baseDir = join(outDir, 'base');
  await mkdir(v2, { recursive: true, mode: 0o700 }); await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const write = (folder, name, data) => writeFile(join(folder, name), data, { mode: 0o600 });
  const entities = [...result.chart.entities.values()], times = [...result.chart.times.values()];
  // The album (the user, 2026-11-05: "the picture detection and portrait system never wired in in v2"; "first make it part of
  // the reading pipeline"): with the book's EPUB, its pictures anchored on the sentences read (src/reading/album/inReading.ts), the book's
  // front and back matter kept (front.json), and the faces on its plates cropped and bound to the chart's people by their
  // captions (tools/album-portraits, local; skipped and said so when its Python packages are not installed).
  let album = null;
  if (epub) {
    const { readingAlbum } = await load('dist/src/reading/album/inReading.js'), { cropper } = await load('dist/src/cli/commands/extract/portraitCommands.js');
    const people = entities.filter(entity => entity.category === 'person' && /^char_/.test(entity.id)).map(entity => ({ id: entity.id, names: [...entity.proper, ...entity.names.filter(name => !entity.proper.includes(name))] }));
    album = await readingAlbum(v2, [...text].map(([id, sentence]) => ({ id, text: sentence })), resolve(epub), people);
    // The people each plate page of the introduction names (front.ts): a face left over on a page whose others the captions
    // bound is the one left unbound (tools/album-portraits: elimination).
    const groups = new Map();
    for (const entry of result.intro?.cast ?? []) if (entry.plate !== null) groups.set(entry.plate, [...(groups.get(entry.plate) ?? []), ...entry.names]);
    if (groups.size) await writeFile(join(album.dir, 'ontology', 'intro-groups.json'), JSON.stringify([...groups].map(([plate, names]) => ({ plate, names }))), { mode: 0o600 });
    const ready = await cropper(album.dir, true, process.env).catch(error => ({ ready: false, error: String(error.message ?? error) }));
    album.portraits = ready.ready ? await cropper(album.dir, false, process.env).then(made => ({ bound: made.created ?? 0, notFound: made.notFoundCount ?? null }), error => ({ error: String(error.message ?? error) })) : { skipped: ready.missingPackages?.length ? `the cropper's packages are missing (${ready.missingPackages.join(', ')}); set NOVEL_PORTRAIT_PYTHON` : ready.error ?? 'not ready' };
    console.error(`album: ${album.illustrations} pictures, ${album.anchored} anchored on their sentences; front matter ${album.front.before} paragraphs, back ${album.front.after}; portraits ${JSON.stringify(album.portraits)}`);
    album = { ...album, dir: undefined };
  }
  const outcomes = result.em.flatMap(batch => batch.results).reduce((sum, entry) => ({ ...sum, [entry.outcome]: (sum[entry.outcome] ?? 0) + 1 }), {});
  const summary = {
    book: novelDir, blocks: blocks.map(block => block.id), sentences: text.size, lister: listerKind, jev: live.modelId, wallMs: Date.now() - started, paidRequests: paid,
    usage: { ...usage, jev: { ...usage.jev, reported: usage.jev.reported.length ? usage.jev.reported : (live.usage ?? []).slice(0, 3), reportedCount: (live.usage ?? []).length } },
    scenes: result.scenes.length, cards: Object.fromEntries([...new Set(result.cards.map(card => card.kind))].map(kind => [kind, result.cards.filter(card => card.kind === kind).length])),
    detected: result.em.reduce((sum, batch) => sum + batch.results.length, 0), em: outcomes,
    roles: (() => {
      const lines = Object.values(result.roles), spoken = lines.filter(role => role.kind === 'spoken');
      const thingSlots = new Set(result.slots.filter(slot => slot.kind === 'vehicle' || slot.kind === 'weapon').map(slot => slot.id));
      return {
        lines: lines.length, whoSettled: lines.filter(role => role.who.id).length, spoken: spoken.length, toSettled: spoken.filter(role => role.to?.id).length,
        actionsToNarration: Object.values(result.kinds).filter(kind => kind.was === 'action').length, backInTime: lines.filter(role => role.who.answer === 'time').length,
        thingsActing: lines.filter(role => role.who.id && (/^(item|loc)_/.test(role.who.id) || thingSlots.has(role.who.id))).length,
        references: result.references.length, referencesToPeople: result.references.filter(entry => entry.entity?.startsWith('char_')).length,
        slots: result.slots.length, crowds: result.slots.filter(slot => slot.kind === 'crowd').length,
        vehicles: result.slots.filter(slot => slot.kind === 'vehicle').length, weapons: result.slots.filter(slot => slot.kind === 'weapon').length, habits: result.habits.length,
      };
    })(),
    facts: { facts: result.facts.length, about: result.facts.filter(fact => fact.about.length).length, byDescription: result.facts.filter(fact => fact.about.some(entry => entry.via === 'description')).length, byConcept: result.facts.filter(fact => fact.about.some(entry => entry.via === 'concept')).length, timed: result.facts.filter(fact => fact.time).length, inPeriod: result.facts.filter(fact => fact.period).length },
    places: (() => {
      const { places, slots } = result.places, by = places.reduce((sum, entry) => ({ ...sum, [entry.by]: (sum[entry.by] ?? 0) + 1 }), {});
      const tally = (list, key) => list.reduce((sum, entry) => ({ ...sum, [key(entry) ?? 'none']: (sum[key(entry) ?? 'none'] ?? 0) + 1 }), {}), spatial = result.spatial ?? [];
      return { scales: tally(places, entry => entry.scale), scaleBy: tally(places, entry => entry.scaleBy), slotScales: tally(slots, slot => slot.scale ?? slot.kind),
        spatial: { mentions: spatial.length, words: new Set(spatial.map(entry => entry.text)).size, tied: spatial.filter(entry => entry.who.length).length, levels: tally(spatial, entry => entry.level) },
        named: places.length, withParent: places.filter(entry => entry.parent).length, by, unnamed: slots.length, unnamedHeld: slots.filter(slot => slot.in).length, held: tally(slots, slot => slot.held),
        settings: tally(result.places.settings ?? [], setting => setting.by), occupancy: tally(result.places.occupancy ?? [], entry => entry.by),
        descriptions: tally(result.places.references ?? [], entry => entry.by === 'rule' ? `rule: ${entry.answer === 'unnamed' ? 'unnamed' : 'same'}` : entry.entity?.startsWith('loc_') ? 'jev: named' : `jev: ${entry.entity ? 'unnamed' : entry.answer}`),
        asked: tally(result.places.asked ?? [], entry => entry.mode), questions: (result.places.asked ?? []).reduce((sum, entry) => sum + Object.keys(entry.keys).length, 0), laws: result.places.laws };
    })(),
    time: (() => {
      const { words, periods, scenes, calendar } = result.time, count = (list, key) => list.reduce((sum, entry) => ({ ...sum, [key(entry)]: (sum[key(entry)] ?? 0) + 1 }), {});
      return {
        words: words.length, roles: count(words, word => word.role), decidedBy: count(words, word => word.decidedBy), notAsked: count(words.filter(word => word.why), word => word.why), downgraded: words.filter(word => word.downgraded).length,
        treeNodes: result.time.tree.length, treeConflicts: result.time.treeConflicts.length,
        periods: periods.length, flashbackPeriods: periods.filter(period => period.flashback).length, dated: periods.filter(period => period.date?.month && period.date?.day && !period.date.derived).length, derived: periods.filter(period => period.date?.derived).length,
        calendar: count(calendar.entries, entry => entry.placed), conflicts: calendar.conflicts.length,
        scenesWithTime: scenes.filter(scene => scene.periods.length).length, flashbackScenes: scenes.filter(scene => scene.flashback).length, continuations: scenes.filter(scene => scene.continuation).length,
      };
    })(),
    chart: { person: entities.filter(entity => entity.category === 'person').length, thing: entities.filter(entity => entity.category === 'thing').length,
      thingTypes: Object.fromEntries(['object', 'vehicle', 'weapon'].map(type => [type, entities.filter(entity => entity.category === 'thing' && entity.type === type).length])),
      concept: entities.filter(entity => entity.category === 'concept').length, conceptsOwned: entities.filter(entity => entity.owners?.length).length, place: entities.filter(entity => entity.category === 'place').length, time: times.length },
    album,
    intro: result.intro ? { cast: result.intro.cast.map(entry => ({ entity: entry.entity, names: entry.names.length })), standing: result.intro.standing.length, merged: result.intro.merged } : null,
    steps: result.steps,
  };
  await Promise.all([
    write(v2, 'log.yaml', yamlDocument(summary)),
    write(v2, 'scenes.yaml', yamlDocument(result.scenes.map(scene => ({ id: scene.id, block: scene.block, chapter: scene.chapter, first: scene.sentences[0], last: scene.sentences.at(-1), sentences: scene.sentences.length })))),
    write(v2, 'kinds.yaml', yamlDocument(result.kinds)),
    write(v2, 'cards.yaml', yamlDocument(result.cards.map(({ sentences, ...card }) => ({ ...card, size: sentences.length })))),
    write(v2, 'chart.yaml', yamlDocument({ entities, times })),
    write(v2, 'em.yaml', yamlDocument(result.em)),
    write(v2, 'contexts.yaml', yamlDocument(result.contexts)),
    write(v2, 'roles.yaml', yamlDocument(result.roles)),
    write(v2, 'references.yaml', yamlDocument(result.references)),
    write(v2, 'slots.yaml', yamlDocument({ slots: result.slots, habits: result.habits })),
    write(v2, 'facts.yaml', yamlDocument(result.facts.map(({ text: _, ...fact }) => fact))),
    write(v2, 'time.yaml', yamlDocument(result.time)),
    write(v2, 'places.yaml', yamlDocument(result.places)),
    write(v2, 'spatial.yaml', yamlDocument(result.spatial ?? [])),
    ...((live.usage ?? []).length ? [write(v2, 'jev-usage.json', JSON.stringify(live.usage))] : []),
    // The same data as JSON, for tools (compare.mjs, inspect.mjs, the world loop).
    write(v2, 'data.json', JSON.stringify({ intro: result.intro && { ...result.intro, synopsis: result.intro.synopsis.length, standing: result.intro.standing.map(({ id, card, about }) => ({ id, card, about })) }, log: summary, sequences: result.sequences, storyboard: result.storyboard, scenes: result.scenes, cards: result.cards, kinds: result.kinds, blocks: result.blocks, chart: { entities, times }, em: result.em, contexts: result.contexts, roles: result.roles, references: result.references, slots: result.slots, habits: result.habits, facts: result.facts.map(({ text: _, ...fact }) => fact), time: result.time, places: result.places, spatial: result.spatial })),
    write(baseDir, 'scenes.json', JSON.stringify(base.scenes)),
    write(baseDir, 'roster.json', JSON.stringify(base.roster, null, 1)),
    write(baseDir, 'facts.json', JSON.stringify(base.facts)),
    write(baseDir, 'states.json', JSON.stringify(base.states)),
  ]);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), flag = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };
  const [novelDir, outDir] = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
  if (!novelDir || !outDir) throw new Error('Usage: node engine/reading/read.mjs <novel-dir> <out-dir> [--blocks 1-2] [--lister model|lexicon] [--lexicon <roster.json>] [--epub <book.epub>]');
  const blocks = flag('--blocks')?.split('-').map(Number) ?? null;
  const summary = await read(resolve(novelDir), resolve(outDir), { blocks: blocks ? [blocks[0], blocks[1] ?? blocks[0]] : null, lister: flag('--lister') ?? 'model', lexicon: flag('--lexicon'), epub: flag('--epub') });
  console.log(JSON.stringify({ ...summary, steps: undefined }, null, 1));
}
