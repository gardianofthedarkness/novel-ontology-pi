// A character's cards (docs/v3/design.html §10.2; the user, 2026-11-19: "compose a card for each character and their
// awareness of present"). Two, both written by the work model once and kept in <library>/universe/cards/:
//   character   who they are at a point of the story: names, who they are, personality, how they talk (from their own
//               lines in the books so far, as the reading credits them), the people who matter and how they feel about
//               them (whom their memories name, and in what mood), what they can do, what they know.
//   present     where they are at that point: the place, the day and time, who is around, what just happened, what is on
//               their mind and how they are, from their last memories before the point.
// Both read only the books up to the point. Nothing here is about any one book.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = (path) => import(pathToFileURL(join(repository, path)).href);
const lines = async (file) => existsSync(file) ? (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The person's own spoken lines in the books up to the point, spread over them, the later books first. */
export async function spokenLines(u, person, at, max = 30) {
  const out = [];
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  for (const b of [...u.books].reverse()) {
    if (b.offset >= at) continue;
    const members = person.members.filter((m) => m.book === b.book).map((m) => m.entity);
    if (!members.length) continue;
    const data = JSON.parse(await readFile(join(b.dir, 'reading', 'data.json'), 'utf8'));
    const sceneOf = new Map(data.scenes.flatMap((s, i) => s.sentences.map((id) => [id, i + 1])));
    const ids = [...new Set(data.cards.flatMap((c) => (c.people ?? []).filter((p) => members.includes(p.id) && (p.how ?? []).includes('speaks')).flatMap((p) => p.at ?? [])))]
      .filter((id) => b.offset + (sceneOf.get(id) ?? 0) <= at && !b.paratext.has(data.scenes[(sceneOf.get(id) ?? 1) - 1]?.id));
    if (!ids.length) continue;
    const text = await loadWorkspaceSentences(join(b.dir, 'novel'));
    const step = Math.max(1, Math.floor(ids.length / Math.ceil(max / 2)));
    for (let i = 0; i < ids.length && out.length < max; i += step) { const t = text.get(ids[i])?.text; if (t && t.length > 3) out.push(clip(t, 80)); }
    if (out.length >= max) break;
  }
  return out;
}

/** Whom the person's memories name, how often, and the mood of those memories. */
export function peopleOf(u, mems, personId) {
  const by = new Map();
  for (const m of mems) for (const c of m.cues) if (c.startsWith('p_') && c !== personId) { const e = by.get(c) ?? { n: 0, v: 0 }; e.n++; e.v += m.valence ?? 0; by.set(c, e); }
  return [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([id, e]) => ({ id, name: u.nameOf(id), memories: e.n, mood: +(e.v / e.n).toFixed(2) }));
}

const CHARACTER_SYSTEM = `You write a character card for an actor who will play a person of a novel, from that person's own memories and lines.
Use only what the material shows. Write in English; keep the person's own names and catchphrases in their language.
Answer as JSON: {"name", "aka": [], "who": "two or three sentences", "personality": [], "voice": "how they talk: register, how they address
others and themselves, habits, catchphrases, with short examples from the lines", "people": [{"name", "relation", "feeling"}],
"abilities": [], "knows": [], "unknowns": ["what they do not know or would not understand"]}`;

const PRESENT_SYSTEM = `You write where a person of a novel is at one moment, for an actor who will play them from that moment on.
Use only what the material shows; where it does not say, say what is most likely and mark it "(likely)". Write in English.
Answer as JSON: {"where", "when", "with": [], "justHappened": "three to five sentences, the last events as they lived them",
"onMind": [], "body": "how they are physically", "mood"}`;

async function cached(u, name, make) {
  const dir = join(u.library, 'universe', 'cards'), file = join(dir, `${name}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const card = await make();
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(card, null, 1));
  return card;
}

/** The character card of a person at a story order. generate({system, prompt}) -> text (JSON). */
export async function characterCard(u, personId, at, point, generate) {
  return cached(u, `${personId}@${point}.character`, async () => {
    const person = u.cast.persons.find((p) => p.id === personId);
    const mems = u.memories.filter((m) => m.holderId === personId && m.learnedOrder <= at);
    const strongest = [...mems].sort((a, b) => (b.arousal + b.relevance) - (a.arousal + a.relevance)).slice(0, 35);
    const latest = mems.slice(-12), chosen = [...new Map([...strongest, ...latest].map((m) => [m.id, m])).values()].sort((a, b) => a.learnedOrder - b.learnedOrder);
    const prompt = [
      `The person: ${u.nameOf(personId)} (also: ${person.forms.slice(0, 8).join(' / ')}).`,
      `Books so far: ${u.books.filter((b) => b.offset < at).map((b) => b.book).join(', ')}.`,
      `People in their memories (how many memories, their mood -1..1):\n${peopleOf(u, mems, personId).map((p) => `- ${p.name}: ${p.memories}, ${p.mood}`).join('\n')}`,
      `Their memories (their own view, in story order, ${chosen.length} of ${mems.length}):\n${chosen.map((m) => `- [${m.book}] ${clip(m.summaryEn, 120)}`).join('\n')}`,
      `Lines they speak in the books:\n${(await spokenLines(u, person, at)).map((l) => `- ${l}`).join('\n') || '(none credited)'}`,
    ].join('\n\n');
    return { personId, point, made: new Date().toISOString(), ...JSON.parse(await generate({ system: CHARACTER_SYSTEM, prompt })) };
  });
}

/** The present card: where the person is at a story order. */
export async function presentCard(u, personId, at, point, generate) {
  return cached(u, `${personId}@${point}.present`, async () => {
    const mems = u.memories.filter((m) => m.holderId === personId && m.learnedOrder <= at).slice(-25);
    const b = u.books.findLast((x) => at > x.offset), sceneIndex = at - b.offset - 1;
    const near = mems.flatMap((m) => m.cues).filter((c) => c.startsWith('p_') && c !== personId);
    const around = [...new Set(near.slice(-20))].map((c) => u.nameOf(c));
    const prompt = [
      `The person: ${u.nameOf(personId)}.`,
      `The moment: ${b.book}, scene ${sceneIndex + 1} of ${b.scenes}; the story's clock there: ${b.nodes?.[sceneIndex] ?? 'unknown'} (t:year:month-day:time).`,
      `People their last memories name: ${around.join(', ') || '(none)'}.`,
      `Their last memories before this moment, in order (their own view):\n${mems.map((m) => `- ${clip(m.summaryEn, 140)}`).join('\n')}`,
    ].join('\n\n');
    return { personId, point, made: new Date().toISOString(), ...JSON.parse(await generate({ system: PRESENT_SYSTEM, prompt })) };
  });
}

/** A card as the few lines a prompt carries. */
export const cardText = (c) => [
  `${c.name}${c.aka?.length ? ` (${c.aka.join(', ')})` : ''}. ${c.who ?? ''}`,
  c.personality?.length ? `Personality: ${c.personality.join('; ')}.` : '',
  c.voice ? `Voice: ${c.voice}` : '',
  c.people?.length ? `People: ${c.people.map((p) => `${p.name} (${p.relation}; ${p.feeling})`).join('; ')}.` : '',
  c.abilities?.length ? `Can: ${c.abilities.join('; ')}.` : '',
  c.knows?.length ? `Knows: ${c.knows.join('; ')}.` : '',
  c.unknowns?.length ? `Does not know: ${c.unknowns.join('; ')}.` : '',
].filter(Boolean).join('\n');
export const presentText = (p) => [
  `Where: ${p.where}. When: ${p.when}.`, p.with?.length ? `With: ${p.with.join(', ')}.` : 'Alone.',
  `Just happened: ${p.justHappened}`, p.onMind?.length ? `On their mind: ${p.onMind.join('; ')}.` : '', p.body ? `Body: ${p.body}.` : '', p.mood ? `Mood: ${p.mood}.` : '',
].filter(Boolean).join('\n');
