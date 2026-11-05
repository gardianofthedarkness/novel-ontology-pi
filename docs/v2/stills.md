# The stills cast: the book's pictures as evidence

The user, 2026-11-05: *"we need to provide any cast who analyze the pictures enough context to extract useful information
out of it"*; a new pre-film cast, *"that's ok"*; and where the text read in pictures goes.

v1 placed a picture between the unit holding its anchor sentence and the next one, by story order
(`apps/playground/src/data/pictureNodes.ts`); it never looked at what the picture shows. Vol 1 shows why that is not enough:
ill_0009 is the moment of its anchor sentence, but ill_0012, anchored on a chapter's last sentence, is two panels summing
up the passage before it.

## Where it runs

```
reading (introduction, album) → pre-film notes (script supervisor, blocking, action director) → stills
  → settei, set dresser, in-use, rides, voices → terrain, float → filming
```

It needs the units, their people, places and times, and what the notes say happens; the casts after it read its notes.
`loadPrefilm` merges `pictures.json` into the notes ([world-engine/digest/stills.mjs](../../world-engine/digest/stills.mjs)
`withPictures`): a unit a picture shows gains it, its script supervisor the picture's facts. It needs no new summary: the
text around a picture goes raw, the script supervisor's digest of each unit beside it. It never changes the terrain during
a run; what a picture says of a place is pre-film evidence, applied before a run as any other edit (a new `before`).

## The brief (one Jev request a picture)

Prepared locally ([tools/album-portraits/stills.py](../../tools/album-portraits/stills.py), the cropper's Python): the
picture fitted to a 1,024 px square (Jev takes square pictures) with its faces boxed and lettered and its text boxed and
numbered; each face alone; the book's bound portraits as a gallery, P1, P2 …. Then (`stillsBrief`): the unit the picture
stands in and two each way, their sentences raw (the nearest 160 to the picture), their cards with kind and people, each
unit's kind, place, time and the script supervisor's digest, the people who could be in it (name, portrait label, their
line from the introduction), each face and text placed in words.

Questions (`stillsQuestions`), all choices: the picture's kind (one moment, several moments, a summary or memory, posed);
which card it shows (before or after its anchor: v1's placement made exact); for each face, which portrait it is by the
face alone, then who of the text's people (the text alone crowded the picture out: ill_0011's three faces were answered by
who the text names most), and which card's moment it is in; the setting (the set dresser's kinds), time of day, weather,
what is going on; for each text, what it is (a line said, a caption, a sign, something written, a sound, noise) and whose.

## What its notes give

`pictures.json` (no words of the book) and `pictures-text.json` (the words read; the book's, never exported):

| Note | Goes to |
|---|---|
| the card it shows | the picture's moment and unit (story time and place by the card) |
| who each face is, and near whom | the unit's `stills`; facts `near` (basis `picture`) |
| the setting | facts `indoors` / `outdoors` / `underground` for its people (basis `picture`) |
| a line said, found in a sentence, by a face | the speaker of that sentence (speakers.mjs: `by: 'picture'`, before the voices' pick) |
| captions, signs, written text, sounds | kept in the note for the introduction, the set dresser and terrain, story time, the action director |

A picture fact binds as a stated one does (digest/facts.mjs `binding`).

## Vol 1 (2026-11-05, 9 story pictures, a few cents)

Kinds and cards: 5 single moments, 3 several (ill_0008, ill_0012, ill_0015 in the first run), 1 posed (the back cover,
its 7 lines read as written text). Faces: 14 named out of 19; checked by eye, ill_0012's Index, Kamijou, Last Order and
Accelerator right (Accelerator in its own moment, the anchor's sentence), the short-haired girl left unnamed; ill_0011's
goggled Misaka 10032 right, Index named Kamijou (wrong), Misaka left unnamed; ill_0014's Kamijou right. Card answers are
unsure (0.2–0.56: many cards to choose from), settings mostly not shown; 2 picture facts.

**Known limit:** Jev tells anime faces apart only fairly (one clear miss in the eight checked; four left unnamed). An
anime face matcher (CCIP, in the cropper's package; its weights a download) could give each face a portrait score first.
