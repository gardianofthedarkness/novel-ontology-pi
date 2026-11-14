"""The head in four-sided faces (an experiment after v0.7): QuadriFlow remesh, projected back onto the generated shape,
every weight carried over (skull, neck, jaw, hair chains), the original head replaced.
usage: blender -b <figure.blend> -P quad_head.py -- <out.blend> [--faces=6000] [--keep-tris]
  The mesh is named Head_quad so the viewer draws its quad edges only (each quad's diagonal hidden). --keep-tris keeps
  the triangle head too, hidden, for comparison. Prints the quad share, the vertex count, and how many points the jaw
  region has before and after (the jaw's coarseness was v0.7's weak spot)."""
import bpy, os, sys
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in argv if a.startswith('--'))
OUT = [a for a in argv if not a.startswith('--')][0]; FACES = int(flags.get('faces', 6000))
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; head = bpy.data.objects['Head']
def count(ob, group):
    if group not in ob.vertex_groups: return 0
    gi = ob.vertex_groups[group].index
    return sum(1 for v in ob.data.vertices for g in v.groups if g.group == gi and g.weight > 0.3)
jaw0 = count(head, 'jaw'); v0 = len(head.data.vertices)
# a clean copy without the armature, remeshed
q = head.copy(); q.data = head.data.copy(); bpy.context.scene.collection.objects.link(q)
for m in list(q.modifiers): q.modifiers.remove(m)
q.vertex_groups.clear(); q.parent = None; q.matrix_world = head.matrix_world.copy()
# QuadriFlow needs a closed, manifold surface with consistent normals: the head is open at the neck seam and the
# decimation left doubled points and pinched spots. Merge, drop non-manifold points, fill the holes, turn faces outward,
# repeat until clean. (A voxel remesh of the open, thin-walled shell fell apart into 355 pieces.)
import bmesh
for o in bpy.data.objects: o.select_set(False)
q.select_set(True); bpy.context.view_layer.objects.active = q
for rnd in range(6):
    bm = bmesh.new(); bm.from_mesh(q.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
    bad = [v for v in bm.verts if not v.is_manifold or not v.link_faces]
    badf = [f for f in bm.faces if f.calc_area() < 1e-10]
    bmesh.ops.delete(bm, geom=badf, context='FACES'); bmesh.ops.delete(bm, geom=[v for v in bad if v.is_valid], context='VERTS')
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    left = sum(1 for e in bm.edges if not e.is_manifold); bm.to_mesh(q.data); bm.free(); q.data.update()
    print('FIG clean round', rnd, 'removed', len(bad), 'points; non-manifold edges left', left, flush=True)
    if left == 0 and not bad: break
with bpy.context.temp_override(active_object=q, object=q, selected_objects=[q], selected_editable_objects=[q]):
    r = bpy.ops.object.quadriflow_remesh(use_mesh_symmetry=False, use_preserve_sharp=True, use_preserve_boundary=True,
                                         preserve_attributes=False, smooth_normals=False, mode='FACES', target_faces=FACES, seed=0)
print('FIG quadriflow', r, len(q.data.polygons), 'faces', flush=True)
# back onto the generated surface (the remesh rounds fine strands and edges)
sw = q.modifiers.new('sw', 'SHRINKWRAP'); sw.target = head; sw.wrap_method = 'NEAREST_SURFACEPOINT'
with bpy.context.temp_override(active_object=q, object=q, selected_editable_objects=[q]):
    bpy.ops.object.modifier_apply(modifier='sw')
# the weights, carried by hand: each new point takes the blend of the old triangle nearest to it (Blender's data-transfer
# modifier left most points unweighted here)
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc
hm = head.data; bvh = BVHTree.FromPolygons([v.co for v in hm.vertices], [p.vertices[:] for p in hm.polygons])
hn = {g.index: g.name for g in head.vertex_groups}
W = [{hn[g.group]: g.weight for g in v.groups} for v in hm.vertices]
groups = {g.name: q.vertex_groups.new(name=g.name) for g in head.vertex_groups}
for v in q.data.vertices:
    loc, nrm, fi, dist = bvh.find_nearest(v.co)
    if fi is None: continue
    ids = hm.polygons[fi].vertices[:]; bw = poly_3d_calc([hm.vertices[i].co for i in ids], loc)
    acc = {}
    for i, w in zip(ids, bw):
        for n, x in W[i].items(): acc[n] = acc.get(n, 0.0) + w * x
    for n, x in acc.items():
        if x > 1e-4: groups[n].add([v.index], float(x), 'REPLACE')
with bpy.context.temp_override(active_object=q, object=q, selected_editable_objects=[q]):
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.001)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
for p in q.data.polygons: p.use_smooth = False
quads = sum(1 for p in q.data.polygons if len(p.vertices) == 4)
q.parent = rig; q.matrix_parent_inverse = rig.matrix_world.inverted()
am = q.modifiers.new('Armature', 'ARMATURE'); am.object = rig
q.data.materials.clear()
for m in head.data.materials: q.data.materials.append(m)
q.name = q.data.name = 'Head_quad'
print('FIG head: triangles %d vertices, jaw region %d points -> quads %d vertices (%d of %d faces four-sided), jaw region %d points'
      % (v0, jaw0, len(q.data.vertices), quads, len(q.data.polygons), count(q, 'jaw')), flush=True)
if 'keep-tris' in flags: head.hide_render = True; head.name = 'Head_tris'
else: bpy.data.objects.remove(head, do_unlink=True)
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT), exist_ok=True)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
