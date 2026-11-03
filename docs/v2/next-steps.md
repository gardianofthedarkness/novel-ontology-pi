# Next steps (2026-11-02)

After the first full run of volume 1 on the director (604 cards in 39 scenes, 68 moves, 3 blasts; run
`d20261102081221`), the user decided two tracks, **decoupled and built in parallel**:

| Track | What | Where |
|---|---|---|
| **A · The summarization layer** | a work model's digest of each card and each scene, and its memory across scenes, in the context of every Jev question | this page |
| **B · The world and the ontology, one loop** | the physics law engine on every answer, the world's evidence back into the ontology, system 2 and the review escalation | [world-ontology.md](world-ontology.md) |

The user: the summarization layer "is a decoupled improvement of a different direction than the world engine ontology
loop. They can be done in parallel." Track A makes each question better informed; Track B checks every answer and keeps
the ontology. Neither waits for the other: B checks whatever answer comes, A improves what is asked.

## Track A: the summarization layer

The user on why v2 plays less smoothly than v1:

> In v1, Jev used the summary an LLM worker extracted. It helps him understand complex, sometimes mixed thought,
> facts and actions. Not only that: LLMs can figure out more than that. The work LLM would also carry cross-scene short-
> and long-term context.

### What the run showed

- **Jev gets raw lines.** Each director question carries a card's sentences, the line either side and the people
  present. A card that braids talk, an inner thought, a background fact and three actions (run into an alley, throw
  something away, leap with someone onto a roof) is untangled inside the same request that asks for an arrow on a
  picture. Jev answered such a card "go with the other person" at 42%, and the mover ended on the street, not the roof.
- **v1 had a digest; v2 has none.** v1's work model wrote each event's summary (who did what, where, to what end) and
  Jev decided on it. v2's workspace `events.jsonl` keeps a `summaryEn` that is only the source sentence.

### A1. The card digest

Once per card, before any Jev question about it, the work model reads the card with its scene around it and writes a
digest, kept with the run and shown in World · Live's Why panel:

- **Background:** facts, descriptions and thoughts in the card that are not to be played.
- **Each action:** who; what; from where to where (a building, its floor, a room, a roof, underground, another place);
  how (a step, a walk, a run, a leap, a flight, carried, with whom); and whether it is said, implied, or only intended.
- **Speech:** each spoken line's speaker and listener as the passage implies them, with how sure, beside EM²'s answer.
- **What breaks**, if the text says so, and where.
- **What it infers beyond the words** (the user: LLMs can figure out more): a movement only implied by a later line
  (someone is suddenly on a roof), where a person must be for a line to make sense, who must have arrived, what a
  pronoun or a nickname refers to here.

Jev gets the digest beside the raw lines in every question about the card (whether, direction, spot, box, breaks). The
digest frames; Jev still decides on the pictures.

### A2. The scene digest

Once per scene: what happens in it (its beats in order), who comes and goes, where it is and how it connects to the
scene before (carries straight on, a jump in time or place, a flashback), and what it leaves open. It heads every card
digest of the scene and feeds the long-term memory.

### A3. Memory across scenes

The work model carries what the story so far means for the next card:

- **Short term** (the last few cards and scenes): who is where, with whom, heading where, holding or carrying what, what
  is going on (a chase, a fight, a conversation), what was just said.
- **Long term** (the book so far): each character's goals and state (hurt, disguised, tired), relationships, places
  they have been and live, threads still open.

Updated after each card (short term) and each scene (long term), kept with the run (`stage/director/memory.json`),
given to the card and scene digests, and shown in the UI next to the card it was used for. Each entry cites the
sentences it rests on. The design page: Director Memory (its system 2 section is superseded by
[world-ontology.md](world-ontology.md) §5).

### Built (2026-11-03)

A1–A3 are in `world-engine/digest/digest.mjs`, run by the director ahead of the play: the scene digest (summary, where,
how it follows, the background, each person's routine, start, end and holdings, the memory for the next scene), then the
windows (moves, facts, items, talk, breaks, background), the memory carried scene to scene. The digest replaces the
pass and the text-only questions (whether someone goes, the talk kind, whether something breaks); Jev decides on the
pictures, with the digest in its state. Items are placed with their holders or where they fall (v1's things on the
page). `--no-digest` plays as before. See [world-ontology.md](world-ontology.md) "One observation, several updates".

### Order of work (Track A)

1. A1, the card digest, for every action and dialogue card of volume 1: one work-model request per card (cents for the
   volume); shown in Why; every Jev question about the card takes it.
2. A2, the scene digest, heading each scene's card digests.
3. A3, memory, updated card by card and scene by scene, feeding both digests.
4. A director run of volume 1 with A1–A3, against `d20261102081221`.

Still open from the first full run: 21 chosen targets never walked (a door fix and the walk's reason are in since, not
yet run); seven scenes with no record (four where spawning placed nobody: 15, 20, 41, 43).
