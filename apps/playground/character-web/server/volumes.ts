import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import type { VolumeBundle } from "../src/model/bundle.js";

/**
 * The character host's data: the extracted volumes of a Pi review runtime
 * (`$NOVEL_REVIEW_HOME/runtime/live-volumes.json`, as tools/pi-review reads
 * it). Read-only, loopback only, and trimmed: names, casts, event summaries
 * and actors, relationship deltas, CAUSES and portrait images. Evidence
 * quotes and source text never leave the workspace.
 */
interface Volume { id: number; workspace: string; label?: string }

async function rows<T>(path: string): Promise<T[]> {
  try { return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as T); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
const latest = <T extends { id: string }>(list: T[]) => [...new Map(list.map((entry) => [entry.id, entry])).values()];

async function configured(): Promise<Volume[]> {
  const home = process.env.NOVEL_REVIEW_HOME;
  if (!home) return [];
  const root = resolve(home);
  const volumes = JSON.parse(await readFile(join(root, "runtime", "live-volumes.json"), "utf8")) as Volume[];
  return volumes.filter((volume) => Number.isSafeInteger(volume.id) && typeof volume.workspace === "string").map((volume) => ({ ...volume, workspace: resolve(root, volume.workspace) }));
}

export async function loadVolume(volume: Volume): Promise<VolumeBundle | null> {
  const ontology = join(volume.workspace, "ontology");
  type Raw = Record<string, any>;
  const [entities, scenes, events, relations, stateChanges, portraits] = await Promise.all(
    ["entities", "scenes", "events", "relations", "state-changes", "portraits"].map((name) => rows<Raw>(join(ontology, `${name}.jsonl`))),
  );
  if (!scenes.length) return null;
  const folded = latest(scenes as { id: string }[]) as Raw[];
  const sceneOfSentence: Record<string, string> = {};
  for (const scene of folded) for (const sentence of scene.sentenceIds ?? []) sceneOfSentence[sentence] = scene.id;
  return {
    volume: volume.id,
    label: volume.label && volume.label !== "Interactive Pi session" ? volume.label : `Volume ${volume.id}`,
    entities: (latest(entities as { id: string }[]) as Raw[]).map((entity) => ({ id: entity.id, kind: entity.kind, names: (entity.names ?? []).map((name: Raw) => ({ text: name.text, kind: name.kind })) })),
    scenes: folded.map((scene) => ({
      id: scene.id, chapterIndex: scene.chapterIndex, charactersPresent: scene.charactersPresent ?? [], charactersMentioned: scene.charactersMentioned ?? [],
      locationId: scene.locationId ?? null, summary: scene.summary, dialogues: (scene.dialogues ?? []).map((card: Raw) => ({ id: card.id, participantIds: card.participantIds ?? [], summary: card.summary })),
    })),
    events: (latest(events as { id: string }[]) as Raw[]).map((event) => ({
      id: event.id, chapterIndex: event.chapterIndex, summary: event.summaryEn ?? "", importance: event.importance ?? 0,
      primaryActors: event.primaryActors ?? [], affectedCharacters: event.affectedCharacters ?? [], sentenceIds: event.evidence?.sentenceIds ?? [],
    })),
    sceneOfSentence,
    stateChanges: (latest(stateChanges as { id: string }[]) as Raw[]).map((change) => ({ id: change.id, characterId: change.characterId, afterEventId: change.afterEventId, relationships: change.relationships ?? {} })),
    causes: relations.filter((relation) => relation.type === "CAUSES").map((relation) => ({ fromId: relation.fromId, toId: relation.toId })),
    portraits: portraits.filter((portrait) => typeof portrait.entityId === "string").map((portrait) => ({ entityId: portrait.entityId })),
  };
}

/** A portrait file named by the volume's portraits.jsonl, inside its workspace; nothing else. */
async function portraitFile(volume: Volume, entityId: string): Promise<string | null> {
  const listed = (await rows<{ entityId: string; portrait?: string }>(join(volume.workspace, "ontology", "portraits.jsonl"))).find((entry) => entry.entityId === entityId)?.portrait;
  if (!listed || !/^assets\/portraits\/[\w-]+\.png$/.test(listed)) return null;
  const file = resolve(volume.workspace, listed);
  return file.startsWith(resolve(volume.workspace) + sep) ? file : null;
}

export function characterData(): Plugin {
  const handle = async (url: URL): Promise<{ status: number; type: string; body: string | Buffer }> => {
    const volumes = await configured();
    if (url.pathname === "/api/volumes") {
      const loaded = await Promise.all(volumes.map(async (volume) => ({ volume, bundle: await loadVolume(volume) })));
      return { status: 200, type: "application/json", body: JSON.stringify({ configured: !!process.env.NOVEL_REVIEW_HOME, volumes: loaded.filter((entry) => entry.bundle).map(({ bundle }) => bundle) }) };
    }
    if (url.pathname === "/api/portrait") {
      const volume = volumes.find((entry) => entry.id === Number(url.searchParams.get("volume")));
      const file = volume && await portraitFile(volume, url.searchParams.get("entity") ?? "");
      return file ? { status: 200, type: "image/png", body: await readFile(file) } : { status: 404, type: "text/plain", body: "" };
    }
    return { status: 404, type: "text/plain", body: "" };
  };
  const middleware = (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return next();
    handle(url).then(({ status, type, body }) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }).end(body); },
      () => { response.writeHead(500, { "Content-Type": "text/plain" }).end("Character data unavailable"); });
  };
  return { name: "character-data", configureServer: (server) => { server.middlewares.use(middleware); }, configurePreviewServer: (server) => { server.middlewares.use(middleware); } };
}
