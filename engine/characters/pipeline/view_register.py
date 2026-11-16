"""A picture onto a mesh seen from the front: the 2D similarity (one scale, a turn, a move) that lays the picture's figure
outline onto the mesh's front outline. Replaces stretching the picture's figure box onto the mesh's bounding box (two
independent scales, decided by whatever sticks out furthest: a hair tip, a raised toe, a shadow).
Pure numpy, so Blender's Python and the pipeline's both import it.

  reg = register(mask, P)          mask: the picture's figure (H x W, nonzero = figure); P: the mesh's points (N x 3, z up,
                                   the front seen along +y)
  x, z = reg.to_mesh(px, py)       picture pixel -> mesh x, z
  px, py = reg.to_img(x, z)        mesh x, z -> picture pixel

How: both outlines as point sets (the picture's figure boundary; the mesh's points projected to x, z, binned at the mesh's
own spacing (the median nearest-neighbour distance of the projected points), and the boundary of that occupancy). Start
from the two boxes' centres and the ratio of the outlines' spreads, then refine with a 2D fit both ways (each outline point
to its nearest point on the other), every pair weighted by a Cauchy weight of its miss over the median miss: points the two
outlines disagree on (a shadow in the picture, a lock the shape model dropped) fade by themselves; there is no cut-off."""
import numpy as np

def _boundary(occ):
    """the cells of an occupancy grid with an empty 4-neighbour (or on the grid's edge)"""
    p = np.pad(occ, 1)
    inner = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return occ & ~inner

def _nearest(A, B, chunk=512, exclude_self=False):
    """for each row of A, the index of and distance to its nearest row of B; a KD-tree when one is at hand (Blender's
    mathutils, or scipy), else brute force in chunks; exclude_self skips an exact copy of the row itself"""
    A = np.asarray(A, float); B = np.asarray(B, float)
    try:
        from mathutils.kdtree import KDTree
        pad = (lambda X: np.concatenate([X, np.zeros((len(X), 1))], 1)) if B.shape[1] == 2 else (lambda X: X)
        Ap, Bp = pad(A), pad(B); t = KDTree(len(Bp))
        for i, p in enumerate(Bp): t.insert(p, i)
        t.balance(); idx = np.empty(len(A), int); dist = np.empty(len(A))
        for i, p in enumerate(Ap):
            hits = t.find_n(p, 2) if exclude_self else [t.find(p)]
            h = next((h for h in hits if not (exclude_self and h[2] == 0)), hits[-1]); idx[i], dist[i] = h[1], h[2]
        return idx, dist
    except ImportError:
        pass
    try:
        from scipy.spatial import cKDTree
        d, i = cKDTree(B).query(A, k=2 if exclude_self else 1)
        if exclude_self: pick = (d[:, 0] == 0).astype(int); return i[np.arange(len(A)), pick], d[np.arange(len(A)), pick]
        return i, d
    except ImportError:
        return _nearest_brute(A, B, chunk, exclude_self)

def _nearest_brute(A, B, chunk=512, exclude_self=False):
    """for each row of A, the index of and distance to its nearest row of B (brute force in chunks); exclude_self skips
    an exact copy of the row itself"""
    idx = np.empty(len(A), int); dist = np.empty(len(A))
    for i in range(0, len(A), chunk):
        d = ((A[i:i + chunk, None, :] - B[None, :, :]) ** 2).sum(-1)
        if exclude_self: d[d == 0] = np.inf
        j = d.argmin(1); idx[i:i + chunk] = j; dist[i:i + chunk] = np.sqrt(d[np.arange(len(j)), j])
    return idx, dist

def _thin(P, n):
    """at most n points, evenly through the set (a deterministic stride, for speed only)"""
    return P if len(P) <= n else P[np.linspace(0, len(P) - 1, n).astype(int)]

def _similarity(A, B, w):
    w = w / w.sum(); ma, mb = w @ A, w @ B; a, b = A - ma, B - mb
    C = (b * w[:, None]).T @ a; U, D, Vt = np.linalg.svd(C); S = np.eye(2)
    if np.linalg.det(U @ Vt) < 0: S[1, 1] = -1
    R = U @ S @ Vt; s = float(np.trace(np.diag(D) @ S) / (w @ (a * a).sum(1))); return s, R, mb - s * R @ ma

class Registration:
    def __init__(self, s, R, t, report):
        self.s, self.R, self.t, self.report = s, R, t, report        # picture (px, -py) -> mesh (x, z)
    def to_mesh(self, px, py):
        q = np.stack([np.asarray(px, float), -np.asarray(py, float)], -1) @ (self.s * self.R).T + self.t
        return q[..., 0], q[..., 1]
    def to_img(self, x, z):
        q = (np.stack([np.asarray(x, float), np.asarray(z, float)], -1) - self.t) @ self.R / self.s
        return q[..., 0], -q[..., 1]
    def px_per_m(self): return 1.0 / self.s

def register(mask, P, budget=2000, iters=60):
    m = np.asarray(mask) > 0
    ys, xs = np.nonzero(_boundary(m)); img = np.stack([xs, -ys], 1).astype(float)          # picture outline (px, -py)
    P3 = np.asarray(P, float); Q = P3[:, [0, 2]]
    # the mesh's own spacing: the median distance from a point to its nearest other point, in 3D (front and back points
    # project onto each other, so the spacing is measured before the projection)
    S = _thin(P3, budget); _, nn = _nearest(S, P3, exclude_self=True); step = float(np.median(nn))
    lo = Q.min(0); ij = np.floor((Q - lo) / step).astype(int); occ = np.zeros(ij.max(0) + 1, bool); occ[ij[:, 0], ij[:, 1]] = True
    # a closing one cell wide (dilate, then erode): the projected points are binned at their own spacing, so a cell can
    # fall between neighbours; the closing fills those and nothing wider
    def dil(o): p = np.pad(o, 1); return p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] | p[:-2, :-2] | p[2:, 2:] | p[:-2, 2:] | p[2:, :-2]
    def ero(o): return ~dil(~o)
    occ = ero(dil(occ))
    bi, bj = np.nonzero(_boundary(occ)); mesh = lo + (np.stack([bi, bj], 1) + 0.5) * step     # mesh outline (x, z)
    A, B = _thin(img, budget), _thin(mesh, budget)
    s = float(np.sqrt(B.var(0).sum() / A.var(0).sum())); R = np.eye(2); t = B.mean(0) - s * A.mean(0)
    hist = []
    for it in range(iters):
        X = A @ (s * R).T + t
        f, d1 = _nearest(X, B); g, d2 = _nearest(B, X)
        src = np.concatenate([A, A[g]]); dst = np.concatenate([B[f], B]); d = np.concatenate([d1, d2])
        med = max(1e-9, float(np.median(d))); w = 1 / (1 + (d / med) ** 2); hist.append(med)
        s2, R2, t2 = _similarity(src, dst, w)
        if it > 3 and abs(s2 - s) < 1e-9 * abs(s) and np.abs(t2 - t).max() < 1e-9: break
        s, R, t = s2, R2, t2
    rep = {'scale_m_per_px': s, 'turn_deg': float(np.degrees(np.arctan2(R[1, 0], R[0, 0]))), 'median_miss_mm': [hist[0] * 1000, hist[-1] * 1000],
           'passes': len(hist), 'mesh_spacing_mm': step * 1000}
    return Registration(s, R, t, rep)
