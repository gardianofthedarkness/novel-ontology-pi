import test from 'node:test';
import assert from 'node:assert/strict';
import { timePlaceProjection } from './time-place.mjs';

const time = (id, label, storyIndex, narrativeIndex, extra = {}) => ({ id, kind: 'TimePoint', names: [{ text: label, kind: 'canonical' }], properties: { storyIndex, narrativeIndex, gloss: label, role: 'ADVANCE', ...extra }, confidence: 0.9 });
const place = (id, label) => ({ id, kind: 'Location', names: [{ text: label, kind: 'canonical' }], properties: {}, confidence: 1 });
const person = (id, label) => ({ id, kind: 'Character', names: [{ text: label, kind: 'canonical' }], properties: {}, confidence: 1 });
const scene = (id, block, chapterIndex, extra = {}) => ({ id, chapterIndex, sentenceIds: [`b${String(block).padStart(4, '0')}_s0000`], charactersPresent: [], locationId: null, ...extra });
const rel = (type, fromId, toId, properties = {}) => ({ type, fromId, toId, properties, confidence: 0.7 });

test('story time and places project in story order; unnamed places carry within a chapter only, flagged', () => {
  const entities = [time('t_eve', '平安夜', 1, 0, { date: { month: 12, day: 24, derived: false } }), time('t_past', '三年前', 0, 1, { flashback: true, toldFromId: 't_eve', flashbackProbability: 0.8 }), place('loc_7', '中央区'), person('c_1', '小明')];
  const scenes = [scene('s2', 2, 0, { charactersPresent: ['c_1'] }), scene('s1', 1, 0, { charactersPresent: ['c_1'] }), scene('s3', 3, 1)];
  const relations = [rel('OCCURS_DURING', 's1', 't_eve', { via: 'anchor' }), rel('OCCURS_DURING', 's2', 't_past', { via: 'anchor' }), rel('OCCURS_DURING', 's3', 't_eve'), rel('LOCATED_AT', 's1', 'loc_7')];
  const projection = timePlaceProjection({ entities, scenes, relations });
  assert.equal(projection.available, true);
  assert.deepEqual(projection.times.map((entry) => entry.id), ['t_past', 't_eve'], 'story order, flashback first');
  assert.deepEqual(projection.scenes.map((entry) => entry.id), ['s1', 's2', 's3'], 'reading order by source position');
  const [first, second, third] = projection.scenes;
  assert.deepEqual([first.placeIds, first.placeCarried], [['loc_7'], false]);
  assert.deepEqual([second.placeIds, second.placeCarried], [['loc_7'], true], 'carried, and says so');
  assert.deepEqual(third.placeIds, [], 'never across a chapter break');
  assert.equal(second.flashback, true);
  assert.equal(first.label, '小明', 'a scene without a summary or events is named by who is present');
  assert.equal(timePlaceProjection({ entities, scenes, relations, events: [{ id: 'e1', chronologicalOrder: 0, summaryEn: '小明醒来。', evidence: { sentenceIds: ['b0001_s0000'] } }] }).scenes[0].label, '小明醒来。', 'else by its first event');
  assert.deepEqual(projection.places[0], { id: 'loc_7', label: '中央区', sceneIds: ['s1', 's2'], statedScenes: 1, characterIds: ['c_1'], proposed: false, parentId: null, parentProposed: false, depth: 0, path: ['loc_7'], totalScenes: 2, generic: false });
  assert.equal(projection.names.c_1, '小明');
  assert.ok(!JSON.stringify(projection).includes('sentenceIds'), 'no source references leak');
});

test('books without time-place facts report unavailable', () => {
  assert.equal(timePlaceProjection({ entities: [], scenes: [scene('s1', 1, 0)], relations: [] }).available, false);
});

test('pending time-place proposals show as proposed periods and places, never as canon', () => {
  const scenes = [scene('s1', 1, 0), scene('s2', 2, 0)];
  const pending = [
    { kind: 'upsert_entity', payload: time('t_new', '早上', 0, 0) },
    { kind: 'upsert_entity', payload: place('loc_new', '车站') },
    { kind: 'add_relation', payload: rel('OCCURS_DURING', 's1', 't_new', { via: 'anchor' }) },
    { kind: 'add_relation', payload: rel('LOCATED_AT', 's1', 'loc_new') },
    { kind: 'add_relation', payload: rel('CAUSES', 's1', 's2') },
  ];
  const projection = timePlaceProjection({ entities: [], scenes, relations: [], pending });
  assert.equal(projection.available, true);
  assert.deepEqual(projection.times.map((entry) => [entry.id, entry.proposed]), [['t_new', true]]);
  assert.deepEqual(projection.places.map((entry) => [entry.id, entry.proposed]), [['loc_new', true]]);
  const confirmed = timePlaceProjection({ entities: [time('t_new', '早上', 0, 0)], scenes, relations: [rel('OCCURS_DURING', 's1', 't_new', { via: 'anchor' })], pending });
  assert.equal(confirmed.times[0].proposed, false, 'once applied, the stored fact wins');
});

test('places project as a tree: ancestors appear, scenes keep their most specific place, proposed links are marked', () => {
  const entities = [time('t_eve', '平安夜', 0, 0), place('city', '星城'), place('d7', '东区'), place('hospital', '医院'), place('d10', '西区')];
  const scenes = [scene('s1', 1, 0), scene('s2', 2, 0), scene('s3', 3, 0)];
  const relations = [rel('OCCURS_DURING', 's1', 't_eve'), rel('PART_OF', 'd7', 'city'), rel('PART_OF', 'hospital', 'd7'), rel('LOCATED_AT', 's1', 'hospital'), rel('LOCATED_AT', 's1', 'city'), rel('LOCATED_AT', 's2', 'd10')];
  const pending = [{ id: 'p1', kind: 'add_relation', payload: rel('PART_OF', 'd10', 'city') }];
  const projection = timePlaceProjection({ entities, scenes, relations, pending });
  const byId = new Map(projection.places.map((entry) => [entry.id, entry]));
  assert.deepEqual(projection.scenes[0].placeIds, ['hospital'], 'the city is implied by the path, not repeated');
  assert.deepEqual(byId.get('hospital').path, ['city', 'd7', 'hospital']);
  assert.equal(byId.get('hospital').depth, 2);
  assert.deepEqual([byId.get('d7').sceneIds, byId.get('d7').totalScenes], [[], 1], 'an ancestor appears with its descendants\' scenes counted');
  assert.deepEqual([byId.get('city').totalScenes, byId.get('city').depth], [3, 0]);
  assert.deepEqual([byId.get('d10').parentId, byId.get('d10').parentProposed], ['city', true]);
  assert.equal(projection.places[0].id, 'city', 'roots with the most scenes first');
});

test('known scene locations remain available to Places when actual story time is unavailable', () => {
  const projection = timePlaceProjection({ entities: [place('station', '车站')], scenes: [scene('s1', 1, 0, { locationId: 'station' })], relations: [] });
  assert.equal(projection.available, false);
  assert.deepEqual(projection.scenes[0].placeIds, ['station']);
  assert.equal(projection.places[0].id, 'station');
  assert.deepEqual(projection.times, []);
});

test('the building log keeps one entry per name at a place: the scene place with a building, every scene that names it in reading order', async () => {
  const { buildingLog } = await import('./time-place.mjs');
  const rows = [{ id: 's1', index: 0, placeIds: ['loc_city', 'loc_tower'] }, { id: 's2', index: 1, placeIds: ['loc_tower'] }, { id: 's3', index: 2, placeIds: [] }];
  const log = buildingLog([{ sceneId: 's2', name: '钟塔', model: null, size: 30 }, { sceneId: 's1', name: '钟塔', model: 'skyscraper', size: 30 }, { sceneId: 's3', name: '无处', model: null, size: null }], rows, { loc_city: 'none', loc_tower: 'skyscraper' });
  assert.deepEqual(log, [{ id: 'loc_tower|钟塔', name: '钟塔', placeId: 'loc_tower', model: 'skyscraper', size: 30, sceneIds: ['s1', 's2'] }], 'a scene with no place names no building on the map');
  // Reviewed into the ontology: the mention is that record; a reviewed one the report never mentioned stands from its first scene.
  const canon = buildingLog([{ sceneId: 's2', name: '钟塔', model: null, size: 30 }], rows, { loc_tower: 'skyscraper' }, [{ id: 'loc_obj_1', names: ['钟塔'], placeId: 'loc_tower', model: 'skyscraper', size: 30, sceneId: 's2' }, { id: 'loc_obj_2', names: ['车站'], placeId: 'loc_city', model: 'station', size: 20, sceneId: 's1' }]);
  assert.deepEqual(canon.map((entry) => [entry.name, entry.entityId, entry.reviewed, entry.sceneIds]), [['钟塔', 'loc_obj_1', true, ['s2']], ['车站', 'loc_obj_2', true, ['s1']]]);
});

test('Places takes the named buildings reviewed into the ontology from the book: applied stage-objects places with an applied parent', async () => {
  const { timePlaceProjection } = await import('./time-place.mjs');
  const location = (id, name, properties = {}) => ({ id, kind: 'Location', names: [{ text: name, lang: 'zh', kind: 'canonical' }], properties });
  const entities = [location('p7', '第七学区'), location('loc_obj_1', '无人车站', { source: 'stage-objects', building: 'station', size: 30, firstSceneId: 'sc1' }), location('loc_obj_2', '没挂上的', { source: 'stage-objects' })];
  const projection = timePlaceProjection({ entities, scenes: [{ id: 'sc1', chapterIndex: 0, sentenceIds: ['b0000_s0001'], charactersPresent: [], locationId: 'p7' }], relations: [{ fromId: 'loc_obj_1', toId: 'p7', type: 'PART_OF', properties: {} }] });
  assert.deepEqual(projection.buildings.map((entry) => [entry.name, entry.placeId, entry.reviewed]), [['无人车站', 'p7', true]], 'one without its place in the tree is not drawn');
  assert.deepEqual(projection.places.map((place) => place.id), ['p7'], 'a building is not a place disc of its own');
});

test('the simulation records reach the map trimmed: lots with their skeletons and when they are named, things placed, hits with the cells and units each lot lost', async (context) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSimulation } = await import('./stage-reports.mjs');
  const workspace = await mkdtemp(join(tmpdir(), 'simulation-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  assert.equal(await readSimulation(workspace), null);
  await mkdir(join(workspace, 'stage', 'simulation'), { recursive: true });
  await writeFile(join(workspace, 'stage', 'simulation', 'index.json'), JSON.stringify({ strands: { k: { file: 'k.json', title: 'K' }, bad: { file: '../escape.json' } } }));
  await writeFile(join(workspace, 'stage', 'simulation', 'k.json'), JSON.stringify({ strand: { id: 'k', title: '白井', from: 's1', to: 's2' },
    buildings: { loc_1: { label: '钟塔', kind: 'site', grid: { NX: 32, NZ: 24 }, lots: [{ label: null, detected: { name: '仓库', scene: 's2' }, role: 'shop', model: 'market', footprint: { i0: 1, j0: 2, nx: 3, nz: 4 }, floors: 2, skeleton: '0120'.repeat(6), rooms: [[0, 0, 0, 1, 1], [1, 'x']] }] } },
    things: [{ id: 'thing_1', name: '直升机', model: null, shape: 'oval', placements: [{ scene: 's1', event: 0, place: 'loc_1', x: 1, y: 2, z: 3, fit: { w: 12, h: 4, d: 8, turn: 0 } }] }],
    scenes: [{ id: 's1', place: 'loc_1', events: [{ index: 2, hit: { sphere: { x: 4, y: 5, z: 6, r: 4 }, strength: 0.9, parts: [{ lot: 0, energy: 96, blasted: [[3, 0, 0, 1]], fallen: [[4, 1, 1, 2, 0], [4, 'x']], destroyedCells: [1, 2], fellCells: [3], cutOffCells: [5], cutOffRooms: [0] }] }, hitThings: [{ id: 'thing_1' }] }] }],
    migrations: [{ scene: 's2', person: 'char_1', from: 'loc_1', to: 'loc_2' }] }));
  const simulation = await readSimulation(workspace);
  assert.deepEqual(simulation.strands, [{ id: 'k', title: '白井', from: 's1', to: 's2', run: null, runs: 1 }], 'a file outside the folder is never read; a record from before runs has none');
  assert.deepEqual(simulation.places.loc_1.lots, [{ name: '仓库', since: 's2', label: null, role: 'shop', model: 'market', i0: 1, j0: 2, nx: 3, nz: 4, floors: 2, skeleton: '0120'.repeat(6), rooms: [[0, 0, 0, 1, 1]] }], 'a malformed room is left out');
  assert.deepEqual(simulation.hits, [{ scene: 's1', place: 'loc_1', event: 2, x: 4, y: 5, z: 6, r: 4, strength: 0.9, lots: [{ lot: 0, destroyed: [1, 2], fell: [3], cutOff: [5], cutRooms: [0], blasted: [[3, 0, 0, 1]], fallen: [[4, 1, 1, 2, 0]] }], things: ['k:thing_1'] }], 'a malformed unit is left out');
  assert.deepEqual(simulation.things[0].placements[0], { scene: 's1', place: 'loc_1', x: 1, y: 2, z: 3, w: 12, h: 4, d: 8, turn: 0 });
  assert.equal(simulation.migrations.length, 1);
});

test('a world run is read for its line and things only: its places name world lots by index, which the per-place map cannot draw', async (context) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readSimulation } = await import('./stage-reports.mjs');
  const workspace = await mkdtemp(join(tmpdir(), 'simulation-world-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, 'stage', 'simulation'), { recursive: true });
  await writeFile(join(workspace, 'stage', 'simulation', 'index.json'), JSON.stringify({ version: 2, strands: { w: { file: 'w.json', title: 'W' } } }));
  await writeFile(join(workspace, 'stage', 'simulation', 'w.json'), JSON.stringify({ version: 2, strand: { id: 'w', title: 'Street', from: 's1', to: 's1' },
    world: { lots: [{ footprint: { i0: 15, j0: 268, nx: 6, nz: 8 }, floors: 6 }] }, buildings: { loc_1: { label: 'Street', kind: 'street', anchor: { x: 1, z: 2 }, lots: [0] } },
    things: [{ id: 'thing_1', name: 'Bus', placements: [{ scene: 's1', place: 'loc_1', x: 1, z: 2 }] }],
    scenes: [{ id: 's1', place: 'loc_1', events: [{ index: 0, hit: { sphere: { x: 1, y: 1, z: 1, r: 2 }, parts: [{ lot: 0 }] } }] }] }));
  const simulation = await readSimulation(workspace);
  assert.deepEqual(simulation.strands.map(strand => strand.id), ['w']);
  assert.deepEqual(simulation.places, {});
  assert.deepEqual(simulation.hits, []);
  assert.equal(simulation.things[0].name, 'Bus');
});

test('the places registry reaches the Places page trimmed, and its fills only by an exact version', async (context) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { placeFill, readPlaces } = await import('./stage-reports.mjs');
  const workspace = await mkdtemp(join(tmpdir(), 'places-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  assert.equal(await readPlaces(workspace), null);
  const folder = join(workspace, 'stage', 'simulation', 'places');
  await mkdir(join(folder, 'fills'), { recursive: true });
  await writeFile(join(folder, 'index.json'), JSON.stringify({ builtAt: 'now', runs: [{ strand: 'a', run: 'r1', exportedAt: 't' }],
    places: [{ id: 'city', label: 'City', scale: 'city', parent: null, x: 1, z: 2, r: 400, depth: 0, open: true, strand: 'a', run: 'r1' }],
    grounds: [{ place: 'city', version: 'aaaaaaaaaaaa', roads: 3 }, { place: 'city', version: '../../escape', roads: 1 }],
    manifolds: [{ id: 'm1', place: 'city', patch: 'p0', types: ['park'], era: 'modern', centre: [0, 0], radius: 60, outline: [[60, 0], [0, 'x'], [0, 60]], version: 'bbbbbbbbbbbb', buildings: 9, run: 'r1' }],
    buildings: [{ id: 'loc_1', name: 'Tower', kind: 'named', place: 'city', x: 3, z: 4, w: 10, d: 12, angle: 0, floors: 9, scene: 's1', run: 'r1' }] }));
  await writeFile(join(folder, 'fills', 'bbbbbbbbbbbb.json'), '{"version":"bbbbbbbbbbbb","buildings":[]}');
  const map = await readPlaces(workspace);
  assert.deepEqual(map.grounds, [{ place: 'city', version: 'aaaaaaaaaaaa', roads: 3 }], 'a ground with a malformed version is left out');
  assert.deepEqual(map.manifolds[0].outline, [[60, 0], [0, 60]], 'a malformed outline point is left out');
  assert.deepEqual(map.buildings[0], { id: 'loc_1', name: 'Tower', kind: 'named', place: 'city', x: 3, z: 4, w: 10, d: 12, angle: 0, floors: 9, scene: 's1', run: 'r1' });
  assert.equal(await placeFill(workspace, 'bbbbbbbbbbbb'), '{"version":"bbbbbbbbbbbb","buildings":[]}');
  for (const version of ['../index', 'BBBBBBBBBBBB', 'bbbbbbbbbbb', 'bbbbbbbbbbbb.json', null]) assert.equal(await placeFill(workspace, version), null, String(version));
});
