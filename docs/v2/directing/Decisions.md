---
type: "decisions"
aliases: ["Decisions needed"]
tags: ["directing", "decisions"]
---
# Decisions needed

**Where things stand (2026-11-03).** M1–M8 are built, each tried with the stand-in Jev and a work model answering by
rule; the whole volume rehearsed unpaid end to end (`world-engine/director/rehearsal.mjs`, 25 minutes): every scene
played with a cast, no move into a basement, 96 beats scaled, 38 journeys, fights exchange by exchange; camera bounces
(out over 40 m and back within three cards) 5, against W9's 12. Paid so far for M2: 56 Jev requests (block types).
What only a paid run can show: whether Jev, given the wider pictures and the readers' claims, chooses well (8, 14).
The tests: 52 world-engine tests and 790 of 792 TypeScript tests pass (the two: an existing `/var` against
`/private/var` path check, and the faculty flow, fixed since).

What building M2–M8 turned up that is yours to decide. Each says what was found, what was done for now, and the choice.
Newest last. Back to [Directing](Directing.md).

## From M2: block types (2026-11-03)

1. **Interior is the largest share in many action scenes.** Volume 1 narrates thought through its fights: scene 21 reads
   interior 0.38, catastrophe 0.22, traversal 0.21; scene 26 interior 0.39, traversal 0.27, confrontation 0.23; scene
   35 (the flashback) interior 0.77, memory 0.21. *Done for now:* the world is held still only where the damping types
   (interior, exposition, memory) hold 60% or more of a block **and** no action director's own faculty fired there
   (`damped()`); 26% of the volume is held still. *Your call:* keep this rule, or let interior still the world less.
2. **Scene 21 is not a fight to Jev.** Its blocks read the ground splitting (catastrophe), the escape from the flood
   (traversal) and Touma thinking (interior); confrontation 0.01. The combat director still leads its catastrophe beat,
   through choreography. *Your call:* is that right, or should scene 21's opening be a mega-scene beat?

## From M3: the gate (2026-11-03)

3. **Conversation fires on 36% of the volume**, just over the 10–35% aimed for (journeys 10%, ambience 18%, setting 17%,
   feeling 21%, props 23%, choreography 26%). *Your call:* accept, or raise its line (k_on 1.5 → 1.75).
4. **Check five scenes' leads on the strip** ([gate-volume-1.html](gate-volume-1.html), pick a scene): 96 beats; routine
   leads 56, mega-scene 22, combat 18. For example scene 1: routine, then traversal → mega-scene; scene 3: routine, then
   traversal → mega-scene; scene 21: catastrophe → combat, …; scene 26: traversal → mega-scene, then interior → combat;
   scene 42: mediated → routine. The full list: [Gate](Gate.md).
5. **The strip is its own page for now**, not yet in World · Live's Dev panel. *Your call:* move it into the Dev panel
   now, or after W10.

## From M4: the stage manager (2026-11-03)

6. **Four scenes are slivers of the tiling**: 15 (four sentences), 20 (one), 41 (one), 43 (two), nobody named in them.
   *Done for now:* a sliver that carries on keeps the scene before's cast where they stand. *Your call:* keep that, or
   have the reading's tiling merge slivers into their neighbours (a reading change; volume 1 would need its tiling
   redone).
7. **The cast gathers within 80 m of its middle.** Anyone carried in from further walks in (to 300 m) or is placed.
   In scene 40 the rooftop fight spreads its cast about 180 m, so scene 41 moved six of them back together. *Your
   call:* 80 m, or tie it to the scene's scale band once M5's scale faculty gives one.

## From M5: scale and view (2026-11-03)

8. **Real distances need Jev's own answers.** The stand-in proves the pictures, reach and camera follow the zoom (scene
   26's traversal beat: an aerial frame 200 m out over the towers); whether Jev then chooses the far tower is only seen
   in a paid run. *Your call:* a small paid run of scenes 1 and 26 before W10 (about 40–80 Jev calls), or wait for W10.
9. **The scale reader is one request a beat** (96 beats in volume 1, cheap on the work model), asked as each scene
   begins, so a run waits a few seconds a scene. *Your call:* fine, or fold it into the scene digest's request.

## From M6: journeys (2026-11-03)

10. **Leaps and flights go straight through the air** where the walk graph has no way (it has no air edges; tower to
    tower in scene 26 is none). The move is marked airborne, and L12 checks the person has the ability. *Your call:*
    a straight glide is enough for now, or build arcs in the air (a sky graph) before W10.
11. **The landmark map offers the twelve tallest buildings within the journey's reach.** A low destination (a
    station entrance, a bridge) can only be picked as "none", which falls back to the arrows. *Your call:* keep the
    tallest, or mix in named places and street features (bridges, stations) once the place tree has them in the world.

## From M7: the combat director (2026-11-03)

12. **Jev is asked about an exchange only where the reader is under 0.6 sure** (its kind, shape and outcome on one
    picture). *Your call:* that line, or ask Jev on every exchange of a fight (more calls, Jev deciding on the picture
    every time).
13. **Conditions are recorded and held**, not written: a fight's "hurt", "unconscious", "bound" go into the world log
    and the ledger as held proposals, for the review; canon writes them to `conditionsAdd` in M11. *Your call:* hold
    them all, or let canon apply the sure ones (0.8 and over) without review.

## From M8: the routine director (2026-11-03)

14. **L6 can only be counted on a real run.** The talk law reads the run's page, which a stand-in run does not write.
    W9's 85 came mostly from the background's drift carrying people out of earshot mid-talk; those talking or in a
    formation now hold their places, and a talk known to be remote no longer breaks it. *Your call:* count it in W10, or
    a small paid run of scenes 11–17 first (the crosswalk, the phone call, the dart bar).
15. **Formations are placed by rule round the group's middle**, not asked of Jev (the proposed room-plan question is not
    built). *Your call:* enough for W10, or build the formation question on a room plan for the dart bar's kind of scene.

## From the rehearsal (2026-11-03)

16. **Six camera jumps happen within a beat with no long move:** someone far joins the group on screen (a talk pulls
    the addressee 150 m to the speaker in scene 3; a stated "indoors" fact moves someone). *Your call:* frame only the
    beat's first group until its members arrive, or keep framing everyone taking part.
17. **The background's routine moves most:** 1,317 of 2,194 moves in the rehearsal are routine drift (the rule-made
    digest has everyone walking or standing). The real digest decides who walks, so W10 will differ; it is the knob for
    how busy scenes look. *Your call:* keep the drift spans (strolling 2–4 m, walking 3–6 m a card), or calm them.

## Your answers (2026-11-03)

- **1 · Faculties co-fire.** "Multiple faculties are allowed to fire at the same time if evidence sufficient." No type
  holds the world still any more; thought fires the inner-state faculty beside whatever else the evidence fires.
- **2 · Smoothing per strand.** "Because our data is simply back tested, we don't need to predict the future. You can
  do smoothing on type distribution confidence scores per strand." The block types are smoothed forward and backward
  along each strand (not decoded scene by scene); the beats and the mixed index read the smoothed distributions.
- **7 · No hard-coded distance.** "Any sort of problem should be inferred by laws of physics. Propose a new physics if
  there's issues that can't be solved." The 80 m gathering and the 300 m walk-in go: presence in a scene is its frame
  (L16), and whether someone walks in is the travel time the story allows (L5, L17). New laws proposed in
  [physics-laws.md](../physics-laws.md) §9.
- **8 · Referential distance.** "Proportional or referential semantic distance description dynamically adjusted might
  work better" than metres in semantic space. The scale reader now says a referent (the room, the street, the
  building, a landmark…) and how many of it; the director measures that referent in the world.
- **10 · Yes, and tunnelling.** "When positioning during when destruction happens, later ground truth Bayesian smooth
  both path and both state of destruction. The destruction of building is also quantum and back propagatable."
  Proposed as L18 (designed; built after W10's paths).
- **11 · A controlled test of Jev's picking.** Baked-in vectors, semantic descriptions, or small thumbnail references:
  which makes Jev pick more precisely. Run on cases with a known answer.
- **16 · The city is part of back-propagation.** "Terrain can be dynamically redrawn if cost of travel time is
  impossible and review of ability groups suggest low energy level of supporting such move." Proposed as L19 (designed).

Not answered yet: 3, 4, 5, 6, 9, 12–15, 17.
