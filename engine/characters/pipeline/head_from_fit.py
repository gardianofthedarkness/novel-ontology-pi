"""Put a fitted template head (fit_template.py) into a figure: the template's quads as Head_quad with every weight carried
from the generated head (skull, neck, jaw, hair chains: each point takes the blend of the nearest old triangle), and the
generated head kept only where the hair hangs free (its locks, until they get quad strips of their own).
usage: blender -b <figure.blend> -P head_from_fit.py -- <fitted.obj> <out.blend> [--free=0.3]"""
import bpy, bmesh, os, sys
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in argv if a.startswith('--'))
OBJ, OUT = [a for a in argv if not a.startswith('--')][:2]; FREE = float(flags.get('free', 0.3))
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; head = bpy.data.objects['Head']
V, F = [], []
for line in open(OBJ):
    s = line.split()
    if s and s[0] == 'v': V.append(tuple(float(x) for x in s[1:4]))
    elif s and s[0] == 'f': F.append([int(x.split('/')[0]) - 1 for x in s[1:]])
me = bpy.data.meshes.new('Head_quad'); me.from_pydata(V, [], F); me.update()
q = bpy.data.objects.new('Head_quad', me); bpy.context.scene.collection.objects.link(q)
hm = head.data; bvh = BVHTree.FromPolygons([v.co for v in hm.vertices], [p.vertices[:] for p in hm.polygons])
hn = {g.index: g.name for g in head.vertex_groups}
W = [{hn[g.group]: g.weight for g in v.groups} for v in hm.vertices]
groups = {g.name: q.vertex_groups.new(name=g.name) for g in head.vertex_groups}
for v in me.vertices:
    loc, nrm, fi, dist = bvh.find_nearest(v.co)
    if fi is None: continue
    ids = hm.polygons[fi].vertices[:]; bw = poly_3d_calc([hm.vertices[i].co for i in ids], loc); acc = {}
    for i, w in zip(ids, bw):
        for n, x in W[i].items(): acc[n] = acc.get(n, 0.0) + w * x
    for n, x in acc.items():
        if x > 1e-4: groups[n].add([v.index], float(x), 'REPLACE')
for o in bpy.data.objects: o.select_set(False)
q.select_set(True); bpy.context.view_layer.objects.active = q
with bpy.context.temp_override(active_object=q, object=q, selected_editable_objects=[q]):
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.001)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
for p in me.polygons: p.use_smooth = False
q.parent = rig; am = q.modifiers.new('Armature', 'ARMATURE'); am.object = rig
for m in hm.materials: me.materials.append(m)
# the generated head: only its free-hanging hair stays
free = [sum(g.weight for g in v.groups if hn[g.group].startswith('hair_')) for v in hm.vertices]
bm = bmesh.new(); bm.from_mesh(hm)
kill = [f for f in bm.faces if min(free[v.index] for v in f.verts) < FREE]
bmesh.ops.delete(bm, geom=kill, context='FACES'); bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(hm); bm.free(); hm.update()
head.name = hm.name = 'Hair_locks'
print('FIG Head_quad %d points, %d quads; hair locks kept %d faces' % (len(me.vertices), len(me.polygons), len(hm.polygons)))
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT), exist_ok=True)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
