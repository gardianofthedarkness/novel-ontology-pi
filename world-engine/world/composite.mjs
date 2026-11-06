/**
 * Composite buildings in the world (docs/v2/borrow-and-spawn.md §6; the user, 2026-11-01): where a part stands inside its
 * host as the host stands now, and the markers of the buildings and parts the terrain kept, on what stands. Plain data in,
 * plain data out: the export (export-strand-demo.mjs) calls these for each place and once for the page.
 */

/**
 * The parts of composite buildings standing in a place's `buildings` (each { id, x, z, w, d, angle, floors }, world
 * metres): { id, model, host, area, box: [x, z, w, d, angle, bottom, height] }. `here(id)`: whether a street is of this
 * place; `modelFor(building, id)`: its use's model (useModels.ts).
 */
export function partsIn({ terrain, buildings, place, here, modelFor }) {
  // A composite building's parts (the user, 2026-11-01), each its use's model inside its host as the host stands now:
  // on its floor (under the street: −1, −2; its host's own level when the host lies under the street), as large as it is
  // (m², squarish, within the host), at its spot of that floor; roughly, no tiling, no stairs.
  // [x, z, w, d, angle, bottom, height] in world metres, with the part's id and model.
  const parts = [];
  for (const [id, site] of Object.entries(terrain?.sites ?? {}).filter(([, entry]) => entry.by === 'tenant')) {
    const hostSite = terrain.sites?.[site.in], slot = terrain.slots?.[hostSite?.slot ?? site.in];
    if (!slot || !here(slot.parent)) continue;
    const key = slot.lot ?? slot.id, short = key.startsWith(`${slot.parent}:`) ? key.slice(slot.parent.length + 1) : key;
    const host = buildings.find(b => b.id === `${place.id}:${key}` || b.id === `${place.id}:${short}`);
    if (!host) continue;
    const area = site.area ?? 100, w = Math.min(host.w * 0.9, Math.max(4, Math.sqrt(area))), d = Math.min(host.d * 0.9, Math.max(4, area / w)), height = 3 * (site.floors ?? 1);
    // An older run's floor said in words: at its foot, its upper floors, under it.
    const floor = typeof site.floor === 'number' ? site.floor : site.floor === 'upper' ? host.floors - 1 : site.floor === 'under' ? -1 : 1;
    const under = typeof hostSite?.top === 'number' && hostSite.top < 0, bottom = under ? hostSite.top : floor < 0 ? 6 * floor : 3 * (Math.min(floor, host.floors) - 1);
    const [u, v] = site.spot ?? [0, 0], s = u * (host.w - w), t = v * (host.d - d), ux = Math.cos(host.angle), uz = Math.sin(host.angle);
    const model = modelFor({ w, d, floors: site.floors ?? 1, kind: site.kind, use: site.kind, era: 'modern' }, id) ?? null;
    parts.push({ id, model, host: host.id, area, box: [host.x + s * ux - t * uz, host.z + s * uz + t * ux, w, d, host.angle, bottom, height] });
  }
  return parts;
}

/**
 * Each marker of a building the terrain kept on the building standing on its lot, a part's on its part (the user,
 * 2026-11-01: markers 26–66 m off their buildings where a street had moved since its lots were laid as slots; 2026-11-02:
 * built ones too, before the run). Runs after the world is laid, so only the pins and tags move. Changes `macro` in place.
 */
export function snapMarkers({ terrain, macro, landscapes }) {
  const standingNow = new Map(landscapes.flatMap(entry => entry.source.buildings.map(b => [b.id, b]))), partNow = new Map(landscapes.flatMap(entry => (entry.parts ?? []).map(part => [part[7], part])));
  // Every building's marker, built or not (a built one kept its canvas spot, 35 m off its building: 飞镖酒吧, 2026-11-02).
  for (const node of macro) {
    const site = terrain.sites?.[node.id];
    if (site?.scale !== 'building') continue;
    const slot = site.slot ? terrain.slots?.[site.slot] : null, key = slot ? slot.lot ?? slot.id : null, short = key && key.startsWith(`${slot.parent}:`) ? key.slice(slot.parent.length + 1) : key;
    const b = key ? landscapes.map(entry => standingNow.get(`${entry.place}:${key}`) ?? standingNow.get(`${entry.place}:${short}`)).find(Boolean) : null, part = site.by === 'tenant' ? partNow.get(node.id) : null;
    const at = part ? [part[0], part[1]] : b ? [b.x, b.z] : null;
    if (!at) continue;
    const moved = node.spotX === node.x && node.spotZ === node.z;
    node.x = Math.round(at[0] * 10) / 10; node.z = Math.round(at[1] * 10) / 10;
    if (moved) { node.spotX = node.x; node.spotZ = node.z; }
  }
}
