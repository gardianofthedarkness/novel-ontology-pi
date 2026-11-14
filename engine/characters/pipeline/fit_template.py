"""Fit the head template (template_head.py) onto a generated head by gradient descent, coarse to fine.
usage: python fit_template.py <template-dir> <head-dir> <out-dir> [--levels=2] [--steps=500] [--device=cuda]
  <head-dir>: head.obj + head.json (export_head.py): the generated head, each point's free-hair share, its 68 face points.
  1. Align: the template's landmark vertices onto the face points (rotation, uniform scale, position).
  2. Fit (Adam on every vertex's offset): the template's points onto the head's surface and the surface covered by them
     (both ways, so nothing is left bare), hanging hair left out (the template is the head, not the locks); its landmark
     vertices onto the face points; its own shape kept (a Laplacian term against the aligned template, so rings stay
     rings and big quads stay even).
  3. Subdivide (Catmull-Clark: every quad into four, rings and regions kept) and fit again, --levels times, the shape
     term loosened each level. Big quads stay where the head is smooth because they started big; the rings around the
     eyes and mouth, dense from the start, follow the face's fast changes.
  Writes fitted.obj (quads), fitted.json (each face's region; the landmark vertices), and the fit's distances."""
import json, math, os, sys, time
import numpy as np
import torch
args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in sys.argv[1:] if a.startswith('--'))
TDIR, HDIR, OUT = args[:3]; os.makedirs(OUT, exist_ok=True)
LEVELS, STEPS = int(flags.get('levels', 2)), int(flags.get('steps', 500))
SAMPLE = int(flags.get('sample', 6000))
dev = torch.device(flags.get('device', 'cuda') if torch.cuda.is_available() else 'cpu')
def read_obj(p):
    V, F = [], []
    for line in open(p):
        s = line.split()
        if not s: continue
        if s[0] == 'v': V.append([float(x) for x in s[1:4]])
        elif s[0] == 'f': F.append([int(x.split('/')[0]) - 1 for x in s[1:]])
    return np.array(V), F
TV, TF = read_obj(os.path.join(TDIR, 'template.obj')); TF = np.array(TF)
tmeta = json.load(open(os.path.join(TDIR, 'template.json'))); regions = np.array(tmeta['regions'])
tmarks = {int(k): v for k, v in tmeta['marks'].items()}
HV, HF = read_obj(os.path.join(HDIR, 'head.obj')); HF = np.array([f[:3] for f in HF])
hmeta = json.load(open(os.path.join(HDIR, 'head.json'))); free = np.array(hmeta['free_hair'])
hmarks = {int(k): np.array(v) for k, v in hmeta['marks'].items()}

# ---- 1. similarity alignment on the landmarks ----------------------------------------------------------------------
pairs = [k for k in tmarks if k in hmarks]
A = TV[[tmarks[k] for k in pairs]]; B = np.array([hmarks[k] for k in pairs])
ma, mb = A.mean(0), B.mean(0); A0, B0 = A - ma, B - mb
U, S, Vt = np.linalg.svd(B0.T @ A0); D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
R = U @ D @ Vt; sc = (S * np.diag(D)).sum() / (A0 ** 2).sum()
V0 = (sc * (R @ (TV - ma).T)).T + mb
err0 = np.linalg.norm(V0[[tmarks[k] for k in pairs]] - B, axis=1)
print('FIG aligned on %d landmarks: scale %.3f, landmark error median %.1f mm, max %.1f mm' % (len(pairs), sc, 1000 * np.median(err0), 1000 * err0.max()))

# ---- the head's surface as points (area-weighted samples), hanging hair left out ---------------------------------
rng = np.random.default_rng(0)
tri = HV[HF]; area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
NS = int(flags.get('samples', 60000)); pick = rng.choice(len(HF), NS, p=area / area.sum())
u, v = rng.random(NS), rng.random(NS); flip = u + v > 1; u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
P = tri[pick, 0] + u[:, None] * (tri[pick, 1] - tri[pick, 0]) + v[:, None] * (tri[pick, 2] - tri[pick, 0])
fh = free[HF[pick]].mean(1)
anchor = P[fh < 0.3]
print('FIG head surface: %d samples, %d kept (hanging hair left out)' % (NS, len(anchor)))
T = torch.tensor(anchor, dtype=torch.float32, device=dev)
MK = torch.tensor(np.array([hmarks[k] for k in pairs]), dtype=torch.float32, device=dev)

def nearest_sq(X, Y, chunk=4096):
    """for each row of X, the squared distance to the nearest row of Y"""
    out = []
    for i in range(0, len(X), chunk):
        out.append(torch.cdist(X[i:i + chunk], Y).min(1).values ** 2)
    return torch.cat(out)

def laplacian(F, n):
    """uniform Laplacian over the quads' own edges (not their diagonals), as a sparse matrix"""
    E = set()
    for f in F:
        for k in range(len(f)): a, b = f[k], f[(k + 1) % len(f)]; E.add((min(a, b), max(a, b)))
    E = np.array(sorted(E)); deg = np.bincount(E.ravel(), minlength=n).astype(np.float32)
    rows = np.concatenate([E[:, 0], E[:, 1], np.arange(n)]); cols = np.concatenate([E[:, 1], E[:, 0], np.arange(n)])
    vals = np.concatenate([-1 / deg[E[:, 0]], -1 / deg[E[:, 1]], np.ones(n)])   # row a: -1/deg(a) for each neighbour, 1 on the diagonal
    return torch.sparse_coo_tensor(np.stack([rows, cols]), vals.astype(np.float32), (n, n), device=dev).coalesce(), E

def quad_samples(V, F):
    """four points inside each quad (bilinear), so the head's surface is covered by the faces, not only the corners"""
    q = V[F]                                     # m x 4 x 3
    out = [V]
    for s_, t_ in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
        out.append((1 - s_) * (1 - t_) * q[:, 0] + s_ * (1 - t_) * q[:, 1] + s_ * t_ * q[:, 2] + (1 - s_) * t_ * q[:, 3])
    return torch.cat(out)

def fit(Vinit, F, mark_ids, stiff, steps):
    n = len(Vinit); L, _ = laplacian(F, n)
    X0 = torch.tensor(Vinit, dtype=torch.float32, device=dev); Fq = torch.tensor(F, dtype=torch.long, device=dev)
    lap0 = torch.sparse.mm(L, X0)
    off = torch.zeros_like(X0, requires_grad=True); opt = torch.optim.Adam([off], lr=float(flags.get('lr', 0.0015)))
    mid = torch.tensor(mark_ids, dtype=torch.long, device=dev)
    for it in range(steps):
        X = X0 + off
        # stochastic: a fresh random sample of each side every step (all of both, both ways, filled a 4 GB card and ran
        # for half an hour; samples converge to the same fit in a minute)
        QS = quad_samples(X, Fq); qs = QS[torch.randint(len(QS), (min(len(QS), SAMPLE),), device=dev)]
        ts = T[torch.randint(len(T), (min(len(T), SAMPLE),), device=dev)]
        to_surface = nearest_sq(qs, T).mean()        # every part of the template on the head
        covered = nearest_sq(ts, QS).mean()          # every part of the head under the template
        marks = ((X[mid] - MK) ** 2).sum(1).mean()
        # the movement kept smooth: neighbours move alike (the Laplacian of the offsets), so the grid moves as a sheet and
        # never folds (a weak shape term let each point chase its own nearest head point: small distances, tangled quads);
        # stiff at first, relaxed step by step (non-rigid ICP's schedule)
        w = stiff[0] * (stiff[1] / stiff[0]) ** (it / max(1, steps - 1))
        shape = (torch.sparse.mm(L, off) ** 2).sum(1).mean()
        loss = to_surface + 0.3 * covered + 0.5 * marks + w * shape
        opt.zero_grad(); loss.backward(); opt.step()
        if it % 100 == 0 or it == steps - 1:
            print('FIG   step %4d: on surface %.2f mm, covered %.2f mm, landmarks %.2f mm (rms)' % (it, 1000 * to_surface.sqrt().item(), 1000 * covered.sqrt().item(), 1000 * marks.sqrt().item()), flush=True)
    return (X0 + off).detach().cpu().numpy()

def catmull_clark(V, F, reg):
    """every quad into four; corners keep their indices (so landmarks stay put); open edges (the neck's end) stay open"""
    n = len(V); fp = V[F].mean(1)
    emap, eface = {}, {}
    for fi, f in enumerate(F):
        for k in range(4):
            a, b = f[k], f[(k + 1) % 4]; e = (min(a, b), max(a, b)); eface.setdefault(e, []).append(fi)
    edges = list(eface); ep = np.zeros((len(edges), 3))
    for i, e in enumerate(edges):
        fs = eface[e]; emap[e] = n + len(F) + i
        ep[i] = (V[e[0]] + V[e[1]] + fp[fs].sum(0)) / (2 + len(fs)) if len(fs) == 2 else (V[e[0]] + V[e[1]]) / 2
    vf, ve = [[] for _ in range(n)], [[] for _ in range(n)]
    for fi, f in enumerate(F):
        for k in f: vf[k].append(fi)
    for e in edges: ve[e[0]].append(e); ve[e[1]].append(e)
    NV = V.copy()
    for k in range(n):
        if any(len(eface[e]) == 1 for e in ve[k]): continue          # on the open edge: kept
        m = len(ve[k]); Q = fp[vf[k]].mean(0); Rm = np.mean([(V[e[0]] + V[e[1]]) / 2 for e in ve[k]], 0)
        NV[k] = (Q + 2 * Rm + (m - 3) * V[k]) / m
    V2 = np.concatenate([NV, fp, ep]); F2, R2 = [], []
    for fi, f in enumerate(F):
        c = n + fi
        for k in range(4):
            a, b, d = f[k], f[(k + 1) % 4], f[(k - 1) % 4]
            F2.append([a, emap[(min(a, b), max(a, b))], c, emap[(min(d, a), max(d, a))]]); R2.append(reg[fi])
    return V2, np.array(F2), np.array(R2)

mark_ids = [tmarks[k] for k in pairs]
V, F, reg = V0, TF, regions
t = time.time()
STIFF = [(3000.0, 100.0), (300.0, 50.0), (100.0, 30.0)]
for level in range(LEVELS + 1):
    st = STIFF[min(level, len(STIFF) - 1)]
    print('FIG level %d: %d points, %d quads, stiffness %g -> %g' % (level, len(V), len(F), *st), flush=True)
    V = fit(V, F, mark_ids, st, STEPS if level == 0 else STEPS // 2)
    if level < LEVELS: V, F, reg = catmull_clark(V, F, reg)
# how well it sits: every vertex's distance to the head's surface samples (all of them, hair too), the landmarks
d = np.sqrt(nearest_sq(torch.tensor(V, dtype=torch.float32, device=dev), torch.tensor(P, dtype=torch.float32, device=dev)).cpu().numpy())
lm = np.linalg.norm(V[mark_ids] - np.array([hmarks[k] for k in pairs]), axis=1)
print('FIG fitted in %.0f s: %d points, %d quads; distance to the head median %.2f mm, 95%% %.2f mm, max %.1f mm; landmarks median %.1f mm, max %.1f mm'
      % (time.time() - t, len(V), len(F), 1000 * np.median(d), 1000 * np.percentile(d, 95), 1000 * d.max(), 1000 * np.median(lm), 1000 * lm.max()))
lines = ['v %.6f %.6f %.6f' % tuple(p) for p in V] + ['f ' + ' '.join(str(i + 1) for i in f) for f in F]
open(os.path.join(OUT, 'fitted.obj'), 'w').write('\n'.join(lines) + '\n')
json.dump({'regions': [int(r) for r in reg], 'region_names': tmeta['region_names'], 'marks': {str(k): int(tmarks[k]) for k in pairs}},
          open(os.path.join(OUT, 'fitted.json'), 'w'))
