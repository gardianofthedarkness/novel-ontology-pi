"""Pack a one-shot figure with its base body as a hidden reference layer, both on the figure's skeleton.
usage: blender -b -P layer_pack.py -- <figure.blend> <base_body.blend> <out.blend>
  the base body (generated as the figure's pair, its own rig with the same 21 bone names) is moved bone by bone onto the
  figure's skeleton (each bone's frame onto the figure bone's frame, stretched to its length), cut at the neck and named
  LayerBody; the viewer measures each point of the figure against it (the layer's thickness) and never draws it.
  Every mesh is limited to four normalized bone influences."""
import bpy, bmesh, os, sys
import numpy as np
from mathutils import Matrix, Vector
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, BASE, OUT = [a for a in argv if not a.startswith('--')][:3]
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']
cut = float(rig.get('neck_seam_z', rig.data.bones['head'].head_local.z))   # the seam, not the head's pivot (v0.7)
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
for v in body.data.vertices:
    ws = [(Tb[gname[g.group]], g.weight) for g in v.groups if g.weight > 0 and gname[g.group] in Tb]
    tot = sum(w for _, w in ws)
    if tot <= 0: continue
    p = Vector((0, 0, 0))
    for M, w in ws: p += (M @ v.co) * (w / tot)
    v.co = p
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if sum(v.co.z for v in f.verts) / len(f.verts) > cut - 0.01], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(body.data); bm.free()
body.parent = rig; am = body.modifiers.new('Armature', 'ARMATURE'); am.object = rig
body.data.materials.clear(); body.data.materials.append(bpy.data.objects['Head'].data.materials[0])
body.name = body.data.name = 'LayerBody'
for ob in [o for o in sc.objects if o.type == 'MESH' and o.vertex_groups]:
    for o in sc.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
print('FIG meshes', sorted((o.name, len(o.data.vertices)) for o in sc.objects if o.type == 'MESH'), flush=True)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
