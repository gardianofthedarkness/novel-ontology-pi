"""Turn a generated character mesh into a rigged, flat-coloured VRM, using the clean front view it was made from.
usage: blender -b -P dress_rig.py -- <mesh.glb> <view-dir (view.json, labels.npy, mask.npy)> <out-dir> [--back=<back-view-dir>] [--name=X] [--marks=<whole.json>]
  1. clean: the generator's speckle smoothed away, voxel remesh at the generator's own spacing, decimated as far as the
     surface stays within the generator's own noise; stood at 1.6 m facing -Y
  2. colour: each vertex takes the flat colour block the front (or back) view shows at its place where that camera sees
     it; labels spread over the unseen surface and smoothed until they settle, one toon material per block
  3. rig: VRM humanoid bones from the 2D joints (RTMPose) registered onto the mesh's outline and from the mesh's own
     cross-sections (neck, waist, ankles, arm roots, hands, feet); bone-heat weights, arm weights kept inside the arm's
     measured tube, a skirt following the legs by how much of it the legs fill
  4. export VRM 1.0 (MToon, outlines) and render toon + hologram sheets, rest pose and a walk pose"""
import bpy, bmesh, json, math, os, sys
import numpy as np
from collections import deque
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, VIEW, OUT = argv[0], argv[1], argv[2]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--') and '=' in a)
NAME = flags.get('name', 'figure'); H = 1.6                     # STRUCTURAL: every figure stands 1.6 m tall
HERE = os.path.dirname(os.path.abspath(sys.argv[sys.argv.index('-P') + 1]))
sys.path.insert(0, HERE)
from view_register import register
os.makedirs(OUT, exist_ok=True)
view = json.load(open(os.path.join(VIEW, 'view.json')))
bpy.ops.wm.read_factory_settings(use_empty=True)
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
sc = bpy.context.scene; COLL = sc.collection

def mesh_co(me): c = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', c); return c.reshape(-1, 3)
def mesh_edges(me): e = np.zeros(len(me.edges) * 2, np.int64); me.edges.foreach_get('vertices', e); return e.reshape(-1, 2)
def mesh_tris(me):
    me.calc_loop_triangles(); t = np.zeros(len(me.loop_triangles) * 3, np.int64); me.loop_triangles.foreach_get('vertices', t)
    return t.reshape(-1, 3)
def smooth_to_knee(me, cap=32):
    """Laplacian smoothing (each vertex half way to its neighbours' mean) for as many passes as remove the speckle: the
    median length of the Laplacian falls fast while the speckle goes and slowly once only the shape is left; the pass
    count is the knee of that curve (the pass farthest below the straight line from the first to the last pass).
    Returns the pass count and how far each vertex moved."""
    c0 = mesh_co(me); E = mesh_edges(me); n = len(c0)
    deg = np.maximum(1, np.bincount(E.ravel(), minlength=n)).astype(float)
    def lap(c): return np.stack([np.bincount(E[:, 0], c[E[:, 1], k], n) + np.bincount(E[:, 1], c[E[:, 0], k], n) for k in range(3)], 1) / deg[:, None] - c
    c = c0.copy(); hist = []
    for k in range(cap + 1):
        L = lap(c); hist.append(float(np.median(np.linalg.norm(L, axis=1))))
        if k < cap: c = c + 0.5 * L
    h = np.array(hist); x = np.arange(cap + 1) / cap; y = (h - h[-1]) / max(1e-12, h[0] - h[-1]); knee = int(np.argmax(1 - x - y))
    c = c0.copy()
    for _ in range(knee): c = c + 0.5 * lap(c)
    me.vertices.foreach_set('co', c.ravel()); me.update()
    return knee, np.linalg.norm(c - c0, axis=1)
def decimate_within(ob, tol, iters=8, sample=20000):
    """the smallest collapse-decimation ratio whose surface stays within tol of the current surface (the largest distance
    of the current vertices to the decimated faces), by bisection on the ratio's logarithm; applies it"""
    src = mesh_co(ob.data); src = src[np.linspace(0, len(src) - 1, min(sample, len(src))).astype(int)]   # a stride, for speed only
    def miss(r):
        dc = ob.modifiers.new('dc', 'DECIMATE'); dc.ratio = r; dc.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); m = ev.to_mesh()
        bvh = BVHTree.FromPolygons([v.co[:] for v in m.vertices], [p.vertices[:] for p in m.polygons]); ev.to_mesh_clear(); ob.modifiers.remove(dc)
        return max((bvh.find_nearest(Vector(p))[0] - Vector(p)).length for p in src)
    lo_, hi_ = math.log2(1.0 / len(ob.data.polygons)), 0.0
    for _ in range(iters):
        mid_ = (lo_ + hi_) / 2
        if miss(2 ** mid_) <= tol: hi_ = mid_
        else: lo_ = mid_
    dc = ob.modifiers.new('dc', 'DECIMATE'); dc.ratio = 2 ** hi_; dc.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get(); me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me2; bpy.data.meshes.remove(old); return 2 ** hi_

# ── 1. import and clean ─────────────────────────────────────────────────────────────────────────────────────────────
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
co = mesh_co(ob.data)
lo, hi = co.min(0), co.max(0); s = H / (hi[2] - lo[2])
ob.data.transform(Matrix.Translation((-(lo[0] + hi[0]) / 2 * s, -(lo[1] + hi[1]) / 2 * s, -lo[2] * s)) @ Matrix.Scale(s, 4))
# ── image <-> mesh mapping: the picture's figure outline registered onto the mesh's front outline ────────────────────
co = mesh_co(ob.data)
REG_PTS = co[np.linspace(0, len(co) - 1, min(len(co), 20000)).astype(int)]   # NUMERIC: a stride of the surface, for speed only
MASK = np.load(os.path.join(VIEW, 'mask.npy')) > 0
reg = register(MASK, REG_PTS)
print('FIG register', {k: (np.round(v, 4).tolist() if not isinstance(v, int) else v) for k, v in reg.report.items()})
def to_mesh(px, py): x, z = reg.to_mesh(px, py); return float(x), float(z)
def to_img(x, z): return reg.to_img(x, z)
def in_figure(p):   # points whose front projection falls on the picture's figure
    px_, py_ = to_img(p[:, 0], p[:, 2]); ix, iy = np.round(px_).astype(int), np.round(py_).astype(int)
    ok = (ix >= 0) & (iy >= 0) & (ix < MASK.shape[1]) & (iy < MASK.shape[0])
    out = np.zeros(len(p), bool); out[ok] = MASK[iy[ok], ix[ok]]; return out
# the generator's own spacing (its median edge) and its own noise: how far the speckle smoothing moves the figure's surface
# (the median over the points on the picture's figure: a generated floor plate, flat and noiseless, does not count)
E0 = mesh_edges(ob.data); GEN_EDGE = float(np.median(np.linalg.norm(co[E0[:, 0]] - co[E0[:, 1]], axis=1)))
k_raw, moved = smooth_to_knee(ob.data); NOISE = float(np.median(moved[in_figure(co)]))
# a voxel remesh at the generator's own spacing gives one closed surface (bone heat needs it) without losing its detail;
# its own voxel steps are smoothed the same way
rm = ob.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = GEN_EDGE; rm.use_smooth_shade = True
dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
k_vox, _ = smooth_to_knee(me)
# the fine surface is kept (as arrays) for measuring the body; the rig mesh is decimated within the generator's noise
CO = mesh_co(me); TRI = mesh_tris(me); EF = mesh_edges(me)
STEP = float(np.median(np.linalg.norm(CO[EF[:, 0]] - CO[EF[:, 1]], axis=1)))     # the fine mesh's own spacing
BVH = BVHTree.FromPolygons(CO.tolist(), TRI.tolist())
ratio = decimate_within(ob, NOISE); me = ob.data
for p in me.polygons: p.use_smooth = True
ob.name = 'Body'; me.name = 'Body'
co = mesh_co(me); lo, hi = co.min(0), co.max(0)
print('FIG clean: generator edge %.4f m, speckle %.2f mm (%d passes), remesh smoothed %d passes, decimated to %.3f within the speckle'
      % (GEN_EDGE, NOISE * 1000, k_raw, k_vox, ratio))
print('FIG mesh', len(me.vertices), 'verts', len(me.polygons), 'faces, bounds', lo.round(3), hi.round(3))

labels = np.load(os.path.join(VIEW, 'labels.npy')).astype(np.int32)
LH, LW = labels.shape
palette = view['palette']; HAIR, SKIN = view['hair'], view['skin']
J = {k: to_mesh(v[0], v[1]) for k, v in view['joints'].items()}
if 'marks' in flags:
    # joints measured on the model itself (rawmerge/marks_raw.py: RTMW's points on renders of this model, triangulated) replace
    # the drawing's joints laid over it: a body generated from the drawing does not keep the drawing's arm length (the drawing's
    # wrists fell 9 cm out, in the palms, on a TRELLIS.2 body)
    RTMW = ['nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear', 'l_sho', 'r_sho', 'l_elb', 'r_elb', 'l_wri', 'r_wri', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ank', 'r_ank']   # STRUCTURAL: RTMW's first 17 points
    M3 = json.load(open(flags['marks']))['points']; moved = {}
    for i_, k_ in enumerate(RTMW):
        if k_ in J and str(i_) in M3:
            p3 = M3[str(i_)]['p']; moved[k_] = round(1000 * float(np.hypot(p3[0] - J[k_][0], p3[2] - J[k_][1])), 1); J[k_] = type(J[k_])((p3[0], p3[2])) if isinstance(J[k_], tuple) else np.array([p3[0], p3[2]])
    print("FIG joints from the model's own 3D landmarks; moved from the drawing's (mm):", moved)

# ── 2. colour blocks by projection ───────────────────────────────────────────────────────────────────────────────────
vn = np.array([v.normal[:] for v in me.vertices]); co = mesh_co(me)
px, py = to_img(co[:, 0], co[:, 2])
lab = labels[np.clip(np.round(py).astype(int), 0, LH - 1), np.clip(np.round(px).astype(int), 0, LW - 1)].astype(np.int32)
# what a camera actually sees: a ray from that side must reach this vertex first (within the mesh's own spacing)
bvh0 = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
ED = mesh_edges(me); TOL = float(np.median(np.linalg.norm(co[ED[:, 0]] - co[ED[:, 1]], axis=1)))
def seen_from(sy):
    out = np.zeros(len(co), bool)
    for i, (x, y, z) in enumerate(co):
        hit = bvh0.ray_cast(Vector((x, sy * 5.0, z)), Vector((0, -sy, 0)))
        out[i] = bool(hit[0]) and abs(hit[0].y - y) < TOL
    return out
seen = seen_from(-1); known = seen.copy()
print('FIG seen from the front', int(seen.sum()), 'of', len(co))
if 'back' in flags:   # the back view, mirrored, for the surface the back camera sees
    bv = json.load(open(os.path.join(flags['back'], 'view.json'))); bl = np.load(os.path.join(flags['back'], 'labels.npy')).astype(np.int32)
    seen_b = seen_from(1)
    # (palette indices differ per view: match each back colour to the nearest front colour)
    def rgb(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)
    match = [int(np.argmin([np.linalg.norm(rgb(c) - rgb(f)) for f in palette])) for c in bv['palette']]
    reg_b = register(np.load(os.path.join(flags['back'], 'mask.npy')), REG_PTS * [-1, 1, 1])     # the back picture is the mirror
    bpx, bpy_ = reg_b.to_img(-co[:, 0], co[:, 2])
    bl_ = bl[np.clip(np.round(bpy_).astype(int), 0, bl.shape[0] - 1), np.clip(np.round(bpx).astype(int), 0, bl.shape[1] - 1)]
    # a vertex both cameras see (an edge-on side) takes the camera its normal faces
    use_b = seen_b & (~seen | (vn[:, 1] > 0))
    lab[use_b] = np.array(match)[bl_[use_b]]; known |= seen_b
    print('FIG seen from the back', int(seen_b.sum()), '; back view registered, miss', np.round(reg_b.report['median_miss_mm'], 2).tolist(), 'mm')
nbr = [[] for _ in range(len(co))]
for e in me.edges: a, b = e.vertices; nbr[a].append(b); nbr[b].append(a)
K = len(palette)
# everything unseen takes the colour of the nearest seen surface (a breadth-first spread over the mesh)
q = deque(np.nonzero(known)[0].tolist())
while q:
    i = q.popleft()
    for j in nbr[i]:
        if not known[j]: known[j] = True; lab[j] = lab[i]; q.append(j)
# smooth the labels over the surface: majority of the neighbours, until no label changes
for rounds in range(1, 101):                                           # NUMERIC: cap on the rounds
    new = lab.copy()
    for i, ns in enumerate(nbr):
        if ns: new[i] = np.bincount(lab[ns + [i]], minlength=K).argmax()
    changed = int((new != lab).sum()); lab = new
    if not changed: break
print('FIG labels settled after', rounds, 'rounds')
# ── materials: MToon flat colour per block ──────────────────────────────────────────────────────────────────────────
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

# ── 3. the skeleton: the 2D joints lifted through the mesh, and the mesh's own cross-sections ─────────────────────────
# A cross-section is the loop the mesh's surface draws on a plane; of the loops on that plane, the innermost one around a
# given point is taken. Its area, centroid and outline measure the body there: the neck is where the column under the
# head is narrowest, the waist where the torso is, an ankle where the lower leg is, an arm root where the arm's loop
# parts from the torso's.
FN = np.cross(CO[TRI[:, 1]] - CO[TRI[:, 0]], CO[TRI[:, 2]] - CO[TRI[:, 0]])
NV = len(CO)
def frame(R):   # R's rows: the slicing axis, then the plane's two axes (right-handed)
    R = np.asarray(R, float); Q = CO @ R.T; return R, Q[TRI], FN @ R.T
def section(fr, c, at):
    R, Qt, N = fr
    d = Qt[:, :, 0] - c; pos = d > 0; x = pos.any(1) & ~pos.all(1)
    if not x.any(): return None
    F, D, S, Ct, N = TRI[x], d[x], pos[x], Qt[x], N[x]
    seg = np.zeros((len(F), 2, 2)); key = np.zeros((len(F), 2), np.int64); k = np.zeros(len(F), int)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        m = np.nonzero(S[:, a] != S[:, b])[0]; t = D[m, a] / (D[m, a] - D[m, b])
        seg[m, k[m]] = Ct[m, a, 1:] + (Ct[m, b, 1:] - Ct[m, a, 1:]) * t[:, None]
        ia, ib = F[m, a], F[m, b]; key[m, k[m]] = np.minimum(ia, ib) * NV + np.maximum(ia, ib); k[m] += 1
    want = np.stack([-N[:, 2], N[:, 1]], 1)                       # the surface's outside on each segment's right
    flip = ((seg[:, 1] - seg[:, 0]) * want).sum(1) < 0; seg[flip] = seg[flip][:, ::-1]
    u, inv = np.unique(key.ravel(), return_inverse=True); inv = inv.reshape(-1, 2); par = np.arange(len(u))
    def root(i):
        r = i
        while par[r] != r: r = par[r]
        while par[i] != r: par[i], i = r, par[i]
        return r
    for a, b in inv:
        ra, rb = root(a), root(b)
        if ra != rb: par[ra] = rb
    lab_ = np.array([root(a) for a in inv[:, 0]])
    p0, p1 = seg[:, 0], seg[:, 1]; cr = p0[:, 0] * p1[:, 1] - p1[:, 0] * p0[:, 1]
    y0, y1 = p0[:, 1] - at[1], p1[:, 1] - at[1]; hit = (y0 > 0) != (y1 > 0)
    xc = p0[:, 0] + (p1[:, 0] - p0[:, 0]) * (-y0) / np.where(hit, y1 - y0, 1.0); hit &= xc > at[0]
    best = None
    for L in np.unique(lab_):
        m = lab_ == L
        if hit[m].sum() % 2 == 0: continue                        # `at` is outside this loop
        A = 0.5 * cr[m].sum()
        if abs(A) < 1e-12 or (best is not None and abs(A) >= best['area']): continue
        cen = np.array([((p0[m, 0] + p1[m, 0]) * cr[m]).sum(), ((p0[m, 1] + p1[m, 1]) * cr[m]).sum()]) / (6 * A)
        best = {'area': abs(A), 'cen': cen, 'pts': p0[m], 'lo': p0[m].min(0), 'hi': p0[m].max(0)}
    if best is not None:
        best['c'] = c; best['cen3'] = R.T @ np.array([c, *best['cen']]); best['pts3'] = np.column_stack([np.full(len(best['pts']), c), best['pts']]) @ R
    return best
FZ = frame([[0, 0, 1], [1, 0, 0], [0, 1, 0]])                    # horizontal slices: the plane's axes are x, y
def depth(x, z):  # the middle of the body (y) at a point of the front view
    f = BVH.ray_cast(Vector((x, -5, z)), Vector((0, 1, 0))); b = BVH.ray_cast(Vector((x, 5, z)), Vector((0, -1, 0)))
    if f[0] and b[0]: return (f[0].y + b[0].y) / 2
    return 0.0
def P(x, z): return np.array([x, depth(x, z), z])
def zsec(x, z): return section(FZ, z, (x, depth(x, z)))
def area(sec): return sec['area'] if sec else np.inf
def mid(a, b): return ((J[a][0] + J[b][0]) / 2, (J[a][1] + J[b][1]) / 2)
hip_c = mid('l_hip', 'r_hip'); sho_c = mid('l_sho', 'r_sho'); cx = hip_c[0]
elb_x = sorted([J['l_elb'][0], J['r_elb'][0]])
top_z = float(CO[:, 2].max())
# the neck seam: the middle of the throat. Seen from the front along the head's axis, between the shoulder line and the
# nose, the surface steps back where a collar (or the chest) gives way to the throat and steps forward again under the
# chin: the largest step back and the largest step forward bound the throat. (The narrowest section is no good: long
# hair fused to the neck's sides and back widens every section around it.) Without both steps, the most recessed point.
zs = np.arange(sho_c[1], J['nose'][1], STEP)
fy = np.array([(lambda h: h[0].y if h[0] else np.nan)(BVH.ray_cast(Vector((sho_c[0], -5, z)), Vector((0, 1, 0)))) for z in zs])
fy = np.where(np.isfinite(fy), fy, np.nanmin(fy)); dfy = np.diff(fy)
i_back, i_fwd = int(np.argmax(dfy)) + 1, int(np.argmin(dfy))
neck_z = float((zs[i_back] + zs[i_fwd]) / 2) if i_fwd >= i_back else float(zs[int(np.argmax(fy))])
seam_sec = zsec(sho_c[0], neck_z)
print('FIG throat from %.3f to %.3f (front steps back %.1f mm, forward %.1f mm)' % (zs[i_back], zs[i_fwd], dfy.max() * 1000, -dfy.min() * 1000))
# the neck's base: going down from the seam, the last section that does not yet reach out along both arms (to the elbows)
neck_base_z, base_sec = sho_c[1], None
for z in np.arange(neck_z, hip_c[1], -STEP):
    s_ = zsec(sho_c[0], z)
    if s_ and s_['lo'][0] <= elb_x[0] and s_['hi'][0] >= elb_x[1]: break
    if s_: neck_base_z, base_sec = float(z), s_
# the waist: the torso's narrowest section between the hip joints and the neck's base; the spine starts where the torso
# below the waist has half its volume (the median of its section areas' running sum)
zs = np.arange(hip_c[1], neck_base_z, STEP); secs = [zsec(cx, z) for z in zs]; A = np.array([area(s_) for s_ in secs])
i_w = int(np.argmin(A)); waist_z = float(zs[i_w])
V = np.cumsum(np.where(np.isfinite(A[:i_w + 1]), A[:i_w + 1], 0)); i_sp = int(np.searchsorted(V, V[-1] / 2)); spine_z = float(zs[i_sp])
def centre(sec, x, z): return sec['cen3'] if sec else P(x, z)
pelvis = centre(secs[0], cx, hip_c[1]); spine = centre(secs[i_sp], cx, spine_z); chest = centre(secs[i_w], cx, waist_z)
neck = centre(base_sec, sho_c[0], neck_base_z); head = centre(seam_sec, sho_c[0], neck_z)
crown = np.array([head[0], head[1], top_z])
print('FIG torso: hips %.3f spine %.3f waist/chest %.3f neck base %.3f neck seam %.3f crown %.3f' % (pelvis[2], spine_z, waist_z, neck_base_z, neck_z, top_z))
BONES = {'hips': (pelvis, spine, None), 'spine': (spine, chest, 'hips'), 'chest': (chest, neck, 'spine'),
         'neck': (neck, head, 'chest'), 'head': (head, crown, 'neck')}
MEAS = {'noise': NOISE, 'smooth_passes': k_raw, 'neck_seam_z': neck_z, 'neck_base_z': neck_base_z, 'waist_z': waist_z, 'spine_z': spine_z}
ARMS = {}; LEGS = {}
def flood(E, n, allowed, start):
    """the vertices reachable from start through edges whose both ends are allowed"""
    adj = [[] for _ in range(n)]
    for a, b in E:
        if allowed[a] and allowed[b]: adj[a].append(b); adj[b].append(a)
    seen_ = np.zeros(n, bool); seen_[start] = True; q = deque([start])
    while q:
        i = q.popleft()
        for j in adj[i]:
            if not seen_[j]: seen_[j] = True; q.append(j)
    return seen_
for side, L_ in (('L', 'l'), ('R', 'r')):
    sgn = 1 if J[f'{L_}_sho'][0] > cx else -1
    # ── the arm: sections across the line from the shoulder joint to the wrist ──
    sho = P(*J[f'{L_}_sho']); elb = P(*J[f'{L_}_elb']); wri = P(*J[f'{L_}_wri'])
    u = (wri - sho) / np.linalg.norm(wri - sho); v = np.array([0, 1.0, 0]) - u[1] * u; v /= np.linalg.norm(v); w = np.cross(u, v)
    fr = frame([u, v, w]); s_all = (CO - sho) @ u
    s_e, s_w = float((elb - sho) @ u), float((wri - sho) @ u)
    ss = np.arange(0, s_all.max(), STEP); fore = (wri - elb) / np.linalg.norm(wri - elb)
    def on_line(s_):   # the joints' polyline (and the forearm's line beyond the wrist) at s along the arm
        if s_ <= s_e: return sho + (elb - sho) * (s_ / s_e)
        if s_ <= s_w: return elb + (wri - elb) * ((s_ - s_e) / (s_w - s_e))
        return wri + fore * ((s_ - s_w) / (fore @ u))
    asecs = []
    for s_ in ss:
        p_ = on_line(s_); asecs.append(section(fr, float(sho @ u + s_), (float(p_ @ v), float(p_ @ w))))
    aA = np.array([area(a_) for a_ in asecs])
    # the arm's root: the largest fall of the section's area between the shoulder joint and the elbow (the loop parts
    # from the torso's)
    ie = int(np.searchsorted(ss, s_e)); drops = np.log(aA[:ie - 1] / aA[1:ie]); drops[~np.isfinite(drops)] = -np.inf
    i_root = int(np.argmax(drops)) + 1; s_root = float(ss[i_root])
    i_wri = int(np.searchsorted(ss, s_w))
    # the tube: per section from the root to the wrist, its centre and how far its outline reaches from it
    tube = [(float(ss[i]), asecs[i]['cen3'], float(np.linalg.norm(asecs[i]['pts3'] - asecs[i]['cen3'], axis=1).max()))
            for i in range(i_root, min(i_wri + 1, len(ss))) if asecs[i]]
    armpit_z = float(asecs[i_root]['pts3'][:, 2].min()) if asecs[i_root] else float(sho[2])
    elb_c = asecs[ie]['cen3'] if ie < len(asecs) and asecs[ie] else elb
    wri_c = asecs[i_wri]['cen3'] if i_wri < len(asecs) and asecs[i_wri] else wri
    # the hand: the surface beyond the wrist's section connected to it; the hand bone runs from the wrist towards the
    # hand's middle, as far as the hand reaches
    beyond = s_all > s_w
    if beyond.any():
        # every patch beyond the wrist's section that starts inside the wrist's own reach (a wrist section through the palm
        # leaves each finger its own patch; all of them are the hand)
        cand = np.nonzero(beyond)[0]; dw = np.linalg.norm(CO[cand] - wri_c, axis=1); reach_w = tube[-1][2] if tube else float(dw.min())
        hand_r = np.zeros(NV, bool)
        for st in cand[dw <= max(reach_w, float(dw.min()))]:
            if not hand_r[st]: hand_r |= flood(EF, NV, beyond, int(st))
        hp = CO[hand_r]
        hd = hp.mean(0) - wri_c; hd /= np.linalg.norm(hd); hand = wri_c + hd * float(((hp - wri_c) @ hd).max())
    else: hand = wri_c + fore * STEP
    # the clavicle starts at the neck's side (the narrowest neck section's own half width) at the shoulder joint's height
    if seam_sec: nx = head[0] + sgn * (seam_sec['hi'][0] - seam_sec['lo'][0]) / 2
    else: nx = (head[0] + sho[0]) / 2
    sho_in = np.array([nx, sho[1], sho[2]])
    ARMS[side] = {'sho': sho.tolist(), 'u': u.tolist(), 's_root': s_root, 's_wrist': s_w, 'armpit_z': armpit_z,
                  'tube': [(t[0], t[1].tolist(), t[2]) for t in tube]}
    # ── the leg: horizontal sections around the joints' line, from the floor to the hip joint ──
    hipj, kn, an = J[f'{L_}_hip'], J[f'{L_}_knee'], J[f'{L_}_ank']
    def leg_x(z): return float(np.interp(z, [an[1], kn[1], hipj[1]], [an[0], kn[0], hipj[0]]))
    zl = np.arange(STEP / 2, hipj[1], STEP); lsecs = [zsec(leg_x(z), z) for z in zl]
    # where the two legs' sections merge into one (a crotch, or a skirt's hem): the section reaches the body's middle
    # (the run of merged sections down from the hip joint: feet drawn together may touch lower down)
    merged = [bool(l_ and l_['lo'][0] < cx < l_['hi'][0]) for l_ in lsecs]
    i_merge = len(zl) - 1
    while i_merge > 0 and merged[i_merge - 1]: i_merge -= 1
    lA = np.array([area(l_) for l_ in lsecs]); ik = int(np.searchsorted(zl, kn[1]))
    # the ankle: the lower leg's narrowest section above the foot's widest one
    i_foot = int(np.argmax(np.where(np.isfinite(lA[:ik]), lA[:ik], -1)))
    i_ank = i_foot + int(np.argmin(lA[i_foot:ik])); ank = lsecs[i_ank]['cen3'] if lsecs[i_ank] else P(an[0], float(zl[i_ank]))
    knee = lsecs[ik]['cen3'] if ik < len(lsecs) and lsecs[ik] else P(*kn)
    hip = P(*hipj)
    leg_area = float(lA[max(0, i_merge - 1)])
    # the foot: the outlines of the horizontal sections around the ankle's line, from the ankle down, until a section
    # reaches across the body's middle (a floor plate the generator fused under both feet, or feet drawn together); the
    # toes start where the foot is widest (the ball), and end at its front-most point
    fpts = []
    for z in np.arange(ank[2], 0, -STEP):
        f_ = zsec(float(ank[0]), float(z))
        if f_ is None or f_['lo'][0] < cx < f_['hi'][0]: break
        fpts.append(f_['pts3'])
    fp = np.concatenate(fpts) if fpts else CO[(CO[:, 2] < ank[2]) & ((CO[:, 0] - cx) * sgn > 0)]
    yb = np.arange(fp[:, 1].min(), ank[1], STEP); bi = np.clip(np.digitize(fp[:, 1], yb) - 1, 0, max(0, len(yb) - 1))
    width = np.array([np.ptp(fp[bi == b, 0]) if (bi == b).sum() > 1 else 0 for b in range(len(yb))])
    def bin_mid(b): q_ = fp[bi == b]; return np.array([(q_[:, 0].min() + q_[:, 0].max()) / 2, yb[b] + STEP / 2, (q_[:, 2].min() + q_[:, 2].max()) / 2])
    ball = bin_mid(int(np.argmax(width))); tip = bin_mid(0); tip[1] = fp[:, 1].min()
    LEGS[side] = {'merge_z': float(zl[i_merge]), 'leg_area': leg_area, 'ankle_z': float(ank[2])}
    BONES.update({f'shoulder.{side}': (sho_in, sho, 'chest'), f'upper_arm.{side}': (sho, elb_c, f'shoulder.{side}'),
                  f'lower_arm.{side}': (elb_c, wri_c, f'upper_arm.{side}'), f'hand.{side}': (wri_c, hand, f'lower_arm.{side}'),
                  f'upper_leg.{side}': (hip, knee, 'hips'), f'lower_leg.{side}': (knee, ank, f'upper_leg.{side}'),
                  f'foot.{side}': (ank, ball, f'lower_leg.{side}'), f'toes.{side}': (ball, tip, f'foot.{side}')})
    print('FIG arm', side, 'root %.3f m out (armpit z %.3f), wrist %.3f, hand to %.3f; tube radius median %.3f'
          % (s_root, armpit_z, s_w, float((hand - sho) @ u), float(np.median([t[2] for t in tube])) if tube else -1))
    print('FIG leg', side, 'legs merge at %.3f, ankle %.3f, ball %s, tip %s' % (zl[i_merge], ank[2], ball.round(3), tip.round(3)))
MEAS.update({'arms': ARMS, 'legs': LEGS})
arm = bpy.data.armatures.new('Armature'); rig = bpy.data.objects.new('Armature', arm); COLL.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
for n, (h_, t_, par) in BONES.items():
    eb = arm.edit_bones.new(n); eb.head = Vector(h_); eb.tail = Vector(t_) if np.linalg.norm(np.subtract(t_, h_)) > 1e-4 else Vector(h_) + Vector((0, 0, STEP))
for n, (_, _, par) in BONES.items():
    if par: arm.edit_bones[n].parent = arm.edit_bones[par]
bpy.ops.object.mode_set(mode='OBJECT')
# the neck seam's height, kept apart from the head's pivot (face_rig.py later moves the pivot up to the skull base)
rig['neck_seam_z'] = float(neck_z)
rig['body_measures'] = json.dumps(MEAS)                  # holo_detail.py reads the arms' roots from here
hb = arm.vrm_addon_extension.vrm1.humanoid.human_bones
VRM = {'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head'}
for side, word in (('L', 'left'), ('R', 'right')):
    for part in ('shoulder', 'upper_arm', 'lower_arm', 'hand', 'upper_leg', 'lower_leg', 'foot', 'toes'):
        VRM[f'{part}.{side}'] = f'{word}_{part}'
for b, hname in VRM.items(): getattr(hb, hname).node.bone_name = b
# weights: bone heat; vertices it leaves unweighted copy the weights of the nearest weighted vertex over the surface
for o in sc.objects: o.select_set(False)
ob.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
co = mesh_co(me); ED = mesh_edges(me)
weighted = np.array([any(g.weight > 0 for g in v.groups) for v in me.vertices])
print('FIG bone heat weighted', int(weighted.sum()), 'of', len(weighted))
segs_all = [(n, np.array(arm.bones[n].head_local[:]), np.array(arm.bones[n].tail_local[:])) for n in BONES]
for n, _, _ in segs_all:
    if n not in ob.vertex_groups: ob.vertex_groups.new(name=n)
def segd(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(a + np.multiply.outer(t, ab) - p, axis=-1)
def heat_weights(co, tris, segs, cap=3000, rtol=1e-6):
    """Blender's bone heat (Baran & Popovic 2007) solved here, for when Blender's own solver gives up on a mesh: per bone,
    (-Laplacian + H) w = H p over the surface, with the cotangent Laplacian (each vertex weighted by its area), H = 1/d^2
    for the distance d to the nearest bone and p = 1 where that bone is the nearest. Conjugate gradients, all bones at
    once (NUMERIC: cap on the iterations, relative residual). Each vertex keeps its 4 largest weights (glTF's influence
    limit, STRUCTURAL), summing to one."""
    n = len(co); D = np.stack([segd(co, a, b) for _, a, b in segs], 1); near = D.argmin(1)
    h = 1.0 / np.maximum(D[np.arange(n), near], 1e-9) ** 2
    tA = 0.5 * np.linalg.norm(np.cross(co[tris[:, 1]] - co[tris[:, 0]], co[tris[:, 2]] - co[tris[:, 0]]), axis=1)
    area = sum(np.bincount(tris[:, k], tA / 3, n) for k in range(3))
    I, Jn, W = [], [], []
    for k in range(3):
        i, j, l = tris[:, k], tris[:, (k + 1) % 3], tris[:, (k + 2) % 3]; e1, e2 = co[i] - co[l], co[j] - co[l]
        W.append(0.5 * (e1 * e2).sum(1) / np.maximum(np.linalg.norm(np.cross(e1, e2), axis=1), 1e-12)); I.append(i); Jn.append(j)
    I, Jn, W = np.concatenate(I), np.concatenate(Jn), np.concatenate(W)
    dia = area * h
    def Amul(x):
        f = W[:, None] * (x[I] - x[Jn]); out = dia[:, None] * x
        np.add.at(out, I, f); np.add.at(out, Jn, -f); return out
    P_ = np.zeros((n, len(segs))); P_[np.arange(n), near] = 1; b = dia[:, None] * P_
    x = P_.copy(); r = b - Amul(x); p = r.copy(); rr = (r * r).sum(0); b2 = (b * b).sum(0)
    for it in range(cap):
        Ap = Amul(p); al = rr / np.maximum((p * Ap).sum(0), 1e-30); x += al * p; r -= al * Ap
        rr2 = (r * r).sum(0)
        if np.all(rr2 <= rtol ** 2 * b2): break
        p = r + (rr2 / np.maximum(rr, 1e-30)) * p; rr = rr2
    x = np.clip(x, 0, None); keep = np.argsort(-x, 1)[:, :4]; w = np.zeros_like(x)
    np.put_along_axis(w, keep, np.take_along_axis(x, keep, 1), 1); w /= np.maximum(w.sum(1, keepdims=True), 1e-12)
    w[w.sum(1) == 0, :] = P_[w.sum(1) == 0, :]
    return w, it + 1
if not weighted.any():
    w_h, its = heat_weights(co, mesh_tris(me), segs_all)
    for k, (n, _, _) in enumerate(segs_all):
        for i in np.nonzero(w_h[:, k] > 0)[0]: ob.vertex_groups[n].add([int(i)], float(w_h[i, k]), 'REPLACE')
    weighted[:] = True
    print('FIG Blender bone heat found no solution: heat weights solved here (%d iterations)' % its)
elif not weighted.all():
    src_of = np.full(len(co), -1); src_of[weighted] = np.nonzero(weighted)[0]
    q = deque(np.nonzero(weighted)[0].tolist()); adj = [[] for _ in range(len(co))]
    for a, b in ED: adj[a].append(b); adj[b].append(a)
    while q:
        i = q.popleft()
        for j in adj[i]:
            if src_of[j] < 0: src_of[j] = src_of[i]; q.append(j)
    for i in np.nonzero(~weighted & (src_of >= 0))[0]:
        for g in me.vertices[int(src_of[i])].groups: ob.vertex_groups[g.group].add([int(i)], g.weight, 'REPLACE')
# where the drawing's hands touched the body the mesh is fused: a vertex may follow an arm only inside that arm's measured
# tube (each section's own reach from its centre, between the arm's root and the wrist), on the hand (the surface beyond
# the wrist connected to it), or on the shoulder cap (nearer the shoulder than the root, above the armpit). Then every
# vertex's weights sum to one.
TORSO = [ob.vertex_groups[n] for n in ('hips', 'spine', 'chest', 'upper_leg.L', 'upper_leg.R') if n in ob.vertex_groups]
torso_segs = [(np.array(arm.bones[g.name].head_local[:]), np.array(arm.bones[g.name].tail_local[:])) for g in TORSO]
may_follow = {}
for side, A_ in ARMS.items():
    sho_, u_ = np.array(A_['sho']), np.array(A_['u']); sv = (co - sho_) @ u_
    ok = np.zeros(len(co), bool)
    if A_['tube']:
        ts = np.array([t[0] for t in A_['tube']]); tc = np.array([t[1] for t in A_['tube']]); tr = np.array([t[2] for t in A_['tube']])
        k = np.clip(np.searchsorted(ts, sv), 1, len(ts) - 1); f = np.clip((sv - ts[k - 1]) / np.maximum(1e-9, ts[k] - ts[k - 1]), 0, 1)
        c_ = tc[k - 1] + (tc[k] - tc[k - 1]) * f[:, None]; off = co - c_; off -= np.outer(off @ u_, u_)
        ok |= (sv >= A_['s_root']) & (sv <= A_['s_wrist']) & (np.linalg.norm(off, axis=1) <= np.maximum(tr[k - 1], tr[k]))
    bey = sv > A_['s_wrist']
    if bey.any():
        cand = np.nonzero(bey)[0]; wc = np.array(A_['tube'][-1][1]) if A_['tube'] else sho_ + u_ * A_['s_wrist']
        dw = np.linalg.norm(co[cand] - wc, axis=1); reach_w = A_['tube'][-1][2] if A_['tube'] else float(dw.min()); hand_ok = np.zeros(len(co), bool)
        for st in cand[dw <= max(reach_w, float(dw.min()))]:          # every finger's patch, as where the hand was measured
            if not hand_ok[st]: hand_ok |= flood(ED, len(co), bey, int(st))
        ok |= hand_ok
    ok |= (sv < A_['s_root']) & (co[:, 2] >= A_['armpit_z'])
    may_follow[side] = ok
gidx = {n: ob.vertex_groups[n].index for n in BONES}
stripped = 0
for v in me.vertices:
    ws = {g.group: g.weight for g in v.groups if g.weight > 0}
    for side in ('L', 'R'):
        own = {gidx[f'{p}.{side}'] for p in ('shoulder', 'upper_arm', 'lower_arm', 'hand')}
        if not (own & set(ws)) or may_follow[side][v.index]: continue
        for k in list(ws):
            if k in own: ob.vertex_groups[k].remove([v.index]); ws.pop(k)
        if not ws:
            d = [float(segd(np.array(v.co[:]), a, b)) for a, b in torso_segs]; g0 = TORSO[int(np.argmin(d))]
            ws = {g0.index: 1.0}; g0.add([v.index], 1.0, 'REPLACE')
        stripped += 1
for v in me.vertices:
    tot = sum(g.weight for g in v.groups)
    if tot > 0 and abs(tot - 1) > 1e-6:
        for g in v.groups: ob.vertex_groups[g.group].add([v.index], g.weight / tot, 'REPLACE')
print('FIG arm weights stripped from', stripped, 'vertices outside the arms')
# a skirt (or coat) hangs from the hips: above the height where the two legs' sections merge (a hem or a crotch), the
# surface follows the legs by the share of its ring around the leg that the leg itself fills: the leg's own section area
# (measured just below the merge) over the disc reaching out to the vertex. A trouser leg is filled by the leg (share 1,
# unchanged); a skirt's cloth far from the leg follows it little.
gh = ob.vertex_groups['hips']; legs = [ob.vertex_groups[f'{p}.{s_}'] for s_ in 'LR' for p in ('upper_leg', 'lower_leg')]
leg_ix = {g.index for g in legs}
ul = {s_: (np.array(arm.bones[f'upper_leg.{s_}'].head_local[:]), np.array(arm.bones[f'upper_leg.{s_}'].tail_local[:])) for s_ in 'LR'}
merge_z = min(L_['merge_z'] for L_ in LEGS.values()); eased = 0; shares = []
for v in me.vertices:
    if v.co.z < merge_z: continue
    ws = {g.group: g.weight for g in v.groups}; leg_w = sum(ws.get(i, 0) for i in leg_ix)
    if leg_w <= 0: continue
    p_ = np.array(v.co[:]); ds = {s_: float(segd(p_, *ul[s_])) for s_ in 'LR'}; s_ = min(ds, key=ds.get)
    share = min(1.0, LEGS[s_]['leg_area'] / (math.pi * max(ds[s_], 1e-9) ** 2))
    if share >= 1.0: continue
    for g in legs:
        if g.index in ws: g.add([v.index], ws[g.index] * share, 'REPLACE')
    rest = 1 - share * leg_w - sum(w_ for k, w_ in ws.items() if k not in leg_ix | {gh.index})
    gh.add([v.index], max(0.0, rest), 'REPLACE'); eased += 1; shares.append(share)
print('FIG legs merge at %.3f; %d vertices above it follow the legs less (share median %.2f)' % (merge_z, eased, float(np.median(shares)) if shares else 1))

# ── 4. VRM export ────────────────────────────────────────────────────────────────────────────────────────────────────
meta = arm.vrm_addon_extension.vrm1.meta; meta.vrm_name = f'{NAME} (prototype figure)'
a_ = meta.authors.add(); a_.value = 'novel-ontology-pi figure pipeline'
try: meta.avatar_permission = 'onlyAuthor'; meta.commercial_usage = 'personalNonProfit'; meta.allow_redistribution = False; meta.modification = 'prohibited'
except Exception as e: print('FIG meta', e)
for o in sc.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
vrm_path = os.path.join(OUT, f'{NAME}.vrm')
print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm_path), os.path.exists(vrm_path) and os.path.getsize(vrm_path))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{NAME}.blend'))

# ── renders: toon and hologram, rest pose and a walk pose (previews only; nothing here reaches the VRM) ──────────────
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
