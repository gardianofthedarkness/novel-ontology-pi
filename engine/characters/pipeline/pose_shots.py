"""The judge's pictures: the finished figure in its test poses, rendered headless (no viewer needed).
usage: blender -b <organs.blend|figure.blend> -P pose_shots.py -- <out-dir>
  Per pose: the head close (front and three-quarter) and the whole figure (front). The poses are check_head.py's, plus
  rest; every mesh but the hidden base body is shown, flat grey, so shape faults (spikes, tears, holes) read clearly."""
import bpy, json, math, os, sys
from mathutils import Vector
OUT = sys.argv[sys.argv.index('--') + 1]; os.makedirs(OUT, exist_ok=True)
rig = bpy.data.objects['Armature']; B = rig.data.bones
POSES = {
    'rest': {},
    'nod': {'neck': (25, 0, 0), 'head': (20, 0, 0)}, 'look_up': {'neck': (-20, 0, 0), 'head': (-25, 0, 0)},
    'turn': {'neck': (0, 35, 0), 'head': (0, 30, 0)}, 'tilt': {'neck': (0, 0, 20), 'head': (0, 0, 15)},
    'arms_down': {'shoulder.L': (0, 0, -10), 'shoulder.R': (0, 0, 10), 'upper_arm.L': (0, 0, -70), 'upper_arm.R': (0, 0, 70)},
}
if 'jaw' in B: POSES['jaw_open'] = {'jaw': (15, 0, 0)}
for o in bpy.data.objects:
    if o.type == 'MESH': o.hide_render = o.name == 'LayerBody'
sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'SINGLE'; sc.display.shading.single_color = (0.92, 0.93, 0.95)
if sc.world is None: sc.world = bpy.data.worlds.new('w')
sc.world.color = (0.35, 0.38, 0.45)
cam = bpy.data.objects.new('judge_cam', bpy.data.cameras.new('judge_cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'
hz = (rig.matrix_world @ B['head'].head_local).z; feet = 0.0; top = max((o.matrix_world @ Vector(c)).z for o in bpy.data.objects if o.type == 'MESH' for c in o.bound_box)
hx = (rig.matrix_world @ B['head'].head_local).x
def shot(path, centre, size, ang, w, h):
    sc.render.resolution_x, sc.render.resolution_y = w, h; cam.data.ortho_scale = size
    r = math.radians(ang); cam.location = centre + Vector((3 * math.sin(r), -3 * math.cos(r), 0))
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)
files = {}
for name, rots in POSES.items():
    for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0)
    for bn, (x, y, z) in rots.items():
        if bn in rig.pose.bones: rig.pose.bones[bn].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    bpy.context.view_layer.update()
    hc = Vector((hx, 0, (hz + top) / 2 - 0.02)); hs = (top - hz) * 1.9
    files[name] = {}
    for view, ang in (('head', 0), ('head_q', 35)):
        p = os.path.join(OUT, '%s_%s.png' % (name, view)); shot(p, hc, hs, ang, 448, 512); files[name][view] = p
    p = os.path.join(OUT, '%s_body.png' % name); shot(p, Vector((hx, 0, top / 2)), top * 1.08, 0, 384, 640); files[name]['body'] = p
for pb in rig.pose.bones: pb.rotation_euler = (0, 0, 0)
json.dump(files, open(os.path.join(OUT, 'shots.json'), 'w'), indent=1); print('FIG shots', len(files), 'poses')
