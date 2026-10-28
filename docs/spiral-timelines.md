# Spiral timelines: solved offline, drawn as stored

The story view's strands are laid out once, offline, by `novel calendar
build` (`src/digger/timeplace/spiral.ts`, `src/solidifier/calendar/spiralBuild.ts`)
and stored next to the calendar as `<root>/calendar/<universe>.spiral.json`.
The view only draws that geometry (`apps/playground` reads it through the
feed's `spiral` field): no optimisation runs in the browser.

The layout takes the good of both earlier views. Like the stacked coils,
strands sit far enough apart to read and their scenes spread around big
coils. Like the first spiral, positions are solved per period (a strand only
competes with strands alive at the same time, and its space is reused once it
ends), and forks and merges are smooth. Strands spread over the floor before
they stack up.

## Model

- **Time along x.** A scene's x is its story position; a continuity's books
  follow each other in reading order. A step between story layers widens by
  half a layer for every extra strand alive there
  (dx·(1 + ½(n − 1))), so busy stretches get room and quiet ones stay
  compact. Only the transverse position q = (height y, depth z) is laid out.
- **Strands.** Each strand run (a `continues` chain of the story strands, with
  answered casts) has a constant axis centre c, one coil radius a shared by
  every run, and a phase φ:
  q(x) = c(x) + a·f(x)·(cos θ(x), sin θ(x)). After a fork c(x) leaves
  the parent's centre, before a merge it joins the target's, both with the
  quintic s(u) = 10u³ − 15u⁴ + 6u⁵ (C²). The coil shrinks to zero at every
  event on a run (its own fork or merge, and wherever another run leaves it
  or joins it), so all tracks of an event meet on one point with matching
  derivatives.
- **The coil winds with its scenes.** The winding follows the strand's own
  scenes, not time: θ(x) = φ + Δθ·Σ_k s((x − x_k)/h + ½), one step Δθ (a
  tenth of a turn) per scene, eased over a window h of two layers around it.
  A dense strand winds tightly; between far-apart scenes the coil runs
  straight, so a strand with almost no scenes is almost a straight line.
- **Objective.**
  J = mean over pairs |Δx| < S of Φ_A(B) (projected crowding averaged exactly
  over a half-turn, A = 1 − Δx²/S², B = ‖Δq‖²/S²)
  + λ_b Σ (120/7)‖b/D‖²/(ℓ/L₀)³ + λ_ℓ Σ ℓ/L₀ (bending and length of each
  transition)
  + λ_s Σ over tubes alive together of [a + a′ + S + G − ‖c − c′‖]₊²/D²
  (strands apart, with a clearance G, every pair in full)
  + λ_y Σ (n/N)·y/H + λ_z Σ (n/N)·(z/W)² (strands with many scenes sit low
  and central, so the floor fills before strands stack up).
  Φ_A(B) = A − B/2 for B ≤ A, else ((2A − B)γ + √(A(B − A)))/π with
  γ = arcsin √(A/B); it is C¹ with Φ′ = −½ at B = A.
- **Constraints.** A box on the floor: a + r ≤ y ≤ H − a − r and
  |z| ≤ W/2 − a − r, three times as wide as tall, sized so the most strands
  alive at once fit side by side (W·H ≥ n·D²). Enforced by projection after
  each step.
- **Transitions.** ℓ* = L₀·[360λ_b‖b/D‖²/(7λ_ℓ)]^¼, clipped and refreshed
  between steps (the closed-form optimum of bending + length).
- **Solver.** Analytic gradients of the crowding term (through centres and
  phases), Adam steps with projection; each knot's winding is computed once. Three fixed starts: a packed grid
  (busiest strands first, each in the lowest, most central free slot), its
  mirror, and a sunflower; best kept. Deterministic.

## Drawing

One uniform scale across and along (a quiet story layer is one step), so the
view is exactly the solved shape. The camera looks down on the floor. Every
coil is drawn in the design's cyan and every tube dim and neutral; colour is
kept for each strand's axis, its skeleton, drawn as a thin tube. A tap within
16 px of an axis lights that strand's scenes for the calendar day tapped
(the whole strand where that stretch has no date) and fades the other
strands; a chip names what is lit, and × or a tap elsewhere shows every
strand again.

A lit strand also shows its cast (`strandCast`): the events and dialogues
inside its lit scenes that someone takes part in (`PARTICIPATES_IN`, or a
dialogue's participants and speaker), as small records in a ring inside each
scene, nearest the tap first, at most 120. Their characters, at most 24 (the
ones in most records), move from wherever the universe view had them to two
staggered rows just above and behind the lit stretch, each over the middle of
the records it is in and spread so none overlap; one not drawn yet joins
there. Each character is joined to each of its records by a dim arc with no
head, routed the way the causal arcs are: bent outward from the time axis,
and a character's arcs placed in lanes by how far apart their ends lie along
time (interval colouring, shortest lowest) so overlapping arcs do not run
together. The camera flies to the lit stretch and its cast, and the lit
characters' names take precedence over scene labels. A book,
or the view as it opens, shows a stretch of time from its first scene about
as long as the floor box is deep, longer on a wide screen: the whole book
across a phone would squeeze the cross-section to a thread. A chosen calendar
day frames that day's scenes.

## Measured (2026-10-28)

| Case | Crowding | Scenes overlapping another strand's | Time |
|---|---|---|---|
| Four volumes of one universe, 440 scenes, 94 strand runs | 0.133 → 0.100 (−25%) | 23% → 10% | 1 s |

Overlap is averaged over every viewing angle around the time axis. Every
pair of strands that runs side by side for more than a few layers keeps its
spacing.

## Pipeline

1. `novel calendar build` builds the calendar, then the spiral (no model
   calls); the result reports strands, scenes, crowding and overlap.
2. The checklist's `calendar` item is `todo` while the spiral is missing,
   older than the calendar, or from an older layout version.
3. The feed (`tools/pi-review/spiral-view.mjs`) renames scene ids for the view
   and passes the floor box.
4. Story time (3D) draws scenes on the knots, cyan coils, coloured axes and
   dim tubes; scenes newer than the last build wait
   on a line under it until the next build. Without a stored spiral the view
   lays strands out as before.
