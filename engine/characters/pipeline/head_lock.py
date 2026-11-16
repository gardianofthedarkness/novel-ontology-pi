"""Lock the skull: the head bone owns the head, the neck bone only the neck; the blend between them solved, not set.
usage: blender -b <layers.blend> -P head_lock.py -- <out.blend> --marks-bust=<marks/bust.json>
  On a merged figure (the armature carries neck_tube) the neck's cross-section is the merge's own tube at the Head's rim.
  The neck: its cross-section is the hairless base body (LayerBody) sliced at the neck seam (the narrowest section the
  rig step measured), one of its own median edges thick, only the points its rig weights mostly to the neck or head (the
  T-pose's arms lie at that height); an ellipse from the slice's spread (for points on an ellipse the variance along an
  axis is half the semi-axis squared). Written for check_head.py and face_rig.py.
  The head's share on the Head mesh: harmonic weights (harmonic.py, the cotangent Laplacian) between the points the head
  surely owns (everything above the chin's height, and the face inside its outline: the face detector's 68 points on the
  bust, carried onto the figure by the bust's placement, rig['bust_map']) and the points the neck surely owns (the Head
  mesh's cut rim under the chin, where it meets the body). No band, fade, plane, tilt or search: the smoothest field
  between the two.
  Clothes and the base body keep the rig step's weights. Writes figure_face and face.json; exports VRM."""
import bpy, json, math, os, sys
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
OUT = [a for a in argv if not a.startswith('--')][0]
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; B = rig.data.bones
head_z, neck_z = B['head'].head_local.z, B['neck'].head_local.z
seam_z = float(rig['neck_seam_z'])
FRONT = -1.0                                            # STRUCTURAL: VRM in Blender faces -Y

def co(ob): return np.array([(ob.matrix_world @ v.co)[:] for v in ob.data.vertices])
def med_edge(ob):
    P = np.array([v.co[:] for v in ob.data.vertices]); E = np.array([e.vertices[:] for e in ob.data.edges])
    return float(np.median(np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)))
def smooth(t): t = np.clip(t, 0.0, 1.0); return t * t * (3 - 2 * t)

head = bpy.data.objects['Head']; layer = bpy.data.objects['LayerBody']
H = co(head); He = np.array([e.vertices[:] for e in head.data.edges]); L0 = np.linalg.norm(H[He[:, 0]] - H[He[:, 1]], axis=1)
ok_e = L0 > 0.5 * np.median(L0)                         # as check_head.py measures (slivers' ratios say little)
edge = med_edge(layer)
# ---- the neck's cross-section -----------------------------------------------------------------------------------
ref = co(layer); lnames = {g.index: g.name for g in layer.vertex_groups}
ldom = np.array([lnames[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in layer.data.vertices])
# the slice's points the base body's own rig weights mostly to the neck or head (in a T-pose the arms and shoulder tops
# lie at the neck's height; their points belong to the arm and shoulder bones)
ring = ref[(np.abs(ref[:, 2] - seam_z) < edge / 2) & np.isin(ldom, ('neck', 'head'))]
cx, cy = float(ring[:, 0].mean()), float(ring[:, 1].mean())
rx, ry = float(np.sqrt(2 * ring[:, 0].var())), float(np.sqrt(2 * ring[:, 1].var())); r = ry
def rad(P): return np.hypot((P[:, 0] - cx) / rx, (P[:, 1] - cy) / ry)   # 1 on the neck's surface
y_front = cy + FRONT * ry
print('FIG neck at the seam z %.3f: centre (%.3f, %.3f), half-width %.1f mm, half-depth %.1f mm (%d slice points)' % (seam_z, cx, cy, rx * 1000, ry * 1000, len(ring)))
# ---- the head's share: harmonic between where the head surely owns the skin and where the neck does ---------------
# the face detector's points (RTMW's 68 on the bust, carried by the placement): the head surely owns everything above the
# chin's height (front and back: the skull's base lies about level with it) and the face inside its outline; the neck surely owns the Head
# mesh's cut rim under the chin (where it meets the body at the seam). Between them the smoothest field (harmonic, the
# cotangent Laplacian): no band, fade, plane or tilt to choose
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from harmonic import harmonic
bm = json.load(open(flags['marks-bust']))['points']; Mb = np.array(json.loads(rig['bust_map'])['M'])
def mark(j): return (np.array(bm[str(j)]['p'] + [1.0]) @ Mb.T)[:3]
F68 = {i: mark(23 + i) for i in range(68) if str(23 + i) in bm}
chin = F68[8]; z_chin = float(chin[2]); z_eyes = float(np.mean([F68[i][2] for i in (36, 39, 42, 45) if i in F68]))
contour = np.array([[F68[i][0], F68[i][2]] for i in range(17) if i in F68])
def inside(x, z):
    poly = contour; n = len(poly); ins = np.zeros(len(x), bool); j = n - 1
    for k in range(n):
        xi, zi = poly[k]; xj, zj = poly[j]
        ins ^= ((zi > z) != (zj > z)) & (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi); j = k
    return ins
me = head.data; me.calc_loop_triangles()
T = np.array([t.vertices[:] for t in me.loop_triangles])
edge_faces = {}
for poly in me.polygons:
    for ek in poly.edge_keys: edge_faces[ek] = edge_faces.get(ek, 0) + 1
rim = np.zeros(len(H), bool)
for (a, b), c in edge_faces.items():
    if c == 1: rim[a] = rim[b] = True                     # an edge with one face: the mesh's open border (the cut)
face_front = inside(H[:, 0], H[:, 2]) & ((H[:, 1] - cy) * FRONT > 0) & (H[:, 2] >= z_chin)
head_sure = (H[:, 2] > z_chin) | face_front             # the skull, front and back, down to the chin's height
neck_sure = rim & (H[:, 2] < z_chin) & ~head_sure
if 'neck_tube' in rig:
    # a merged figure (rawmerge): its neck is the merge's own tube, whose section at every level layer_raw.py carried here;
    # the neck's cross-section is the tube's at the height where the Head meets the body (the Head's cut rim under the chin)
    NT = np.array(json.loads(rig['neck_tube'])); z_rim = float(np.median(H[neck_sure][:, 2])); k = int(np.argmin(np.abs(NT[:, 0] - z_rim)))
    _, cx, cy, rx, ry = (float(x) for x in NT[k]); r = ry; y_front = cy + FRONT * ry
    print('FIG neck from the merge tube at the Head rim (z %.3f): centre (%.3f, %.3f), half-width %.1f mm, half-depth %.1f mm' % (z_rim, cx, cy, rx * 1000, ry * 1000))
idx = np.concatenate([np.nonzero(head_sure)[0], np.nonzero(neck_sure)[0]])
val = np.concatenate([np.ones(head_sure.sum()), np.zeros(neck_sure.sum())])
hs = harmonic(H, T, idx, val)
print('FIG head share: harmonic from %d points surely the head (above the chin, or the face inside its outline; eyes at z %.3f) and %d surely the neck (the cut rim under the chin at z %.3f)'
      % (head_sure.sum(), z_eyes, neck_sure.sum(), z_chin))

# ---- write the Head's weights -----------------------------------------------------------------------------------
for n in ('head', 'neck'):
    if n not in head.vertex_groups: head.vertex_groups.new(name=n)
names = {g.index: g.name for g in head.vertex_groups}; groups = {g.name: g for g in head.vertex_groups}
for i, v in enumerate(head.data.vertices):
    for gi in [g.group for g in v.groups]: groups[names[gi]].remove([i])
    if hs[i] > 0: groups['head'].add([i], float(hs[i]), 'REPLACE')
    if hs[i] < 1: groups['neck'].add([i], float(1 - hs[i]), 'REPLACE')
for o in bpy.data.objects: o.select_set(False)
head.select_set(True); bpy.context.view_layer.objects.active = head
with bpy.context.temp_override(active_object=head, object=head, selected_editable_objects=[head]):
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
face = {'neck_axis': [cx, cy], 'neck_radius': r, 'neck_half': [rx, ry], 'column': 1.0, 'chin_underside_z': z_chin,
        'neck_front_y': y_front, 'tilt': 0.0, 'eyes_z': z_eyes, 'front': FRONT, 'pivot_z': head_z}
rig['figure_face'] = json.dumps(face)
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT), exist_ok=True)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
open(os.path.join(os.path.dirname(OUT), 'face.json'), 'w').write(json.dumps(face, indent=1))
