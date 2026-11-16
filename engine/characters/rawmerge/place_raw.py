"""The raw head bust merged onto the raw body before any rig: python merge_raw.py <out-dir> <bust.glb> <bust-marks.json>
(needs <out-dir>/body_n.glb, whole.json, head.json from marks_raw.py). No rig, no bone weights; every value is measured.
  place    one scale, turn and move from both heads' 3D landmarks and both surfaces (marks/fit.place); the body's head is
           its points above its own chin landmark
  size     one scale and offset per axis so the bust's head lies on the body's own head, both ways (the proportion fit)
  axis     the neck axis runs from the middle of the body's shoulder landmarks to the middle of its ear landmarks
  seam     every level along that axis between shoulders and chin, a body edge apart: each model's neck outline is the
           smallest closed section that goes round the axis; the seam is the level where the two outlines differ least
  match    the bust's neck is reshaped so its outline at the seam IS the body's (a radial stretch about the axis, per
           direction), fading to nothing at the chin's level
  cut      each model is opened along its neck outline only: the body keeps what is still joined to the torso, the bust what
           is still joined to the head (hair that hangs past the seam stays with the head); loose pieces go with the side
           they lie nearer. If a model stays in one piece (hair grown into the shoulders), it is cut by the whole level
           instead. Both cuts are capped, so both parts are closed for the volume fusion.
  Writes body_cut.glb, bust_cut.glb, merge.json."""
import json, os, sys
import numpy as np, trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'marks'))
import fit
OUT, BUST, BUSTJ = sys.argv[1:4]; TOL = fit.TOL; CAP = fit.CAP
def load(p):
    m = trimesh.load(p, force='mesh', process=False); V = np.asarray(m.vertices, float); F = np.asarray(m.faces, np.int64)
    V, inv = np.unique(V.round(9), axis=0, return_inverse=True); F = inv.reshape(-1)[F]          # weld the file's split points
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1), F                                            # glTF axes to the figure's (z up, front -y)
def save(p, V, F): trimesh.Trimesh(np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1), F, process=False).export(p)
def med_edge(V, F): e = np.concatenate([F[:, :2], F[:, 1:]]); e = e[:: max(1, len(e) // 200000)]; return float(np.median(np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)))
Vb, Fb = load(os.path.join(OUT, 'body_n.glb')); Vh, Fh = load(BUST)
whole = json.load(open(os.path.join(OUT, 'whole.json')))['points']; head = json.load(open(os.path.join(OUT, 'head.json'))); bustm = json.load(open(BUSTJ))
P = lambda d, k: np.array(d[str(k)]['p'])
spacing = med_edge(Vb, Fb); print('MERGE body %d faces (median edge %.2f mm), bust %d faces' % (len(Fb), spacing * 1000, len(Fh)))
# ---- place
chin = P(head['points'], 31); is_head = Vb[:, 2] > chin[2]
M, rep = fit.place(Vh, Vb, is_head, head, bustm, spacing, log=lambda s: print(s.replace('FIG', 'MERGE')))
Vh = Vh @ M[:3, :3].T + M[:3, 3]
# ---- size: per-axis scale and offset, bust head onto the body's own head
nat = fit.thin(Vb[is_head], spacing); X0 = fit.thin(Vh, spacing); X0 = X0[is_head[cKDTree(Vb).query(X0)[1]]]
a, b = np.ones(3), np.zeros(3); tn = cKDTree(nat); hist = []
for it in range(CAP):
    X = X0 * a + b; d1, f = tn.query(X); d2, g = cKDTree(X).query(nat)
    src = np.concatenate([X0, X0[g]]); dst = np.concatenate([nat[f], nat]); w, med = fit.cauchy(np.concatenate([d1, d2])); hist.append(med); a2, b2 = np.empty(3), np.empty(3)
    for k in range(3):
        x, y = src[:, k], dst[:, k]; mx, my = (w * x).sum() / w.sum(), (w * y).sum() / w.sum()
        a2[k] = (w * (x - mx) * (y - my)).sum() / (w * (x - mx) ** 2).sum(); b2[k] = my - a2[k] * mx
    moved = np.abs(a2 - a).max() + np.abs(b2 - b).max(); a, b = a2, b2
    if moved < TOL: break
ext = lambda Q: np.round((np.percentile(Q, 99.5, 0) - np.percentile(Q, 0.5, 0)) * 1000)
print('MERGE size: scales across %.3f depth %.3f up %.3f after %d passes; head surface miss %.2f -> %.2f mm; body head extent mm %s, bust before %s, after %s'
      % (*a, it + 1, hist[0] * 1000, hist[-1] * 1000, ext(nat), ext(X0), ext(X0 * a + b)))
A = np.eye(4); A[:3, :3] = np.diag(a); A[:3, 3] = b
json.dump({'place': rep, 'M': M.tolist(), 'A': A.tolist(), 'T': (A @ M).tolist(), 'scales': a.tolist(), 'spacing': spacing, 'bust_edge': med_edge(Vh * a + b, Fh)}, open(os.path.join(OUT, 'place.json'), 'w'), indent=1)
print('MERGE place saved; bust median edge once placed %.2f mm' % (1000 * med_edge(Vh * a + b, Fh)))
