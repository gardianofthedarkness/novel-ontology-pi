"""Bone weights for a layered figure, read from one field solved through the rig solid's volume.
python volume_weights.py <rig solid.npz: V, W, names> <figure.npz: V> <out.npz> <merged_solid.glb>
  grid     the solid on a grid of two of its own point spacings (surface cells joined up, the inside flooded from outside)
  field    each bone's weight is fixed on the surface cells (the solid's own bone-heat weight at the nearest surface point) and
           solved inside as the harmonic field (each inside cell the mean of its six neighbours): the smoothest field that
           agrees with the surface
  read     every figure point, whichever layer it is on, reads the field at its own place (trilinear between cell centres;
           a point outside the solid reads its nearest solid cell); four largest kept, normalized (glTF's four influences)"""
import sys
import numpy as np
from scipy import ndimage, sparse
from scipy.sparse.linalg import cg
from scipy.spatial import cKDTree
SOL, FIG, OUT = sys.argv[1:4]; s = np.load(SOL, allow_pickle=True); V, W, names = s['V'], s['W'].astype(float), s['names']; P = np.load(FIG, allow_pickle=True)['V']
# the grid is drawn from the dense filled solid (rawmerge/solid.py), the weights come from the rig's own simplified copy of it
import trimesh
md = trimesh.load(sys.argv[4], force='mesh', process=False); D = np.asarray(md.vertices, float); D = np.stack([D[:, 0], -D[:, 2], D[:, 1]], 1); Fd = np.asarray(md.faces)
D = (D - [(D[:, 0].min() + D[:, 0].max()) / 2, (D[:, 1].min() + D[:, 1].max()) / 2, D[:, 2].min()]) * ((V[:, 2].max() - V[:, 2].min()) / (D[:, 2].max() - D[:, 2].min())) + [(V[:, 0].min() + V[:, 0].max()) / 2, (V[:, 1].min() + V[:, 1].max()) / 2, V[:, 2].min()]   # stood as the rig stands its copy
h = 2 * float(np.median(np.linalg.norm(D[Fd[:, 0]] - D[Fd[:, 1]], axis=1))); lo = D.min(0) - 3 * h; n = np.ceil((D.max(0) - lo) / h).astype(int) + 3
g = np.zeros(n, bool)
for Q in (D, D[Fd].mean(1)): g[tuple(np.floor((Q - lo) / h).astype(int).T)] = True
lab, _ = ndimage.label(~g); inside = (lab != lab[0, 0, 0]) & ~g; solid = inside | g
idx = -np.ones(n, np.int64); ii = np.argwhere(inside); idx[tuple(ii.T)] = np.arange(len(ii)); sc = np.argwhere(g)
_, near = cKDTree(V).query((sc + 0.5) * h + lo); Wg = np.zeros(tuple(n) + (W.shape[1],), np.float32); Wg[tuple(sc.T)] = W[near]
rows, cols, vals = [np.arange(len(ii))], [np.arange(len(ii))], [np.full(len(ii), 6.0)]; B = np.zeros((len(ii), W.shape[1]))
for ax in range(3):
    for sg in (-1, 1):
        nb = ii.copy(); nb[:, ax] += sg; j = idx[tuple(nb.T)]; ins = j >= 0
        rows.append(np.nonzero(ins)[0]); cols.append(j[ins]); vals.append(np.full(ins.sum(), -1.0))
        B[~ins] += Wg[tuple(nb[~ins].T)]                                          # a surface neighbour: its fixed value goes to the right side
A = sparse.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(len(ii), len(ii)))
its = 0
for k in range(W.shape[1]):
    if not B[:, k].any(): continue
    x, info = cg(A, B[:, k], rtol=float(np.finfo(np.float32).eps) ** 0.5, maxiter=4000); Wg[tuple(ii.T) + (np.full(len(ii), k),)] = x; its += 1   # NUMERIC: precision, cap
print('VOLUME grid %.1f mm: %d surface cells, %d inside cells; %d bone fields solved' % (h * 1000, len(sc), len(ii), its))
# read: trilinear over the solid's cells only
q = (P - lo) / h - 0.5; q0 = np.floor(q).astype(int); f = q - q0; acc = np.zeros((len(P), W.shape[1])); wsum = np.zeros(len(P))
for dx in (0, 1):
    for dy in (0, 1):
        for dz in (0, 1):
            c = q0 + (dx, dy, dz); ok = ((c >= 0) & (c < n)).all(1); c = np.clip(c, 0, n - 1); m = ok & solid[tuple(c.T)]
            w = np.where(dx, f[:, 0], 1 - f[:, 0]) * np.where(dy, f[:, 1], 1 - f[:, 1]) * np.where(dz, f[:, 2], 1 - f[:, 2]) * m
            acc += w[:, None] * Wg[tuple(c.T)]; wsum += w
out = wsum <= 0
if out.any():
    cells = np.argwhere(solid); _, j = cKDTree((cells + 0.5) * h + lo).query(P[out]); acc[out] = Wg[tuple(cells[j].T)]; wsum[out] = 1
Wp = acc / wsum[:, None]; Wp[Wp < 0] = 0
keep = np.argsort(-Wp, axis=1)[:, :4]; W4 = np.zeros_like(Wp); np.put_along_axis(W4, keep, np.take_along_axis(Wp, keep, 1), 1); W4 /= np.maximum(W4.sum(1, keepdims=True), 1e-12)
np.savez(OUT, W=W4.astype(np.float32), names=names)
print('VOLUME read %d figure points (%d outside the solid took their nearest cell)' % (len(P), out.sum()))
