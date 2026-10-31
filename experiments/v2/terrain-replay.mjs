// A replay of the terrain build and the births (the user asked, 2026-10-31): one page, step by step, from the live record
// of `novel sim terrain` and the line's first load (stage/simulation/live): each picture Jev saw and its answer; beside it
// the scene's text tiled into its cards, coloured by kind as the reading's data page colours them, with the cards Jev is
// looking at lit (for a site, the ones that name it and its surroundings; for a birth, the ones that name the person);
// and, as a scene comes up, a caption of when it takes place (the time tree) for a few seconds. Reads the workspace and
// the v2 reading it was made from; writes one file with its pictures inside. It holds the book's text: keep it private.
//
//   npm run build
//   node experiments/v2/terrain-replay.mjs <novel-dir> <out.html>
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);
const BIRTHS = 'the line loads · births, meetings';

export async function terrainReplay(novelDir, out) {
  const { loadBlocks } = await load('dist/src/v2/base.js');
  const live = join(novelDir, 'stage', 'simulation', 'live');
  const frames = (await readFile(join(live, 'frames.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const terrain = JSON.parse(await readFile(join(novelDir, 'stage', 'terrain.json'), 'utf8'));
  const spawn = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'spawn.json'), 'utf8'));
  const script = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(novelDir, 'ontology', 'manifest.json'), 'utf8'));
  const reading = manifest.v2Reading.out, data = JSON.parse(await readFile(join(reading, 'v2', 'data.json'), 'utf8'));
  const base = JSON.parse(await readFile(join(reading, 'base', 'scenes.json'), 'utf8'));
  const text = new Map((await loadBlocks(novelDir)).flatMap(block => block.sentences.map(sentence => [sentence.id, sentence.text])));

  // The last terrain run, and the births of the first load after it (each question once: a reload asks them again).
  const start = frames.findLastIndex(frame => frame.phase === 'terrain' && frame.kind === 'ask' && frame.call === 1);
  const terrainFrames = frames.slice(start).filter(frame => frame.phase === 'terrain' || frame.phase === 'spawns');
  // Births only: where someone is as a scene begins (the level, then a box), not where a group gathers to talk.
  const births = frames.slice(start).filter(frame => frame.phase === BIRTHS && frame.kind === 'ask' && frame.questions?.some(question => ['level', 'box'].includes(question.key)) && frame.questions.some(question => /when this scene begins/.test(question.instructions)));

  // A picture inside the page: JPEG as it is; a PNG made a small JPEG (sips, on this Mac), else as it is.
  const work = await mkdtemp(join(tmpdir(), 'replay-'));
  const picture = async file => {
    const path = join(live, file);
    if (file.endsWith('.png')) {
      try { const small = join(work, `${file.replace(/\W/g, '_')}.jpg`); execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', '640', path, '--out', small], { stdio: 'ignore' }); return `data:image/jpeg;base64,${(await readFile(small)).toString('base64')}`; } catch { /* as it is */ }
    }
    return `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${(await readFile(path)).toString('base64')}`;
  };

  // Which scene a birth question is about: its prompt holds the scene's text in full.
  const sceneByText = base.map(scene => [scene.id, scene.text.slice(0, 40)]);
  const sceneOf = prompt => { const at = prompt?.indexOf('This scene, in full:\n'); if (at < 0) return null; const head = prompt.slice(at + 21, at + 61); return sceneByText.find(([, start]) => start && head.startsWith(start.slice(0, 30)))?.[0] ?? null; };
  const asks = frame => frame.questions?.map(question => question.instructions).join(' ') ?? '';
  const who = frame => [/Which room on this floor is (.+?) in when/, /Where on this map is (.+?) when/, /Where down here is (.+?) when/, /Is where (.+?) is when/, /Where is (.+?) when this scene begins/].map(pattern => pattern.exec(asks(frame))?.[1]).find(Boolean) ?? null;
  // The person a birth is about (the chart's entity whose names hold it): their names, and the cards EM² put them in.
  const people = data.chart.entities.filter(entity => entity.category === 'person');
  const personOf = name => people.find(entity => entity.proper[0] === name) ?? people.find(entity => entity.names.includes(name)) ?? null;
  const siteName = frame => /^(?:Where in .+? does|Which place is|Does the white box show where) (.+?) (?:lie|in,|lies)/.exec(frame.questions?.[0]?.instructions ?? '')?.[1] ?? frame.subject ?? null;
  const promptJson = frame => { try { return JSON.parse(frame.prompt); } catch { return null; } };

  const steps = [];
  for (const frame of terrainFrames) {
    const state = promptJson(frame), site = frame.kind === 'ask' ? siteName(frame) : frame.subject;
    const id = Object.keys(terrain.sites).find(key => terrain.sites[key].label === site) ?? null;
    const scenes = id ? script.scenes.filter(scene => scene.place === id || script.places?.[scene.place]?.parent === id).map(scene => scene.id) : [];
    steps.push({
      part: frame.phase === 'spawns' ? 'spawns' : 'terrain', kind: frame.kind, subject: site ?? frame.subject, scene: scenes[0] ?? null,
      questions: (frame.questions ?? []).map(question => ({ key: question.key, instructions: question.instructions })), text: frame.text ?? null,
      // The holder question's options are keys of the places it offered (h1, h2 …): shown by their names.
      answers: (frame.answers ?? null)?.map(answer => { const named = key => state?.places?.[key]?.name ?? key; return answer.key === 'holder' ? { ...answer, value: named(answer.value), ...(answer.top ? { top: answer.top.map(([key, p]) => [named(key), p]) } : {}) } : answer; }) ?? null,
      evidence: state ? [...(state.text ?? []), ...(state.environment ?? [])] : (id ? [...(terrain.sites[id].evidence?.text ?? []), ...(terrain.sites[id].evidence?.environment ?? [])] : []),
      pictures: await Promise.all((frame.pictures ?? []).map(entry => picture(entry.file))),
    });
  }
  for (const frame of births) {
    const scene = sceneOf(frame.prompt), person = who(frame), entity = person ? personOf(person) : null;
    steps.push({ part: 'births', kind: 'ask', subject: person, person: entity?.id ?? null, scene, questions: frame.questions.map(question => ({ key: question.key, instructions: question.instructions })), answers: frame.answers ?? null, evidence: entity ? entity.proper.slice(0, 6) : person ? [person] : [], fresh: /starts anew/.test(frame.prompt ?? ''), pictures: await Promise.all((frame.pictures ?? []).map(entry => picture(entry.file))) });
  }

  // The scenes the steps show: their run cards (kind, sentences), each sentence's text; captions and spawn decisions.
  const wanted = new Set(steps.map(step => step.scene).filter(Boolean));
  const leafKinds = new Set(['spoken', 'thought', 'fact', 'action', 'environment', 'narration']);
  const scenes = Object.fromEntries(data.scenes.filter(scene => wanted.has(scene.id)).map(scene => {
    const ids = new Set(scene.sentences);
    const cards = data.cards.filter(card => leafKinds.has(card.kind) && ids.has(card.first)).map(card => ({ kind: card.kind, text: card.sentences.map(id => text.get(id) ?? '').join(''), people: (card.people ?? []).map(entry => entry.id) }));
    const at = base.find(entry => entry.id === scene.id);
    return [scene.id, { index: data.scenes.indexOf(scene) + 1, when: at?.time?.when ?? 'time not stated', place: script.places?.[script.scenes.find(entry => entry.id === scene.id)?.place]?.label ?? '', spawn: spawn.scenes?.[scene.id] ?? null, cards }];
  }));
  const plan = script.scenes.map((scene, index) => ({ n: index + 1, id: scene.id, when: base.find(entry => entry.id === scene.id)?.time?.when ?? '', place: script.places?.[scene.place]?.label ?? scene.place, ...spawn.scenes?.[scene.id] }));
  const sites = terrain.order.map(id => ({ label: terrain.sites[id].label, scale: terrain.sites[id].scale, in: terrain.sites[id].parentLabel ?? (terrain.sites[id].parent === null && terrain.sites[id].held ? 'housed by the engine' : 'the top of the world'), where: terrain.sites[id].choice?.where ?? null, held: terrain.sites[id].held ?? null }));
  const page = { steps, scenes, plan, sites, counts: { terrain: terrainFrames.filter(frame => frame.kind === 'ask' && frame.phase === 'terrain').length, spawns: terrainFrames.filter(frame => frame.kind === 'ask' && frame.phase === 'spawns').length, births: births.length } };
  const html = (await readFile(join(repository, 'experiments', 'v2', 'terrain-replay.html'), 'utf8')).replace('/*DATA*/null', JSON.stringify(page).replace(/</g, '\\u003c'));
  await writeFile(out, html, { mode: 0o600 });
  return { file: out, bytes: Buffer.byteLength(html), steps: steps.length, ...page.counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [novel, out] = process.argv.slice(2);
  if (!novel || !out) { console.error('usage: node experiments/v2/terrain-replay.mjs <novel-dir> <out.html>'); process.exit(2); }
  const result = await terrainReplay(resolve(novel), resolve(out));
  console.log(JSON.stringify({ ...result, mb: (result.bytes / 1048576).toFixed(1) }));
}
