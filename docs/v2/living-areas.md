# Living areas: an East Asian megacity

The user's call (2026-11-01): the novel happens in a future East Asia, so its living areas are shaped like a modern East
Asian megacity's. Other regions' living areas (a European city, an American suburb) are an option for later, chosen per
universe like the other configurations (milestones M8).

## 1. What the research says

| City | What it says about living areas | Source |
|---|---|---|
| Tokyo | 71.6% of its 7.24 million homes are in apartment buildings (44.9% for Japan); detached houses 26.3%, down from 38.8% in 1978; 1.10 million homes in buildings of 11 floors or more | Housing and Land Survey 2023, via [housingjapan.com](https://housingjapan.com/blog/tokyo-property-ladder/) |
| Japan's zoning | Floor area ratio 50–200% in low-rise residential zones, 100–500% in mid/high-rise and general residential zones; building coverage 30–80% | [realestate-tokyo.com](https://www.realestate-tokyo.com/news/floor-area-ratio-and-building-coverage-ratio) |
| Seoul | Floor area ratio 250–300% where apartments may be built; a 35-floor limit, now up to 50 in reconstruction; most blocks built until the 1980s are 5 floors | [Asia Economy](https://www.asiae.co.kr/en/article/2020080411140748497), [Seoul Museum of Art](https://sema.seoul.go.kr/semaaa/data/upload/attach/10000/17605/20190403111448684.pdf) |
| Chinese cities | New housing has moved from low-rise to mid-rise and then to high-rise compounds; floor area ratio 3–4 in current practice | [Frontiers](https://www.frontiersin.org/articles/10.3389/frsc.2021.687895/full), [Greenwich](https://gala.gre.ac.uk/id/eprint/41714/7/41714-DAWODU-Towards-a-Sustainable-Energy-Planning-Strategy-The-Utilisation-of-Floor-Area-Ratio-for-Residential-Community-Planning-and-Design-in-China.pdf) |
| Shanghai | 49,492 buildings of 24–100 m and 930 over 100 m (2017 census) | [China Daily](https://govt.chinadaily.com.cn/s/201710/31/WS5b77fef5498e855160e8a88f/shanghai-has-nearly-1-000-skyscrapers-census.html) |
| Hong Kong | About 27,000 people per km²; Kwun Tong about 52,000; most homes in towers of 40 floors or more | [Development Bureau](https://www.devb.gov.hk/en/home/Blog_Archives1/index_id_149.html), [Yearbook](https://www.yearbook.gov.hk/2005/en/fact_01.htm) |

The search found no single citywide average of floors for Seoul or Shanghai. China's residential standard (GB 50180-2018)
has its tables only in the standard's own text.

## 2. What that makes a living area

- **Mostly flats.** Most homes are in apartment buildings. Detached houses are kept, but between the blocks, not as the
  ground's main building.
- **A floor area ratio of about 2.5–4.** Mid-rise blocks on most of the ground, with a tail of residential towers of 15–35
  floors. That is between Tokyo's and Seoul's or a Chinese compound's. Hong Kong's 40-floor estates are the far end.
- **A city's ground between its centres is housing** (the model kit's M2 tuning, [model-kit.md](model-kit.md) §5).

## 3. What changed

- **Heights**, in `TERRAIN_KINDS` in `src/v2/context/terrainModes.ts`. Jev picks a median from these; the least is the hard
  gate.

  | Kind | Medians before (m) | Now (m) | Manifold before → now (spread, tail) |
  |---|---|---|---|
  | metropolis (a city) | 6–60 | 12, 18, 25, 35, 50, 70 | unchanged |
  | city (a city) | 6–25 | 9, 12, 18, 25, 35 | unchanged |
  | dwelling (a district) | 8–50 | 12, 18, 25, 35, 50, 70 | 0.25, 0.02 → 0.4, 0.06: wider, with residential towers |
  | residential (a street) | 6–25 | 9, 12, 18, 25, 35, 50 | 0.25, 0.02 → 0.35, 0.05 |

- **Ground**, in `LANDSCAPES` in `src/v2/world/landscape.ts`:
  - a living area's lots are 400–1,200 m² (blocks of flats), up from 250–700;
  - a building of four floors or more is flats, down from five;
  - a residential street's buildings likewise.
- **Models.** A use none of whose models comes within a floor of the building yields to the building's kind. A "house"
  the street's list gave a ten-floor building is drawn as flats ([model-kit.md](model-kit.md) §4).

## 4. Seen (vol 1, 2026-11-01)

Rebuilt from a copy of the M4 rerun's state, with no model call. The copy's stored heights were raised to the new least
medians, as the hard gate would raise an answer below them. Jev's own answers above them stand (第七学区's median of
18 m).

| Living area (the city's residential ground) | Before | Now |
|---|---|---|
| Buildings | 1,897 | 1,843 |
| Floors: median (middle half; one in ten above) | 3 (2–5; 7) | 4 (3–7; 12) |
| Detached houses | 69% | 32% |
| Buildings of 10 floors or more | 115 | 312 |

The page stayed at 2.52 MB. The book's own world changes when its city and district levels run again with Jev.
