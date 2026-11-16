import numpy as np, trimesh, sys
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
m = trimesh.load(sys.argv[1], force="mesh", process=False); V = np.asarray(m.vertices); F = np.asarray(m.faces)
V, inv = np.unique(V.round(9), axis=0, return_inverse=True); F = inv.reshape(-1)[F]
e = np.concatenate([F[:, :2], F[:, 1:]]); nc, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(V), len(V))), directed=False)
fl = lab[F[:, 0]]; cnt = np.bincount(fl, minlength=nc); k = np.argmax(cnt); F2 = F[fl == k]; used = np.unique(F2); re = np.full(len(V), -1); re[used] = np.arange(len(used))
trimesh.Trimesh(V[used], re[F2], process=False).export(sys.argv[2]); print("MAIN kept", len(F2), "faces; dropped", nc - 1, "loose pieces with", len(F) - len(F2), "faces; largest dropped", int(np.sort(cnt)[-2]) if nc > 1 else 0)
