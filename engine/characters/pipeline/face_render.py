"""Render the Head mesh for the face detectors (v0.7 step 4): grey, cavity-shaded, orthographic, front and turned views.
usage: blender -b <figure.blend> -P face_render.py -- <out-dir> [--angles=0,-30,30] [--size=1024]
  Writes view_<angle>.png and views.json (each view's centre, turn, scale and size), from which face_rig.py casts each
  detected point back onto the mesh. Only the head above the neck seam is rendered, filling the frame."""
import bpy, json, math, os, sys
from mathutils import Matrix, Vector
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
OUT = [a for a in argv if not a.startswith('--')][0]; os.makedirs(OUT, exist_ok=True)
ANGLES = [float(a) for a in flags.get('angles', '0,-30,30').split(',')]; SIZE = int(flags.get('size', 1024))
sc = bpy.context.scene; head = bpy.data.objects['Head']
for o in sc.objects:
    if o.type == 'MESH': o.hide_render = o != head
P = [head.matrix_world @ v.co for v in head.data.vertices]
lo = Vector([min(p[i] for p in P) for i in range(3)]); hi = Vector([max(p[i] for p in P) for i in range(3)])
centre = (lo + hi) / 2; scale = max(hi.x - lo.x, hi.z - lo.z, hi.y - lo.y) * 1.08
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light = 'STUDIO'; sh.color_type = 'SINGLE'; sh.single_color = (0.8, 0.8, 0.8)
sh.show_cavity = True; sh.cavity_type = 'BOTH'; sh.cavity_ridge_factor = 1.5; sh.cavity_valley_factor = 1.5
sh.show_shadows = True; sh.shadow_intensity = 0.4
sc.render.resolution_x = sc.render.resolution_y = SIZE; sc.render.film_transparent = False
sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.color = (1, 1, 1)
cam_data = bpy.data.cameras.new('facecam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = scale
cam = bpy.data.objects.new('facecam', cam_data); sc.collection.objects.link(cam); sc.camera = cam
views = []
for a in ANGLES:
    R = Matrix.Rotation(math.radians(a), 4, 'Z')
    back = (R @ Vector((0, -1, 0))).normalized()          # the figure faces -Y; the camera stands in front
    cam.location = centre + back * (scale * 3)
    cam.rotation_euler = (math.radians(90), 0, math.radians(a))
    path = os.path.join(OUT, 'view_%d.png' % a); sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    views.append({'angle': a, 'file': path, 'centre': list(centre), 'scale': scale, 'size': SIZE, 'distance': scale * 3})
json.dump({'views': views, 'bounds': [list(lo), list(hi)]}, open(os.path.join(OUT, 'views.json'), 'w'), indent=1)
print('FIG rendered', [v['file'] for v in views])
