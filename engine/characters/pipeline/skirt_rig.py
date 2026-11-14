"""Give a fused skirt its own bones: a ring of short chains hanging from the hips, run as VRM 1.0 spring bones, pushed
aside by colliders on the legs; the legs keep only leg weights. The body is not changed except where the skirt meets it.
usage: blender -b -P skirt_rig.py -- <figure.blend> <out.blend> <mesh> [<mesh> ...] [--chains=10] [--links=4]
  1. the skirt: between the waist and the hem, outside each thigh's own radius (the thigh's median radius x 1.15)
  2. chains around the hips, shaped to the skirt's own surface (each chain's joints at the skirt's radius in its direction)
  3. skirt weights: the two nearest chains by angle, the two nearest links by height, blended into the hips at the waistband
  4. the strip of triangles joining the skirt's hem to the thighs is cut, so the skirt can swing
  5. a short tube from each thigh's surface below the hem up to the hip, so a swinging skirt never shows a hole
  6. VRM spring bones: one spring per chain, centre the hips, colliders: capsules on thighs and shins, spheres behind the hips"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Matrix, Vector
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
pos = [a for a in argv if not a.startswith('--')]
SRC, OUT, MESHES = pos[0], pos[1], pos[2:]
N = int(flags.get('chains', 10)); K = int(flags.get('links', 4))
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; B = rig.data.bones
hips_head = Vector(B['hips'].head_local); hip_z = B['upper_leg.L'].head_local.z; knee_z = B['lower_leg.L'].head_local.z
legs = {s: (np.array(B[f'upper_leg.{s}'].head_local[:]), np.array(B[f'upper_leg.{s}'].tail_local[:])) for s in 'LR'}
def segdist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(a + np.outer(t, ab) - p, axis=1)

# ── 1. the skirt, per mesh ──
info = {}
for name in MESHES:
    ob = bpy.data.objects[name]; me = ob.data
    co = np.array([v.co[:] for v in me.vertices])
    gid = {g.index: g.name for g in ob.vertex_groups}
    dom = np.array([gid[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in me.vertices])
    r_th, dth = {}, {}
    # the thigh's radius from the body under the clothes when there is one (Garment_x over Body_x), else from this mesh
    tb = bpy.data.objects.get(name.replace('Garment_', 'Body_')) if name.startswith('Garment_') else None
    tco = np.array([v.co[:] for v in tb.data.vertices]) if tb else co
    tgid = {g.index: g.name for g in tb.vertex_groups} if tb else gid
    tdom = np.array([tgid[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in tb.data.vertices]) if tb else dom
    for s, (a, b) in legs.items():
        d = segdist(co, a, b); dth[s] = d
        td = segdist(tco, a, b)
        mid = (tdom == f'upper_leg.{s}') & (tco[:, 2] < a[2] - 0.15) & (tco[:, 2] > b[2] + 0.05) & (td < 0.12)
        r_th[s] = float(np.median(td[mid])) * 1.15 if mid.sum() > 20 else 0.08
    outside = (dth['L'] > r_th['L']) & (dth['R'] > r_th['R'])
    band = (co[:, 2] < hip_z + 0.07) & (co[:, 2] > knee_z) & (np.abs(co[:, 0]) < 0.25)
    cand = outside & band & (co[:, 2] < hip_z - 0.02)
    hem = float(np.percentile(co[cand, 2], 2)) if cand.sum() > 50 else hip_z - 0.15
    skirt = outside & band & (co[:, 2] > hem - 0.012)
    info[name] = dict(co=co, skirt=skirt, hem=hem, r_th=r_th, dth=dth, dom=dom)
    print('FIG', name, 'skirt vertices', int(skirt.sum()), 'hem at', round(hem, 3), 'thigh radius', {k: round(v, 3) for k, v in r_th.items()}, flush=True)

# ── 2. the chains, shaped to the first mesh's skirt ──
ref = info[MESHES[0]]; sco = ref['co'][ref['skirt']]
z_top = hip_z + 0.05; z_bot = ref['hem'] + 0.005
cx, cy = float(np.median(sco[:, 0])), float(np.median(sco[:, 1]))
levels = [z_top + (z_bot - z_top) * k / K for k in range(K + 1)]
ang = np.arctan2(sco[:, 0] - cx, -(sco[:, 1] - cy))           # 0 at the front (-y), increasing toward +x
rad = np.hypot(sco[:, 0] - cx, sco[:, 1] - cy)
def skirt_radius(theta, z):
    w = np.abs((ang - theta + np.pi) % (2 * np.pi) - np.pi) < np.pi / N
    for dz in (0.015, 0.03, 0.06):
        m = w & (np.abs(sco[:, 2] - z) < dz)
        if m.sum() >= 3: return float(np.percentile(rad[m], 90))
    return float(np.percentile(rad[w], 90)) if w.any() else 0.15
chains = []
bpy.context.view_layer.objects.active = rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
for i in range(N):
    th = 2 * np.pi * i / N; d = Vector((math.sin(th), -math.cos(th), 0))
    pts = [Vector((cx, cy, z)) + d * (skirt_radius(th, z) * 0.9) for z in levels]
    # a joint must start outside the thigh's collider (thigh radius + the joint's own radius): push it out sideways
    for k, p in enumerate(pts):
        for s, (a, b) in legs.items():
            ab = b - a; tt = float(np.clip(((np.array(p[:]) - a) @ ab) / (ab @ ab), 0, 1)); q = Vector(a + ab * tt)
            clear = ref['r_th'][s] / 1.15 * 0.95 + 0.03
            off = p - q; off.z = 0
            if off.length < clear:
                pts[k] = q + (off.normalized() if off.length > 1e-4 else d) * clear + Vector((0, 0, p.z - q.z))
    pts.append(pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.03)            # a tip, so the last link has a direction
    names = []; parent = eb['hips']
    for k in range(K + 1):
        b = eb.new(f'skirt_{i:02d}_{k}'); b.head = pts[k]; b.tail = pts[k + 1]; b.parent = parent; b.use_deform = k < K
        parent = b; names.append(b.name)
    chains.append((th, names))
bpy.ops.object.mode_set(mode='OBJECT')

# ── 3-5. weights, the cut, the thigh tubes, per mesh ──
def smooth(x): return x * x * (3 - 2 * x)
for name in MESHES:
    ob = bpy.data.objects[name]; me = ob.data; I = info[name]; co, skirt = I['co'], I['skirt']
    for _, names in chains:
        for n in names[:K]:
            if n not in ob.vertex_groups: ob.vertex_groups.new(name=n)
    # the cut: triangles joining skirt to a leg below the waistband
    for v in me.vertices:
        i = v.index
        if not skirt[i]: continue
        p = co[i]; a = math.atan2(p[0] - cx, -(p[1] - cy)) % (2 * np.pi)
        f = a / (2 * np.pi) * N; i0 = int(f) % N; i1 = (i0 + 1) % N; t = f - int(f)
        s = min(1.0, max(0.0, (z_top - p[2]) / (z_top - z_bot)))           # 0 at the waist, 1 at the hem
        x = s * K - 0.5; k0 = int(np.clip(math.floor(x), 0, K - 1)); k1 = min(K - 1, k0 + 1); u = float(np.clip(x - k0, 0, 1)) if k1 != k0 else 0.0
        if x < 0: k0 = k1 = 0; u = 0.0
        hipw = 1 - smooth(min(1.0, s / 0.18))                                 # the waistband stays on the hips
        for g in list(v.groups): ob.vertex_groups[g.group].remove([i])
        ws = {}
        for ci, wc in ((i0, 1 - t), (i1, t)):
            names = chains[ci][1]
            for kk, wk in ((k0, 1 - u), (k1, u)):
                ws[names[kk]] = ws.get(names[kk], 0) + wc * wk * (1 - hipw)
        if hipw > 0: ws['hips'] = hipw
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:4]; tot = sum(w for _, w in top)
        for n, w in top:
            if w > 0: ob.vertex_groups[n].add([i], w / tot, 'REPLACE')
    # the cut, after the weights (deleting faces drops orphaned points and renumbers the rest, so the skirt mask, which is
    # by point number, must be used before it): triangles joining skirt to a leg below the waistband
    legish = np.isin(I['dom'], ['upper_leg.L', 'upper_leg.R', 'lower_leg.L', 'lower_leg.R']) & ~skirt
    bm = bmesh.new(); bm.from_mesh(me)
    cut = [f for f in bm.faces if any(skirt[v.index] for v in f.verts) and any(legish[v.index] for v in f.verts)
           and max(v.co.z for v in f.verts) < hip_z - 0.04]
    bmesh.ops.delete(bm, geom=cut, context='FACES'); bm.to_mesh(me); bm.free(); me.update()
    # thigh tubes: from each thigh's surface just below the hem up to the hip (not needed over a separate base body)
    added = 0
    for s, (a, b) in ([] if flags.get('tubes', '1') == '0' else legs.items()):
        axis = Vector(b - a).normalized(); zr = I['hem'] - 0.025
        ring = co[(I['dth'][s] < I['r_th'][s]) & (np.abs(co[:, 2] - zr) < 0.012) & ~skirt]
        if len(ring) < 8: continue
        c0 = Vector(ring.mean(0)); r0 = float(np.median(np.linalg.norm(ring[:, :2] - np.array(c0[:2]), axis=1)))
        top_c = Vector(a) + Vector((0, 0, 0.01)); seg, rings = 16, 6
        bm = bmesh.new(); vs = []
        for j in range(rings):
            q = j / (rings - 1); c = c0.lerp(top_c, q); r = r0 * (1 + 0.15 * q)
            ringv = []
            for m in range(seg):
                th = 2 * np.pi * m / seg
                ringv.append(bm.verts.new(c + Vector((math.cos(th) * r, math.sin(th) * r, 0))))
            vs.append(ringv)
        for j in range(rings - 1):
            for m in range(seg):
                bm.faces.new((vs[j][m], vs[j][(m + 1) % seg], vs[j + 1][(m + 1) % seg], vs[j + 1][m]))
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        tm = bpy.data.meshes.new(f'thigh_{s}'); bm.to_mesh(tm); bm.free()
        tob = bpy.data.objects.new(f'thigh_{s}', tm); sc.collection.objects.link(tob)
        gth = tob.vertex_groups.new(name=f'upper_leg.{s}'); gh = tob.vertex_groups.new(name='hips')
        for v in tm.vertices:
            q = min(1.0, max(0.0, (v.co.z - zr) / max(0.01, a[2] - zr)))
            hw = 0.5 * smooth(max(0.0, (q - 0.6) / 0.4))
            gth.add([v.index], 1 - hw, 'REPLACE')
            if hw > 0: gh.add([v.index], hw, 'REPLACE')
        for m in tob.data.materials: pass
        tob.data.materials.append(me.materials[0] if me.materials else None)
        with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob, tob], object=ob):
            bpy.ops.object.join()
        added += len(tm.vertices) if tm.name in bpy.data.meshes else 0
    print('FIG', name, 'cut', len(cut), 'joining triangles; skirt weighted to', N, 'chains x', K, 'links', flush=True)

# ── 6. spring bones and colliders ──
ext = rig.data.vrm_addon_extension.spring_bone1
ctx = bpy.context
def collider(bone, kind, p0, radius, p1=None):
    c = ext.add_collider(ctx, rig); c.node.bone_name = bone; c.shape_type = kind
    M = rig.data.bones[bone].matrix_local.inverted()
    if kind == 'Sphere':
        c.shape.sphere.offset = list(M @ Vector(p0)); c.shape.sphere.radius = radius
    else:
        c.shape.capsule.offset = list(M @ Vector(p0)); c.shape.capsule.tail = list(M @ Vector(p1)); c.shape.capsule.radius = radius
    return c
r_mean = {s: float(np.mean([info[n]['r_th'][s] for n in MESHES])) / 1.15 for s in 'LR'}
cols = []
for s in 'LR':
    th_ = B[f'upper_leg.{s}']; sh = B[f'lower_leg.{s}']
    cols.append(collider(f'upper_leg.{s}', 'Capsule', th_.head_local, r_mean[s] * 0.95, th_.tail_local))
    cols.append(collider(f'lower_leg.{s}', 'Capsule', sh.head_local, r_mean[s] * 0.7, sh.tail_local))
    side = 1 if th_.head_local.x > 0 else -1
    cols.append(collider('hips', 'Sphere', hips_head + Vector((0.055 * side, 0.045, -0.035)), 0.075))
# (references into a growing collection go stale: read the ids back from the finished list)
col_uuids = [c.uuid for c in ext.colliders]
grp = ext.add_collider_group(); grp.vrm_name = 'legs'
grp_uuid = grp.uuid
for u in col_uuids:
    g_ = [x for x in ext.collider_groups if x.uuid == grp_uuid][0]
    ref_ = g_.add_collider(); ref_.collider_uuid = u
for i, (th, names) in enumerate(chains):
    ext.add_spring(); sp = ext.springs[len(ext.springs) - 1]; sp.vrm_name = f'skirt {i:02d}'; sp.center.bone_name = 'hips'
    for k, n in enumerate(names):
        sp.add_joint(); j = sp.joints[len(sp.joints) - 1]; j.node.bone_name = n
        j.stiffness = 1.2 - 0.15 * k; j.drag_force = 0.5; j.gravity_power = 0.15; j.hit_radius = 0.025
    sp.add_collider_group(); sp.collider_groups[len(sp.collider_groups) - 1].collider_group_uuid = grp_uuid
print('FIG collider group holds', len([x for x in ext.collider_groups if x.uuid == grp_uuid][0].colliders), 'colliders', flush=True)
print('FIG springs', len(ext.springs), 'colliders', len(ext.colliders), flush=True)
# every mesh at most four bone influences per point, normalized: three.js reads only four, and points whose first four
# weights don't sum to one are pulled toward the origin (the floor)
for ob in [o for o in sc.objects if o.type == 'MESH' and o.vertex_groups]:
    for o in sc.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
print('FIG weights limited to 4 and normalized on', len([o for o in sc.objects if o.type == 'MESH']), 'meshes', flush=True)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
