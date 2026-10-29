/**
 * Group trips: several people who arrive at a scene together from one
 * earlier scene at another place. Each person's state is handed along their
 * own world line in reading order, as the stage's story lines do it: the
 * scene someone was last in is where they come from, and a flashback hands
 * nothing on (it happened earlier). No model calls; built from story places,
 * who is present (the strands' answered cast where it was asked, else the
 * recorded one) and extracted movement events.
 *
 * Not a trip: the same place, or two places of one name. A place and one
 * inside it (a city and its district) is kept but marked `nested`: the
 * scene may only name the place more closely.
 */
export interface GroupTrip {
  from: string; to: string;
  /** Who travels, in the order the arriving scene lists them. */
  people: string[];
  fromPlace: string; toPlace: string;
  /** A scene at either end borrows its place from an earlier one: the trip rests on a guess. */
  guessed: boolean;
  /** One place lies inside the other: perhaps no travel, only the place named more closely. */
  nested: boolean;
  /** An extracted movement event by one of them, in either scene, backs the trip. */
  backed: boolean;
}

export interface TripEvent { eventType?: string; primaryActors?: string[]; sceneId: string | null }
/** What trips read of the story projection (strandProjection): scenes in reading order with their places and cast, places with their paths. */
export interface TripStory {
  scenes: { id: string; index: number; flashback: boolean; placeIds: string[]; placeCarried: boolean; characterIds: string[] }[];
  places: { id: string; path?: string[] }[];
  names: Record<string, string>;
}

export function groupTrips(data: TripStory, options: { presence?: Map<string, string[]>; events?: TripEvent[]; onStrands?: (sceneId: string) => boolean } = {}): GroupTrip[] {
  const pathOf = new Map(data.places.map((place) => [place.id, place.path ?? [place.id]]));
  const name = (id: string) => data.names[id] ?? id;
  const apart = (a: string, b: string) => a !== b && name(a) !== name(b);
  const nested = (a: string, b: string) => (pathOf.get(a) ?? [a]).includes(b) || (pathOf.get(b) ?? [b]).includes(a);
  const moved = new Map<string, Set<string>>();
  for (const event of options.events ?? []) if (event.eventType === "movement" && event.sceneId) for (const id of event.primaryActors ?? []) moved.set(event.sceneId, (moved.get(event.sceneId) ?? new Set()).add(id));
  const byId = new Map(data.scenes.map((scene) => [scene.id, scene]));
  const last = new Map<string, string>(), trips: GroupTrip[] = [];
  for (const scene of [...data.scenes].sort((first, second) => first.index - second.index)) {
    if (scene.flashback) continue;
    const cast = options.presence?.get(scene.id) ?? scene.characterIds;
    const here = scene.placeIds[0];
    const arrivals = new Map<string, string[]>();
    for (const person of cast) {
      const from = byId.get(last.get(person) ?? ""), there = from?.placeIds[0];
      if (from && here && there && apart(there, here)) arrivals.set(from.id, [...arrivals.get(from.id) ?? [], person]);
    }
    for (const [from, people] of arrivals) {
      if (people.length < 2 || (options.onStrands && (!options.onStrands(from) || !options.onStrands(scene.id)))) continue;
      const origin = byId.get(from)!;
      trips.push({ from, to: scene.id, people, fromPlace: origin.placeIds[0], toPlace: here, guessed: origin.placeCarried || scene.placeCarried, nested: nested(origin.placeIds[0], here),
        backed: people.some((id) => moved.get(from)?.has(id) || moved.get(scene.id)?.has(id)) });
    }
    for (const person of cast) last.set(person, scene.id);
  }
  return trips;
}
