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
| **v0.7** | **stable** (tag `figures-v0.7.0`) | v0.6 + a face and hair of their own, for any character from a setting picture (`make_figure.py`, below). Skull lock (`head_lock.py`, on the Head mesh only): the head owns the head, the neck only the column under a jaw plane; the clothes and the base body keep v0.6's weights (the first v0.7 build also rewrote them by height and, in a T-pose, caught the arms: the arms and shoulders ballooned). Face points (`face_render.py`, `face_marks.py`: RTMW's 68 face points on grey renders of the head, 68 of 68 found in all three views) cast onto the mesh (`face_rig.py`); the head pivot moved up to the skull base; a VRM `jaw` bone hinged between the ears. Hair (`hair_rig.py`): the portrait's labels mapped onto the head through the face points, a solid-or-sheet test for cheeks under side locks, ten spring chains from the scalp line (three bangs, seven around), hair touching skin eased into its chain over 2 cm (no cut). Viewer: springs at a fixed 1/60 s posed at their own time, cone limits per link. See "v0.7 measured" |

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
