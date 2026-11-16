"""The raw base body laid inside the raw merged figure, with no head, and the figure's layer thickness measured from it.
python base_raw.py <merged.glb> <figure whole.json> <tube.json> <base body_n.glb> <base whole.json> <out-dir>
  joints   one scale, turn and move laying the base's body joints on the figure's (RTMW's shoulders to feet, triangulated on
           each raw model by marks_raw.py; Cauchy weights, marks/fit.landmark_fit)
  head     the base has no head: it is cut where the figure's head region starts (the bare-neck level on the figure's neck
           axis, both from the merge's tube.json). The figure's points above that level take no thickness.
  surface  the same scale, turn and move refined on the surfaces: every base point paired with its nearest figure point,
           Cauchy-weighted by its miss (bare legs and hands lie on the figure and pull; a base point deep under a jacket or
           a skirt misses by the cloth's depth and hardly counts), balanced with the joints by each kind's median miss
           (as marks/fit.place)
  bones    elastic bone matching: the dressed figure is the reference, the base is elastic. Each base bone between two joints
           (torso, upper and lower arms, thighs, shins, feet) is turned onto the figure's bone and stretched to its length,
           then the part moves (no turn) onto the figure's surface with its joints as anchors; the parts' moves blended where they meet
  inside   a body cannot stand outside its own clothes: base points still outside the figure's solid are drawn onto its surface
  thick    each figure point's layer thickness: its distance to the base's surface (the base sampled at the figure's own
           point spacing)
Writes base_fit.glb (the base, placed and headless), thick.npy (per figure vertex, metres; NaN above the neck), base.json."""
import json, os, sys
import numpy as np, trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'marks'))
import fit
FIG, FIGJ, TUBEJ, BASE, BASEJ, OUT = sys.argv[1:7]; os.makedirs(OUT, exist_ok=True)
BODY = range(5, 23)                                    # STRUCTURAL: RTMW's layout, the points a body has below its head (shoulders to toes and heels)
def load(p):
    m = trimesh.load(p, force='mesh', process=False); V = np.asarray(m.vertices, float); F = np.asarray(m.faces, np.int64)
    V, inv = np.unique(V.round(9), axis=0, return_inverse=True); F = inv.reshape(-1)[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1), F
def save(p, V, F): trimesh.Trimesh(np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1), F, process=False).export(p)
def normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); N = np.zeros_like(V)
    for k in range(3): np.add.at(N, F[:, k], n)
    return N / np.maximum(np.linalg.norm(N, axis=1), 1e-30)[:, None]
def edge(V, F): return float(np.median(np.linalg.norm(V[F[:, 0]] - V[F[:, 1]], axis=1)))
Vf, Ff = load(FIG); Vb, Fb = load(BASE); wf = json.load(open(FIGJ))['points']; wb = json.load(open(BASEJ))['points']; tube = json.load(open(TUBEJ))
ax = np.array(tube['axis']); S = np.array(tube['body_shoulder_mid']); t_c = tube['bare_neck_t']
ids = [j for j in BODY if str(j) in wf and str(j) in wb]
ls = np.array([wb[str(j)]['p'] for j in ids]); ld = np.array([wf[str(j)]['p'] for j in ids]); lw = np.array([wb[str(j)]['score'] * wf[str(j)]['score'] for j in ids])
r_before = np.linalg.norm(ls - ld, axis=1); s, R, t = fit.landmark_fit(ls, ld, lw); r0 = np.linalg.norm(fit.apply(s, R, t, ls) - ld, axis=1)
print('BASE joints: %d pairs, scale %.4f; median miss %.1f -> %.1f mm' % (len(ids), s, 1000 * np.median(r_before), 1000 * np.median(r0)))
# the figure's surface, with which side of it a point is on (its own outward normals); below the head only
Nf = normals(Vf, Ff); body_f = (Vf - S) @ ax <= t_c; tf = cKDTree(Vf[body_f]); Vfb, Nfb = Vf[body_f], Nf[body_f]
ef = edge(Vf, Ff); Pb = fit.thin(Vb, ef / s)            # the base sampled at the figure's own point spacing
def headless(X): return (X - S) @ ax <= t_c
hist = []
for it in range(fit.CAP):
    X = fit.apply(s, R, t, Pb); keep = headless(X); d, i = tf.query(X[keep])
    ws, ms = fit.cauchy(d); lr = np.linalg.norm(fit.apply(s, R, t, ls) - ld, axis=1); wl, ml = fit.cauchy(lr); wl = wl * lw
    W = np.concatenate([ws / ws.sum() / ms ** 2, wl / wl.sum() / ml ** 2])
    s2, R2, t2 = fit.umeyama(np.concatenate([Pb[keep], ls]), np.concatenate([Vfb[i], ld]), W)
    moved = abs(s2 - s) / s + np.abs(R2 - R).max() + np.abs(t2 - t).max() / s; hist.append((ms, ml)); s, R, t = s2, R2, t2
    if moved < fit.TOL: break
print('BASE surface: %d passes, scale %.4f; base-to-figure median miss %.1f -> %.1f mm, joints %.1f -> %.1f mm' % (len(hist), s, 1000 * hist[0][0], 1000 * hist[-1][0], 1000 * hist[0][1], 1000 * hist[-1][1]))
Vb2 = fit.apply(s, R, t, Vb); kv = headless(Vb2); Fb2 = Fb[kv[Fb].all(1)]; used = np.unique(Fb2); re = np.full(len(Vb2), -1); re[used] = np.arange(len(used)); Vb3, Fb3 = Vb2[used], re[Fb2]
print('BASE head off: %d of %d faces kept (below the bare-neck level, %.1f mm above the shoulder line)' % (len(Fb3), len(Fb), 1000 * t_c))
# ---- limbs: two generated bodies never hold a limb at quite the same angle, and one scale, turn and move cannot lay a leg on a
# leg. Each part of the base between two of its own joints turns and moves by itself onto the figure's surface (no resize: the size
# is the joints'), and the parts' moves are blended where they meet.
TIP = (103, 124)                                       # STRUCTURAL: RTMW's layout, the middle fingertips (left, right)
J = {j: fit.apply(s, R, t, np.array(wb[str(j)]['p'])) for j in list(range(5, 23)) + list(TIP) if str(j) in wb}
mid = lambda a, b: (J[a] + J[b]) / 2
PARTS = {'torso': (mid(5, 6), mid(11, 12)), 'upper_arm.L': (J[5], J[7]), 'upper_arm.R': (J[6], J[8]), 'lower_arm.L': (J[7], J[9]), 'lower_arm.R': (J[8], J[10]),
         'thigh.L': (J[11], J[13]), 'thigh.R': (J[12], J[14]), 'shin.L': (J[13], J[15]), 'shin.R': (J[14], J[16]),
         'foot.L': (J[15], mid(17, 18)), 'foot.R': (J[16], mid(20, 21)), 'hand.L': (J[9], J[TIP[0]]), 'hand.R': (J[10], J[TIP[1]])}   # STRUCTURAL: the parts a body has between RTMW's joints
names = list(PARTS)
def seg_d(X, a, b):
    ab = b - a; u = np.clip(((X - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(a + u[:, None] * ab - X, axis=1)
def shares(X):
    """each point's share in every part: a part counts while it is less than twice as far as the nearest part (equal at a joint,
    nothing once another part is twice as near), eased (STRUCTURAL: the relative distance and a smoothstep)"""
    D = np.stack([seg_d(X, *PARTS[n]) for n in names], 1); x = np.clip(2 - D / np.maximum(D.min(1, keepdims=True), 1e-12), 0, 1); w = x * x * (3 - 2 * x)
    return w / w.sum(1, keepdims=True), D.argmin(1)
def kabsch(A, B, w):
    w = w / w.sum(); ma, mb = w @ A, w @ B; C = ((B - mb) * w[:, None]).T @ (A - ma); U, _, Vt = np.linalg.svd(C); Sg = np.eye(3)
    if np.linalg.det(U @ Vt) < 0: Sg[2, 2] = -1
    Rk = U @ Sg @ Vt; return Rk, mb - Rk @ ma
# elastic bone matching: the dressed figure is the reference, the base body is elastic. Each base bone (joint to joint) is laid on
# the figure's own bone: turned onto its direction, STRETCHED to its length, its start on the figure's joint. Then the part settles
# on the figure's surface (a move only) with its two joints as anchors: surface pairs and joint pairs balanced by each kind's
# median miss (as marks/fit.place), so a bare leg follows the surface and an arm inside a sleeve stays on its bone.
JF = {j: np.array(wf[str(j)]['p']) for j in list(range(5, 23)) + list(TIP) if str(j) in wf}
midf = lambda a, b: (JF[a] + JF[b]) / 2
REF = {'torso': (midf(5, 6), midf(11, 12)), 'upper_arm.L': (JF[5], JF[7]), 'upper_arm.R': (JF[6], JF[8]), 'lower_arm.L': (JF[7], JF[9]), 'lower_arm.R': (JF[8], JF[10]),
       'thigh.L': (JF[11], JF[13]), 'thigh.R': (JF[12], JF[14]), 'shin.L': (JF[13], JF[15]), 'shin.R': (JF[14], JF[16]), 'foot.L': (JF[15], midf(17, 18)), 'foot.R': (JF[16], midf(20, 21)), 'hand.L': (JF[9], JF[TIP[0]]), 'hand.R': (JF[10], JF[TIP[1]])}
ml = hist[-1][1]                                        # how well joints agree between the two models: the joints' own precision
def bone_map(a, b, a2, b2):
    """the map laying bone a-b on bone a2-b2: the smallest turn taking one direction to the other, a stretch along the bone
    to the new length, a onto a2. Returns (A, t) with x -> A x + t."""
    u, v = (b - a) / np.linalg.norm(b - a), (b2 - a2) / np.linalg.norm(b2 - a2); c = np.cross(u, v); sn, cs = np.linalg.norm(c), float(u @ v)
    if sn > 0:
        k = c / sn; K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]]); Rm = np.eye(3) + sn * K + (1 - cs) * K @ K
    else: Rm = np.eye(3)
    st = np.linalg.norm(b2 - a2) / np.linalg.norm(b - a); A = Rm @ (np.eye(3) + (st - 1) * np.outer(u, u)); return A, a2 - A @ a, st, np.degrees(np.arctan2(sn, cs))
Xs = fit.thin(Vb3, ef); _, own = shares(Xs); T = {}; parts_rep = {}
for k, n in enumerate(names):
    A0, t0, st, turn0 = bone_map(*PARTS[n], *REF[n]); P = Xs[own == k] @ A0.T + t0; ends = np.array(REF[n]); Rk, tk = np.eye(3), np.zeros(3); d0 = None; wj = np.full(2, 0.5) / ml ** 2
    for it in range(fit.CAP):
        Y = P @ Rk.T + tk; d, i = tf.query(Y); w, ms = fit.cauchy(d); d0 = ms if d0 is None else d0
        # a move only: the bone's direction is the joints' (a limb is round, and a free turn spins it about its own bone)
        ws_ = w / w.sum() / ms ** 2; t2 = (ws_ @ (Vfb[i] - P)) / (ws_.sum() + wj.sum()); moved = np.abs(t2 - tk).max(); tk = t2
        if moved < fit.TOL: break
    T[n] = (Rk @ A0, Rk @ t0 + tk); ang = np.degrees(np.arccos(np.clip((np.trace(Rk) - 1) / 2, -1, 1))); slip = np.linalg.norm(ends @ Rk.T + tk - ends, axis=1).max()
    parts_rep[n] = {'stretch': round(float(st), 4), 'bone_turn_deg': round(float(turn0), 2), 'settle_turn_deg': round(float(ang), 2), 'joint_slip_mm': round(1000 * float(slip), 2), 'surface_miss_mm': [round(1000 * d0, 2), round(1000 * ms, 2)]}
    print('BASE bone %-12s stretched x%.3f, turned %.1f deg onto the figure bone; settled on the surface by a move of %.1f mm; surface median miss %.1f -> %.1f mm (%d points, %d passes)'
          % (n, st, turn0, 1000 * slip, 1000 * d0, 1000 * ms, len(P), it + 1))
W, _ = shares(Vb3); Vb4 = sum(W[:, [k]] * (Vb3 @ T[n][0].T + T[n][1]) for k, n in enumerate(names))
# ---- inside: a body cannot stand outside its own clothes. The figure as a solid on a grid of its own point spacing (its surface
# cells closed, the outside flooded from a corner); a base point outside it is drawn onto the figure's nearest surface point.
from scipy import ndimage
h = 2 * ef; lo = Vf.min(0) - 3 * h; ng = np.ceil((Vf.max(0) - lo) / h).astype(int) + 3; g = np.zeros(ng, bool)   # STRUCTURAL: cells of two point spacings, so the surface's cells join up
for Pp in (Vf, Vf[Ff].mean(1)): g[tuple(np.floor((Pp - lo) / h).astype(int).T)] = True
lab, _ = ndimage.label(~g); solid = lab != lab[0, 0, 0]
def inside(X):
    k = np.floor((X - lo) / h).astype(int); ok = ((k >= 0) & (k < ng)).all(1); r = np.zeros(len(X), bool); r[ok] = solid[tuple(k[ok].T)]; return r
def report(V, tag):
    X = fit.thin(V, ef); o = ~inside(X); d, _ = tf.query(X[o])
    print('BASE inside (%s): %.1f%% of the base surface outside the figure%s' % (tag, 100 * o.mean(), '; of that, median %.1f mm out, 90%% within %.1f mm' % (1000 * np.median(d), 1000 * np.percentile(d, 90)) if o.any() else '')); return float(o.mean())
out0 = report(Vb3, 'one scale, turn and move'); out1 = report(Vb4, 'bones matched')
o = ~inside(Vb4); d, i = tf.query(Vb4[o]); Vb5 = Vb4.copy(); Vb5[o] = Vfb[i]
print('BASE drawn in: %d base points (%.1f%%) moved onto the figure, median %.1f mm' % (o.sum(), 100 * o.mean(), 1000 * np.median(d) if o.any() else 0))
Vb3 = Vb5; save(os.path.join(OUT, 'base_fit.glb'), Vb3, Fb3)
# thickness: the figure's distance to the base surface (base points at the figure's spacing: subdivided until its edges are no longer)
m = trimesh.Trimesh(Vb3, Fb3, process=False)
while edge(np.asarray(m.vertices), np.asarray(m.faces)) > ef: m = m.subdivide()
Bv = np.asarray(m.vertices); Bn = normals(Bv, np.asarray(m.faces)); tb = cKDTree(Bv)
d, i = tb.query(Vf[body_f]); sign = 1.0                       # the base is inside the figure by construction: the distance is the thickness
thick = np.full(len(Vf), np.nan); thick[body_f] = d * sign; np.save(os.path.join(OUT, 'thick.npy'), thick.astype(np.float32))
q = np.percentile(d * sign, [5, 25, 50, 75, 95]) * 1000
print('BASE thickness on %d figure points below the head: 5%% %.1f, 25%% %.1f, median %.1f, 75%% %.1f, 95%% %.1f mm' % (body_f.sum(), *q))
M = np.eye(4); M[:3, :3] = s * R; M[:3, 3] = t
json.dump({'M': M.tolist(), 'scale': s, 'joint_pairs': len(ids), 'joint_miss_mm': [round(1000 * float(np.median(r_before)), 2), round(1000 * hist[-1][1], 2)],
           'surface_miss_mm': [round(1000 * hist[0][0], 2), round(1000 * hist[-1][0], 2)], 'base_outside_share': [round(out0, 4), round(out1, 4)], 'parts': {n: dict(parts_rep[n], A=T[n][0].tolist(), t=T[n][1].tolist()) for n in names},
           'thickness_mm_5_25_50_75_95': q.round(2).tolist(), 'figure_edge_m': ef}, open(os.path.join(OUT, 'base.json'), 'w'), indent=1)
print('BASE saved')
