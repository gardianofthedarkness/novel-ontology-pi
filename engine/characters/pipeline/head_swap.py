"""Put a detailed head (from a high-resolution portrait's bust model) on a rigged body, in place of the body's own head.
usage: blender -b -P head_swap.py -- <body_detail.blend> <body-view-dir> <bust.glb> <portrait-view-dir> <out.blend> [--tris=8000]
  landmarks from each picture's joints (RTMPose: eyes, nose; the chin from them), mapped onto each mesh through its picture's
  figure box; the bust scaled so crown-to-chin matches the body's, placed nose on nose and chin on chin, centred in depth;
  the body keeps everything below the neck, the bust everything above; the bust follows the head bone, blending into the neck"""
import bpy, bmesh, json, os, sys
import numpy as np
from mathutils import Matrix, Vector
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
BODY, BVIEW, BUST, PVIEW, OUT = [a for a in argv if not a.startswith('--')][:5]
TRIS = int(flags.get('tris', 8000))
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=BODY)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; body = bpy.data.objects[flags.get('body', 'Body')]
# a composed figure already has a Head (and its bodies cut at the neck): its picture maps onto head and body together
old_head = bpy.data.objects.get('Head') if flags.get('body') else None

def landmarks(view, lo, hi):
    """eye, nose, chin heights and the nose's x on a mesh, through its picture's figure box"""
    bx0, by0, bx1, by1 = view['bbox']; J = view['joints']
    X = lambda px: lo[0] + (px - bx0) / (bx1 - bx0) * (hi[0] - lo[0])
    Z = lambda py: lo[2] + (by1 - py) / (by1 - by0) * (hi[2] - lo[2])
    eye_y = (J['l_eye'][1] + J['r_eye'][1]) / 2; nose_y = J['nose'][1]
    return {'eye': Z(eye_y), 'nose': Z(nose_y), 'chin': Z(nose_y + 1.1 * (nose_y - eye_y)), 'x': X(J['nose'][0]),
            'ears': abs(X(J['l_ear'][0]) - X(J['r_ear'][0]))}
bco = np.array([v.co[:] for v in body.data.vertices])
if old_head is not None:
    bco = np.concatenate([bco, np.array([v.co[:] for v in old_head.data.vertices])])
    bpy.data.objects.remove(old_head, do_unlink=True)
blo, bhi = bco.min(0), bco.max(0)
Lb = landmarks(json.load(open(os.path.join(BVIEW, 'view.json'))), blo, bhi)
Lb['crown'] = float(bco[np.abs(bco[:, 0] - Lb['x']) < 0.08, 2].max())

before = set(sc.objects)
bpy.ops.import_scene.gltf(filepath=BUST)
new = [o for o in sc.objects if o not in before]; ms = [o for o in new if o.type == 'MESH']
with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
    if len(ms) > 1: bpy.ops.object.join()
head = ms[0]
for o in new:
    if o != head and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
head.parent = None
with bpy.context.temp_override(active_object=head, selected_editable_objects=[head], object=head):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
hco = np.array([v.co[:] for v in head.data.vertices]); hlo, hhi = hco.min(0), hco.max(0)
Lh = landmarks(json.load(open(os.path.join(PVIEW, 'view.json'))), hlo, hhi)
Lh['crown'] = float(hhi[2])
# scale from the face's own landmarks (eye-to-chin height and ear-to-ear width), not from the crown, which depends on
# how high each model's hair stands; the geometric mean of the two
s_v = (Lb['eye'] - Lb['chin']) / (Lh['eye'] - Lh['chin']); s_e = Lb['ears'] / Lh['ears']
s = float((s_v * s_e) ** 0.5)
print('FIG scale by eye-chin', round(s_v, 4), 'by ears', round(s_e, 4), 'crown-chin would be', round((Lb['crown'] - Lb['chin']) / (Lh['crown'] - Lh['chin']), 4))
print('FIG body head', {k: round(v, 3) for k, v in Lb.items()}, 'bust', {k: round(v, 3) for k, v in Lh.items()})
print('FIG scale', round(s, 4), 'ear width body', round(Lb['ears'], 3), 'bust scaled', round(Lh['ears'] * s, 3))
# scale about the bust's chin, then move chin onto chin and nose x onto nose x
head.data.transform(Matrix.Translation((Lb['x'] - Lh['x'], 0, Lb['chin'] - Lh['chin'])) @ Matrix.Translation((Lh['x'], 0, Lh['chin'])) @ Matrix.Scale(s, 4) @ Matrix.Translation((-Lh['x'], 0, -Lh['chin'])))
# the neck seam's height is kept on the armature (neck_seam_z), apart from the head's pivot, which v0.7 moves up to the skull base
cut = float(rig.get('neck_seam_z', rig.data.bones['head'].head_local.z)); rig['neck_seam_z'] = cut
hco = np.array([v.co[:] for v in head.data.vertices])
bh = bco[bco[:, 2] > cut + 0.02]; hh = hco[hco[:, 2] > cut + 0.02]
dy = float(np.median(bh[:, 1]) - np.median(hh[:, 1])); head.data.transform(Matrix.Translation((0, dy, 0)))
print('FIG neck cut', round(cut, 3), 'depth shift', round(dy, 3))

def keep(ob, above, z):
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me)
    kill = [f for f in bm.faces if ((sum(v.co.z for v in f.verts) / len(f.verts)) > z) != above]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(me); bm.free(); me.update()
keep(head, True, cut - 0.012)       # the bust down to just under the neck line (a little overlap hides the seam)
if old_head is None: keep(body, False, cut + 0.012)   # a composed figure's bodies are already cut at the neck
cs = head.modifiers.new('cs', 'CORRECTIVE_SMOOTH'); cs.iterations = 2; cs.smooth_type = 'SIMPLE'; cs.use_only_smooth = True; cs.factor = 0.5
dc = head.modifiers.new('dc', 'DECIMATE'); dc.ratio = min(1.0, TRIS / max(1, len(head.data.polygons))); dc.use_collapse_triangulate = True
head.modifiers.new('tri', 'TRIANGULATE')
dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(head.evaluated_get(dg))
old = head.data; head.modifiers.clear(); head.data = me; bpy.data.meshes.remove(old)
for p in me.polygons: p.use_smooth = False
gh = head.vertex_groups.new(name='head'); gn = head.vertex_groups.new(name='neck')
for v in me.vertices:
    w = min(1.0, max(0.0, (v.co.z - cut) / 0.04))
    if w > 0: gh.add([v.index], w, 'REPLACE')
    if w < 1: gn.add([v.index], 1 - w, 'REPLACE')
head.parent = rig; am = head.modifiers.new('Armature', 'ARMATURE'); am.object = rig
me.materials.clear(); me.materials.append(body.data.materials[0])
head.name = me.name = 'Head'
if body.name == 'Body': body.name = body.data.name = 'Outfit_' + flags.get('outfit', 'main')
print('FIG head', len(me.polygons), 'triangles; body', len(body.data.polygons))
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
