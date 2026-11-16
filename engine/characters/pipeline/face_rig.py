"""The face's bones: the face detector's points on the head, the head's pivot, and a VRM jaw bone; every place and width
measured or chosen by a search, none set.
usage: blender -b <lock.blend> -P face_rig.py -- <marks/bust.json> <out.blend> [--no-jaw]
  Points: RTMW's 68 face points on the bust, triangulated from seven angles (marks/landmarks.py), carried onto the figure
  by the bust's placement (rig['bust_map']) and laid on the Head's surface (its nearest point). Made symmetric about the
  face's own middle (the median of the mirror pairs' midpoints and the middle points), each point averaged with its
  partner's reflection.
  Pivot: on the neck's axis, between the chin (point 8) and the nose's base (point 33); where between is chosen by a
  golden-section search that minimises the Head's stretch in a nod, a look up and a turn (mean squared edge stretch,
  edges under half the median ignored, as check_head.py measures).
  Jaw: a bone from the hinge to the chin, child of the head, the VRM humanoid jaw. The hinge is where the jaw turns, at the
  ears: the detector's two ear points (RTMW body points 3 and 4, triangulated the same way), on the face's middle. Its
  region: inside the face outline (the jaw contour) by one of the Head's median edges, below the line from each mouth
  corner (48, 54) to the hinge, in front of the hinge; blended over a width chosen by a golden-section search between
  one median edge and the chin-to-mouth distance, minimising the stretch of the jaw opening.
  Writes the points (figure_face.marks), the pivot and the hinge; face_marks3d.json; exports VRM."""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in argv if a.startswith('--'))
MARKS, OUT = [a for a in argv if not a.startswith('--')][:2]
JAW = 'no-jaw' not in flags
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; arm = rig.data; head = bpy.data.objects['Head']
F = json.loads(rig['figure_face']); Mb = np.array(json.loads(rig['bust_map'])['M'])
bm = json.load(open(MARKS))['points']
PHI = (math.sqrt(5) - 1) / 2; TOL = np.finfo(float).eps ** 0.5; CAP = 60          # NUMERIC
POSES = {'nod': {'neck': (25, 0, 0), 'head': (20, 0, 0)}, 'look_up': {'neck': (-20, 0, 0), 'head': (-25, 0, 0)},
         'turn': {'neck': (0, 35, 0), 'head': (0, 30, 0)}}                         # STRUCTURAL: check_head.py's poses
def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
def golden(f, lo, hi):
    a, b = lo, hi; c = b - PHI * (b - a); d = a + PHI * (b - a); fc, fd = f(c), f(d)
    for _ in range(CAP):
        if abs(b - a) < TOL * (abs(a) + abs(b)): break
        if fc < fd: b, d, fd = d, c, fc; c = b - PHI * (b - a); fc = f(c)
        else: a, c, fc = c, d, fd; d = a + PHI * (b - a); fd = f(d)
    return (a + b) / 2

# ---- the points, on the Head's surface ------------------------------------------------------------------------
dg = bpy.context.evaluated_depsgraph_get(); bvh = BVHTree.FromObject(head, dg)
def carried(j): return (np.array(bm[str(j)]['p'] + [1.0]) @ Mb.T)[:3]
pts = {}
for i in range(68):
    if str(23 + i) in bm:
        loc = bvh.find_nearest(Vector(carried(23 + i)))[0]
        if loc is not None: pts[i] = np.array(loc)
MIRROR = {**{i: 16 - i for i in range(17)}, **{17 + i: 26 - i for i in range(10)}, 27: 27, 28: 28, 29: 29, 30: 30,
          31: 35, 32: 34, 33: 33, 34: 32, 35: 31, 36: 45, 37: 44, 38: 43, 39: 42, 40: 47, 41: 46, 42: 39, 43: 38, 44: 37,
          45: 36, 46: 41, 47: 40, 48: 54, 49: 53, 50: 52, 51: 51, 52: 50, 53: 49, 54: 48, 55: 59, 56: 58, 57: 57, 58: 56,
          59: 55, 60: 64, 61: 63, 62: 62, 63: 61, 64: 60, 65: 67, 66: 66, 67: 65}           # STRUCTURAL: the 68-point layout
MIDDLE = [i for i in range(68) if MIRROR[i] == i]
bone_x = arm.bones['head'].head_local.x
mids = [(pts[i][0] + pts[MIRROR[i]][0]) / 2 for i in pts if MIRROR[i] in pts and MIRROR[i] != i] + [pts[i][0] for i in MIDDLE if i in pts]
bx = float(np.median(mids))
print('FIG face points %d of 68 on the Head; face middle x %.4f, the head bone at x %.4f (%.1f mm apart)' % (len(pts), bx, bone_x, 1000 * (bx - bone_x)))
sym = {}; asym = []
for i, p in pts.items():
    q = pts.get(MIRROR[i])
    if q is None: sym[i] = p; continue
    qm = np.array([2 * bx - q[0], q[1], q[2]]); asym.append(float(np.linalg.norm(p - qm))); sym[i] = (p + qm) / 2
for i in MIDDLE:
    if i in sym: sym[i][0] = bx
for i in range(68):                                     # a point no view saw: its partner's reflection
    if i not in sym and MIRROR[i] in sym: q = sym[MIRROR[i]]; sym[i] = np.array([2 * bx - q[0], q[1], q[2]])
need = [0, 8, 16, 33, 48, 54]
if any(i not in sym for i in need): raise SystemExit('FIG missing face points %s' % [i for i in need if i not in sym])
print('FIG left-right asymmetry median %.1f mm, max %.1f mm' % (1000 * np.median(asym), 1000 * max(asym)))
P = {i: Vector(p) for i, p in sym.items()}
cx, cy = F['neck_axis']

# ---- the head's pivot, chosen by the stretch it causes ----------------------------------------------------------
H = np.array([(head.matrix_world @ v.co)[:] for v in head.data.vertices]); Hh = np.concatenate([H, np.ones((len(H), 1))], 1)
He = np.array([e.vertices[:] for e in head.data.edges]); L0 = np.linalg.norm(H[He[:, 0]] - H[He[:, 1]], axis=1)
ok_e = L0 > 0.5 * np.median(L0); edge = float(np.median(L0))
gnames = {g.index: g.name for g in head.vertex_groups}
def weights(name):
    w = np.zeros(len(H))
    for i, v in enumerate(head.data.vertices):
        for g in v.groups:
            if gnames[g.group] == name: w[i] = g.weight
    return w
WH, WN = weights('head'), weights('neck')
def select_rig():
    for o in bpy.data.objects: o.select_set(False)
    rig.select_set(True); bpy.context.view_layer.objects.active = rig
def set_pivot(p):
    select_rig(); bpy.ops.object.mode_set(mode='EDIT'); eb = arm.edit_bones; eb['head'].head = p; eb['neck'].tail = p
    bpy.ops.object.mode_set(mode='OBJECT')
def mats(rots, names):
    for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0)
    for bn, (x, y, z) in rots.items(): rig.pose.bones[bn].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    bpy.context.view_layer.update()
    out = {n: np.array(rig.matrix_world @ rig.pose.bones[n].matrix @ arm.bones[n].matrix_local.inverted() @ rig.matrix_world.inverted()) for n in names}
    for pb in rig.pose.bones: pb.rotation_euler = (0, 0, 0)
    return out
def stretch_of(Ps):
    e = 0.0
    for Pp in Ps:
        Lp = np.linalg.norm(Pp[He[:, 0]] - Pp[He[:, 1]], axis=1); e += float(((Lp[ok_e] / L0[ok_e] - 1) ** 2).mean())
    return e / len(Ps)
def pivot_at(t): return Vector((bone_x, cy, P[8].z + t * (P[33].z - P[8].z)))
def pivot_stretch(t):
    set_pivot(pivot_at(t)); Ps = []
    for rots in POSES.values():
        m = mats(rots, ('head', 'neck')); tot = np.maximum(WH + WN, TOL)
        Ps.append(((WH / tot)[:, None] * (Hh @ m['head'].T) + (WN / tot)[:, None] * (Hh @ m['neck'].T))[:, :3])
    return stretch_of(Ps)
old_pivot = arm.bones['head'].head_local.copy()
t_best = golden(pivot_stretch, 0.0, 1.0); pivot = pivot_at(t_best); set_pivot(pivot)
print('FIG head pivot at %.2f of the way from the chin to the nose base (chosen by the stretch search): z %.3f -> %.3f' % (t_best, old_pivot.z, pivot.z))

# ---- the jaw -----------------------------------------------------------------------------------------------------
if JAW:
    # the hinge's height: the jaw contour's top ends (68-point layout 0 and 16, where the jaw line meets the ear); its depth:
    # the neck's measured axis (the detector's ear points land on the hair that covers anime ears, too far forward)
    hinge = Vector((bx, cy, (P[0].z + P[16].z) / 2))
    select_rig(); bpy.ops.object.mode_set(mode='EDIT'); eb = arm.edit_bones
    jb = eb.get('jaw') or eb.new('jaw'); jb.head = hinge; jb.tail = P[8]; jb.parent = eb['head']; jb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.vrm_addon_extension.vrm1.humanoid.human_bones.jaw.node.bone_name = 'jaw'
    contour = np.array([[sym[i][0], sym[i][2]] for i in range(17)])
    def inside(x, z):
        poly = contour; n = len(poly); ins = np.zeros(len(x), bool); j = n - 1
        for k in range(n):
            xi, zi = poly[k]; xj, zj = poly[j]
            ins ^= ((zi > z) != (zj > z)) & (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi); j = k
        return ins
    # the jaw's share: harmonic (harmonic.py) between the skin the jaw surely owns (the face inside its outline below the
    # lower lip, point 57) and the skin it surely does not (above the upper lip, point 51; outside the face's outline; behind
    # the hinge). No blend width to choose
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from harmonic import harmonic
    me = head.data; me.calc_loop_triangles(); T = np.array([t.vertices[:] for t in me.loop_triangles])
    infront = (H[:, 1] - hinge.y) * -1 > 0                  # the face is at -y: in front of the hinge
    inner = inside(H[:, 0], H[:, 2]) & infront
    jaw_sure = inner & (H[:, 2] < P[57].z)
    not_jaw = (H[:, 2] > P[51].z) | ~inside(H[:, 0], H[:, 2]) | ~infront
    # the Head's cut rim is shared with the body at the seam: it follows the body, never the jaw
    ef = {}
    for poly in me.polygons:
        for ek in poly.edge_keys: ef[ek] = ef.get(ek, 0) + 1
    rim = np.zeros(len(H), bool)
    for (a_, b_), c_ in ef.items():
        if c_ == 1: rim[a_] = rim[b_] = True
    jaw_sure &= ~rim; not_jaw |= rim
    not_jaw &= ~jaw_sure
    idx = np.concatenate([np.nonzero(jaw_sure)[0], np.nonzero(not_jaw)[0]]); val = np.concatenate([np.ones(jaw_sure.sum()), np.zeros(not_jaw.sum())])
    w = harmonic(H, T, idx, val)
    gj = head.vertex_groups.get('jaw') or head.vertex_groups.new(name='jaw'); gh = head.vertex_groups['head']; n = 0
    for i in range(len(H)):
        if w[i] <= 0 or WH[i] <= 0: continue
        gj.add([i], float(WH[i] * w[i]), 'REPLACE'); gh.add([i], float(WH[i] * (1 - w[i])), 'REPLACE'); n += 1
    print('FIG jaw: hinge (y %.3f, z %.3f); %d points surely the jaw, %d surely not; %d points weighted' % (hinge.y, hinge.z, jaw_sure.sum(), not_jaw.sum(), n))
face = dict(F); face['marks'] = {str(i): [round(float(c), 4) for c in p] for i, p in sym.items()}
face['pivot'] = list(pivot); face['hinge'] = list(hinge) if JAW else None; face['asymmetry_mm'] = round(1000 * max(asym), 1)
rig['figure_face'] = json.dumps(face)
json.dump(face, open(os.path.join(os.path.dirname(OUT), 'face_marks3d.json'), 'w'), indent=1)
select_rig()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
