/**
 * Picture placement on the timeline orbit — positional resolution at render.
 *
 * Pictures are an INDEPENDENT node type ("picture"), not members of a
 * scene. Each picture's anchor is a sentence identity (see
 * src/digger/intake/album/album.ts); at render time the orbit resolves
 * it against the current scenes:
 *
 * - The picture's neighbors are its ANCHOR scene (the scene whose
 *   sentenceIds contain the anchor sentence) and the NEXT scene.
 * - Its orbit slot is fractional inside that interval: anchor scene
 *   chrono + (index of the anchor sentence within the scene + 1) /
 *   (scene sentence count + 1), scaled by the gap to the next scene's
 *   chrono. Re-segmentation re-brackets automatically: the picture
 *   follows its sentence into whatever scene covers it now, and a
 *   picture whose anchor sentence belongs to no scene yet is unplaced
 *   (it renders once its block is ingested — never force-assigned).
 * - Cover / plate / paratext pictures anchor at the text start or end;
 *   they resolve like any other picture once their anchor sentence is
 *   in a scene, and stay unplaced before that.
 *
 * The graph component draws "picture" nodes from these placements; this
 * module decides placement only, never layout or pixels.
 */

export interface OrbitScene {
  id: string;
  chrono: number;
  sentenceIds: string[];
}

export interface OrbitIllustration {
  id: string;
  asset: string;
  kind: string;
  sentenceId: string | null;
  sceneId?: string | null;
  sceneFraction?: number | null;
}

export type PicturePlacement =
  | {
      placed: true;
      pictureId: string;
      asset: string;
      kind: string;
      /** The scene containing the anchor sentence. */
      prevSceneId: string;
      /** The following scene, or null after the last scene. */
      nextSceneId: string | null;
      /** Fractional orbit slot strictly between the neighbors' chronos (or past the last scene). */
      chrono: number;
    }
  | {
      placed: false;
      pictureId: string;
      asset: string;
      kind: string;
      prevSceneId: null;
      nextSceneId: null;
      chrono: null;
    };

export function placePictures(
  scenes: OrbitScene[],
  illustrations: OrbitIllustration[],
): PicturePlacement[] {
  const sceneBySentence = new Map<string, number>();
  scenes.forEach((scene, index) => {
    for (const sentenceId of scene.sentenceIds ?? []) {
      if (!sceneBySentence.has(sentenceId)) sceneBySentence.set(sentenceId, index);
    }
  });
  return illustrations.map((ill) => {
    const base = { pictureId: ill.id, asset: ill.asset, kind: ill.kind };
    const mapped = ill.sceneId !== undefined;
    const sceneIndex = mapped ? scenes.findIndex((scene) => scene.id === ill.sceneId) : ill.sentenceId ? sceneBySentence.get(ill.sentenceId) : undefined;
    if (sceneIndex === undefined || sceneIndex < 0) {
      return { ...base, placed: false as const, prevSceneId: null, nextSceneId: null, chrono: null };
    }
    const prev = scenes[sceneIndex];
    const next = scenes[sceneIndex + 1] ?? null;
    const at = ill.sentenceId ? prev.sentenceIds.indexOf(ill.sentenceId) : -1;
    const fraction = mapped ? ill.sceneFraction : (at + 1) / (prev.sentenceIds.length + 1);
    if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return { ...base, placed: false as const, prevSceneId: null, nextSceneId: null, chrono: null };
    let gap = next ? next.chrono - prev.chrono : 1;
    if (!(gap > 0)) gap = 1;
    return {
      ...base,
      placed: true as const,
      prevSceneId: prev.id,
      nextSceneId: next ? next.id : null,
      chrono: prev.chrono + fraction * gap,
    };
  });
}
