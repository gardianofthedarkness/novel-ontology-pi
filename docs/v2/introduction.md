# The book's introduction in the reading

The user, 2026-11-05: *"are we using the introduction parts to leverage our overall understanding?"*; *"so it becomes
basically part of the reading pipeline?"*. Yes: a step of the reading, before the book is read.

The book's text starts at its prologue. The EPUB's front matter before it (the title page, credits, the publisher's synopsis,
and its introduction of the main cast: for each, a line of theirs, what they are, their name and the plate picture they
stand on) and its afterword were never read. `read.mjs --epub` now reads them ([src/v2/extraction/front.ts](../../src/v2/extraction/front.ts)).

**Not a unit of the story.** The nine unit types are for the story's units, played at a story time; the introduction is the
publisher's, outside story time. It is read once, into its parts, by rule (its headings; a cast entry is a quoted line,
what the person is, a short name): synopsis, cast, contents, afterword; credits counted and dropped.

**What the reading does with it** ([flow.ts](../../src/v2/extraction/flow.ts), before EM):

- **Standing facts** ([facts.ts](../../src/v2/extraction/facts.ts)): each cast entry and synopsis paragraph is a fact known
  before the story. Every EM and EM² request about the people it names carries it (one per person asked about, beside the
  two most recent of the book's own), however long ago the book last spoke of them; a request deciding a string the
  introduction holds (a title such as the new chairperson) carries it too.
- **The cast's other names** ([em.ts](../../src/v2/extraction/em.ts) `Chart.expect`): what an epithet quotes or sets off
  with a middle dot, typed once (one Jev request): a name of theirs joins them; an ability or a title does not. A numbered
  designation is a name whatever typing said, in the forms the book writes it (its digits, and the number with its counter:
  vol 1 writes the serial numbers so). Whichever name the reading meets first, the others are that person's from then, so EM
  matches them exactly.
- **People the introduction names as one, merged** (`Chart.mergeExpected`): two people of the chart holding names of one
  entry become the one met first; no other id changes.
- **Portraits:** each plate page's people (`intro-groups.json`) let the cropper bind a face by elimination: where the
  captions bound some of a page's people and exactly one is left with exactly one face left on the picture, it is theirs.
  Vol 1: Misaka's name is in the page's text, not in the picture; her face is now bound (checked by eye).
- **The settei cast** ([experiments/v2/settei.mjs](../../experiments/v2/settei.mjs)): an introduced person's line leads
  the lines it is asked about, and an introduced person is asked about however seldom the book sees them.

The introduction's words stay in `front.json` (the book's: never snapshotted or exported); `data.json` keeps who it named,
which facts stood for it and whom it merged.

**What it is meant to fix** (vol 1's reading, W10 and W11): Misaka 10032 split in two (her serial number and the name she goes by,
29 mentions), the chairperson (34 mentions) and the strongest (15) tied to no one, an ability name left a loose concept.

**Cost.** Free to try (a run that answers from the cache and counts what it would ask: `read-intro.mjs` in the session's
notes): the introduction step itself is one request; the requests whose evidence now carries standing facts (EM, the
owners of concepts, EM²'s roles and references) and what follows from changed answers are paid again. Vol 1's dry run
counted at most 924 requests (an upper bound: unanswered requests change what follows), 11.7 M characters, which is
well under a dollar at Jev's input rate.
