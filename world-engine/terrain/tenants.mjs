/**
 * Composite buildings at the building level (docs/v2/borrow-and-spawn.md §6; the user, 2026-11-01): a shop, a restaurant,
 * a cinema the text passes by joins a building of a use that holds such places (a mall, a tower's foot, a station, an
 * underground mall) under its holder, where the characters' travel is least: one kept at this level, or a spare lot of
 * that use. It takes no lot. Its floor and size: fixed for some types (config/terrain/composite.json), else one question
 * to Jev. With no host there, it borrows a lot of its own at its type's least floors, asked nothing. Placed once the
 * level's buildings and their moves are done, so its host stands where it will stay.
 *
 * `ctx`: the terrain loop's state and functions (terrain-spawn.mjs): the terrain and its registry's slots, the heights
 * dictionary `H`, the spawning modules `S`, the modes `T`, composite.ts `CP`, the context engine's `ask` with `decide`, the
 * live record, and the loop's own helpers.
 */
export function tenantPlacer(ctx) {
  const { terrain, H, S, T, CP, Z, bookId, stores, ask, decide, live, name, holderOf, travelFor, within, nodeOf, slotsAt, borrowBuilding, show, logMap, saveSlots } = ctx;
  const waiting = [];
  return {
    /** A tenant to place once the level's buildings stand. */
    defer: entry => { waiting.push(entry); },
    /** Whether any wait. */
    waiting: () => waiting.length > 0,
    /** Each placed in its host (or a lot of its own); how many were placed. */
    async place() {
      let placed = 0;
      for (const { part, city, type, kind, tenancy, sure, what, found, about } of waiting) {
        const holder = holderOf(part, city), { travel } = travelFor(part), under = id => id === holder || within(id, holder);
        const kept = Object.entries(terrain.sites).filter(([id, site]) => id !== part.id && site.scale === 'building' && site.by === 'borrow' && site.slot && site.parent && under(site.parent) && Array.isArray(site.toward) && nodeOf(site.parent))
          .map(([id, site]) => { const node = nodeOf(site.parent); return { id, use: site.kind, at: [node.x + site.toward[0], node.z + site.toward[1]], kept: true, top: site.top ?? null, parent: site.parent, toward: site.toward, label: site.label, type: site.type ?? site.kind, size: site.size, box: site.box }; });
        const spare = slotsAt('building').filter(slot => slot.at && slot.toward && under(slot.parent) && !slot.owner && !S.sharersIn(slot, bookId).length)
          .map(slot => ({ id: slot.id, use: slot.kind, at: slot.at, kept: false, top: null, parent: slot.parent, toward: slot.toward, label: `a ${slot.kind} lot`, type: slot.kind, size: slot.size, box: Z.turnedBox(slot.at, slot.size, slot.turn ?? 0) }));
        const host = CP.chooseHost(tenancy, [...kept, ...spare], travel), base = { label: part.label, scale: 'building', kind, holder, type, typeBy: sure ? 'search' : 'jev', offered: found.map(entry => entry.id), confidence: { kind: what?.confidence ?? null } };
        if (!host) {
          const lot = await borrowBuilding(part, city, kind);
          if (!lot) { await live.outcome({ subject: part.label, text: `a ${type}: no building to be part of and no lot of its own under ${name(holder)}` }); continue; }
          const top = (H.buildings[type] || 1) * 3;
          Object.assign(terrain.sites[part.id], { ...base, top, tenant: 'alone' });
          await live.outcome({ subject: part.label, text: `${part.label}: a ${type}, no building of ${tenancy.in.join(', ')} under ${name(holder)} to be part of: a lot of its own, ${top / 3} floor${top === 3 ? '' : 's'}, asked nothing` });
          await show(`${part.label}: kept`, { id: part.id, label: part.label, kind, box: lot.box, top });
        } else {
          // Its floor and size (the user, 2026-11-01): fixed for some types (a convenience store on floor one), else asked of
          // Jev in one question, read from its scenes; a random spot of that floor, its model there roughly.
          const floorsUp = typeof host.top === 'number' && host.top > 0 ? Math.round(host.top / 3) : null, area = Array.isArray(host.size) ? Math.round(host.size[0] * host.size[1]) : null;
          let floor = tenancy.floor ?? null, size = tenancy.size ?? null, reply = null;
          if (floor === null || size === null) {
            const floors = CP.partFloors(floorsUp), sizes = CP.partSizes(area);
            reply = (await ask(decide, T.terrainPartMode, { ...about, pictures: {}, kind: type, host: { label: host.label, type: host.type, floors: floorsUp, area }, floors, sizes }, stores)).replies;
            const of = (key, options) => options.find(option => option.letter === reply.find(entry => entry.key === key)?.value)?.value ?? null;
            floor ??= of('floor', floors) ?? 1; size ??= of('size', sizes) ?? 100;
          }
          const sureOf = key => reply?.find(entry => entry.key === key)?.confidence ?? null;
          terrain.sites[part.id] = { ...base, parent: host.parent, parentLabel: name(host.parent), toward: host.toward, box: host.box, in: host.id, inLabel: host.label, floor, area: size, floors: tenancy.floors ?? 1, spot: CP.spotOf(part.id), partBy: reply ? 'jev' : 'fixed', ...(reply ? { partSure: { floor: sureOf('floor'), size: sureOf('size') } } : {}), by: 'tenant' };
          if (!terrain.order.includes(part.id)) terrain.order.push(part.id);
          logMap({ level: 'building', what: 'tenant', place: part.id, in: host.id, floor, area: size });
          await live.outcome({ subject: part.label, text: `${part.label}: a ${type}, part of ${host.label} in ${name(host.parent)}, ${floor < 0 ? `${-floor} floor${floor === -1 ? '' : 's'} under the street` : `floor ${floor}`}, about ${size} m²${reply ? ' (Jev)' : ', as its type always is'}` });
          await show(`${part.label}: kept`, { id: part.id, label: part.label, kind, box: host.box, top: null });
        }
        await saveSlots(); placed++;
      }
      waiting.length = 0;
      return placed;
    },
  };
}
