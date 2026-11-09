# Highways: how they are modelled, and what our terrain takes from it (research, 2026-11-08)

The user, 2026-11-08: *"Next let's work on the transportation system. I want you to research how mathematicians model
highway generation in modern city, and how can our terrain system utilize those findings."*

This is research and a proposal; nothing here is built. It refines stage 2 (highways) of
[roads-and-transit.md](roads-and-transit.md), and touches stage 1 (road classes), stage 3 (the subway) and stage 4
(traffic). The numbers about our own city were measured with `experiments/v2/arterial-corridors.mjs`.

## 0. The short answer

Every model of highway generation answers four questions, and each has its own maths:

| Question | The maths | What our terrain takes |
| --- | --- | --- |
| **Demand:** who needs to go where? | The gravity model: trips between two places grow with their masses and fall with distance. Drivers settle into Wardrop's equilibrium. | Masses from what we already have: the density field, the districts on the map and the story's own trips. |
| **Topology:** which places get a highway link? | Cost-benefit growth (Louf, Jensen, Barthelemy 2013): each new place joins where the gravity benefit beats the cost of building. The optimal-network trade-off (Gastner, Newman 2006): total length against detour. | A tree that grows place by place, then loops added where detours are worst. Growth only adds, which fits our rule that growth keeps what was there. |
| **Alignment:** where exactly does it run? | Least-cost paths with an anisotropic cost (Galin et al. 2010, 2011): ∫ c(p, ṗ, p̈) dt over slope, water, land and curvature. Tokyo's practice is to run over rivers and existing streets, because buying land is the bottleneck. | The same action form as our path integral, with a curvature term and our own costs: riding over an arterial is cheap, taking lots costs by density, a named place is never taken. |
| **Geometry:** curves, grades, ramps, junctions | Design standards: minimum radius by design speed, maximum grades, ramp grades, interchange spacing. | Smoothing to a radius, not a new rule. A deck about 10 m up with ramps of 110 to 170 m. |

**One measured finding decides the shape of the design.** The city fill's arterials (§2) turn 45° at the median junction, every junction is three-way, and the segments are about 115 m long. That suits two kinds of expressway, and the alignment cost chooses between them:

- **Over the streets.** A slow, Shuto-style deck at 40 to 50 km/h can ride over our arterials: its curves stay over the road at 54 to 85% of the turns. That is Tokyo's own answer for a dense core.
- **On its own corridor.** A 60 to 80 km/h expressway stays over the road at only 8 to 31% of the turns. It needs its own straighter corridor, which the fill then builds around: an avenue under the deck, blocks clipped to it. That is what cities do toward the edge and out of town.

## 1. What the literature says

### 1.1 Demand: the gravity model and equilibrium

**Gravity.** Trips between places i and j are T_ij = k · M_i · M_j / d_ij^a, with a > 1. M is a mass (population, jobs, attraction) and d is distance. This is the "distribution" step of transport planning's classic four-step model:
1. trip generation;
2. distribution;
3. mode choice (car, rail, walk);
4. assignment to routes.

**Wardrop's user equilibrium.** Assignment usually puts traffic where no driver can save time by switching route: every used route between a pair is equally fast, and no unused one is faster. Beckmann showed this is the solution of a convex programme, so it is cheap to compute.

**For us:**
- **Masses:** the density field (`densityAt`, cityFill.ts), the districts and landscapes on the map, and the story's trips between places (the travel record that already weights the place layout).
- **Assignment:** gives each road a flow. Flows decide road classes (§3.2) and, later, traffic (stage 4).

### 1.2 Topology: which places get a link

**Cost-benefit growth** ([Louf, Jensen, Barthelemy, PNAS 2013](https://arxiv.org/abs/1305.3282)).
- **The value of a link:** benefit minus cost, with the gravity traffic as the benefit: R'_ij = k · M_i · M_j / d_ij^(a−1) − β · d_ij. Here β is the building and upkeep cost per length relative to the benefit per traveller and length.
- **Growth:** places join one at a time. Each new place links to the existing node that maximises R'.
- **One parameter sets the shape:**
  - β much smaller than the natural scale β* (about the average traffic) gives a star around the biggest place.
  - β much larger gives the minimum spanning tree.
  - β ≈ β* gives a **hierarchy of hubs**, each serving its own area, with the smallest average detour.
- **Real railways sit in that middle regime.** β/β* is 0.20 for France, 0.32 Germany, 0.31 India, 0.53 Italy, 0.66 Switzerland, 1.19 UK, 1.26 Spain and 1.56 USA.
- **Why it fits us:** it is deterministic given the order places arrive, and it only adds.

**Length against detour** ([Gastner, Newman, J. Stat. Mech. 2006](https://arxiv.org/abs/cond-mat/0409702)).
- **Two goals pull apart:** short total length, and a small *route factor* (network distance over straight distance).
- **The extremes:** the minimum spanning tree is shortest but makes long detours; the star has no detour but is long.
- **Real networks:** distribution networks are close to optimal on both, with route factors from about 1.13 (a gas network) to 1.59 (a sewer system).
- **For us:** this gives the rule for adding loops to the tree, and a check.

**The network design problem** ([Yang, Bell, Transport Reviews 1998](https://doi.org/10.1080/01441649808717016)).
- **Formulation:** a bilevel programme. The planner chooses links and lanes; the drivers settle in Wardrop equilibrium on what was built.
- **Why we don't run it:**
  - It is among the hardest problems in transport.
  - It has Braess's paradox, where a new road can make everyone slower.
  - It is too heavy to run per city.
- **What we keep:** its check. A highway we add must not raise the total travel time of the gravity demand.

**Slime mould networks** ([Tero et al., Science 2010](https://pubmed.ncbi.nlm.nih.gov/20093467/); model in [Tero, Kobayashi, Nakagaki, J. Theor. Biol. 2007](https://eprints.lib.hokudai.ac.jp/dspace/handle/2115/28041)).
- **The model:** tubes with conductance D carry flow Q by Kirchhoff's laws, and each tube adapts as dD/dt = f(|Q|) − r·D. Busy tubes thicken; idle ones vanish.
- **The result:** with food at the cities around Tokyo, the networks came out comparable to Tokyo's rail system in cost, efficiency and fault tolerance.
- **For us:** it is a global iterative solve, so every new place changes everything. That breaks bounded repair. It is worth keeping as an offline check, or for the rail mesh.

**L-systems with global goals** ([Parish, Müller, SIGGRAPH 2001](https://history.siggraph.org/?p=116923)).
- **The idea:** highways grow toward population, by sampling directions and taking the one leading to the most people; streets fill in after, under local constraints (water, parks, crossings).
- **Its place:** the root of procedural cities.
- **For us:** it is rule-heavy and order-dependent, against our "smoothing before rules".

**Traffic-driven growth** ([Beneš, Wilkie, Křivánek, CGF 2014](https://cgg.mff.cuni.cz/~jaroslav/papers/2014-cities/)).
- **The idea:** a simple traffic simulation between neighbouring settlements decides where major roads appear and how minor roads grow.
- **Cities:** they come from settlements merging.
- **The lesson for us:** traffic decides the class of a road.

**Empirical laws of real road networks:**
- **[Strano et al., Sci. Rep. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3291042)** studied 200 years of roads north of Milan. Growth comes from *densification* around centres and *exploration* at the front. The high-centrality roads are a stable backbone: history's paths last.
- **[Kirkley et al., Nat. Commun. 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6021391)** studied 97 cities. Betweenness centrality has nearly the same distribution in all of them: the high-betweenness roads form a tree-like backbone, and the low ones sit in loops that give local alternatives.
- **[Barthélemy, Flammini, PRL 2008](https://arxiv.org/abs/0708.4360):** a local optimisation alone reproduces street patterns. New centres join the network by the shortest road.
- **For us:** the trunk roads can be *found* in the street net we have, by flow or betweenness, instead of being drawn by a rule.

### 1.3 Alignment: where the line runs

**Procedural roads** ([Galin, Peytavie, Maréchal, Guérin, CGF 2010](https://diglib.eg.org/items/0aba12a9-bdbc-43a2-982c-5d1a9a43a2ba)).
- **A road is the path ρ minimising C(ρ) = ∫ c(p(t), ṗ(t), p̈(t)) dt.** The cost depends on the position, the heading and the curvature.
- **The cost is a sum of transfer functions,** c = Σ μ_i ∘ κ_i, over characteristics: terrain slope along the heading, water depth, vegetation density and the path's curvature. Each transfer function rises to infinity past a threshold, so a road can't climb a slope too steep or bend too tightly.
- **Solved by A\*** on a grid where each point links to every point within a radius, not just 8 neighbours, so directions are not limited to 45° steps.
- **Bridges and tunnels** have cost functions of their own: height and water depth for a bridge, depth and length for a tunnel.

**Hierarchical networks** ([Galin, Peytavie, Guérin, Beneš, CGF 2011](https://diglib.eg.org/items/33f74b9d-6792-4d51-8c32-c1d6c1824ea0)).
- **Linking:** settlements are linked by a sparse graph built with the same non-Euclidean (cost) metric.
- **Merging:** paths merge where they run close, which makes the junctions.
- **Order:** highways first, then primary and secondary roads.
- **Instancing:** interchanges and intersections are made from parameterised models.

**3D alignment optimisation** ([Jong, Schonfeld, Transp. Res. B 2003](https://econpapers.repec.org/RePEc:eee:transb:v:37:y:2003:i:2:p:107-128)).
- **Engineers' version:** the alignment is a chain of 3D intersection points, evolved by a genetic algorithm.
- **The cost:** earthwork, right-of-way (land), structures and users' travel costs.

**Tensor fields** ([Chen, Esch, Wonka, Müller, Zhang, SIGGRAPH 2008](https://sci.utah.edu/~chengu/street_sig08/street_project.htm)).
- **The idea:** street graphs are traced along a field of preferred directions, either grid-like or radial around a centre.
- **For us:** better for the fill's street patterns than for highways.

**Tokyo's practice.**
- **Land was the bottleneck.** The first Shuto Expressway routes were built for the 1964 Olympics over rivers, canals and existing streets, because buying land would have taken too long ([Japan Times](https://www.japantimes.co.jp/news/2014/02/26/national/nihonbashi-highway-is-urged-to-go-under), [Goethe-Institut](https://www.goethe.de/prj/zei/en/art/25664880.html)).
- **Low design speeds came with it.** Urban expressways have much lower design speeds than national ones, because they run as viaducts or tunnels along existing arterials. The Inner Circular Route is posted at 50 km/h, most Shuto routes at 60 and the Bayshore Route at 80 ([Shuto Expressway](https://en.wikipedia.org/wiki/Shuto_Expressway)).
- **The region's plan (1963):** three rings and nine radials. The rings are the Central Circular Route (about 47 km), the Gaikan (about 15 km from the centre) and the Ken-O (40 to 60 km out) ([Tokyo Gaikan Expressway](https://en.wikipedia.org/wiki/Tokyo_Gaikan_Expressway)).
- **The lesson:** in a dense city, the cheapest corridor is public space that already exists.

### 1.4 Geometry: the numbers a deck must meet

From Japan's Road Structure Ordinance ([MLIT](https://www.mlit.go.jp/road/road_e/r1_standard_2.html)):

- **Design speed:** a Type 2 road (an urban expressway) is designed for 80 or 60 km/h, or 60, 50 or 40 km/h where unavoidable.
- **Minimum curve radius (art. 15, standard / where unavoidable):**

  | Design speed | 120 km/h | 100 | 80 | 60 | 50 | 40 | 30 | 20 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Radius | 710 / 570 m | 460 / 380 | 280 / 230 | 150 / 120 | 100 / 80 | 60 / 50 | 30 | 15 |

- **Vertical curves (art. 22, [MLIT](https://www.mlit.go.jp/road/road_e/r1_standard_3.html)):** at 80 km/h, crest 3,000 m, sag 2,000 m and at least 70 m long. At 60 km/h, 1,400 m, 1,000 m and 50 m.
- **Ramps:** a 30 km/h ramp takes at most 9% grade (10% absolute), with a radius of at least 30 m (20 m absolute) ([JICA report on the Japanese ordinance](https://openjicareport.jica.go.jp/pdf/12304598_02.pdf)).
- **Interchange spacing:**
  - US practice keeps urban interchanges at least a mile (1.6 km) apart, crossroad to crossroad, closer only with collector-distributor roads ([WSDOT design manual](https://wsdot.Wa.Gov/publications/manuals/fulltext/M22-01/1360.pdf)).
  - Newer guidance looks at the spacing between ramps rather than between interchanges.
  - Shuto ramps are much denser than that.

### 1.5 Rail and subway

- **Core and branches** ([Roth, Kang, Batty, Barthelemy, J. R. Soc. Interface 2012](https://arxiv.org/abs/1105.5294v3)). The world's large subways converge to the same shape: a core and branches.
  - In the core, a station links to about 2.5 others on average, and over 60% are plain through stations (degree 2).
  - Coverage of the paper says about half the stations sit on the branches, and the farthest terminus lies about twice the core's diameter from the centre.
- **The slime mould model** (§1.2) was matched against Tokyo's *rail*, which suits a line network with loops for fault tolerance.

### 1.6 Learned generators

Diffusion and transformer models now generate road graphs, for example [GraphWalker, IJCAI 2025](https://www.ijcai.org/proceedings/2025/702).
- **What they need:** large training data.
- **What they give:** a sample that looks right, not a pure function of a seed that one chunk can build on its own.
- **For us:** not now. They may later be useful to judge whether a generated network looks like a real city's.

## 2. Our terrain, measured: what the fill gives a highway

`experiments/v2/arterial-corridors.mjs`, the plain fill born with a radius of 1,101 m. That is Academy City's circle on library 16's map, about 2.2 km across. The measure ran on four seeds; the ranges cover all four.

- **The arterials.** They are the edges of 180 m Voronoi cells:
  - 382 to 400 segments, 42.6 to 43.4 km of road inside the circle (about 11 km per km²);
  - a median segment of 111 to 121 m;
  - **every junction three-way.**
- **The straightest way on.** At a junction, the straightest way on turns:

  | p10 | p25 | Median | p75 | p90 |
  | --- | --- | --- | --- | --- |
  | 26 to 31° | 35 to 37° | **44 to 46°** | 53 to 56° | 61 to 63° |

  There is no straight arterial in the city.
- **The detour along arterials,** between junctions 0.8 to 2 km apart: median 1.20, p90 1.25 to 1.27. That is a normal street network's detour, so a deck that follows arterials is about 20% longer than a straight line.
- **Can a curve stay over an 18 m road?** At a turn of t, a curve of radius R leaves the centre line by E = R(sec(t/2) − 1). The table checks E ≤ 9 m:

  | Design speed | Radius | Stays over the road up to | Share of the straightest turns | Tangent at a 45° turn |
  | --- | --- | --- | --- | --- |
  | 40 km/h | 60 m | 59° | 83 to 86% | 25 m each way |
  | 50 km/h | 100 m | 47° | 53 to 59% | 41 m |
  | 60 km/h, unavoidable | 120 m | 43° | 41 to 47% | 50 m |
  | 60 km/h | 150 m | 39° | 28 to 34% | 62 m |
  | 80 km/h | 280 m | 29° | 7 to 12% | 116 m |

  At 80 km/h, two curves need 232 m at a median turn, but a segment is about 115 m long. So the curves would overlap, and the deck can't follow the zigzag at all.
- **The map.** Six districts lie directly under Academy City (radii 183 to 519 m) in the first quarter's rehearsal map. The whole city is smaller than Tokyo's innermost Shuto ring.

**What this means:**
1. **Our arterials can carry a Shuto-style deck,** at 40 to 50 km/h. That is the speed Tokyo's own inner expressway runs at, and for the same reason: it rides the streets.
2. **A faster expressway needs a corridor of its own,** straighter than any arterial. The fill then has to build around it, the way a street landscape's axis road already clips the blocks.
3. **The arterials are one flat class at 180 m spacing.** There are no trunk roads. Flows (§3.2) should pick them.

## 3. The proposal: highways in our terrain

The design keeps the rules of [roads-and-transit.md](roads-and-transit.md) §1:
- the city model is authoritative and the graphs are derived;
- same seed, same city;
- bounded repair;
- grade separation by layer;
- casts say what a city has, and physics routes.

### 3.1 Hubs and masses

- **Hubs:**
  - the city's districts on the map;
  - the landscapes that draw people (a station front, a centre, a square);
  - one **gate** on the city's edge toward each neighbouring city or region of the map, where through traffic enters.
- **Mass of a hub:** the population of its circle (the density field integrated over it), plus the story's weight: the scenes set there and the trips through it, from the travel record that already weights the layout.
- **A gate's mass:** the trips the story makes out that way, plus a floor for a city's ordinary through traffic.
- **All read from the map,** so they are deterministic: no new question to Jev.

### 3.2 Which hubs get an expressway

1. **A tree, by cost-benefit growth** (§1.2).
   - The hubs join in the order the map gave them their places.
   - Each new hub links to the existing hub that maximises R'.
   - The default β/β* is 0.5, the middle of the real railways' range, so the network forms hubs.
2. **Loops, by detour.**
   - **Candidates:** the Delaunay neighbours among the hubs.
   - **Each round:** add the link that saves the most gravity-weighted detour, Σ T_ij × (network distance − new distance), per metre built.
   - **Stop:** when the saving no longer beats β.
   - **Why rings:** the worst detours are between neighbours on opposite sides of a hub, so this closes rings around the core. Tokyo's rings arise the same way.
   - **The check:** the route factor between heavy pairs should come out near the real networks' 1.1 to 1.4.
3. **Classes, by flow.**
   - **Assignment:** assign the gravity demand to the street net plus the candidate links: all-or-nothing first, Wardrop's equilibrium when traffic comes (stage 4).
   - **Expressway:** a link whose flow passes what a four-lane road carries.
   - **Trunk arterial:** the next band, made wider with three lanes. The other streets keep their classes. This also gives stage 1 its trunk roads.
   - **A small town may get no expressway,** because its benefits never beat the cost. The maths says so; no rule is needed.
4. **The terrain cast overrides.** A city whose text names an expressway, a ring road or a monorail gets it, routed by the same alignment. The maths fills in only what the text leaves open.

### 3.3 Where it runs: least action with a curvature term

- **The alignment is Galin's path:** ρ minimising ∫ c(p, ṗ, p̈) dt.
  - **The solve:** our path integral's action with a different Lagrangian, on a corridor grid of about 10 m.
  - **The state:** a cell plus one of 16 headings, so the curvature is in the cost.
- **The cost per metre:**
  - **Base:** length.
  - **Public space is cheap:** over an arterial (the Shuto rule), along a river or canal, or over a park as a tunnel.
  - **Lots cost land:** taking a lot costs its land, rising with the density field, so the core is dear and the edge cheap.
  - **Never:** a named place's borrowed lot, a building the story uses, a landmark.
  - **The other layer is free:** the shallow underground's halls cost nothing, because they are another layer. A tunnel must clear them.
  - **Curvature:** infinite below the design radius. The path is smoothed to arcs and transitions of at least that radius, so a sharp corner is *smoothed*, not forbidden by a rule.
  - **Path merging:** a later link's path pays less on an earlier link's corridor (Galin 2011). Links then share a deck where they run together and meet at a junction.
- **Two kinds of expressway fall out of the cost** (§2):

  | | Over the streets (Shuto) | On its own corridor |
  | --- | --- | --- |
  | **Where it wins** | the dense core, where land is dear | the edge and out of town, where land is cheap |
  | **Speed** | 40 to 50 km/h | 60 to 80 km/h |
  | **Alignment** | rides a chain of arterials | its own straighter line |
  | **The ground under it** | a corner lot taken here and there; nothing else changes | enters the fill as an axis road: an avenue under the deck, blocks clipped to it, as street landscapes already do |

- **Tunnels.** Where the core is dear and no arterial chain bends gently enough, the corridor may drop into the shallow layer. A portal costs a fixed amount, and the tunnel costs per metre. It is the same layer switching a walk already uses.

### 3.4 Height and ramps

- **The deck** stands about 10 m up: street clearance plus the structure.
  - **Width:** two lanes each way, about 16 to 18 m, which fits over an 18 m arterial.
  - **Piers:** in the road's middle.
  - **Its layer:** the expressway layer of roads-and-transit.md stage 2, with its own graph. The street below keeps running, with the deck as its ceiling.
- **Grades:** the main line stays within a few percent. A ramp climbs 10 m:
  - in about 110 m at the 9% maximum;
  - in about 170 m at 6%.
  - That is one to one and a half of our arterial segments, laid along the arterial below.
- **Ramp ends:** vertical curves at each end, at the ordinance's radii.

### 3.5 Junctions and ramps

- **Two expressways meeting** make a junction: the decks cross at two heights, about 8 m apart, joined by directional ramps.
- **An expressway over an arterial** gets an on- and off-ramp pair where the assigned flow between the two is heaviest.
- **Ramp spacing** follows Tokyo, not the US mile:
  - in a 2.2 km city, a ramp pair every 0.5 to 1 km;
  - no ramp closer to the next than its own length.

### 3.6 Same seed, bounded repair

- **The skeleton** (hubs, masses, links, classes, alignments) is a pure function of the city's seed and the map. It is versioned like the fill: nothing stored but what a cast names or a run changes.
- **A new district:**
  - the tree adds exactly one link;
  - the loop pass only adds;
  - the existing alignments stay put and become merge targets.
  - Only the chunks along the new corridor are rebuilt, with seam records at their edges (research handoff §7).
- **The test,** like the shallow layer's: the surface beside a new link is the same, lot for lot, as before it.

### 3.7 What it would give Academy City (a prediction to check, not a result)

For six districts and a gate or two in 2.2 km, expect:
- a short loop around the core;
- two or three radials to the gates;
- three to six ramp pairs;
- the core part over the streets, at 40 to 50 km/h.

The first build should show this on a debug map before anything is drawn in 3D.

### 3.8 Checks

- **Topology:**
  - β/β* is in the railways' range;
  - the route factor between heavy pairs is 1.1 to 1.4;
  - a new link never raises the total travel time of the demand (the Braess check).
- **Geometry:**
  - no curve below its design radius;
  - grades within the ordinance's limits, ramps within 9%;
  - no ramp closer to the next than its length.
- **Ground:**
  - lots taken, by kind;
  - none taken from a named place.
- **Bounded:** a new district changes only its corridor's chunks, and a rerun with nothing new changes nothing.
- **Riding:** every expressway reaches the street graph by a ramp, and a ride takes it only when that is quicker.

## 4. The same maths for the rest of the transport stages

- **Stage 1, road classes:** assign the gravity demand, or take betweenness, on the road graph. The top band becomes the trunk roads (wider, more lanes), the tree-like backbone Kirkley et al. find in every city.
- **Stage 3, the subway:**
  - **Hubs:** the station landscapes and the underground's station halls.
  - **Topology:** cost-benefit growth or a slime-mould solve for the lines.
  - **The shape check:** Roth et al.'s core and branches.
  - **Alignment:** the same cost in the shallow layer. A cut-and-cover line is cheap under arterials; a deep bore pays no surface cost but more per metre.
- **Stage 4, traffic:** Wardrop's equilibrium of the gravity demand by the hour (the story sky's time of day) gives each road its flow. The traffic field draws it, and a jam the text names is a capacity cut on one road.

## 5. Not chosen, and why

| Model | Why not, or not now |
| --- | --- |
| The network design problem | Too heavy to run per city. We keep its Braess check. |
| Slime mould for roads | A global iterative solve, so a new place changes everything. Kept as an offline check or for rail. |
| L-systems with global goals | Rules and order-dependence, against smoothing before rules. |
| Learned generators | They need training data and don't give a pure function of a seed. Maybe later, as a judge. |
| A fixed ring-and-radial template | Tokyo's shape, but a rule. The loop pass should produce rings where detours call for them. |

## 6. Proposed order of work

1. **Stage 1** as designed (the road graph, lanes, riding), with classes by flow (§4) so the trunk roads exist.
2. **The highway skeleton:** hubs, masses, tree, loops and classes, shown on a 2D debug map of library 16's Academy City, with the checks of §3.8.
3. **Alignment and deck:**
   - the least-action alignment with the two kinds of expressway;
   - the deck and ramps on the expressway layer;
   - the fill clipped to its own corridors.
4. **Riding on it,** with option D of the moving conversations, then **the subway lines** by the same maths.

## 7. A first try: the line, then the buildings reading its ramps (2026-11-08)

The user, on the one-way effect of §3 (ramps raising the buildings near them, nothing flowing back): *"Let's try it
out"*.

- **Built (experiments only, uncommitted):** `experiments/v2/highways.mjs` lays a first highway on one city of a built
  page and applies the pull; `experiments/v2/highways-page.html` shows it before and after in 3D, with sliders. It was
  tried on Academy City's ground from library 16's reading: the first-quarter rehearsal page `d20261108183223`, the
  same city World · Live draws, with 1,888 buildings and 67 km of road.

**The order, as run.**

1. **The line reads only these:**
   - the map's districts and their scenes;
   - the neighbouring city on the map;
   - the ground's roads and water;
   - the named patches, whose lots it never takes;
   - the patches' height targets, as the price of land.
2. **It never reads a building.**
3. **Then the buildings read the line:**
   - those under a deck or a ramp are taken;
   - the text's own buildings keep their floors;
   - every other building's floors become floors × (1 + pull × e^(−distance to the nearest ramp / reach)).

**What the line came out as.**

- **Links:**
  - cost-benefit growth linked districts 1 to 2, 1 to 3, 3 to 4 and 3 to 5;
  - the detour pass added the loop 2 to 3;
  - the smallest district (6, industrial) and the gate toward the map's other city did not pay for a link. No scene of the first quarter goes that way.
- **Length:**
  - 1.38 km of deck and 1.51 km of tunnel;
  - 55% of the deck's centre line runs over a road;
  - its tightest bend is 84 m (designed for 80 m, 50 km/h).
- **Ramps:** at districts 1, 3, 4 and 5. District 2's ramp would have stood too near district 3's.
- **Taken:** 39 ordinary buildings under the deck and 11 under ramps. None of the 27 buildings the text placed is taken.

**What it took to get there** (each was a failed try first):
- **Directions:** the search needed Galin's large masks. With 16 headings and arcs snapped to an 8 m grid, it could not follow a road at an in-between angle, so it cut across blocks. Now it uses 48 headings, each step costed on the 2 m ground, and a turn allowed only when the step is long enough for the radius.
- **Travel cost:** a travel cost per metre (users' time) is needed on top of building cost. Without it, the line took 2 to 5 times the straight distance to ride cheap roads or an earlier deck.
- **Hub points:** a district's middle is where the story's named places crowd. The line stops at the cheapest point within 0.6 of the district's radius, not at its middle.
- **Tunnels:** even so, named ground walls the middles in, which is why there is more tunnel than deck. The tunnel option (15 per metre and two portals) is what lets the line pass without taking a named place's lot.
- **Local streets:** riding an 8 m local street had to cost more than an arterial (1.5 against 0.3). A 17 m deck over an alley is not what Tokyo did.

**What the pull does** (from the page's numbers):

| Pull, reach | Mode | Taller | Lower | Mean floors within 300 m of a ramp | City floor area |
| --- | --- | --- | --- | --- | --- |
| 0.6, 250 m | city grows | 1,160 | 0 | 9.3 → 11.8 | +20.8% |
| 0.6, 250 m | same total | 169 | 359 | 9.3 → 9.7 | +0.3% |
| 0.3, 150 m | city grows | 311 | 0 | 9.3 → 10.0 | +5.3% |
| 1.0, 400 m | city grows | 1,623 | 0 | 9.3 → 14.9 | +50.4% |

**What this teaches:**
- **Our city is small.** Academy City is 2.2 km across, so four ramps with a 250 m reach cover nearly all of it: only 11 buildings stand more than 800 m from a ramp.
  - "City grows" then mostly makes the whole city taller.
  - "Same total" (the city's floor area kept, growth near ramps paid for by small losses elsewhere) barely tilts it.
  - A reach nearer 150 m, or distance along the roads instead of a straight line, gives a visible gradient.
- **The pull belongs in the fill, not after it.** In the engine, it belongs inside the fill's building style, as a raised density, ρ' = ρ + pull × A × (1 − ρ), not as a pass over finished floors. The order allows that: the line exists before the fill places its buildings, and the lots under it are left as the deck's ground.

**Not done:**
- road classes by assigned flow;
- the gate's through traffic;
- the deck and ramps in the player or World · Live;
- a decision on whether a deck may ride over a named street's own road (it would take fewer tunnels).


## 8. Wired in (2026-11-08)

The user: *"Let's wire the highway transport system in, rebuild the terrain, and work on the dialogue/action while
driving"*. Uncommitted.

**The pieces:**

| Piece | Where | What it does |
| --- | --- | --- |
| The highway | `world-engine/world/highways.mjs` | §3's plan as a pure module: hubs and masses, cost-benefit links and loops, the least-cost line (48 headings, 2 m ground, turns paid by the step's length, tunnels under named ground), ramps whose legs follow the line's curve. |
| What the buildings read | the same module, `groundEffect` | No building where a deck or a ramp stands; the rest taller the nearer a ramp (pull 0.6, reach 150 m); the city's floor area kept (manifold unification); the text's own as they are. |
| The terrain's transport step | `world-engine/terrain/transport.mjs` | Builds each city's highway from the world-only export and keeps it in the universe's terrain registry (`highways`), mirrored in the book's terrain, logged in the map's log. Run again, it keeps a city whose districts are known; a new district adds at most a link and its line (bounded repair; `--rebuild` lays them again). No model is asked. |
| The export | `export-strand-demo.mjs` | The city's buildings read the kept highway (above); the page carries `highways`; the director's engine gets the roads and the highways. |
| The road graph | `world-engine/world/roads.mjs` | Vehicles' own network (roads-and-transit.md stage 1): streets split at junctions and stitched together, decks and tunnels along each line, which come down to the street at their hubs and join it at their ramps. Drives keep left and wait at junctions. |
| The director | `director.mjs` | A road vehicle's ride (`ride:<x>:road`) drives the road graph from kerb to kerb, each node timed. Talk while driving is in `on-the-move.mjs cutDrive` ([world-ontology.md](world-ontology.md) §5a). |
| The player | `strand-demo.html` | Draws decks on piers, ramps, and tunnels as lines on the ground. Plays a drive under talk at life's own speed. |

**The terrain rebuilt (library 16).**
- **Why snapshots:** a rerun restores the book's `before`, and a new `before` must come from the clean state, not from a run's after (the W11 lesson).
- **The steps:**
  - W13's state, with Pi's round-3 answers, was kept as `vol-1/0008-manual`;
  - the clean `0001-before` was restored;
  - the transport step laid Academy City's highway: 5 links, 1.72 km of deck, 1.11 km of tunnel, 5 ramps;
  - that became the new `vol-1/0010-before`, so a rerun of volume 1 starts with the highway;
  - the library was put back at W13's state (`0008`; its terrain without the highway), so a fourth pass from the last run stays consistent with the world it was played in.
- **Not yet in the live checkout:** World · Live still runs `app-29617e7-w13`.

**Rehearsed** (units 1-84, stand-in, on the copy `rehearsal-novel-w13j` with its own highway).
- **The buildings:** 79 not built under the line; 229 taller and 285 lower near the ramps (same floor area).
- **Laws:** all as before.
- **Moves:** 236 against 241, since the ground under the line and round the ramps changed.
- **Driving:** the first quarter has no drive (its seven "rides" are people carried by another), so the road graph is not exercised there.
- **Volume 3's drive** was staged on the city instead (§5a of world-ontology.md).

**Measured on the way:**
- **The streets came in 692 pieces.** Each patch lays its own streets, and a child place's circle cuts the roads through it. That is roads-and-transit.md's "connectivity across places is unchecked". Stitching (joins under 40 m, shortest first, then any piece left to the largest within 150 m) leaves one network per city.
- **The page's grid is the story's.** Its walk grid covers the first quarter's area (about 1.4 x 1 km), not the city. A drive the director lays outside it has no nodes there yet.

## Sources

- **Demand and network design:**
  - J. G. Wardrop, "Some theoretical aspects of road traffic research", Proc. ICE 1952.
  - H. Yang, M. G. H. Bell, [Models and algorithms for road network design](https://doi.org/10.1080/01441649808717016), Transport Reviews 18(3), 1998.
- **Topology:**
  - R. Louf, P. Jensen, M. Barthelemy, [Emergence of hierarchy in cost-driven growth of spatial networks](https://arxiv.org/abs/1305.3282), PNAS 110(22), 2013.
  - M. T. Gastner, M. E. J. Newman, [Shape and efficiency in spatial distribution networks](https://arxiv.org/abs/cond-mat/0409702), J. Stat. Mech. 2006.
  - A. Tero et al., [Rules for biologically inspired adaptive network design](https://pubmed.ncbi.nlm.nih.gov/20093467/), Science 327, 2010.
  - A. Tero, R. Kobayashi, T. Nakagaki, [A mathematical model for adaptive transport network in path finding by true slime mold](https://eprints.lib.hokudai.ac.jp/dspace/handle/2115/28041), J. Theor. Biol. 244, 2007.
- **Procedural cities and roads:**
  - Y. Parish, P. Müller, [Procedural modeling of cities](https://history.siggraph.org/?p=116923), SIGGRAPH 2001.
  - J. Beneš, A. Wilkie, J. Křivánek, [Procedural modelling of urban road networks](https://cgg.mff.cuni.cz/~jaroslav/papers/2014-cities/), CGF 33(6), 2014.
  - G. Chen et al., [Interactive procedural street modeling](https://sci.utah.edu/~chengu/street_sig08/street_project.htm), SIGGRAPH 2008.
- **Empirical road networks:**
  - M. Barthélemy, A. Flammini, [Modeling urban street patterns](https://arxiv.org/abs/0708.4360), PRL 100, 2008.
  - E. Strano et al., [Elementary processes governing the evolution of road networks](https://pmc.ncbi.nlm.nih.gov/articles/PMC3291042), Sci. Rep. 2, 2012.
  - A. Kirkley et al., [From the betweenness centrality in street networks to structural invariants in random planar graphs](https://pmc.ncbi.nlm.nih.gov/articles/PMC6021391), Nat. Commun. 9, 2018.
- **Alignment:**
  - E. Galin, A. Peytavie, N. Maréchal, E. Guérin, [Procedural generation of roads](https://diglib.eg.org/items/0aba12a9-bdbc-43a2-982c-5d1a9a43a2ba), CGF 29(2), 2010.
  - E. Galin, A. Peytavie, E. Guérin, B. Beneš, [Authoring hierarchical road networks](https://diglib.eg.org/items/33f74b9d-6792-4d51-8c32-c1d6c1824ea0), CGF 30(7), 2011.
  - J.-C. Jong, P. Schonfeld, [An evolutionary model for simultaneously optimizing three-dimensional highway alignments](https://econpapers.repec.org/RePEc:eee:transb:v:37:y:2003:i:2:p:107-128), Transp. Res. B 37(2), 2003.
- **Rail:** C. Roth, S. M. Kang, M. Batty, M. Barthelemy, [A long-time limit for world subway networks](https://arxiv.org/abs/1105.5294v3), J. R. Soc. Interface 9, 2012.
- **Learned generators:** [High-fidelity road network generation with latent diffusion models (GraphWalker)](https://www.ijcai.org/proceedings/2025/702), IJCAI 2025.
- **Design standards:**
  - MLIT, [Road Structure Ordinance: design speeds](https://www.mlit.go.jp/road/road_e/r1_standard_2.html) and [vertical alignment](https://www.mlit.go.jp/road/road_e/r1_standard_3.html).
  - [JICA report quoting the ordinance's ramp values](https://openjicareport.jica.go.jp/pdf/12304598_02.pdf).
  - [WSDOT Design Manual, interchanges](https://wsdot.Wa.Gov/publications/manuals/fulltext/M22-01/1360.pdf).
- **Tokyo:**
  - [Japan Times on the Nihonbashi section](https://www.japantimes.co.jp/news/2014/02/26/national/nihonbashi-highway-is-urged-to-go-under).
  - [Goethe-Institut, Tokyo's expressway network](https://www.goethe.de/prj/zei/en/art/25664880.html).
  - [Shuto Expressway](https://en.wikipedia.org/wiki/Shuto_Expressway).
  - [Tokyo Gaikan Expressway](https://en.wikipedia.org/wiki/Tokyo_Gaikan_Expressway).
