"""The face's bones (v0.7 steps 3 and 5): the detected face points cast onto the head, the head's pivot moved up to the
skull base, and a VRM jaw bone hinged between the ears.
usage: blender -b <figure.blend> -P face_rig.py -- <render-dir> <out.blend> [--min=0.3] [--no-jaw]
  <render-dir> holds views.json (face_render.py) and marks.json (face_marks.py). Each view's points are cast along its
  view onto the Head mesh; a point is kept where its views agree (median, then those within 1.5 cm of it), then the face is
  made symmetric about the head bone's plane (each point averaged with its mirror partner's reflection). Writes the points
  to the armature (figure_face.marks) and face_marks3d.json.
  Pivot: the head bone starts at the skull base, a little below the ears (jaw contour ends 0 and 16) on the neck's axis,
  so a nod turns the skull about the top of the neck, not about the chin. The neck bone ends there too.
  Jaw: a bone from between the ears (the hinge, a little below and behind each jaw contour end) to the chin (point 8),
  child of the head, mapped as the VRM humanoid jaw. Its region: inside the face outline (jaw contour, shrunk 4 mm), below
  the line from each mouth corner (48, 54) to that side's hinge, in front of the hinge; a 1.2 cm blend at the line and
  at the ears. The jaw takes its share from the head's (the neck's share under the chin stays the neck's)."""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in argv if a.startswith('--'))
DIR, OUT = [a for a in argv if not a.startswith('--')][:2]
MIN = float(flags.get('min', 0.3)); JAW = 'no-jaw' not in flags
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; arm = rig.data; head = bpy.data.objects['Head']
F = json.loads(rig['figure_face'])
views = json.load(open(os.path.join(DIR, 'views.json')))['views']; marks = json.load(open(os.path.join(DIR, 'marks.json')))
dg = bpy.context.evaluated_depsgraph_get(); bvh = BVHTree.FromObject(head, dg)
def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)

# ---- cast each view's points onto the mesh -----------------------------------------------------------------------
hits = {i: [] for i in range(68)}
for v in views:
    m = marks['views'].get(str(int(v['angle'])))
    if not m: continue
    R = Matrix.Rotation(math.radians(v['angle']), 3, 'Z'); c = Vector(v['centre']); s = v['scale']; W, H = m['size']
    for i, (x, y, sc) in enumerate(m['points']):
        if sc < MIN: continue
        off = R @ Vector(((x / W - 0.5) * s, -v['distance'], (0.5 - y / H) * s))
        d = R @ Vector((0, 1, 0)); hit = bvh.ray_cast(c + off, d)
        # a point on a turned view's silhouette (its surface edge-on to the camera) is not where the face is
        if hit[0] is not None and -hit[1].dot(d) > 0.35: hits[i].append(np.array(hit[0]))
pts = {}
for i, hs in hits.items():
    if not hs: continue
    A = np.array(hs); med = np.median(A, 0); keep = A[np.linalg.norm(A - med, axis=1) < 0.015]
    pts[i] = keep.mean(0) if len(keep) else med
# symmetric about the head bone's plane x = bx: the 68-point layout's mirror partners
MIRROR = {**{i: 16 - i for i in range(17)}, **{17 + i: 26 - i for i in range(10)}, 27: 27, 28: 28, 29: 29, 30: 30,
          31: 35, 32: 34, 33: 33, 34: 32, 35: 31, 36: 45, 37: 44, 38: 43, 39: 42, 40: 47, 41: 46, 42: 39, 43: 38, 44: 37,
          45: 36, 46: 41, 47: 40, 48: 54, 49: 53, 50: 52, 51: 51, 52: 50, 53: 49, 54: 48, 55: 59, 56: 58, 57: 57, 58: 56,
          59: 55, 60: 64, 61: 63, 62: 62, 63: 61, 64: 60, 65: 67, 66: 66, 67: 65}
bx = arm.bones['head'].head_local.x
asym = []
sym = {}
for i, p in pts.items():
    j = MIRROR[i]; q = pts.get(j)
    if q is None: sym[i] = p; continue
    qm = np.array([2 * bx - q[0], q[1], q[2]]); asym.append(float(np.linalg.norm(p - qm)))
    sym[i] = (p + qm) / 2
for i in (8, 27, 28, 29, 30, 33, 51, 57, 62, 66):
    if i in sym: sym[i][0] = bx
print('FIG face points %d of 68 cast; left-right asymmetry median %.1f mm, max %.1f mm' % (len(sym), 1000 * np.median(asym), 1000 * max(asym)))
bad = [i for i, p in pts.items() if MIRROR[i] in pts and np.linalg.norm(p - np.array([2 * bx - pts[MIRROR[i]][0], pts[MIRROR[i]][1], pts[MIRROR[i]][2]])) > 0.01]
print('FIG points over 1 cm from their mirror partner:', bad)
print('FIG points z: chin %.3f, mouth corners %.3f, nose base %.3f, ears %.3f' % (sym[8][2], (sym[48][2] + sym[54][2]) / 2, sym[33][2], (sym[0][2] + sym[16][2]) / 2))
# a point that did not land on the mesh in any view: its mirror partner's reflection, else the mean of its two neighbours in
# the jaw contour or brow (the second Index build lost point 6, under the hood's shadow)
for i in range(68):
    if i in sym: continue
    j = MIRROR[i]
    if j in sym: sym[i] = np.array([2 * bx - sym[j][0], sym[j][1], sym[j][2]]); continue
    if 0 < i < 16 and (i - 1) in sym and (i + 1) in sym: sym[i] = (sym[i - 1] + sym[i + 1]) / 2
print('FIG face points filled in: %s' % [i for i in range(68) if i not in pts and i in sym])
need = [0, 8, 16, 48, 54]
if any(i not in sym for i in need): raise SystemExit('FIG missing face points %s' % [i for i in need if i not in sym])
P = {i: Vector(p) for i, p in sym.items()}
geo_chin_z = F['chin_underside_z']
print('FIG chin (point 8) z %.3f; the jaw rule\'s chin underside %.3f' % (P[8].z, geo_chin_z))

# ---- the head's pivot at the skull base; the jaw bone -----------------------------------------------------------
ears = (P[0] + P[16]) / 2
cx, cy = F['neck_axis']
# the skull base: on the neck's axis, --pivot-at of the way from the chin (point 8) up to the nose's base (point 33)
PIVOT_AT = float(flags.get('pivot-at', 0.5))   # 0.5 measured best on Misaka (nod stretch 55 edges at 0.5, 102 at 1.0)
pivot = Vector((bx, cy, P[8].z + PIVOT_AT * (P[33].z - P[8].z)))
old_pivot = arm.bones['head'].head_local.copy()
bpy.context.view_layer.objects.active = rig
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
eb = arm.edit_bones
eb['head'].head = pivot; eb['neck'].tail = pivot
# the jaw's hinge: at the jaw contour ends' height, but at the ears' depth, just in front of the ear canal (a front view
# puts points 0 and 16 on the cheek's edge, not at the ear): 1 cm ahead of the neck's axis
hinge = Vector((bx, cy - 0.010, ears.z - 0.010))
if JAW:
    jb = eb.get('jaw') or eb.new('jaw'); jb.head = hinge; jb.tail = P[8]; jb.parent = eb['head']; jb.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
print('FIG head pivot moved from z %.3f to %.3f (%.1f cm up), at the neck axis; neck bone now %.1f cm' % (old_pivot.z, pivot.z, 100 * (pivot.z - old_pivot.z), 100 * arm.bones['neck'].length))
if JAW:
    arm.vrm_addon_extension.vrm1.humanoid.human_bones.jaw.node.bone_name = 'jaw'
    # the jaw region on the Head mesh
    V = np.array([(head.matrix_world @ v.co)[:] for v in head.data.vertices])
    contour = np.array([[sym[i][0], sym[i][2]] for i in range(17)])
    def inside(x, z):   # point-in-polygon on the front plane: the jaw contour closed across the top (ear to ear)
        poly = contour; n = len(poly); ins = np.zeros(len(x), bool); j = n - 1
        for k in range(n):
            xi, zi = poly[k]; xj, zj = poly[j]
            cross = ((zi > z) != (zj > z)) & (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi)
            ins ^= cross; j = k
        return ins
    # shrink the outline 4 mm: a point counts only if it stays inside when moved 4 mm outward, away from the face's middle
    outward = np.sign(V[:, 0] - bx) * 0.004
    inner = inside(V[:, 0], V[:, 2]) & inside(V[:, 0] + outward, V[:, 2])
    # the line from each mouth corner to its side's hinge, as a height over (side, depth); points below it are the jaw's
    def line_z(xs, ys):
        out = np.empty(len(xs))
        for k, (x, y) in enumerate(zip(xs, ys)):
            c = P[48] if (x - bx) * (P[48].x - bx) > 0 else P[54]
            e = P[0] if (x - bx) * (P[0].x - bx) > 0 else P[16]
            h = Vector((e.x, hinge.y, hinge.z))
            t = np.clip((y - c.y) / (h.y - c.y + 1e-9), 0, 1)
            out[k] = c.z + t * (h.z - c.z)
        return out
    below = line_z(V[:, 0], V[:, 1]) - V[:, 2]
    ahead = (hinge.y - V[:, 1])           # the face is at -y: positive in front of the hinge
    w = smooth(below / 0.012) * smooth(ahead / 0.012) * inner
    names = {g.index: g.name for g in head.vertex_groups}
    gj = head.vertex_groups.get('jaw') or head.vertex_groups.new(name='jaw'); gh = head.vertex_groups['head']
    n = 0
    for i, v in enumerate(head.data.vertices):
        if w[i] <= 0.01: continue
        hw = next((g.weight for g in v.groups if names[g.group] == 'head'), 0.0)
        if hw <= 0: continue
        gj.add([i], float(hw * w[i]), 'REPLACE'); gh.add([i], float(hw * (1 - w[i])), 'REPLACE'); n += 1
    print('FIG jaw region %d points (%d fully the jaw\'s); inside the outline %d, below the mouth lines %d, ahead of the hinge %d, all three %d' % (n, int((w > 0.99).sum()), int(inner.sum()), int((below > 0).sum()), int((ahead > 0).sum()), int((inner & (below > 0) & (ahead > 0)).sum())))
face = dict(F); face['marks'] = {str(i): [round(float(c), 4) for c in p] for i, p in sym.items()}
face['pivot'] = list(pivot); face['hinge'] = list(hinge); face['asymmetry_mm'] = round(1000 * max(asym), 1)
rig['figure_face'] = json.dumps(face)
json.dump(face, open(os.path.join(os.path.dirname(OUT), 'face_marks3d.json'), 'w'), indent=1)
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT), exist_ok=True)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
