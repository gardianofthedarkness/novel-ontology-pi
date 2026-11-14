"""Settle each garment on the base body by cloth simulation: the base body as a collider, the garment's top and the parts
lying on the body pinned, the rest (skirts, hems, hanging sleeves) let fall under gravity for a short time; the settled
shape becomes the garment's rest shape (its weights unchanged).
usage: blender -b -P cloth_settle.py -- <wardrobe.blend> <out.blend> [--frames=30]"""
import bpy, os, sys
import numpy as np
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
SRC, OUT = [a for a in argv if not a.startswith('--')][:2]; FR = int(flags.get('frames', 30))
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; base = bpy.data.objects['Body_base']
hip_z = rig.data.bones['upper_leg.L'].head_local.z; cut = rig.data.bones['head'].head_local.z
# the collider: a still copy of the base body (no armature: the rest pose)
col = base.copy(); col.data = base.data.copy(); sc.collection.objects.link(col); col.modifiers.clear(); col.name = 'collider'
c = col.modifiers.new('collision', 'COLLISION'); col.collision.thickness_outer = 0.004; col.collision.cloth_friction = 5
col.hide_render = True
dg = bpy.context.evaluated_depsgraph_get(); bvh = BVHTree.FromObject(col, dg)
sc.frame_start, sc.frame_end = 1, FR
ONLY = flags.get('only')
for g in [o for o in sc.objects if o.type == 'MESH' and o.name.startswith('Garment_') and (not ONLY or o.name == 'Garment_' + ONLY)]:
    me = g.data; co0 = np.array([v.co[:] for v in me.vertices])
    arm_mods = [(m.name, m.object) for m in g.modifiers if m.type == 'ARMATURE']
    for m in list(g.modifiers): g.modifiers.remove(m)
    # pinned: everything above the hips, and anything lying on the body (within 1.5 cm); free: the loose cloth below
    pin = g.vertex_groups.get('pin') or g.vertex_groups.new(name='pin')
    free = 0
    for v in me.vertices:
        q, n, _, d = bvh.find_nearest(v.co)
        w = 1.0 if (v.co.z > hip_z - 0.02 or (d is not None and d < 0.015)) else 0.0
        pin.add([v.index], w, 'REPLACE'); free += w == 0
    cl = g.modifiers.new('cloth', 'CLOTH'); s = cl.settings
    s.quality = 6; s.mass = 0.2; s.tension_stiffness = s.compression_stiffness = 40; s.shear_stiffness = 20; s.bending_stiffness = 2
    s.vertex_group_mass = 'pin'; s.pin_stiffness = 1.0
    cl.collision_settings.use_collision = True; cl.collision_settings.distance_min = 0.004
    cl.point_cache.frame_start, cl.point_cache.frame_end = 1, FR
    sc.frame_set(0); sc.frame_set(1)
    for f in range(2, FR + 1): sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get(); ev = g.evaluated_get(dg); m2 = ev.to_mesh()
    co1 = np.array([v.co[:] for v in m2.vertices]); ev.to_mesh_clear()
    sc.frame_set(1)
    g.modifiers.remove(g.modifiers['cloth'])
    for v, p in zip(me.vertices, co1): v.co = p
    me.update()
    for nm, ob in arm_mods: am = g.modifiers.new(nm, 'ARMATURE'); am.object = ob
    g.vertex_groups.remove(pin)
    mv = np.linalg.norm(co1 - co0, axis=1)
    print('FIG', g.name, 'free cloth', free, 'of', len(co0), 'vertices; moved mean', round(float(mv[mv > 1e-5].mean()) if (mv > 1e-5).any() else 0, 4), 'max', round(float(mv.max()), 3), flush=True)
bpy.data.objects.remove(col, do_unlink=True)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
if flags.get('vrm') == '1':
    vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
