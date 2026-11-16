"""A raw model reduced to its closed outer skin, or two parts fused into one: a volume remesh at a given grid size.
  blender -b -P skin.py -- skin <in.glb> <out.glb> <voxel-m> [<place.json>]     (place.json: its T moves the model first)
  blender -b -P skin.py -- fuse <a.glb> <b.glb> <out.glb> <voxel-m>"""
import bpy, bmesh, json, sys
import numpy as np
from mathutils import Matrix
a = sys.argv[sys.argv.index('--') + 1:]; sc = bpy.context.scene
for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
def imp(path):
    before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True)
    ms = [o for o in sc.objects if o not in before and o.type == 'MESH']
    with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
        if len(ms) > 1: bpy.ops.object.join()
    ob = ms[0]
    for o in [o for o in sc.objects if o not in before and o != ob]: bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], object=ob):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.clear(); return ob
def remesh(ob, vox):
    rm = ob.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = vox; rm.use_smooth_shade = False
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get())); ob.modifiers.clear(); ob.data = me
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bad = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    parts = 0; seen = set()
    for v in bm.verts:
        if v.index in seen: continue
        parts += 1; stack = [v]; seen.add(v.index)
        while stack:
            x = stack.pop()
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen: seen.add(y.index); stack.append(y)
    bm.to_mesh(me); bm.free(); return len(me.polygons), bad, parts
def export(ob, path):
    for o in sc.objects: o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_materials='NONE', export_animations=False, export_skins=False)
if a[0] == 'merge5':     # merge5 <body_cut.glb> <bust.glb> <head_region.glb> <tube.glb> <out.glb> <voxel>: the bust kept inside the head region, fused with the body and the neck tube
    A, B, H, T = (imp(x) for x in a[1:5]); vox = float(a[6]); n0 = len(B.data.polygons)
    bo = B.modifiers.new('in', 'BOOLEAN'); bo.operation = 'INTERSECT'; bo.solver = 'EXACT'; bo.object = H
    me = bpy.data.meshes.new_from_object(B.evaluated_get(bpy.context.evaluated_depsgraph_get())); B.modifiers.clear(); B.data = me; bpy.data.objects.remove(H, do_unlink=True)
    print('MERGE5 bust inside the head region: %d -> %d faces' % (n0, len(me.polygons)))
    with bpy.context.temp_override(active_object=A, selected_editable_objects=[A, B, T], object=A): bpy.ops.object.join()
    n, bad, parts = remesh(A, vox); export(A, a[5])
    print('MERGE5 one surface at %.2f mm: %d faces, %d separate pieces, %d edges without exactly two faces' % (vox * 1000, n, parts, bad))
elif a[0] == 'merge4':     # merge4 <body.glb> <box_blend.glb> <blend.glb> <bust.glb> <box_head.glb> <out.glb> <voxel>: body minus the blend box, the blended piece, the bust head above the chin level
    A, BX, P, B, BH = (imp(x) for x in a[1:6]); vox = float(a[7])
    def boolean(ob, tool, op):
        n0 = len(ob.data.polygons); bo = ob.modifiers.new('b', 'BOOLEAN'); bo.operation = op; bo.solver = 'EXACT'; bo.object = tool
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get())); ob.modifiers.clear(); ob.data = me; bpy.data.objects.remove(tool, do_unlink=True)
        print('MERGE4 %s: %d -> %d faces' % (op, n0, len(me.polygons)))
    boolean(A, BX, 'DIFFERENCE'); boolean(B, BH, 'INTERSECT')
    with bpy.context.temp_override(active_object=A, selected_editable_objects=[A, P, B], object=A): bpy.ops.object.join()
    n, bad, parts = remesh(A, vox); export(A, a[6])
    print('MERGE4 one surface at %.2f mm: %d faces, %d separate pieces, %d edges without exactly two faces' % (vox * 1000, n, parts, bad))
elif a[0] == 'merge':      # merge <body_cut.glb> <bust.glb> <head_region.glb> <out.glb> <voxel>: the bust kept inside the head region, then fused with the body
    A, B, H = imp(a[1]), imp(a[2]), imp(a[3]); vox = float(a[5]); n0 = len(B.data.polygons)
    bo = B.modifiers.new('in', 'BOOLEAN'); bo.operation = 'INTERSECT'; bo.solver = 'EXACT'; bo.object = H
    me = bpy.data.meshes.new_from_object(B.evaluated_get(bpy.context.evaluated_depsgraph_get())); B.modifiers.clear(); B.data = me; bpy.data.objects.remove(H, do_unlink=True)
    print('MERGE bust inside the head region: %d -> %d faces' % (n0, len(me.polygons)))
    with bpy.context.temp_override(active_object=A, selected_editable_objects=[A, B], object=A): bpy.ops.object.join()
    n, bad, parts = remesh(A, vox); export(A, a[4])
    print('MERGE one surface at %.2f mm: %d faces, %d separate pieces, %d edges without exactly two faces' % (vox * 1000, n, parts, bad))
elif a[0] == 'skin':
    ob = imp(a[1]); vox = float(a[3])
    if len(a) > 4: ob.data.transform(Matrix(json.load(open(a[4]))['T']))
    n0 = len(ob.data.polygons); n, bad, parts = remesh(ob, vox); export(ob, a[2])
    print('SKIN %s: %d faces -> outer skin at %.2f mm: %d faces, %d separate pieces, %d edges without exactly two faces' % (a[1].replace(chr(92), '/').split('/')[-1], n0, vox * 1000, n, parts, bad))
else:
    A, B = imp(a[1]), imp(a[2]); vox = float(a[4])
    with bpy.context.temp_override(active_object=A, selected_editable_objects=[A, B], object=A): bpy.ops.object.join()
    n, bad, parts = remesh(A, vox); export(A, a[3])
    print('FUSE one surface at %.2f mm: %d faces, %d separate pieces, %d edges without exactly two faces' % (vox * 1000, n, parts, bad))
