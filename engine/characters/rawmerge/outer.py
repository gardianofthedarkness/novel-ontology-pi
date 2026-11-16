"""A volume-remeshed model's outer skin alone: python outer.py <in.glb> <out.glb>
The remesh of a shell gives its outside and, inside it, the walls of its hollow as separate closed pieces; a hollow's wall
encloses a negative volume (its faces look into the hollow). Those are dropped, and of the rest the largest piece is kept."""
import sys
import numpy as np, trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
m = trimesh.load(sys.argv[1], force="mesh", process=False); V = np.asarray(m.vertices, float); F = np.asarray(m.faces)
V, inv = np.unique(V.round(9), axis=0, return_inverse=True); F = inv.reshape(-1)[F]
e = np.concatenate([F[:, :2], F[:, 1:]]); nc, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(V), len(V))), directed=False)
fl = lab[F[:, 0]]; vol = np.bincount(fl, (V[F[:, 0]] * np.cross(V[F[:, 1]], V[F[:, 2]])).sum(1) / 6, nc); k = int(np.argmax(vol))
F2 = F[fl == k]; used = np.unique(F2); re = np.full(len(V), -1); re[used] = np.arange(len(used))
trimesh.Trimesh(V[used], re[F2], process=False).export(sys.argv[2])
print("OUTER kept %d faces (%.1f litres); dropped %d hollows and %d other pieces" % (len(F2), vol[k] * 1000, int((vol < 0).sum()), int((vol >= 0).sum()) - 1))
