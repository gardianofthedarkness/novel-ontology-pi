// Identity in a world-first book (docs/world-first-design.md §11, decision 4). There is no review, so EM's matches cannot
// wait in identity packets (cast/packets/um_*): its confident ones are merged automatically with a flag, unless the world
// has the two in two places at once. The same goes for the world's own evidence from each scene, where Jev says which named
// person an epithet ("刺猬头少年", "白衣修女") is. The one kept is the one with a proper name (not a description of a person),
// else the one EM saw first; chains follow (a = b, b = c: one person).
//   node experiments/world-first/identity.mjs <novel-dir> [<script.json>] [--apply]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** A description of a person, not a name: it holds a particle, or ends in a word for a kind of person, a title or a rank. */
export const DESCRIPTIVE = /的|(少年|少女|女孩|男孩|小姐|先生|女士|修女|老师|医生|医师|女医|店员|老板|掌柜|怪物|理事长|理事|第一名|第一位|第[二三四五六七八九十]位|大人|驾驶员|队员|精英|员|家伙|男人|女人|老人|孩子|克隆人|幼女|人家|那个人|某人)$/;
/** Confident enough to merge without review: Jev's "same" at least this, and this far above its "distinct". */
const SAME = 0.7, MARGIN = 0.25;

/** EM's matches from the identity packets: [a, b, same, distinct]. */
export async function birthMatches(novelDir) {
  const folder = join(novelDir, 'cast', 'packets'), files = (await readdir(folder).catch(() => [])).filter(name => name.startsWith('um_'));
  const out = [];
  for (const file of files) {
    const packet = JSON.parse(await readFile(join(folder, file), 'utf8'));
    for (const item of packet.proposals ?? []) {
      const [, same, distinct] = /same ([\d.]+), distinct ([\d.]+)/.exec(item.reason ?? '') ?? [];
      if (item.a?.entityId && item.b?.entityId) out.push({ a: item.a.entityId, b: item.b.entityId, same: Number(same ?? item.confidence ?? 0), distinct: Number(distinct ?? 0), packet: file });
    }
  }
  return out;
}

/** Whether the world has a and b in two places at once (then they are two people). */
export function apartAtOnce(script, a, b) {
  if (!script) return false;
  const at = id => script.scenes.filter(scene => scene.clock && [...scene.present, ...scene.stayed].includes(id));
  return at(a).some(x => at(b).some(y => x.place !== y.place && x.clock[0] < y.clock[1] && y.clock[0] < x.clock[1]));
}

/**
 * The merges to make from `pairs` ({a, b, why, direct}): chained into people, each kept under its proper name. `names` maps
 * id to name, `order` gives who EM saw first. Left out (returned as `apart`, with why):
 * - a pair the world has in two places at once;
 * - an epithet tied to more than one named person ("那个男人", "圣诞小姐"): it names several people, not one;
 * - a link that would make two named people one through epithets: only a direct match (EM at birth, `direct`) joins two names.
 */
export function planMerges(pairs, names, script = null, order = new Map()) {
  const parent = new Map(), find = id => { let at = id; while (parent.has(at)) at = parent.get(at); return at; }, apart = [];
  const named = id => !DESCRIPTIVE.test(names[id] ?? ''), people = new Map();
  const rank = id => [named(id) ? 0 : 1, order.get(id) ?? Infinity];
  const better = (x, y) => { const [p, q] = [rank(x), rank(y)]; return p[0] !== q[0] ? p[0] < q[0] : p[1] <= q[1]; };
  const partners = new Map();
  for (const pair of pairs) for (const [x, y] of [[pair.a, pair.b], [pair.b, pair.a]]) if (!named(x) && named(y)) partners.set(x, new Set([...(partners.get(x) ?? []), y]));
  const ambiguous = new Set([...partners].filter(([, set]) => set.size > 1).map(([id]) => id));
  const namedIn = root => people.get(root) ?? new Set(named(root) ? [root] : []);
  for (const pair of pairs) {
    if (apartAtOnce(script, pair.a, pair.b)) { apart.push({ ...pair, apart: 'two places at once' }); continue; }
    if (ambiguous.has(pair.a) || ambiguous.has(pair.b)) { apart.push({ ...pair, apart: 'an epithet for more than one person' }); continue; }
    const [x, y] = [find(pair.a), find(pair.b)];
    if (x === y) continue;
    const [left, right] = [namedIn(x), namedIn(y)];
    if (left.size && right.size && !(pair.direct && named(pair.a) && named(pair.b))) { apart.push({ ...pair, apart: 'would make two named people one' }); continue; }
    const [keep, drop] = better(x, y) ? [x, y] : [y, x];
    parent.set(drop, keep);
    people.set(keep, new Set([...left, ...right]));
  }
  const merges = [];
  for (const pair of pairs) for (const id of [pair.a, pair.b]) { const keep = find(id); if (keep !== id && !merges.some(entry => entry.drop === id)) merges.push({ keep, drop: id, why: pairs.filter(entry => entry.a === id || entry.b === id).map(entry => entry.why).join('; ') }); }
  return { merges, apart };
}

export async function settleIdentity(novelDir, { scriptFile = null, apply = false, aliases = [] } = {}) {
  const manifest = JSON.parse(await readFile(join(novelDir, 'ontology', 'manifest.json'), 'utf8'));
  if (apply && !manifest.worldFirst) throw new Error('--apply merges without review: only in a world-first workspace (novel init --world-first).');
  const entities = (await readFile(join(novelDir, 'ontology', 'entities.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const names = Object.fromEntries(entities.filter(entity => entity.kind === 'Character').map(entity => [entity.id, entity.names?.[0]?.text ?? entity.id]));
  const order = new Map(entities.map((entity, index) => [entity.id, index]));
  const script = scriptFile ? JSON.parse(await readFile(scriptFile, 'utf8')) : null;
  const birth = (await birthMatches(novelDir)).filter(match => names[match.a] && names[match.b] && match.same >= SAME && match.same - match.distinct >= MARGIN).map(match => ({ a: match.a, b: match.b, direct: true, why: `EM at birth: Jev same ${match.same}, distinct ${match.distinct}` }));
  const { merges, apart } = planMerges([...birth, ...aliases.filter(alias => names[alias.a] && names[alias.b])], names, script, order);
  if (apply) {
    const { mergeEntities } = await import(pathToFileURL(`${repository}/dist/src/solidifier/maintenance/fixes.js`).href);
    // Into the kept one, the deepest first, so every drop still exists when it is merged.
    for (const merge of merges) await mergeEntities(novelDir, merge.keep, merge.drop, `emFromWorld: ${names[merge.drop]} is ${names[merge.keep]} (${merge.why}); merged with no conflict`);
  }
  const report = { merged: merges.map(merge => `${names[merge.drop]} → ${names[merge.keep]}`), apart: apart.map(pair => `${names[pair.a]} / ${names[pair.b]} (${pair.apart})`), applied: apply };
  await writeFile(join(novelDir, 'stage', 'world', 'identity.json'), JSON.stringify({ ...report, merges }, null, 1), { mode: 0o600 }).catch(() => {});
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [novelDir, scriptFile] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (!novelDir) throw new Error('Usage: node experiments/world-first/identity.mjs <novel-dir> [<script.json>] [--apply]');
  console.log(JSON.stringify(await settleIdentity(resolve(novelDir), { scriptFile: scriptFile ? resolve(scriptFile) : null, apply: process.argv.includes('--apply') }), null, 1));
}
