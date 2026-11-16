# Raw-stage merge: head bust onto body before any rig

The pipeline is what `make_figure.py` runs now (see "In production" and the sections after it). The version history below
is kept as the record; the scripts of versions 1 to 4 (`cut_raw.py`, `neck_raw.py`, `neck3_raw.py`, `blend_raw.py`) were
removed on 2026-11-16 and are at tag `figures-raw-steady-1`.

Steady version 1 (2026-11-15). Body from TRELLIS.2 (T-pose front picture), head bust from Hunyuan3D-2.1 (portrait).
Not yet a `make_figure.py` step; run by hand in this order. No rig or bone weights are used anywhere.

| Step | Script | What it does |
|---|---|---|
| 1 | `marks_raw.py <body.glb> <bust-marks.json> <out>` | Stands the body (1.6 m), renders it whole and then its head framed as the bust frames itself, triangulates RTMW's 133 points. Uses `render_any.py`. |
| 2 | `place_raw.py <out> <bust.glb> <bust-marks.json>` | Places the bust (`marks/fit.place`, head = body points above its chin landmark), then fits one scale and offset per axis so the bust's head matches the body's own head. |
| 3 | `skin.py -- skin ...` (Blender) | Each model reduced to its closed outer skin by a volume remesh at the geometric mean of the two models' edge lengths. |
| 4 | `cut_raw.py <out>` | Drops hollows, searches the seam level (where the two neck outlines differ least), draws the body's neck top in flush with the bust's section, opens the body along its neck outline, keeps the bust wherever it is nearer the body's head side. |
| 5 | `skin.py -- fuse ...` (Blender) | The two closed parts fused into one surface; loose fragments dropped afterwards. |

Known weak points of version 1: the neck join is a single cut level just under the chin (the two necks sit about 12 mm
apart there and only the body's top is drawn in); hair tips clipped against the hood are frayed; tested on Akane only.

## Version 2: stable release sample (2026-11-15)

`neck_raw.py` replaces step 4 and `skin.py -- merge` replaces step 5; `keep_main.py` drops loose fragments. The bust's neck
bone is located by its own shoulder line and laid on the body's (stretched and leaned, fading to nothing at the head), the
body is cut where its bare neck starts, and the bust is kept by a solid intersection with the space nearer the body's head.
Sample result: `E:/figures/akane/rawmerge_v2/merged2.glb`. Good from the front; from the back the body's neck stops at the
collar top and shows as a ledge.

## Version 3: in progress

`neck3_raw.py`: version 2 plus the body's neck kept to the chin level and bent under the bust's neck (bones matched by the
mass centres of the neck sections at the chin level). The back of the neck is complete; a rough rim remains under the hair.

## Version 4: fused low (2026-11-15)

`blend_raw.py` then `skin.py -- merge4`, after `neck_raw.py` (which lays the bust's neck bone on the body's). The bust keeps
its head, neck and collar; from its lower edge up to the body's neck base, and the same length in from its side edges, its
shape is blended into the body's as solids on the grid. Both models are shells, so each is filled into a solid first (the
bust also front to back). No seam on the neck. Sample: `E:/figures/akane/rawmerge_v4/merged4.glb`. Open: small slits along
the bottom edge of the blend zone; the body's own shirt collar and hood top give way to the bust's plainer ones.

Smoothing added to version 4 (2026-11-15): the piece is smoothed over one grid cell in proportion to the bust's share (the
body edge stays exact), then the mixed zone alone is relaxed for the number of passes at the knee of its roughness curve
(5 passes for Akane, 0.25 mm to 0.05 mm). Sample: `E:/figures/akane/rawmerge_v5/merged5.glb`.

## Neck path with a continuous tube (2026-11-15)

`tube_raw.py` then `skin.py -- merge5`. The neck is one swept surface: the body's bare-neck outline carried along the neck
bone from inside the collar up into the head. Where it sits under the bust's head is fitted at the chin level (the body's
neck outline moved, not resized, onto what the bust's section shows; the bust's hollow is ignored): 15 mm back for Akane.
The body's neck column, collar included, bends by that move. The bust gives no neck. Sample:
`E:/figures/akane/rawmerge_tube/merged6.glb`.

Tube neck, back cleaned (2026-11-15): the ring under the hair was the top of the bust's own collar, which rises higher than
the body's (68 to 76 mm up at the back). It is taken off direction by direction, up to where the bust's own neck lies on
the tube. The body is cut at the chin level (on the upright part of its neck) and the head region is counted from the
collar's top. Sample: `E:/figures/akane/rawmerge_tube/merged7.glb`.

## In production (2026-11-15)

The tube-neck merge runs as `make_figure.py` steps, after `marks_bust`:

| Step | Script | Output |
|---|---|---|
| `body_cut` | `cutout.py` | `body_rgba.png`: the T-pose front cut out of its paper (`prep_view.figure_mask`) |
| `body_t2` | `trellis_body.py` (job: `trellis_job.py`) | `body_t2.glb`: the body from TRELLIS.2, one Hugging Face Job paid from the account's credit (about 19 cents); the picture and model are deleted from the hub afterwards |
| `raw_merge` | `merge_raw.py` | `merged.glb`: marks, place, skins, tube and merge in order (about 10 minutes); the grid step is the geometric mean of the two models' edge lengths; `raw/merge.json` keeps what each part reported |
| `reduce` | `reduce.py` | `reduced.glb`, `reduced.json` |
| `holo_page` | | `reduced.txt` for a viewer |

`reduce.py`: the merged surface is smoothed until the grid's staircase is off (the knee of the Laplacian's fall; the
distance the points moved is the staircase's size, 0.29 mm for Akane), then collapsed as far as the reduced surface stays
ON AVERAGE within that size. Akane: 2.2 million triangles to 12,136, edges 24 mm. The first rule (the single farthest of
20,000 sampled points within one grid step) gave 27,350 triangles on one merge and 180,050 on a nearly identical one: one
hair tip decided it. The mean gave 12,126 and 12,136 on the same two. `shot_holo.py` renders a model as the hologram.

Not done: the rig steps (`rig` onward) still take the Hunyuan body and graft the bust after the rig; they move onto
`merged.glb` / `reduced.glb` next. The `body_t2` step itself has not been run from `make_figure.py` (Akane's body came
from the same job script and the same cut-out, run by hand). At 12,000 triangles the face is coarse (the eyes are a few
triangles); the organs are built separately. Tested on Akane only.

Head finer (2026-11-15, `reduce.py --head=raw/head_region.glb`, what `make_figure.py` now runs): the points inside the
solid the merge kept the bust in are held to the same tolerance times the head's share of the figure's height (16% for
Akane: 0.046 mm), so the head framed alone is as true as the whole figure framed alone. Two passes: the whole figure down
to what the head allows (135,346 triangles), then the body alone further with the head's triangles left as they are.
Akane: 13,231 triangles on the head, 13,989 on the body, 27,220 in all (before: about 1,200 of 12,136 on the head). In a
whole-figure view the head's lines now run together into a bright patch.

## The base body under the clothes, raw first (2026-11-15)

The base body (the same T-pose redrawn in a plain base layer) is now made by TRELLIS.2 too, in the same job as the dressed
body (`trellis_body.py` takes several pictures), because the Hunyuan one held its arms lower and stood on a floor plate.
`make_figure.py` steps `base_marks`, `base_skin`, `base_raw`, `base_reduce`, `raw_layers`:

- `marks_raw.py <base> -`: the base's own joints (RTMW, triangulated). `skin.py skin` + `outer.py`: its closed outer skin.
- `base_raw.py`: the base laid inside the merged figure. The dressed figure is the reference, the base is elastic.
  One scale, turn and move from the joints and the surfaces; the head cut off where the figure's head region starts (the
  base has no head, and the figure's head takes no thickness); then elastic bone matching: each base bone (torso, upper
  and lower arms, hands, thighs, shins, feet) is turned onto the figure's bone and stretched to its length, then moved
  (never turned: a free turn spins a round limb about its own bone) onto the figure's surface with its joints as anchors;
  the parts' moves are blended at the joints. Base points still outside the figure are drawn onto its surface. The
  figure's layer thickness is its distance to that body (`thick.npy`).
- `reduce.py --tol=<the figure body's tolerance>` on the fitted base; `layers_raw.py` carries the thickness to the reduced
  figure (each reduced point: the mean over the raw points nearest to it) and writes it as the vertex colour.

Akane: joints 19 mm apart before, 9 mm after; forearms stretched x0.77 and x0.88 (the base's arms were 25 to 38 mm longer
at the fingertips); 44% of the base surface stood outside the figure by a median 8 mm (the base body is drawn fuller than
the dressed one) and was drawn in. Thickness below the head: a quarter of the figure under 2 mm (legs, hands, shoes),
median 9 mm, 95% under 31 mm (hood, hem, sleeves, skirt). Base reduced to 23,330 triangles.

Open: no skin-or-cloth split is made yet (the old viewer's fixed 8 mm and 45 mm are not carried over; the split belongs
with the rig). The 44% drawn in means the base takes the figure's own shape on the legs, which is right for bare legs but
also flattens it onto pleats at the skirt's top. Joint depth from the landmarks is only good to about 10 mm, so an arm can
sit off-centre in its sleeve. Tested on Akane only; the steps were run by hand in this order, not yet through
`make_figure.py`.

## Skeleton on the merged figure (2026-11-15)

`make_figure.py` steps `solid`, `rig_m`, `holo_m`, `page_m`; result `holo_m.vrm` / `figure_m.txt` (the viewer plays its
motions on it).

- The merged figure is layered: under the jacket there is an inner cloth wall and a body inside, joined at the open hem
  (a slice at chest height shows three nested loops). `dress_rig.py`'s clean-up tears thin layers apart (the first try left
  a third of the figure). `solid.py` makes a filled solid for the rig alone: on a grid of two point spacings, a cell is
  inside when it lies between the figure's first and last surface cells along all three grid directions, or the outside
  flood cannot reach it. Akane: 27.8 litres as layered, 51.2 filled.
- `dress_rig.py --marks=raw/whole.json`: the joints are the model's own 3D landmarks (RTMW on its renders, triangulated),
  not the drawing's joints laid over the model. A body generated from the drawing does not keep the drawing's arm length:
  the drawing's wrists fell 97 and 74 mm out, in the palms, and half the hand then lost its arm weights. Bone heat weighted
  every point of the solid.
- `holo_detail.py --asis=1 --vrm=1`: the weights go onto `reduced.glb` as it is (nearest surface of the solid). The rule
  for what belongs to an arm now takes every connected patch that runs past the elbow (the sleeve's shell and the arm
  inside it are separate patches); before, only one layer kept its arm weights.

Checked: Blender renders of the walk and wave poses (legs, skirt, arms and hands whole), and the walk in the viewer with
no console errors. Not yet on this figure: the head lock and jaw, hair springs, face organs, the base body as the hidden
layer (soft layers), joint smoothing. The rig step takes about 16 minutes on the solid. Tested on Akane only; the steps
were run by hand in this order, not yet through `make_figure.py`.

## Soft cloth on the rigged figure (2026-11-15)

`make_figure.py` step `layers_m` (`layer_raw.py`), then `page_m`; result `layers_m.vrm` / `figure_m.txt`.

- The base body needs no rig of its own and no retargeting: it already lies inside the figure (`base_raw.py`), so it takes
  its bone weights from the same filled solid the figure took its own from, and goes in as `LayerBody`.
- The figure's triangles inside the merge's head region are split off as `Head`, which the viewer keeps on the skeleton
  (the base has no head, so the head has no layer). The clothed surface is named `Outfit_main`.
- Viewer (`viewer/index.html`, for a figure whose file name has `merged` or `_m.`, or `?layers=data`): the skin-or-cloth
  split is measured, not the benchmark's 8 and 53 mm. Softness starts at the level that best parts the figure's
  thicknesses into two groups (Otsu) and is full at the figure's largest thickness; the leg and torso capsules take their
  radii from the base body (the median distance of the base points that follow those bones).

Akane: softness from 19 mm to 53 mm; 27% of the body's points move as cloth, 2% more than half soft. Walking, soft points
sit up to 43 mm from where the skeleton puts them (6 mm on average); no errors in the viewer.

Still fixed numbers in the viewer's cloth (from v0.6, not touched here): spring stiffness and damping, gravity, the 1 to
9 cm stretch limit, the 125% edge limit. The shoulders of the hoodie look bunched with the arms down (seen in one
screenshot, not examined closely). Order note: `base_reduce` needs `reduce` first, and `layers_m` needs `base_reduce`,
`rig_m` and `holo_m`; `make_figure.py` lists them in that order. Tested on Akane only.

## Body density trial (2026-11-15)

`reduce.py --body=<share>` holds the body to a share of its measured tolerance; `--pass1=<file>` keeps the slow first pass
for further runs. Akane, same skeleton and weights (the filled solid's), head unchanged at 13,000 triangles:

| Body tolerance | Body triangles | Viewer, one frame of walk with cloth (this laptop) |
|---|---|---|
| 0.29 mm (measured, current) | 14,000 | 17 ms |
| 0.14 mm | 31,000 | 56 ms |
| 0.07 mm | 63,000 | 99 ms |
| 0.04 mm | 122,000 | 183 ms |

A finer body shows the folds, pocket and hood more cleanly, but it bends the same: the faults are in the weights and the
layers, and appear at every density. Seen in the pose renders (`dens/density_*.jpg`): the sleeve of a bent arm breaks into
rings; a saw-tooth edge at the armpit where arm-to-body triangles are cut; the shoulder cap bunches. The measured
skin-or-cloth split stays at 19 mm at every density. Not adopted: `make_figure.py` still reduces the body at the measured
tolerance.

## Bending faults measured (2026-11-16)

Measure: triangles that cross a triangle they do not touch, at rest and in test poses (0 at rest for Akane).

| Weights | Arms forward | Arms raised | Arms lowered | Stride |
|---|---|---|---|---|
| current (nearest surface of the solid, arm-to-body cut) | 616 | 262 | 633 | 180 |
| the same without the cut (`holo_detail.py --cut=0`) | 755 | 368 | 792 | 180 |
| a field solved through the solid's volume (`volume_weights.py`, first try) | 1586 | 1063 | 1423 | 150 |

- The "ringed sleeves" were not a fault: close up the posed sleeve is whole; coarse flat triangles seen end-on looked like
  rings. Layers at the same place along the arm carry the same weights.
- Nearly every crossing is at the shoulders (592 of 616 with the arms forward); the stride's are at the skirt and thighs.
- The cut removes the saw-tooth's cause only by deleting triangles; without it the armpit is whole but more triangles cross.
- The volume field as first written is worse and is NOT adopted: it bypasses the arm repairs `holo_detail.py` makes (the
  fingertips stayed behind), and its grid came out at 8 mm. Not a fair test of the idea yet.
`make_figure.py` is unchanged by this trial.

## Skull lock, jaw and hair on the merged figure (2026-11-16)

`make_figure.py` steps `lock_m`, `face_m`, `portrait_marks`, `hair_m`; result `m/figure.vrm` / `figure_m.txt`. The v0.7
scripts run as they are, given what the raw merge already knows:

- `holo_detail.py` records the placement it gives the reduced figure (`raw_frame`); `layer_raw.py` places the base body by
  it and writes the bust's landmark mapping (`bust_map` = that frame times the merge's `place.json`) and the neck tube's
  section level by level (`neck_tube`, from `raw/tube.glb`).
- `head_lock.py`: on a figure that carries `neck_tube`, the neck's cross-section is the tube's at the Head's rim. The base
  body's slice it used before has 3 points there now (the base ends at that height) and gave a 0.5 mm neck; the tube gives
  27.0 by 28.3 mm.
- `face_rig.py`: unchanged. 68 of 68 face points on the Head; pivot and jaw found by its searches.
- `portrait_marks.py` (new, small): the portrait's 68 face points, which `hair_rig.py` reads; the step that wrote them
  before was removed with the old path. It reproduces the earlier file exactly.
- `hair_rig.py`: unchanged. On the 13,000-triangle head: 4,882 of 6,632 points hair, 2,849 free, 51 locks, 21 chains,
  31 spring joints, 4,046 points weighted to chains.

Akane, `check_head.py`: skull drift 0 mm in every head pose; jaw opens 30 mm. The seam between the Head and the body opens
11 mm in a nod, 14 looking up, 17 tilting and 36 mm in a head turn (the old path: 15, 16, 25, 40): the Head's rim follows
the neck bone alone while the body's edge keeps the solid's weights. Opening the jaw stretches 274 head edges past 1.25
times (the finer head has more of them near the mouth). In the viewer: hair tips travel up to 36 mm walking and 155 mm in
a head shake (six sampled instants each; the build's own target for a shake is 105 mm), the cloth stays finite.
Not done: the face's organs, joint smoothing, the judge. Tested on Akane only.

## Spikes on the clothes with the arms down, and a denser body (2026-11-16)

Seen in the viewer's idle pose: long spikes at both upper arms. Three causes, all rules made for A-pose figures or for
skin that hugs the body, none of them triangle density:

- `dress_rig.py` took the arm weights off points outside the arm's measured tube (358 on the solid), leaving a few
  shoulder points with the spine. `--strip=0` (a T-pose figure) keeps bone heat's own weights: 0 stripped.
- `holo_detail.py` did the same to surface outside the arm's connected region, and cut arm-to-body triangles. Both are off
  with `--cut=0`.
- The viewer's thin skin rode the base body's points ("needles"); a sleeve point whose nearest base point follows another
  bone was pulled after it. For a figure with its own split (`soft.dataSplit`) the skin follows its own bones.

Akane, viewer, idle: edges grown by more than 4 cm went from 78 to 3 (the worst, 63 mm, is at the armpit); none in a
wave. The body is also finer now, by choice: `make_figure.py`'s `BODY_DETAIL` (`--body-detail`, default 0.5) holds the body
to half the measured tolerance: 31,500 body triangles beside 13,200 on the head. This is a look choice, named as one in the
code. With the skin on its own bones a frame of walk takes 24 ms on the laptop (it was 56 ms at this density before).
The reduce step keeps its first pass (`raw/pass1.glb`), so changing the detail takes about two minutes.
