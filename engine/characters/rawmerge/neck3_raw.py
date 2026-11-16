"""Version 3 of the raw-stage join (version 2 plus an all-round neck: see "version 3" below): the neck is REBUILT as a smooth blend of the two models' necks, bone to bone.
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
def throat(t, c0, r0):
    r = np.min([reach(flat(l['pts'], t) - c0, ang) for l in sections(Vh, Fhn, d0h - t)[0]], 0); ok_ = np.isfinite(r); pts = c0 + r[ok_, None] * dirs[ok_]; c, rad = c0.copy(), r0
    for _ in range(200):
        res = np.abs(np.linalg.norm(pts - c, axis=1) - rad); w = 1 / (1 + (res / max(float(np.median(res)), step)) ** 2)
        A = np.stack([2 * pts[:, 0], 2 * pts[:, 1], np.ones(len(pts))], 1) * w[:, None]; sol = np.linalg.lstsq(A, (pts ** 2).sum(1) * w, rcond=None)[0]
        c2 = sol[:2]; rad2 = float(np.sqrt(max(sol[2] + c2 @ c2, 0))); moved = np.abs(c2 - c).max() + abs(rad2 - rad); c, rad = c2, rad2
        if moved < TOL: break
    return c, rad, float((np.abs(np.linalg.norm(pts - c, axis=1) - rad) < step).sum() / N)
c_top, r_top, arc = throat(t1, LB[top]['c'], R)
def girdle(V, d0, t, half=None):
    """the mass centre of a model's shoulder girdle: its surface within one neck radius of its shoulder line (the skins' points are evenly
    spread, so their mean is the surface's mass centre); the body's is taken over the bust's own width, since the bust ends at the shoulders"""
    k = np.abs(d0 - t) < R; q = np.stack([(V[k] - S) @ u, (V[k] - S) @ v], 1)
    if half is not None: q = q[np.abs(q[:, 0] - np.median(q[:, 0])) < half]
    return float(np.ptp(q[:, 0]) / 2), q.mean(0), len(q)
gh = girdle(Vh, d0h, t_sh); gb = girdle(Vb, body.d0, 0.0, gh[0]); lm = np.array([(Sh - S) @ u, (Sh - S) @ v])
print('NECK bust bone: top (throat centre at the chin level) %.1f mm behind the body bone, %.1f mm to its left (throat arc %.0f%% of all directions, radius %.1f mm)' % ((c_top - LB[top]['c'])[1] * 1000, (c_top - LB[top]['c'])[0] * 1000, arc * 100, r_top * 1000))
print('NECK shoulder girdles (surface within a neck radius of each shoulder line, over the bust width): body %d points, mass centre %.1f mm behind the landmark axis; bust %d points, mass centre %.1f mm behind; by mass centres the bust shoulders sit %.1f mm behind the body shoulders (by landmarks %.1f mm)'
      % (gb[2], gb[1][1] * 1000, gh[2], gh[1][1] * 1000, (gh[1] - gb[1])[1] * 1000, lm[1] * 1000))
base_off = gb[1] - gh[1]                                                                        # what brings the bust's shoulder mass centre onto the body's
# ---- bone fusion on the bust: its neck bone (its shoulder line -> the chin level) is laid on the fused bone (the body's shoulder line ->
# the chin level, the head end staying where the head is). A bust point at share s of its bone goes to share s of the fused bone:
# down by the difference in bone length, and sideways by the shoulders' offset, both fading to nothing at the head end.
# Only the neck column moves fully (within the bare-neck radius of the bust's bone); the move fades over one more radius, so hair beside it is spared.
tt = d0h.copy(); s = (tt - t_sh) / (t1 - t_sh); sm = np.clip(s, 0, 1); down = (1 - sm) * t_sh                    # the shoulder line comes down by t_sh; the chin level stays
bone_h = c_top[None] + (1 - sm)[:, None] * (gh[1] - c_top)[None]                                  # the bust's own bone at each point's level (throat centre to shoulder mass centre)
q = np.stack([(Vh - S - tt[:, None] * ax) @ u, (Vh - S - tt[:, None] * ax) @ v], 1); rho = np.linalg.norm(q - bone_h, axis=1)
fade = lambda x: (lambda y: y * y * (3 - 2 * y))(np.clip(1 - x, 0, 1))                         # STRUCTURAL: smooth, 1 at 0 and 0 from 1 on
# the column widens toward the shoulders (the whole shoulder section moves together at the bust's shoulder line): radius R at the head end, the shoulder section's own at the bottom
Rg = gh[0]; col = R + np.clip(1 - sm, 0, 1) * (Rg - R); w = np.where(s < 1, fade(np.maximum(rho - col, 0) / R), 0)
side = (1 - sm)[:, None] * base_off[None]
Vh = Vh + w[:, None] * (side @ np.stack([u, v]) - down[:, None] * ax)
d0h = (Vh - S) @ ax
print('NECK bone fusion: the bust neck bone is %.1f mm long, the fused bone %.1f mm (x%.2f); its shoulder end comes down %.1f mm and moves %.1f mm forward, %.1f mm sideways; %d bust points moved, at most %.1f mm'
      % ((t1 - t_sh) * 1000, t1 * 1000, t1 / (t1 - t_sh), t_sh * 1000, -base_off[1] * 1000, base_off[0] * 1000, (w > 0.01).sum(), (w * np.linalg.norm(np.concatenate([side, down[:, None]], 1), axis=1)).max() * 1000))
# ---- meeting the body's neck: at the level where the body's bare neck starts, the bust's throat is widened, direction by direction, out to
# the body's own neck outline wherever it lies inside it (never narrowed: where hair lies outside, the body's neck simply ends inside it);
# full at that level and below, fading to nothing at the chin level, and fading outward over one neck radius
cc = LB[c_i]['c']; rb_c = reach(LB[c_i]['q'] - cc, ang); rh_c = np.min([reach(flat(l['pts'], t_c) - cc, ang) for l in sections(Vh, Fh[((d0h[Fh] > t_c - 4 * step) & (d0h[Fh] < t_c + 4 * step)).any(1)], d0h - t_c)[0]], 0)
gain = np.where(np.isfinite(rh_c) & np.isfinite(rb_c) & (rb_c > rh_c), rb_c - rh_c, 0.0)
q = np.stack([(Vh - S - d0h[:, None] * ax) @ u, (Vh - S - d0h[:, None] * ax) @ v], 1) - cc; rho = np.linalg.norm(q, axis=1); jj = np.clip(np.floor((np.arctan2(q[:, 1], q[:, 0]) + np.pi) / (2 * np.pi) * N).astype(int), 0, N - 1)
rh_p = np.where(np.isfinite(rh_c), rh_c, R)[jj]; along = fade(np.clip((d0h - t_c) / (t1 - t_c), 0, None)) * fade(np.maximum(t_c - d0h, 0) / R)
out = along * gain[jj] * np.minimum(rho / rh_p, 1) * fade(np.maximum(rho - rh_p, 0) / R)
# measured only: applying this widening made the bust cross itself and the solid cut failed (2026-11-15); the gap is reported, not closed
print('NECK meeting: at the bare-neck level the bust throat lay inside the body neck outline over %.0f%% of all directions, by up to %.1f mm (mean %.1f mm there); NOT closed yet' % (100 * (gain > 0).mean(), gain.max() * 1000, gain[gain > 0].mean() * 1000 if (gain > 0).any() else 0))
save(os.path.join(OUT, 'bust_def.glb'), Vh, Fh)
# ---- the parts
def clip(V, F, f, name):
    n = len(V); s_ = f > 0; fs = s_[F]; keep = F[fs.all(1)]; Fc = F[fs.any(1) & ~fs.all(1)]; m = len(Fc); sc = s_[Fc]; one = sc.sum(1) == 1
    lone = np.where(one, np.argmax(sc, 1), np.argmin(sc, 1)); r = np.arange(m); A, B, C = Fc[r, lone], Fc[r, (lone + 1) % 3], Fc[r, (lone + 2) % 3]
    keys = np.concatenate([np.sort(np.stack([A, B], 1), 1), np.sort(np.stack([A, C], 1), 1)]); uq, inv = np.unique(keys, axis=0, return_inverse=True); inv = inv.reshape(-1)
    fa, fb = f[uq[:, 0]], f[uq[:, 1]]; new = V[uq[:, 0]] + (fa / (fa - fb))[:, None] * (V[uq[:, 1]] - V[uq[:, 0]]); AB, AC = n + inv[:m], n + inv[m:]
    tr = [keep, np.stack([A, AB, AC], 1)[one], np.stack([AB, B, C], 1)[~one], np.stack([AB, C, AC], 1)[~one]]; e0, e1 = np.where(one, AB, AC), np.where(one, AC, AB)
    k = len(uq); nc, lab = connected_components(coo_matrix((np.ones(m), (e0 - n, e1 - n)), shape=(k, k)), directed=False)
    cen = np.stack([np.bincount(lab, new[:, j], nc) for j in range(3)], 1) / np.bincount(lab, minlength=nc)[:, None]
    tr.append(np.stack([e1, e0, n + k + lab[e0 - n]], 1)); V2 = np.concatenate([V, new, cen]); F2 = np.concatenate(tr)
    used = np.unique(F2); re = np.full(len(V2), -1); re[used] = np.arange(len(used)); print('NECK %s: clipped through %d faces, %d rims capped; %d faces kept' % (name, m, nc, len(F2))); return V2[used], re[F2]
# ---- version 3, all round: the body's neck is kept right up to the chin level (so there is a neck at the sides and the back, where the
# bust has only hair), and its bone is bent onto the bust's. The bust's neck at the chin level is the smallest closed section of the
# bust holding the body's bone; its MASS CENTRE is the bust bone's place there. The body's neck column follows: nothing at its neck base,
# the whole offset at the chin level, sections moving with their bone; outside the neck outline the move fades over one neck radius.
def bust_loop(t, centre):
    best = None
    for l in sections(Vh, Fh[((d0h[Fh] > t - 4 * step) & (d0h[Fh] < t + 4 * step)).any(1)], d0h - t)[0]:
        qq = flat(l['pts'], t)
        if holds(qq, centre):
            a_, c_ = mass(qq)
            if best is None or a_ < best[0]: best = (a_, c_, qq)
    return best
bl = bust_loop(t1, LB[top]['c'])
if bl is None: raise SystemExit('NECK: no bust section holds the body bone at the chin level')
off = bl[1] - LB[top]['c']
print('NECK v3 bones at the chin level: bust neck section %.1f cm2 (body %.1f cm2); by mass centres the bust bone is %.1f mm behind the body bone, %.1f mm to its left' % (bl[0] * 1e4, LB[top]['area'] * 1e4, off[1] * 1000, off[0] * 1000))
cb_t = np.array([LB[i]['c'] for i in range(b_lo, top + 1)]); lv = levels[b_lo:top + 1]
rb_t = np.array([(lambda r: np.where(np.isfinite(r), r, np.nanmax(np.where(np.isfinite(r), r, np.nan))))(reach(LB[i]['q'] - LB[i]['c'], ang)) for i in range(b_lo, top + 1)])
tb = body.d0; ii = np.clip(np.round((tb - t_b0) / step).astype(int), 0, len(lv) - 1)
qb = np.stack([(Vb - S - tb[:, None] * ax) @ u, (Vb - S - tb[:, None] * ax) @ v], 1) - cb_t[ii]; rhob = np.linalg.norm(qb, axis=1)
jb = np.clip(np.floor((np.arctan2(qb[:, 1], qb[:, 0]) + np.pi) / (2 * np.pi) * N).astype(int), 0, N - 1); rbp = rb_t[ii, jb]
xb = np.clip((tb - t_b0) / (t1 - t_b0), 0, 1); alb = xb * xb * (3 - 2 * xb)                           # STRUCTURAL: smoothstep along the neck
wb = np.where(tb > t_b0 - step, fade(np.maximum(rhob - rbp, 0) / R), 0) * fade(np.maximum(tb - t1, 0) / R)
Vb = Vb + (wb * alb)[:, None] * (off @ np.stack([u, v]))[None]
body = Model(Vb, Fb, 'body'); Lt = body.neck(t1); a1_, c1_ = mass(Lt['q'])
print('NECK v3 bend: %d body points moved, at most %.1f mm; the body neck top is now %.1f mm from the bust bone' % ((wb * alb > 0.01).sum(), (wb * alb).max() * np.linalg.norm(off) * 1000, np.linalg.norm(c1_ - bl[1]) * 1000))
# flush (as version 1): where the body's neck top still stands out past the bust's section, it is drawn in, fading down over one neck radius
mid = bl[1]; rb1 = reach(Lt['q'] - mid, ang); rh1 = reach(bl[2] - mid, ang); over = np.where(np.isfinite(rb1) & np.isfinite(rh1), np.maximum(0, rb1 - rh1), 0.0)
tb = body.d0; qb = np.stack([(Vb - S - t1 * ax) @ u, (Vb - S - t1 * ax) @ v], 1) - mid; rhob = np.linalg.norm(qb, axis=1)
jb = np.clip(np.floor((np.arctan2(qb[:, 1], qb[:, 0]) + np.pi) / (2 * np.pi) * N).astype(int), 0, N - 1); rbp = np.where(np.isfinite(rb1), rb1, R)[jb]
wf = fade(np.maximum(t1 - tb, 0) / R) * fade(np.maximum(rhob - rbp, 0) / R)
Vb = Vb - (qb / np.maximum(rhob, 1e-12)[:, None] * (wf * over[jb] * np.minimum(rhob / rbp, 1))[:, None]) @ np.stack([u, v])
body = Model(Vb, Fb, 'body'); Lt = body.neck(t1); rb2 = reach(Lt['q'] - mid, ang)
print('NECK v3 flush: the body neck top stood out past the bust section over %.0f%% of all directions, by up to %.1f mm; drawn in, now up to %.1f mm' % (100 * (over > 0).mean(), over.max() * 1000, np.nanmax(np.where(np.isfinite(rb2) & np.isfinite(rh1), np.maximum(0, rb2 - rh1), 0)) * 1000))
def head_side(L):
    """the body opened along one neck outline: which of its points stay joined to the head (loose pieces with the nearer side)"""
    loop_f = np.zeros(len(Fb), bool); loop_f[L['faces']] = True; nc, lab = links(Fb[~loop_f], body.n); hi_l, lo_l = lab[body.top], lab[body.base]
    if hi_l == lo_l: raise SystemExit('NECK: the body is still one piece with its neck outline opened')
    sd = np.zeros(nc, bool); sd[hi_l] = True; li = np.nonzero((lab != hi_l) & (lab != lo_l))[0]
    if len(li):
        dh = np.bincount(lab[li], cKDTree(Vb[lab == hi_l]).query(Vb[li])[0], nc); dl = np.bincount(lab[li], cKDTree(Vb[lab == lo_l]).query(Vb[li])[0], nc); sd |= dh < dl; sd[lo_l] = False
    return sd[lab]
Lc = body.neck(t_c); up = head_side(Lc); up1 = head_side(Lt); tiny = np.finfo(float).tiny            # the head region is still counted from the bare-neck level, so the bust keeps its throat
Vb2, Fb2 = clip(Vb, Fb, np.where(up1, -1, 1) * np.maximum(np.abs(body.d0 - t1), tiny), 'body (its base side with its whole neck, opened along its neck outline at the chin level)')
save(os.path.join(OUT, 'body_cut.glb'), Vb2, Fb2)
# ---- the head's region of space: every place nearer the body's head side (its bare neck, head and hair) than its base side. Sampled on
# the grid, its boundary made a closed surface; the bust is kept where it lies INSIDE it (a solid intersection, done by skin.py), so
# what closes the bust's cut is a piece of that boundary inside the bust, not a membrane across open air
c3 = S + t_c * ax + Lc['c'] @ np.stack([u, v]); ring = S + t_c * ax + Lc['q'] @ np.stack([u, v]); gridr = np.linspace(0, 1, max(2, int(np.ceil(R / step))))[:, None, None]; disc = (c3 + gridr * (ring - c3)[None]).reshape(-1, 3)
lo, hi = Vh.min(0) - 3 * step, Vh.max(0) + 3 * step; shape = np.ceil((hi - lo) / step).astype(int) + 1
gx, gy, gz = np.meshgrid(*[lo[k] + step * np.arange(shape[k]) for k in range(3)], indexing='ij'); G = np.stack([gx, gy, gz], -1).reshape(-1, 3)
f = (cKDTree(np.concatenate([Vb[~up], disc - step * ax])).query(G, workers=-1)[0] - cKDTree(np.concatenate([Vb[up], disc + step * ax])).query(G, workers=-1)[0]).reshape(shape)
f[0], f[-1], f[:, 0], f[:, -1], f[:, :, 0], f[:, :, -1] = (-step,) * 6                               # closed at the box (the box holds the whole bust with room to spare)
from skimage.measure import marching_cubes
hv, hf, _, _ = marching_cubes(f, 0.0, spacing=(step,) * 3); hv = hv + lo
if np.einsum('ij,ij->i', hv[hf[:, 0]], np.cross(hv[hf[:, 1]], hv[hf[:, 2]])).sum() < 0: hf = hf[:, ::-1]
save(os.path.join(OUT, 'head_region.glb'), hv, hf); print('NECK head region: %d x %d x %d grid, boundary %d faces' % (*shape, len(hf)))
json.dump({'axis': ax.tolist(), 'body_shoulder_mid': S.tolist(), 'bust_shoulder_mid': Sh.tolist(), 'bust_shoulder_line_t': t_sh, 'chin_t': t_chin, 'body_neck_base_t': t_b0, 'bare_neck_t': t_c, 'top_t': t1, 'step': step,
           'neck_radius': R, 'throat_centre': c_top.tolist(), 'throat_arc': arc, 'shoulder_offset_by_mass': (gh[1] - gb[1]).tolist(), 'shoulder_offset_by_landmarks': lm.tolist()}, open(os.path.join(OUT, 'neck.json'), 'w'), indent=1)
print('NECK saved')
