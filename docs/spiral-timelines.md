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
  answered casts) has a constant axis centre c, a coil radius a and a phase φ:
  q(x) = c(x) + a·f(x)·(cos(ωx + φ), sin(ωx + φ)). After a fork c(x) leaves
  the parent's centre, before a merge it joins the target's, both with the
  quintic s(u) = 10u³ − 15u⁴ + 6u⁵ (C²). The coil shrinks to zero at every
  event on a run (its own fork or merge, and wherever another run leaves it
  or joins it), so all tracks of an event meet on one point with matching
  derivatives.
- **Importance is thickness.** The coil radius is fixed by how dense a
  strand's scenes are, not optimised: ρ = scenes / max(layers spanned, one
  turn) and a = a_min + (a_max − a_min)·ρ/max ρ. The densest strand gets the
  thickest cylinder; a lone side scene or a strand that appears now and then
  stays thin.
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
  phases), Adam steps with projection. Three fixed starts: a packed grid
  (busiest strands first, each in the lowest, most central free slot), its
  mirror, and a sunflower; best kept. Deterministic.

## Drawing

One uniform scale across and along (a quiet story layer is one step), so the
view is exactly the solved shape. The camera looks down on the floor. A book,
or the view as it opens, shows a stretch of time from its first scene about
as long as the floor box is deep, longer on a wide screen: the whole book
across a phone would squeeze the cross-section to a thread. A chosen calendar
day frames that day's scenes.

## Measured (2026-10-28)

| Case | Crowding | Scenes overlapping another strand's | Time |
|---|---|---|---|
| Handout shape (parent → A, B, C; A + B merge), 125 knots | 0.111 → 0.101 | 37% → 33% | 0.1 s |
| Four volumes of one universe, 440 scenes, 94 strand runs | 0.109 → 0.072 (−34%) | 24% → 11% | 1 s |

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
4. Story time (3D) draws scenes on the knots, each strand's coil track in its
   colour and its axis as a pale tube; scenes newer than the last build wait
   on a line under it until the next build. Without a stored spiral the view
   lays strands out as before.
