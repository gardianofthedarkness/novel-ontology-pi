# The building model kit

Which 3D model draws each building of the world: the fill's buildings, the engine's lots and shells, and named buildings.
It was rebuilt on 2026-11-01, before M5 (docs/v2/milestones.md). The user had seen that vol 1's world did not look like a
modern living area.

## 1. What was wrong

- **Industrial halls were market stalls.** An industrial landscape's building, a `hall`, was drawn as `market`. That model
  is four stalls and a cart from Kenney's Fantasy Town Kit, so 129 of the industrial area's buildings were pavilions with
  carts.
- **Houses were offices.** A `house` had no model of its own, so it took `office-c`, a small Kenney office, as a stand-in.
  In vol 1's dwelling areas that was 331 of the 371 low buildings.
- **The city's ground was shops.** A city's `open` ground was the commercial landscape (`config/terrain/city.json`), so
  the ground between its districts was about 1,270 shop blocks. A real city's ground between its centres is mostly
  housing.
- **Three tables picked models, and they disagreed:**
  - `USE_MODELS` and `KIND_MODELS` in `useModels.ts`, for the fill;
  - `SHELLS`, for lots and shells with no model, by role;
  - `ANCIENT_SHELLS` in the export, for ancient ground.

  A shop's role could draw a market stall, and so could anything on ancient ground.

## 2. The models (all CC0 1.0)

| Kit | In the library as | For |
|---|---|---|
| Kenney, City Kit (Suburban) 1.0 | `suburban-01` … `suburban-21` | detached houses, 1–3 floors |
| Kenney, City Kit (Industrial) 2.0 | `industrial-a` … `industrial-t` | factories, warehouses, workshops |
| KayKit, City Builder Bits 1.0 | `kk-block-a` … `kk-block-f` (with `kk-apartment`, `kk-dormitory`, `kk-school`, `kk-mall` from before) | flats, dormitories, shop buildings |
| Quaternius, Downtown City MegaKit (free Standard set) | `brick-small`, `brick-medium`, `brick-large` | named buildings only (see below) |
| Kenney, City Kit (Commercial) 2.1 (from before) | `office-*`, `tower-*`, `skyscraper-*`, `block-wide-*` | offices, towers, shop fronts |

The kits were found on the web and downloaded with the user's go-ahead (2026-11-01). They are unpacked in
`~/claude-world-first/model-packs`, one folder each, and baked into `apps/playground/src/data/architectureModels.json` by:

    node apps/playground/tools/city-kit-models.mjs ~/claude-world-first/model-packs

Like the other bakers, it keeps positions and triangles only. The paid packs the search found, and a free Japanese set
that forbids redistribution, were left out: the repository and its pages are public.

**Weight.** A Kenney house is 150–450 edges and a KayKit block 500–1,600. The Quaternius buildings are 12,000–26,000 each,
so a fill of them would not draw on a phone. They are kept for named buildings, which are few. The library grew from 0.5
to 2.1 MB, most of it the three brick buildings. A page embeds only the models it draws: vol 1's page went from 1.97 to
2.52 MB.

## 3. One table: `config/models.json`

- **`uses`**: for each building use, its models and the floors each can stand for (`[least, most]`).
  - `fill`: for any building of that use.
  - `named`: preferred for a building the story names.
  - A use with no model (a church, a car park, a stadium's hall, a park's pavilion) is drawn as a plain block.
- **`kinds`**: the use of a fill building with no use of its own. An industrial landscape now builds `factory`, no longer
  `hall`; `hall` stays the stadium's.
- **`roles`**: the use of an engine lot or shell with no building model, and of a named building by what it was matched as
  (`school`, `skyscraper`, `home`).
- **`ancient`**: the models of an older world (the keep, the windmill, the market stalls), by kind. Only buildings on
  ancient ground take them, and a test holds that no modern use names one.

## 4. How a building takes its model

`modelFor` and `roleModel` in `src/v2/world/useModels.ts`:

1. **Ancient ground:** the building's kind's old models, one of them by a seed.
2. **Otherwise, its use** (its own, else its kind's, else its role's). Of that use's models:
   - a named building takes its `named` models when one of them holds its floors;
   - else the `fill` models whose floors hold the building's own, or the nearest when none does.
3. **Then proportions:** of those, the models whose height over width is nearest the building's own.
4. **Then a seed:** one of those, chosen by the building's id.

So a two-floor house is a suburban house, and a five-floor block of flats a KayKit block. A thirty-floor block of flats is
a Kenney tower. A factory is one of the industrial kit's ten factories, a warehouse one of its five long sheds.

## 5. The M2 tuning

`open` in `config/terrain/city.json` is now `residential` for a metropolis and a city (a town's already was). A city's
open ground keeps its landscape in `stage/terrain.json` from the run that laid it out (`site.open.ground`), so a book's
world changes only when its city level runs again.

## 6. Seen (vol 1, 2026-11-01)

Rebuilt from a copy of the M4 rerun's state, its city's open ground set to housing as the next city run would set it (no
model call):

- **Open ground:** 1,897 residential buildings: 1,312 houses, 368 blocks of flats, 89 towers.
- **Industrial ground:** 119 of 121 buildings from the industrial kit.
- **Old-world models:** none left on modern ground.

## 7. Not yet

- **Assembled buildings.** The megakit's modular facades (storefronts, windows, cornices, 2 m and 4 m wide) could assemble
  a building to its lot's exact width and floors, rather than scaling a model. They are too heavy for the fill as they
  are; for M5's named buildings, perhaps.
- **The rest of the industrial kit.** Its chimneys, tanks and shipping containers are not baked: yard dressing, with the
  industrial area's yards.
- **Real massing of a Japanese city.** Project PLATEAU (国土交通省; free with credit) has 立川市's LOD2 buildings, each
  tagged by use. The user chose the CC0 kits for now.
