"""Render a rigged figure as a triangle hologram (every triangle edge glowing, a faint fresnel shell, scanlines).
usage: blender -b -P holo_render.py -- <figure.blend> <out.png> [--mesh=Outfit_summer] [--pose=rest|walk|wave|point] [--angles=0,40,90,180]"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
SRC, OUT = [a for a in argv if not a.startswith('--')][:2]
POSE = flags.get('pose', 'rest'); ANG = [int(a) for a in flags.get('angles', '0,40,90,180').split(',')]
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']
show = flags.get('mesh')
meshes = [o for o in sc.objects if o.type == 'MESH']
for o in meshes:
    shown = show.split(',') if show else []
    o.hide_render = bool(show) and not (o.name == 'Head' or o.name in shown or o.name == 'Body')

def wire_mat():
    m = bpy.data.materials.new('wire'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (0.35, 0.85, 1.0, 1); e.inputs['Strength'].default_value = 2.2
    nt.links.new(e.outputs[0], o.inputs[0]); return m
def shell_mat():
    m = bpy.data.materials.new('shell'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.35
    tex = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tex.outputs['Object'], sep.inputs[0])
    mz = nt.nodes.new('ShaderNodeMath'); mz.operation = 'MULTIPLY'; mz.inputs[1].default_value = 300; nt.links.new(sep.outputs['Z'], mz.inputs[0])
    sn = nt.nodes.new('ShaderNodeMath'); sn.operation = 'SINE'; nt.links.new(mz.outputs[0], sn.inputs[0])
    sl = nt.nodes.new('ShaderNodeMapRange'); sl.inputs['From Min'].default_value = -1; sl.inputs['To Min'].default_value = 0.55; sl.inputs['To Max'].default_value = 1.0
    nt.links.new(sn.outputs[0], sl.inputs['Value'])
    f = nt.nodes.new('ShaderNodeMath'); f.operation = 'MULTIPLY'; nt.links.new(lw.outputs['Facing'], f.inputs[0]); nt.links.new(sl.outputs[0], f.inputs[1])
    f2 = nt.nodes.new('ShaderNodeMath'); f2.operation = 'MULTIPLY'; f2.inputs[1].default_value = 0.55; nt.links.new(f.outputs[0], f2.inputs[0])
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (0.1, 0.45, 0.9, 1); e.inputs['Strength'].default_value = 1.0
    dark = nt.nodes.new('ShaderNodeEmission'); dark.inputs['Color'].default_value = (0.01, 0.03, 0.06, 1); dark.inputs['Strength'].default_value = 1.0
    tr = dark; mx = nt.nodes.new('ShaderNodeMixShader')   # an opaque dark body hides the back triangles
    nt.links.new(f2.outputs[0], mx.inputs[0]); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(e.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], o.inputs[0])
    try: m.surface_render_method = 'BLENDED'
    except Exception: pass
    return m
W, S = wire_mat(), shell_mat()
for o in meshes:
    o.data.materials.clear(); o.data.materials.append(S); o.data.materials.append(W)
    for p in o.data.polygons: p.material_index = 0
    wf = o.modifiers.new('wire', 'WIREFRAME'); wf.thickness = float(flags.get('wire', 0.0011)); wf.use_replace = False
    wf.material_offset = 1; wf.use_even_offset = False; wf.use_relative_offset = False

# poses as turns about world axes (the figure faces -Y): parents first, so children ride along
for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()
def turn(n, axis, deg):
    pb = rig.pose.bones[n]; head = pb.matrix.to_translation()
    pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()
def side(n): return 1 if rig.pose.bones[n].bone.head_local.x > 0 else -1
def forward(n, deg): turn(n, 'X', -deg)                 # swing a limb toward the front
def out(n, deg): turn(n, 'Y', -side(n) * deg)           # raise a limb out to its own side
if POSE == 'walk':
    forward('upper_leg.L', 25); forward('lower_leg.L', -8); forward('upper_leg.R', -20); forward('lower_leg.R', -35)
    forward('upper_arm.L', -20); forward('upper_arm.R', 20); out('upper_arm.L', 8); out('upper_arm.R', 8)
elif POSE == 'wave':
    out('upper_arm.R', 80); out('lower_arm.R', 75); out('upper_arm.L', 10); turn('head', 'Y', 6)
elif POSE == 'point':     # her coin-flick: right arm straight out at the target
    turn('chest', 'Z', 15 * -side('upper_arm.R')); forward('upper_arm.R', 85); out('upper_arm.R', 8)
    out('upper_arm.L', 20); forward('upper_leg.R', 12); forward('upper_leg.L', -6)
elif POSE == 'bend':      # deep joint bends: a lunge with one knee at 100 degrees, both elbows at 100 degrees
    forward('upper_leg.L', 65); forward('lower_leg.L', -100); forward('upper_leg.R', -25); forward('lower_leg.R', -30)
    out('upper_arm.L', -70); out('upper_arm.R', -70); forward('lower_arm.L', 100); forward('lower_arm.R', 100)
print('FIG right arm on side', side('upper_arm.R'))

sc.render.engine = 'BLENDER_EEVEE'; sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.008, 0.018, 1)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = float(flags.get('scale', 1.8)); sc.render.resolution_x, sc.render.resolution_y = (700, 700) if 'scale' in flags else (600, 900)
# a soft glow around the lines (compositor glare)
try:
    tree = bpy.data.node_groups.new('glow', 'CompositorNodeTree'); sc.compositing_node_group = tree
    for n in list(tree.nodes): tree.nodes.remove(n)
    rl = tree.nodes.new('CompositorNodeRLayers'); gl = tree.nodes.new('CompositorNodeGlare'); co = tree.nodes.new('CompositorNodeComposite')
    try: gl.glare_type = 'FOG_GLOW'; gl.size = 6; gl.mix = -0.6
    except Exception: pass
    tree.links.new(rl.outputs['Image'], gl.inputs['Image']); tree.links.new(gl.outputs['Image'], co.inputs['Image'])
except Exception as e: print('FIG no glare', e)
tiles = []
for ang in ANG:
    a = math.radians(ang); t = Vector((0, 0, float(flags.get('target', 0.8)))); cam.location = t + Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.3))
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    f = OUT.replace('.png', f'_{ang}.png'); sc.render.filepath = f; bpy.ops.render.render(write_still=True); tiles.append(f)
imgs = [bpy.data.images.load(f) for f in tiles]; w, h = imgs[0].size
arr = np.concatenate([np.array(im.pixels[:], np.float32).reshape(h, w, 4) for im in imgs], axis=1)
res = bpy.data.images.new('sheet', arr.shape[1], h); res.pixels.foreach_set(arr.ravel()); res.filepath_raw = OUT; res.file_format = 'PNG'; res.save()
for f in tiles: os.remove(f)
print('FIG rendered', OUT)
