"""The rigged merged figure packed with its base body as the hidden layer, for the viewer's soft cloth.
usage: blender -b <holo_m.blend> -P layer_raw.py -- <base_reduced.glb> <rig.blend from dress_rig> <head_region.glb> <out.blend> [<raw/place.json> [<raw/tube.glb>]]
  With place.json the bust's landmark mapping is written to the armature (bust_map), for the skull lock and the face rig;
  with tube.glb (tube.json beside it) the neck's own section level by level (neck_tube).
  head     the figure's triangles inside the solid the merge kept the bust in become their own mesh, Head: the viewer keeps the
           head on the skeleton and measures no layer for it (the base body has no head)
  layer    the base body (already laid inside the figure raw, by rawmerge/base_raw.py, and reduced) takes its bone weights
           from the same solid the figure took its own from (nearest surface), and is named LayerBody; the viewer measures
           each figure point against it and never draws it. No second rig, no retargeting.
  Every mesh is limited to four normalized bone influences. Writes <out>.blend and <out>.vrm."""
import bpy, bmesh, os, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]; BASE, RIGB, HEADR, OUT = argv[:4]
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; body = bpy.data.objects['Body']
def imp(path):
    before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True); new = [o for o in sc.objects if o not in before]
    ob = [o for o in new if o.type == 'MESH'][0]
    for o in new:
        if o != ob: bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], object=ob): bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    b = bmesh.new(); b.from_mesh(ob.data); bmesh.ops.remove_doubles(b, verts=b.verts[:], dist=float(np.finfo(np.float32).eps)); b.to_mesh(ob.data); b.free()   # NUMERIC: the file repeats a point per triangle corner
    ob.data.materials.clear(); return ob
# ---- the head: inside the head region = on the inner side of its nearest face, the side the figure's topmost point is on
hr = imp(HEADR); hb = BVHTree.FromPolygons([v.co[:] for v in hr.data.vertices], [p.vertices[:] for p in hr.data.polygons]); bpy.data.objects.remove(hr, do_unlink=True)
def side(p): loc, nrm, _, _ = hb.find_nearest(p); return (p - loc).dot(nrm)
me = body.data; top = max(me.vertices, key=lambda v: v.co.z); sgn = 1.0 if side(top.co) > 0 else -1.0
in_head = np.array([side(v.co) * sgn > 0 for v in me.vertices])
head_faces = [p.index for p in me.polygons if all(in_head[i] for i in p.vertices)]
for o in sc.objects: o.select_set(False)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_mode(type='FACE'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.object.mode_set(mode='OBJECT')
for i in head_faces: me.polygons[i].select = True
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='SELECTED'); bpy.ops.object.mode_set(mode='OBJECT')
head = [o for o in sc.objects if o.type == 'MESH' and o != body and o.name.startswith('Body')][0]; head.name = head.data.name = 'Head'
print('FIG head split off: %d triangles; body keeps %d' % (len(head.data.polygons), len(body.data.polygons)))
body.name = body.data.name = 'Outfit_main'        # STRUCTURAL: the viewer's name for the clothed surface (one outfit)
# ---- the layer: the base body, weighted from the rig's own solid
with bpy.data.libraries.load(RIGB) as (src, dst): dst.objects = [n for n in src.objects if n == 'Body']
solid = dst.objects[0]; sc.collection.objects.link(solid); solid.name = 'weights_source'
layer = imp(BASE); layer.name = layer.data.name = 'LayerBody'
# the base body and the bust's landmarks were placed in the raw figure's frame; the rig stands the figure in its own
# (holo_detail.py's raw_frame): both follow by it
import json
from mathutils import Matrix
N = Matrix(json.loads(rig['raw_frame'])); layer.data.transform(N)
if len(argv) > 4:
    T = Matrix(json.load(open(argv[4]))['T']); rig['bust_map'] = json.dumps({'M': [list(r) for r in (N @ T)]})
    print('FIG bust landmarks carried onto the figure by the raw placement (place.json) and the rig frame')
if len(argv) > 5:
    # the neck itself: the merge's tube (raw/tube.glb), level by level in the rig's frame: each level's centre and half
    # widths (for points on an ellipse the variance along an axis is half the semi-axis squared), for the skull lock
    tb = imp(argv[5]); tb.data.transform(N); P = np.array([v.co[:] for v in tb.data.vertices]); bpy.data.objects.remove(tb, do_unlink=True)
    tj = json.load(open(os.path.join(os.path.dirname(argv[5]), 'tube.json'))); per = len(P) // max(1, int(round((P[:, 2].max() - P[:, 2].min()) / tj['step'])) + 1)
    P = P[np.argsort(P[:, 2])]; rings = [P[i:i + per] for i in range(0, len(P) - per + 1, per)]
    rig['neck_tube'] = json.dumps([[float(r[:, 2].mean()), float(r[:, 0].mean()), float(r[:, 1].mean()), float(np.sqrt(2 * r[:, 0].var())), float(np.sqrt(2 * r[:, 1].var()))] for r in rings])
    print('FIG neck tube carried: %d levels from z %.3f to %.3f' % (len(rings), rings[0][:, 2].mean(), rings[-1][:, 2].mean()))
for g in solid.vertex_groups: layer.vertex_groups.new(name=g.name)
dt = layer.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = solid; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
with bpy.context.temp_override(active_object=layer, object=layer, selected_editable_objects=[layer]): bpy.ops.object.modifier_apply(modifier='dt')
bpy.data.objects.remove(solid, do_unlink=True)
layer.parent = rig; am = layer.modifiers.new('Armature', 'ARMATURE'); am.object = rig; layer.data.materials.append(body.data.materials[0])
for p in layer.data.polygons: p.use_smooth = False
for ob in (body, head, layer):
    for o in sc.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)          # STRUCTURAL: glTF's four influences
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
weighted = sum(1 for v in layer.data.vertices if any(g.weight > 0 for g in v.groups))
print('FIG meshes', sorted((o.name, len(o.data.vertices)) for o in sc.objects if o.type == 'MESH'), '; layer points weighted', weighted)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.wm.save_as_mainfile(filepath=OUT)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm)); print('FIG saved', OUT)
