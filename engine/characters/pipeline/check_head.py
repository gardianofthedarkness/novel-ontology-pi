"""The head's checks (v0.7): weights by region, and motion in test poses measured in the head bone's own frame.
usage: blender -b <figure.blend> -P check_head.py [-- --json=<out.json>]
  Regions from the jaw rule head_lock.py wrote (figure_face): the skull (above the jaw plane or outside the neck column), the
  neck column, the seam (Head points within 1 cm of an outfit point). Poses: nod, turn, tilt, arms overhead, chest bend,
  jaw open (when there is a jaw bone). Reports: non-head weight on the skull; how far skull points move in the head's frame
  (should be 0 except the jaw); the jaw region's drop when the jaw opens; how far the seam opens (Head point to its outfit
  neighbour, change from rest); the worst triangle stretch near the neck."""
import bpy, json, math, sys
import numpy as np
from mathutils import Matrix
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
rig = bpy.data.objects['Armature']; B = rig.data.bones
F = json.load(open(flags['face'])) if flags.get('face') else json.loads(rig['figure_face']) if 'figure_face' in rig else None
head = bpy.data.objects['Head']; outfits = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Outfit_')]
def rest(ob): return np.array([(ob.matrix_world @ v.co)[:] for v in ob.data.vertices])
def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
H = rest(head)
if F:
    cx, cy = F['neck_axis']; r = F['neck_radius']
    back = np.clip((H[:, 1] - F['neck_front_y']) * -F['front'] / (2 * r), 0, 1)
    zp = F['chin_underside_z'] + F['tilt'] * back
    rx, ry = F.get('neck_half', [r, r])
    incol = np.hypot((H[:, 0] - cx) / rx, (H[:, 1] - cy) / ry) < F['column'] + 0.3
    skull = ~incol | (H[:, 2] > zp)
else:
    skull = H[:, 2] > B['head'].head_local.z + 0.06
jaw_ids = set()
if 'jaw' in head.vertex_groups:
    gi = head.vertex_groups['jaw'].index
    jaw_ids = {v.index for v in head.data.vertices for g in v.groups if g.group == gi and g.weight > 0.01}
hair_groups = {g.index for g in head.vertex_groups if g.name.startswith('hair')}
hair_ids = {v.index for v in head.data.vertices for g in v.groups if g.group in hair_groups and g.weight > 0.01}
rigid = np.array([skull[i] and i not in jaw_ids and i not in hair_ids for i in range(len(H))])
names = {g.index: g.name for g in head.vertex_groups}
nonhead = sum(1 for i, v in enumerate(head.data.vertices) if rigid[i] and any(names[g.group] != 'head' and g.weight > 0.01 for g in v.groups))
out = {'skull_points': int(rigid.sum()), 'skull_nonhead_weight': nonhead, 'jaw_points': len(jaw_ids), 'hair_points': len(hair_ids)}
# the seam: Head points with an outfit point within 1 cm at rest
seam = {}
for o in outfits:
    O = rest(o); low = np.where(H[:, 2] < (F['chin_underside_z'] if F else B['head'].head_local.z + 0.02))[0]
    low = [i for i in low if i not in hair_ids]    # hair resting on the collar moves with the head, as it should
    pairs = []
    for i in low:
        d = np.linalg.norm(O - H[i], axis=1); j = int(d.argmin())
        if d[j] < 0.01: pairs.append((int(i), j))
    seam[o.name] = (O, pairs)
edges = np.array([e.vertices[:] for e in head.data.edges]); L0 = np.linalg.norm(H[edges[:, 0]] - H[edges[:, 1]], axis=1)
# the body: every other mesh's edges (the outfits and the hidden base body), to catch a head fix that hurts the body
bodies = {o.name: (rest(o), np.array([e.vertices[:] for e in o.data.edges])) for o in bpy.data.objects if o.type == 'MESH' and o.name != 'Head'}
for n, (R0, E) in list(bodies.items()): bodies[n] = (R0, E, np.linalg.norm(R0[E[:, 0]] - R0[E[:, 1]], axis=1))
POSES = {
    'nod': {'neck': (25, 0, 0), 'head': (20, 0, 0)}, 'look_up': {'neck': (-20, 0, 0), 'head': (-25, 0, 0)},
    'turn': {'neck': (0, 35, 0), 'head': (0, 30, 0)}, 'tilt': {'neck': (0, 0, 20), 'head': (0, 0, 15)},
    'arms_overhead': {'shoulder.L': (0, 0, 20), 'shoulder.R': (0, 0, -20), 'upper_arm.L': (0, 0, 75), 'upper_arm.R': (0, 0, -75)},
    'arms_forward': {'upper_arm.L': (80, 0, 0), 'upper_arm.R': (80, 0, 0)},
    'arms_down': {'shoulder.L': (0, 0, -10), 'shoulder.R': (0, 0, 10), 'upper_arm.L': (0, 0, -70), 'upper_arm.R': (0, 0, 70)},
    'chest_bend': {'spine': (20, 0, 0), 'chest': (20, 0, 0)},
}
if 'jaw' in B: POSES['jaw_open'] = {'jaw': (15, 0, 0)}
dg = bpy.context.evaluated_depsgraph_get()
def posed(ob):
    e = ob.evaluated_get(dg); m = e.to_mesh(); P = np.array([(ob.matrix_world @ v.co)[:] for v in m.vertices]); e.to_mesh_clear(); return P
hb = rig.pose.bones['head']; Mrest = rig.matrix_world @ B['head'].matrix_local
for name, rots in POSES.items():
    for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0)
    for bn, (x, y, z) in rots.items():
        if bn in rig.pose.bones: rig.pose.bones[bn].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    Mpose = rig.matrix_world @ hb.matrix
    T = np.array(Mrest @ Mpose.inverted())     # posed world -> rest world, through the head's frame
    P = posed(head); Q = P @ T[:3, :3].T + T[:3, 3]
    drift = np.linalg.norm(Q - H, axis=1)
    row = {'skull_drift_mm': round(float(drift[rigid].max()) * 1000, 3) if rigid.any() else None}
    if jaw_ids: row['jaw_drop_mm'] = round(float(drift[list(jaw_ids)].max()) * 1000, 1)
    if hair_ids: row['hair_move_mm'] = round(float(drift[list(hair_ids)].max()) * 1000, 1)
    gap = 0.0
    for o in outfits:
        O0, pairs = seam[o.name]
        if not pairs: continue
        Po = posed(o)
        for i, j in pairs:
            g = abs(np.linalg.norm(Po[j] - P[i]) - np.linalg.norm(O0[j] - H[i]))
            if g > gap: gap, where = g, H[i]
    row['seam_open_mm'] = round(gap * 1000, 2)
    if gap > 0.005: row['seam_worst_at'] = [round(float(c), 3) for c in where]
    # stretch over edges at least half the median length (decimation leaves slivers whose ratio says little)
    L = np.linalg.norm(P[edges[:, 0]] - P[edges[:, 1]], axis=1); ok = L0 > 0.5 * np.median(L0); ratio = L / np.maximum(L0, 1e-6)
    row['head_edge_max_ratio'] = round(float(ratio[ok].max()), 3); row['head_edges_over_1.25'] = int((ratio[ok] > 1.25).sum())
    over = 0; worst = 1.0
    for n, (R0, E, B0) in bodies.items():
        Pb = posed(bpy.data.objects[n]); Lb = np.linalg.norm(Pb[E[:, 0]] - Pb[E[:, 1]], axis=1); okb = B0 > 0.5 * np.median(B0); rb = Lb / np.maximum(B0, 1e-6)
        over += int((rb[okb] > 1.25).sum()); worst = max(worst, float(rb[okb].max()))
    row['body_edges_over_1.25'] = over; row['body_edge_max_ratio'] = round(worst, 2)
    out[name] = row
for pb in rig.pose.bones: pb.rotation_euler = (0, 0, 0)
print('FIGCHECK ' + json.dumps(out))
if flags.get('json'): open(flags['json'], 'w').write(json.dumps(out, indent=1))
