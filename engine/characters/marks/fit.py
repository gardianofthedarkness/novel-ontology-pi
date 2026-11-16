"""Place the bust on the body: one scale, turn and move, from both heads' 3D landmarks and both surfaces together.
Imported by pipeline/head_swap.py (inside Blender); pure numpy plus a nearest-point tree (Blender's mathutils.kdtree when
there, else scipy's cKDTree).

  M, report = place(bust_pts, body_pts, body_is_head, body_marks, bust_marks)

Every weight is measured, none is set:
  start      the similarity that best lays the bust's landmarks on the body's (Umeyama, weighted by both detectors'
             confidence, repeated with Cauchy weights 1/(1+(r/median r)^2) until it settles), pulled hardest along the
             face's middle (each mirror pair adds its midpoint as a point, the middle points count fully)
  regions    the body's head is the body's points the rig weights mostly to the head or neck bone (its own bone heat);
             the bust's head is, on each pass, the bust points whose nearest body point is one of those (so the bust's
             shoulders and collar drop out by themselves, wherever the body's shoulders are)
  refine     surface pairs both ways (bust to body and body to bust, so neither can shrink inside the other) and the
             landmark pairs, each pair Cauchy-weighted by its miss over its kind's median miss; the two kinds balanced by
             the inverse of their median miss squared (the maximum-likelihood balance of two measurements of different
             precision), each kind's total counting once
  stop       when the placement stops moving (NUMERIC: a relative change below machine precision's square root, or a cap
             on passes)"""
import numpy as np

F68 = {i: 23 + i for i in range(68)}                      # STRUCTURAL: RTMW's layout (68 face points after 23 body/feet)
MIRROR68 = [(i, 16 - i) for i in range(8)] + [(17 + i, 26 - i) for i in range(5)] + [(31, 35), (32, 34)] + \
           [(36, 45), (37, 44), (38, 43), (39, 42), (40, 47), (41, 46)] + [(48, 54), (49, 53), (50, 52), (55, 59), (56, 58), (60, 64), (61, 63), (65, 67)]
PAIRS = [(F68[a], F68[b]) for a, b in MIRROR68] + [(1, 2), (3, 4)]    # eyes, ears
HEAD = set([0, 1, 2, 3, 4]) | set(range(23, 91))           # the points a head has: nose, eyes, ears, the 68 face points
TOL = np.finfo(float).eps ** 0.5                           # NUMERIC
CAP = 200                                                  # NUMERIC: passes at most

def tree(P):
    P = np.asarray(P, float)
    try:
        from mathutils.kdtree import KDTree
        t = KDTree(len(P))
        for i, p in enumerate(P): t.insert(p, i)
        t.balance()
        def q(X):
            r = [t.find(x) for x in X]; return np.array([h[1] for h in r]), np.array([h[2] for h in r])
        return q
    except ImportError:
        from scipy.spatial import cKDTree
        t = cKDTree(P)
        def q(X): d, i = t.query(X); return i, d
        return q

def cauchy(r):
    med = float(np.median(r)); med = med if med > 0 else TOL
    return 1 / (1 + (r / med) ** 2), med

def umeyama(A, B, w):
    w = w / w.sum(); ma, mb = w @ A, w @ B; a, b = A - ma, B - mb
    C = (b * w[:, None]).T @ a; U, D, Vt = np.linalg.svd(C); S = np.eye(3)
    if np.linalg.det(U @ Vt) < 0: S[2, 2] = -1
    R = U @ S @ Vt; s = float(np.trace(np.diag(D) @ S) / (w @ (a * a).sum(1))); return s, R, mb - s * R @ ma

def pairs(body, bust):
    """the landmark pairs (bust point, body point) the two heads share, with the detectors' joint confidence; each mirror
    pair adds its midpoint, so the face's middle line carries the most weight"""
    pb, ph = body['points'], bust['points']
    def get(P, j): return np.array(P[str(j)]['p'])
    def conf(j): return pb[str(j)]['score'] * ph[str(j)]['score']
    src, dst, w = [], [], []
    for j in sorted(HEAD):
        if str(j) in pb and str(j) in ph: src.append(get(ph, j)); dst.append(get(pb, j)); w.append(conf(j))
    for a, b in PAIRS:
        if all(str(j) in pb and str(j) in ph for j in (a, b)):
            src.append((get(ph, a) + get(ph, b)) / 2); dst.append((get(pb, a) + get(pb, b)) / 2); w.append(conf(a) + conf(b))
    return np.array(src), np.array(dst), np.array(w)

def apply(s, R, t, X): return s * X @ R.T + t

def landmark_fit(src, dst, w0):
    s, R, t = umeyama(src, dst, w0)
    for _ in range(CAP):
        w, _ = cauchy(np.linalg.norm(apply(s, R, t, src) - dst, axis=1))
        s2, R2, t2 = umeyama(src, dst, w0 * w)
        moved = abs(s2 - s) / s + np.abs(R2 - R).max() + np.abs(t2 - t).max() / s
        s, R, t = s2, R2, t2
        if moved < TOL: break
    return s, R, t

def thin(P, cell):
    """one point per cubic cell of the given size (the first one met): a surface sampled at that spacing"""
    k = np.floor(P / cell).astype(np.int64); _, i = np.unique(k, axis=0, return_index=True); return P[np.sort(i)]

def place(bust_pts, body_pts, body_is_head, body_marks, bust_marks, spacing, log=print):
    """spacing: the body's own median edge; the bust is sampled at the same spacing once the landmarks have set its scale,
    so each surface counts by its area, not by how finely its model happened to be made"""
    ls, ld, lw = pairs(body_marks, bust_marks)
    s, R, t = landmark_fit(ls, ld, lw)
    r0 = np.linalg.norm(apply(s, R, t, ls) - ld, axis=1)
    log('FIG place: start from %d landmark pairs, scale %.4f, median miss %.1f mm' % (len(ls), s, 1000 * np.median(r0)))
    body_pts = np.asarray(body_pts, float); bust_pts = thin(np.asarray(bust_pts, float), spacing / s)
    log('FIG place: the bust sampled at the body spacing (%.1f mm): %d points' % (1000 * spacing, len(bust_pts)))
    near_body = tree(body_pts); head_body = body_pts[body_is_head]
    hist = []
    for it in range(CAP):
        X = apply(s, R, t, bust_pts)
        f, d1 = near_body(X); keep = body_is_head[f]                       # the bust's head: nearest body point is head
        Xi, Si = X[keep], bust_pts[keep]
        g, d2 = tree(Xi)(head_body)
        A = np.concatenate([Si, Si[g]]); B = np.concatenate([body_pts[f[keep]], head_body]); ds = np.concatenate([d1[keep], d2])
        ws, ms = cauchy(ds)
        lr = np.linalg.norm(apply(s, R, t, ls) - ld, axis=1); wl, ml = cauchy(lr); wl = wl * lw
        W = np.concatenate([ws / ws.sum() / ms ** 2, wl / wl.sum() / ml ** 2])
        s2, R2, t2 = umeyama(np.concatenate([A, ls]), np.concatenate([B, ld]), W)
        moved = abs(s2 - s) / s + np.abs(R2 - R).max() + np.abs(t2 - t).max() / s
        hist.append((ms, ml, int(keep.sum())))
        s, R, t = s2, R2, t2
        if moved < TOL: break
    M = np.eye(4); M[:3, :3] = s * R; M[:3, 3] = t
    ang = np.degrees(np.arctan2([R[2, 1], -R[2, 0], R[1, 0]], [R[2, 2], np.hypot(R[2, 1], R[2, 2]), R[0, 0]]))
    rep = {'scale': s, 'turn_deg': ang.round(2).tolist(), 'passes': len(hist), 'landmark_pairs': int(len(ls)),
           'surface_median_miss_mm': [round(1000 * hist[0][0], 2), round(1000 * hist[-1][0], 2)],
           'landmark_median_miss_mm': [round(1000 * hist[0][1], 2), round(1000 * hist[-1][1], 2)], 'bust_head_points': hist[-1][2]}
    log('FIG place: %s' % rep)
    return M, rep

def mirror_plane(P):
    """the plane a shape is most nearly mirror-symmetric about (unit normal n, offset d: n.p = d): reflect the points in
    the current plane, pair each reflection with its nearest original, refit the plane through the pairs' midpoints with
    the pairs' directions as its normal, every pair Cauchy-weighted by its miss"""
    P = np.asarray(P, float); q = tree(P); n = np.array([1.0, 0, 0]); d = float(np.median(P[:, 0]))
    for _ in range(CAP):
        Rf = P - 2 * ((P @ n) - d)[:, None] * n
        i, dist = q(Rf); Q = P[i]; w, med = cauchy(dist)
        v = Q - P; m = (Q + P) / 2
        v = np.where(((v @ n) < 0)[:, None], -v, v); ln = np.linalg.norm(v, axis=1); ok = ln > 0
        n2 = (w[ok, None] * v[ok] / ln[ok, None]).sum(0); n2 /= np.linalg.norm(n2); d2 = float((w @ (m @ n2)) / w.sum())
        moved = np.abs(n2 - n).max() + abs(d2 - d)
        n, d = n2, d2
        if moved < TOL: break
    return n, d, med
