// The memory pass (docs/v3/design.html §10.1): for each scene of a reading, the work model writes what each person present
// would keep of it, with the amygdala's tags, into the book's novel/ontology/memories.jsonl (memory index v1 records,
// src/ground/ontology/memory.ts). Nothing here is about any one book: the people, places and things are the reading's own,
// and the prompt asks only what a person there could have seen, heard, done or been told.
//
// Paid (one work-model call per scene, or per part of a long one); answers are cached beside the volume (cache-memory), so
// a rerun costs nothing. Usage: node engine/memory/memories.mjs <volume folder> [--scenes 1-20] [--jobs 6] [--affect v2]
//   --affect v2: arousal and valence computed from stakes, expectation and outcome (affect.mjs), written to memories.v2*.jsonl
//   with the beats beside them (beats.v2*.jsonl); a range's context starts fresh at its first scene.
//   <volume folder> holds novel/ (the ontology and source) and reading/data.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { storedKeys } from '../volume/credentials.mjs';
import { affectOf } from './affect.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(join(repo, rel)).href);
const PART = 60; // sentences per call at most

/** The last record per id of an append-only bundle file. */
async function latest(file) {
  if (!existsSync(file)) return [];
  const byId = new Map();
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) if (line.trim()) { const r = JSON.parse(line); byId.set(r.id, r); }
  return [...byId.values()];
}

const SYSTEM = `You read one scene of a novel and write the memories each person present would keep of it.
A memory is one thing that person lived through in this scene: something they did, saw, heard, were told, or worked out.
Only what that person could perceive: they were there, it was in sight or earshot, or it went on in their own head.
Another person's unspoken thoughts are never someone else's memory. Nothing from outside this scene.
A person is in the scene only when its own text shows them there (by name, title, or an unmistakable description); a
first-person narrator is whoever the text shows the narrator to be. Give memories only to people really in it. Never give one person's memories to another id: if the person in the scene has no id in the
lists, leave them out.
For each memory give:
- holder: the person's id (from the lists)
- kind: "episode" (a happening) or "belief" (a claim they now hold; it may be false)
- source: "did", "saw", "heard", "told" (someone told them about something not seen here) or "inferred"
- summary: one sentence from the holder's side, in the language of the book
- arousal 0..1 (how stirring for this holder), valence -1..1, relevance 0..1 (how much it bears on their goals and people),
  central 0..1 (1 the centre of their attention, 0 a detail at the edge), confidence 0..1 (lower for told or inferred)
- cues: ids (from the lists given) of the people, place and things it is about
- heard_from: the id of who told them, for "told" or "heard", else null
- evidence: the sentence ids that show it
The scales are over the holder's whole life, not this scene: arousal 0.1 routine, 0.3 notable, 0.5 upsetting or exciting,
0.7 frightening or deeply moving, 0.9 only for a threat to life or a turning point of their life. Most moments are low.
Relevance likewise: 0.9 only for what changes their goals or their closest people.
Keep what a person would actually remember: from 0 to 4 memories per person, fewer for passing moments. A belief only when
they come to hold a new claim about the world or a person, not to restate what they did or saw.
Answer as JSON: {"memories": [...]}`;

// Affect v2 (engine/memory/affect.mjs): the model does not rate arousal or valence; it reads, per holder and beat, what is
// at stake and what they expected against what came, and the tags are computed (logarithmic, relative to context).
const SYSTEM_V2 = `You read one scene of a novel and write the memories each person present would keep of it, beat by beat.
A person is in the scene only when its own text shows them there (by name, title, or an unmistakable description); a
first-person narrator is whoever the text shows the narrator to be. Give memories only to people really in it, under their
own id from the lists; if the person has no id, leave them out. Only what that person could perceive: they were there, it
was in sight or earshot, or it went on in their own head. Nothing from outside this scene.

A beat is a stretch of the scene in which one holder's situation stays the same; a new beat starts when, for that holder,
something at stake appears, changes or resolves. For each holder and beat, read from the text only:
- stakes: the most that is at stake for the holder in this beat, on a ladder where each step is about ten times the last:
  0 nothing; 1 comfort, a small annoyance or pleasure; 2 embarrassment, a small loss or gain; 3 a plan, a possession, their
  standing; 4 an injury, a bond with someone; 5 a serious injury, losing someone close, a life-changing gain;
  6 their own life or the life of someone they love.
- expected: what the holder expected for that stake as the beat began, on the same ladder, signed: negative for harm or loss,
  positive for gain, 0 for nothing happening.
- actual: what came or now looms in the beat, signed the same way; probability: how likely it now is (1 if it happened).
- evidence: the sentence ids that show the stakes or the holder's reaction (their body, words, acts).
Do not judge how stirred they are; read only stakes, expectation and outcome.
Within each beat, the memories that holder keeps of it (0 to 4; fewer for passing moments), each with:
- kind: "episode" (a happening) or "belief" (a new claim they now hold about the world or a person; it may be false)
- source: "did", "saw", "heard", "told" (told about something not seen here) or "inferred"
- summary: one sentence from the holder's side, in the language of the book
- central 0..1 (1 the centre of their attention in that beat, 0 a detail at the edge), confidence 0..1
- cues: ids (from the lists) of the people, place and things it is about
- heard_from: the id of who told them, for "told" or "heard", else null
- evidence: the sentence ids that show it
Answer as JSON: {"beats": [{"holder", "first", "last", "stakes", "expected", "actual", "probability", "evidence", "memories": [...]}]}
where first and last are the beat's first and last sentence ids.`;

const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

async function main() {
  const args = process.argv.slice(2), volume = resolve(args.find((a) => !a.startsWith('--')) ?? '');
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
  const novel = join(volume, 'novel'), ontology = join(novel, 'ontology');
  const data = JSON.parse(await readFile(join(volume, 'reading', 'data.json'), 'utf8'));
  const scenes = await latest(join(ontology, 'scenes.jsonl')), sceneOf = new Map(scenes.map((s) => [s.id, s]));
  const entities = await latest(join(ontology, 'entities.jsonl'));
  const nameOf = new Map(entities.map((e) => [e.id, e.names?.find((n) => n.kind === 'canonical')?.text ?? e.names?.[0]?.text ?? e.id]));
  const cast = entities.filter((e) => e.kind === 'Character');
  const things = entities.filter((e) => ['Item', 'Concept', 'Organization', 'Location'].includes(e.kind));
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const text = await loadWorkspaceSentences(novel);
  const env = { ...process.env, ...storedKeys(process.env) };
  if (!env.WORK_LLM_API_KEY) throw new Error('No work-model key (WORK_LLM_API_KEY or the stored deepseek credential).');
  const { HttpWorkModel } = await load('dist/src/ground/connectors/workModel.js'), { cachedWork } = await load('dist/src/reading/v1/timeplace/cache.js');
  const http = new HttpWorkModel({ baseUrl: 'https://api.deepseek.com/v1', apiKey: env.WORK_LLM_API_KEY.trim(), model: 'deepseek-chat', timeoutMs: 180_000 });
  const work = cachedWork(Object.assign(http, { modelId: 'deepseek-chat' }), join(volume, opt('cache') ? `cache-memory-${opt('cache')}` : 'cache-memory'));

  const [from, to] = (opt('scenes') ?? `1-${data.scenes.length}`).split('-').map(Number);
  const chosen = data.scenes.map((s, i) => ({ ...s, order: i + 1 })).filter((s) => s.order >= from && s.order <= to);
  const usage = { calls: 0, cached: 0, prompt: 0, completion: 0, skipped: 0, dropped: 0 };
  const out = [], beats = [], v2 = opt('affect') === 'v2';
  const one = async (scene) => {
    const onto = sceneOf.get(scene.id), guessed = onto?.charactersPresent ?? [];
    if (!guessed.length) { usage.skipped++; return; }
    const ids = scene.sentences.filter((id) => text.has(id));
    for (let p = 0; p < ids.length; p += PART) {
      const part = ids.slice(p, p + PART), body = part.map((id) => `[${id}] ${text.get(id).text}`).join('\n');
      const byName = cast.filter((e) => e.names?.some((n) => n.text.length > 1 && body.includes(n.text))).map((e) => e.id);
      const present = guessed, people = [...new Set([...present, ...(onto.charactersMentioned ?? []), ...byName, ...cast.map((e) => e.id)])];
      const place = onto.locationId ? [onto.locationId] : [];
      const named = things.filter((e) => e.names?.some((n) => n.text.length > 1 && body.includes(n.text))).map((e) => e.id).slice(0, 30);
      const list = (xs) => xs.map((id) => `${id}: ${nameOf.get(id) ?? id}`).join('\n') || '(none)';
      const everyone = cast.map((e) => `${e.id}: ${[...new Set(e.names.map((n) => n.text))].slice(0, 4).join(' / ')}`).join('\n');
      const mentioned = [...new Set([...(onto.charactersMentioned ?? []), ...byName])].filter((x) => !present.includes(x));
      const prompt = `Everyone in the book (find who is really in this scene from its text):\n${everyone}\n\nNamed in this part of the scene:\n${list(byName)}\n\nPlace:\n${list(place)}\n\nThings and places named:\n${list(named.filter((x) => !place.includes(x)))}\n\nThe scene:\n${body}`;
      const answer = await work.generateWithUsage({ system: v2 ? SYSTEM_V2 : SYSTEM, prompt, jsonSchema: { type: 'object' }, maxTokens: v2 ? 6000 : 4000 });
      usage.calls++; if (answer.cached) usage.cached++; usage.prompt += answer.usage?.promptTokens ?? 0; usage.completion += answer.usage?.completionTokens ?? 0;
      let parsed; try { parsed = JSON.parse(answer.content); } catch { usage.dropped++; continue; }
      const known = new Set([...people, ...place, ...named]), inPart = new Set(part);
      if (v2) {
        (parsed.beats ?? []).forEach((b, k) => {
          if (!people.includes(b.holder)) { usage.dropped++; return; }
          const at = Math.max(0, part.indexOf(b.first));
          const beat = { holder: b.holder, order: scene.order + (p + at + k / 100) / 10_000, stakes: b.stakes, expected: b.expected, actual: b.actual,
            probability: b.probability ?? 1, scene: scene.id, first: b.first, last: b.last, evidence: (b.evidence ?? []).filter((id) => inPart.has(id)), memories: [] };
          (b.memories ?? []).forEach((m, n) => {
            if (typeof m.summary !== 'string' || !m.summary.trim()) { usage.dropped++; return; }
            const source = ['did', 'saw', 'heard', 'told', 'inferred'].includes(m.source) ? m.source : 'saw';
            const heard = (source === 'told' || source === 'heard') && people.includes(m.heard_from) && m.heard_from !== b.holder ? m.heard_from : undefined;
            beat.memories.push({
              id: `mem_${scene.id}_${p / PART}_${k}_${n}`, holderId: b.holder, branchId: 'canon', kind: m.kind === 'belief' ? 'belief' : 'episode', source,
              atOrder: scene.order, learnedOrder: scene.order, summaryEn: m.summary.trim(),
              central: clamp(m.central, 0, 1, 1), confidence: clamp(m.confidence, 0, 1, source === 'told' || source === 'inferred' ? 0.6 : 0.9),
              cues: [...new Set((m.cues ?? []).filter((c) => known.has(c) && c !== b.holder))],
              ...(heard ? { heardFromId: heard } : {}), evidence: (m.evidence ?? []).filter((id) => inPart.has(id)), scene: scene.id,
            });
          });
          beats.push(beat);
        });
        continue;
      }
      (parsed.memories ?? []).forEach((m, n) => {
        if (!people.includes(m.holder) || typeof m.summary !== 'string' || !m.summary.trim()) { usage.dropped++; return; }
        const source = ['did', 'saw', 'heard', 'told', 'inferred'].includes(m.source) ? m.source : 'saw';
        const heard = (source === 'told' || source === 'heard') && people.includes(m.heard_from) && m.heard_from !== m.holder ? m.heard_from : undefined;
        out.push({
          id: `mem_${scene.id}_${p / PART}_${n}`, holderId: m.holder, branchId: 'canon', kind: m.kind === 'belief' ? 'belief' : 'episode', source,
          atOrder: scene.order, learnedOrder: scene.order, summaryEn: m.summary.trim(),
          arousal: clamp(m.arousal, 0, 1, 0.3), valence: clamp(m.valence, -1, 1, 0), relevance: clamp(m.relevance, 0, 1, 0.3),
          central: clamp(m.central, 0, 1, 1), confidence: clamp(m.confidence, 0, 1, source === 'told' || source === 'inferred' ? 0.6 : 0.9),
          cues: [...new Set((m.cues ?? []).filter((c) => known.has(c) && c !== m.holder))],
          ...(heard ? { heardFromId: heard } : {}), evidence: (m.evidence ?? []).filter((id) => inPart.has(id)), scene: scene.id,
        });
      });
    }
  };
  const jobs = Number(opt('jobs') ?? 6), queue = [...chosen];
  await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await one(queue.shift()); }));
  if (v2) {
    // Tags per holder in story order: each beat's memories share its arousal and valence; relevance is its stakes.
    const tags = affectOf(beats);
    for (const beat of beats) {
      const t = tags.get(beat);
      Object.assign(beat, { arousal: t.arousal, valence: t.valence, relevance: t.relevance, surprise: t.surprise, context: t.context });
      for (const m of beat.memories) out.push({ ...m, arousal: t.arousal, valence: t.valence, relevance: t.relevance, beat: `${beat.scene}:${beat.first}` });
    }
  }
  out.sort((a, b) => a.atOrder - b.atOrder || a.id.localeCompare(b.id));
  await mkdir(ontology, { recursive: true });
  const stem = `memories${v2 ? '.v2' : ''}${opt('scenes') ? `.scenes-${from}-${to}` : ''}${opt('cache') ? `.${opt('cache')}` : ''}`;
  const file = join(ontology, `${stem}.jsonl`);
  await writeFile(file, out.map((m) => JSON.stringify(m)).join('\n') + '\n');
  if (v2) await writeFile(join(ontology, `${stem.replace('memories', 'beats')}.jsonl`), beats.sort((a, b) => a.order - b.order).map(({ memories, ...b }) => JSON.stringify({ ...b, memories: memories.map((m) => m.id) })).join('\n') + '\n');
  console.log(JSON.stringify({ file, scenes: chosen.length, memories: out.length, holders: new Set(out.map((m) => m.holderId)).size, ...usage }));
}

await main();
