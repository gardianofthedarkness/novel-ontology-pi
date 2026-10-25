import { test } from "node:test";
import assert from "node:assert/strict";
import { albumAssetUrl, liveAlbum, sameAlbumEntries } from "../apps/playground/src/data/liveAlbum.js";

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
