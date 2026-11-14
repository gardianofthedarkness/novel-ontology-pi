"""One character, one skeleton, one head; outfits as swappable meshes.
usage: blender -b -P compose_outfits.py -- <out-dir> <name> <base.blend> <outfit-name>=<outfit.blend> ... [--views=<view-dir>;<view-dir>;...]
  - base.blend (from dress_rig.py) gives the skeleton and the head (everything above the neck)
  - every outfit .blend gives the body below the neck; its skeleton is fitted onto the base skeleton
    (least squares per axis over matching bone heads), its weights are kept (same bone names), and it is
    re-bound to the base skeleton
  - colours: every block colour is replaced by the median of that colour over all reference views (the nearest
    palette colour of each view, if close), so the head's hair/skin and the shared clothes agree across pictures
  - exports <name>.vrm with meshes Head, Outfit_<outfit> (the page shows one outfit at a time), renders a sheet per outfit"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
pos = [a for a in argv if not a.startswith('--')]
OUT, NAME, BASE = pos[0], pos[1], pos[2]
OUTFITS = [p.split('=', 1) for p in pos[3:]]
os.makedirs(OUT, exist_ok=True)
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=BASE)
sc = bpy.context.scene
rig = bpy.data.objects['Armature']; body = bpy.data.objects['Body']
for o in list(sc.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o, do_unlink=True)
cut_z = rig.data.bones['head'].head_local.z + 0.005          # the neck: everything above is the shared head
print('FIG neck cut at', round(cut_z, 3))

def split(ob, keep_above):
    """delete the faces on the other side of the neck cut"""
    me = ob.data; import bmesh
    bm = bmesh.new(); bm.from_mesh(me)
    kill = [f for f in bm.faces if ((sum(v.co.z for v in f.verts) / len(f.verts)) > cut_z) != keep_above]
    bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(me); bm.free(); me.update()

# the base body becomes the Head (above the neck) and the first outfit (below)
first_name = OUTFITS[0][0] if OUTFITS and OUTFITS[0][1] == BASE else None
head = body.copy(); head.data = body.data.copy(); sc.collection.objects.link(head)
head.name = head.data.name = 'Head'; split(head, True)
meshes = {'Head': head}
if first_name:
    body.name = body.data.name = f'Outfit_{first_name}'; split(body, False); meshes[body.name] = body
else:
    bpy.data.objects.remove(body, do_unlink=True)

base_heads = {b.name: b.head_local.copy() for b in rig.data.bones}
for oname, path in OUTFITS:
    if path == BASE: continue
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = [n for n in src.objects if n in ('Body', 'Armature')]
    ob, orig = [o for o in dst.objects if o.name.startswith('Body')][0], [o for o in dst.objects if o.name.startswith('Armature')][0]
    sc.collection.objects.link(ob)
    # fit the outfit's skeleton onto the base skeleton: x' = a*x + b per axis, least squares over shared bones
    names = [n for n in base_heads if n in orig.data.bones]
    src_p = np.array([orig.data.bones[n].head_local[:] for n in names]); dst_p = np.array([base_heads[n][:] for n in names])
    S, T = [], []
    for k in range(3):
        A = np.stack([src_p[:, k], np.ones(len(names))], 1); (a, b), *_ = np.linalg.lstsq(A, dst_p[:, k], rcond=None); S.append(a); T.append(b)
    print('FIG fit', oname, 'scale', np.round(S, 3), 'shift', np.round(T, 3),
          'residual', round(float(np.abs(src_p * S + T - dst_p).max()), 3))
    ob.parent = None; ob.matrix_world = Matrix.Identity(4)
    ob.data.transform(Matrix.Translation(Vector(T)) @ Matrix.Diagonal((*S, 1)))
    for m in list(ob.modifiers): ob.modifiers.remove(m)
    ob.parent = rig; mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
    split(ob, False)
    ob.name = ob.data.name = f'Outfit_{oname}'; meshes[ob.name] = ob
    bpy.data.objects.remove(orig, do_unlink=True)

# 鈹€鈹€ colours averaged over the reference views 鈹€鈹€
def rgb(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)
def lin(c): c = c / 255; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def unlin(l): return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055) * 255
views = [json.load(open(os.path.join(v, 'view.json'))) for v in flags.get('views', '').split(';') if v]
pool = [[rgb(c) for c in v['palette']] for v in views]
changed = 0
for mat in bpy.data.materials:
    m = mat.vrm_addon_extension.mtoon1
    if not m.enabled: continue
    c = unlin(np.array(m.pbr_metallic_roughness.base_color_factor[:3]))
    votes = [c]
    for pal in pool:
        d = [np.linalg.norm(p - c) for p in pal]; j = int(np.argmin(d))
        if d[j] < 20: votes.append(pal[j])
    new = np.median(np.array(votes), 0); l = lin(new)
    m.pbr_metallic_roughness.base_color_factor = (*l, 1); mat.diffuse_color = (*l, 1)
    m.extensions.vrmc_materials_mtoon.shade_color_factor = tuple(l * 0.62)
    changed += int(np.linalg.norm(new - c) > 3)
print('FIG colours averaged over', len(views), 'views;', changed, 'blocks moved')

# 鈹€鈹€ export 鈹€鈹€
meta = rig.data.vrm_addon_extension.vrm1.meta; meta.vrm_name = f'{NAME} (prototype figure, swappable outfits)'
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm = os.path.join(OUT, f'{NAME}.vrm')
print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm), 'meshes', sorted(meshes))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{NAME}.blend'))

# 鈹€鈹€ a quick sheet per outfit (front, three-quarter, side, back), MToon colours under a flat light 鈹€鈹€
sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
sh.light = 'FLAT'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'WORLD'; sh.show_object_outline = True
sc.view_settings.view_transform = 'Standard'
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.8; sc.render.resolution_x, sc.render.resolution_y = 560, 900
for oname, _ in OUTFITS:
    for n, o in meshes.items(): o.hide_render = not (n == 'Head' or n == f'Outfit_{oname}')
    tiles = []
    for ang in (0, 40, 90, 180):
        a = math.radians(ang); t = Vector((0, 0, 0.8)); cam.location = t + Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.3))
        cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
        f = os.path.join(OUT, f'_{oname}_{ang}.png'); sc.render.filepath = f; bpy.ops.render.render(write_still=True); tiles.append(f)
    imgs = [bpy.data.images.load(f) for f in tiles]; w, h = imgs[0].size
    arr = np.concatenate([np.array(im.pixels[:], np.float32).reshape(h, w, 4) for im in imgs], axis=1)
    res = bpy.data.images.new('sheet', arr.shape[1], h); res.pixels.foreach_set(arr.ravel())
    res.filepath_raw = os.path.join(OUT, f'outfit_{oname}.png'); res.file_format = 'PNG'; res.save()
    for f in tiles: os.remove(f)
print('FIG done')
