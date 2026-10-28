# Spiral timelines: solved offline, drawn as stored

The story view's strands are laid out once, offline, by `novel calendar
build` (`src/digger/timeplace/spiral.ts`, `src/solidifier/calendar/spiralBuild.ts`)
and stored next to the calendar as `<root>/calendar/<universe>.spiral.json`.
The view only draws that geometry (`apps/playground` reads it through the
feed's `spiral` field): no optimisation runs in the browser.

## Model

- **Time along x.** A scene's x is its story position (strand layer) times
  `dx`; a continuity's books follow each other in reading order. Only the
  transverse position q = (height, depth) is laid out.
- **Strands.** Each strand run (a `continues` chain of the story strands, with
  answered casts) has a constant axis centre c, a coil radius a and a phase φ:
  q(x) = c(x) + a·f(x)·(cos(ωx + φ), sin(ωx + φ)). After a fork c(x) leaves
  the parent's centre, before a merge it joins the target's, both with the
  quintic s(u) = 10u³ − 15u⁴ + 6u⁵ (C²). The coil shrinks to zero at every
  event on a run (its own fork or merge, and wherever another run leaves it
  or joins it), so all tracks of an event meet on one point with matching
  derivatives.
- **Objective.**
  J = mean over pairs |Δx| < S of Φ_A(B) (projected crowding averaged exactly
  over a half-turn, A = 1 − Δx²/S², B = ‖Δq‖²/S²)
  + λ_b Σ (120/7)‖b/R‖²/(ℓ/L₀)³ + λ_ℓ Σ ℓ/L₀ (bending and length of each
  transition) + λ_s · mean over tubes alive together of
  [a + a′ + S − ‖c − c′‖]₊²/S² (unrelated tubes apart).
  Φ_A(B) = A − B/2 for B ≤ A, else ((2A − B)γ + √(A(B − A)))/π with
  γ = arcsin √(A/B); it is C¹ with Φ′ = −½ at B = A.
- **Constraints.** ‖c‖ + a + r ≤ R (every knot in the frame at every rotation),
  a within bounds; both enforced by projection after each step. The knot
  radius r and frame R only normalise the problem so it cannot spread
  without bound; the view draws at its own scale.
- **Transitions.** ℓ* = L₀·[360λ_b‖b̂‖²/(7λ_ℓ)]^¼, clipped and refreshed
  between steps (the closed-form optimum of bending + length).
- **Solver.** Analytic gradients of the crowding term (through centres,
  coils and phases), Adam steps with projection, three fixed starts, best
  kept. Deterministic.

## Measured (2026-10-28)

| Case | Crowding | Knots in a physical overlap | Time |
|---|---|---|---|
| Handout shape (parent → A, B, C; A + B merge), 125 knots | 0.090 → 0.051 (−44%) | 68% → 47% | 0.2 s |
| Four volumes of one universe, 440 scenes, 94 strand runs | 0.132 → 0.094 (−29%) | 66% → 54% | 1 s |

## Pipeline

1. `novel calendar build` builds the calendar, then the spiral (no model
   calls); the result reports strands, scenes, crowding and overlap.
2. The checklist's `calendar` item is `todo` while the spiral is missing or
   older than the calendar.
3. The feed (`tools/pi-review/spiral-view.mjs`) renames scene ids for the view.
4. Story time (3D) draws scenes on the knots, each strand's coil track in its
   colour and its axis as a pale tube; scenes newer than the last build wait
   on a line under it until the next build. Without a stored spiral the view
   lays strands out as before.
