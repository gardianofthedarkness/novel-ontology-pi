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
which card it shows (before or after its anchor: v1's placement made exact); for each face, who it is (one decision, below)
and which card's moment it is in; the setting (the set dresser's kinds), time of day, weather,
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

## Telling faces apart: the context for each candidate

The user, 2026-11-05: *"facts need to be drawn for the candidates. An automatic portrait match system sampling from
ground truth … scores similarity based on image vector matching … adjacent segment character system (if multiple
characters appear they should search for a recent group they appear together …) and the portrait source of truth
matching system all given as context to jev"*.

- **The portrait matcher:** CCIP (imgutils, contrastive anime character embeddings; 287 MB of weights, downloaded once)
  scores each face against each portrait by the model's own difference (under 0.178, the same character): the nearest three
  candidates with a portrait, `same character`, `close` or `unlike`.
- **Each candidate's evidence** (`candidateEvidence`): the book's sentences with a word of looks (hair, eyes, clothes, hat,
  goggles, scarf, coat, habit, uniform, eyepatch) beside one of their names, nearest the picture first; the reading's facts
  about them before it; the introduction's line.
- **Groups** (`recentGroups`): the named people each unit had (its cards' people), from 40 units before the picture to two
  after, as distinct sets of two to ten, most recent first. People a picture shows in one moment are recorded together
  (a `near` fact for each pair), whatever the world had.
- **One decision a face:** the face alone, each candidate's own portrait as its own picture (named by the person: a sheet of
  labelled portraits was misread), and all of the above. The brief is cut to 20,000 characters (the passage shrinks round the
  picture): Jev refused one of 26,752 with its pictures.

Measured on the 14 faces of vol 1 checked by eye:

| Run | Right | Wrong | Unnamed |
|---|---|---|---|
| picture and text only | 9 | 3 | 2 |
| the portrait gallery asked first | 11 | 1 | 2 |
| + matcher, looks and facts, groups (gallery first) | 11 | 3 | 0 |
| one decision with everything, portraits as their own pictures | 11 | 2 | 1 |
| + references from confirmed faces, one person once in a moment | 11 | 1 | 2 |

In the last, every face outside ill_0011 is right (11 of 11); ill_0011 (a posed black-and-white picture: Index with a cat
and a parfait, the two Misakas) is wrong on all three, and every signal points away there (the matcher ranks Index third;
Jev reads the face as Kamijou). The matcher is sure of clear faces (Kamijou four times, Accelerator) and unsure of
black-and-white drawings against colour portraits; one of its sure answers was wrong (Anna's face, touching Kamijou's, read
as his).

## Vol 1 (2026-11-05, 9 story pictures, a few cents)

Kinds and cards: 5 single moments, 3 several (ill_0008, ill_0012, ill_0015 in the first run), 1 posed (the back cover,
its 7 lines read as written text). Faces: 14 named out of 19; checked by eye, ill_0012's Index, Kamijou, Last Order and
Accelerator right (Accelerator in its own moment, the anchor's sentence), the short-haired girl left unnamed; ill_0011's
goggled Misaka 10032 right, Index named Kamijou (wrong), Misaka left unnamed; ill_0014's Kamijou right. Card answers are
unsure (0.2–0.56: many cards to choose from), settings mostly not shown; 2 picture facts.

## References sampled from ground truth

The user, 2026-11-05: *"yes build it next"*. The matcher compares a face with every reference of each candidate, not only
their colour plate: the faces confirmed in the book's own pictures, black and white as the story pictures are, kept in the
universe's face store (`<library>/universe/faces/`: the crop the matcher compares, a square copy for Jev, `faces.json`;
the books' art, never exported). A face is a reference only on two signals (`confirmedFaces`): Jev at 0.85 or surer, and
the matcher agreeing (the person Jev named is its nearest, or within its close range); a face is never matched against a
reference from its own picture. The runner asks once with the references the universe has; when that pass confirms new
faces, it asks again with them. Each candidate's nearest confirmed face goes to Jev beside their portrait
(`reference_<id>`).

**Front faces only** (the user, 2026-11-05: *"we can leave out if it's not the front face. We include the front faces in
the characters gallery"*). A head counts when the anime face detector (imgutils `detect_faces`, on the whole picture) finds a
face inside it; a back or a head turned away is counted (`turnedAway`), never lettered, asked about, or kept as a
reference. Vol 1: ill_0012 keeps Index, Kamijou and the short-haired girl and leaves out the fur-coated figure's back and
Accelerator turned away; ill_0015 leaves one out.

**One person once in a moment.** Two faces named the same person, in the same card, in a one-moment picture, or side by side,
keep the surer name; the other is left unnamed (`twinOf`). Kamijou's four confirmed faces made the matcher read Anna's face,
touching his in the last picture, as his.

Vol 1: the first pass confirmed 8 faces, a second Misaka's in ill_0011, 9 references in all, every one right. On the 14 faces
checked by eye: 11 right, 1 wrong, 2 unnamed (before: 11, 2, 1). Misaka in ill_0011 is now found (89%, the matcher 0.134
against her confirmed black-and-white faces); Index there is still read as Kamijou.

**Next:** a later book's run starts with this book's references; references for people with none yet (Index in black and
white) come only when one of her faces is confirmed.
