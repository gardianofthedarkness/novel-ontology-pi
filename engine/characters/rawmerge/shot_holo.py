"""A plain model drawn as the triangle hologram (every triangle edge lit on a dark shell), from a few sides, whole and head:
blender -b -P shot_holo.py -- <model.glb> <out-prefix>"""
import bpy, sys, math, mathutils
a = sys.argv[sys.argv.index("--") + 1:]
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=a[0]); obs = [o for o in bpy.data.objects if o.type == "MESH"]
m = bpy.data.materials.new("holo"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial"); e = nt.nodes.new("ShaderNodeEmission"); w = nt.nodes.new("ShaderNodeWireframe"); mix = nt.nodes.new("ShaderNodeMixRGB")
w.use_pixel_size = True; w.inputs[0].default_value = 1.0          # one pixel: the line a screen draws
mix.inputs[1].default_value = (0.012, 0.03, 0.06, 1); mix.inputs[2].default_value = (0.35, 0.85, 1.0, 1)
nt.links.new(w.outputs[0], mix.inputs[0]); nt.links.new(mix.outputs[0], e.inputs[0]); nt.links.new(e.outputs[0], out.inputs[0])
lo = [min((o.matrix_world @ mathutils.Vector(c))[k] for o in obs for c in o.bound_box) for k in range(3)]; hi = [max((o.matrix_world @ mathutils.Vector(c))[k] for o in obs for c in o.bound_box) for k in range(3)]
for o in obs:
    o.data.materials.clear(); o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = False
sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.samples = 8; sc.cycles.use_denoising = False; sc.world = sc.world or bpy.data.worlds.new("w"); sc.world.use_nodes = False; sc.world.color = (0.01, 0.02, 0.04)
sc.view_settings.view_transform = "Standard"
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"; cam.data.clip_end = 100
H = hi[2] - lo[2]; sc.render.resolution_x = 560; sc.render.resolution_y = 760
for tag, z0, z1 in (("whole", lo[2], hi[2]), ("head", hi[2] - H * 0.26, hi[2])):
    c = mathutils.Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (z0 + z1) / 2)); cam.data.ortho_scale = (z1 - z0) * 1.05
    for name, yaw in (("front", 0), ("q", 40), ("side", 90), ("back", 180)):
        y = math.radians(yaw); d = mathutils.Vector((math.sin(y), -math.cos(y), 0)); cam.location = c + 10 * d
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler(); sc.render.filepath = a[1] + "_" + tag + "_" + name + ".png"; bpy.ops.render.render(write_still=True)
print("SHOT done")
