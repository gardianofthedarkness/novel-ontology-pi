/**
 * The building level as World · Live lists it (its Buildings panel; the user, 2026-11-01): each building's type and who
 * typed it, its height against its type's minimum (config/terrain/heights.json), how sure Jev was; a composite building's
 * part's host, floor and size, and who chose them. Names only. `H`: the heights dictionary (loadHeights).
 */
export const buildingList = (terrain, H) => Object.entries(terrain.sites).filter(([, site]) => site.scale === 'building').map(([id, site]) => ({
    id, label: site.label, type: site.type ?? site.shape ?? site.kind ?? null, use: site.kind ?? null, by: site.by, typeBy: site.typeBy ?? null,
    ...(typeof site.top === 'number' ? { top: site.top } : {}), ...(site.type && H?.buildings[site.type] ? { least: H.buildings[site.type] * 3 } : {}),
    sure: { kind: site.confidence?.kind ?? null, height: site.confidence?.height ?? null }, street: site.parentLabel ?? null,
    ...(site.by === 'tenant' ? { in: site.in, inLabel: site.inLabel, floor: site.floor, area: site.area ?? null, partBy: site.partBy ?? null, partSure: site.partSure ?? null } : {}), ...(site.tenant ? { alone: true } : {}),
  }));

/**
 * The area tree the Buildings panel shows when no terrain run is feeding it a list (the user, 2026-11-17: "make the actual
 * area tree building list back"): every area terrain keeps (city, district, street; region too) with its parent, kind,
 * ground and its street's lots, and every building of the text (buildingList) under the street it stands in. From the
 * book's stage/terrain.json alone: what the panel shows is what the world was built from, whatever run played last.
 */
export function areaTree(terrain, H) {
  const sites = terrain?.sites ?? {}, lots = new Map();
  for (const slot of Object.values(terrain?.slots ?? {})) if (slot.level === 'building' && slot.parent) lots.set(slot.parent, (lots.get(slot.parent) ?? 0) + 1);
  const areas = Object.entries(sites).filter(([, site]) => ['region', 'city', 'district', 'street'].includes(site.scale)).map(([id, site]) => ({
    id, label: site.label, scale: site.scale, kind: site.kind ?? null, ground: site.ground ?? site.shape ?? null, parent: site.parent ?? null,
    by: site.by ?? null, spare: Boolean(site.spare), ...(typeof site.average === 'number' ? { average: Math.round(site.average) } : {}), lots: lots.get(id) ?? 0,
  }));
  return { areas, buildings: buildingList(terrain, H).map(entry => ({ ...entry, parent: sites[entry.id]?.parent ?? null })) };
}
