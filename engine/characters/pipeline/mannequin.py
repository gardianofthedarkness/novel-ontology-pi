"""Turn a rigged base body (generated wearing a fitted base layer) into a smooth, featureless mannequin body: the fabric's
thickness taken off, creases, cuffs, seams and shoe edges smoothed away, an even surface; weights copied back.
usage: blender -b -P mannequin.py -- <base_detail.blend> <out.blend> [--shrink=0.004] [--tris=16000]"""
import bpy, os, sys
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
SRC, OUT = [a for a in argv if not a.startswith('--')][:2]
SHRINK = float(flags.get('shrink', 0.004)); TRIS = int(flags.get('tris', 16000))
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; body = bpy.data.objects['Body']
src = body.copy(); src.data = body.data.copy(); sc.collection.objects.link(src); src.name = 'weights_source'
for m in list(body.modifiers): body.modifiers.remove(m)
co0 = np.array([v.co[:] for v in body.data.vertices])
def apply(ob, mods):
    for kind, setup in mods:
        m = ob.modifiers.new(kind.lower(), kind); setup(m)
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
def remesh(m): m.mode = 'VOXEL'; m.voxel_size = 0.005; m.use_smooth_shade = True
def lap(m): m.iterations = 12; m.lambda_factor = 0.6; m.use_volume_preserve = True; m.use_normalized = True
def shrink(m): m.strength = -SHRINK; m.direction = 'NORMAL'; m.mid_level = 0.0
def relax(m): m.iterations = 6; m.smooth_type = 'SIMPLE'; m.factor = 0.5; m.use_only_smooth = True
def dec(m): m.ratio = 1.0; m.use_collapse_triangulate = True
body.vertex_groups.clear()
import bmesh
def outward(ob, keep_largest=False):
    """every face turned outward (the second Index base had half its faces inward: the shrink then pushed them out and the
    page's back-face culling hid them), and with keep_largest only the biggest piece kept (a voxel remesh can close
    pockets, between long hair and the back, into inner shells)"""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    if keep_largest:
        seen, parts = set(), []
        for f in bm.faces:
            if f.index in seen: continue
            stack, part = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop(); part.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen: seen.add(h.index); stack.append(h)
            parts.append(part)
        parts.sort(key=len, reverse=True)
        bmesh.ops.delete(bm, geom=[f for p in parts[1:] for f in p], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free(); ob.data.update()
apply(body, [('REMESH', remesh)])
outward(body, keep_largest=True)
apply(body, [('LAPLACIANSMOOTH', lap), ('DISPLACE', shrink), ('CORRECTIVE_SMOOTH', relax)])
n = len(body.data.polygons)
apply(body, [('DECIMATE', lambda m: (setattr(m, 'ratio', min(1.0, TRIS / max(1, n))), setattr(m, 'use_collapse_triangulate', True))), ('TRIANGULATE', lambda m: None)])
outward(body)
for p in body.data.polygons: p.use_smooth = False
for g in src.vertex_groups: body.vertex_groups.new(name=g.name)
dt = body.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = src; dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
with bpy.context.temp_override(active_object=body, object=body, selected_editable_objects=[body]):
    bpy.ops.object.modifier_apply(modifier='dt')
body.parent = rig; am = body.modifiers.new('Armature', 'ARMATURE'); am.object = rig
body.data.materials.clear(); body.data.materials.append(src.data.materials[0] if src.data.materials else None)
co1 = np.array([v.co[:] for v in body.data.vertices])
print('FIG mannequin', len(body.data.polygons), 'triangles; bounds before', co0.min(0).round(3), co0.max(0).round(3), 'after', co1.min(0).round(3), co1.max(0).round(3), flush=True)
bpy.data.objects.remove(src, do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
