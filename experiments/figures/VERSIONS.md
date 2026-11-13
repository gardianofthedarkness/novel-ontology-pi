# Figure pipeline versions

Rigged hologram figures for the novel's characters (design §8.6, milestones F10–F13). Code only lives here: the
characters' pictures, generated models and VRM files are copyrighted fan material and stay on the working machine
(`E:\figures`), never in this public repository.

| Version | Status | Pipeline structure |
|---|---|---|
| v0.1 | superseded | A-pose redraw (Qwen-Image-Edit) → shape (Hunyuan3D-2.1) → joints (RTMPose) → colour blocks by projection → rig (`dress_rig.py`) |
| v0.2 | superseded | T-pose redraw → shape → rig → ~16k-triangle hologram mesh (`holo_detail.py`, arms by connectivity) → outfits as whole bodies on one skeleton (`compose_outfits.py`) |
| v0.3 | benchmark | v0.2 + face-and-hair-locked redraw + a high-resolution head from a portrait (`head_swap.py`) |
| v0.4 | experiments | wardrobe from the books (`epub_scan.py`, `garments.py`, `cloth_settle.py`), joint smoothing (`smooth_joints.py`), skirt spring bones (`skirt_rig.py`), separate base body + clothes (`body_fit.py`, `mannequin.py`) |
| **v0.5** | **stable** | the v0.3 one-shot figure kept whole as the surface, its generated base body underneath as a hidden layer (`layer_pack.py`); in the viewer each point's distance from the base body is its layer thickness: thin points stay on the skeleton, thick points hang on soft springs (stretch limit, 25% edge limit, leg and torso capsules), fast CPU skinning (`viewer/index.html`) |

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

Tokens live in Windows Credential Manager (`vault.py`), never in files.

## Known issues at v0.5

- The thigh still bends slightly unnaturally in deep hip flexion (linear blend skinning collapse at the hip).
- The winter uniform shows 38–45 over-long triangles in walk and run.
- Spring stiffness and stretch limits are first guesses; phone performance not measured (about 16 ms a frame on a laptop).
