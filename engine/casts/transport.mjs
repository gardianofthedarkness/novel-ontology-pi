import { setting } from '../../dist/src/world/settings.js';
// The transport specialist (a pre-film cast; the user, 2026-11-06: "transport specialist"): for each vehicle the book
// names, which of the CC0 kits' models it is (picked by Jev from its kind's models, with the lines it is named in); and for
// each vehicle, weapon or machine, whose it is (a person of its lines, an organization, or not said). Who drives, rides or
// holds it card by card is the director's (the rides' ties, the things' holders), recorded as possession on the run.
// Pure: the props (universe/props.json) and the answers in, the rows to ask and universe/transport.json out.

/** The kits' models (apps/playground/tools/vehicle-models.mjs) by vehicle kind, each with the words Jev is told. */
export const VEHICLE_MODELS = {
  'a car': {
    'kn-sedan': 'an ordinary saloon car', 'car-hatchback': 'a small hatchback', 'car-stationwagon': 'an estate car',
    'kn-sedan-sports': 'a sports car', 'kn-suv': 'an SUV or a jeep', 'kn-suv-luxury': 'a luxury car, a limousine',
    'kn-taxi': 'a taxi', 'kn-police': 'a police car', 'kn-race': 'a racing car',
  },
  'a van or a truck': {
    'kn-van': 'a van, a minibus', 'kn-delivery': 'a box delivery truck', 'kn-delivery-flat': 'a small flatbed truck',
    'kn-truck': 'a lorry, a big truck', 'kn-truck-flat': 'a flatbed lorry', 'kn-ambulance': 'an ambulance',
    'kn-firetruck': 'a fire engine', 'kn-garbage-truck': 'a rubbish truck', 'kn-tractor': 'a tractor or a work vehicle',
  },
};
/** The kinds whose owner is asked: every vehicle, weapon and machine. */
export const OWNED_KINDS = new Set(['a car', 'a van or a truck', 'a bus', 'a train or a carriage', 'a motorbike or a bicycle', 'a boat', 'a helicopter', 'an aircraft', 'a drone', 'a small weapon', 'a heavy weapon', 'a robot or a machine']);
/** An owner Jev may name besides the people of its lines. */
export const OWNER_OTHER = { 'an organization': 'a group, a company, the city, an army, a school owns it', 'not said': 'the lines do not say whose it is' };

/** A model by the words in its name alone (before the specialist has asked, or where it says none fits). */
export function ruleModel(kind, label = '') {
  const name = String(label);
  // The configuration's word rules first (models.vehicleWords; milestones M13g): { kind: { regex: model } }, in order.
  for (const [pattern, model] of Object.entries(setting('models.vehicleWords')[kind] ?? {})) { try { if (new RegExp(pattern, 'iu').test(name)) return model; } catch { /* a bad pattern is skipped */ } }
  if (kind === 'a car') {
    if (/taxi|cab|\u51fa\u79df|\u30bf\u30af\u30b7\u30fc/i.test(name)) return 'kn-taxi';
    if (/police|patrol|\u8b66|\u30d1\u30c8\u30ab\u30fc/i.test(name)) return 'kn-police';
    const plain = ['kn-sedan', 'car-hatchback', 'car-stationwagon', 'kn-suv'];
    return plain[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % plain.length];
  }
  if (kind === 'a van or a truck') {
    if (/ambulance|\u6551\u62a4|\u6551\u6025/i.test(name)) return 'kn-ambulance';
    if (/fire|\u6d88\u9632/i.test(name)) return 'kn-firetruck';
    return /truck|lorry|\u5361\u8f66|\u8d27\u8f66/i.test(name) ? 'kn-truck' : 'kn-van';
  }
  return null;
}

/**
 * The rows to ask: each prop label of a kind with models (`models`: its kind's model words, plus none) or one whose owner
 * is asked; with its evidence (sentence ids) and the people its lines name (`people`: id → name, the reading's chart).
 */
export function transportRows(props, { peopleIn = () => [] } = {}) {
  const rows = [];
  for (const [label, sheet] of Object.entries(props?.labels ?? {})) {
    if (!sheet || !OWNED_KINDS.has(sheet.kind)) continue;
    const models = VEHICLE_MODELS[sheet.kind] ? { ...VEHICLE_MODELS[sheet.kind], 'none of these': 'none of these models fits it' } : null;
    rows.push({ label, kind: sheet.kind, models, evidence: sheet.evidence ?? [], people: peopleIn(sheet.evidence ?? []) });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** universe/transport.json from the answered rows: each label's model (its rule's where none was picked) and owner. */
export function transportFile(rows, { model = null, at = new Date().toISOString() } = {}) {
  const props = {};
  for (const row of rows) {
    const picked = row.model && row.model !== 'none of these' && VEHICLE_MODELS[row.kind]?.[row.model] ? row.model : null;
    const model_ = picked ?? (VEHICLE_MODELS[row.kind] ? ruleModel(row.kind, row.label) : null);
    props[row.label] = {
      kind: row.kind,
      ...(model_ ? { model: model_, modelBy: picked ? 'jev' : 'rule', ...(picked && row.modelSure != null ? { modelSure: row.modelSure } : {}) } : {}),
      owner: row.owner ?? 'not said', ...(row.ownerSure != null ? { ownerSure: row.ownerSure } : {}),
      evidence: row.evidence.slice(0, 4),
    };
  }
  return { version: 1, by: 'transport', model, at, props };
}

/** The model a prop is drawn as: the specialist's, else its rule's; null for a kind with none (built from parts). */
export function modelOf(transport, label, kind) {
  return transport?.props?.[label]?.model ?? ruleModel(kind, label);
}
