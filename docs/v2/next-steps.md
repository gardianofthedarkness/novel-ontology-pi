# Next steps: a work model beside Jev (2026-11-02)

After the first full run of volume 1 on the director (604 cards in 39 scenes, 68 moves, 3 blasts; run
`d20261102081221`), the user on why v2 plays less smoothly than v1:

> In v1, Jev used the summary an LLM worker extracted. It helps him understand complex, sometimes mixed thought,
> facts and actions. Not only that: LLMs can figure out more than that. We can't rely on extraction alone, and we need a
> runtime system 2 as backup when confidence is low, in speaker assignment from extraction and in the world engine.
> Second, the work LLM would also carry cross-scene short- and long-term context.

## What the run showed

- **Jev gets raw lines.** Each director question carries a card's sentences, the line either side and the people
  present. A card that braids talk, an inner thought, a background fact and three actions (run into an alley, throw
  something away, leap with someone onto a roof) is untangled inside the same request that asks for an arrow on a
  picture. Jev answered such a card "go with the other person" at 42%, and the mover ended on the street, not the roof.
- **v1 had a digest; v2 has none.** v1's work model wrote each event's summary (who did what, where, to what end) and
  Jev decided on it. v2's workspace `events.jsonl` keeps a `summaryEn` that is only the source sentence.
- **Extraction's doubts reach the world unchecked.** Who says a line is EM²'s (a Jev question during extraction,
  `ROLE_ACCEPT` 0.5): in scene 1 two lines of five are "no one sure" (31%, 43%). The director plays them as they are.
- **The world engine's doubts too.** 21 moves where Jev chose a direction and a target never walked; 353 "stays"; long
  stretches of scenes with no move at all. Nothing looks again at a weak answer.

## 1. The card digest (the work model, before Jev)

Once per card, before the director asks Jev anything, the work model reads the card with its scene around it and writes
a digest, kept with the run and shown in World · Live's Why panel:

- **Background:** facts, descriptions and thoughts in the card that are not to be played.
- **Each action:** who; what; from where to where (a building, its floor, a room, a roof, underground, another place);
  how (a step, a walk, a run, a leap, a flight, carried, with whom); and whether it is said, implied, or only intended.
- **Speech:** each spoken line's speaker and listener as the passage implies them, with how sure, beside EM²'s answer.
- **What breaks**, if the text says so, and where.
- **What it infers beyond the words** (the user: LLMs can figure out more): a movement only implied by a later line
  (someone is suddenly on a roof), where a person must be for a line to make sense, who must have arrived, what a
  pronoun or a nickname refers to here.

Jev then gets the digest beside the raw lines in every director question (whether, direction, spot, box, breaks). The
digest frames; Jev still decides on the pictures.

## 2. Runtime system 2 (when confidence is low)

Extraction is not the only word, and neither is one Jev answer. A slower, deliberate pass runs at play time when:

- **a speaker is unsure:** EM²'s answer below ~0.6, or "no one", or the digest names someone else;
- **Jev is unsure:** an answer below ~0.6 (a direction, a spot, whether someone goes), or its top two close;
- **the world disagrees:** a chosen target with no walk there; a person the text has in a scene who is not present; a
  move far beyond what the card says; Jev against the digest (the digest says roof, Jev says street);
- **nothing moves for long:** many cards in a row of "stays" where the digest has actions.

The pass: the work model gets the card, its digest, the memory (below), the world as it stands (who is where, the
building and floor they are in, what is near) and the doubtful answer with its alternatives, and says what it thinks
happens and why. Jev is asked again with that reasoning in its context (on the same pictures, or a new view framed on
what the reasoning points at); the second answer is kept with the first. Both, and the reasoning, show in Why as
"system 2", so the user can see what was doubted and what changed.

## 3. Memory across scenes (the work model's)

The work model carries what the story so far means for the next card:

- **Short term** (the last few cards and scenes): who is where, with whom, heading where, holding or carrying what, what
  is going on (a chase, a fight, a conversation), what was just said.
- **Long term** (the book so far): each character's goals and state (hurt, disguised, tired), relationships, places
  they have been and live, threads still open.

It is updated after each card (short term) and each scene (long term), kept with the run
(`stage/director/memory.json`), given to the digest and to system 2, and shown in the UI next to the card it was used
for.

## Order of work

1. The digest (§1) for every action and dialogue card of volume 1, before the director: one work-model request per card
   (cents for the volume); shown in Why; Jev's director questions take it.
2. Memory (§3), updated card by card and scene by scene, feeding the digest.
3. System 2 (§2): its triggers logged first (how often each fires on volume 1), then the deliberate pass and Jev asked
   again, then the Why panel's before/after.
4. A run of volume 1 with all three, against `d20261102081221`: moves, failed walks, unsure speakers, stays.

Still open from the first full run: 21 chosen targets never walked (a door fix and the walk's reason are in since, not
yet run); seven scenes with no record (four where spawning placed nobody: 15, 20, 41, 43).
