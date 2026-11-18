/**
 * Character memory, index v1 (docs/v3/design.html §10.1).
 *
 * A memory is one thing a character lived through or came to believe: what happened, when it happened (`atOrder`), when
 * this character came to know it (`learnedOrder`: later than `atOrder` when they were told), how they know it, and the
 * amygdala's tags: how arousing it was, its valence, how much it mattered to their goals, whether it was the centre of
 * what they attended to or a detail at the edge. Memories are records, never edited: canon's are written by the reading,
 * a branch's by its own story; a branch never changes canon's.
 *
 * Recall is one Cypher query over the graph (graph-first, no vectors: schema.ts): it walls off what the character cannot
 * know (later than the point, or on another branch), then scores each memory by
 *   retention   power-law forgetting over story time, slowed by arousal (the amygdala's modulation of consolidation),
 *               faster for arousing memories' peripheral details (the central/peripheral trade-off);
 *   importance  arousal, goal relevance, and the retroactive tag: a weak memory sharing a cue with a later, arousing
 *               one the character has also lived through (behavioural tagging), once consolidation has had time;
 *   cue         how many of the present's cues (people, places, things in the conversation) the memory holds;
 *   mood        mood-congruent recall: the present mood's valence times the memory's.
 * Weights live in DEFAULT_RECALL_WEIGHTS, versioned with the index; nothing in them is about any one book.
 */

/** The memory index's version: on every Memory row, and in the weights. A change of fields or scoring is a new version. */
export const MEMORY_INDEX_VERSION = 1;

/** How the holder knows it. */
export type MemorySource = "did" | "saw" | "heard" | "told" | "inferred";
/** An episode (one happening), a belief (a claim held, possibly false), or a gist (consolidated from episodes). */
export type MemoryKind = "episode" | "belief" | "gist";

export interface MemoryRecord {
  id: string;
  holderId: string;
  /** "canon" or a branch id. */
  branchId: string;
  kind: MemoryKind;
  source: MemorySource;
  /** Story order of the happening (Event.chronological_order). */
  atOrder: number;
  /** Story order at which the holder came to know it (>= atOrder; later when told). */
  learnedOrder: number;
  summaryEn: string;
  /** 0..1: how arousing for the holder. */
  arousal: number;
  /** -1..1. */
  valence: number;
  /** 0..1: how much it bears on the holder's goals and people. */
  relevance: number;
  /** 0..1: 1 the centre of what the holder attended to, 0 a detail at the edge. */
  central: number;
  /** 0..1: how sure the holder is (told and inferred memories less). */
  confidence: number;
  /** Ids of the people, places, things and concepts it is about: its retrieval cues. */
  cues: string[];
  /** The event or dialogue card it recalls, when there is one. */
  eventId?: string;
  /** Who told them (source "told" or "heard"). */
  heardFromId?: string;
  /** The sentences that show it (sentence ids), never the text. */
  evidence: string[];
}

export const MEMORY_DDL: string[] = [
  `CREATE NODE TABLE IF NOT EXISTS Memory(
     id STRING, branch_id STRING, kind STRING, source STRING,
     at_order INT64, learned_order INT64, summary_en STRING,
     arousal DOUBLE, valence DOUBLE, relevance DOUBLE, central DOUBLE, confidence DOUBLE,
     evidence_json STRING, index_version INT64, PRIMARY KEY(id))`,
  `CREATE REL TABLE IF NOT EXISTS REMEMBERS(FROM Character TO Memory)`,
  `CREATE REL TABLE IF NOT EXISTS CUES(FROM Memory TO Character, FROM Memory TO Location, FROM Memory TO Item,
     FROM Memory TO Concept, FROM Memory TO Organization, weight DOUBLE)`,
  `CREATE REL TABLE IF NOT EXISTS RECALLS(FROM Memory TO Event, FROM Memory TO DialogueCard)`,
  `CREATE REL TABLE IF NOT EXISTS HEARD_FROM(FROM Memory TO Character)`,
  `CREATE REL TABLE IF NOT EXISTS CONSOLIDATES(FROM Memory TO Memory)`,
];

export interface RecallWeights {
  version: number;
  /** Forgetting: retention = (1 + age / tau)^-decay, tau = tau0 * (1 + kArousal * arousal); age in story order. */
  tau0: number;
  kArousal: number;
  decay: number;
  /** Peripheral details of arousing memories fade faster: retention *= 1 - kPeripheral * arousal * (1 - central). */
  kPeripheral: number;
  /** Retroactive tagging: a later memory at least this arousing, within this many orders, sharing a cue, after tagDelay. */
  tagArousal: number;
  tagWindow: number;
  tagDelay: number;
  wArousal: number;
  wRelevance: number;
  wTag: number;
  /** Score of a memory no present cue touches (so strong memories still come up), and the mood's pull. */
  base: number;
  kMood: number;
}

export const DEFAULT_RECALL_WEIGHTS: RecallWeights = {
  version: MEMORY_INDEX_VERSION,
  tau0: 10, kArousal: 3, decay: 0.6, kPeripheral: 0.6,
  tagArousal: 0.7, tagWindow: 15, tagDelay: 3,
  wArousal: 1, wRelevance: 0.8, wTag: 0.6,
  base: 0.3, kMood: 0.3,
};

/**
 * The wall: a branch's lineage, oldest first, each with the last order visible from it. Canon forked at order 30 into
 * b1, read at 40: [["canon", 30], ["b1", 40]]. Canon itself at 40: [["canon", 40]].
 */
export type Lineage = Array<[branchId: string, until: number]>;

/**
 * Recall: the holder's memories visible from the lineage, best first. `until` is padded with -1 in front so a branch
 * outside the lineage (list_position 0) reads -1 and is walled off (Ladybug's list_extract is 1-based and evaluates
 * eagerly, so a CASE cannot guard it).
 */
export const RECALL_CYPHER = `
MATCH (h:Character {id: $holder})-[:REMEMBERS]->(m:Memory)
WHERE m.learned_order <= list_extract($until, list_position($lineage, m.branch_id) + 1)
WITH m, $now - m.learned_order AS age
WITH m, age, $tau0 * (1.0 + $kArousal * m.arousal) AS tau
WITH m, age, pow(1.0 + age / tau, -$decay) * (1.0 - $kPeripheral * m.arousal * (1.0 - m.central)) AS retention
OPTIONAL MATCH (m)-[k:CUES]->(x) WHERE x.id IN $cues
WITH m, age, retention, coalesce(sum(k.weight), 0.0) AS cue
OPTIONAL MATCH (m)-[:CUES]->(y)<-[:CUES]-(e:Memory)<-[:REMEMBERS]-(:Character {id: $holder})
  WHERE e.arousal >= $tagArousal AND e.learned_order > m.learned_order
    AND e.learned_order - m.learned_order <= $tagWindow AND age >= $tagDelay
    AND e.learned_order <= list_extract($until, list_position($lineage, e.branch_id) + 1)
WITH m, retention, cue, coalesce(max(e.arousal), 0.0) * (1.0 - m.arousal) AS tag
WITH m, retention, cue, tag, $wArousal * m.arousal + $wRelevance * m.relevance + $wTag * tag AS importance
RETURN m.id AS id, m.kind AS kind, m.source AS source, m.at_order AS at, m.learned_order AS learned,
       m.summary_en AS summary, m.evidence_json AS evidence, retention, importance, cue, tag,
       (($base + cue) * retention * (1.0 + importance) * (1.0 + $kMood * m.valence * $mood) * m.confidence) AS score
ORDER BY score DESC LIMIT $k`;

export interface RecallQuery {
  holderId: string;
  lineage: Lineage;
  /** The present's cue ids (people present or named, the place, things in hand or in the talk). */
  cues: string[];
  /** The holder's present mood, -1..1. */
  mood?: number;
  k?: number;
  weights?: RecallWeights;
}

export interface Recalled {
  id: string; kind: MemoryKind; source: MemorySource; at: number; learned: number; summary: string; evidence: string[];
  retention: number; importance: number; cue: number; tag: number; score: number;
}

type Run = (cypher: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;

/** The recall query's parameters (exported for a store that runs it itself). */
export function recallParams(q: RecallQuery): Record<string, unknown> {
  if (!q.lineage.length) throw new Error("recall needs a lineage (at least canon and a point)");
  const { version: _version, ...weights } = q.weights ?? DEFAULT_RECALL_WEIGHTS;
  return {
    ...weights,
    holder: q.holderId,
    lineage: q.lineage.map(([branch]) => branch),
    until: [-1, ...q.lineage.map(([, until]) => until)],
    now: q.lineage[q.lineage.length - 1][1],
    cues: q.cues,
    mood: q.mood ?? 0,
    k: q.k ?? 12,
  };
}

/** Run recall through a store's `run` (LadybugStore.run). */
export async function recall(run: Run, q: RecallQuery): Promise<Recalled[]> {
  const rows = await run(RECALL_CYPHER, recallParams(q));
  return rows.map((r) => ({
    id: String(r.id), kind: r.kind as MemoryKind, source: r.source as MemorySource,
    at: Number(r.at), learned: Number(r.learned), summary: String(r.summary),
    evidence: JSON.parse(String(r.evidence ?? "[]")) as string[],
    retention: Number(r.retention), importance: Number(r.importance), cue: Number(r.cue), tag: Number(r.tag), score: Number(r.score),
  }));
}

/** Write memories into the graph (the holder, cues, event and teller must already be nodes). Rebuilt from the bundle. */
export async function indexMemories(run: Run, memories: MemoryRecord[]): Promise<void> {
  for (const m of memories) {
    if (m.learnedOrder < m.atOrder) throw new Error(`memory ${m.id}: learned before it happened`);
    await run(
      `MATCH (h:Character {id: $holder})
       CREATE (h)-[:REMEMBERS]->(:Memory {id: $id, branch_id: $branch, kind: $kind, source: $source, at_order: $at,
         learned_order: $learned, summary_en: $summary, arousal: $arousal, valence: $valence, relevance: $relevance,
         central: $central, confidence: $confidence, evidence_json: $evidence, index_version: $version})`,
      {
        holder: m.holderId, id: m.id, branch: m.branchId, kind: m.kind, source: m.source, at: m.atOrder,
        learned: m.learnedOrder, summary: m.summaryEn, arousal: m.arousal, valence: m.valence, relevance: m.relevance,
        central: m.central, confidence: m.confidence, evidence: JSON.stringify(m.evidence), version: MEMORY_INDEX_VERSION,
      },
    );
    // A cue is any named node; ids are unique across tables, so each label is tried.
    for (const cue of m.cues) {
      for (const label of ["Character", "Location", "Item", "Concept", "Organization"]) {
        await run(`MATCH (m:Memory {id: $id}), (x:${label} {id: $cue}) CREATE (m)-[:CUES {weight: 1.0}]->(x)`, { id: m.id, cue });
      }
    }
    if (m.eventId) {
      for (const label of ["Event", "DialogueCard"]) {
        await run(`MATCH (m:Memory {id: $id}), (e:${label} {id: $event}) CREATE (m)-[:RECALLS]->(e)`, { id: m.id, event: m.eventId });
      }
    }
    if (m.heardFromId) {
      await run(`MATCH (m:Memory {id: $id}), (c:Character {id: $from}) CREATE (m)-[:HEARD_FROM]->(c)`, { id: m.id, from: m.heardFromId });
    }
  }
}
