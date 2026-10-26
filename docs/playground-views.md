# Playground views: two modes, three views

The viewer has two **modes** and the same three **views** in each:

| View | Orbital (3D) | Traditional (flat, no WebGL) |
| --- | --- | --- |
| **Narrative** — reading order | The orbit: chapter spheres on a string, scenes inside, entities around | Chapters → scenes → events and dialogue as lists |
| **Story time** — when it happens | Story-time list (orbital version planned) | Story-time list |
| **Places** — where it happens | Schematic map (orbital version planned) | Schematic map |

- The switch reads `Orbital | Traditional` and `Narrative | Story time |
  Places`. Deep links: `?mode=traditional` and `?view=story` or
  `?view=places` (the defaults, Orbital and Narrative, need no parameter).
- Both modes share the inspector, record stepping, book choice and live
  updates. A record open in the inspector stays open when the mode changes.
- **Following Pi** works in both Narrative views: the orbit flies to the
  work; the flat list opens the chapter and scene Pi touched and marks them.
- The Traditional Narrative list shows each chapter's gist (its most
  connected scene summary), counts, cast, and live and review states.
  Each scene carries its story time and place when the time-place faculty
  has run. Proposals and held records appear in place with their state.
  Records no scene covers yet are listed under the chapter.

The retired classic WebGL card view is gone; its camera framing helpers live
on in `components/graphCamera.ts` for the orbit.
