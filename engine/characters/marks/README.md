# marks: the head bust onto the full body

The figure is built from three models, one job each: the four-view **body** (proportions, skeleton, clothes), the smoothed
**base body** (the hidden layer the clothes are measured against), and the **head bust** shaped from the close portrait
(the face's detail). This folder is the step between the bust and the body: it finds the same points on both and places
the bust on the body by them. Nothing in it is a tuned number or a hand rule; every weight is measured on the character.

| file | does | runs in |
|---|---|---|
| `render.py` | renders a head and shoulders from seven angles; the body framed as the bust frames itself | Blender |
| `landmarks.py` | RTMW's 133 points in each render, triangulated to 3D, each ray weighted by the detector's confidence | the pipeline's Python |
| `fit.py` | the placement (`place`): landmarks first, then surfaces and landmarks together, Cauchy-weighted by the median miss; the mirror plane (`mirror_plane`) | imported by `pipeline/head_swap.py` |

Order in `pipeline/make_figure.py`: `marks_bust` (the bust's points; they set how far below the shoulders the body's
renders reach), `marks_body`, then `head` (`head_swap.py`: place, set the neck and head bones on the trunk's mirror plane,
cut both at the rig's neck seam by the rig's own weights, reduce the bust to the body's triangle size). The bust's points,
carried by the placement (`rig['bust_map']`), are also the face's points for `head_lock.py` (chin and jaw line) and
`face_rig.py` (the 68 points, the jaw hinge at the ears).

What stays fixed, and why: the seven view angles, 768 px renders and a 4% frame margin (the detector needs the figure
whole and off the frame's edge), RTMW's point layout and mirror pairs, and the numeric stopping rules (a change below the
square root of machine precision, or a cap on passes).
