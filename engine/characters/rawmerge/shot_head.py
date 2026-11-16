"""grey shots of a model's head and shoulders (and the whole figure): blender -b -P shot_head.py -- <in.glb> <out-prefix> <z0> <z1>"""
import bpy, sys, math, mathutils, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]; z0, z1 = float(a[2]), float(a[3])
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=a[0]); obs = [o for o in bpy.data.objects if o.type == 'MESH']
for o in obs:
    o.data.materials.clear()
    for p in o.data.polygons: p.use_smooth = False
sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'SINGLE'
sc.display.shading.single_color = (0.85, 0.86, 0.88); sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.color = (0.35, 0.38, 0.45)
sc.display.shading.show_cavity = True
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'; cam.data.clip_end = 100
def shot(name, c, size, yaw, pitch, w, h):
    sc.render.resolution_x, sc.render.resolution_y = w, h; cam.data.ortho_scale = size; y, p = math.radians(yaw), math.radians(pitch)
    d = mathutils.Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))); cam.location = c + 10 * d
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler(); sc.render.filepath = a[1] + '_' + name + '.png'; bpy.ops.render.render(write_still=True)
c = mathutils.Vector((0, 0, (z0 + z1) / 2)); s = (z1 - z0) * 1.05
for name, yaw, pitch in (('front', 0, 0), ('q', 40, 0), ('side', 90, 0), ('back', 180, 0), ('under', 25, -35)): shot(name, c, s, yaw, pitch, 560, 560)
shot('whole', mathutils.Vector((0, 0, 0.8)), 1.68, 0, 0, 560, 560)
print('SHOT done')
