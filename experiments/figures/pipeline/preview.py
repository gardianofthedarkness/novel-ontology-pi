"""Preview any character mesh the same way: import (glb/obj/ply), stand it up at 1.6 m, flat toon look with an ink
outline, render front / three-quarter / side / back into one sheet.
usage: blender -b -P preview.py -- <mesh> <out.png> [--hologram] [--keep-colours] [--rot-x=90]"""
import bpy, math, os, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
HOLO = '--hologram' in argv; KEEP = '--keep-colours' in argv
rotx = next((float(a.split('=')[1]) for a in argv if a.startswith('--rot-x=')), 0.0)
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(src)[1].lower()
if ext in ('.glb', '.gltf', '.vrm'):
    bpy.ops.import_scene.gltf(filepath=src)
elif ext == '.obj':
    bpy.ops.wm.obj_import(filepath=src)
elif ext == '.ply':
    bpy.ops.wm.ply_import(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if rotx:
    for o in meshes: o.rotation_euler.x += math.radians(rotx)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
# bounds -> stand on the floor, 1.6 m tall, centred
pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
s = 1.6 / (hi.z - lo.z)
for o in meshes:
    o.location = (o.location - Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))) * s
    o.scale *= s
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w'); sc.world = world
bg = (0.02, 0.03, 0.06, 1) if HOLO else (0.93, 0.94, 0.96, 1)
world.color = bg[:3]
def toon(name, colour):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    if HOLO:
        # fresnel glow + faint body: emission mixed with transparency
        lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.35
        em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (0.35, 0.8, 1.0, 1); em.inputs['Strength'].default_value = 2.2
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0.18, 0.18, 0.18, 1)
        ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
        nt.links.new(lw.outputs['Facing'], ramp.inputs[0])
        mix = nt.nodes.new('ShaderNodeMixShader'); nt.links.new(ramp.outputs[0], mix.inputs[0])
        nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], o.inputs[0])
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
        return m
    d = nt.nodes.new('ShaderNodeBsdfDiffuse'); d.inputs['Color'].default_value = colour
    s2r = nt.nodes.new('ShaderNodeShaderToRGB'); nt.links.new(d.outputs[0], s2r.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].color = (0.62, 0.62, 0.66, 1); ramp.color_ramp.elements[1].position = 0.25; ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(s2r.outputs[0], ramp.inputs[0])
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
    nt.links.new(ramp.outputs[0], mul.inputs[6]); mul.inputs[7].default_value = colour
    em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(mul.outputs[2], em.inputs[0]); nt.links.new(em.outputs[0], o.inputs[0])
    return m
def ink():
    m = bpy.data.materials.new('ink'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (0.5, 0.95, 1.0, 1) if HOLO else (0.08, 0.06, 0.06, 1); e.inputs['Strength'].default_value = 3 if HOLO else 1
    nt.links.new(e.outputs[0], o.inputs[0]); m.use_backface_culling = True; return m
INK = ink()
for o in meshes:
    if not (KEEP and not HOLO):
        o.data.materials.clear(); o.data.materials.append(toon('t_' + o.name, (0.86, 0.86, 0.9, 1)))
    else:
        # keep base colours but drive them through the toon ramp
        for i, slot in enumerate(o.material_slots):
            base = (0.86, 0.86, 0.9, 1)
            mat = slot.material
            if mat and mat.use_nodes:
                b = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                if b and not b.inputs['Base Color'].is_linked: base = tuple(b.inputs['Base Color'].default_value)
            slot.material = toon(f't_{o.name}_{i}', base)
    o.data.materials.append(INK)
    sol = o.modifiers.new('outline', 'SOLIDIFY'); sol.thickness = -0.004 if not HOLO else -0.003
    sol.use_flip_normals = True; sol.material_offset = len(o.data.materials) - 1; sol.offset = 1
    for p in o.data.polygons: p.use_smooth = True
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 4.0; sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.75
sc.render.resolution_x, sc.render.resolution_y = 600, 900
sc.render.film_transparent = False
tiles = []
for name, ang in (('front', 0), ('three_quarter', 40), ('side', 90), ('back', 180)):
    a = math.radians(ang); target = Vector((0, 0, 0.8))
    cam.location = target + Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.25))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    f = out.replace('.png', f'_{name}.png'); sc.render.filepath = f; bpy.ops.render.render(write_still=True); tiles.append(f)
# one sheet
import numpy as np
imgs = [bpy.data.images.load(f) for f in tiles]
w, h = imgs[0].size
sheet = np.zeros((h, w * len(imgs), 4), dtype=np.float32)
for i, im in enumerate(imgs):
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4); sheet[:, i * w:(i + 1) * w] = px
res = bpy.data.images.new('sheet', w * len(imgs), h); res.pixels.foreach_set(sheet.ravel())
res.filepath_raw = out; res.file_format = 'PNG'; res.save()
for f in tiles: os.remove(f)
print('PREVIEW', out)
