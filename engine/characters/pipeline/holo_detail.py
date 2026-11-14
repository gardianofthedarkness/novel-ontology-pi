"""Replace a rigged figure's smoothed mesh with the generator's own (detailed) mesh, reduced to a readable triangle count,
keeping the skeleton: bone weights are copied from the smoothed mesh (nearest surface). For the triangle hologram look.
usage: blender -b -P holo_detail.py -- <rig.blend from dress_rig> <raw-mesh.glb> <out.blend> [--tris=16000] [--smooth=3]"""
import bpy, os, sys
import numpy as np
from mathutils import Matrix
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
RIG, RAW, OUT = [a for a in argv if not a.startswith('--')][:3]
TRIS = int(flags.get('tris', 16000)); SMOOTH = int(flags.get('smooth', 3)); H = 1.6
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=RIG)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; body = bpy.data.objects['Body']
for o in list(sc.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o, do_unlink=True)
before = set(sc.objects)
bpy.ops.import_scene.gltf(filepath=RAW)
new = [o for o in sc.objects if o not in before]
ms = [o for o in new if o.type == 'MESH']
with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
    if len(ms) > 1: bpy.ops.object.join()
ob = ms[0]
for o in new:
    if o != ob and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
ob.parent = None
with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], object=ob):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# the same placement dress_rig.py gave the smoothed mesh: 1.6 m tall, feet at 0, centred
co = np.array([v.co[:] for v in ob.data.vertices]); lo, hi = co.min(0), co.max(0); s = H / (hi[2] - lo[2])
ob.data.transform(Matrix.Translation((-(lo[0] + hi[0]) / 2 * s, -(lo[1] + hi[1]) / 2 * s, -lo[2] * s)) @ Matrix.Scale(s, 4))
# a little smoothing removes the generator's speckle but keeps the folds, hair strands and face relief
if SMOOTH:
    cs = ob.modifiers.new('cs', 'CORRECTIVE_SMOOTH'); cs.iterations = SMOOTH; cs.smooth_type = 'SIMPLE'; cs.use_only_smooth = True; cs.factor = 0.5
dc = ob.modifiers.new('dc', 'DECIMATE'); dc.ratio = min(1.0, TRIS / max(1, len(ob.data.polygons))); dc.use_collapse_triangulate = True
tri = ob.modifiers.new('tri', 'TRIANGULATE')
dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
for p in me.polygons: p.use_smooth = False
# weights: copy every bone group from the smoothed mesh
for g in body.vertex_groups: ob.vertex_groups.new(name=g.name)
dt = ob.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = body; dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
    bpy.ops.object.modifier_apply(modifier='dt')
# where the drawing's hand touched the hip, the generated surface joins arm and body: cut every triangle that has
# corners on an arm and on the torso/legs, so a raised arm doesn't pull a sheet of skin off the skirt
names = {g.index: g.name for g in ob.vertex_groups}
def part(v):
    if not v.groups: return 'none'
    n = names[max(v.groups, key=lambda g: g.weight).group].split('.')[0]
    if n in ('upper_arm', 'lower_arm', 'hand'): return 'arm'
    if n in ('hips', 'spine', 'upper_leg', 'lower_leg'): return 'body'
    return 'other'
parts = [part(v) for v in me.vertices]
import bmesh
bm = bmesh.new(); bm.from_mesh(me)
bridge = [f for f in bm.faces if {'arm', 'body'} <= {parts[v.index] for v in f.verts}]
bmesh.ops.delete(bm, geom=bridge, context='FACES')
loose = [v for v in bm.verts if not v.link_faces]; bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(me); bm.free(); me.update()
print('FIG cut', len(bridge), 'arm-to-body triangles')
# the arm itself: the surface connected to the hand below the armpit. In an A-pose the inner side of the arm lies a
# centimetre from the ribs, so nearest-bone weights mix them; connectivity doesn't. That region follows only the arm
# bones (inverse distance to upper arm / forearm / hand); nothing outside it below the armpit follows an arm.
from collections import deque
import numpy as np
nbr = [[] for _ in me.vertices]
for e in me.edges: a, b = e.vertices; nbr[a].append(b); nbr[b].append(a)
co = np.array([v.co[:] for v in me.vertices])
def segd(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(a + np.outer(t, ab) - p, axis=1)
for s in ('L', 'R'):
    bones = [rig.data.bones[f'{n}.{s}'] for n in ('upper_arm', 'lower_arm', 'hand')]
    sh = np.array(bones[0].head_local[:]); ax = np.array(bones[0].tail_local[:]) - sh; ax /= np.linalg.norm(ax)
    past = (co - sh) @ ax > 0.05          # beyond the shoulder, measured along the upper arm (any pose)
    tip = np.array(bones[2].tail_local[:]); start = int(np.argmin(np.linalg.norm(co - tip, axis=1)))
    region = {start}; q = deque([start])
    while q:
        i = q.popleft()
        for j in nbr[i]:
            if j not in region and past[j]: region.add(j); q.append(j)
    frac = len(region) / len(co)
    if frac > 0.08:
        print('FIG arm', s, 'still joined to the body (region', round(frac, 3), ') - weights left as they were'); continue
    groups = {n.name: ob.vertex_groups[n.name] for n in bones}
    d = np.stack([segd(co, np.array(b.head_local[:]), np.array(b.tail_local[:])) for b in bones], 1) + 0.01
    w = 1 / d ** 4; w /= w.sum(1, keepdims=True)
    arm_names = {f'{n}.{s}' for n in ('shoulder', 'upper_arm', 'lower_arm', 'hand')}
    for i in range(len(co)):
        if i in region:
            for g in list(ob.vertex_groups):
                g.remove([i])
            for k, b in enumerate(bones): groups[b.name].add([i], float(w[i, k]), 'REPLACE')
        elif past[i] and co[i, 0] * (1 if bones[0].head_local.x > 0 else -1) > 0:
            vg = {names[g.group]: g.weight for g in me.vertices[i].groups}
            if any(n in arm_names for n in vg):
                for n in arm_names:
                    if n in ob.vertex_groups: ob.vertex_groups[n].remove([i])
                rest = sum(wt for n, wt in vg.items() if n not in arm_names)
                if rest > 0:
                    for n, wt in vg.items():
                        if n not in arm_names: ob.vertex_groups[n].add([i], wt / rest, 'REPLACE')
                else: ob.vertex_groups['chest'].add([i], 1.0, 'REPLACE')
    print('FIG arm', s, 'region', len(region), 'vertices (', round(frac * 100, 1), '% of the figure)')
ob.parent = rig; am = ob.modifiers.new('Armature', 'ARMATURE'); am.object = rig
# one plain white material (the hologram look is made by the viewer, not by colour)
mat = bpy.data.materials.new('white'); mat.diffuse_color = (0.92, 0.93, 0.95, 1)
m = mat.vrm_addon_extension.mtoon1; m.enabled = True; m.pbr_metallic_roughness.base_color_factor = (0.92, 0.93, 0.95, 1)
me.materials.clear(); me.materials.append(mat)
weighted = sum(1 for v in me.vertices if any(g.weight > 0.01 for g in v.groups))
bpy.data.objects.remove(body, do_unlink=True)
ob.name = me.name = 'Body'
print('FIG detail mesh', len(me.vertices), 'verts', len(me.polygons), 'triangles; weighted', weighted)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('FIG saved', OUT)
