# The world engine, redesigned (2026-11-02)

The user, after the director's first streamed runs: "nothing worked out"; positions reset between scenes that tell one
story, unnamed people vanished, the camera lost people moving between places, and Jev was suspiciously fast. What the
runs did, measured: 164 real calls in thirteen scenes, 44 with a picture (only for the 10 people who moved); moves were
computed off-screen and people set at their ends before the next picture (never played); no destruction at all. Four
points, agreed with the user:

## 1. One world state, through the whole story

- Everyone's position is always known, and a scene never resets it.
- **Spawning only once:** the first time someone appears in the story (spawning's rules and spot question,
  [spawning.md](spawning.md)); never again after.
- **A scene somewhere else:** a person present who stands outside the scene's place travels there in the world: from
  where they are to where spawning would start them in it (its start is the destination, not a teleport), walked on the
  path integral; too far to walk in the explored world, they arrive off-page (said so).
- Someone not present stays where they were.

## 2. Render, then ask

The page Jev is shown is the world as played: every card's changes (moves, damage) are added to the page's timeline and
played there, and the next picture is taken of the timeline at that moment (the people where their walks ended, the
buildings as broken), not of positions set beside it. One page instance for the run; a reload only when the world has
grown. A step costs its render and Jev's answer; the run's log says both.

## 3. Destruction in the loop

An action card that may break something is asked as the impact choice already is (`world-engine/world/impact-choices.mjs`:
where it hits, on spheres; how big), the hit applied to the world, and played before the next card.

## 4. What the user watches is what Jev sees

World · Live plays the same timeline as it grows (each new piece played from where the last ended), with the producer's
camera to follow and the viewer's free; the old stage page's pace and path-integral traces.

## Order of building

1. The world state (`world-engine/director/director.mjs`): spawn once, carry on, travel to a scene elsewhere.
2. The timeline grown in place (`strand-demo.html` `extend`), pictures taken of it.
3. Destruction in the loop.
4. The live view on the growing timeline.
