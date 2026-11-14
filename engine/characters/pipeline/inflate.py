"""Pipeline C (no 3D model): inflate a front view's outline into a closed body, Monster-Mash style.
Each pixel inside the outline gets a thickness that grows with the square root of its distance to the edge;
the volume is meshed with marching cubes and written as a GLB the dress/rig step can take.
usage: inflate.py <view-dir with mask.npy + view.json> <out.glb> [--scale=2] [--depth=0.55]"""
import json, os, sys
import numpy as np, cv2, trimesh
from skimage import measure
VIEW, OUT = sys.argv[1], sys.argv[2]
fl = dict(a[2:].split('=', 1) for a in sys.argv[3:] if a.startswith('--'))
step = int(fl.get('scale', 2)); depth_k = float(fl.get('depth', 0.55))
view = json.load(open(os.path.join(VIEW, 'view.json')))
mask = np.load(os.path.join(VIEW, 'mask.npy')).astype(np.uint8)
x0, y0, x1, y1 = view['bbox']; m = mask[y0:y1 + 1, x0:x1 + 1]
m = cv2.resize(m, (m.shape[1] // step, m.shape[0] // step), interpolation=cv2.INTER_NEAREST)
# separate limbs from the body where the outline pinches (opening keeps thin gaps open)
dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
thick = depth_k * np.sqrt(dt * dt.max())                 # half-thickness in pixels; round sections, flat-ish torso
thick[m == 0] = 0
D = int(thick.max()) + 3
h, w = m.shape
vol = np.zeros((h, w, 2 * D + 1), np.float32)
zz = np.arange(-D, D + 1)[None, None, :]
vol = thick[:, :, None] - np.abs(zz)                     # >0 inside
vol = np.pad(vol, 1, constant_values=-1)
verts, faces, _, _ = measure.marching_cubes(vol, 0.0)
verts -= 1
# (row, col, depth) -> x right, y depth (front -Y), z up; scaled later by the rig step
V = np.stack([verts[:, 1], verts[:, 2] - D, (h - verts[:, 0])], 1).astype(np.float32)
mesh = trimesh.Trimesh(V, faces[:, ::-1], process=True)
trimesh.smoothing.filter_taubin(mesh, iterations=12)
# glTF is Y-up: convert (x, y, z) Blender-style -> (x, z, -y)
mesh.vertices = np.stack([mesh.vertices[:, 0], mesh.vertices[:, 2], -mesh.vertices[:, 1]], 1)
mesh.export(OUT)
print('inflated', OUT, len(mesh.vertices), 'verts')
