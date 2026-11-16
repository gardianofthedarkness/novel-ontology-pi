"""Replace a rigged figure's smoothed mesh with the generator's own (detailed) mesh, reduced to a readable triangle count,
keeping the skeleton: bone weights are copied from the smoothed mesh (nearest surface). For the triangle hologram look.
usage: blender -b -P holo_detail.py -- <rig.blend from dress_rig> <raw-mesh.glb> <out.blend> [--tris=N] [--smooth=N] [--asis=1] [--vrm=1] [--cut=0]
  --asis=1: the mesh is already reduced (rawmerge/reduce.py) and is taken as it is. --vrm=1: also export <out>.vrm.
  The speckle smoothing runs as many passes as the speckle needs (the knee of the Laplacian's fall) and measures the
  speckle's size; the mesh is then decimated as far as its surface stays within that size of the smoothed surface.
  --tris / --smooth override the measured triangle count / pass count (a look choice, off by default)."""
import bpy, os, sys, json, math
import numpy as np
from collections import deque
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
RIG, RAW, OUT = [a for a in argv if not a.startswith('--')][:3]
H = 1.6                                                          # STRUCTURAL: every figure stands 1.6 m tall
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=RIG)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; body = bpy.data.objects['Body']
for o in list(sc.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o, do_unlink=True)
before = set(sc.objects)
bpy.ops.import_scene.gltf(filepath=RAW, merge_vertices='asis' in flags)   # a reduced file repeats a point per triangle corner
new = [o for o in sc.objects if o not in before]
ms = [o for o in new if o.type == 'MESH']
with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
    if len(ms) > 1: bpy.ops.object.join()
ob = ms[0]
for o in new:
    if o != ob and o.name in bpy.data.objects: bpy.data.objects.remove(o, do_unlink=True)
ob.parent = None
with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], object=ob):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
def mesh_co(me): c = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', c); return c.reshape(-1, 3)
def mesh_edges(me): e = np.zeros(len(me.edges) * 2, np.int64); me.edges.foreach_get('vertices', e); return e.reshape(-1, 2)
def smooth_to_knee(me, cap=32, passes=None):
    """Laplacian smoothing (each vertex half way to its neighbours' mean) for as many passes as remove the speckle: the
    median length of the Laplacian falls fast while the speckle goes and slowly once only the shape is left; the pass
    count is the knee of that curve (the pass farthest below the straight line from the first to the last pass).
    Returns the pass count and the speckle's size: the median distance the vertices moved. (as in dress_rig.py)"""
    c0 = mesh_co(me); E = mesh_edges(me); n = len(c0)
    deg = np.maximum(1, np.bincount(E.ravel(), minlength=n)).astype(float)
    def lap(c): return np.stack([np.bincount(E[:, 0], c[E[:, 1], k], n) + np.bincount(E[:, 1], c[E[:, 0], k], n) for k in range(3)], 1) / deg[:, None] - c
    if passes is None:
        c = c0.copy(); hist = []
        for k in range(cap + 1):
            L = lap(c); hist.append(float(np.median(np.linalg.norm(L, axis=1))))
            if k < cap: c = c + 0.5 * L
        h = np.array(hist); x = np.arange(cap + 1) / cap; y = (h - h[-1]) / max(1e-12, h[0] - h[-1]); passes = int(np.argmax(1 - x - y))
    c = c0.copy()
    for _ in range(passes): c = c + 0.5 * lap(c)
    me.vertices.foreach_set('co', c.ravel()); me.update()
    return passes, float(np.median(np.linalg.norm(c - c0, axis=1)))
def decimate_within(ob, tol, iters=8, sample=20000):
    """the smallest collapse-decimation ratio whose surface stays within tol of the current surface (the largest distance
    of the current vertices to the decimated faces), by bisection on the ratio's logarithm (as in dress_rig.py)"""
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
    return 2 ** hi_
# the same placement dress_rig.py gave the smoothed mesh: 1.6 m tall, feet at 0, centred
co = mesh_co(ob.data); lo, hi = co.min(0), co.max(0); s = H / (hi[2] - lo[2])
ob.data.transform(Matrix.Translation((-(lo[0] + hi[0]) / 2 * s, -(lo[1] + hi[1]) / 2 * s, -lo[2] * s)) @ Matrix.Scale(s, 4))
# the smoothing removes the generator's speckle but keeps the folds, hair strands and face relief. dress_rig.py measured
# the pass count and the speckle's size on this same mesh (the size over the points on the picture's figure only, so a
# generated floor plate doesn't count); those are used when present
MEAS = json.loads(rig['body_measures']) if 'body_measures' in rig else None
if 'asis' in flags:      # a mesh already reduced (rawmerge/reduce.py): taken as it is
    import bmesh as _bm
    b_ = _bm.new(); b_.from_mesh(ob.data); _bm.ops.remove_doubles(b_, verts=b_.verts[:], dist=float(np.finfo(np.float32).eps)); 
    # loose fragments the reduction split off (a fingertip's few triangles) are dropped: the figure is its largest piece
    b_.verts.ensure_lookup_table(); lab = {}; sizes = []
    for v in b_.verts:
        if v.index in lab: continue
        k = len(sizes); st = [v]; lab[v.index] = k; n_ = 0
        while st:
            x = st.pop(); n_ += 1
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in lab: lab[y.index] = k; st.append(y)
        sizes.append(n_)
    big = int(np.argmax(sizes)); loose = [v for v in b_.verts if lab[v.index] != big]; print('FIG loose pieces dropped: %d (%d points)' % (len(sizes) - 1, len(loose)))
    _bm.ops.delete(b_, geom=loose, context='VERTS'); b_.to_mesh(ob.data); b_.free()   # NUMERIC: the file repeats a point per triangle corner; the copies are the same point to float precision
    me = ob.data; print('FIG mesh taken as it is: %d triangles' % len(me.polygons))
    for p in me.polygons: p.use_smooth = False
else:
    passes, NOISE = smooth_to_knee(ob.data, passes=int(flags['smooth']) if 'smooth' in flags else MEAS['smooth_passes'] if MEAS else None)
    if MEAS and 'smooth' not in flags: NOISE = MEAS['noise']
    nf = len(ob.data.polygons)
    ratio = min(1.0, int(flags['tris']) / max(1, nf)) if 'tris' in flags else decimate_within(ob, NOISE)
    dc = ob.modifiers.new('dc', 'DECIMATE'); dc.ratio = ratio; dc.use_collapse_triangulate = True
    tri = ob.modifiers.new('tri', 'TRIANGULATE')
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
    for p in me.polygons: p.use_smooth = False
    print('FIG speckle %.2f mm (%d smoothing passes); decimated %d -> %d triangles (ratio %.4f), the surface within the speckle'
          % (NOISE * 1000, passes, nf, len(me.polygons), ratio))
# weights: copy every bone group from the smoothed mesh
for g in body.vertex_groups: ob.vertex_groups.new(name=g.name)
dt = ob.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = body; dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
    bpy.ops.object.modifier_apply(modifier='dt')
names = {g.index: g.name for g in ob.vertex_groups}
def dominant(v): return names[max(v.groups, key=lambda g: g.weight).group] if v.groups else None
BODY = ('hips', 'spine', 'upper_leg', 'lower_leg')
def segd(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(a + np.multiply.outer(t, ab) - p, axis=-1)
# the arm itself: the surface past the arm's root (where dress_rig.py measured the arm's section part from the torso's,
# along the line from the shoulder joint to the wrist) that follows this arm at all and is connected to the hand. In an
# A-pose the inner side of the arm lies a centimetre from the ribs, so nearest-surface weights mix them; connectivity
# doesn't. That region follows only this arm's bones; nothing else past the root on the arm's side follows the arm.
co = mesh_co(me); E = mesh_edges(me); dom = [dominant(v) for v in me.vertices]
adj = [[] for _ in range(len(co))]
for a, b in E: adj[a].append(b); adj[b].append(a)
regions = {}
for s in ('L', 'R'):
    chain = [f'{n}.{s}' for n in ('shoulder', 'upper_arm', 'lower_arm', 'hand')]
    bones = [rig.data.bones[n] for n in chain]
    if MEAS: A_ = MEAS['arms'][s]; sh = np.array(A_['sho']); ax = np.array(A_['u']); root = A_['s_root']
    else:   # an older rig: the upper arm's own line and its head
        sh = np.array(bones[1].head_local[:]); ax = np.array(bones[1].tail_local[:]) - sh; ax /= np.linalg.norm(ax); root = 0.0
    past = (co - sh) @ ax > root
    # (any weight on this arm counts: dress_rig.py already kept arm weights to the arm's measured tube and the hand, and a
    # few arm points whose largest weight is the chest's must still go with the arm)
    mine = past & np.array([any(names[g.group] in chain and g.weight > 0 for g in v.groups) for v in me.vertices])
    cand = np.nonzero(mine)[0]
    if not len(cand): print('FIG arm', s, 'no surface past its root follows it'); continue
    # every connected patch of that surface that runs out past the elbow joint is the arm's: on a layered figure the sleeve's
    # shell and the arm inside it are separate patches, and both are the arm; a patch of the torso's side that only carries
    # some arm weight (an A-pose's ribs) never reaches the elbow
    elbow = float((np.array(bones[2].head_local[:]) - sh) @ ax); along = (co - sh) @ ax
    region = np.zeros(len(co), bool); seen = np.zeros(len(co), bool)
    for start in cand:
        if seen[start]: continue
        patch = [int(start)]; seen[start] = True; q = deque([int(start)])
        while q:
            i = q.popleft()
            for j in adj[i]:
                if mine[j] and not seen[j]: seen[j] = True; patch.append(j); q.append(j)
        if along[patch].max() > elbow: region[patch] = True
    regions[s] = (region, past, chain, sh, ax)
    print('FIG arm', s, 'region', int(region.sum()), 'vertices (', round(region.mean() * 100, 1), '% of the figure), past the root at', round(root, 3), 'm')
# where the drawing's hand touched the hip, the generated surface joins arm and body: cut the triangles that join an
# arm's region to surface following the torso or legs, so a raised arm doesn't pull a sheet of skin off the skirt
import bmesh
bm = bmesh.new(); bm.from_mesh(me)
inreg = np.zeros(len(co), bool)
for r in regions.values(): inreg |= r[0]
isbody = np.array([bool(d) and d.split('.')[0] in BODY for d in dom])
bridge = [f for f in bm.faces if any(inreg[v.index] for v in f.verts) and any(isbody[v.index] for v in f.verts)]
if flags.get('cut') == '0': bridge = []      # a figure made in a T-pose has no hand on a hip to free; cutting there only tears the armpit
keep = None
if bridge:
    # deleting faces renumbers the vertices: carry the per-vertex arrays through a layer
    lay = bm.verts.layers.int.new('orig')
    for v in bm.verts: v[lay] = v.index
    bmesh.ops.delete(bm, geom=bridge, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]; bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.verts.ensure_lookup_table(); keep = np.array([v[lay] for v in bm.verts])
    bm.to_mesh(me); me.update()
bm.free()
print('FIG cut', len(bridge), 'arm-to-body triangles')
if keep is not None:
    co = co[keep]; regions = {s: (r[0][keep], r[1][keep], *r[2:]) for s, r in regions.items()}
segs = {b.name: (np.array(b.head_local[:]), np.array(b.tail_local[:])) for b in rig.data.bones}
for s, (region, past, chain, sh, ax) in regions.items():
    other = [n for n in segs if n not in chain]
    side = np.sign(sh[0])
    for i in range(len(co)):
        vg = {names[g.group]: g.weight for g in me.vertices[i].groups}
        if region[i]:
            keepw = {n: w for n, w in vg.items() if n in chain and w > 0}
            for n in vg:
                if n not in keepw: ob.vertex_groups[n].remove([i])
            if not keepw:
                d = {n: float(segd(co[i], *segs[n])) for n in chain}; keepw = {min(d, key=d.get): 1.0}
            tot = sum(keepw.values())
            for n, w in keepw.items(): ob.vertex_groups[n].add([i], w / tot, 'REPLACE')
        elif past[i] and co[i, 0] * side > 0 and any(n in chain for n in vg):
            for n in chain:
                if n in vg: ob.vertex_groups[n].remove([i])
            rest = {n: w for n, w in vg.items() if n not in chain and w > 0}
            if not rest:   # nothing else: the nearest bone outside this arm
                d = {n: float(segd(co[i], *segs[n])) for n in other}; rest = {min(d, key=d.get): 1.0}
            tot = sum(rest.values())
            for n, w in rest.items(): ob.vertex_groups[n].add([i], w / tot, 'REPLACE')
ob.parent = rig; am = ob.modifiers.new('Armature', 'ARMATURE'); am.object = rig
# one plain white material (the hologram look is made by the viewer, not by colour)
mat = bpy.data.materials.new('white'); mat.diffuse_color = (0.92, 0.93, 0.95, 1)
m = mat.vrm_addon_extension.mtoon1; m.enabled = True; m.pbr_metallic_roughness.base_color_factor = (0.92, 0.93, 0.95, 1)
me.materials.clear(); me.materials.append(mat)
weighted = sum(1 for v in me.vertices if any(g.weight > 0 for g in v.groups))
bpy.data.objects.remove(body, do_unlink=True)
ob.name = me.name = 'Body'
print('FIG detail mesh', len(me.vertices), 'verts', len(me.polygons), 'triangles; weighted', weighted)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
if 'vrm' in flags:
    vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
print('FIG saved', OUT)
