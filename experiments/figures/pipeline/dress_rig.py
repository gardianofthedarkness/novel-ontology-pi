"""Turn a generated character mesh into a rigged, flat-coloured VRM, using the clean front view it was made from.
usage: blender -b -P dress_rig.py -- <mesh.glb> <view-dir (view.json, labels.png)> <out-dir> [--back=<back-view-dir>] [--name=X]
  1. clean: voxel remesh + smooth (the generator's speckle), ~40k faces, stood at 1.6 m facing -Y
  2. colour: each vertex takes the flat colour block the front view shows at its place (back-facing head -> hair);
     labels smoothed over the surface, one toon material per block
  3. rig: VRM humanoid bones from the 2D joints (RTMPose) lifted to 3D through the mesh; bone-heat weights
  4. export VRM 1.0 (MToon, outlines) and render toon + hologram sheets, rest pose and a walk pose"""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, VIEW, OUT = argv[0], argv[1], argv[2]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--') and '=' in a)
NAME = flags.get('name', 'figure'); H = 1.6
os.makedirs(OUT, exist_ok=True)
view = json.load(open(os.path.join(VIEW, 'view.json')))
bpy.ops.wm.read_factory_settings(use_empty=True)
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
sc = bpy.context.scene; COLL = sc.collection

# 鈹€鈹€ 1. import and clean 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
bpy.ops.import_scene.gltf(filepath=SRC)
ms = [o for o in sc.objects if o.type == 'MESH']
with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
    if len(ms) > 1: bpy.ops.object.join()
ob = ms[0]
for o in list(sc.objects):
    if o != ob: bpy.data.objects.remove(o, do_unlink=True)
ob.parent = None
with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], object=ob):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
co = np.array([v.co[:] for v in ob.data.vertices])
lo, hi = co.min(0), co.max(0); s = H / (hi[2] - lo[2])
ob.data.transform(Matrix.Translation((-(lo[0] + hi[0]) / 2 * s, -(lo[1] + hi[1]) / 2 * s, -lo[2] * s)) @ Matrix.Scale(s, 4))
rm = ob.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.0045; rm.use_smooth_shade = True
cs = ob.modifiers.new('cs', 'CORRECTIVE_SMOOTH'); cs.iterations = 8; cs.smooth_type = 'SIMPLE'; cs.use_only_smooth = True; cs.factor = 0.6
dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
dc = ob.modifiers.new('dc', 'DECIMATE'); dc.ratio = min(1.0, 45000 / max(1, len(me.polygons)))
dg = bpy.context.evaluated_depsgraph_get(); me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
ob.modifiers.clear(); ob.data = me2; bpy.data.meshes.remove(me); me = me2
for p in me.polygons: p.use_smooth = True
ob.name = 'Body'; me.name = 'Body'
co = np.array([v.co[:] for v in me.vertices]); lo, hi = co.min(0), co.max(0)
print('FIG mesh', len(me.vertices), 'verts', len(me.polygons), 'faces, bounds', lo.round(3), hi.round(3))

# 鈹€鈹€ image <-> mesh mapping (the view's figure box onto the mesh's front box) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
bx0, by0, bx1, by1 = view['bbox']
def to_mesh(px, py):  # image pixel -> (x, z) on the mesh
    return lo[0] + (px - bx0) / (bx1 - bx0) * (hi[0] - lo[0]), (by1 - py) / (by1 - by0) * H
def to_img(x, z):
    return bx0 + (x - lo[0]) / (hi[0] - lo[0]) * (bx1 - bx0), by1 - z / H * (by1 - by0)
def read_gray(path):  # an 8-bit grey PNG as a top-down array (Blender stores rows bottom-up)
    im = bpy.data.images.load(path); im.colorspace_settings.name = 'Non-Color'
    w, h = im.size; a = np.array(im.pixels[:], np.float32).reshape(h, w, im.channels)[::-1, :, 0]
    return np.round(a * 255).astype(np.int32)
labels = np.load(os.path.join(VIEW, 'labels.npy')).astype(np.int32)
LH, LW = labels.shape
palette = view['palette']; HAIR, SKIN = view['hair'], view['skin']
J = {k: to_mesh(v[0], v[1]) for k, v in view['joints'].items()}
neck_z = (J['l_sho'][1] + J['r_sho'][1]) / 2 + 0.25 * (J['nose'][1] - (J['l_sho'][1] + J['r_sho'][1]) / 2)

# 鈹€鈹€ 2. colour blocks by projection 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
me.calc_loop_triangles()
vn = np.array([v.normal[:] for v in me.vertices]); co = np.array([v.co[:] for v in me.vertices])
px, py = to_img(co[:, 0], co[:, 2])
pxi = np.clip(px.round().astype(int), 0, LW - 1); pyi = np.clip(py.round().astype(int), 0, LH - 1)
lab = labels[pyi, pxi].astype(np.int32)
back = vn[:, 1] > 0.25
# what the front camera actually sees: a ray from the front must reach this vertex first
bvh0 = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
seen = np.zeros(len(co), bool)
for i, (x, y, z) in enumerate(co):
    if vn[i, 1] > 0.15: continue                       # facing away or edge-on
    hit = bvh0.ray_cast(Vector((x, -5.0, z)), Vector((0, 1, 0)))
    seen[i] = bool(hit[0]) and abs(hit[0].y - y) < 0.006
# the back of the head is hair, whatever the front shows there (face, eyes)
known = seen.copy()
headback = back & (co[:, 2] > neck_z)
lab[headback] = HAIR; known |= headback
# below the head, clothes are front-back alike: the back takes the front view's colour at the same place
known |= back & ~headback
print('FIG seen from the front', int(seen.sum()), 'of', len(co))
if 'back' in flags:   # a back view, mirrored, for the back-facing surface
    bv = json.load(open(os.path.join(flags['back'], 'view.json'))); bl = np.load(os.path.join(flags['back'], 'labels.npy')).astype(np.int32)
    # (palette indices differ per view: match each back colour to the nearest front colour)
    def rgb(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)
    match = [int(np.argmin([np.linalg.norm(rgb(c) - rgb(f)) for f in palette])) for c in bv['palette']]
    b0, b1, b2, b3 = bv['bbox']
    bpx = b0 + (hi[0] - co[:, 0]) / (hi[0] - lo[0]) * (b2 - b0); bpy_ = b3 - co[:, 2] / H * (b3 - b1)
    bl_ = bl[np.clip(bpy_.round().astype(int), 0, bl.shape[0] - 1), np.clip(bpx.round().astype(int), 0, bl.shape[1] - 1)]
    lab[back] = np.array(match)[bl_[back]]; known |= back
nbr = [[] for _ in range(len(co))]
for e in me.edges: a, b = e.vertices; nbr[a].append(b); nbr[b].append(a)
K = len(palette)
# everything unseen takes the colour of the nearest seen surface (a breadth-first spread over the mesh)
from collections import deque
q = deque(np.nonzero(known)[0].tolist())
while q:
    i = q.popleft()
    for j in nbr[i]:
        if not known[j]: known[j] = True; lab[j] = lab[i]; q.append(j)
# smooth the labels over the surface (majority of the neighbours, a few rounds)
for _ in range(6):
    new = lab.copy()
    for i, ns in enumerate(nbr):
        if ns:
            cnt = np.bincount(lab[ns + [i]], minlength=K); new[i] = cnt.argmax()
    lab = new
# 鈹€鈹€ materials: MToon flat colour per block 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
def srgb2lin(c): c = c / 255; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def hexlin(h): return tuple(srgb2lin(np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)))
for k, hx in enumerate(palette):
    mat = bpy.data.materials.new(f'block{k}'); col = hexlin(hx); mat.diffuse_color = (*col, 1)
    m = mat.vrm_addon_extension.mtoon1; m.enabled = True; m.pbr_metallic_roughness.base_color_factor = (*col, 1)
    x = m.extensions.vrmc_materials_mtoon; x.shade_color_factor = tuple(c * 0.62 for c in col)
    x.shading_toony_factor = 0.95; x.shading_shift_factor = -0.1
    x.outline_width_mode = 'worldCoordinates'; x.outline_width_factor = 0.0016
    x.outline_color_factor = tuple(c * 0.25 for c in col); x.outline_lighting_mix_factor = 0.4
    me.materials.append(mat)
for p in me.polygons:
    p.material_index = int(np.bincount(lab[list(p.vertices)], minlength=K).argmax())

# 鈹€鈹€ 3. the skeleton, from the 2D joints lifted through the mesh 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
def depth(x, z):  # the middle of the body (y) at a point of the front view
    f = bvh.ray_cast(Vector((x, -5, z)), Vector((0, 1, 0))); b = bvh.ray_cast(Vector((x, 5, z)), Vector((0, -1, 0)))
    if f[0] and b[0]: return (f[0].y + b[0].y) / 2
    return 0.0
def P(x, z, dy=0.0): return Vector((x, depth(x, z) + dy, z))
def mid(a, b): return ((J[a][0] + J[b][0]) / 2, (J[a][1] + J[b][1]) / 2)
hip_c = mid('l_hip', 'r_hip'); sho_c = mid('l_sho', 'r_sho')
top_z = H
pelvis = P(hip_c[0], hip_c[1] + 0.04); spine = P(hip_c[0], hip_c[1] + 0.35 * (sho_c[1] - hip_c[1]))
chest = P(sho_c[0], hip_c[1] + 0.68 * (sho_c[1] - hip_c[1])); neck = P(sho_c[0], sho_c[1] - 0.01)
head = P(sho_c[0], neck_z); crown = Vector((head.x, head.y, top_z - 0.01))
BONES = {'hips': (pelvis, spine, None), 'spine': (spine, chest, 'hips'), 'chest': (chest, neck, 'spine'),
         'neck': (neck, head, 'chest'), 'head': (head, crown, 'neck')}
for side, L_ in (('L', 'l'), ('R', 'r')):
    sho = P(*J[f'{L_}_sho']); elb = P(*J[f'{L_}_elb']); wri = P(*J[f'{L_}_wri'])
    sho_in = Vector((neck.x + (sho.x - neck.x) * 0.25, sho.y, sho.z - 0.01))
    hand = wri + (wri - elb).normalized() * 0.075
    hip = P(J[f'{L_}_hip'][0], J[f'{L_}_hip'][1] + 0.02); knee = P(*J[f'{L_}_knee']); ank = P(*J[f'{L_}_ank'])
    ank.z = max(ank.z, 0.07)
    toe = Vector((ank.x, ank.y - 0.11, 0.025)); toe_end = Vector((ank.x, ank.y - 0.16, 0.02))
    BONES.update({f'shoulder.{side}': (sho_in, sho, 'chest'), f'upper_arm.{side}': (sho, elb, f'shoulder.{side}'),
                  f'lower_arm.{side}': (elb, wri, f'upper_arm.{side}'), f'hand.{side}': (wri, hand, f'lower_arm.{side}'),
                  f'upper_leg.{side}': (hip, knee, 'hips'), f'lower_leg.{side}': (knee, ank, f'upper_leg.{side}'),
                  f'foot.{side}': (ank, toe, f'lower_leg.{side}'), f'toes.{side}': (toe, toe_end, f'foot.{side}')})
arm = bpy.data.armatures.new('Armature'); rig = bpy.data.objects.new('Armature', arm); COLL.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
for n, (h_, t_, par) in BONES.items():
    eb = arm.edit_bones.new(n); eb.head = h_; eb.tail = t_ if (t_ - h_).length > 1e-3 else h_ + Vector((0, 0, 0.02))
for n, (_, _, par) in BONES.items():
    if par: arm.edit_bones[n].parent = arm.edit_bones[par]
bpy.ops.object.mode_set(mode='OBJECT')
hb = arm.vrm_addon_extension.vrm1.humanoid.human_bones
VRM = {'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head'}
for side, word in (('L', 'left'), ('R', 'right')):
    for part in ('shoulder', 'upper_arm', 'lower_arm', 'hand', 'upper_leg', 'lower_leg', 'foot', 'toes'):
        VRM[f'{part}.{side}'] = f'{word}_{part}'
for b, hname in VRM.items(): getattr(hb, hname).node.bone_name = b
# weights: bone heat; if it leaves vertices unweighted, fill them by distance to the bones
for o in sc.objects: o.select_set(False)
ob.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
weighted = np.zeros(len(me.vertices), bool)
for v in me.vertices:
    if any(g.weight > 0.01 for g in v.groups): weighted[v.index] = True
print('FIG bone heat weighted', int(weighted.sum()), 'of', len(weighted))
if weighted.mean() < 0.98:
    segs = [(n, arm.bones[n].head_local.copy(), arm.bones[n].tail_local.copy()) for n in BONES if not n.startswith('toes')]
    for n, _, _ in segs:
        if n not in ob.vertex_groups: ob.vertex_groups.new(name=n)
    for v in me.vertices:
        if weighted[v.index]: continue
        ds = []
        for n, a, b in segs:
            ab = b - a; t = max(0, min(1, (v.co - a).dot(ab) / ab.length_squared)); ds.append(((a + ab * t - v.co).length + 0.004, n))
        ds.sort(); ws = [(1 / d ** 6, n) for d, n in ds[:3]]; tot = sum(w for w, _ in ws)
        for w, n in ws: ob.vertex_groups[n].add([v.index], w / tot, 'REPLACE')
# where the drawing's hands touched the body the mesh is fused: nothing farther than an arm's thickness from the
# arm bones follows the arm (a swinging hand must not drag the skirt), then every vertex's weights sum to one
ARM = [n for n in BONES if n.split('.')[0] in ('upper_arm', 'lower_arm', 'hand')]
arm_segs = [(arm.bones[n].head_local.copy(), arm.bones[n].tail_local.copy()) for n in ARM]
arm_idx = {ob.vertex_groups[n].index for n in ARM + [b for b in BONES if b.startswith('shoulder')] if n in ob.vertex_groups}
TORSO = [ob.vertex_groups[n] for n in ('hips', 'spine', 'chest', 'upper_leg.L', 'upper_leg.R') if n in ob.vertex_groups]
torso_segs = [(arm.bones[g.name].head_local.copy(), arm.bones[g.name].tail_local.copy()) for g in TORSO]
def segd(p, a, b):
    ab = b - a; t = max(0, min(1, (p - a).dot(ab) / ab.length_squared)); return (a + ab * t - p).length
stripped = 0
for v in me.vertices:
    ws = {g.group: g.weight for g in v.groups if g.weight > 0}
    if not any(k in arm_idx for k in ws): continue
    if min(segd(v.co, a, b) for a, b in arm_segs) > 0.055 and v.co.z < sho_c[1] - 0.05:
        for k in list(ws):
            if k in arm_idx: ob.vertex_groups[k].remove([v.index]); ws.pop(k)
        if not ws:
            d = [(segd(v.co, a, b), g) for (a, b), g in zip(torso_segs, TORSO)]; d.sort(key=lambda x: x[0])
            d0, g0 = d[0]; ws = {g0.index: 1.0}; g0.add([v.index], 1.0, 'REPLACE')
        stripped += 1
for v in me.vertices:
    tot = sum(g.weight for g in v.groups)
    if tot > 0 and abs(tot - 1) > 1e-3:
        for g in v.groups: ob.vertex_groups[g.group].add([v.index], g.weight / tot, 'REPLACE')
print('FIG arm weights stripped from', stripped, 'vertices away from the arms')
# a skirt (or coat) hangs from the hips: find its hem as the height where the gap between the legs opens in the
# front view, and below the hips let the surface follow the legs only partly
fg_col = view['bbox']; cx_img = (view['joints']['l_hip'][0] + view['joints']['r_hip'][0]) / 2
mask = np.load(os.path.join(VIEW, 'mask.npy')) if os.path.exists(os.path.join(VIEW, 'mask.npy')) else None
hip_z = hip_c[1]; knee_z = (J['l_knee'][1] + J['r_knee'][1]) / 2
hem_z = None
if mask is not None:
    col = mask[:, int(round(cx_img))]
    hip_row = int(round(to_img(0, hip_z)[1]))
    rows = [r for r in range(hip_row, mask.shape[0]) if col[r] == 0]
    if rows: hem_z = to_mesh(0, rows[0])[1]
print('FIG hips', round(hip_z, 3), 'hem', hem_z and round(hem_z, 3), 'knee', round(knee_z, 3))
if hem_z is not None and hip_z - hem_z > 0.06:
    gh = ob.vertex_groups['hips']; legs = [ob.vertex_groups[f'upper_leg.{s}'] for s in 'LR'] + [ob.vertex_groups[f'lower_leg.{s}'] for s in 'LR']
    for v in me.vertices:
        if not (hem_z - 0.03 < v.co.z < hip_z + 0.09): continue
        # inside a leg's own tube (close to the leg bone) stays with the leg
        t = max(0.0, (hip_z - v.co.z) / (hip_z - hem_z))  # 0 at the hips and above, 1 at the hem
        share = 0.08 + 0.22 * t                            # how much the cloth follows the legs
        ws = {g.group: g.weight for g in v.groups}
        leg_w = sum(ws.get(g.index, 0) for g in legs)
        if leg_w <= 0: continue
        for g in legs:
            if g.index in ws: g.add([v.index], ws[g.index] / leg_w * share * leg_w, 'REPLACE')
        rest = 1 - share * leg_w - sum(w for k, w in ws.items() if k not in [g.index for g in legs] + [gh.index])
        gh.add([v.index], max(0.0, rest), 'REPLACE')

# 鈹€鈹€ 4. VRM export 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
meta = arm.vrm_addon_extension.vrm1.meta; meta.vrm_name = f'{NAME} (prototype figure)'
a_ = meta.authors.add(); a_.value = 'novel-ontology-pi figure pipeline'
try: meta.avatar_permission = 'onlyAuthor'; meta.commercial_usage = 'personalNonProfit'; meta.allow_redistribution = False; meta.modification = 'prohibited'
except Exception as e: print('FIG meta', e)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm_path = os.path.join(OUT, f'{NAME}.vrm')
print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm_path), os.path.exists(vrm_path) and os.path.getsize(vrm_path))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{NAME}.blend'))

# 鈹€鈹€ renders: toon and hologram, rest pose and a walk pose 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
sc.render.engine = 'BLENDER_EEVEE'; sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w'); sc.world = world
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); COLL.objects.link(sun)
sun.data.energy = 4.0; sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); COLL.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.8; sc.render.resolution_x, sc.render.resolution_y = 560, 900
def toon_mat(name, hexcol):
    m = bpy.data.materials.new(name); nt = m.node_tree if m.node_tree else None
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); o = nt.nodes.new('ShaderNodeOutputMaterial')
    col = (*hexlin(hexcol), 1)
    d = nt.nodes.new('ShaderNodeBsdfDiffuse'); d.inputs['Color'].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new('ShaderNodeShaderToRGB'); nt.links.new(d.outputs[0], s2r.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].color = (0.66, 0.62, 0.66, 1); ramp.color_ramp.elements[1].position = 0.22; ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(s2r.outputs[0], ramp.inputs[0])
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1
    nt.links.new(ramp.outputs[0], mul.inputs[6]); mul.inputs[7].default_value = col
    em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(mul.outputs[2], em.inputs[0]); nt.links.new(em.outputs[0], o.inputs[0]); return m
def holo_mat(name, hexcol):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); o = nt.nodes.new('ShaderNodeOutputMaterial')
    rgb = np.array([int(hexcol[i:i + 2], 16) for i in (1, 3, 5)], float) / 255; lum = float(rgb @ [0.3, 0.59, 0.11])
    tint = (0.1 + 0.35 * lum, 0.45 + 0.35 * lum, 0.95, 1)          # each block keeps its lightness as a shade of cyan
    lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.4
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (0.22 + 0.25 * lum,) * 3 + (1,); ramp.color_ramp.elements[1].position = 0.8
    nt.links.new(lw.outputs['Facing'], ramp.inputs[0])
    tex = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tex.outputs['Object'], sep.inputs[0])
    wave = nt.nodes.new('ShaderNodeMath'); wave.operation = 'SINE'; mulz = nt.nodes.new('ShaderNodeMath'); mulz.operation = 'MULTIPLY'; mulz.inputs[1].default_value = 260
    nt.links.new(sep.outputs['Z'], mulz.inputs[0]); nt.links.new(mulz.outputs[0], wave.inputs[0])
    lines = nt.nodes.new('ShaderNodeMapRange'); lines.inputs['From Min'].default_value = -1; lines.inputs['To Min'].default_value = 0.7; lines.inputs['To Max'].default_value = 1.0
    nt.links.new(wave.outputs[0], lines.inputs['Value'])
    fac = nt.nodes.new('ShaderNodeMath'); fac.operation = 'MULTIPLY'; nt.links.new(ramp.outputs[0], fac.inputs[0]); nt.links.new(lines.outputs[0], fac.inputs[1])
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = tint; em.inputs['Strength'].default_value = 0.85
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fac.outputs[0], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], o.inputs[0])
    try: m.surface_render_method = 'BLENDED'
    except Exception: pass
    return m
def ink_mat(holo):
    m = bpy.data.materials.new('ink'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); o = nt.nodes.new('ShaderNodeOutputMaterial')
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (0.55, 0.95, 1, 1) if holo else (0.09, 0.06, 0.06, 1); e.inputs['Strength'].default_value = 3 if holo else 1
    nt.links.new(e.outputs[0], o.inputs[0]); m.use_backface_culling = True; return m
vrm_mats = list(me.materials)
face_blocks = [p.material_index for p in me.polygons]
def dress(holo):
    me.materials.clear()
    for k, hx in enumerate(palette): me.materials.append(holo_mat(f'h{k}', hx) if holo else toon_mat(f't{k}', hx))
    me.polygons.foreach_set('material_index', face_blocks); me.update()
    me.materials.append(ink_mat(holo))
    for m in list(ob.modifiers):
        if m.type == 'SOLIDIFY': ob.modifiers.remove(m)
    sol = ob.modifiers.new('outline', 'SOLIDIFY'); sol.thickness = -0.0035; sol.use_flip_normals = True; sol.offset = 1; sol.material_offset = K
    world.color = (0.015, 0.025, 0.05) if holo else (0.93, 0.94, 0.96)
def walk_pose(on):
    for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0)
    if on:
        def rot(n, axis, deg):
            pb = rig.pose.bones[n]; head = pb.bone.head_local
            R = Matrix.Rotation(math.radians(deg), 4, axis)
            pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ (rig.pose.bones[n].parent.matrix @ rig.pose.bones[n].parent.bone.matrix_local.inverted() @ pb.bone.matrix_local if pb.parent else pb.bone.matrix_local)
            bpy.context.view_layer.update()
        rot('upper_leg.L', 'X', 28); rot('lower_leg.L', 'X', -18); rot('upper_leg.R', 'X', -22); rot('lower_leg.R', 'X', -30)
        rot('upper_arm.L', 'X', -25); rot('upper_arm.R', 'X', 25); rot('lower_arm.L', 'X', -20); rot('lower_arm.R', 'X', -15)
        rot('head', 'Z', 15); rot('spine', 'Z', -6)
    bpy.context.view_layer.update()
def sheet(path, angles=(0, 40, 90, 180)):
    tiles = []
    for ang in angles:
        a = math.radians(ang); t = Vector((0, 0, 0.8)); cam.location = t + Vector((math.sin(a) * 6, -math.cos(a) * 6, 0.3))
        cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
        f = path.replace('.png', f'_{ang}.png'); sc.render.filepath = f; bpy.ops.render.render(write_still=True); tiles.append(f)
    imgs = [bpy.data.images.load(f) for f in tiles]; w, h = imgs[0].size
    arr = np.concatenate([np.array(im.pixels[:], np.float32).reshape(h, w, 4) for im in imgs], axis=1)
    res = bpy.data.images.new('sheet', arr.shape[1], h); res.pixels.foreach_set(arr.ravel()); res.filepath_raw = path; res.file_format = 'PNG'; res.save()
    for f in tiles: os.remove(f)
for holo in (False, True):
    dress(holo)
    for pose in (False, True):
        walk_pose(pose)
        sheet(os.path.join(OUT, f"{'holo' if holo else 'toon'}_{'walk' if pose else 'rest'}.png"))
print('FIG done', OUT)



