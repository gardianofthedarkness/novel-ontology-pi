"""A head template in four-sided faces with meaning, built in the order an artist box-models one (a cube rounded into a
head, then rings around each eye, rings around the mouth, a nose, a neck), to be fitted onto any generated head
(fit_template.py) instead of covering it with an even grid.
usage: blender -b --factory-startup -P template_head.py -- <out-dir> [--grid=6] [--eye-rings=3] [--mouth-rings=3]
  Canonical frame: faces -Y, Z up, the chin's underside near z = -0.55, the crown at z = 0.55 (a head about 1.1 tall).
  Writes template.obj (quads) and template.json: each face's region (skull, eye_l, eye_r, mouth, nose, neck), the
  edge rings around the eyes and mouth (inner first), and landmark vertices named after the 68-point layout they
  correspond to (eye corners and lids, mouth corners and lips, nose tip, chin, jaw sides), so fitting can pull them onto
  the face points found on the generated head. Big quads where the head is smooth (skull, cheeks), rings where it
  changes fast (eyes, mouth, nose): the density is in the template's design, refined later where the fit says so."""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in argv if a.startswith('--'))
OUT = [a for a in argv if not a.startswith('--')][0]; os.makedirs(OUT, exist_ok=True)
N = int(flags.get('grid', 8)); ER = int(flags.get('eye-rings', 3)); MR = int(flags.get('mouth-rings', 3))
bm = bmesh.new()
# 1. the box: a cube with N cuts a side, rounded onto a sphere, then shaped as a head (an egg, narrower at the jaw)
bmesh.ops.create_cube(bm, size=2.0)
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=N - 1, use_grid_fill=True)
for v in bm.verts:
    d = v.co.normalized(); x, y, z = d
    w = 0.40 * (1.0 - 0.28 * max(0.0, -z) ** 1.3)             # narrower toward the chin
    dep = 0.47 * (1.0 - 0.15 * max(0.0, -z))
    v.co = Vector((x * w, y * dep, z * 0.55))
bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
region = bm.faces.layers.int.new('region')
REG = {'skull': 0, 'eye_l': 1, 'eye_r': 2, 'mouth': 3, 'nose': 4, 'neck': 5}
def nearest_faces(target, k):
    t = Vector(target)
    return sorted(bm.faces, key=lambda f: (f.calc_center_median() - t).length)[:k]
def box_faces(cx, cz, hw, hh):
    """the front-facing faces whose centres fall in a box on the face (x, z), a clean block to inset"""
    out = [f for f in bm.faces if f.normal.y < -0.5 and abs(f.calc_center_median().x - cx) < hw and abs(f.calc_center_median().z - cz) < hh]
    return out or nearest_faces((cx, -0.47, cz), 2)
def ring_insets(faces, rings, thick, name):
    """inset the region again and again: each inset leaves one edge ring around what is left (the inner faces)"""
    loops = []
    inner = list(faces)
    for k in range(rings):
        res = bmesh.ops.inset_region(bm, faces=inner, thickness=thick * (0.8 ** k), depth=0.0, use_even_offset=True)
        loops.append(sorted({v.index for f in inner for v in f.verts if any(not (g in inner) for g in v.link_faces)}))
        for f in res['faces']: f[region] = REG[name]
        for f in inner: f[region] = REG[name]
    return inner, loops
# 2. eyes: four quads where each eye is, inset into rings (a socket of loops, as the tutorial's eyes)
eye_y = -0.47
eyes = {}
for name, sx in (('eye_l', 1), ('eye_r', -1)):
    centre = (0.155 * sx, eye_y, 0.02)
    fs = box_faces(centre[0], centre[2], 0.075, 0.055)
    inner, loops = ring_insets(fs, ER, 0.022, name)
    bm.verts.index_update(); bm.faces.index_update()
    eyes[name] = {'inner_faces': inner}
# 3. the mouth: a wide strip of quads below the nose, inset into rings
fs = box_faces(0.0, -0.28, 0.07, 0.03)
mouth_inner, _ = ring_insets(fs, MR, 0.018, 'mouth')
# 4. the nose: the quads between the eyes and the mouth, inset once and pulled forward a little
fs = box_faces(0.0, -0.10, 0.025, 0.05)
res = bmesh.ops.inset_region(bm, faces=fs, thickness=0.02, depth=0.0, use_even_offset=True)
for f in fs + res['faces']: f[region] = REG['nose']
for f in fs:
    for v in f.verts: v.co.y -= 0.03
# 5. the neck: the quads under the jaw, extruded down
bm.faces.ensure_lookup_table()
under = [f for f in bm.faces if f.calc_center_median().z < -0.45 and f.normal.z < -0.6]
ext = bmesh.ops.extrude_face_region(bm, geom=under)
newv = [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]
for v in newv: v.co.z -= 0.35; v.co.x *= 0.85; v.co.y *= 0.85
for g in ext['geom']:
    if isinstance(g, bmesh.types.BMFace): g[region] = REG['neck']
bmesh.ops.delete(bm, geom=[g for g in ext['geom'] if isinstance(g, bmesh.types.BMFace) and g.calc_center_median().z < -0.85], context='FACES')
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.verts.index_update(); bm.faces.index_update(); bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
# landmarks: vertices named after the 68-point layout
def ring_verts(name):
    fs = [f for f in bm.faces if f[region] == REG[name]]
    return {v for f in fs for v in f.verts}
def extreme(vs, key): return max(vs, key=key).index
marks = {}
for name, (corner_in, corner_out, top, bottom) in (('eye_r', (39, 36, 37, 41)), ('eye_l', (42, 45, 44, 46))):
    inner = [f for f in eyes[name]['inner_faces'] if f.is_valid]
    vs = {v for f in inner for v in f.verts}
    sx = 1 if sum(v.co.x for v in vs) > 0 else -1
    marks[corner_in] = extreme(vs, lambda v: -sx * v.co.x); marks[corner_out] = extreme(vs, lambda v: sx * v.co.x)
    marks[top] = extreme(vs, lambda v: v.co.z + 0.01 * (-abs(v.co.x))); marks[bottom] = extreme(vs, lambda v: -v.co.z)
mv = [v for v in ring_verts('mouth') if abs(v.co.z + 0.30) < 0.06]
marks[48] = extreme(mv, lambda v: -v.co.x); marks[54] = extreme(mv, lambda v: v.co.x)
marks[51] = extreme([v for v in mv if abs(v.co.x) < 0.02], lambda v: v.co.z); marks[57] = extreme([v for v in mv if abs(v.co.x) < 0.02], lambda v: -v.co.z)
marks[30] = extreme(ring_verts('nose'), lambda v: -v.co.y)
front = [v for v in bm.verts if v.co.y < -0.1]
marks[8] = extreme([v for v in front if abs(v.co.x) < 0.02], lambda v: -v.co.z - 2 * (v.co.z < -0.6))   # the chin: lowest on the midline above the neck
marks[8] = min([v for v in bm.verts if abs(v.co.x) < 0.02 and v.co.y < -0.2 and v.co.z > -0.62], key=lambda v: v.co.z).index
for i, zt in ((4, -0.32), (12, -0.32), (2, -0.12), (14, -0.12)):
    sx = -1 if i < 8 else 1
    marks[i] = min([v for v in bm.verts if v.co.y < -0.05], key=lambda v: (v.co.z - zt) ** 2 + (v.co.x - sx * 0.36) ** 2 + 0.2 * (v.co.y + 0.2) ** 2).index
# write
me = bpy.data.meshes.new('template'); bm.to_mesh(me)
lines = ['# head template (template_head.py)'] + ['v %.6f %.6f %.6f' % tuple(v.co) for v in me.vertices] + ['f ' + ' '.join(str(i + 1) for i in p.vertices) for p in me.polygons]
open(os.path.join(OUT, 'template.obj'), 'w').write('\n'.join(lines) + '\n')
regions = [bm.faces[p.index][region] for p in me.polygons]
json.dump({'regions': regions, 'region_names': REG, 'marks': {str(k): v for k, v in marks.items()}, 'frame': 'faces -Y, Z up, head about 1.1 tall'},
          open(os.path.join(OUT, 'template.json'), 'w'), indent=1)
quads = sum(1 for p in me.polygons if len(p.vertices) == 4)
print('FIG template %d vertices, %d faces (%d four-sided); regions %s; %d landmarks' % (len(me.vertices), len(me.polygons), quads,
      {n: regions.count(i) for n, i in REG.items()}, len(marks)))
# a look at it: front and side, wireframe on white
ob = bpy.data.objects.new('template', me); bpy.context.scene.collection.objects.link(ob)
sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'SINGLE'
sc.render.resolution_x = sc.render.resolution_y = 700
mod = ob.modifiers.new('w', 'WIREFRAME'); mod.thickness = 0.004; mod.use_replace = False
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.6; sc.collection.objects.link(cam); sc.camera = cam
for a in (0, 90):
    R = math.radians(a); cam.location = Vector((math.sin(R) * 3, -math.cos(R) * 3, -0.1)); cam.rotation_euler = (math.radians(90), 0, R)
    sc.render.filepath = os.path.join(OUT, 'template_%d.png' % a); bpy.ops.render.render(write_still=True)
