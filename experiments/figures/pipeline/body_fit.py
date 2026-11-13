"""Put a separately generated base body under a figure's clothes, at the figure's own proportions.
usage: blender -b -P body_fit.py -- <figure.blend> <base_detail.blend> <out.blend> <outfit-mesh> ... [--gap=0.006] [--tight=0.03]
  1. the base body (its own rig, same 21 bone names) is moved bone by bone onto the figure's skeleton: each bone's piece
     mapped from the base bone's frame onto the figure bone's frame, stretched to the figure bone's length; its weights
     (same bone names) stay valid; everything above the neck is dropped (the figure keeps its own head)
  2. each outfit mesh keeps only what stands out from the base body (more than `gap` along its normal, or 2 cm away in any
     direction): the clothes; the outfit's own bare skin is dropped, the base body's continuous skin shows instead
  3. per outfit, a body copy without the parts under tight clothes (cloth within `tight` of the body: blouse, vest, socks,
     shoes); under loose cloth (a skirt) the body stays, so a swinging skirt shows legs
  writes Head, Body_<outfit>, Garment_<outfit> on the figure's skeleton"""
import bpy, bmesh, os, sys
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
pos = [a for a in argv if not a.startswith('--')]
SRC, BASE, OUT, OUTFITS = pos[0], pos[1], pos[2], pos[3:]
GAP = float(flags.get('gap', 0.006)); TIGHT = float(flags.get('tight', 0.03))
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']
cut = rig.data.bones['head'].head_local.z
# ── 1. the base body, retargeted ──
with bpy.data.libraries.load(BASE) as (src, dst):
    dst.objects = [n for n in src.objects if n in ('Armature', 'Body')]
brig = [o for o in dst.objects if o.type == 'ARMATURE'][0]; body = [o for o in dst.objects if o.type == 'MESH'][0]
sc.collection.objects.link(body)
for m in list(body.modifiers): body.modifiers.remove(m)
body.parent = None; body.matrix_world = Matrix.Identity(4)
Tb = {}
for b in rig.data.bones:
    if b.name in brig.data.bones:
        o = brig.data.bones[b.name]; k = b.length / max(1e-6, o.length)
        Tb[b.name] = b.matrix_local @ Matrix.Diagonal((1, k, 1, 1)) @ o.matrix_local.inverted()
gname = {g.index: g.name for g in body.vertex_groups}
shifts = []
for v in body.data.vertices:
    ws = [(Tb[gname[g.group]], g.weight) for g in v.groups if g.weight > 0 and gname[g.group] in Tb]
    tot = sum(w for _, w in ws)
    if tot <= 0: continue
    p = Vector((0, 0, 0))
    for M, w in ws: p += (M @ v.co) * (w / tot)
    shifts.append((p - v.co).length); v.co = p
body.data.update()
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if sum(v.co.z for v in f.verts) / len(f.verts) > cut + 0.012], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(body.data); bm.free()
body.parent = rig; am = body.modifiers.new('Armature', 'ARMATURE'); am.object = rig
white = bpy.data.objects['Head'].data.materials[0]
body.data.materials.clear(); body.data.materials.append(white)
body.name = body.data.name = 'Body'
print('FIG base body retargeted: median move', round(float(np.median(shifts)), 3), 'm;', len(body.data.polygons), 'triangles', flush=True)
dg = bpy.context.evaluated_depsgraph_get(); bvh_body = BVHTree.FromObject(body, dg)
bco = np.array([v.co[:] for v in body.data.vertices]); bno = np.array([v.normal[:] for v in body.data.vertices])
# ── 2-3. garments and body copies ──
import json
LABELS = dict((s.split('=', 1)[0], s.split('=', 1)[1].split(',')) for s in flags.get('labels', '').split(';') if s)
head = bpy.data.objects.get('Head')
def cloth_mask(ob, fview, bview):
    """which points the outfit's picture paints as cloth (not skin, not hair): front picture for front-facing points,
    the back picture mirrored for the rest"""
    co = np.array([v.co[:] for v in ob.data.vertices]); no = np.array([v.normal[:] for v in ob.data.vertices])
    allco = co if head is None else np.concatenate([co, np.array([v.co[:] for v in head.data.vertices])])
    lo, hi = allco.min(0), allco.max(0); cloth = np.zeros(len(co), bool)
    for vdir, back in ((fview, False), (bview, True)):
        v = json.load(open(os.path.join(vdir, 'view.json'))); lab = np.load(os.path.join(vdir, 'labels.npy'))
        bx0, by0, bx1, by1 = v['bbox']; xs = (hi[0] - co[:, 0]) if back else (co[:, 0] - lo[0])
        px = np.clip((bx0 + xs / (hi[0] - lo[0]) * (bx1 - bx0)).round().astype(int), 0, lab.shape[1] - 1)
        py = np.clip((by1 - (co[:, 2] - lo[2]) / (hi[2] - lo[2]) * (by1 - by0)).round().astype(int), 0, lab.shape[0] - 1)
        l = lab[py, px]; facing = (no[:, 1] > 0.0) if back else (no[:, 1] <= 0.0)
        cloth[facing] = ((l != v['skin']) & (l != v['hair']) & (l != 255))[facing]
    return cloth
for name in OUTFITS:
    ob = bpy.data.objects[name]; me = ob.data
    cloth = cloth_mask(ob, *LABELS[name]) if name in LABELS else np.ones(len(me.vertices), bool)
    keep = np.zeros(len(me.vertices), bool)
    for v in me.vertices:
        q, n, _, d = bvh_body.find_nearest(v.co)
        if q is None: continue
        keep[v.index] = ((v.co - q).dot(n) > GAP or d > 0.02) and v.co.z < cut - 0.005 and cloth[v.index]
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(keep[v.index] for v in f.verts)], context='FACES')
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
        if len(part) < 40: small += part
    bmesh.ops.delete(bm, geom=small, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(me); bm.free(); me.update()
    key = name.split('_', 1)[1] if '_' in name else name
    ob.name = me.name = f'Garment_{key}'
    dg = bpy.context.evaluated_depsgraph_get(); bvh_g = BVHTree.FromObject(ob, dg)
    covered = np.zeros(len(bco), bool)
    for i, (p, n) in enumerate(zip(bco, bno)):
        hit = bvh_g.ray_cast(Vector(p) + Vector(n) * 0.001, Vector(n), TIGHT)
        covered[i] = hit[0] is not None
    bc = body.copy(); bc.data = body.data.copy(); sc.collection.objects.link(bc)
    bm = bmesh.new(); bm.from_mesh(bc.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(covered[v.index] for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(bc.data); bm.free()
    bc.name = bc.data.name = f'Body_{key}'
    print('FIG', key, 'garment', len(me.polygons), 'triangles; body under tight cloth hidden', round(float(covered.mean()), 3), flush=True)
bpy.data.objects.remove(body, do_unlink=True)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT, sorted(o.name for o in sc.objects if o.type == 'MESH'))
