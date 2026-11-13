"""The clothing system: one base body, each outfit only its clothes.
usage: blender -b -P garments.py -- <base.blend> <base.glb> <base-view-dir> <out.blend> <name>=<outfit.glb>=<outfit-view-dir> ... [--gap=0.006] [--tris=9000]
  base.blend: Armature, Head, the base body (named Outfit_* by head_swap.py); base.glb and its view: the base body as generated
  for each outfit:
   1. its generated mesh, stood as the base was (1.6 m, feet at 0), then fitted onto the base by the 17 joints of the two
      pictures (per axis: scale and shift in x and z, least squares), depth by the torso's median
   2. the clothes: every surface standing out from the base body by more than the gap (signed distance along the body's
      normal), below the neck, in pieces of a useful size
   3. weights copied from the base body under each point; loose cloth below the hips (skirts, a kimono) follows the hips more
      than the legs
   4. the base body's parts each outfit covers hidden: a body copy per outfit without them
  writes Head, Body_<name>, Garment_<name> (and Body_base) on one skeleton, and the VRM beside the .blend"""
import bpy, bmesh, json, os, sys
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
pos = [a for a in argv if not a.startswith('--')]
BASE, BASE_GLB, BASE_VIEW, OUT = pos[:4]; OUTFITS = [p.split('=', 3) for p in pos[4:]]   # name=mesh.glb=view-dir[=outfit-rig.blend]
GAP = float(flags.get('gap', 0.006)); TRIS = int(flags.get('tris', 9000)); H = 1.6
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=BASE)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']
body = [o for o in sc.objects if o.type == 'MESH' and o.name.startswith('Outfit_')][0]
body.name = body.data.name = 'Body_base'
for o in list(sc.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o, do_unlink=True)
cut = rig.data.bones['head'].head_local.z
hip_z = rig.data.bones['upper_leg.L'].head_local.z; knee_z = rig.data.bones['lower_leg.L'].head_local.z
NAMES = ['nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear', 'l_sho', 'r_sho', 'l_elb', 'r_elb', 'l_wri', 'r_wri', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ank', 'r_ank']

def import_stood(path):
    """a generated mesh, joined, stood as dress_rig.py stands it (1.6 m, feet at 0, centred)"""
    before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in sc.objects if o not in before]; ms = [o for o in new if o.type == 'MESH']
    with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
        if len(ms) > 1: bpy.ops.object.join()
    ob = ms[0]
    for o in new:
        if o != ob and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], object=ob):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    co = np.array([v.co[:] for v in ob.data.vertices]); lo, hi = co.min(0), co.max(0); s = H / (hi[2] - lo[2])
    ob.data.transform(Matrix.Translation((-(lo[0] + hi[0]) / 2 * s, -(lo[1] + hi[1]) / 2 * s, -lo[2] * s)) @ Matrix.Scale(s, 4))
    return ob
def joints3(ob, view_dir):
    v = json.load(open(os.path.join(view_dir, 'view.json'))); bx0, by0, bx1, by1 = v['bbox']
    co = np.array([p.co[:] for p in ob.data.vertices]); lo, hi = co.min(0), co.max(0)
    J = {}
    for n in NAMES:
        px, py, s = v['joints'][n]
        J[n] = (lo[0] + (px - bx0) / (bx1 - bx0) * (hi[0] - lo[0]), (by1 - py) / (by1 - by0) * H, s)
    return J
def reduce(ob, tris, smooth=2):
    if smooth:
        cs = ob.modifiers.new('cs', 'CORRECTIVE_SMOOTH'); cs.iterations = smooth; cs.smooth_type = 'SIMPLE'; cs.use_only_smooth = True; cs.factor = 0.5
    dc = ob.modifiers.new('dc', 'DECIMATE'); dc.ratio = min(1.0, tris / max(1, len(ob.data.polygons))); dc.use_collapse_triangulate = True
    ob.modifiers.new('tri', 'TRIANGULATE')
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
    for p in me.polygons: p.use_smooth = False

# the base as generated, for its joints; then gone
gb = import_stood(BASE_GLB); JB = joints3(gb, BASE_VIEW); bpy.data.objects.remove(gb, do_unlink=True)
dg = bpy.context.evaluated_depsgraph_get()
bvh_body = BVHTree.FromObject(body, dg)            # the base body at rest (the armature leaves the rest pose alone)
bco = np.array([v.co[:] for v in body.data.vertices]); bno = np.array([v.normal[:] for v in body.data.vertices])
torso = (bco[:, 2] > hip_z) & (bco[:, 2] < cut - 0.1) & (np.abs(bco[:, 0]) < 0.15)
white = body.data.materials[0]
report = {}
for spec in OUTFITS:
    name, glb, view_dir = spec[:3]; rig_blend = spec[3] if len(spec) > 3 else None
    ob = import_stood(glb); JO = joints3(ob, view_dir)
    use = [n for n in NAMES if JO[n][2] > 0.5 and JB[n][2] > 0.5]
    S, T, resid, dy = [1, 1], [0, 0], 0.0, 0.0
    reduce(ob, 60000, smooth=2)
    if rig_blend:
        # the outfit's own skeleton (the same 21 bone names, from its own picture), its weights onto the outfit mesh, and
        # every point moved bone by bone onto the base skeleton: each bone's frame mapped onto the base bone's frame, the
        # length along the bone scaled to the base bone's; the drawn body's proportions are gone, the clothes kept
        with bpy.data.libraries.load(rig_blend) as (src, dst):
            dst.objects = [n for n in src.objects if n in ('Armature', 'Body')]
        orig_rig = [o for o in dst.objects if o.type == 'ARMATURE'][0]; orig_body = [o for o in dst.objects if o.type == 'MESH'][0]
        sc.collection.objects.link(orig_body)
        for g in orig_body.vertex_groups: ob.vertex_groups.new(name=g.name)
        dt = ob.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = orig_body; dt.use_vert_data = True
        dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
        with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier='dt')
        Tb = {}
        for b in rig.data.bones:
            if b.name not in orig_rig.data.bones: continue
            o = orig_rig.data.bones[b.name]; k = b.length / max(1e-6, o.length)
            Tb[b.name] = b.matrix_local @ Matrix.Diagonal((1, k, 1, 1)) @ o.matrix_local.inverted()
        gname = {g.index: g.name for g in ob.vertex_groups}
        moved = 0; shifts = []
        for v in ob.data.vertices:
            ws = [(Tb[gname[g.group]], g.weight) for g in v.groups if g.weight > 0 and gname[g.group] in Tb]
            tot = sum(w for _, w in ws)
            if tot <= 0: continue
            p = Vector((0, 0, 0))
            for M, w in ws: p += (M @ v.co) * (w / tot)
            shifts.append((p - v.co).length); v.co = p; moved += 1
        ob.vertex_groups.clear()
        bpy.data.objects.remove(orig_body, do_unlink=True)
        resid = float(np.median(shifts)) if shifts else 0.0
        print('FIG', name, 'retargeted', moved, 'points onto the base skeleton; median move', round(resid, 3), 'm', flush=True)
    else:
        S, T = [], []
        for k in (0, 1):
            src = np.array([JO[n][k] for n in use]); dst = np.array([JB[n][k] for n in use])
            A = np.stack([src, np.ones(len(use))], 1); (a, b), *_ = np.linalg.lstsq(A, dst, rcond=None); S.append(a); T.append(b)
        resid = max(abs(JO[n][k] * S[k] + T[k] - JB[n][k]) for n in use for k in (0, 1))
        ob.data.transform(Matrix.Translation((T[0], 0, T[1])) @ Matrix.Diagonal((S[0], 1, S[1], 1)))
        co = np.array([v.co[:] for v in ob.data.vertices])
        band = (co[:, 2] > hip_z) & (co[:, 2] < cut - 0.1) & (np.abs(co[:, 0]) < 0.15)
        dy = float(np.median(bco[torso, 1]) - np.median(co[band, 1])) if band.any() else 0.0
        ob.data.transform(Matrix.Translation((0, dy, 0)))
    me = ob.data; co = np.array([v.co[:] for v in me.vertices])
    # signed distance from the base body: how far each point stands out along the body's normal
    sd = np.zeros(len(co)); ud = np.zeros(len(co))
    for i, p in enumerate(co):
        q, n, _, d = bvh_body.find_nearest(Vector(p))
        sd[i] = (Vector(p) - q).dot(n) if q is not None else 1.0; ud[i] = d if d is not None else 1.0
    # out along the body's normal, or well away from it in any direction (cloth between and behind the legs is nearest
    # to the side of a leg, where the normal points sideways)
    cloth = ((sd > GAP) | (ud > 0.02)) & (co[:, 2] < cut - 0.005)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(cloth[v.index] for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # pieces of a useful size only
    bm.faces.ensure_lookup_table(); seen = set(); small = []
    for f in bm.faces:
        if f in seen: continue
        stack = [f]; part = []; seen.add(f)
        while stack:
            g = stack.pop(); part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen: seen.add(h); stack.append(h)
        if len(part) < 300: small += part
    bmesh.ops.delete(bm, geom=small, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me); bm.free(); me.update()
    reduce(ob, TRIS, smooth=1)
    me = ob.data
    # collision: no cloth inside the body or touching it; pushed out along the body's normal to a few millimetres
    pushed = 0
    for v in me.vertices:
        q, n, _, d = bvh_body.find_nearest(v.co)
        if q is None: continue
        s = (v.co - q).dot(n)
        if s < 0.004: v.co = q + n * 0.004; pushed += 1
    me.update()
    # weights: the base body's, from the point beneath
    for g in body.vertex_groups: ob.vertex_groups.new(name=g.name)
    dt = ob.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = body; dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier='dt')
    # loose cloth below the hips follows the hips more than the legs (a skirt does not split with the legs)
    gi = {g.name: g for g in ob.vertex_groups}; legs = [gi[n] for n in ('upper_leg.L', 'upper_leg.R', 'lower_leg.L', 'lower_leg.R') if n in gi]
    loose = 0
    for v in me.vertices:
        if not (knee_z - 0.6 < v.co.z < hip_z + 0.06): continue
        q, n, _, d = bvh_body.find_nearest(v.co)
        if d is None or d < 0.025: continue
        ws = {g.group: g.weight for g in v.groups}; legw = sum(ws.get(g.index, 0) for g in legs)
        if legw <= 0: continue
        t = min(1.0, (d - 0.025) / 0.06)                       # farther from the legs: more like a skirt
        keep_share = 1 - 0.75 * t
        for g in legs:
            if g.index in ws: g.add([v.index], ws[g.index] * keep_share, 'REPLACE')
        gi['hips'].add([v.index], ws.get(gi['hips'].index, 0) + legw * (1 - keep_share), 'REPLACE'); loose += 1
    # a long robe (cloth across the middle, between the legs, reaching below the knees) hangs from the hips: below the hips
    # it leaves the shins, and the thighs keep only a share; the legs under it are hidden, so a stride cannot show through
    gco = np.array([v.co[:] for v in me.vertices])
    robe = bool(((np.abs(gco[:, 0]) < 0.04) & (gco[:, 2] < knee_z - 0.05)).sum() > 20)
    feet = [(rig.data.bones[f'foot.{s}'].tail_local + rig.data.bones[f'foot.{s}'].head_local * 0) for s in 'LR'] + \
           [Vector((rig.data.bones[f'foot.{s}'].head_local.x, rig.data.bones[f'foot.{s}'].head_local.y - 0.06, 0.03)) for s in 'LR']
    if robe:
        for v in me.vertices:
            if v.co.z > hip_z: continue
            if v.co.z < 0.1 and min((v.co - f).length for f in feet) < 0.07: continue   # footwear (tabi, sandals) stays on the feet
            ws = {ob.vertex_groups[g.group].name: g.weight for g in v.groups}
            side = 'L' if v.co.x > 0 else 'R'
            legw = sum(w for n, w in ws.items() if n.split('.')[0] in ('upper_leg', 'lower_leg', 'foot', 'toes'))
            if legw <= 0: continue
            t = min(1.0, (hip_z - v.co.z) / max(0.05, hip_z - knee_z))       # 0 at the hips, 1 at the knees and below
            leg_share = legw * (0.45 - 0.2 * t)
            for n in list(ws):
                if n.split('.')[0] in ('upper_leg', 'lower_leg', 'foot', 'toes'): gi[n].remove([v.index])
            gi[f'upper_leg.{side}'].add([v.index], leg_share, 'REPLACE')
            gi['hips'].add([v.index], ws.get('hips', 0) + legw - leg_share, 'REPLACE')
    ob.parent = rig; am = ob.modifiers.new('Armature', 'ARMATURE'); am.object = rig
    me.materials.clear(); me.materials.append(white)
    ob.name = me.name = f'Garment_{name}'
    # the base body under the clothes, hidden: a body copy without the faces the garment covers
    dg = bpy.context.evaluated_depsgraph_get(); bvh_g = BVHTree.FromObject(ob, dg)
    covered = np.zeros(len(bco), bool)
    for i, (p, n) in enumerate(zip(bco, bno)):
        if p[2] > cut - 0.01: continue
        hit = bvh_g.ray_cast(Vector(p) + Vector(n) * 0.001, Vector(n), 0.09)
        covered[i] = hit[0] is not None
    bc = body.copy(); bc.data = body.data.copy(); sc.collection.objects.link(bc)
    bm = bmesh.new(); bm.from_mesh(bc.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(covered[v.index] for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(bc.data); bm.free()
    bc.name = bc.data.name = f'Body_{name}'
    report[name] = {'joints_used': len(use), 'fit_scale_xz': [round(S[0], 3), round(S[1], 3)], 'fit_residual_m': round(float(resid), 3),
                    'depth_shift': round(dy, 3), 'garment_tris': len(me.polygons), 'loose_cloth_verts': loose, 'long_robe': robe, 'pushed_out': pushed,
                    'body_hidden_share': round(float(covered.mean()), 3), 'body_tris_left': len(bc.data.polygons)}
    print('FIG', name, report[name], flush=True)
json.dump(report, open(OUT.replace('.blend', '_report.json'), 'w'), indent=1)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
meta = rig.data.vrm_addon_extension.vrm1.meta; meta.vrm_name = 'Misaka (prototype figure, wardrobe)'
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT, sorted(o.name for o in sc.objects if o.type == 'MESH'))
