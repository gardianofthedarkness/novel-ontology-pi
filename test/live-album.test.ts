import { test } from "node:test";
import assert from "node:assert/strict";
import { albumAssetUrl, liveAlbum, sameAlbumEntries, portraitDraws } from "../apps/playground/src/data/liveAlbum.js";
import { albumImageUrl, albumTextureSize, containedImageSize } from "../apps/playground/src/data/albumImage.js";
import type { OrbitalDraw } from "../apps/playground/src/data/orbitalLayout.js";
import { placePictures } from "../apps/playground/src/data/pictureNodes.js";
import { pictureDraws } from "../apps/playground/src/data/pictureDraws.js";
import { albumEntries, albumScenes, albumScrollOffset } from "../apps/playground/src/data/albumEntries.js";
import type { WorldNode } from "../apps/playground/src/types.js";

const sceneNode = (id: string, chrono: number, parent: string | null = null): WorldNode => ({ id, chrono, parent, label: id, kind: "scene", state: "canon", lane: "canon", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });

test("album follows scene proxies in story order and preserves canonical scene anchors", () => {
  const scenes = [{ ...sceneNode("spiral:later-in-book", 0), kind: "bigEvent" as const, albumSceneId: "later-in-book" }, { ...sceneNode("spiral:earlier-in-book", 1), kind: "bigEvent" as const, albumSceneId: "earlier-in-book" }];
  const pictures = [{ id: "ill_1", asset: "api/album-asset?id=ill_1&volume=2", kind: "story", sentenceId: null, sceneId: "later-in-book", sceneFraction: 0.5 }];
  const base: OrbitalDraw[] = scenes.map((node, index) => ({ node, radius: 30, role: "main", position: [index * 500, 0, 0] }));
  const entries = albumEntries(scenes, pictures);
  assert.equal(entries[0].placed, true);
  assert.equal(entries[0].prevSceneLabel, "spiral:later-in-book");
  assert.equal(entries[0].nextSceneLabel, "spiral:earlier-in-book");
  const draws = pictureDraws(scenes, pictures, base);
  assert.equal(draws.length, 1);
  assert.equal(draws[0].asset, pictures[0].asset);
  assert.deepEqual(draws[0].position, [250, 0, 0]);
  assert.equal(pictures[0].sceneId, "later-in-book");
  assert.equal(albumEntries(scenes, [{ ...pictures[0], sceneId: "another-book" }])[0].placed, false);
});

test("album scene ordering respects chapter order instead of interleaving chapter-local ordinals", () => {
  const nodes = [{ ...sceneNode("chapter_1", 1), kind: "bigEvent" as const }, { ...sceneNode("chapter_2", 2), kind: "bigEvent" as const }, sceneNode("first", 0, "chapter_1"), sceneNode("second", 20, "chapter_1"), sceneNode("third", 0, "chapter_2")];
  assert.deepEqual(albumScenes(nodes).map(scene => scene.id), ["first", "second", "third"]);
  const entry = albumEntries(nodes, [{ id: "image", asset: "image.png", kind: "story", sentenceId: null, sceneId: "second", sceneFraction: 0.5 }])[0];
  assert.equal(entry.nextSceneLabel, "third");
  assert.equal(entry.chrono, 1.5);
});

test("album scroll reveals the selected image locally without moving a visible selection", () => {
  assert.equal(albumScrollOffset(0, 400, 1200, 300), 1100);
  assert.equal(albumScrollOffset(1100, 400, 1200, 300), 1100);
  assert.equal(albumScrollOffset(1100, 400, 50, 300), 50);
  assert.equal(albumScrollOffset(0, 400, 1200, 700), 1200);
  assert.equal(albumScrollOffset(0, 0, 0, 0), 0);
});

test("live album maps snapshot pictures and portraits to book-scoped asset URLs", () => {
  const album = liveAlbum({ pictures: [{ id: "ill_0001", kind: "plate", sentenceId: "b0001_s0004" }], portraits: [{ id: "portrait:assets/portraits/a b.png", entityId: "char_1", entityLabel: "御坂美琴" }] }, 2);
  assert.equal(album.pictures[0].asset, "api/album-asset?id=ill_0001&volume=2");
  assert.equal(album.portraits[0].asset, "api/album-asset?id=portrait%3Aassets%2Fportraits%2Fa%20b.png&volume=2");
  assert.equal(albumAssetUrl("x", null), "api/album-asset?id=x");
  assert.deepEqual(liveAlbum(undefined, 1), { pictures: [], portraits: [] });
});

test("unchanged album refreshes keep the previous arrays", () => {
  const first = liveAlbum({ pictures: [{ id: "a", kind: "story", sentenceId: null }], portraits: [] }, 1).pictures;
  const same = liveAlbum({ pictures: [{ id: "a", kind: "story", sentenceId: null }], portraits: [] }, 1).pictures;
  assert.ok(sameAlbumEntries(first, same));
  assert.ok(!sameAlbumEntries(first, liveAlbum({ pictures: [{ id: "a", kind: "story", sentenceId: null }], portraits: [] }, 2).pictures), "another book's URLs differ");
});

test("portrait draws carry the actual book-scoped image into the renderer and stay attached to visible characters", () => {
  const character: OrbitalDraw = { node: { id: "char_1", label: "御坂美琴", kind: "character", state: "canon", parent: "chapter_1", lane: "canon", chrono: 2, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, role: "nebula", radius: 20, position: [100, 20, 30] };
  const album = liveAlbum({ pictures: [], portraits: [{ id: "portrait:assets/portraits/a.png", entityId: "char_1", entityLabel: "御坂美琴" }, { id: "portrait:assets/portraits/b.png", entityId: "hidden", entityLabel: "不在此层" }] }, 2);
  const draws = portraitDraws([character], [...album.portraits, album.portraits[0]]);
  assert.equal(draws.length, 1);
  assert.equal(draws[0].asset, album.portraits[0].asset);
  assert.equal(draws[0].node.parent, "chapter_1");
  assert.deepEqual(draws[0].position, [148, 44, 30]);
  assert.equal(draws[0].radius, 16);
});

test("album textures resolve relative to the protected viewer, never to an external image host", () => {
  const base = "https://viewer.test/view/private/?phone=1&book=2#pi=control";
  assert.equal(albumImageUrl(albumAssetUrl("portrait:assets/portraits/a.png", 2), base), "https://viewer.test/view/private/api/album-asset?id=portrait%3Aassets%2Fportraits%2Fa.png&volume=2");
  for (const asset of [undefined, "", "https://other.test/collect", "//other.test/image", "javascript:alert(1)", "file:///tmp/image.png", "data:image/png;base64,eA=="]) assert.equal(albumImageUrl(asset, base), null);
});

test("album artwork preserves its aspect ratio and caps GPU textures for phones", () => {
  assert.deepEqual(containedImageSize(800, 800, 150, 200), [150, 150]);
  assert.deepEqual(containedImageSize(4000, 2000, 200, 150), [200, 100]);
  assert.deepEqual(containedImageSize(0, 0, 200, 150), [200, 150]);
  assert.deepEqual(albumTextureSize(4000, 2000), [1024, 512]);
  assert.deepEqual(albumTextureSize(2000, 4000), [512, 1024]);
  assert.deepEqual(albumTextureSize(300, 500), [300, 500]);
});

test("live scene bindings place illustrations without requiring private sentence coverage on graph nodes", () => {
  const scenes = [{ id: "scene_1", chrono: 0, sentenceIds: [] }, { id: "scene_2", chrono: 10, sentenceIds: [] }];
  const pictures = liveAlbum({ pictures: [{ id: "ill_1", kind: "story", sentenceId: "b0001_s0004", sceneId: "scene_1", sceneFraction: 0.01 }], portraits: [] }, 2).pictures;
  const placed = placePictures(scenes, pictures)[0];
  assert.equal(placed.placed, true);
  assert.equal(placed.prevSceneId, "scene_1");
  assert.equal(placed.nextSceneId, "scene_2");
  const base: OrbitalDraw[] = scenes.map((scene, index) => ({ node: { ...scene, kind: "scene", state: "canon", label: scene.id, parent: "chapter_0", lane: "canon", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, radius: 100, role: "main", position: [index * 600, 0, 0] }));
  const draws = pictureDraws(base.map(draw => draw.node), pictures, base);
  assert.equal(draws.length, 1);
  assert.equal(draws[0].asset, pictures[0].asset);
  assert.ok(draws[0].position[0] > 100 && draws[0].position[0] < 500, "the card clears both opaque scene spheres");
  assert.deepEqual(draws[0].facing, [600, 0, 0]);
  assert.equal(pictureDraws(base.map(draw => draw.node), pictures, [{ ...base[0], node: { ...base[0].node, id: "cluster", cluster: { kind: "scenes", ids: scenes.map(scene => scene.id), recordCount: 2, proposed: 0, held: 0 } } }]).length, 0, "do not bury pictures inside a collapsed group");
  for (const value of [{ ...pictures[0], sceneId: null }, { ...pictures[0], sceneFraction: 1 }, { ...pictures[0], sceneId: "unknown" }]) assert.equal(placePictures(scenes, [value])[0].placed, false);
});
