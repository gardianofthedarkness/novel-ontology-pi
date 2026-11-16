"""Renders for 3D landmarks: a head and shoulders seen from several angles, the body framed as the bust frames itself.
usage: blender -b [<holo.blend>] -P render.py -- <out-dir> --mode=bust --bust=<bust.glb>
       blender -b <holo.blend> -P render.py -- <out-dir> --mode=body --bust-marks=<bust.json>
  bust: the whole bust (it is a head and shoulders by construction: the portrait it was shaped from ends at the shoulders).
  body: the same part of the body. How far below the shoulders the bust reaches, as a share of its shoulder-to-crown
  height, is measured on the bust's own landmarks (RTMW's shoulders, triangulated: landmarks.py on the bust first); the
  body's render reaches the same share below its own shoulders (the rig's upper-arm joints) under its crown (the highest
  point the rig weights mostly to the head). The body's middle and depth come from the points weighted to the head.
  STRUCTURAL: views (turns of -60, -30, 0, 30, 60 degrees, and the front from 20 degrees above and below), 768 px square,
  orthographic, a frame padded by PAD on each side (the detector needs a figure that does not touch the frame's edge),
  flat grey Workbench shading on white. Writes view_<k>.png and cams.json."""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
OUT = [a for a in argv if not a.startswith('--')][0]; os.makedirs(OUT, exist_ok=True)
PAD = 0.04                        # STRUCTURAL: the frame's margin on each side, a share of the frame
VIEWS = [(-60, 0), (-30, 0), (0, 0), (30, 0), (60, 0), (0, 20), (0, -20)]   # STRUCTURAL
PX = 768                          # STRUCTURAL
sc = bpy.context.scene
def points(obs): return np.concatenate([np.array([(o.matrix_world @ v.co)[:] for v in o.data.vertices]) for o in obs])
if flags['mode'] == 'bust':
    for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=flags['bust'])
    obs = [o for o in sc.objects if o.type == 'MESH']; P = points(obs)
    lo, hi = P.min(0), P.max(0); c = Vector(((lo + hi) / 2).tolist()); size = float(max(hi[0] - lo[0], hi[2] - lo[2]))
else:
    rig = bpy.data.objects['Armature']; B = rig.data.bones
    obs = [o for o in sc.objects if o.type == 'MESH' and o.name != 'LayerBody']
    for o in sc.objects:
        if o.type == 'MESH' and o not in obs: o.hide_render = True
    body = bpy.data.objects.get('Body') or obs[0]
    names = {g.index: g.name for g in body.vertex_groups}
    dom = [names[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in body.data.vertices]
    Pb = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices]); headpts = Pb[np.array(dom) == 'head']
    z1 = float(headpts[:, 2].max())
    zs = float(np.mean([(rig.matrix_world @ B[n].head_local).z for n in ('upper_arm.L', 'upper_arm.R')]))
    # the bust's reach under its shoulders, as a share of its shoulder-to-crown height (its own landmarks and bounds)
    bm = json.load(open(flags['bust-marks'])); bp = bm['points']
    b_sh = float(np.mean([bp[k]['p'][2] for k in ('5', '6') if k in bp])); b_lo, b_hi = bm['bounds']
    reach = (b_sh - b_lo[2]) / (b_hi[2] - b_sh)
    z0 = zs - reach * (z1 - zs)
    hx = (rig.matrix_world @ B['head'].head_local).x
    c = Vector((hx, float((headpts[:, 1].min() + headpts[:, 1].max()) / 2), (z0 + z1) / 2)); size = z1 - z0
    print('FIG body framed from z %.3f to %.3f: the bust reaches %.2f of its shoulder-to-crown height under its shoulders' % (z0, z1, reach))
size *= 1 + 2 * PAD
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'SINGLE'
sc.display.shading.single_color = (0.85, 0.85, 0.87); sc.render.resolution_x = sc.render.resolution_y = PX
if sc.world is None: sc.world = bpy.data.worlds.new('w')
sc.world.color = (1, 1, 1); sc.render.film_transparent = False
cam = bpy.data.objects.new('m3cam', bpy.data.cameras.new('m3cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size
span = float(np.linalg.norm(P.max(0) - P.min(0))) if flags['mode'] == 'bust' else float(np.linalg.norm(Pb.max(0) - Pb.min(0)))
cam.data.clip_end = 4 * span
cams = []
for k, (yaw, pitch) in enumerate(VIEWS):
    y, p = math.radians(yaw), math.radians(pitch); d = 2 * span            # outside the model whatever its size
    dirv = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))   # from the centre toward the camera
    cam.location = c + d * dirv; cam.rotation_euler = (-dirv).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    f = os.path.join(OUT, 'view_%d.png' % k); sc.render.filepath = f; bpy.ops.render.render(write_still=True)
    M = cam.matrix_world
    cams.append({'file': f, 'yaw': yaw, 'pitch': pitch, 'loc': list(M.translation), 'right': list(M.col[0][:3]),
                 'up': list(M.col[1][:3]), 'back': list(M.col[2][:3]), 'width_m': size, 'px': PX})
bounds = [P.min(0).tolist(), P.max(0).tolist()] if flags['mode'] == 'bust' else None
json.dump({'mode': flags['mode'], 'centre': list(c), 'size': size, 'cams': cams, 'bounds': bounds}, open(os.path.join(OUT, 'cams.json'), 'w'), indent=1)
print('FIG marks renders', len(cams))
