"""The seam between the raw body and the placed raw bust, found and cut with no rig: python cut_raw.py <out-dir>
(needs body_skin.glb, bust_skin.glb: each model's closed outer skin, the bust already placed and sized; whole.json, head.json)
  hollows  closed pieces that face inward (negative volume: the hollows inside a double-walled model) are dropped
  levels   planes across the neck direction (shoulder landmarks' middle to ear landmarks' middle), a grid step apart, from
           the shoulder line up to the chin landmark
  outline  at a level, a model's neck outline is a closed section that JOINS the head to the base: with the level's faces
           taken out, the surface above it holds the nose landmark's nearest point and the surface below it holds the
           model's lowest point. Where several do (hair grown into a hood), the one whose middle is nearest the landmark
           axis.
  seam     the level where the two models' neck outlines differ least (mean distance between them, both ways)
  match    the bust's surface is moved so its outline at the seam IS the body's: per direction round the body outline's
           middle, the gap between the two outlines, fading upward and outward over one neck radius (the outline's own)
  cut      each model is opened along its neck outline only: the body keeps what is still joined to its base, the bust what
           is still joined to its nose (hair hanging past the seam stays with the head). A model still in one piece after
           that is cut by the whole level instead. Loose pieces go with the nearer side. Cuts are capped: both parts closed.
  Writes body_cut.glb, bust_cut.glb, merge.json, seam.png."""
import json, os, sys
import numpy as np, trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw
OUT = sys.argv[1]
def load(p):
    m = trimesh.load(p, force='mesh', process=False); V = np.asarray(m.vertices, float); F = np.asarray(m.faces, np.int64)
    V, inv = np.unique(V.round(9), axis=0, return_inverse=True); F = inv.reshape(-1)[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1), F
def save(p, V, F): trimesh.Trimesh(np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1), F, process=False).export(p)
def pieces(V, F):
    e = np.concatenate([F[:, :2], F[:, 1:]]); return connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(V), len(V))), directed=False)
def no_hollows(V, F, name):
    nc, lab = pieces(V, F); fl = lab[F[:, 0]]; vol = np.bincount(fl, np.einsum('ij,ij->i', V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])) / 6, nc)
    keep = vol[fl] > 0; print('CUT %s: %d closed pieces, %d of them hollows (facing inward) dropped' % (name, nc, (vol <= 0).sum())); F = F[keep]
    used = np.unique(F); re = np.full(len(V), -1); re[used] = np.arange(len(used)); return V[used], re[F]
Vb, Fb = no_hollows(*load(os.path.join(OUT, 'body_skin.glb')), 'body'); Vh, Fh = no_hollows(*load(os.path.join(OUT, 'bust_skin.glb')), 'bust')
whole = json.load(open(os.path.join(OUT, 'whole.json')))['points']; head = json.load(open(os.path.join(OUT, 'head.json')))['points']
P = lambda d, k: np.array(d[str(k)]['p'])
e = np.concatenate([Fb[:, :2], Fb[:, 1:]])[::50]; step = float(np.median(np.linalg.norm(Vb[e[:, 0]] - Vb[e[:, 1]], axis=1)))
S = (P(whole, 5) + P(whole, 6)) / 2; E = (P(head, 3) + P(head, 4)) / 2; ax = (E - S) / np.linalg.norm(E - S); chin, nose = P(head, 31), P(head, 0)
u = np.cross([0, 1, 0], ax); u /= np.linalg.norm(u); v = np.cross(ax, u); t_chin = float((chin - S) @ ax)          # u: the figure's left, v: its back
flat = lambda Q, o: np.stack([(Q - o) @ u, (Q - o) @ v], 1)
def sections(V, F, d):
    """the surface cut by the level d = 0: closed outlines as ordered points with the faces each passes through; also the crossing-face mask"""
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
class Model:
    def __init__(self, V, F, name):
        self.V, self.F, self.name = V, F, name; self.d0 = (V - S) @ ax
        self.top = int(cKDTree(V).query(nose)[1]); self.base = int(np.argmin(V[:, 2])); self.n = len(V)
        k = ((self.d0[F] > -2 * step) & (self.d0[F] < t_chin + 2 * step)).any(1); self.band = np.nonzero(k)[0]     # the faces the levels can touch
        rest = F[~k]; e = np.concatenate([rest[:, :2], rest[:, 1:]]); self.outer = e                             # links outside the band never change
    def neck(self, t):
        """the neck outline at level t (see the header), or None"""
        V, F = self.V, self.F; d = self.d0 - t; Fn = F[self.band]; L, cross = sections(V, Fn, d)
        if not L: return None
        rest = Fn[~cross]; e = np.concatenate([self.outer, rest[:, :2], rest[:, 1:]])
        nc, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(self.n, self.n)), directed=False)
        if lab[self.top] == lab[self.base]: return None                                        # the level does not separate head from base here
        o = S + t * ax; best = None
        for l in L:
            fv = np.unique(Fn[l['faces']]); la = lab[fv]; up = d[fv] > 0
            if not ((la[up] == lab[self.top]).any() and (la[~up] == lab[self.base]).any()): continue
            q = flat(l['pts'], o); mid = q.mean(0); dist = float(np.linalg.norm(mid))
            if best is None or dist < best['dist']: best = dict(l, q=q, dist=dist, faces=self.band[l['faces']], area=abs(0.5 * float((q[:, 0] * np.roll(q[:, 1], -1) - np.roll(q[:, 0], -1) * q[:, 1]).sum())))
        return best
def differ(a, b): return float((cKDTree(a).query(b)[0].mean() + cKDTree(b).query(a)[0].mean()) / 2)
body, bust = Model(Vb, Fb, 'body'), Model(Vh, Fh, 'bust')
levels = np.arange(step, t_chin, step); rows = []; loops = {}
for t in levels:
    Lb, Lh = body.neck(t), bust.neck(t)
    if Lb is None or Lh is None: rows.append((t, np.inf, Lb['area'] if Lb else 0, Lh['area'] if Lh else 0)); continue
    rows.append((t, differ(Lb['q'], Lh['q']), Lb['area'], Lh['area'])); loops[len(rows) - 1] = (Lb['q'], Lh['q'])
rows = np.array(rows); k = int(np.argmin(rows[:, 1])); t_seam = float(rows[k, 0])
print('CUT levels: %d from the shoulder line to the chin (%.0f mm), a grid step (%.2f mm) apart; neck outline found on the body at %d, on the bust at %d, on both at %d'
      % (len(rows), t_chin * 1000, step * 1000, (rows[:, 2] > 0).sum(), (rows[:, 3] > 0).sum(), np.isfinite(rows[:, 1]).sum()))
for t, m, ab, ah in rows[:: max(1, len(rows) // 14)]: print('CUT   level %5.1f mm: outlines differ %6.2f mm; neck section body %6.1f cm2, bust %6.1f cm2' % (t * 1000, m * 1000, ab * 1e4, ah * 1e4))
if not np.isfinite(rows[k, 1]): raise SystemExit('CUT: no level has a neck outline in both models')
print('CUT seam: %.1f mm above the shoulder line (height %.3f m): outlines differ %.2f mm; neck section body %.1f cm2, bust %.1f cm2' % (t_seam * 1000, (S + t_seam * ax)[2], rows[k, 1] * 1000, rows[k, 2] * 1e4, rows[k, 3] * 1e4))
# ---- flush: the body's neck top drawn in wherever it would stand out past the bust's section at the seam
Lb, Lh = body.neck(t_seam), bust.neck(t_seam); mid = Lb['q'].mean(0); c0 = S + t_seam * ax + mid[0] * u + mid[1] * v
qb, qh = Lb['q'] - mid, Lh['q'] - mid
def reach(q, ang):
    """how far the outline lies from the middle in each direction: the first crossing of the ray with the outline"""
    a0, a1 = q, np.roll(q, -1, 0); dx = np.stack([np.cos(ang), np.sin(ang)], 1); e = a1 - a0
    den = dx[:, None, 0] * e[None, :, 1] - dx[:, None, 1] * e[None, :, 0]; den = np.where(den == 0, np.nan, den)
    tr = (a0[None, :, 0] * e[None, :, 1] - a0[None, :, 1] * e[None, :, 0]) / den; ts = (a0[None, :, 0] * dx[:, None, 1] - a0[None, :, 1] * dx[:, None, 0]) / den
    tr = np.where((tr > 0) & (ts >= 0) & (ts <= 1), tr, np.inf); return tr.min(1)
angs = np.sort(np.arctan2(qb[:, 1], qb[:, 0])); angs = (angs + np.roll(angs, -1)) / 2; angs[-1] += np.pi; angs = np.sort((angs + np.pi) % (2 * np.pi) - np.pi)   # between the outline's own points (a ray through a corner can slip past both its sides)
rb_, rh_ = reach(qb, angs), reach(qh, angs); R = float(rb_.mean()); inside = bool(np.isfinite(rh_).all())
over = np.maximum(0, rb_ - np.where(np.isfinite(rh_), rh_, rb_))
fade = lambda x: (lambda y: y * y * (3 - 2 * y))(np.clip(1 - x, 0, 1))                         # STRUCTURAL: smooth, 1 at 0 and 0 from 1 on
rel = Vb - c0; tt = rel @ ax; rad = rel - tt[:, None] * ax; rr = np.linalg.norm(rad, axis=1); th = np.arctan2(rad @ v, rad @ u)
r_b = np.interp(th, angs, rb_, period=2 * np.pi); ov = np.interp(th, angs, over, period=2 * np.pi)
w = fade(np.maximum(-tt, 0) / R) * fade(np.maximum(rr - r_b, 0) / R)                           # fades below the seam and outside the neck, over one neck radius
Vb = Vb - (rad / np.maximum(rr, 1e-12)[:, None]) * (w * ov * np.minimum(rr / r_b, 1))[:, None]
body = Model(Vb, Fb, 'body'); Lb2 = body.neck(t_seam); qb2 = Lb2['q'] - mid; rb2 = reach(qb2, angs)
print('CUT flush: neck radius %.1f mm; the body neck stood out past the bust section over %.0f%% of its outline, by up to %.1f mm (mean %.1f); after drawing it in: up to %.1f mm'
      % (R * 1000, 100 * (over > 0).mean(), over.max() * 1000, over.mean() * 1000, np.maximum(0, rb2 - np.where(np.isfinite(rh_), rh_, rb2)).max() * 1000))
# ---- picture
W = 420; im = Image.new('RGB', (W * 4, W * 2), 'white'); dr = ImageDraw.Draw(im); ks = sorted(loops)[:: max(1, len(loops) // 6)][:6]
for i, kk in enumerate(ks + ['seam', 'after']):
    ox, oy = (i % 4) * W + W // 2, (i // 4) * W + W // 2; pa, pb = (qb + mid, qh + mid) if kk == 'seam' else (qb2 + mid, qh + mid) if kk == 'after' else loops[kk]
    for q, col in ((pa, (30, 90, 220)), (pb, (220, 40, 40))):
        pts = [(ox + x * 2500, oy + y * 2500) for x, y in q]; dr.line(pts + pts[:1], fill=col, width=2)
    dr.text((ox - W // 2 + 6, oy - W // 2 + 6), 'seam %.0f mm' % (t_seam * 1000) if kk == 'seam' else 'seam, body neck drawn in' if kk == 'after' else 'level %.0f mm: differ %.1f mm' % (rows[kk, 0] * 1000, rows[kk, 1] * 1000), fill='black')
im.save(os.path.join(OUT, 'seam.png'))
# ---- cut: each model clipped along where a field changes sign, the rim capped (the result is closed)
def clip(V, F, f, name):
    n = len(V); s = f > 0; fs = s[F]; keep = F[fs.all(1)]; Fc = F[fs.any(1) & ~fs.all(1)]; m = len(Fc); sc = s[Fc]; one = sc.sum(1) == 1
    lone = np.where(one, np.argmax(sc, 1), np.argmin(sc, 1)); r = np.arange(m); A, B, C = Fc[r, lone], Fc[r, (lone + 1) % 3], Fc[r, (lone + 2) % 3]
    keys = np.concatenate([np.sort(np.stack([A, B], 1), 1), np.sort(np.stack([A, C], 1), 1)]); uq, inv = np.unique(keys, axis=0, return_inverse=True); inv = inv.reshape(-1)
    fa, fb = f[uq[:, 0]], f[uq[:, 1]]; new = V[uq[:, 0]] + (fa / (fa - fb))[:, None] * (V[uq[:, 1]] - V[uq[:, 0]]); AB, AC = n + inv[:m], n + inv[m:]
    tris = [keep, np.stack([A, AB, AC], 1)[one], np.stack([AB, B, C], 1)[~one], np.stack([AB, C, AC], 1)[~one]]
    e0, e1 = np.where(one, AB, AC), np.where(one, AC, AB)                                      # the rim, in the direction the kept faces run it
    k = len(uq); nc, lab = connected_components(coo_matrix((np.ones(m), (e0 - n, e1 - n)), shape=(k, k)), directed=False)
    cen = np.stack([np.bincount(lab, new[:, j], nc) for j in range(3)], 1) / np.bincount(lab, minlength=nc)[:, None]
    tris.append(np.stack([e1, e0, n + k + lab[e0 - n]], 1)); V2 = np.concatenate([V, new, cen]); F2 = np.concatenate(tris)
    used = np.unique(F2); re = np.full(len(V2), -1); re[used] = np.arange(len(used)); print('CUT %s: clipped through %d faces, %d rims capped; %d faces kept' % (name, m, nc, len(F2)))
    return V2[used], re[F2]
# the body: opened along its neck outline only; what stays joined to its base is kept, loose pieces go with the nearer side
d = body.d0 - t_seam; loop_f = np.zeros(len(Fb), bool); loop_f[Lb2['faces']] = True; rest = Fb[~loop_f]; e = np.concatenate([rest[:, :2], rest[:, 1:]])
nc, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(body.n, body.n)), directed=False); hi_l, lo_l = lab[body.top], lab[body.base]
if hi_l == lo_l: raise SystemExit('CUT: the body is still one piece with its neck outline opened')
side_hi = np.zeros(nc, bool); side_hi[hi_l] = True; li = np.nonzero((lab != hi_l) & (lab != lo_l))[0]
if len(li):
    dh = np.bincount(lab[li], cKDTree(Vb[lab == hi_l]).query(Vb[li])[0], nc); dl = np.bincount(lab[li], cKDTree(Vb[lab == lo_l]).query(Vb[li])[0], nc); side_hi |= dh < dl; side_hi[lo_l] = False
is_head = side_hi[lab]; size = np.bincount(lab, minlength=nc)
print('CUT body: opened along its neck outline (%d faces): head side %d points, base side %d points, %d loose pieces (%d points) to the nearer side' % (loop_f.sum(), size[hi_l], size[lo_l], nc - 2, len(li)))
Vb2, Fb2 = clip(Vb, Fb, np.where(is_head, -1, 1) * np.maximum(np.abs(d), np.finfo(float).tiny), 'body')
# the bust: kept wherever it lies nearer the body's head side than the body's base side (so its hair stays, wherever it hangs, and its
# own shoulders and collar go); the body's cut face itself counts for the base side
cap = c0 + (np.stack([np.cos(angs), np.sin(angs)], 1) * rb2[:, None]) @ np.stack([u, v]); grid = np.linspace(0, 1, max(2, int(np.ceil(R / step))))[:, None, None]
disc = (c0 + grid * (cap - c0)[None]).reshape(-1, 3)
d_head = cKDTree(np.concatenate([Vb[is_head], disc + step * ax])).query(Vh)[0]; d_base = cKDTree(np.concatenate([Vb[~is_head], disc - step * ax])).query(Vh)[0]
f = d_base - d_head; f = np.where(f == 0, np.finfo(float).tiny, f)
print('CUT bust: %d of %d points nearer the body head side' % ((f > 0).sum(), len(f)))
Vh2, Fh2 = clip(Vh, Fh, f, 'bust')
save(os.path.join(OUT, 'body_cut.glb'), Vb2, Fb2); save(os.path.join(OUT, 'bust_cut.glb'), Vh2, Fh2)
json.dump({'axis': ax.tolist(), 'shoulder_mid': S.tolist(), 'seam_t': t_seam, 'seam_point': c0.tolist(), 'neck_radius': R, 'chin_t': t_chin, 'step': step, 'levels': rows.tolist()}, open(os.path.join(OUT, 'merge.json'), 'w'), indent=1)
print('CUT saved: body part %d faces, bust part %d faces' % (len(Fb2), len(Fh2)))
