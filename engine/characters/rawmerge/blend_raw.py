"""Version 4 of the raw-stage join: the fusion happens LOW, across the collar and shoulders, not on the neck.
python blend_raw.py <out-dir>      (needs body_skin.glb, bust_def.glb = the bust with its neck bone laid on the body's (neck_raw.py), neck.json)
  The bust keeps its head, its neck, its collar and the top of its shoulders. Below its shoulder line its shape is blended into the
  body's, over the whole depth the bust reaches below that line, and sideways over the same length before the bust's own width ends:
    share    1 (all bust) at the body's neck base and above, falling smoothly (STRUCTURAL: smoothstep) to 0 (all body) at the bust's
             lower edge; likewise from 1 to 0 toward the bust's side edges
    blend    both models as solids on the grid (inside or outside by slicing each model level by level; how far by the nearest
             surface point); the blended solid is share x bust + (1 - share) x body, and its surface is taken from that
  Parts for the fusion (skin.py -- merge4): the body with the blend box taken out, the blended piece, the bust's head above the
  chin level. Where they meet the share is exactly 0 or 1, so the pieces agree there.
  Writes body_nh.glb, blend.glb, box_blend.glb, box_head.glb, blend.json."""
import json, os, sys
import numpy as np, trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw, ImageChops
from skimage.measure import marching_cubes
from scipy.ndimage import distance_transform_edt
OUT = sys.argv[1]; J = json.load(open(os.path.join(OUT, 'neck.json')))
def load(p):
    m = trimesh.load(p, force='mesh', process=False); V = np.asarray(m.vertices, float); F = np.asarray(m.faces, np.int64)
    V, inv = np.unique(V.round(9), axis=0, return_inverse=True); F = inv.reshape(-1)[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1), F
def save(p, V, F): trimesh.Trimesh(np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1), F, process=False).export(p)
def no_hollows(V, F):
    e = np.concatenate([F[:, :2], F[:, 1:]]); nc, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(V), len(V))), directed=False)
    fl = lab[F[:, 0]]; vol = np.bincount(fl, np.einsum('ij,ij->i', V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])) / 6, nc); F = F[vol[fl] > 0]
    used = np.unique(F); re = np.full(len(V), -1); re[used] = np.arange(len(used)); return V[used], re[F]
Vb, Fb = no_hollows(*load(os.path.join(OUT, 'body_skin.glb'))); Vh, Fh = no_hollows(*load(os.path.join(OUT, 'bust_def.glb'))); save(os.path.join(OUT, 'body_nh.glb'), Vb, Fb)
S, ax, step, t1, R = np.array(J['body_shoulder_mid']), np.array(J['axis']), J['step'], J['top_t'], J['neck_radius']
u = np.cross([0, 1, 0], ax); u /= np.linalg.norm(u); v = np.cross(ax, u); B3 = np.stack([u, v, ax])       # the frame: left, back, up the neck
Lb, Lh = (Vb - S) @ B3.T, (Vh - S) @ B3.T                                                                   # both models in that frame
# ---- the bust's own reach: its lower edge and its side edges (its lowest point; its half-width within a neck radius of the shoulder line)
t_lo = float(Lh[:, 2].min()); g = Lh[np.abs(Lh[:, 2]) < R]; x0 = float(np.median(g[:, 0])); Wb = float(np.ptp(g[:, 0]) / 2); depth = -t_lo
t_nb = J['body_neck_base_t']; tA = t_lo + 2 * step; span = t_nb - tA                                                                         # the blend's depth: from two grid steps above the bust's lower edge (its closing face) up to the body's neck base (where its neck enters its shoulders)
print('BLEND bust reach: %.1f mm below the shoulder line, half-width %.1f mm (centre %.1f mm off the body shoulder middle); blend depth %.1f mm, the same length sideways' % (depth * 1000, Wb * 1000, x0 * 1000, span * 1000))
if span < 4 * step: raise SystemExit('BLEND: the bust reaches too little below its shoulder line to blend there')
xs = x0 + np.arange(-int(np.ceil(Wb / step)), int(np.ceil(Wb / step)) + 1) * step; ts = np.arange(int(np.floor(tA / step)) - 1, int(np.ceil(t1 / step)) + 2) * step
inb = (np.abs(Lb[:, 0] - x0) < Wb + step) & (Lb[:, 2] > ts[0] - step) & (Lb[:, 2] < ts[-1] + step); inh = (Lh[:, 2] > ts[0] - step) & (Lh[:, 2] < ts[-1] + step)
ylo = min(Lb[inb, 1].min(), Lh[inh, 1].min()) - 3 * step; yhi = max(Lb[inb, 1].max(), Lh[inh, 1].max()) + 3 * step; ys = np.arange(ylo, yhi + step, step)
print('BLEND grid: %d x %d x %d at %.2f mm' % (len(xs), len(ys), len(ts), step * 1000))
def solid(L, F, filled=False):
    """inside (True) or outside on the grid: each level's section outlines filled, one inside another flipping (even-odd)"""
    occ = np.zeros((len(xs), len(ys), len(ts)), bool); z = L[:, 2]
    for k, t in enumerate(ts):
        d = z - (t + step * 1e-3); s = d > 0; fs = s[F]; idx = np.nonzero(fs.any(1) & ~fs.all(1))[0]
        if not len(idx): continue
        Fc = F[idx]; sc = s[Fc]; lone = np.where(sc.sum(1) == 1, np.argmax(sc, 1), np.argmin(sc, 1)); r = np.arange(len(Fc)); A, Bv, C = Fc[r, lone], Fc[r, (lone + 1) % 3], Fc[r, (lone + 2) % 3]
        keys = np.concatenate([np.sort(np.stack([A, Bv], 1), 1), np.sort(np.stack([A, C], 1), 1)]); uq, inv = np.unique(keys, axis=0, return_inverse=True); inv = inv.reshape(-1)
        n1, n2 = inv[:len(Fc)], inv[len(Fc):]; da, db = d[uq[:, 0]], d[uq[:, 1]]; pts = L[uq[:, 0]] + (da / (da - db))[:, None] * (L[uq[:, 1]] - L[uq[:, 0]])
        nbr = {}
        for a_, b_ in zip(n1.tolist(), n2.tolist()): nbr.setdefault(a_, []).append(b_); nbr.setdefault(b_, []).append(a_)
        img = Image.new('1', (len(xs), len(ys)), 0); seen = set()
        for st in nbr:
            if st in seen or len(nbr[st]) != 2: continue
            loop = [st]; seen.add(st); prev, cur = st, nbr[st][0]
            while cur != st and cur not in seen and len(nbr.get(cur, [])) == 2:
                loop.append(cur); seen.add(cur); nx = nbr[cur][0] if nbr[cur][0] != prev else nbr[cur][1]; prev, cur = cur, nx
            if cur != st or len(loop) < 3: continue
            q = pts[loop]; poly = [((a_ - xs[0]) / step, (b_ - ys[0]) / step) for a_, b_ in q[:, :2]]
            one = Image.new('1', img.size, 0); ImageDraw.Draw(one).polygon(poly, fill=1); img = ImageChops.logical_or(img, one) if filled else ImageChops.logical_xor(img, one)
        occ[:, :, k] = np.array(img, bool).T
    return occ
G = np.stack(np.meshgrid(xs, ys, ts, indexing='ij'), -1).reshape(-1, 3)
def sdf(L, F, name, through=False):
    """the model as a solid on the grid, signed: outside, the distance to its surface; inside its own walls, the same (so its surface
    stays exactly where it is); inside what the filling added (the hollow of a shell), the depth to the filled solid's boundary"""
    wall = solid(L, F); full = solid(L, F, True)
    if through: full = np.maximum.accumulate(full, 1) & np.maximum.accumulate(full[:, ::-1], 1)[:, ::-1]      # STRUCTURAL: a bust has a front and a back; whatever lies between them is inside (its chest is two sheets, open at the sides)
    full |= wall; near = (L[:, 2] > ts[0] - 0.1) & (L[:, 2] < ts[-1] + 0.1); dist = cKDTree(L[near]).query(G, workers=-1)[0].reshape(full.shape)
    print('BLEND %s as a solid: walls %.1f%% of the grid, filled %.1f%%' % (name, 100 * wall.mean(), 100 * full.mean()))
    return np.where(wall, -dist, np.where(full, -np.maximum((distance_transform_edt(full) - 0.5) * step, dist), dist))
# both models are shells (the body: clothes with real openings at the sleeves; the bust: open underneath), so each is filled
sb, sh = sdf(Lb, Fb, 'body'), sdf(Lh, Fh, 'bust', True)
sm = lambda x: (lambda y: y * y * (3 - 2 * y))(np.clip(x, 0, 1))                                             # STRUCTURAL: smoothstep
wz = sm((ts - tA) / span); wx = sm((Wb - np.abs(xs - x0)) / span); w = wx[:, None, None] * wz[None, None, :]
f = w * sh + (1 - w) * sb
# ---- smoothing
# 1. the bust's solid was filled in level by level and front to back, so its filled faces are stepped at the grid's scale: the piece is
#    smoothed over one cell (NUMERIC: the grid's own scale) in proportion to the bust's share, so where it is all body (the box's bottom
#    and sides, where it must meet the kept body exactly) nothing changes
from scipy.ndimage import convolve, gaussian_filter
f = f + w * (gaussian_filter(f, 1.0) - f)
# 2. the transition itself: only where the two models are actually mixed (strength 4 x share x (1 - share): nothing where the piece is all
#    body or all bust, full where it is half and half), each pass moving a cell toward the mean of its six neighbours. The number of passes
#    is the knee of the roughness curve (roughness: how far a surface cell stands from its neighbours' mean, in the mixed zone)
K6 = np.zeros((3, 3, 3)); K6[0, 1, 1] = K6[2, 1, 1] = K6[1, 0, 1] = K6[1, 2, 1] = K6[1, 1, 0] = K6[1, 1, 2] = 1 / 6
m = 4 * w * (1 - w); core = np.broadcast_to(m > 0.5, f.shape)
def rough(a_): return float(np.abs(convolve(a_, K6, mode='nearest') - a_)[core & (np.abs(a_) < step)].mean())
CAPS = 64; g = f.copy(); hist = [rough(g)]                                                               # NUMERIC: the curve's length
for _ in range(CAPS): g = g + m * (convolve(g, K6, mode='nearest') - g); hist.append(rough(g))
h = np.array(hist); xk = np.arange(CAPS + 1) / CAPS; yk = (h - h[-1]) / max(1e-12, h[0] - h[-1]); passes = int(np.argmax(1 - xk - yk))
for _ in range(passes): f = f + m * (convolve(f, K6, mode='nearest') - f)
print('BLEND smoothing: transition roughness %.3f mm -> %.3f mm after %d passes (the knee; %.3f mm after all %d)' % (h[0] * 1000, h[passes] * 1000, passes, h[-1] * 1000, CAPS))
# closed at the box: where the piece meets the kept body (sides and bottom: share 0) and the kept head (top: share 1) its closing faces lie on the box
f[0], f[-1], f[:, 0], f[:, -1], f[:, :, 0], f[:, :, -1] = (step,) * 6
mv, mf, _, _ = marching_cubes(f, 0.0, spacing=(step,) * 3); mv = mv + np.array([xs[0], ys[0], ts[0]])
if np.einsum('ij,ij->i', mv[mf[:, 0]], np.cross(mv[mf[:, 1]], mv[mf[:, 2]])).sum() < 0: mf = mf[:, ::-1]
save(os.path.join(OUT, 'blend.glb'), S + mv @ B3, mf); print('BLEND piece: %d faces' % len(mf))
def box(x_lo, x_hi, y_lo, y_hi, z_lo, z_hi, name):
    c = np.array([[x, y, z] for x in (x_lo, x_hi) for y in (y_lo, y_hi) for z in (z_lo, z_hi)]); fc = np.array([[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]])
    if np.einsum('ij,ij->i', c[fc[:, 0]], np.cross(c[fc[:, 1]], c[fc[:, 2]])).sum() < 0: fc = fc[:, ::-1]
    save(os.path.join(OUT, name), S + c @ B3, fc)
big = 4.0   # NUMERIC: beyond any figure (metres)
# the body gives up the inside of the grid's box (one grid cell in from the grid's faces, where the piece's closing faces lie) and everything above it
# (a cell and a half in, so each kept part overlaps the piece by at least half a cell: the piece's closing faces fall somewhere inside the first cell)
box(xs[1] + step / 2, xs[-2] - step / 2, -big, big, ts[1] + step / 2, big, 'box_blend.glb'); box(-big, big, -big, big, ts[-2] - step / 2, big, 'box_head.glb')
json.dump({'bust_lower_edge_t': t_lo, 'blend_from_t': tA, 'blend_depth': span, 'half_width': Wb, 'centre_x': x0, 'top_t': float(ts[-1]), 'grid': [len(xs), len(ys), len(ts)]}, open(os.path.join(OUT, 'blend.json'), 'w'), indent=1)
print('BLEND saved')
