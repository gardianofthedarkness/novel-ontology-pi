"""The merged raw figure reduced to a readable triangle count, before any rig (for the triangle hologram).
usage: blender -b -P reduce.py -- <merged.glb> <out.glb> <out.json> [--head=<head_region.glb>] [--body=<share>] [--pass1=<file.glb>] [--tol=<metres>] [--tris=N]
  smooth   the merged surface comes out of a volume grid, so it carries that grid's staircase: Laplacian smoothing for as
           many passes as take the staircase off (the knee of the Laplacian's fall, as pipeline/holo_detail.py). The median
           distance the points moved is the staircase's size: the noise the merge itself put on the surface.
  reduce   collapse decimation as far as the reduced surface stays, on average, within that staircase size of the smoothed
           one: the reduction adds no more error than the merge's own noise.
  --head   the head finer than the body: the points inside the solid the merge kept the bust in are held to the same
           tolerance times the head's share of the figure's height (framed alone, the head is as true as the whole figure
           framed alone). Two passes: the whole figure down to what the head allows, then the body alone further.
  --body   with --head: the body held to this share of the measured tolerance (a finer body; a look choice, 1 by default).
  --pass1  with --head: the first pass's mesh is written there, or read from there when it exists (the slow pass, shared by runs).
  --tol / --tris override the tolerance / the triangle count (a look choice, off by default).
The model keeps its place (1.6 m, feet at 0, as the merge left it). Writes the reduced model and what was measured."""
import bpy, json, math, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict(a[2:].split('=', 1) for a in argv if a.startswith('--'))
SRC, OUT, REC = [a for a in argv if not a.startswith('--')][:3]
sc = bpy.context.scene
for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=SRC, merge_vertices=True)
ms = [o for o in sc.objects if o.type == 'MESH']
with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms, object=ms[0]):
    if len(ms) > 1: bpy.ops.object.join()
ob = ms[0]
for o in [o for o in sc.objects if o != ob]: bpy.data.objects.remove(o, do_unlink=True)
ob.parent = None
with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], object=ob):
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
ob.data.materials.clear()
def mesh_co(me): c = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', c); return c.reshape(-1, 3)
def mesh_edges(me): e = np.zeros(len(me.edges) * 2, np.int64); me.edges.foreach_get('vertices', e); return e.reshape(-1, 2)
CAP = 32                                                         # NUMERIC: most smoothing passes tried when looking for the knee
def smooth_to_knee(me):
    """as pipeline/holo_detail.py: the pass count is the knee of the Laplacian's median length over the passes; returns it
    and the median distance the vertices moved (the size of what was smoothed away)"""
    c0 = mesh_co(me); E = mesh_edges(me); n = len(c0)
    deg = np.maximum(1, np.bincount(E.ravel(), minlength=n)).astype(float)
    def lap(c): return np.stack([np.bincount(E[:, 0], c[E[:, 1], k], n) + np.bincount(E[:, 1], c[E[:, 0], k], n) for k in range(3)], 1) / deg[:, None] - c
    c = c0.copy(); hist = []
    for k in range(CAP + 1):
        L = lap(c); hist.append(float(np.median(np.linalg.norm(L, axis=1))))
        if k < CAP: c = c + 0.5 * L
    h = np.array(hist); x = np.arange(CAP + 1) / CAP; y = (h - h[-1]) / max(1e-12, h[0] - h[-1]); passes = int(np.argmax(1 - x - y))
    c = c0.copy()
    for _ in range(passes): c = c + 0.5 * lap(c)
    me.vertices.foreach_set('co', c.ravel()); me.update()
    return passes, float(np.median(np.linalg.norm(c - c0, axis=1)))
ITERS, SAMPLE = 10, 20000                                        # NUMERIC: bisection steps on the ratio; surface points checked (a stride, for speed)
def imp_bvh(path):
    """a closed solid as a nearest-surface tree"""
    before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True); new = [o for o in sc.objects if o not in before]
    m = [o for o in new if o.type == 'MESH'][0]; W = m.matrix_world
    t = BVHTree.FromPolygons([(W @ v.co)[:] for v in m.data.vertices], [p.vertices[:] for p in m.data.polygons])
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    return t
def reduced(ob, r, group=None):
    dc = ob.modifiers.new('dc', 'DECIMATE'); dc.ratio = r; dc.use_collapse_triangulate = True
    if group: dc.vertex_group = group
    return dc
def bisect(ob, src, tol, group=None):
    """the smallest collapse ratio at which the points src stay, on average, within tol of the reduced faces, by bisection
    on the ratio's logarithm. The mean, not the largest distance: the largest is one point's (a hair tip that a collapse
    removes), and with it two nearly equal models came out 27,000 and 180,000 triangles; the mean moves smoothly."""
    trials = []
    def miss(r):
        dc = reduced(ob, r, group); ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh(); n = len(m.polygons)
        bvh = BVHTree.FromPolygons([v.co[:] for v in m.vertices], [p.vertices[:] for p in m.polygons]); ev.to_mesh_clear(); ob.modifiers.remove(dc)
        d = np.array([(bvh.find_nearest(Vector(p))[0] - Vector(p)).length for p in src])
        trials.append({'triangles': n, 'mean_mm': round(float(d.mean()) * 1000, 3), 'median_mm': round(float(np.median(d)) * 1000, 3), 'max_mm': round(float(d.max()) * 1000, 2)})
        return float(d.mean())
    lo_, hi_ = math.log2(1.0 / len(ob.data.polygons)), 0.0
    for _ in range(ITERS):
        mid_ = (lo_ + hi_) / 2
        if miss(2 ** mid_) <= tol: hi_ = mid_
        else: lo_ = mid_
    return 2 ** hi_, trials
def apply(ob, r, group=None):
    reduced(ob, r, group); ob.modifiers.new('tri', 'TRIANGULATE')
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()), preserve_all_data_layers=True, depsgraph=bpy.context.evaluated_depsgraph_get())
    ob.modifiers.clear(); ob.data = me; return me
def mean_miss(me, pts):
    bvh = BVHTree.FromPolygons([v.co[:] for v in me.vertices], [p.vertices[:] for p in me.polygons])
    return float(np.mean([(bvh.find_nearest(Vector(p))[0] - Vector(p)).length for p in pts]))
nf = len(ob.data.polygons); passes, stair = smooth_to_knee(ob.data)
tol = float(flags['tol']) if 'tol' in flags else stair; rec = {}
full = mesh_co(ob.data); src = full[np.linspace(0, len(full) - 1, min(SAMPLE, len(full))).astype(int)]
if 'tris' in flags: me = apply(ob, min(1.0, int(flags['tris']) / nf))
elif 'head' not in flags:
    ratio, trials = bisect(ob, src, tol); me = apply(ob, ratio); rec = {'trials': trials}
else:
    # the head finer: a point is of the head when it lies inside the solid the merge kept the bust in (head_region.glb);
    # inside = on the inner side of the nearest face, the side the figure's topmost point is on
    hb = imp_bvh(flags['head'])
    def side(P): return np.array([(lambda r: (Vector(p) - r[0]).dot(r[1]))(hb.find_nearest(Vector(p))) for p in P])
    sgn = np.sign(side(full[[int(np.argmax(full[:, 2]))]])[0]); in_head = side(src) * sgn > 0
    hz = src[in_head][:, 2]; share = float(hz.max() - hz.min()) / float(full[:, 2].max() - full[:, 2].min())
    # framed alone, the head is to be as true as the whole figure framed alone: its tolerance is the figure's, times the
    # head's share of the figure's height
    tol_h = tol * share
    import os, bmesh
    keep = flags.get('pass1'); t1 = []
    if keep and os.path.exists(keep):      # pass 1 kept from an earlier run on this same figure (it is the slow pass)
        before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=keep, merge_vertices=True); o2 = [o for o in sc.objects if o not in before and o.type == 'MESH'][0]
        with bpy.context.temp_override(active_object=o2, selected_editable_objects=[o2], object=o2): bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        b_ = bmesh.new(); b_.from_mesh(o2.data); bmesh.ops.remove_doubles(b_, verts=b_.verts[:], dist=float(np.finfo(np.float32).eps)); b_.to_mesh(o2.data); b_.free()
        for o in [o for o in sc.objects if o not in before and o != o2]: bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.objects.remove(ob, do_unlink=True); ob = o2; ob.data.materials.clear(); me = ob.data
    else:
        r1, t1 = bisect(ob, src[in_head], tol_h); me = apply(ob, r1)                                # pass 1: the whole figure down to what the head allows
        if keep:
            for o in sc.objects: o.select_set(o == ob)
            bpy.context.view_layer.objects.active = ob; bpy.ops.export_scene.gltf(filepath=keep, use_selection=True, export_materials='NONE', export_animations=False, export_skins=False)
    n1 = len(me.polygons); tol = tol * float(flags.get('body', 1))                                   # --body: the body's tolerance as a share of the measured one
    co1 = mesh_co(me); body_v = side(co1) * sgn <= 0
    g = ob.vertex_groups.new(name='body'); g.add(np.nonzero(body_v)[0].tolist(), 1.0, 'REPLACE'); g.add(np.nonzero(~body_v)[0].tolist(), 0.0, 'REPLACE')
    r2, t2 = bisect(ob, src[~in_head], tol, 'body'); me = apply(ob, r2, 'body')                   # pass 2: the body alone further, the head's triangles left as they are
    ob.vertex_groups.clear()
    cen = np.array([p.center[:] for p in me.polygons]); hf = int((side(cen) * sgn > 0).sum())
    rec = {'head': {'share_of_height': round(share, 4), 'tolerance_mm': round(tol_h * 1000, 4), 'mean_miss_mm': round(mean_miss(me, src[in_head]) * 1000, 4), 'triangles': hf, 'trials': t1},
           'body': {'tolerance_mm': round(tol * 1000, 4), 'mean_miss_mm': round(mean_miss(me, src[~in_head]) * 1000, 4), 'triangles': len(me.polygons) - hf, 'trials': t2}, 'after_pass_1': n1}
    print('FIG reduce head: %.0f%% of the height, on average within %.3f mm (measured %.3f): %d triangles; body within %.2f mm (measured %.3f): %d triangles'
          % (100 * share, tol_h * 1000, rec['head']['mean_miss_mm'], hf, tol * 1000, rec['body']['mean_miss_mm'], len(me.polygons) - hf))
ratio = len(me.polygons) / nf
for p in me.polygons: p.use_smooth = False
E = mesh_edges(me); co = mesh_co(me); el = np.linalg.norm(co[E[:, 0]] - co[E[:, 1]], axis=1)
z = co[:, 2]; top = z.max(); rec0 = rec; rec = {'faces_in': nf, 'smooth_passes': passes, 'staircase_mm': round(stair * 1000, 3), 'tolerance_mm': round(tol * 1000, 3),
       'ratio': ratio, 'triangles': len(me.polygons), 'vertices': len(me.vertices), 'edge_mm_median': round(float(np.median(el)) * 1000, 2),
       'edge_mm_10_90': [round(float(np.percentile(el, q)) * 1000, 2) for q in (10, 90)], 'height_m': round(float(top - z.min()), 4)}; rec.update(rec0)
json.dump(rec, open(REC, 'w'), indent=1)
for o in sc.objects: o.select_set(o == ob)
bpy.context.view_layer.objects.active = ob
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_materials='NONE', export_animations=False, export_skins=False)
print('FIG reduce: staircase %.2f mm (%d smoothing passes); %d -> %d triangles (ratio %.4f), the surface on average within %.2f mm; edges %.1f mm median'
      % (stair * 1000, passes, nf, len(me.polygons), ratio, tol * 1000, rec['edge_mm_median']))
