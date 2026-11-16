"""The raw-stage join with the neck as one continuous tube (see the lower half of this file). Header of version 2 kept for the shared steps:
: the neck is REBUILT as a smooth blend of the two models' necks, bone to bone.
python neck_raw.py <out-dir> <bust.glb> <bust-marks.json>     (needs body_skin.glb, bust_skin.glb, whole.json, head.json, place.json)
  bones    each model's neck bone is the line of its neck sections' MASS CENTRES (the centre of each section's area), level by
           level; its lower end is that model's own shoulder line (the middle of its shoulder landmarks: the bust's shoulders
           locate the bust's neck, not only its head), its upper end the chin's level, where the head is already placed
  necks    the body's neck section at a level is the closed outline joining head to base (as version 1); the bust's is the
           smallest closed section of the RAW bust round the body's mass centre (its neck tube, even where hair and collar
           close over it). Each model's neck runs down from the chin until its section's area jumps the most (where it
           enters the collar or the shoulders)
  pairing  a level on one bone is paired with the level at the same share of the other bone's length (shoulder line = 0,
           chin level = 1), so a short neck and a long neck meet end to end
  blend    from the body's neck base up to the chin, the new neck's section is the body's at the bottom and the bust's at the
           top: mass centre, height and radius in every direction all blended by one smooth share (STRUCTURAL: smoothstep)
  parts    the body keeps what is joined to its base below its neck base; the bust keeps what lies nearer the body's head than
           its base (version 1's rule); the new neck is a closed tube between them, reaching one grid step into each
  Writes body_cut.glb, bust_cut.glb, neck.glb, neck.json, neck.png."""
import json, os, sys
import numpy as np, trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw
OUT, BUST, BUSTJ = sys.argv[1:4]
def load(p, T=None):
    m = trimesh.load(p, force='mesh', process=False); V = np.asarray(m.vertices, float); F = np.asarray(m.faces, np.int64)
    V, inv = np.unique(V.round(9), axis=0, return_inverse=True); F = inv.reshape(-1)[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    V = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1); return (V if T is None else V @ T[:3, :3].T + T[:3, 3]), F
def save(p, V, F): trimesh.Trimesh(np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1), F, process=False).export(p)
def links(F, n): e = np.concatenate([F[:, :2], F[:, 1:]]); return connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)), directed=False)
def no_hollows(V, F, name):
    nc, lab = links(F, len(V)); fl = lab[F[:, 0]]; vol = np.bincount(fl, np.einsum('ij,ij->i', V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])) / 6, nc)
    F = F[vol[fl] > 0]; used = np.unique(F); re = np.full(len(V), -1); re[used] = np.arange(len(used)); print('NECK %s skin: %d hollows dropped' % (name, (vol <= 0).sum())); return V[used], re[F]
Vb, Fb = no_hollows(*load(os.path.join(OUT, 'body_skin.glb')), 'body'); Vh, Fh = no_hollows(*load(os.path.join(OUT, 'bust_skin.glb')), 'bust')
T = np.array(json.load(open(os.path.join(OUT, 'place.json')))['T']); Vr, Fr = load(BUST, T)
whole = json.load(open(os.path.join(OUT, 'whole.json')))['points']; head = json.load(open(os.path.join(OUT, 'head.json')))['points']; bm = json.load(open(BUSTJ))['points']
P = lambda d, k: np.array(d[str(k)]['p']); PT = lambda k: T[:3, :3] @ P(bm, k) + T[:3, 3]
e = np.concatenate([Fb[:, :2], Fb[:, 1:]])[::50]; step = float(np.median(np.linalg.norm(Vb[e[:, 0]] - Vb[e[:, 1]], axis=1)))
S = (P(whole, 5) + P(whole, 6)) / 2; E = (P(head, 3) + P(head, 4)) / 2; ax = (E - S) / np.linalg.norm(E - S); chin, nose = P(head, 31), P(head, 0)
u = np.cross([0, 1, 0], ax); u /= np.linalg.norm(u); v = np.cross(ax, u); t_chin = float((chin - S) @ ax); Sh = (PT(5) + PT(6)) / 2; t_sh = float((Sh - S) @ ax)
print('NECK shoulder lines: the bust (placed by its head) has its shoulder line %.1f mm above the body, %.1f mm behind it; chin level %.1f mm above the body shoulder line' % (t_sh * 1000, (Sh - S) @ v * 1000, t_chin * 1000))
flat = lambda Q, t: np.stack([(Q - S - t * ax) @ u, (Q - S - t * ax) @ v], 1)
def sections(V, F, d):
    s = d > 0; fs = s[F]; cross = fs.any(1) & ~fs.all(1); idx = np.nonzero(cross)[0]
    if not len(idx): return [], cross
    Fc = F[idx]; sc = s[Fc]; lone = np.where(sc.sum(1) == 1, np.argmax(sc, 1), np.argmin(sc, 1)); r = np.arange(len(Fc))
    A, B, C = Fc[r, lone], Fc[r, (lone + 1) % 3], Fc[r, (lone + 2) % 3]
    keys = np.concatenate([np.sort(np.stack([A, B], 1), 1), np.sort(np.stack([A, C], 1), 1)]); uq, inv = np.unique(keys, axis=0, return_inverse=True); inv = inv.reshape(-1)
    n1, n2 = inv[:len(Fc)], inv[len(Fc):]; da, db = d[uq[:, 0]], d[uq[:, 1]]; pts = V[uq[:, 0]] + (da / (da - db))[:, None] * (V[uq[:, 1]] - V[uq[:, 0]])
    n = len(uq); deg = np.bincount(np.concatenate([n1, n2]), minlength=n)
    nc, lab = connected_components(coo_matrix((np.ones(len(n1)), (n1, n2)), shape=(n, n)), directed=False); nbr = {}
    for x, y, fi in zip(n1.tolist(), n2.tolist(), idx.tolist()): nbr.setdefault(x, []).append((y, fi)); nbr.setdefault(y, []).append((x, fi))
    out = []
    for c in range(nc):
        nodes = np.nonzero(lab == c)[0]
        if len(nodes) < 3 or (deg[nodes] != 2).any(): continue
        order, faces, cur, prev = [int(nodes[0])], [], int(nodes[0]), -1
        while True:
            (y0, f0), (y1, f1) = nbr[cur]; nxt, fi = (y0, f0) if f0 != prev else (y1, f1); faces.append(fi); prev = fi; cur = nxt
            if cur == order[0]: break
            order.append(cur)
        out.append({'pts': pts[order], 'faces': np.array(faces)})
    return out, cross
def mass(q):
    """a closed outline's area and mass centre (the centre of the area it encloses)"""
    x, y = q[:, 0], q[:, 1]; x1, y1 = np.roll(x, -1), np.roll(y, -1); c = x * y1 - x1 * y; a = c.sum() / 2
    return abs(a), np.array([((x + x1) * c).sum(), ((y + y1) * c).sum()]) / (6 * a)
def holds(q, p):
    d = q - p; ang = np.arctan2(d[:, 1], d[:, 0]); t = np.diff(np.concatenate([ang, ang[:1]])); t = (t + np.pi) % (2 * np.pi) - np.pi; return abs(round(t.sum() / (2 * np.pi))) == 1
class Model:
    def __init__(self, V, F, name):
        self.V, self.F, self.name, self.n = V, F, name, len(V); self.d0 = (V - S) @ ax; self.top = int(cKDTree(V).query(nose)[1]); self.base = int(np.argmin(V[:, 2]))
        k = ((self.d0[F] > -2 * step) & (self.d0[F] < t_chin + 2 * step)).any(1); self.band = np.nonzero(k)[0]; rest = F[~k]; self.outer = np.concatenate([rest[:, :2], rest[:, 1:]])
    def neck(self, t):
        """the closed section at level t that joins the head (the nose's point) to the base (the lowest point); nearest the landmark axis if several"""
        V, F = self.V, self.F; d = self.d0 - t; Fn = F[self.band]; L, cross = sections(V, Fn, d)
        if not L: return None
        rest = Fn[~cross]; e = np.concatenate([self.outer, rest[:, :2], rest[:, 1:]]); nc, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(self.n, self.n)), directed=False)
        if lab[self.top] == lab[self.base]: return None
        best = None
        for l in L:
            fv = np.unique(Fn[l['faces']]); la = lab[fv]; up = d[fv] > 0
            if not ((la[up] == lab[self.top]).any() and (la[~up] == lab[self.base]).any()): continue
            q = flat(l['pts'], t); a, c = mass(q); dist = float(np.linalg.norm(c))
            if best is None or dist < best['dist']: best = dict(q=q, dist=dist, faces=self.band[l['faces']], area=a, c=c)
        return best
body = Model(Vb, Fb, 'body'); levels = np.arange(step, t_chin, step)
# ---- the body's neck: sections, mass centres, and where it enters the shoulders
LB = [body.neck(t) for t in levels]; ok = np.array([l is not None for l in LB]); top = int(np.nonzero(ok)[0].max())
run = [top]
while run[-1] - 1 >= 0 and ok[run[-1] - 1]: run.append(run[-1] - 1)
run = run[::-1]; area = np.array([LB[i]['area'] for i in run]); jump = int(np.argmax(np.abs(np.diff(np.log(area))))) if len(run) > 1 else -1
b_lo = run[jump + 1]; t_b0, t1 = float(levels[b_lo]), float(levels[top])
print('NECK body neck: clean from %.1f to %.1f mm above its shoulder line (below that its section jumps from %.1f to %.1f cm2: the shoulders)' % (t_b0 * 1000, t1 * 1000, area[jump + 1] * 1e4, area[jump] * 1e4))
# ---- where the body's bare neck starts: inside its clean neck run, the largest remaining jump of the section's area (a collar's top;
# without a collar this is just some level on the neck, and cutting there is as good as anywhere)
rest_run = run[jump + 1:]; ra = np.array([LB[i]['area'] for i in rest_run]); j2 = int(np.argmax(np.abs(np.diff(np.log(ra))))); c_i = rest_run[j2 + 1]; t_c = float(levels[c_i])
R = float(np.sqrt(LB[top]['area'] / np.pi))
print('NECK body bare neck: from %.1f mm (section %.1f cm2 just below, %.1f cm2 from there up); bare neck radius %.1f mm' % (t_c * 1000, ra[j2] * 1e4, ra[j2 + 1] * 1e4, R * 1000))
# ---- the bust's bone. Top: the centre of its throat at the chin level (hair closes over the back of its neck, so the circle is fitted
# to what its section shows toward the middle, each point weighted by its miss, Cauchy against the median miss and never finer than
# the grid step, starting from the body's own circle). Bottom: its shoulder line, located by its own shoulder landmarks; the place
# of each model's bone there is the MASS CENTRE of its shoulder section.
d0h = (Vh - S) @ ax; kh = ((d0h[Fh] > -2 * step) & (d0h[Fh] < t_chin + 2 * step)).any(1); Fhn = Fh[kh]; TOL = np.finfo(float).eps ** 0.5
def reach(q, ang):
    a0, a1 = q, np.roll(q, -1, 0); dx = np.stack([np.cos(ang), np.sin(ang)], 1); e = a1 - a0
    den = dx[:, None, 0] * e[None, :, 1] - dx[:, None, 1] * e[None, :, 0]; den = np.where(den == 0, np.nan, den)
    tr = (a0[None, :, 0] * e[None, :, 1] - a0[None, :, 1] * e[None, :, 0]) / den; ts = (a0[None, :, 0] * dx[:, None, 1] - a0[None, :, 1] * dx[:, None, 0]) / den
    return np.where((tr > 0) & (ts >= 0) & (ts <= 1), tr, np.inf).min(1)
N = int(round(2 * np.pi * R / step)); ang = (np.arange(N) + 0.5) / N * 2 * np.pi - np.pi; dirs = np.stack([np.cos(ang), np.sin(ang)], 1)
# ==== the neck as ONE continuous tube ====
# The neck's skin is a single swept surface: the body's own bare-neck outline, carried along the fused neck bone from inside the collar up
# into the head, so it is smooth by construction (no seam on the visible neck).
#   where     under the bust's head, the neck must sit where the bust's own throat is. What the bust's section shows of its neck at the
#             chin level (the first surface met in every direction from the body's bone) is matched by the body's neck outline, moved
#             (not turned, not resized: the neck keeps the body's size): every bust point paired with the nearest point of the moved outline, weighted by its miss (Cauchy against
#             the median miss, never finer than the grid step), repeated until it settles. Hair behind the neck misses by far and counts little.
#   bone      the body's neck column bends by that move: nothing at its neck base, all of it at the chin level (STRUCTURAL: smoothstep),
#             the collar leaning with it; outside the neck outline the bend fades over one neck radius
#   tube      rings of the bare-neck outline (taken where the body's bare neck starts), centred on the bent bone, from the neck base up to
#             one neck radius above the chin level; the scale goes smoothly from 1 where the bare neck starts to the fitted scale at the chin level
#   parts     the body gives up its bare neck (kept: base side, opened where the bare neck starts); the bust keeps what is nearer the body's
#             head than its base, counted from the collar's top (its throat lies on the tube, its hair reaches down to the collar); the tube lies between them
fade = lambda x: (lambda y: y * y * (3 - 2 * y))(np.clip(1 - x, 0, 1))                         # STRUCTURAL: smooth, 1 at 0 and 0 from 1 on
sm = lambda x: (lambda y: y * y * (3 - 2 * y))(np.clip(x, 0, 1))
cB = LB[top]['c']; Ob = LB[top]['q']
# the bust is a hollow shell: an outline lying inside another one is the wall of its hollow, not skin, and is left out
loops_h = [flat(l['pts'], t1) for l in sections(Vh, Fhn, d0h - t1)[0]]; areas_h = [mass(q_)[0] for q_ in loops_h]
outer_h = [q_ for q_, a_ in zip(loops_h, areas_h) if not any(holds(p_, q_[0]) and b_ > a_ for p_, b_ in zip(loops_h, areas_h))]
rh = np.min([reach(q_ - cB, ang) for q_ in outer_h], 0); okh = np.isfinite(rh); Ph = cB + rh[okh, None] * dirs[okh]
s_, dl = 1.0, np.zeros(2); TOL = np.finfo(float).eps ** 0.5
for it in range(200):                                                                              # NUMERIC: a cap on passes
    Q = cB + dl + s_ * (Ob - cB); i = cKDTree(Q).query(Ph)[1]; miss = np.linalg.norm(Q[i] - Ph, axis=1); wt = 1 / (1 + (miss / max(float(np.median(miss)), step)) ** 2)
    A = np.zeros((2 * len(Ph), 3)); A[0::2, 0] = (Ob[i] - cB)[:, 0]; A[1::2, 0] = (Ob[i] - cB)[:, 1]; A[0::2, 1] = 1; A[1::2, 2] = 1; b = (Ph - cB).reshape(-1); W = np.repeat(wt, 2)
    d2 = ((Ph - Q[i] + dl) * wt[:, None]).sum(0) / wt.sum(); moved = np.abs(d2 - dl).max(); dl = d2                  # the move alone: the neck keeps the body's own size (the body's proportions are the reference)
    if moved < TOL: break
Q = cB + dl + s_ * (Ob - cB); miss = cKDTree(Q).query(Ph)[0]
print('TUBE where: the neck under the bust head sits %.1f mm behind the body bone and %.1f mm to its left, at %.3f of the body neck size (%d passes); %.0f%% of what the bust section shows lies within a grid step of it (median miss %.1f mm)'
      % (dl[1] * 1000, dl[0] * 1000, s_, it + 1, 100 * (miss < step).mean(), np.median(miss) * 1000))
# ---- the bend (the body's neck column, collar and all)
cb_t = np.array([LB[i]['c'] for i in range(b_lo, top + 1)]); lv = levels[b_lo:top + 1]
rb_t = np.array([(lambda r: np.where(np.isfinite(r), r, np.nanmax(np.where(np.isfinite(r), r, np.nan))))(reach(LB[i]['q'] - LB[i]['c'], ang)) for i in range(b_lo, top + 1)])
tb = body.d0; ii = np.clip(np.round((tb - t_b0) / step).astype(int), 0, len(lv) - 1)
qb = np.stack([(Vb - S - tb[:, None] * ax) @ u, (Vb - S - tb[:, None] * ax) @ v], 1) - cb_t[ii]; rhob = np.linalg.norm(qb, axis=1)
jb = np.clip(np.floor((np.arctan2(qb[:, 1], qb[:, 0]) + np.pi) / (2 * np.pi) * N).astype(int), 0, N - 1); rbp = rb_t[ii, jb]
share = lambda t: sm((t - t_b0) / (t1 - t_b0))
wb = np.where(tb > t_b0 - step, fade(np.maximum(rhob - rbp, 0) / R), 0)
Vb = Vb + (wb * share(tb))[:, None] * (dl @ np.stack([u, v]))[None]; body = Model(Vb, Fb, 'body')
# the outline the tube carries is the body's neck outline at the chin level, the top of its bare neck, where the neck's skin stands upright.
# (Taken where the bare neck starts, it ran along the collar's lip, a nearly level spot, and came out ragged: the ring at the back, 2026-11-15.)
Lc = body.neck(t_c); Lt = body.neck(t1); ac, cc = mass(Lt['q']); rc = reach(Lt['q'] - cc, ang); rc = np.where(np.isfinite(rc), rc, np.nanmedian(np.where(np.isfinite(rc), rc, np.nan)))
print('TUBE bend: %d body points moved, at most %.1f mm; neck outline at %.1f mm: %.1f cm2, radius %.1f to %.1f mm' % ((wb * share(tb) > 0.01).sum(), (wb * share(tb)).max() * np.linalg.norm(dl) * 1000, t1 * 1000, ac * 1e4, rc.min() * 1000, rc.max() * 1000))
# ---- the tube
tl = np.arange(t_b0, t1 + R + step / 2, step); rings = []
for t in tl:
    c = cc + dl * (share(t) - 1); k = 1.0; rings.append(S + t * ax + (c[None] + k * rc[:, None] * dirs) @ np.stack([u, v]))
G = np.concatenate(rings); KK = len(rings); j = np.arange(N); jn = (j + 1) % N; tris = []
for k in range(KK - 1):
    a, b_, c_, d_ = k * N + j, k * N + jn, (k + 1) * N + jn, (k + 1) * N + j; tris += [np.stack([a, b_, c_], 1), np.stack([a, c_, d_], 1)]
G = np.concatenate([G, rings[0].mean(0)[None], rings[-1].mean(0)[None]]); i0, i1 = KK * N, KK * N + 1
tris += [np.stack([np.full(N, i0), jn, j], 1), np.stack([np.full(N, i1), (KK - 1) * N + j, (KK - 1) * N + jn], 1)]; Gf = np.concatenate(tris)
if np.einsum('ij,ij->i', G[Gf[:, 0]], np.cross(G[Gf[:, 1]], G[Gf[:, 2]])).sum() < 0: Gf = Gf[:, ::-1]
save(os.path.join(OUT, 'tube.glb'), G, Gf); print('TUBE tube: %d rings of %d points from %.1f to %.1f mm above the shoulder line, %d faces' % (KK, N, tl[0] * 1000, tl[-1] * 1000, len(Gf)))
# ---- the parts
def clip(V, F, f, name):
    n = len(V); s2 = f > 0; fs = s2[F]; keep = F[fs.all(1)]; Fc = F[fs.any(1) & ~fs.all(1)]; m = len(Fc); sc = s2[Fc]; one = sc.sum(1) == 1
    lone = np.where(one, np.argmax(sc, 1), np.argmin(sc, 1)); r = np.arange(m); A, B, C = Fc[r, lone], Fc[r, (lone + 1) % 3], Fc[r, (lone + 2) % 3]
    keys = np.concatenate([np.sort(np.stack([A, B], 1), 1), np.sort(np.stack([A, C], 1), 1)]); uq, inv = np.unique(keys, axis=0, return_inverse=True); inv = inv.reshape(-1)
    fa, fb = f[uq[:, 0]], f[uq[:, 1]]; new = V[uq[:, 0]] + (fa / (fa - fb))[:, None] * (V[uq[:, 1]] - V[uq[:, 0]]); AB, AC = n + inv[:m], n + inv[m:]
    tr = [keep, np.stack([A, AB, AC], 1)[one], np.stack([AB, B, C], 1)[~one], np.stack([AB, C, AC], 1)[~one]]; e0, e1 = np.where(one, AB, AC), np.where(one, AC, AB)
    k = len(uq); nc, lab = connected_components(coo_matrix((np.ones(m), (e0 - n, e1 - n)), shape=(k, k)), directed=False)
    cen = np.stack([np.bincount(lab, new[:, jx], nc) for jx in range(3)], 1) / np.bincount(lab, minlength=nc)[:, None]
    tr.append(np.stack([e1, e0, n + k + lab[e0 - n]], 1)); V2 = np.concatenate([V, new, cen]); F2 = np.concatenate(tr)
    used = np.unique(F2); re = np.full(len(V2), -1); re[used] = np.arange(len(used)); print('TUBE %s: clipped through %d faces, %d rims capped; %d faces kept' % (name, m, nc, len(F2))); return V2[used], re[F2]
def head_side(L):
    loop_f = np.zeros(len(Fb), bool); loop_f[L['faces']] = True; nc, lab = links(Fb[~loop_f], body.n); hi_l, lo_l = lab[body.top], lab[body.base]
    if hi_l == lo_l: raise SystemExit('TUBE: the body is still one piece with its neck outline opened')
    sd = np.zeros(nc, bool); sd[hi_l] = True; li = np.nonzero((lab != hi_l) & (lab != lo_l))[0]
    if len(li):
        dh = np.bincount(lab[li], cKDTree(Vb[lab == hi_l]).query(Vb[li])[0], nc); dl_ = np.bincount(lab[li], cKDTree(Vb[lab == lo_l]).query(Vb[li])[0], nc); sd |= dh < dl_; sd[lo_l] = False
    return sd[lab]
tiny = np.finfo(float).tiny; upc = head_side(Lc); up1 = head_side(Lt)
Vb2, Fb2 = clip(Vb, Fb, np.where(up1, -1, 1) * np.maximum(np.abs(body.d0 - t1), tiny), 'body (its base side with its whole bare neck, opened at the chin level)'); save(os.path.join(OUT, 'body_cut.glb'), Vb2, Fb2)
save(os.path.join(OUT, 'bust_plain.glb'), Vh, Fh)
# the head's region of space, counted from where the body's bare neck starts (the collar's top), not from the chin level: cut at the chin
# level, the hair grown round the bust's neck ended in a flat ledge half way up the neck (the ridges at the back, 2026-11-15); counted from
# the collar's top, it ends where it would meet the collar. The tube's own ring there stands for the cut face
k1 = int(np.argmin(np.abs(tl - t_c))); ring = rings[k1]; c3 = ring.mean(0); gridr = np.linspace(0, 1, max(2, int(np.ceil(R / step))))[:, None, None]; disc = (c3 + gridr * (ring - c3)[None]).reshape(-1, 3)
lo, hi = Vh.min(0) - 3 * step, Vh.max(0) + 3 * step; shape = np.ceil((hi - lo) / step).astype(int) + 1
gx, gy, gz = np.meshgrid(*[lo[k] + step * np.arange(shape[k]) for k in range(3)], indexing='ij'); GG = np.stack([gx, gy, gz], -1).reshape(-1, 3)
f = (cKDTree(np.concatenate([Vb[~upc], disc - step * ax])).query(GG, workers=-1)[0] - cKDTree(np.concatenate([Vb[upc], disc + step * ax])).query(GG, workers=-1)[0]).reshape(shape)
# the bust's own collar: it rises higher than the body's (highest at the back), and what stands above the body's collar counted as head and
# was left as a ring round the tube (2026-11-15: at the back it sat 68 to 76 mm up, out to 36 mm where the neck is 26). It is taken off
# direction by direction: going up the tube from the collar's top, the bust's skin (the first of its surfaces met from the tube's middle,
# hollow walls left out) stands off the tube until the bust's own neck begins, where it lies on the tube to within a grid step. Everything
# of the bust below that level, out to how far that skin stood, goes. Where the bust never comes to the tube below the tube's top (hair
# grown onto the neck, at the sides), nothing is taken.
tls = np.arange(t_c, t1 + R + step / 2, step); rr = []
for t in tls:
    kf = ((d0h[Fh] > t - 4 * step) & (d0h[Fh] < t + 4 * step)).any(1); lp = [flat(l['pts'], t) for l in sections(Vh, Fh[kf], d0h - t)[0]]; ar = [mass(q_)[0] for q_ in lp]
    out_ = [q_ for q_, a_ in zip(lp, ar) if not any(holds(p_, q_[0]) and b_ > a_ for p_, b_ in zip(lp, ar))]; cen_t = cc + dl * (share(t) - 1)
    rr.append(np.min([reach(q_ - cen_t, ang) for q_ in out_], 0) if out_ else np.full(N, np.inf))
rr = np.array(rr); on = rr <= rc[None] + step                                                              # the bust's skin lies on the tube here
first = np.where(on.any(0), np.argmax(on, 0), -1); t_hi = np.where(first >= 0, tls[np.maximum(first, 0)], t_c)
r_out = np.array([rr[:first[j_], j_][np.isfinite(rr[:first[j_], j_])].max() if first[j_] > 0 and np.isfinite(rr[:first[j_], j_]).any() else 0.0 for j_ in range(N)])
gl = (GG - S) @ np.stack([u, v, ax]).T; gq = gl[:, :2] - (cc[None] + dl[None] * (share(gl[:, 2]) - 1)[:, None]); grho = np.linalg.norm(gq, axis=1)
gj = np.clip(np.floor((np.arctan2(gq[:, 1], gq[:, 0]) + np.pi) / (2 * np.pi) * N).astype(int), 0, N - 1)
off_ = (grho <= r_out[gj] + step) & (gl[:, 2] < t_hi[gj]) & (gl[:, 2] > t_c - R)
f = np.where(off_.reshape(shape), np.minimum(f, (gl[:, 2] - t_hi[gj]).reshape(shape)), f)
print('TUBE bust collar: taken off in %d of %d directions, up to %.1f mm above the shoulder line (median %.1f where taken), out to %.1f mm from the tube middle; %d grid points' % ((first > 0).sum(), N, t_hi.max() * 1000, np.median(t_hi[first > 0]) * 1000 if (first > 0).any() else 0, r_out.max() * 1000, off_.sum()))
f[0], f[-1], f[:, 0], f[:, -1], f[:, :, 0], f[:, :, -1] = (-step,) * 6
from skimage.measure import marching_cubes
hv, hf, _, _ = marching_cubes(f, 0.0, spacing=(step,) * 3); hv = hv + lo
if np.einsum('ij,ij->i', hv[hf[:, 0]], np.cross(hv[hf[:, 1]], hv[hf[:, 2]])).sum() < 0: hf = hf[:, ::-1]
save(os.path.join(OUT, 'head_region.glb'), hv, hf)
json.dump({'axis': ax.tolist(), 'body_shoulder_mid': S.tolist(), 'body_neck_base_t': t_b0, 'bare_neck_t': t_c, 'top_t': t1, 'step': step, 'neck_radius': R, 'neck_move': dl.tolist(), 'neck_scale': s_}, open(os.path.join(OUT, 'tube.json'), 'w'), indent=1)
# ---- picture: the chin level's sections and the fit
W = 700; im = Image.new('RGB', (W, W), 'white'); dr = ImageDraw.Draw(im); sc = 7000; ox, oy = W // 2, W // 3
for q_ in outer_h:
    P2 = [(ox + a * sc, oy + b * sc) for a, b in q_ - cB]; dr.line(P2 + P2[:1], fill=(220, 40, 40), width=1)
P0 = [(ox + a * sc, oy + b * sc) for a, b in Ob - cB]; dr.line(P0 + P0[:1], fill=(170, 200, 250), width=2)
P1 = [(ox + a * sc, oy + b * sc) for a, b in Q - cB]; dr.line(P1 + P1[:1], fill=(0, 150, 0), width=3)
for a, b in Ph - cB: dr.ellipse([ox + a * sc - 2, oy + b * sc - 2, ox + a * sc + 2, oy + b * sc + 2], fill='black')
dr.text((6, 6), 'chin level, front up: bust section red, what it shows toward the middle black dots, body neck light blue, fitted neck green', fill='black')
im.save(os.path.join(OUT, 'tube.png')); print('TUBE saved')
