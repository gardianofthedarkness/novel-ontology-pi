# Playground — sector 13 testing frontend

The unified debug/testing UI for novel-ontology-pi: **one graph, many
cameras**. The timeline lanes, a big event's 3D interior, the live
decision stream and the merge-gate queue are all views over the same
ontology graph — the agent knits where it knits, the user's camera is
never stolen, and a shining activity tab guides you to the work.

Design source of truth: `docs/system1/playground-frontend.html` in the
repo root.

## Run it

```bash
cd apps/playground
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

Node ≥ 22. This app is a separate package — the root CLI package and
its CI are unaffected.

## What's real vs. demo in this v1

Real (the actual product skeleton):

- The one-world view model: lanes (canon + branch big events) →
  click a big event → its 3D interior (characters, locations, scenes,
  dialogue, events; single-direction links; chronological layout).
- Ghost states: **proposed** (amber), **held** (slate — visually
  distinct from pending, per Sirui's review), **canon** (solid).
- The merge-gate queue with approve; held proposals stay held.
- The activity tab: shines for knitting elsewhere, gate arrivals and
  holds; click = guided flight to the knitting site.
- The `PlaygroundEvent` contract (`src/types.ts`) and the
  `EventSource` interface — the CLI's future `novel watch`
  (events.jsonl + SSE) plugs in behind the same interface.
- Layout toggle: chronological (authored positions, locked) vs.
  force-directed 3D exploration.

Demo (until live models land):

- `DemoEventSource` replays a scripted session: System 1 knits block
  b0011 into the branch big event 寻回 — 3 ghost nodes + relations,
  a ChangeSet reaching the gate, one proposal held by the main agent.
- The world data (`src/data/demoWorld.ts`) is the dashboard's sample
  scenario, including the two parallel chains inside 归还终端.

## Known v1 limitations

- Reagraph has no per-node opacity/dash, so ghosts are encoded by
  color + sub-label rather than translucency.
- Guided flight uses `fitNodesInView`; cross-view flights switch the
  view then frame the site (no continuous camera path yet).
- Bundle size is Three.js-heavy; code-split when this graduates
  from testing UI to product.

## Next steps (sector 13 roadmap)

1. `SseEventSource` against the CLI's `novel watch` (Sirui's track).
2. Live Theater polish + Gate Queue first (v1 scope per review);
   Explorer and Timeline Lanes grow from the same state after.
3. Cluster-first rendering at whole-novel scale.
