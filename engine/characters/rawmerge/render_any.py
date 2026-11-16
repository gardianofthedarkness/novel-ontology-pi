"""Renders of a raw model for 3D landmarks, with no rig: blender -b -P render_any.py -- <in.glb> <out-dir> [--norm=<out.glb>] [--frame=cx,cy,cz,size]
  --norm   the model stood as the pipeline stands a body (1.6 m tall, feet on the ground, centred) and saved so
  --frame  the square to render (centre and side); without it, the whole model
  Same views, size, margin and shading as marks/render.py."""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index('--') + 1:]; flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
SRC, OUT = [a for a in argv if not a.startswith('--')][:2]; os.makedirs(OUT, exist_ok=True)
PAD = 0.04; VIEWS = [(-60, 0), (-30, 0), (0, 0), (30, 0), (60, 0), (0, 20), (0, -20)]; PX = 768      # STRUCTURAL, as marks/render.py
sc = bpy.context.scene
for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ms = [o for o in sc.objects if o.type == 'MESH']
with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
    if len(ms) > 1: bpy.ops.object.join()
ob = ms[0]
for o in [o for o in sc.objects if o != ob]: bpy.data.objects.remove(o, do_unlink=True)
ob.parent = None
with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], object=ob):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
def co(): c = np.empty(len(ob.data.vertices) * 3); ob.data.vertices.foreach_get('co', c); return c.reshape(-1, 3)
P = co()
if 'norm' in flags:
    lo, hi = P.min(0), P.max(0); s = 1.6 / (hi[2] - lo[2])
    ob.data.transform(Matrix.Translation((-(lo[0] + hi[0]) / 2 * s, -(lo[1] + hi[1]) / 2 * s, -lo[2] * s)) @ Matrix.Scale(s, 4)); P = co()
    ob.data.materials.clear(); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=flags['norm'], use_selection=True, export_materials='NONE', export_animations=False, export_skins=False)
lo, hi = P.min(0), P.max(0)
if 'frame' in flags: cx, cy, cz, size = map(float, flags['frame'].split(',')); c = Vector((cx, cy, cz))
else: c = Vector(((lo + hi) / 2).tolist()); size = float(max(hi[0] - lo[0], hi[2] - lo[2]))
size *= 1 + 2 * PAD
ob.data.materials.clear()
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'SINGLE'
sc.display.shading.single_color = (0.85, 0.85, 0.87); sc.render.resolution_x = sc.render.resolution_y = PX
if sc.world is None: sc.world = bpy.data.worlds.new('w')
sc.world.color = (1, 1, 1); sc.render.film_transparent = False
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size; span = float(np.linalg.norm(hi - lo)); cam.data.clip_end = 4 * span
cams = []
for k, (yaw, pitch) in enumerate(VIEWS):
    y, p = math.radians(yaw), math.radians(pitch); dirv = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.location = c + 2 * span * dirv; cam.rotation_euler = (-dirv).to_track_quat('-Z', 'Y').to_euler(); bpy.context.view_layer.update()
    f = os.path.join(OUT, 'view_%d.png' % k); sc.render.filepath = f; bpy.ops.render.render(write_still=True); M = cam.matrix_world
    cams.append({'file': f, 'yaw': yaw, 'pitch': pitch, 'loc': list(M.translation), 'right': list(M.col[0][:3]), 'up': list(M.col[1][:3]), 'back': list(M.col[2][:3]), 'width_m': size, 'px': PX})
json.dump({'centre': list(c), 'size': size, 'cams': cams, 'bounds': [lo.tolist(), hi.tolist()]}, open(os.path.join(OUT, 'cams.json'), 'w'), indent=1)
print('FIG raw renders', len(cams))
