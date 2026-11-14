# engine/characters

The character engine: each person of a universe as a rigged figure, drawn as a triangle hologram and moved on its bones
(design [§8.6](../../docs/v3/design.html#figures)). Code only: the characters' pictures, the generated shapes and the
figures are made from copyrighted material and stay in the user's library, never in this repository.

| Path | What it holds |
| --- | --- |
| `pipeline/` | the steps from pictures to a figure: Hugging Face Space clients (`edit.py`, `hunyuan_shape.py`, `t2m_*.py`), Blender scripts run headless (`dress_rig.py`, `holo_detail.py`, `compose_outfits.py`, `head_swap.py`, `smooth_joints.py`, `mannequin.py`, `layer_pack.py`, ...), checks (`proportions.py`, `head_compare.py`) and `vault.py` (tokens in the system's credential store, never in files) |
| `viewer/index.html` | the figure page: three.js + three-vrm, the triangle hologram, motions on the VRM humanoid bones, the soft layers and the rigid needles |
| `VERSIONS.md` | which pipeline structure is stable (v0.6 now), its steps in order and its known issues |
| `../../src/characters/figures.ts` | the store beside the universe's cast and EM's assignment ([§8.6, figures in the warehouse](../../docs/v3/design.html#figure-warehouse)) |

## From a made figure to a person

1. Make the figure with the pipeline (`VERSIONS.md`, "v0.5 in order", plus v0.6's viewer): the result is one VRM 1.0
   (the figure and its hidden `LayerBody`).
2. `novel figure add <novel-dir> <figure.vrm> --name "Misaka Mikoto" --forms 御坂美琴 --outfits summer,winter --pipeline v0.6 --why "..."`
   puts it in `<library>/figures/<universe>/`, measured, as the warehouse part `figure:misaka-mikoto`.
3. EM assigns it the way the album's portraits are assigned: a name that is one person's binds at once; EM's merges carry it
   to the survivor; what is left is a task (`novel figure tasks`) for the main agent, who runs
   `novel figure assign <novel-dir> <figure> <person> --why ...` (or `novel warehouse use figure:<id> for person:<person> <novel-dir> --why ...`)
   or leaves it unassigned.
4. `novel figure list <novel-dir>` shows every figure with its person; `novel warehouse find "<name>" <novel-dir>` finds it.

The scripts need Blender 5.x with the VRM add-on, Python with `gradio_client`, and a Hugging Face account for the Spaces
(the user's own token, kept by `vault.py`).
