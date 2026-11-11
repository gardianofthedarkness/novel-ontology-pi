/**
 * `novel warehouse list|add|fetch|refresh|find|show|use` (milestones M10g–i; docs/v3/design.html#models-and-settings §8.3–8.4):
 * the model warehouse for an agent, concise and context-aware. Sources are registered folders of SCAD kits or glTF files
 * with a catalogue of evaluated records; parts are `<source>:<part>`; `use` connects a part to a slot of the world's
 * configuration through the settings schema. JSON out; nothing here asks a model; a download needs the user's OK.
 */
import { addSource, fetchSource, findParts, interactionOf, listSources, meshOfPart, partOf, refreshSource, setInteraction, SLOTS, usePart, type AddOptions } from "../../../world/models/warehouse.js";

export async function warehouseList(options: { source?: string; novelDir?: string } = {}) {
  const out = await listSources(options);
  return { ...out, next: out.sources.length ? `novel warehouse find "<words>" [--kind '<thing kind>'] [--source <name>]` : "novel warehouse add <name> <folder> --licence <SPDX> --why <text>" };
}

export async function warehouseAdd(name: string, path: string, options: Omit<AddOptions, "onPart">) {
  const made = [] as string[];
  const out = await addSource(name, path, { ...options, onPart: (part) => { made.push(part); } });
  return { ...out, next: `novel warehouse find "<words>" --source ${name}; novel warehouse use ${name}:<part> for <slot> <novel-dir> --why <text>` };
}

export async function warehouseFetch(name: string, url: string, options: Omit<AddOptions, "onPart"> & { ok: string; path?: string; limitMB?: number }) {
  const out = await fetchSource(name, url, options);
  return { ...out, next: `novel warehouse list --source ${name}` };
}

export async function warehouseRefresh(name: string) { return refreshSource(name); }

export async function warehouseFind(words: string, options: { kind?: string; category?: string; size?: number; source?: string; top?: number; novelDir?: string } = {}) {
  const out = await findParts(words, options);
  return { ...out, slots: SLOTS.map((slot) => `${slot}:<name>`), next: out.parts.length ? `novel warehouse show ${out.parts[0].ref}; novel warehouse use ${out.parts[0].ref} for <slot> <novel-dir> --why <text>` : "novel warehouse list (the sources); novel warehouse add|fetch (more of them)" };
}

export async function warehouseShow(ref: string, options: { novelDir?: string } = {}) {
  const part = await partOf(ref, { novelDir: options.novelDir });
  if (!part) throw new Error(`No part ${ref} (novel warehouse find "<words>").`);
  const mesh = await meshOfPart(ref, { novelDir: options.novelDir });
  return { ...part, size: [part.footprint[0], part.height, part.footprint[1]], mesh: mesh ? { triangles: mesh.t.length / 3, size: mesh.size } : null, interact: (await interactionOf(ref, { novelDir: options.novelDir })).interact, next: `novel warehouse use ${ref} for <slot> <novel-dir> --why <text>; novel warehouse interact ${ref} '<json>' <novel-dir> --why <text>` };
}

export async function warehouseInteract(novelDir: string, key: string, raw: string | undefined, options: { why?: string; before?: boolean }) {
  if (raw === undefined) return interactionOf(key, { novelDir });
  if (!options.why?.trim()) throw new Error("--why <text> is required: say why this sheet changes.");
  let sheet: Record<string, unknown>; try { sheet = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error("The sheet is JSON: '{\"solid\": true, \"crash\": {\"degree\": 3, \"radius\": 12}, \"breaks\": \"wreck\", \"wreck\": \"kit:cw_veh_heli_wreck\"}'"); }
  return setInteraction(novelDir, key, sheet, { ...options, why: options.why });
}

export async function warehouseUse(novelDir: string, ref: string, slot: string, options: { why?: string; place?: string; before?: boolean; floors?: [number, number]; by?: string }) {
  if (!options.why?.trim()) throw new Error("--why <text> is required: say why this part goes in this slot.");
  return usePart(novelDir, ref, slot, { ...options, why: options.why });
}
