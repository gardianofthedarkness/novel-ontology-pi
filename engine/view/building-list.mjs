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
