"""The raw figure's layer thickness carried onto the reduced figure: python layers_raw.py <merged.glb> <thick.npy> <reduced.glb> <out.glb> <out.json>
Each reduced point takes the thickness of the raw figure's surface around it: the mean over the raw points nearer to it than to
any other reduced point (so a large triangle's corner speaks for its whole neighbourhood, not for one raw point). Points of the
head (no thickness on the raw figure) stay without. Writes the reduced figure with the thickness as its vertex colour (red =
thickness over the figure's largest, alpha 0 = head) and the numbers."""
import json, sys
import numpy as np, trimesh
from scipy.spatial import cKDTree
FIG, TH, RED, OUT, REC = sys.argv[1:6]
def load(p):
    m = trimesh.load(p, force="mesh", process=False); return np.asarray(m.vertices, float), np.asarray(m.faces)
Vf, _ = load(FIG); Vf = np.unique(Vf.round(9), axis=0); th = np.load(TH).astype(float)      # the same point order base_raw.py measured in
if len(th) != len(Vf): raise SystemExit("LAYERS: the thickness is not this figure's (%d values, %d points)" % (len(th), len(Vf)))
Vr, Fr = load(RED); Vr, inv = np.unique(Vr.round(9), axis=0, return_inverse=True); Fr = inv.reshape(-1)[Fr]      # the file repeats a point per triangle corner
_, own = cKDTree(Vr).query(Vf); has = ~np.isnan(th)
n_all = np.bincount(own, minlength=len(Vr)); n_has = np.bincount(own[has], minlength=len(Vr)); s = np.bincount(own[has], th[has], len(Vr))
head = n_has * 2 < np.maximum(n_all, 1)                    # STRUCTURAL: a reduced point is the head's when most of its raw points are
t = np.where(n_has > 0, s / np.maximum(n_has, 1), np.nan); t[head] = np.nan
miss = np.isnan(t) & ~head                                 # a reduced point no raw point is nearest to: its nearest raw point's value
if miss.any(): _, j = cKDTree(Vf[has]).query(Vr[miss]); t[miss] = th[has][j]
top = float(np.nanmax(t)); u = np.nan_to_num(t / top, nan=0.0)
col = np.stack([255 * u, 255 * (1 - u), np.full(len(u), 255.0), np.where(np.isnan(t), 0, 255)], 1).astype(np.uint8)
trimesh.Trimesh(Vr, Fr, vertex_colors=col, process=False).export(OUT)
q = np.nanpercentile(t, [5, 25, 50, 75, 95]) * 1000
json.dump({"points": int(len(Vr)), "head_points": int(head.sum()), "largest_mm": round(top * 1000, 2), "thickness_mm_5_25_50_75_95": q.round(2).tolist(),
           "thickness_mm": [None if np.isnan(x) else round(float(x) * 1000, 2) for x in t]}, open(REC, "w"))
print("LAYERS %d reduced points: %d of the head (no thickness); thickness 5%% %.1f, 25%% %.1f, median %.1f, 75%% %.1f, 95%% %.1f mm, largest %.1f mm" % (len(Vr), head.sum(), *q, top * 1000))
