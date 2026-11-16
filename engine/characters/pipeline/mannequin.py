"""Turn a rigged base body (generated wearing a fitted base layer) into a smooth, featureless mannequin body: the fabric's
thickness taken off, creases, cuffs, seams and shoe edges smoothed away, an even surface; weights kept (or copied back).
usage: blender -b -P mannequin.py -- <base_detail.blend> <out.blend>
  Every size is the body's own: the mesh is brought to a step of half the body's thinnest part's radius; the floor plate
  is the bottom run of slabs under the ankles (the rig's foot joints) wider than anything above it, in slabs and cells of
  the mesh's step (its median edge length); the smoothing runs to where the surface's wrinkle measure is lowest; the
  fabric taken off is the median distance the smoothing moved the surface. A body that is not one closed surface is
  voxel-remeshed first and its weights copied back."""
import bpy, bmesh, os, sys
import numpy as np
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = [a for a in argv if not a.startswith('--')][:2]
MAX_PASSES = 1024    # an iteration cap only: the smoothing stops by its own measure long before (the measure is lowest at 128 passes on the test bodies)
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene; rig = bpy.data.objects['Armature']; body = bpy.data.objects['Body']
src = body.copy(); src.data = body.data.copy(); sc.collection.objects.link(src); src.name = 'weights_source'
for m in list(body.modifiers): body.modifiers.remove(m)
co0 = np.array([v.co[:] for v in body.data.vertices]); E0 = np.array([e.vertices[:] for e in body.data.edges])
TRIS = sum(len(p.vertices) - 2 for p in body.data.polygons)
STEP = float(np.median(np.linalg.norm(co0[E0[:, 0]] - co0[E0[:, 1]], axis=1)))     # the input's own resolution
def apply(ob, mods):
    for kind, setup in mods:
        m = ob.modifiers.new(kind.lower(), kind); setup(m)
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
def outward(ob, keep_largest=False):
    """every face turned outward (the second Index base had half its faces inward: the shrink then pushed them out and the
    page's back-face culling hid them), and with keep_largest only the biggest piece kept (a voxel remesh can close
    pockets, between long hair and the back, into inner shells)"""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    if keep_largest:
        seen, parts = set(), []
        for f in bm.faces:
            if f.index in seen: continue
            stack, part = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop(); part.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen: seen.add(h.index); stack.append(h)
            parts.append(part)
        parts.sort(key=len, reverse=True)
        bmesh.ops.delete(bm, geom=[f for p in parts[1:] for f in p], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free(); ob.data.update()
def floor_plate(ob):
    """a ground shadow drawn under the feet comes back from the shape model as a thin plate joined to the soles (Akane's and
    Rikka's base bodies: 1.3 m deep). The mesh below the ankles (the rig's foot joints) is cut into slabs one mesh step
    thick and each slab's outline counted in cells of one step: the plate is the bottom run of slabs whose smallest
    outline is larger than every slab's above it, split where that jump (in log area) is largest. Every face in it goes
    (what stands on the plate stands on its top, so the soles are closed flat there; keeping the plate under the feet left
    fins of plate round the soles). Returns the faces cut and the x, y box of the body above the plate (what the
    finished body must stay inside)"""
    bm = bmesh.new(); bm.from_mesh(ob.data); co = np.array([v.co[:] for v in bm.verts]); z0 = co[:, 2].min()
    E = np.array([[v.index for v in e.verts] for e in bm.edges]); step = float(np.median(np.linalg.norm(co[E[:, 0]] - co[E[:, 1]], axis=1)))
    ankle = max(rig.data.bones[b].head_local.z for b in ('foot.L', 'foot.R') if b in rig.data.bones)
    nz = int(np.ceil((ankle - z0) / step)); sl = ((co[:, 2] - z0) / step).astype(int)
    ij = np.floor((co[:, :2] - co[:, :2].min(0)) / step).astype(int); key = ij[:, 0] * (1 << 20) + ij[:, 1]
    if nz < 2: bm.free(); return 0, (co[:, :2].min(0), co[:, :2].max(0))
    lc = np.log([max(1, len(np.unique(key[sl == k]))) for k in range(nz)])
    jumps = [lc[:i + 1].min() - lc[i + 1:].max() for i in range(nz - 1)]
    top = z0 + (int(np.argmax(jumps)) + 1) * step if max(jumps) > 0 else z0
    above = co[:, 2] >= top; box = (co[above, :2].min(0), co[above, :2].max(0))
    # cut along the plane of the plate's top (a clean outline of each foot there; deleting the faces under it left loops
    # that touched themselves, and their fills overlapped)
    dead = sum(1 for f in bm.faces if f.calc_center_median().z < top)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, top), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # the soles left open by the cut are closed again (the body stays one closed surface for the smoothing)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(ob.data); bm.free(); ob.data.update(); return dead, box
# the smoothing works on a mesh whose step is half the radius of the body's thinnest part (two samples across it: the
# finest the body's own shape needs; each bone's radius is the median distance of its dominant points from it). Taubin's
# smoothing keeps waves a fixed number of steps long, so on a finer mesh it keeps the waist seam and the cuffs as soft
# ramps (Akane's 4 mm base after 128 passes), on this one it takes them off. A finer body is decimated to it (which keeps
# the legs apart and the weights on; a voxel remesh at the input's own 1.7 cm step fused the thighs down to the knees);
# a body with holes or loose edges is voxel-remeshed at that step instead and gets its weights copied back at the end
gn = {g.index: g.name for g in body.vertex_groups}; radii = {}
dom = np.array([gn[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in body.data.vertices])
for b in rig.data.bones:
    m = dom == b.name
    if not m.any(): continue
    a, c = np.array(b.head_local[:]), np.array(b.tail_local[:]); ab = c - a
    tt = np.clip(((co0[m] - a) @ ab) / max(ab @ ab, 1e-12), 0, 1); radii[b.name] = float(np.median(np.linalg.norm(a + np.outer(tt, ab) - co0[m], axis=1)))
GRID = max(STEP, min(radii.values()) / 2)
bm = bmesh.new(); bm.from_mesh(body.data); closed = all(e.is_manifold for e in bm.edges); bm.free()
if not closed:
    body.vertex_groups.clear()
    apply(body, [('REMESH', lambda m: (setattr(m, 'mode', 'VOXEL'), setattr(m, 'voxel_size', GRID)))])
elif GRID > STEP:
    apply(body, [('DECIMATE', lambda m: (setattr(m, 'ratio', (STEP / GRID) ** 2), setattr(m, 'use_collapse_triangulate', True))), ('TRIANGULATE', lambda m: None)])
print('FIG input step %.4f m; thinnest part %s radius %.3f m; smoothing step %.4f m; closed as it came: %s' % (STEP, min(radii, key=radii.get), min(radii.values()), GRID, closed), flush=True)
outward(body, keep_largest=True)
cut, box = floor_plate(body)
print('FIG floor plate faces cut: %d' % cut, flush=True)
outward(body, keep_largest=True)
# the smoothing: Taubin's two-step (shrink by 1/2, grow back by 0.53 of the umbrella move) removes short waves (creases,
# cuffs, seams) and leaves the body's shape and size, where plain Laplacian smoothing shrinks thin limbs and Blender's
# volume-preserving one blows the whole body up to keep its volume (+9 % in height after 30 passes). Its slight gain on
# the longest waves adds up over many passes (Rikka's 2 cm base grew 3.5 cm in 512), so only pass counts that keep the
# body inside the x, y box it stood in (one mesh step of play, the same test as the end check) are candidates; with equal
# halves (no gain at all) the measure below kept falling to the cap while the body shrank 2-3 cm.
# The wrinkle measure is how much the mean curvature (cotangent formula: the same on a coarse or a dense mesh) differs
# from its neighbours' average, averaged over the surface by area: a crease is curvature that changes over a few points,
# a limb's or the torso's own curvature changes slowly and drops out. The pass count is the candidate, of doublings up to
# the cap, where the measure is lowest (128 on Akane's bodies; past that it rises again). The umbrella curvature's
# spread, tried first, followed the tessellation and stopped at 4 passes on a 4 mm body, leaving cuffs and seams
me = body.data
E = np.array([e.vertices[:] for e in me.edges]); me.calc_loop_triangles()
T = np.array([t.vertices[:] for t in me.loop_triangles]); n = len(me.vertices)
deg = np.maximum(np.bincount(E.ravel(), minlength=n), 1).astype(float)
def umbrella(P):
    s = np.stack([np.bincount(E[:, 0], P[E[:, 1], j], n) + np.bincount(E[:, 1], P[E[:, 0], j], n) for j in range(3)], 1)
    return s / deg[:, None] - P
def normals(P):
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    vn = np.stack([sum(np.bincount(T[:, j], fn[:, a], n) for j in range(3)) for a in range(3)], 1)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
def wrinkle(P):
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    def cot(u, v): return (u * v).sum(1) / np.maximum(np.linalg.norm(np.cross(u, v), axis=1), 1e-15)
    L = np.zeros_like(P)
    for i, j, w in ((1, 2, cot(b - a, c - a)), (2, 0, cot(a - b, c - b)), (0, 1, cot(a - c, b - c))):   # edge opposite each corner
        d = P[T[:, j]] - P[T[:, i]]
        for k in range(3): L[:, k] += np.bincount(T[:, i], w * d[:, k], n) - np.bincount(T[:, j], w * d[:, k], n)
    A = sum(np.bincount(T[:, j], np.linalg.norm(np.cross(b - a, c - a), axis=1) / 6, n) for j in range(3))
    H = (L * normals(P)).sum(1) / np.maximum(2 * A, 1e-15)
    ring = (np.bincount(E[:, 0], H[E[:, 1]], n) + np.bincount(E[:, 1], H[E[:, 0]], n)) / deg
    return float(np.average(np.abs(H - ring), weights=A))
def taubin(P): P = P + 0.5 * umbrella(P); return P - 0.53 * umbrella(P)
def reach(P): return float(np.max(np.concatenate([box[0] - P[:, :2], P[:, :2] - box[1]])))
P0 = np.array([v.co[:] for v in me.vertices]); Q, done = P0.copy(), 0; hist = [(0, wrinkle(P0), P0)]
while done < MAX_PASSES:
    nxt = max(1, 2 * done)
    for _ in range(nxt - done): Q = taubin(Q)
    hist.append((nxt, wrinkle(Q), Q.copy())); done = nxt
done, _, P = min([h for h in hist if reach(h[2]) <= GRID] or hist[:1], key=lambda h: h[1])
hist = [(h[0], round(h[1], 3), round(reach(h[2]), 3)) for h in hist]
print('FIG smoothing passes', done, '(passes, wrinkle, reach outside the box m)', hist, flush=True)
# the fabric's thickness: the median distance from the surface before the smoothing to the smoothed one (how far the
# creases, cuffs and seams stood off it); the surface moves in by that much along its normals
bvh = BVHTree.FromPolygons([tuple(p) for p in P.tolist()], [tuple(p.vertices) for p in me.polygons])
SHRINK = float(np.median([bvh.find_nearest(tuple(c))[3] for c in P0]))
P = P - SHRINK * normals(P)
for v, c in zip(me.vertices, P): v.co = c
me.update()
print('FIG fabric taken off %.4f m' % SHRINK, flush=True)
if not closed:
    # back to the input's triangle count, then the weights copied from the input body
    n = sum(len(p.vertices) - 2 for p in body.data.polygons)
    apply(body, [('DECIMATE', lambda m: (setattr(m, 'ratio', min(1.0, TRIS / max(1, n))), setattr(m, 'use_collapse_triangulate', True)))])
apply(body, [('TRIANGULATE', lambda m: None)])
outward(body)
for p in body.data.polygons: p.use_smooth = False
if not closed:
    for g in src.vertex_groups: body.vertex_groups.new(name=g.name)
    dt = body.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = src; dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    with bpy.context.temp_override(active_object=body, object=body, selected_editable_objects=[body]):
        bpy.ops.object.modifier_apply(modifier='dt')
body.parent = rig; am = body.modifiers.new('Armature', 'ARMATURE'); am.object = rig
body.data.materials.clear(); body.data.materials.append(src.data.materials[0] if src.data.materials else None)
co1 = np.array([v.co[:] for v in body.data.vertices])
print('FIG mannequin', len(body.data.polygons), 'triangles; bounds before', co0.min(0).round(3), co0.max(0).round(3), 'after', co1.min(0).round(3), co1.max(0).round(3), flush=True)
bpy.data.objects.remove(src, do_unlink=True)
# the body must stay inside the x, y box of what stood above the floor plate (one mesh step of play): anything outside
# is a plate or a shell that survived
out = float(np.max(np.concatenate([box[0] - co1[:, :2], co1[:, :2] - box[1]])))
print('FIG reach outside the body above the floor %.4f m (x, y lows / highs)' % out, (box[0] - co1[:, :2].min(0)).round(3), (co1[:, :2].max(0) - box[1]).round(3), flush=True)
if out > GRID: raise SystemExit('FIG the mannequin reaches %.2f m outside the body above the floor: something besides the body is left' % out)
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
