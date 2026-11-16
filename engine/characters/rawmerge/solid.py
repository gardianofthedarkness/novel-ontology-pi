"""A layered figure as one solid, for the rig to measure and weight (never drawn): python solid.py <merged.glb> <out.glb>
The merged figure is layered (a jacket's outer and inner walls with the body inside, joined at the open hem); bone heat and the
rig's own clean-up want one solid. On a grid of two of the figure's point spacings (so its surface cells join up):
  filled   a cell is inside when it lies between the figure's first and last surface cell along all three grid directions
           (what an outside viewer looking along each axis cannot see into), or the outside flood cannot reach it
  surface  the solid's boundary by marching cubes on its signed distance, half a cell in (the surface cells' own half width)"""
import sys
import numpy as np, trimesh
from scipy import ndimage
from skimage.measure import marching_cubes
m = trimesh.load(sys.argv[1], force="mesh", process=False); V = np.asarray(m.vertices, float); F = np.asarray(m.faces)
ef = float(np.median(np.linalg.norm(V[F[:, 0]] - V[F[:, 1]], axis=1))); h = 2 * ef; lo = V.min(0) - 3 * h; n = np.ceil((V.max(0) - lo) / h).astype(int) + 3
g = np.zeros(n, bool)
for P in (V, V[F].mean(1)): g[tuple(np.floor((P - lo) / h).astype(int).T)] = True
between = np.ones(n, bool)
for ax in range(3):
    fwd = np.maximum.accumulate(g, axis=ax); bwd = np.flip(np.maximum.accumulate(np.flip(g, ax), axis=ax), ax); between &= fwd & bwd
lab, _ = ndimage.label(~g); solid = between | g | (lab != lab[0, 0, 0])
lab2, k = ndimage.label(solid); solid = lab2 == (1 + int(np.argmax(ndimage.sum(solid, lab2, range(1, k + 1)))))
sd = ndimage.distance_transform_edt(~solid) - ndimage.distance_transform_edt(solid)
v, f, _, _ = marching_cubes(sd, level=-0.5)
out = trimesh.Trimesh((v + 0.5) * h + lo, f[:, ::-1], process=False)
if out.volume < 0: out.invert()
out.export(sys.argv[2])
print("SOLID grid %.1f mm: figure %.1f litres as layered, %.1f litres filled; %d faces" % (h * 1000, abs(m.volume) * 1000, out.volume * 1000, len(f)))
