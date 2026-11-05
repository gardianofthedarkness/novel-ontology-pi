# The album in v2: the book's pictures and its people's portraits

The user, 2026-11-05: *"the picture detection and portrait system never wired in in v2"*. v2's design hung the album's
pictures on sentence ids (world-engine-v2.md §2: "pictures anchored on sentence ids"), but no v2 step made or used them.

## Pictures on the book's own sentences

v1's album ([src/digger/intake/album/album.ts](../../src/digger/intake/album/album.ts)) reads the EPUB's pictures (cover,
plates, story pictures, front pages) and anchors each one by its character offset in the album's own extraction of the text,
which in v1 is the workspace's text. A v2 book's text came from elsewhere (vol 1: 124,716 characters against the album's
129,322), so v1's import refuses it.

[src/v2/album.ts](../../src/v2/album.ts) anchors each picture by its words instead: the text right after it in the EPUB (else
right before it), found in the book's sentences in reading order, the shortest run of characters (10 to 40) that occurs only
once from where the last picture was found. The front matter (cover, plates, front pages) hangs on the book's first sentence:
its words are a teaser quoting a later page, or not in the book's text at all. A story picture whose words are not found
(the back cover after the afterword) hangs on the last sentence. The records keep v1's shape (`assets/ill_NNNN.*`,
`ontology/illustrations.jsonl`, `ontology/album.json`), so v1's portrait cropper and binding work on a v2 book as they are.

`novel album import <library>/vol-1/novel <book.epub>` takes this path for a v2 book (its manifest has `v2Reading`). Vol 1:
16 pictures (the cover, 2 plates, 4 front pages, 9 story pictures), 8 story pictures anchored on their sentences, the last on
the book's last sentence.

## In the reading

The user, 2026-11-05: *"first make it part of the reading pipeline"*. `node experiments/v2/read.mjs <novel-dir> <out-dir> --epub
<book.epub>` makes the album as part of the reading (`readingAlbum`): the pictures anchored on the sentences read, written in
v1's shape under `<out>/v2/album` with the chart's people as its characters, so the portrait cropper (run when
`NOVEL_PORTRAIT_PYTHON` names its Python; skipped and said so otherwise) binds faces to the reading's own ids; and the book's
front and back matter in `<out>/v2/front.json`: the EPUB's text before the book's first sentence (title, credits, synopsis,
character introductions) and after its last (the afterword), in paragraphs. The book's text starts at the prologue, so
none of it was read before. `experiments/v2/workspace.mjs` carries the album into the book it makes. Vol 1's reading again
from its cache (no request paid): 16 pictures, 8 anchored, 70 paragraphs before the book and 27 after, 5 portraits bound.

## Portraits

`novel album assign <library>/vol-1/novel` runs v1's cropper ([tools/album-portraits](../../tools/album-portraits/README.md):
RapidOCR reads the plates' captions, an anime head detector crops the faces) and binds each face to a character by name
(`ontology/portraits.jsonl`). A v2 book is ready for it once its reading is done (its characters are the reading's); v1's
check that every block's packet was reviewed is for v1 books. The cropper needs its Python packages (`NOVEL_PORTRAIT_PYTHON`);
the models download on first use. Vol 1 (2026-11-05, 13 s, no model calls): 5 faces bound from its front pages and plates (Kamijou,
Index, Last Order, Accelerator, Maidono), each checked by eye; 36 characters have no captioned face in the book's pictures.

## Where they show (World · Live)

`play/album.json` ([sim-play.mjs](../../tools/pi-review/sim-play.mjs) `directorAlbum`) gives the pictures (id, kind,
sentence, scene) and each bound portrait; the images come from `api/album-asset`, which serves only files the album's
records list.

- **Read along:** a story picture shows beside the subtitle from its sentence for the next six read (tap to enlarge). A
  spoken line's subtitle has its speaker's portrait.
- **Read:** with the EPUB the book shows as published, its pictures where it has them; without it, the album's pictures
  after the sentence they hang on.
- **The world:** each person's portrait before their name, and on their speech bubbles (strand-demo.html `portraitsArrived`).
- **Story menu:** each unit's speakers' faces, and a mark where the book has a picture.

## Snapshots and sharing

The album is the published book's, as its text is: kept with the book, never snapshotted, restored or exported
([universe-snapshots.md](universe-snapshots.md)). Another user makes it from their own EPUB with `novel album import`, then
`novel album assign`.
