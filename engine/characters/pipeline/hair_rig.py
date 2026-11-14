"""Hair that moves like hair (v0.7 step 6): find the hair on the fused head, hang a few spring chains from the scalp line,
weight the free hair to them, cut it from the face, and run them as VRM 1.0 spring bones with colliders.
usage: blender -b <figure.blend> -P hair_rig.py -- <portrait-view-dir> <render-dir> <out.blend>
        [--hair=<labels>] [--bangs=3] [--ring=8] [--link=0.045] [--cut=0.3]
  Finding the hair: the portrait's 68 face points (marks.json) are fitted onto the head's (figure_face.marks, face_rig.py)
  by a similarity on the front plane, and the portrait's colour labels (prep_view's labels.npy; --hair the hair labels)
  are read for every head point seen from the front. The hair's labels (unless --hair gives them) are the colours common
  above the brows and beside the cheeks of the portrait but rare on its face, found from the portrait's own face points. A point hidden from the front is hair when it is above the brows,
  behind the ears or outside the face's outline; else skin (a cheek under a side lock). The neck column (head_lock.py's
  rule) is never hair. Two rounds of neighbour majority clean the edges.
  The scalp line: hair above it stays on the skull (the head bone). At the front (bangs) it is 2.5 cm above the brows; at
  the sides and back the ears' height; blended between 40 and 60 degrees from the front.
  Chains: --bangs chains across the forehead and --ring chains around the sides and back, each one bone per --link metres
  (2 to 6) from the
  scalp line down to the lowest hair in its sector, through the middle of the hair at each height.
  Weights: a free hair point goes to the two chains nearest by angle (shared by angle), on the link at its height, and
  to the head near the scalp (a 2 cm ramp: the scalp line is 100% head, so the hair cannot tear there). At most 3 bones.
  Contact: where hair touches skin (a side lock fused onto the cheek) it stays with the skull and eases into its chain over
  --contact metres along the mesh, so nothing tears and nothing is cut (the fused surface has nothing behind it).
  --cut=<share> instead deletes triangles joining free hair to skin (left off: it opened holes under the jaw).
  Springs: one per chain, inertia in world space (--center to measure it from a bone instead); colliders: a sphere inside the skull, a sphere inside the face (bangs stay out
  of the eyes), a capsule on the neck, capsules on the shoulders, a sphere on the upper chest."""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in argv if a.startswith('--'))
PVIEW, RDIR, OUT = [a for a in argv if not a.startswith('--')][:3]
HAIR = [int(x) for x in flags['hair'].split(',')] if flags.get('hair') else None   # the hair's colour labels (else found)
NB, NR, CUT = int(flags.get('bangs', 3)), int(flags.get('ring', 8)), float(flags.get('cut', 0))
LINK = float(flags.get('link', 0.045))       # about one link per this many metres of hair, 2 to 6 links a chain
CONTACT = float(flags.get('contact', 0.02))  # hair touching skin eases into its chain over this distance
# the springs (tuned in the viewer against v0.6's rigid hair, peak-to-peak tip travel: walk 17 mm, run 68, head shake 105,
# rest droop 7): inertia in world space (--center=none; the hips as centre cancelled the body's own bounce, so walking
# barely moved the hair), softer than the first build (1.0 / 1.6 bangs, drag 0.4)
STIFF, BANG_STIFF = float(flags.get('stiffness', 0.8)), float(flags.get('bang-stiffness', 1.3))
DRAG, GRAV, CENTER = float(flags.get('drag', 0.35)), float(flags.get('gravity', 0.05)), flags.get('center', 'none')
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; arm = rig.data; head = bpy.data.objects['Head']
F = json.loads(rig['figure_face']); M = {int(k): np.array(v) for k, v in F['marks'].items()}
def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
V = np.array([(head.matrix_world @ v.co)[:] for v in head.data.vertices]); NV = len(V)
bx = arm.bones['head'].head_local.x

# ---- 1. the portrait's labels on the head's front --------------------------------------------------------------------
marks = json.load(open(os.path.join(RDIR, 'marks.json')))
pp = np.array([p[:2] for p in marks['portrait']['points']]); mp = np.array([[M[i][0], M[i][2]] for i in range(68)])
src = np.stack([pp[:, 0], -pp[:, 1]], 1)        # image y runs down, z up
mu_s, mu_d = src.mean(0), mp.mean(0); S, D = src - mu_s, mp - mu_d
U, sig, Vt = np.linalg.svd(D.T @ S); Rm = U @ Vt
scale = sig.sum() / (S ** 2).sum(); t = mu_d - scale * Rm @ mu_s
fit = np.linalg.norm((scale * (Rm @ src.T)).T + t - mp, axis=1)
print('FIG portrait fitted onto the head: %.1f mm median error, %.1f mm max' % (1000 * np.median(fit), 1000 * fit.max()))
labels = np.load(os.path.join(PVIEW, 'labels.npy')); LH, LW = labels.shape
def poly_inside(poly, x, y):
    ins = np.zeros(x.shape, bool); j = len(poly) - 1
    for k in range(len(poly)):
        xi, yi = poly[k]; xj, yj = poly[j]
        ins ^= ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi); j = k
    return ins
if HAIR is None:
    # which colours are hair, from the portrait's own face points (any character): colours common above the brows and
    # beside the cheeks but rare on the face itself
    yy, xx = np.mgrid[0:LH:2, 0:LW:2]; L2 = labels[::2, ::2]
    brow_y, chin_y = pp[17:27, 1].mean(), pp[8, 1]; eye_y = pp[36:48, 1].mean(); fh = chin_y - brow_y
    fx0, fx1 = pp[:17, 0].min(), pp[:17, 0].max(); fw = fx1 - fx0
    face = poly_inside(pp[:17], xx, yy) & (yy > brow_y + 0.15 * fh) & (yy < chin_y)
    above = (yy > brow_y - 0.9 * fh) & (yy < brow_y - 0.1 * fh) & (xx > fx0 - 0.25 * fw) & (xx < fx1 + 0.25 * fw)
    beside = (yy > eye_y) & (yy < chin_y) & (((xx < fx0 - 0.05 * fw) & (xx > fx0 - 0.3 * fw)) | ((xx > fx1 + 0.05 * fw) & (xx < fx1 + 0.3 * fw)))
    n = int(labels[labels != 255].max()) + 1
    hf = np.bincount(L2[face & (L2 != 255)], minlength=n) / max(1, (face & (L2 != 255)).sum())
    hh = np.bincount(L2[(above | beside) & (L2 != 255)], minlength=n) / max(1, ((above | beside) & (L2 != 255)).sum())
    HAIR = [l for l in range(n) if hh[l] >= 0.05 and hh[l] > 2 * hf[l]]
    pv = json.load(open(os.path.join(PVIEW, 'view.json')))
    if pv.get('hair') is not None and pv['hair'] not in HAIR and hh[pv['hair']] > hf[pv['hair']]: HAIR.append(int(pv['hair']))
    print('FIG hair colours found: %s (share above/beside the face %s, on the face %s)' % (HAIR, [round(float(hh[l]), 2) for l in HAIR], [round(float(hf[l]), 2) for l in HAIR]))
def to_px(x, z):
    q = Rm.T @ ((np.stack([x, z], 1) - t).T) / scale
    return q[0], -q[1]
dg = bpy.context.evaluated_depsgraph_get(); bvh = BVHTree.FromObject(head, dg)
seen = np.zeros(NV, bool)
for i, p in enumerate(V):
    hit = bvh.ray_cast(Vector((p[0], p[1] - 1.0, p[2])), Vector((0, 1, 0)))
    seen[i] = hit[0] is not None and (hit[0] - Vector(p)).length < 0.003
u, v = to_px(V[:, 0], V[:, 2]); ui = np.clip(np.round(u).astype(int), 0, LW - 1); vi = np.clip(np.round(v).astype(int), 0, LH - 1)
lab = labels[vi, ui]
hair = np.isin(lab, HAIR) & seen
# hidden from the front: hair unless it is a cheek under a lock (inside the outline, below the brows, ahead of the ears)
contour = np.array([[M[i][0], M[i][2]] for i in range(17)])
def inside(x, z):
    ins = np.zeros(len(x), bool); j = len(contour) - 1
    for k in range(len(contour)):
        xi, zi = contour[k]; xj, zj = contour[j]
        ins ^= ((zi > z) != (zj > z)) & (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi); j = k
    return ins
brow_z = float(np.mean([M[i][2] for i in (19, 24)])); eye_z = float(np.mean([M[i][2] for i in (37, 44)])); hinge = np.array(F['hinge'])
face_zone = inside(V[:, 0], V[:, 2]) & (V[:, 1] < hinge[1])
hidden_face = face_zone & (V[:, 2] < brow_z)
hair |= ~seen & ~hidden_face
# below the eyes and ahead of the ears, the portrait cannot tell (its side locks fall over the cheeks, and the jaw's sides
# hide behind them): look inward, toward the head's middle. A cheek or jaw has the solid head behind it (the first surface
# inward is the far side, past --solid); a lock is a thin sheet (a surface right behind it)
SOLID = float(flags.get('solid', 0.035))
zone = (V[:, 2] < eye_z) & (V[:, 2] > F['chin_underside_z'] - 0.01) & (V[:, 1] < hinge[1] + 0.015)
cheek = np.zeros(NV, bool)
mid_y = hinge[1]   # the inward direction aims at the hinge axis (between the ears)
for i in np.where(zone)[0]:
    d = Vector((bx - V[i][0], mid_y - V[i][1], 0))
    if d.length < 1e-4: continue
    d.normalize(); hit = bvh.ray_cast(Vector(V[i]) + d * 0.002, d, 0.2)
    cheek[i] = hit[0] is None or (hit[0] - Vector(V[i])).length > SOLID
print('FIG below the eyes, ahead of the ears: %d skin (solid behind), %d hair (a sheet)' % (int(cheek.sum()), int((zone & ~cheek).sum())))
hair &= ~cheek
# never the neck column under the jaw plane (head_lock.py's rule)
cx, cy = F['neck_axis']; rx, ry = F['neck_half']
col = np.hypot((V[:, 0] - cx) / rx, (V[:, 1] - cy) / ry) < F['column'] + 0.3
zp = F['chin_underside_z'] + F['tilt'] * np.clip((V[:, 1] - F['neck_front_y']) * -F['front'] / (2 * F['neck_radius']), 0, 1)
hair &= ~(col & (V[:, 2] < zp))
# clean the edges: two rounds of neighbour majority
nbr = [[] for _ in range(NV)]
for e in head.data.edges: a, b = e.vertices; nbr[a].append(b); nbr[b].append(a)
for _ in range(2):
    hair = np.array([hair[i] if not nbr[i] else (np.mean(hair[nbr[i]]) > 0.5 if abs(np.mean(hair[nbr[i]]) - 0.5) > 0.2 else hair[i]) for i in range(NV)])
print('FIG hair %d of %d head points (%d seen from the front, %d of those labelled hair)' % (int(hair.sum()), NV, int(seen.sum()), int((np.isin(lab, HAIR) & seen).sum())))

# ---- 2. the scalp line and the chains ------------------------------------------------------------------------------
ears_z = float((M[0][2] + M[16][2]) / 2)
top = V[hair]; hc = np.array([bx, float(np.median(V[V[:, 2] > ears_z][:, 1])), ears_z])   # the skull's middle at ear height
ang = np.degrees(np.arctan2(V[:, 0] - hc[0], -(V[:, 1] - hc[1])))     # 0 = the front (-y), +90 = the figure's left (+x)
front_w = smooth((60 - np.abs(ang)) / 20)                            # 1 within 40 degrees of the front, 0 past 60
root_z = front_w * (brow_z + 0.045) + (1 - front_w) * ears_z
free = hair & (V[:, 2] < root_z)
s_root = smooth((root_z - V[:, 2]) / 0.02) * free                     # the chains' share: 0 at the scalp line, 1 2 cm below
# hair touching skin (a side lock fused onto the cheek, bangs onto the forehead) stays with the skull where they touch and
# eases into its chain over CONTACT metres along the mesh (no cut: the fused surface has nothing behind it)
dist = np.full(NV, np.inf); frontier = list(np.where(~hair)[0]); dist[frontier] = 0.0
L = {}
for e in head.data.edges:
    a, b = e.vertices; L[(a, b)] = L[(b, a)] = float(np.linalg.norm(V[a] - V[b]))
import heapq
heap = [(0.0, int(i)) for i in frontier]; heapq.heapify(heap)
while heap:
    d, i = heapq.heappop(heap)
    if d > dist[i] or d > CONTACT: continue
    for j in nbr[i]:
        nd = d + L[(i, j)]
        if nd < dist[j]: dist[j] = nd; heapq.heappush(heap, (nd, j))
s_root = s_root * smooth(dist / CONTACT)
bang_ang = np.linspace(-25, 25, NB) if NB > 1 else np.array([0.0])
ring_ang = np.linspace(60, 300, NR)
chain_ang = np.concatenate([bang_ang, ((ring_ang + 180) % 360) - 180])
def angdiff(a, b): return np.abs(((a - b + 180) % 360) - 180)
chains = []
for k, a in enumerate(chain_ang):
    spread = 18 if k < NB else 0.75 * (ring_ang[1] - ring_ang[0])
    sel = free & (angdiff(ang, a) < spread)
    if sel.sum() < 15: print('FIG chain at %+.0f deg: too little hair (%d), skipped' % (a, sel.sum())); continue
    P = V[sel]; rz = float(np.median(root_z[sel])); tip = float(np.percentile(P[:, 2], 3))
    if k < NB: tip = max(tip, eye_z - 0.01)       # bangs end at the eyes
    if rz - tip < 0.03: print('FIG chain at %+.0f deg: hair only %.1f cm long, skipped' % (a, 100 * (rz - tip))); continue
    K = int(np.clip(round((rz - tip) / LINK), 2, 6)); zs = np.linspace(rz, tip, K + 1); joints = []
    for z in zs:
        near = P[np.abs(P[:, 2] - z) < 0.012]
        xy = near[:, :2].mean(0) if len(near) >= 3 else P[np.argsort(np.abs(P[:, 2] - z))[:5], :2].mean(0)
        joints.append(Vector((xy[0], xy[1], z)))
    chains.append({'angle': float(a), 'kind': 'bang' if k < NB else 'lock', 'joints': joints, 'z': zs, 'K': K})
print('FIG chains', len(chains), [('%s %+.0f: %.1f cm, %d links' % (c['kind'], c['angle'], 100 * (c['z'][0] - c['z'][-1]), c['K'])) for c in chains])

# ---- 3. the bones ---------------------------------------------------------------------------------------------------
bpy.context.view_layer.objects.active = rig
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
for ci, c in enumerate(chains):
    names = []; K = c['K']
    for j in range(K):
        n = 'hair_%02d_%d' % (ci, j); eb = arm.edit_bones.get(n) or arm.edit_bones.new(n)
        eb.head = c['joints'][j]; eb.tail = c['joints'][j + 1]
        eb.parent = arm.edit_bones['head'] if j == 0 else arm.edit_bones[names[-1]]; eb.use_connect = j > 0
        names.append(n)
    # a short tip bone at the chain's end: VRM 1.0 simulates a joint toward the next one, so the last link needs a node
    # past its end (unweighted; it only marks where the last link's tail is)
    tn = 'hair_%02d_tip' % ci; tb = arm.edit_bones.get(tn) or arm.edit_bones.new(tn)
    d = (c['joints'][K] - c['joints'][K - 1]).normalized()
    tb.head = c['joints'][K]; tb.tail = c['joints'][K] + d * 0.01; tb.parent = arm.edit_bones[names[-1]]; tb.use_connect = True
    c['names'] = names; c['tip'] = tn
bpy.ops.object.mode_set(mode='OBJECT')

# ---- 4. weights -----------------------------------------------------------------------------------------------------
cang = np.array([c['angle'] for c in chains])
names = {g.index: g.name for g in head.vertex_groups}
groups = {g.name: g for g in head.vertex_groups}
for c in chains:
    for n in c['names']:
        if n not in groups: groups[n] = head.vertex_groups.new(name=n)
weighted = 0
for i in np.where(s_root > 0.001)[0]:
    d = angdiff(cang, ang[i]); order = np.argsort(d)[:2]
    a1, a2 = order[0], order[1] if len(order) > 1 else order[0]
    w1 = 1.0 if a1 == a2 else d[a2] / max(d[a1] + d[a2], 1e-6)
    share = float(s_root[i]); hv = head.data.vertices[i]
    old = {names[g.group]: g.weight for g in hv.groups}
    keep = old.get('head', 0.0) + old.get('jaw', 0.0) + old.get('neck', 0.0)
    if keep <= 0: continue
    new = {}
    for ci, w in ((a1, w1), (a2, 1 - w1)):
        if w <= 0.001: continue
        c = chains[ci]; z = V[i, 2]
        j = int(np.clip(np.searchsorted(-c['z'], -z) - 1, 0, c['K'] - 1))     # the link at this height
        new[c['names'][j]] = new.get(c['names'][j], 0.0) + share * w
    for n in list(old):
        groups[n].remove([int(i)])
    groups['head'].add([int(i)], (1 - share) * old.get('head', 0.0) / keep + (1 - share) * old.get('jaw', 0.0) / keep + (1 - share) * old.get('neck', 0.0) / keep, 'REPLACE')
    for n, w in new.items(): groups[n].add([int(i)], float(w), 'REPLACE')
    weighted += 1
print('FIG free hair weighted to the chains: %d points' % weighted)

# ---- 5. cut free hair from the skin -----------------------------------------------------------------------------------
bm = bmesh.new(); bm.from_mesh(head.data); bm.verts.ensure_lookup_table()
kill = [f for f in bm.faces if any(s_root[v.index] > CUT for v in f.verts) and any(not hair[v.index] for v in f.verts)] if CUT > 0 else []
bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(head.data); bm.free(); head.data.update()
print('FIG cut %d triangles joining free hair to skin' % len(kill))

# ---- 6. springs and colliders ------------------------------------------------------------------------------------------
ext = arm.vrm_addon_extension.spring_bone1; ctx = bpy.context
def collider(bone, kind, p0, radius, p1=None):
    c = ext.add_collider(ctx, rig); c.node.bone_name = bone; c.shape_type = kind
    Mi = arm.bones[bone].matrix_local.inverted()
    if kind == 'Sphere': c.shape.sphere.offset = list(Mi @ Vector(p0)); c.shape.sphere.radius = radius
    else: c.shape.capsule.offset = list(Mi @ Vector(p0)); c.shape.capsule.tail = list(Mi @ Vector(p1)); c.shape.capsule.radius = radius
before = len(ext.colliders)
scalp = V[hair & ~free]
skull_c = Vector((bx, hc[1], ears_z + 0.02)); skull_r = float(np.percentile(np.linalg.norm(scalp - np.array(skull_c), axis=1), 10)) * 0.85
collider('head', 'Sphere', skull_c, skull_r)
nose = Vector(M[28]); face_c = nose + Vector((0, 0.045, 0)); face_r = 0.045 - 0.006
collider('head', 'Sphere', face_c, face_r)
nb = arm.bones['neck']; collider('neck', 'Capsule', nb.head_local, rx * 0.8, nb.tail_local)
for s in ('L', 'R'):
    sb = arm.bones['shoulder.' + s]; ub = arm.bones['upper_arm.' + s]
    collider('shoulder.' + s, 'Capsule', sb.head_local, 0.04, ub.head_local)
cb = arm.bones['chest']; collider('chest', 'Sphere', cb.tail_local + Vector((0, 0.01, -0.06)), 0.09)
col_uuids = [c.uuid for c in ext.colliders][before:]
grp = ext.add_collider_group(); grp.vrm_name = 'hair'; grp_uuid = grp.uuid
for u_ in col_uuids:
    g_ = [x for x in ext.collider_groups if x.uuid == grp_uuid][0]; r_ = g_.add_collider(); r_.collider_uuid = u_
for ci, c in enumerate(chains):
    ext.add_spring(); sp = ext.springs[len(ext.springs) - 1]; sp.vrm_name = 'hair %s %+.0f' % (c['kind'], c['angle'])
    if CENTER != 'none': sp.center.bone_name = CENTER
    for k, n in enumerate(c['names'] + [c['tip']]):
        sp.add_joint(); j = sp.joints[len(sp.joints) - 1]; j.node.bone_name = n
        j.stiffness = (BANG_STIFF if c['kind'] == 'bang' else STIFF) * (1 - 0.2 * k); j.drag_force = DRAG; j.gravity_power = GRAV; j.hit_radius = 0.012
    sp.add_collider_group(); sp.collider_groups[len(sp.collider_groups) - 1].collider_group_uuid = grp_uuid
print('FIG springs %d, colliders %d (skull r %.3f, face r %.3f)' % (len(ext.springs), len(ext.colliders), skull_r, face_r))
# every mesh at most four normalized influences
for ob in [o for o in bpy.data.objects if o.type == 'MESH' and o.vertex_groups]:
    for o in bpy.data.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.001)
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
face = dict(F); face['hair'] = {'chains': [{'angle': c['angle'], 'kind': c['kind'], 'bones': c['names']} for c in chains], 'brow_z': brow_z, 'ears_z': ears_z}
rig['figure_face'] = json.dumps(face)
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT), exist_ok=True)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
