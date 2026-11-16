# Figure pipeline versions

Rigged hologram figures for the novel's characters (design §8.6, milestones F10–F13). Code only lives here: the
characters' pictures, generated models and VRM files are copyrighted fan material and stay on the working machine
(`E:\figures`), never in this public repository. A finished figure goes into its universe with `novel figure add` and is
assigned to its person by EM (`README.md`; design §8.6, figures in the warehouse). Until 2026-11-14 this folder was
`experiments/figures/` on the branch `figures/misaka-prototype`.

| Version | Status | Pipeline structure |
|---|---|---|
| v0.1 | superseded | A-pose redraw (Qwen-Image-Edit) → shape (Hunyuan3D-2.1) → joints (RTMPose) → colour blocks by projection → rig (`dress_rig.py`) |
| v0.2 | superseded | T-pose redraw → shape → rig → ~16k-triangle hologram mesh (`holo_detail.py`, arms by connectivity) → outfits as whole bodies on one skeleton (`compose_outfits.py`) |
| v0.3 | benchmark | v0.2 + face-and-hair-locked redraw + a high-resolution head from a portrait (`head_swap.py`) |
| v0.4 | experiments | wardrobe from the books (`epub_scan.py`, `garments.py`, `cloth_settle.py`), joint smoothing (`smooth_joints.py`), skirt spring bones (`skirt_rig.py`), separate base body + clothes (`body_fit.py`, `mannequin.py`) |
| v0.5 | stable (tag `figures-v0.5.0`) | the v0.3 one-shot figure kept whole as the surface, its generated base body underneath as a hidden layer (`layer_pack.py`); in the viewer each point's distance from the base body is its layer thickness: thin points stay on the skeleton, thick points hang on soft springs (stretch limit, 25% edge limit, leg and torso capsules), fast CPU skinning (`viewer/index.html`) |
| v0.6 | stable (tag `figures-v0.6.0`) | v0.5 + rigid needles: the base body moves by dual-quaternion blending (rotation about each joint, no collapse); thin skin rides its nearest base-body point with its offset turned with it; loose cloth never sinks below 80% of its own depth above the body. Thigh's narrowest point in a deep lunge 71% → 92% of rest; ~21 ms a frame on a laptop. The viewer's "Base layer" switch compares with v0.5 |
| v0.7 | stable (tag `figures-v0.7.0`) | v0.6 + a face and hair of their own, for any character from a setting picture (`make_figure.py`, below). Skull lock (`head_lock.py`, on the Head mesh only): the head owns the head, the neck only the column under a jaw plane; the clothes and the base body keep v0.6's weights (the first v0.7 build also rewrote them by height and, in a T-pose, caught the arms: the arms and shoulders ballooned). Face points (`face_render.py`, `face_marks.py`: RTMW's 68 face points on grey renders of the head, 68 of 68 found in all three views) cast onto the mesh (`face_rig.py`); the head pivot moved up to the skull base; a VRM `jaw` bone hinged between the ears. Hair (`hair_rig.py`): the portrait's labels mapped onto the head through the face points, a solid-or-sheet test for cheeks under side locks, ten spring chains from the scalp line (three bangs, seven around), hair touching skin eased into its chain over 2 cm (no cut). Viewer: springs at a fixed 1/60 s posed at their own time, cone limits per link. See "v0.7 measured" |
| v0.8 | stable (tag `figures-v0.8.0`) | v0.7 + carved eyes (`eye_shapes.py`, `eye_parts.py`; two new `make_figure.py` steps). The head stays v0.7's triangles; each eye is its own quad part, built as a sculptor carves an eye in plain stone so a one-colour hologram can show it: an eyeball dome, the iris a cut ring and a dish, the pupil a drilled hole, the highlights bumps, the lash and the lower lid rims. Placed from the portrait (anime-face-detector's 28 points; iris, pupil, highlights and lash read from the pixels) on a smooth surface fitted to the skin around the eye (hair and thin sheets of bangs skipped); the two lids are smooth curves meeting at sharp corner nodes. A socket is cut: the head's triangles hidden under the eye split once and the skin pushed behind it; eye points the skin still covers are moved out in front of it. Viewer: the eyes drawn in the hologram's own style (the head's dark fill, fresnel rim and scanlines, the figure's line material), lines only where the form breaks plus quad loops marked in the UV map at the head's own spacing; in the white look they are plaster. See "v0.8 measured" |
| **v0.9** | **stable** (tag `figures-v0.9.0`) | v0.8 + the whole face, automatic: every organ is read from the portrait and built as a basic structure aligned to the head, the same way for every character (no per-character settings; `make_figure.py`'s `eyes` step builds them all). Brows: ridges along the drawing's strokes, following the real skin. Nose: the face's own structure, not a bump on it: the two cheek planes (the face's faired surface) run together into a bridge ridge from just under the eyes to a sharp tip, and a short underside cuts back to the face; the face's axis runs from between the inner eye corners to the mouth, the tip goes where the head's own nose stands furthest out and keeps its height, the width follows the eyes' spacing. The region is rebuilt in the face's own triangles (a constrained triangulation at the face's triangle size, the bridge and the tip's cross line kept as edges, easing onto the face around it; locks of hair fused to the face left standing; the face the old tip hid rebuilt too); its weights blend from the rim. Mouth: the drawing's line rebuilt in 3D, as the modelling tutorial does: a strip on the skin from the portrait's mouth stroke, thin in the middle and heavier toward the corners, ends rounded; it glows in the hologram, ink-dark in the white look. See "v0.9 measured" |

## v0.7 measured (Misaka, against v0.6)

| Test | v0.6 | v0.7 |
|---|---|---|
| Chin and jaw drift in the head's frame, nod / look up / turn / tilt | 43 / 54 / 71 / 30 mm | 0 / 0 / 0 / 0 |
| Skull points carrying non-head weight | 560 | 0 |
| Head edges stretched past 1.25×, nod / turn | 862 / 876 | 55 / 145 |
| Body (clothes and base body) edges stretched past 1.25×, nod / turn / arms down | 139 / 290 / 791 | 143 / 307 / 792 |
| Drawn clothes against v0.6 in the viewer, idle / walk / wave | — | every point within 0.9 / 0.3 / 2.8 mm |
| Jaw open 15° (Talk): chin drop; skull points moved | none | 32 mm; 0 |
| Hair tip travel, peak to peak: idle / walk / run / nod / head shake / jump | rigid (0) | 5 / 17 / 68 / 18 / 105 / 258 mm |
| Hair droop from its drawn shape at rest | n/a | 7 mm |
| Hair tips inside a collider (skull, face, neck, shoulders, chest), any motion | n/a | never (closest 11 mm outside) |
| 30 fps against 60 fps, hair tip paths (run) | n/a | 0 mm apart |
| Frame time (CPU, laptop) | ~21 ms | about +1 ms (a spring step is 0.84 ms) |

`check_head.py` measures the head and the body in Blender poses; the hair and clothes numbers are from the viewer's
test hooks (`__figure.applyPose`, `stepVRM`, `resetSprings`, `soft`). The first v0.7 build (springs relative to the hips,
stiffness 1.0, drag 0.4) moved the hair only 9 mm walking and 24 mm running: too little to see.


## v0.8 measured (eyes, Misaka and Index)

| Test | Misaka | Index |
|---|---|---|
| Eye parts' outline against the portrait (opening, iris, pupil, lash) | on the drawn lines | on the drawn lines |
| Smooth surface fitted to the skin around each eye, median / max distance | 1.2–1.7 / 3.5–5.2 mm | 0.6–1.2 / 1.6–2.8 mm |
| Head triangles split under the eyes (hidden by them); visible skin | 84; unchanged | 21; unchanged |
| Eye points under the skin after the socket and settling | 5 of 1259 (the eyeball's edge at a corner, < 3 mm) | 0 of 1334 |
| Eyes attached through head shake and nod | yes | yes |

Before the socket the skin stood up to 5 mm (Misaka) and 31 mm (Index, whose bangs are fused and not weighted as hair)
in front of the eye's surface. Moving the eye out instead left it standing proud like a plate; splitting every triangle
near the eye made a dense patch of lines that glowed around it in the hologram. The first carved eyes were drawn as solid
lit parts and no longer looked like the hologram; they now use its fill and lines. The eye points behind the skin were
first 102 of 1311 (the lash wing past the corners where the face curves back, and the eyeball's edge under large
triangles crossing the opening).

## v0.9 measured (the whole face, Misaka and Index)

| Test | Misaka | Index |
|---|---|---|
| Built with no per-character settings | yes (`eye_parts.py`) | yes, end to end (`make_figure.py --from=eyes_read`) |
| Nose tip: the head's own, from the portrait's nose point | 6.8 / 18.2 px off; 9.0 mm high | 19.6 / 3.2 px off; 6.8 mm high |
| Face triangles rebuilt for the nose (+ under the old tip); new points | 43 (+27); 23 | 27 (+4); 11 |
| Organ points under the skin | 5 (v0.8's eyeball edge) | 0 |
| Jaw open: head edges stretched past 1.25×; organ edges | 72; 0 (v0.8: 72) | 39; 0 (v0.8: 39) |
| Skull drift in nod, look up, turn, tilt | 0 mm | 0 mm |

Tried and dropped on the way (2026-11-14): a mouth built as the tutorial's inside (a slit in oval loops, a dark cavity
and teeth, the face cut open under it): it read as a disc set on the face; set into the face's triangles it fitted, but
the face's large triangles and the head's own sculpted mouth crease (off the portrait's line on Index) made the cut
fragile, and the drawing, not the inside, is what makes the anime look. A teardrop nose mark copied from the tutorial's
character: our portraits draw no such mark. A nose as a diamond of loops lifted off a fitted surface: a bump on a flat
face, where the nose is the cheeks' own structure.

## v0.5 in order

1. `edit.py` (Qwen-Image-Edit Space, `--lock=1 --strength=65`): the character's T-pose from her official art; the same
   picture redrawn in a plain base layer (the pair).
2. `hunyuan_shape.py` (Hunyuan3D-2.1 Space, Standard, 30 steps, octree 384): both shapes; a bust from a portrait at 512.
3. `prep_view.py`: outline, joints (RTMPose), colour regions.
4. `dress_rig.py`: 21 VRM humanoid bones from the joints, weights; `holo_detail.py`: the triangle mesh;
   `compose_outfits.py`: outfits on one skeleton; `head_swap.py`: the portrait head (`--body=` on a composed figure).
5. `smooth_joints.py`: thighs freed from the skirt's hip weights, joints blended.
6. Base body: `dress_rig.py` + `holo_detail.py` on the pair, `mannequin.py` (smooth, no fabric thickness).
7. `layer_pack.py`: the figure + the base body retargeted bone by bone as `LayerBody`, four influences per point.
8. `viewer/index.html`: three.js 0.169 + three-vrm 3.1; the soft layers (`buildSoft`, `stepSoft`), motions on the
   humanoid bones, the triangle hologram, the Layers view.

v0.7 adds, after step 7 (each a Blender script run headless on the previous step's `.blend`, except `face_marks.py`):

9. `head_lock.py <out.blend>`: the skull lock (writes the jaw rule to the armature as `figure_face`, and `face.json`).
10. `face_render.py <dir>`: grey, cavity-shaded orthographic renders of the head at 0° and ±30°.
11. `face_marks.py <dir> --portrait=<portrait.png>` (Python with rtmlib): 68 face points on each render and the portrait.
12. `face_rig.py <dir> <out.blend> [--pivot-at=0.5]`: the points cast and made symmetric, the head pivot at the skull
    base, the `jaw` bone and its region.
13. `hair_rig.py <portrait-view-dir> <dir> <out.blend>`: hair found, chains hung, weighted, springs and colliders.
14. `check_head.py [-- --json=<file>]`: the head's checks in test poses (any step's `.blend`).

## Any character from a setting picture (v0.7)

`make_figure.py <setting.png> <out-dir> --name=<Name> [--full=<full-length.png>] [--portrait=<head.png>] [--remove="..."]`
runs every step above in order, resumable (`--from`, `--only`), each step's output checked (Blender exits 0 even when its
script fails). The image-edit prompts are templates in `prompts/` with nothing about any one character. Choices that
made it general, each found on the second character (Index, from the books' colour plates):

- The head for the portrait is cut from the T-pose redraw above its arms (`crop_head.py --above-shoulders`): a portrait
  from another picture can disagree with the body (a green-tinted cover gave Index green hair and no hood), and a T-pose's
  arms at shoulder height read as hands at the neck.
- `--full`: a second picture at full length, for an outfit the setting picture cuts off (Index's robe to the floor).
- The base layer keeps the character's build in fitted grey clothes with the hair pulled into a bun, so long hair is not
  baked into the base body (it could not swing); a one-piece bodysuit prompt gave Index an adult figure and was dropped.
  `mannequin.py` turns every face outward (half of one base body faced inward).
- The hair's colour labels are found from the portrait's own face points (`hair_rig.py`), chains get links by length.
- A missing face point is filled from its mirror partner (`face_rig.py`).

References from the books: `find_refs.py <album-root> <name> <out-dir>` after the album portrait tool
(`tools/album-portraits/portraits.py`, OCR of the plates' name captions, run per volume): the caption matches are grouped
by CCIP character identity (imgutils; two of Index's six caption matches were someone else's face), then every head in
every picture, covers included, is searched for the same character, cropped with the YOLO full-body detector, crowded
boxes ranked down and figures that are mostly bare skin (swimwear) left out. It proposes; the choice is reviewed.

The neck seam's height is kept on the armature (`neck_seam_z`, written by `dress_rig.py`) apart from the head's pivot;
`head_swap.py`, `layer_pack.py` and `head_lock.py` read it.

Tokens live in Windows Credential Manager (`vault.py`), never in files.

## Known issues at v0.5

- The thigh still bends slightly unnaturally in deep hip flexion (linear blend skinning collapse at the hip). Fixed in v0.6.
- The winter uniform shows 38–45 over-long triangles in walk and run.
- Spring stiffness and stretch limits are first guesses; phone performance not measured (about 16 ms a frame on a laptop).

## Known issues at v0.6

- The winter uniform's over-long triangles in walk and run remain.
- About 21 ms a frame on a laptop; phone performance not measured.
- Spring stiffness, stretch limits and the 80% depth rule are first guesses.

## Known issues at v0.7

- Built on two characters (Misaka, a short bob; Index, long hair under a hood). Twin tails and braids would need
  per-lock chains found by distance from the scalp, not the ring this build hangs; untested.
- Wide sleeves fused to the body (Index's bell sleeves, her veil's sides) stay out sideways when the arms come down
  (body edges up to 40x in arms-down poses, against about 10x for Misaka): the rig finds an arm by what connects to the
  hand, which a sleeve fused into the robe defeats.
- `find_refs.py` and the album portrait tool find a character's pictures; the final choice of setting picture is still
  reviewed (on Index the automatic first pick was a crowded page).
- The head mesh is coarse at the mouth (the jaw region is 34 points), so opening the jaw stretches the cheeks' triangles
  up to 3.9×. Fine for talking; a wide-open mouth would need a denser head.
- The seam between the head and the clothes still opens in big neck turns as in v0.6 (the clothes keep v0.6's weights);
  the worst spots are where the side hair rests on the shoulders. Making the clothes follow the head's rule closed it but
  dragged the collar (twice v0.6's stretched edges), so it was left out.
- A jump flips the hair a long way (258 mm peak to peak at the tips): lively, never inside the head, but more than real
  hair of this length would.
- One ring chain (+60°) found too little hair and was skipped, so the sides are not symmetric (7 ring chains, not 8).
- The hair droops 7 mm from its drawn shape at rest; the spring values and cone limits are tuned on one character.
- No eye bones (the eyes are part of the head mesh; gaze would not show on the wireframe).
- RTMW found all 68 face points on this grey head; a head where it fails has no geometric fallback yet.

## Raw merge, steady 1 (2026-11-16, tag `figures-raw-steady-1`)

Marked steady on Akane: TRELLIS.2 body and base body from one job, Hunyuan head bust merged raw with the neck as one tube,
reduced with a finer head, the base body laid inside by elastic bone matching, a skeleton from the model's own 3D landmarks
on a filled solid, soft cloth with a measured split. `make_figure.py` ends at `figure_m.txt`. At this tag the old graft path
(Hunyuan body, bust grafted after the rig, face organs, hair springs) is still in the file beside it; the commit after it
removes that path's replaced steps. Not yet on the merged figure: head lock and jaw, hair springs, face organs, joint
smoothing. Details and measurements: `rawmerge/README.md`.

## After steady 1: the replaced path removed (2026-11-16)

`make_figure.py` went from 47 steps to 22 and is the raw-merge pipeline only. Removed steps: `left`, `right`, `base_back`
(views drawn only for the Hunyuan shapes), `shape`, `base_shape`, `rig`, `holo`, `marks_body`, `head`, `joints`,
`base_rig`, `base_holo`, `mannequin`, `layers`, the diagnostic `raw_layers` and `holo_page`, and the steps that only ran on
that path's output: `lock`, `face_rig`, `hair`, `crop_read`, `eyes_read`, `eyes`, `check`, `judge`, `page`.
Removed scripts: `layer_pack.py`, `mannequin.py`, `head_swap.py`; the template and quad heads (`fit_template.py`,
`template_head.py`, `head_from_fit.py`, `export_head.py`, `quad_head.py`, `draw_quads.py`); early trials (`qwen_apose.py`,
`qwen_try.py`, `anypose.py`, `stdgen_run.py`, `find_spaces.py`, `space_api.py`, `inspect_blend.py`); the side-view
prompts; in `rawmerge/` the earlier merge versions (`cut_raw.py`, `neck_raw.py`, `neck3_raw.py`, `blend_raw.py`), the
failed `volume_weights.py`, `shot_head.py`, `layers_raw.py`, and `skin.py`'s unused modes.
Kept, waiting to be moved onto the merged figure: `head_lock.py`, `face_rig.py`, `hair_rig.py`, `eye_shapes.py`,
`eye_parts.py`, `face28.py`, `smooth_joints.py`, `check_head.py`, `judge.py`, `pose_shots.py`. Kept as they are: the
clothing-system and text-to-motion experiments, `find_refs.py` and the render tools. The sections below describe the
earlier path as it was.

## After v0.9: the raw merge (2026-11-15, not yet a version)

The head bust is merged onto the body before any rig (`rawmerge/README.md`): the body from TRELLIS.2 (the T-pose front
alone, a paid Hugging Face Job), the head from the Hunyuan3D-2.1 bust, the neck one continuous tube carried along the
body's neck bone into the head. `make_figure.py` steps `body_cut`, `body_t2`, `raw_merge`, `reduce`, `holo_page`. The
merged figure is reduced to about 12,000 triangles (Akane: 12,136), on average within the merge's own surface noise.
The rig, face and hair steps still run on the Hunyuan body with the bust grafted after the rig; moving them onto the
merged figure is the next step. Tested on Akane only.

## After v0.9: staging and views (2026-11-14, not yet a version)

Found by running the whole pipeline, untouched, on two new characters (Akane and Rikka of SSSS.Gridman, one picture each):

- **The Hunyuan3D-2.1 Space ignores extra views.** A body made from the front alone and one made from front, back, left and
  right were the same to the last point. Every figure until now (Misaka, Index) was shaped from its front picture alone;
  the back views were drawn and never used. Views shape the result only on the Hunyuan3D-2mv Space (`hunyuan_shape.py
  --model=2mv`; its left view is the profile facing the picture's left edge). The body is now made from four views (new
  steps `left`, `right`); on Akane it recovered the closed hoodie, drawstrings and hood that the front-only shape had read
  as an open jacket. The base body and the head's bust still come from one picture each.
- **MiniMax H3-Image redraws** (`edit_h3.py`, the default): truer to the character than Qwen-Image-Edit (hair colour, vest,
  emblem, scrunchie kept; fingers together, where Qwen's spread fingers became claw- and blade-like hands). Its risks: feet
  close together, a smaller figure in the frame. Licence: not in the US, the EU, the UK or South Korea.
- **The portrait stage**: the redraw added hands at the shoulders on every character (Misaka's and Index's included), which
  became lumps on the bust. The prompt now ends the picture at the shoulders; `hands_check.py` (RTMW's 21 hand points, 19
  needed; real hands gave 21, hair at a cut neck up to 17) redraws with the next seed. The original picture goes in as a
  second reference (`{design}`), and the portrait must fill the picture: with two references and no size given, H3 copied
  the crop's small head, the bust came out at the wrong size (eye-chin and ear scales 0.11 against 0.18) and the skull lock
  found no chin.
- **Fixes**: a see-through input (WebP, PNG) is laid on white (its hidden colour came out as a noisy green background); a
  bust starting at a forward collar no longer hides the chin (`head_lock.py` falls back to the furthest-back slice so far,
  only when its first rule finds nothing: Misaka's and Index's chins unchanged); the face cut for the nose takes only the
  front skin (it could reach triangles behind the face seen from the front); `make_figure.py` re-runs itself in the
  pipeline's own Python.

| Character, builder | Organ points under the skin | Head edges past 1.25×: turn / jaw open | Hands |
|---|---|---|---|
| Akane, Qwen, front-only shape | 0 | 293 / 61 | claws |
| Akane, H3, front-only shape | 1 (2.5 mm) | 273 / 98 | natural |
| Rikka, Qwen, front-only shape | 79 (up to 71 mm; bangs over the eyes) | 45 / 35 | blades |
| Rikka, H3, front-only shape | 11 (4 mm) | 145 / 138 | one blade, one spike |

Found next, checking each stage's own output (2026-11-14, afternoon):

- **The face's organs sat beside the face** on the new characters (Akane 27 mm, Rikka 23 mm). `face_rig.py` made the 68
  face points symmetric about the head bone's plane; a grafted bust can sit a little to one side of the bone, and the
  averaging pulled the whole face toward it. Now symmetric about the face's own middle (the median of its mirror pairs);
  the pivot and the jaw hinge stay on the bone. Akane's asymmetry 54.8 → 6.6 mm; Index's middle is 2.4 mm from its bone.
- **A rerun could hide a failure.** `make_figure.py` takes a step's output file as proof it ran; a rerun into a folder that
  already held an earlier run's file went on with that file when the step failed (Rikka's later builds silently reused an
  earlier face, so her numbers did not move). A step now removes its old output before it runs.
- **Rikka's bust came back as a flat card** (21% as deep as wide) once the portrait filled the picture: her hair reached
  the edges and the shape model took the whole picture for the object. The portrait now gets an 18% white margin before
  the bust is shaped, and a bust under 35% as deep as wide stops the build (Akane 73%, Index 97%, Rikka now 79%).
- **The base body for the clothes' layers** (the hidden `LayerBody`; the soft layers measure every clothes point against
  it) carried a floor plate on Akane and Rikka: a ground shadow drawn under the feet came back as a plate joined to the
  soles, 1.3 m deep. `mannequin.py` now cuts everything at floor level outside the legs' footprint after the remesh, closes
  the soles, smooths 30 times instead of 12 (no fabric wrinkles left), and stops the build if the body is deeper than 0.6 m.

- **The head is now the body model's own** (`make_figure.py --head=native`, the default; `--head=bust` keeps the grafted
  bust). The bust shaped from the portrait looked stuck on, its back was a guess, and the graft sat it 20–27 mm to one side
  of the head bone. Head edges stretched past 1.25× in a head turn: Akane 216 → 3, Rikka 276 → 26; looking up 94 → 2 and
  198 → 9; the face's middle is now 0.4 and 2.9 mm from the bone. The head is cut above the neck line *and* within a head's
  width of the face's middle (0.8 × the ear distance): in a T-pose the arms are level with the neck line, and a cut by height
  alone gave the head the arms' tops (a flat bar left standing out when the arms came down; the bust version had cut them off
  the body). The native face is coarser than the bust's, and a long lock can be cut at the head's width (Rikka's cheek).
  The portrait is still drawn: the eyes, face points and hair are read from it.

- **The bust is the head again, mapped automatically** (`--head=bust`, the default again the same day; the user: "we
  still need the head bust step"). Three models, one job each: the four-view body for proportions, the smoothed base body
  for the layers and needles, the bust for the face. The bust is placed by the face points, then fitted in 3D onto the
  body's own head (`head_swap.py --fit=icp`, the default; `--fit=landmarks` the old placement): one scale, turn and move,
  fitted both ways, trimmed to the nearest 85% of pairs. On Akane the landmark placement left the bust too big and to one
  side (eye-to-chin said ×0.226, ear width ×0.185); the fit scaled it a further ×0.93 and the head surfaces' gap fell from
  13.5 to 9.3 mm. The organs are placed from the portrait's own 28 points straight onto the bust (`bust_map` on the
  armature: the portrait's figure box, the bust's bounds at import, the graft's placement), not through the T-pose's head
  crop. The native head's finer variant (the raw shape at 12,000 triangles) stretched 444 face edges in a head turn: its
  head-to-neck weight ramp ran about 7× steeper (0.3 of the weight across one 4 mm edge).
  Akane rebuilt from the graft on (`build_fit`, against the landmark-placed `build_mv`): the head is now the body's
  size, and the neck seam opens far less (turn 110 → 14 mm, nod 73 → 13, look up 83 → 11); jaw-open stretch 119 → 83.
  Head edges past 1.25× rose (turn 216 → 312, nod 100 → 231): the worst are slivers 1–5 mm long on the cut rim
  (neck size ×1.25–1.3) with the head-to-neck weight changing 0.15–0.3 across them, in both builds; the ramp and the cut
  rim are the next fix, not the fit. Open: the hood-edge spike on the body beside the chin (the bigger bust hid it), a
  hole in the bust's hair on the right side, the face 8.5 mm off the bone.

- **Machine judgement in the loop, first try** (the user: "The numbers are hard-coded. We need a ml in the loop"; "try
  jev and neck unified skeleton centralizing"). `judge.py` renders the finished figure in its test poses (`pose_shots.py`)
  and asks Jev (TypeSafe's decision model, key from the vault) fixed questions about each pose: a spike, a tear, the
  neck's quality, the face's parts, the head's size; one score per build (`judge` step). Jev's score levels must be sent
  as a list (the console's client sends a map; the API refused it). `marks3d.py` renders the body's head and shoulders
  and the bust from seven angles, finds RTMW's 133 points in each and triangulates them (no surface hits needed);
  `head_swap.py --fit=both` fits the bust to the body's surface and to those landmarks together, each kind weighted by its
  own typical miss (no set share). The face's mirror pairs set a middle; the neck and head bones go onto the body's own
  mirror plane. Akane, head edges past 1.25x and seam opening (mm) in nod / look up / turn; face middle to head bone:

  | build | placement | nod | look up | turn | face to bone | Jev |
  |---|---|---|---|---|---|---|
  | build_mv | face points | 100 / 73 | 94 / 83 | 216 / 110 | (27 before the face rig) | 0.020 |
  | build_fit | + surface fit | 231 / 13 | 264 / 11 | 312 / 14 | 8.5 mm | 0.008 |
  | build_fit2 | + face centred | 236 / 28 | 264 / 47 | 360 / 79 | 0.4 mm | 0.007 |
  | build_fit3 | surface + 3D landmarks | 102 / 14 | 192 / 20 | 219 / 19 | 9.9 mm | 0.007 |

  A rigid placement cannot have both: the bust's face and its neck do not line up with the body's the same way, so
  centring the face opens the seam and closing the seam moves the face. Landmarks alone (no surface) tilted the bust 12
  degrees and made it 11% too big: the body's coarse face misleads the detector. Jev ranks the builds but barely tells
  them apart (its tear answer is 0.6-0.9 on all), so it is not yet a judge an optimiser can trust. The "arms down" test
  pose turns the arms about their own length instead of lowering them (also in check_head.py).

- **No tuned numbers or hand rules** (the user: "No hardcoding or rules for anywhere in the pipeline"; "Solve all 10").
  An audit of the steps make_figure.py runs found about 160 tuned numbers and 91 hand rules. All of them were replaced
  by measurements on the character's own meshes, rig weights and detector output, by robust statistics (Cauchy weights by
  the median miss instead of trims and cut-offs), by solved fields (harmonic weights, the heat equation), or by searches
  against measured stretch. What stays is listed in each script as STRUCTURAL (render sizes, view angles, VRM bone names,
  detectors' point layouts, test poses) or NUMERIC (tolerances, caps). By area:
  - picture to mesh: `view_register.py`, the picture's figure outline fitted onto the mesh's front outline (one scale, a
    turn, a move), replacing the figure box stretched onto the bounding box (rig, joints, hair, organs);
  - neck seam, skeleton, arms, skirt (`dress_rig.py`, `holo_detail.py`): cross-sections of the mesh; the seam between the
    collar's step back and the chin's step forward; bone heat solved in numpy where Blender's finds no solution;
  - the bust onto the body: the `marks` stage (`engine/characters/marks/`), both heads' 3D landmarks (RTMW from seven
    angles, triangulated) and both surfaces; cut by the rig's own weights; the bust reduced to the body's triangle size;
  - head and jaw weights (`head_lock.py`, `face_rig.py`): harmonic between where a bone surely owns the skin (above the
    chin, the face inside its outline; below the lower lip) and where it surely does not; the pivot by a stretch search;
    the face points from the marks stage (the face_render and face_marks steps are gone);
  - limb bends, base body (`smooth_joints.py`, `mannequin.py`): each joint's measured radius times a searched ratio;
    Taubin smoothing with the pass count at the least crease; the floor plate found by slab areas;
  - hair (`hair_rig.py`): hair by colour odds inside and outside the detected face, free hair by the air under it, one
    chain per lock found from the hair itself, springs from a pendulum under real gravity;
  - colours and crop (`prep_view.py`, `crop_head.py`, `hands_check.py`): a colour mixture sized by BIC and merged where
    it has no dip; hair and skin located by the face points; the head crop from the silhouette;
  - organs (`eye_shapes.py`, `eye_parts.py`): Otsu thresholds, depths in the bust's own relief unit, the nose measured
    on the bust;
  - the runner: the setting picture squared without extra margin (a T-pose's arm span equals the height); the portrait's
    margin so it fills the frame as the T-pose does; the least-sure portrait kept when every seed has hands.
  Still a choice, named in the code: the hair's motion targets (walk, run, shake, droop), the organs' depth law and the
  bust check's flatness bound. Slower: prep (colour mixtures) and the rig step take minutes instead of seconds.

Known open: Rikka's hands; her face stretches more with H3; white shards at the eye corners; the four-view builds of both
are being measured (this table gets their rows).

## Known issues at v0.9

- The mouth is a line on the head: it does not open with the jaw (the jaw still moves the chin and the face under the
  mouth).
- The nose's region is rebuilt at the face's own triangle size; a head with very large face triangles gives a coarse
  nose. Its tip follows the head's own nose, so a head whose nose sits off the portrait's (Index: 20 px to one side) keeps
  its own place.
- The brows are raised ridges, still the v0.8-era stroke reading; they are not yet checked against the drawing as the
  mouth is.
- Everything else as at v0.8 (eyes fixed in the drawn expression; anime-face-detector needed).

## Known issues at v0.8

- Only the eyes are carved; brows, nose and mouth are still the head's own triangles.
- The eyes do not move (no eye bones, no blinking); the lids are fixed in the drawn expression.
- The lash and the lower lid are read from one portrait; a closed or half-closed eye in that portrait would give a thin
  opening. The detector picks the most confident face; a portrait with two faces is not handled.
- The eyes need anime-face-detector (the album portrait tool's Python, `--portrait-py`); without it the build stops at
  `eyes_read`.
- The quad template experiments (`template_head.py`, `fit_template.py`, `export_head.py`, `head_from_fit.py`,
  `quad_head.py`, `draw_quads.py`) are kept as tools but not used by `make_figure.py`: a fitted template head wrapped the
  hair into a smooth helmet.
