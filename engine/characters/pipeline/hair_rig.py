"""Hair that moves like hair (v0.7 step 6): find the hair on the fused head, find its locks, hang one spring chain in each,
weight the free hair to them, and run them as VRM 1.0 spring bones with colliders. Every amount is measured on this figure.
usage: blender -b <figure.blend> -P hair_rig.py -- <portrait-view-dir> <render-dir> <out.blend> [--hair=<labels>] [--cut=0]
        [--center=<bone>] [--debug=<path prefix>] [--stop=locks]
  The mesh's own scale: h, the median edge length of the Head. Distances are read against it (or against the hair's own
  measured thickness, or their own median) through the parameter-free Cauchy weight 1/(1+(d/scale)^2); no cut-offs.
  Hair or not, read three ways and filled over the mesh:
  - the portrait: prep_view's colour labels (--hair names the hair labels instead). A label's hair odds are its share of
    the picture's head outside the face (above the chin) against its share inside the face, the face being the outline
    of the anime face detector's 28 points (eye_shapes.py's eyes.json beside the portrait; the 68 portrait points of
    marks.json if there is none). It is laid on the head by the 68 face points (marks.json onto figure_face.marks, a
    Cauchy-weighted similarity); a head point whose own triangles are the first thing a ray from the front meets reads it.
  - the back picture (prep_back beside the portrait): laid on the whole figure seen from behind by view_register; each
    back colour takes the odds of the portrait colour nearest it (CIE Lab); read by the points a ray from behind meets.
  - the shape: a point with air between it and the skull's middle (below) has come away from the head, and skin lies on
    the skull, so it reads hair as strongly as it is free, unless it is the Head's own bust under the clothes: a point on
    the inner side of the nearest other mesh's surface, as strongly as the Cauchy weight of that distance over the median
    of such distances, reads not-hair.
  Each point's readings weigh as much as its neighbours' mean; the rest take the mean (solved to convergence), so the
  hidden inside of a lock is hair because the hair around it is. Hair is where that comes to over one half.
  Free or on the skull: from each point a ray to the skull's middle (the head bone's x, the median depth of the points
  above the ears, the ears' height) measures the air it crosses. Fused hair, the face and the skull cross none; a lock that
  has come away from the head crosses the gap behind it. The chains' share of a point is 1 - the Cauchy weight of that air
  against h: 0 on the skull, 1/2 one edge away, so the hairline and its blend come from where the sheet leaves the skull.
  Where hair meets non-hair (a lock fused onto a cheek, tips on the collar) the share also ramps up over the hair's own
  median thickness (the first stretch of material along the same ray) along the mesh, so nothing tears.
  Locks: the free hair falls downhill (each point with its lowest free neighbour) into tips; a tip that hangs below the
  saddle to its neighbour by less than the hair is thick or the mesh resolves (h) is a bump on the sheet and joins it
  (persistence). Each lock gets one chain: its root is where it leaves the skull (its points within h of that along the
  mesh), its centre line the geometric median of the lock in steps of h from the root toward its tip, and the joints are
  the line's bends (Douglas-Peucker at the lock's own thickness or h, the larger).
  Weights: a point's share goes to its two nearest chains by inverse square distance to their centre lines, on the link
  it is nearest; the rest stays on the head. At most 3 bones.
  Springs, from three-vrm's own rule (simulated with the viewer's cone limits and its walk, run and head shake on this
  skeleton) and the tip travel the viewer was tuned to (peak to peak in the world along the main swing: walk 17 mm, run 68,
  shake 105; resting droop 7): stiffness makes each link a pendulum under the earth's gravity (9.81 x dt); gravity over
  stiffness comes from the droop; drag from the shake (walk and run are reported: they barely depend on the springs); the
  median over the chains, counted by the hair each carries. Each joint's stiffness is that share of the root's as the hair
  hanging below it is of the whole lock; each joint's hit radius is half the lock's measured thickness on that link.
  Colliders: a sphere fitted to the scalp, a sphere fitted to the face's skin, capsules on the neck, the shoulders and the
  chest with the median distance of their own skin to the bone; each shrunk until the hair at rest clears it.
  --cut=<share> deletes triangles joining free hair to skin (left off: it opened holes under the jaw).
  Constants left: the travel targets (the viewer's tuning), the viewer's motions and cones (copied from index.html, to be
  measured the way it plays them), its 60 Hz step and the seconds simulated, g = 9.81, three bones per hair point (VRM's
  four influences less the head), the tip bone one h long, and the solvers' tolerances and iteration caps."""
import bpy, bmesh, json, math, os, sys, heapq
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
flags = dict((a[2:].split('=', 1) + [''])[:2] for a in argv if a.startswith('--'))
PVIEW, RDIR, OUT = [os.path.abspath(a) for a in argv if not a.startswith('--')][:3]
HAIR = [int(x) for x in flags['hair'].split(',')] if flags.get('hair') else None   # the hair's colour labels (else found)
CUT, CENTER = float(flags.get('cut', 0)), flags.get('center', 'none')
TARGET = {'walk': 0.017, 'run': 0.068, 'shake': 0.105, 'droop': 0.007}   # the viewer's tuned tip travel (see above)
import addon_utils
addon_utils.enable('bl_ext.blender_org.vrm', default_set=True)
rig = bpy.data.objects['Armature']; arm = rig.data; head = bpy.data.objects['Head']
F = json.loads(rig['figure_face']); M = {int(k): np.array(v) for k, v in F['marks'].items()}
def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
def cauchy(r, s=None):
    """the parameter-free weight 1/(1+(r/s)^2), s the median of r unless given"""
    r = np.asarray(r, float); s = float(np.median(r)) if s is None else s
    return 1.0 / (1.0 + (r / max(s, 1e-12)) ** 2)
me = head.data
V = np.array([(head.matrix_world @ v.co)[:] for v in me.vertices]); NV = len(V)
VN = np.array([(head.matrix_world.to_3x3() @ v.normal).normalized()[:] for v in me.vertices])
E = np.array([e.vertices[:] for e in me.edges]); EL = np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1)
h = float(np.median(EL))                     # the mesh's own spacing
nbr = [[] for _ in range(NV)]
for a, b in E: nbr[a].append(b); nbr[b].append(a)
DEG = np.bincount(E.ravel(), minlength=NV).astype(float)
ring = [set() for _ in range(NV)]            # each point's own triangles
for p in me.polygons:
    for v in p.vertices: ring[v].add(p.index)
area = np.zeros(NV)                          # each point's share of the surface (a third of its triangles)
for p in me.polygons:
    for v in p.vertices: area[v] += p.area / len(p.vertices)
bx = arm.bones['head'].head_local.x
dg = bpy.context.evaluated_depsgraph_get(); bvh = BVHTree.FromObject(head, dg)
print('FIG mesh spacing h %.1f mm' % (1000 * h))
def poly_inside(poly, x, y):
    ins = np.zeros(np.shape(x), bool); j = len(poly) - 1
    for k in range(len(poly)):
        xi, yi = poly[k]; xj, yj = poly[j]
        ins ^= ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi); j = k
    return ins
def dijkstra(sources, allowed):
    """distance along the mesh's edges from the sources, through allowed points only"""
    dist = np.full(NV, np.inf); dist[sources] = 0.0; heap = [(0.0, int(i)) for i in sources]; heapq.heapify(heap)
    while heap:
        d, i = heapq.heappop(heap)
        if d > dist[i]: continue
        for j in nbr[i]:
            if not allowed[j]: continue
            nd = d + float(np.linalg.norm(V[i] - V[j]))
            if nd < dist[j]: dist[j] = nd; heapq.heappush(heap, (nd, j))
    return dist

# ---- 1. the portrait's labels on the head's front --------------------------------------------------------------------
marks = json.load(open(os.path.join(RDIR, 'marks.json')))
pp = np.array([p[:2] for p in marks['portrait']['points']]); mp = np.array([[M[i][0], M[i][2]] for i in range(68)])
src = np.stack([pp[:, 0], -pp[:, 1]], 1)        # image y runs down, z up
w = np.ones(68)
for _ in range(50):                             # a similarity, each point weighted by the Cauchy weight of its miss
    mu_s, mu_d = w @ src / w.sum(), w @ mp / w.sum(); S, D = src - mu_s, mp - mu_d
    U, sig, Vt = np.linalg.svd((D * w[:, None]).T @ S); Rm = U @ Vt
    scale = sig.sum() / (w @ (S ** 2).sum(1)); t = mu_d - scale * Rm @ mu_s
    fit = np.linalg.norm((scale * (Rm @ src.T)).T + t - mp, axis=1); w_new = cauchy(fit)
    if np.abs(w_new - w).max() < 1e-6: break
    w = w_new
print('FIG portrait fitted onto the head: %.1f mm median error, %.1f mm max' % (1000 * np.median(fit), 1000 * fit.max()))
labels = np.load(os.path.join(PVIEW, 'labels.npy')); LH, LW = labels.shape
mpath = os.path.join(PVIEW, 'mask.npy')
fig = np.load(mpath) > 0 if os.path.exists(mpath) else labels != 255
e28 = os.path.join(os.path.dirname(os.path.normpath(PVIEW)), 'eyes', 'eyes.json')
if os.path.exists(e28):    # the anime face detector's 28 points: 0-4 the jaw (temple, chin, temple), 5-10 the brows
    q = np.array(json.load(open(e28))['points28'])[:, :2]; outline = np.concatenate([q[0:5], q[10:4:-1]]); osrc = '28'
else:
    outline = np.concatenate([pp[0:17], pp[26:16:-1]]); osrc = '68'
n_lab = int(labels[labels != 255].max()) + 1
if HAIR is None:
    yy, xx = np.mgrid[0:LH, 0:LW]
    inface = poly_inside(outline, xx, yy) & fig & (labels != 255)
    around = fig & (labels != 255) & ~inface & (yy < outline[:, 1].max())     # the head outside the face, above the chin
    hf = np.bincount(labels[inface], minlength=n_lab) / max(1, inface.sum())
    ha = np.bincount(labels[around], minlength=n_lab) / max(1, around.sum())
    p_lab = np.where(ha + hf > 0, ha / np.maximum(ha + hf, 1e-12), 0.5)
    HAIR = [l for l in range(n_lab) if p_lab[l] > 0.5]
    print('FIG hair odds per label (face from the %s points): %s; hair labels %s' % (osrc, [round(float(x), 2) for x in p_lab], HAIR))
else:
    p_lab = np.isin(np.arange(n_lab), HAIR).astype(float)
def to_px(x, z):
    q_ = Rm.T @ ((np.stack([x, z], 1) - t).T) / scale
    return q_[0], -q_[1]
seen = np.zeros(NV, bool); y0 = V[:, 1].min() - 1.0
for i, p in enumerate(V):
    hit = bvh.ray_cast(Vector((p[0], y0, p[2])), Vector((0, 1, 0)))
    seen[i] = hit[0] is not None and hit[2] in ring[i]     # its own triangles are the first thing the front sees
u, v = to_px(V[:, 0], V[:, 2]); ui = np.round(u).astype(int); vi = np.round(v).astype(int)
inpic = (ui >= 0) & (ui < LW) & (vi >= 0) & (vi < LH)
lab = np.full(NV, 255); lab[inpic] = labels[vi[inpic], ui[inpic]]
read = seen & inpic & (lab != 255) & fig[np.clip(vi, 0, LH - 1), np.clip(ui, 0, LW - 1)]
y_read = np.where(read, p_lab[np.clip(lab, 0, n_lab - 1)], 0.0)
# the back: prep_view's labels of the back picture (prep_back beside the portrait's), laid on the whole figure seen from
# behind by view_register (outline onto outline); each back colour takes the hair odds of the portrait colour nearest it
# (CIE Lab), and a point whose own triangles are the first thing a ray from behind meets reads it
def lab_of(hexes):
    c = np.array([[int(x[i:i + 2], 16) / 255 for i in (1, 3, 5)] for x in hexes]); c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    X = c @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T / np.array([0.9505, 1.0, 1.089])
    f = np.where(X > 0.008856, np.cbrt(X), 7.787 * X + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)
read_b = np.zeros(NV, bool); y_back = np.zeros(NV)
BVIEW = os.path.join(os.path.dirname(os.path.normpath(PVIEW)), 'prep_back')
pvj = json.load(open(os.path.join(PVIEW, 'view.json')))
if os.path.exists(os.path.join(BVIEW, 'labels.npy')) and 'palette' in pvj:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from view_register import register
    bvj = json.load(open(os.path.join(BVIEW, 'view.json'))); blab = np.load(os.path.join(BVIEW, 'labels.npy'))
    bmask = np.load(os.path.join(BVIEW, 'mask.npy')) > 0 if os.path.exists(os.path.join(BVIEW, 'mask.npy')) else blab != 255
    dlab = np.linalg.norm(lab_of(bvj['palette'])[:, None] - lab_of(pvj['palette'][:n_lab])[None], axis=2)
    p_blab = p_lab[dlab.argmin(1)]
    ALL = np.concatenate([np.array([(o.matrix_world @ v.co)[:] for v in o.data.vertices]) for o in bpy.data.objects if o.type == 'MESH'])
    breg = register(bmask, ALL * np.array([-1, 1, 1]))           # seen from behind, the figure's left is on the picture's left
    yb = V[:, 1].max() + 1.0
    for i, p in enumerate(V):
        hit = bvh.ray_cast(Vector((p[0], yb, p[2])), Vector((0, -1, 0)))
        read_b[i] = hit[0] is not None and hit[2] in ring[i]
    bu, bv = breg.to_img(-V[:, 0], V[:, 2]); bui = np.round(bu).astype(int); bvi = np.round(bv).astype(int); BH, BW = blab.shape
    inb = (bui >= 0) & (bui < BW) & (bvi >= 0) & (bvi < BH)
    bl = np.full(NV, 255); bl[inb] = blab[bvi[inb], bui[inb]]
    read_b &= inb & (bl != 255) & bmask[np.clip(bvi, 0, BH - 1), np.clip(bui, 0, BW - 1)]
    y_back = np.where(read_b, p_blab[np.clip(bl, 0, len(p_blab) - 1)], 0.0)
    print('FIG back picture laid on the figure (median miss %.1f mm): hair odds per back colour %s; %d head points read from behind, %d hair' % (
        breg.report['median_miss_mm'][1], [round(float(x), 2) for x in p_blab], int(read_b.sum()), int((read_b & (y_back > 0.5)).sum())))
# covered: the Head's own bust under the clothes or body: a point on the inner side of the nearest other mesh's surface,
# as strongly as the Cauchy weight of its distance against the median distance of all such points
dcov = np.full(NV, np.inf)
for o in bpy.data.objects:
    if o.type != 'MESH' or o == head: continue
    ob = BVHTree.FromObject(o, dg); Mi = o.matrix_world.inverted(); Mo = o.matrix_world; Mn = Mo.to_3x3()
    for i, p in enumerate(V):
        r = ob.find_nearest(Mi @ Vector(p))
        if r[0] is None: continue
        q = Mo @ r[0]; nq = (Mn @ r[1]).normalized()
        if (Vector(p) - q).dot(nq) < 0: dcov[i] = min(dcov[i], (Vector(p) - q).length)
under = np.isfinite(dcov)
cover = np.where(under, cauchy(np.where(under, dcov, 0), float(np.median(dcov[under])) if under.any() else 1.0), 0.0)
# ---- free or on the skull: the air between each point and the skull's middle ----------------------------------------
M_ears = (M[0] + M[16]) / 2; ears_z = float(M_ears[2])
hc = np.array([bx, float(np.median(V[V[:, 2] > ears_z][:, 1])), ears_z])   # the skull's middle at ear height
air = np.zeros(NV); thick = np.full(NV, np.nan)
for i, p in enumerate(V):
    d = Vector(hc - p); L = d.length
    if L < 1e-9: continue
    d.normalize(); o = Vector(p); s = 0.0
    inside = VN[i] @ np.array(d) < 0; last = 0.0; start_in = inside
    while s < L:
        hit = bvh.ray_cast(o + d * 1e-7, d, L - s)
        if hit[0] is None: break
        s += (hit[0] - o).length; o = hit[0]
        if hit[2] in ring[i]: continue
        out_ = hit[1].dot(d) > 0
        if out_ and inside:
            inside = False; last = s
            if start_in and np.isnan(thick[i]): thick[i] = s       # the sheet's thickness, from its outer face
        elif not out_ and not inside: inside = True; air[i] += s - last
    if not inside: air[i] += L - last
def fill(num, kap, start):
    """each point: (num + the sum of its neighbours) / (kap + its neighbour count), solved to convergence"""
    x_ = np.full(NV, float(start))
    for it_ in range(20000):
        acc = np.zeros(NV); np.add.at(acc, E[:, 0], x_[E[:, 1]]); np.add.at(acc, E[:, 1], x_[E[:, 0]])
        new_ = (num + acc) / np.maximum(kap + DEG, 1e-12)
        if np.abs(new_ - x_).max() < 1e-7: return new_, it_ + 1
        x_ = new_
    return x_, it_ + 1
# 0 on the skull, 1/2 at one edge of air, toward 1; each point's own reading weighs as much as its neighbours' mean, so
# a speckle where hair lies on the back with a hair's breadth of air does not move alone
wf = fill((1 - cauchy(air, h)) * DEG, DEG, 0.0)[0]

# the reading everywhere: a seen point's label, a covered point's no, the mean of its neighbours for the rest;
# a sheet with air behind it that nothing covers reads hair as strongly as it is free (skin lies on the skull)
# (a point's readings weigh as much as its neighbours' mean, so the fill smooths the edges without washing out the data)
kap = (read.astype(float) + read_b + cover + wf * (1 - cover)) * DEG; num = (read * y_read + read_b * y_back + wf * (1 - cover)) * DEG
pr, it = fill(num, kap, 0.5)
hair = pr > 0.5
print('FIG hair %d of %d head points (%d read from the front, %d of those hair labels; %d covered by the clothes; fill %d rounds)' % (
    int(hair.sum()), NV, int(read.sum()), int((read & (y_read > 0.5)).sum()), int((cover > 0.5).sum()), it + 1))

free = hair & (wf > 0.5)
T = float(np.nanmedian(thick[free])) if np.isfinite(thick[free]).any() else h      # the hair's own thickness
share = np.where(hair, wf, 0.0)
# where free hair meets non-hair, the share ramps up over the hair's thickness along the mesh
dist = dijkstra(np.where(~hair)[0], hair)
share = share * smooth(dist / T)
if flags.get('debug'): np.savez(flags['debug'], cover=cover, pr=pr, read=read, y_read=y_read, air=air, wf=wf, share=share, thick=thick)
print('FIG free hair %d points (air past one edge); hair thickness %.1f mm' % (int(free.sum()), 1000 * T))

# ---- 3. the locks: free hair falling to its tips, shallow tips merged -----------------------------------------------
# a tip is a lock when it hangs below the saddle to its neighbour by more than the hair is thick and more than the mesh
# resolves (one spacing); anything less is a bump on the sheet
DEPTH = max(T, h)
z = V[:, 2]; order = np.argsort(z, kind='stable'); parent = np.arange(NV); birth = z.copy(); added = np.zeros(NV, bool)
def find(a):
    while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
    return a
PERS = {}
for i in order:              # from the lowest point up: a point with no lower free neighbour starts a tip of its own
    if not free[i]: continue
    nb = [j for j in nbr[i] if added[j]]; added[i] = True
    if not nb: continue
    roots = sorted({find(j) for j in nb}, key=lambda r: birth[r])
    if flags.get('debug'): PERS.update({int(r): float(z[i] - birth[r]) for r in roots[1:] if int(r) not in PERS})
    for r in roots[1:]:
        if z[i] - birth[r] < DEPTH: parent[r] = roots[0]   # its tip hangs less than that: a bump on the sheet, merged
    parent[i] = find(min(nb, key=lambda j: z[j]))          # the point falls with its lowest neighbour
basin = np.full(NV, -1)
for i in np.where(free)[0]: basin[i] = find(i)
# along the mesh from where the hair leaves the skull (from any non-free point for a lock that touches no scalp)
level = dijkstra(np.where(~free & hair)[0], free)
lost = free & ~np.isfinite(level)
if lost.any(): level = np.where(lost, dijkstra(np.where(~free)[0], free), level)
def geomedian(P):
    m = P.mean(0)
    for _ in range(200):
        d = np.maximum(np.linalg.norm(P - m, axis=1), 1e-9); nm = (P / d[:, None]).sum(0) / (1 / d).sum()
        if np.linalg.norm(nm - m) < 1e-7: return nm
        m = nm
    return m
def dp(P, tol):
    if len(P) < 3: return [0, len(P) - 1]
    a, b = P[0], P[-1]; ab = b - a; L2 = max(ab @ ab, 1e-18)
    tt = np.clip((P - a) @ ab / L2, 0, 1); dd = np.linalg.norm(P - (a + tt[:, None] * ab), axis=1)
    k = int(dd.argmax())
    if dd[k] <= tol: return [0, len(P) - 1]
    l, r = dp(P[:k + 1], tol), dp(P[k:], tol)
    return l + [k + x for x in r[1:]]
chains = []
for b in sorted(set(basin[free]), key=lambda b: np.arctan2(V[b, 0] - hc[0], -(V[b, 1] - hc[1]))):
    sel = np.where((basin == b) & np.isfinite(level))[0]
    if len(sel) < 2: continue
    tb = np.where(basin == b)[0]; tip = tb[np.argmin(z[tb])]
    Tl = float(np.nanmedian(thick[sel])) if np.isfinite(thick[sel]).any() else T
    # the root: where the lock leaves the skull (its points within one spacing of that, along the mesh); the centre line:
    # the geometric median of the lock (both its faces) in steps of one spacing from the root toward the tip
    root = geomedian(V[sel[level[sel] <= level[sel].min() + h]]); ax_ = V[tip] - root; L_ = float(np.linalg.norm(ax_))
    if L_ <= 0: continue
    st = np.floor((V[tb] - root) @ ax_ / L_ / h).astype(int); line = [root]
    for k in sorted(set(st[(st >= 0) & (st * h < L_)])): line.append(geomedian(V[tb[st == k]]))
    line.append(V[tip]); line = np.array(line)
    if np.linalg.norm(line[-1] - line[0]) <= max(Tl, h): continue  # shorter than it is thick or than the mesh resolves
    J = line[dp(line, max(Tl, h))]                                # bends the mesh can resolve
    ang = float(np.degrees(np.arctan2(V[tip, 0] - hc[0], -(V[tip, 1] - hc[1]))))
    chains.append({'basin': int(b), 'angle': ang, 'joints': [Vector(p) for p in J], 'P': J, 'K': len(J) - 1, 'T': Tl, 'n': int((basin == b).sum())})
print('FIG locks %d -> chains %d %s' % (len(set(basin[free])), len(chains), [('%+.0f: %.1f cm, %d links, %d pts' % (c['angle'], 100 * np.linalg.norm(c['P'][-1] - c['P'][0]), c['K'], c['n'])) for c in chains]))

if flags.get('debug'): np.save(flags['debug'] + '_basin.npy', basin); print('FIG persistence mm', sorted([round(1000 * x, 1) for x in PERS.values()], reverse=True)[:120])
if flags.get('stop') == 'locks': sys.exit(0)
# ---- 4. the bones ---------------------------------------------------------------------------------------------------
bpy.context.view_layer.objects.active = rig
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
for ci, c in enumerate(chains):
    names = []; K = c['K']
    for j in range(K):
        n = 'hair_%02d_%d' % (ci, j); eb = arm.edit_bones.get(n) or arm.edit_bones.new(n)
        eb.head = c['joints'][j]; eb.tail = c['joints'][j + 1]
        eb.parent = arm.edit_bones['head'] if j == 0 else arm.edit_bones[names[-1]]; eb.use_connect = j > 0
        names.append(n)
    # a short tip bone at the chain's end: VRM 1.0 simulates a joint toward the next one, so the last link needs a node
    # past its end (unweighted; it only marks where the last link's tail is; one mesh spacing long)
    tn = 'hair_%02d_tip' % ci; tb = arm.edit_bones.get(tn) or arm.edit_bones.new(tn)
    d = (c['joints'][K] - c['joints'][K - 1]).normalized()
    tb.head = c['joints'][K]; tb.tail = c['joints'][K] + d * h; tb.parent = arm.edit_bones[names[-1]]; tb.use_connect = True
    c['names'] = names; c['tip'] = tn
bpy.ops.object.mode_set(mode='OBJECT')

# ---- 5. weights -----------------------------------------------------------------------------------------------------
def seg_dist(X, P):
    """distance from each row of X to the polyline P, and the index of the nearest segment"""
    A, B = P[:-1], P[1:]; AB = B - A; L2 = np.maximum((AB * AB).sum(1), 1e-18)
    tt = np.clip(((X[:, None, :] - A[None]) * AB[None]).sum(2) / L2[None], 0, 1)
    dd = np.linalg.norm(X[:, None, :] - (A[None] + tt[..., None] * AB[None]), axis=2)
    return dd.min(1), dd.argmin(1)
groups = {g.name: g for g in head.vertex_groups}; gname = {g.index: g.name for g in head.vertex_groups}
for c in chains:
    for n in c['names']:
        if n not in groups: groups[n] = head.vertex_groups.new(name=n)
mov = np.where(share > 1e-3)[0] if chains else np.array([], int)
if len(mov):
    DD = np.stack([seg_dist(V[mov], c['P'])[0] for c in chains], 1); SG = np.stack([seg_dist(V[mov], c['P'])[1] for c in chains], 1)
link_mass = [np.zeros(c['K']) for c in chains]; link_t = [[[] for _ in range(c['K'])] for c in chains]
weighted = 0
for r, i in enumerate(mov):
    o2 = np.argsort(DD[r])[:2]; iw = 1 / np.maximum(DD[r, o2], 1e-9) ** 2; iw = iw / iw.sum()
    hv = me.vertices[i]; old = {gname[g.group]: g.weight for g in hv.groups}
    keep = old.get('head', 0.0) + old.get('jaw', 0.0) + old.get('neck', 0.0)
    if keep <= 0: continue
    s_ = float(share[i]); new = {}
    for ci, wc in zip(o2, iw):
        if wc <= 1e-3: continue
        j = int(SG[r, ci]); n = chains[ci]['names'][j]; new[n] = new.get(n, 0.0) + s_ * wc
        link_mass[ci][j] += area[i] * s_ * wc
        if np.isfinite(thick[i]) and wc > 0.5: link_t[ci][j].append(thick[i])
    for n in list(old): groups[n].remove([int(i)])
    groups['head'].add([int(i)], (1 - s_) * (old.get('head', 0.0) + old.get('jaw', 0.0) + old.get('neck', 0.0)) / keep, 'REPLACE')
    for n, wv in new.items(): groups[n].add([int(i)], float(wv), 'REPLACE')
    weighted += 1
print('FIG free hair weighted to the chains: %d points' % weighted)

# ---- 6. cut free hair from the skin -----------------------------------------------------------------------------------
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
kill = [f for f in bm.faces if any(share[v.index] > CUT for v in f.verts) and any(not hair[v.index] for v in f.verts)] if CUT > 0 else []
bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(me); bm.free(); me.update()
print('FIG cut %d triangles joining free hair to skin' % len(kill))

# ---- 7. the springs, fitted to the viewer's tip travel --------------------------------------------------------------
# the viewer's motions on the bones that carry the head (index.html MOTIONS: degrees, Euler XYZ on normalized bones, the
# figure facing +Z with y up; _y lifts the hips)
def mo_walk(t_): w_ = t_ * 6.2; p_ = math.sin(w_); return {'spine': (3, 5 * p_, 0), 'head': (0, -4 * p_, 0), '_y': 0.018 * abs(math.cos(w_))}
def mo_run(t_): w_ = t_ * 10; p_ = math.sin(w_); return {'spine': (12, 8 * p_, 0), 'head': (-6, -6 * p_, 0), '_y': 0.05 * abs(math.cos(w_)) - 0.02}
def mo_shake(t_):
    u_ = t_ % 3; k_ = math.sin(u_ / 1.2 * math.pi * 3) * (1 - u_ / 1.2 * 0.3) if u_ < 1.2 else 0
    return {'neck': (0, 14 * k_, 0), 'head': (0, 22 * k_, 0)}
MOTIONS = [('walk', mo_walk, 4.0, 2.0), ('run', mo_run, 4.0, 2.0), ('shake', mo_shake, 3.0, 3.0)]   # seconds run, seconds read
HZ = 60; DT = 1.0 / HZ                                     # the viewer's fixed spring step
Pm = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)    # Blender (x, y, z) -> three (x, z, -y)
def rot_xyz(a, b, c_):
    a, b, c_ = np.radians([a, b, c_]); ca, sa, cb, sb, cc, sc = np.cos(a), np.sin(a), np.cos(b), np.sin(b), np.cos(c_), np.sin(c_)
    Rx = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]]); Ry = np.array([[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]]); Rz = np.array([[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]])
    return Pm.T @ (Rx @ Ry @ Rz) @ Pm
fk = []; b_ = arm.bones['head']
while b_ is not None: fk.insert(0, b_); b_ = b_.parent
FKP = [np.array((rig.matrix_world @ b_.head_local)[:]) for b_ in fk]; HEAD0 = Vector(FKP[-1])
def head_pose(pose):
    R = np.eye(3); pos = FKP[0] + np.array([0, 0, pose.get('_y', 0.0)])
    for k, b_ in enumerate(fk):
        if k: pos = pos + R @ (FKP[k] - FKP[k - 1])
        if b_.name in pose: R = R @ rot_xyz(*pose[b_.name])
    return Matrix(R.tolist()).to_quaternion(), Vector(pos)
DRIVE = [[head_pose(fn(s_ * DT)) for s_ in range(int(dur * HZ) + 1)] for name, fn, dur, win in MOTIONS]
DOWN = Vector((0, 0, -1)); MAXANG = [math.radians(20), math.radians(22)]   # the viewer's cones (limitHair): root link, others
C = len(chains)
for ci, c in enumerate(chains):
    c['LEN'] = [float(np.linalg.norm(c['P'][k + 1] - c['P'][k])) for k in range(c['K'])]
    c['RD'] = [Vector((c['P'][k + 1] - c['P'][k]) / max(c['LEN'][k], 1e-12)) for k in range(c['K'])]
    mm = link_mass[ci]; below = np.cumsum(mm[::-1])[::-1]    # each joint's share of the root's stiffness: the hair below it
    c['SK'] = [float(x) for x in (np.maximum(below / below[0], 1e-3) if below[0] > 0 else np.ones(c['K']))]
def droop(c, rho):
    """where the tip settles at rest: each link points along its rest direction plus rho/share times down (the constant
    pull and gravity of three-vrm's rule balance there), held in the viewer's cone"""
    D = Quaternion(); x = Vector(c['P'][0])
    for k in range(c['K']):
        a = D @ c['RD'][k]; u = (a + DOWN * (rho / c['SK'][k])).normalized(); q = a.rotation_difference(u)
        mx = MAXANG[min(k, 1)]
        if a.angle(u, 0) > mx: q = Quaternion(q.axis, mx)
        D = q @ D; x = x + (D @ c['RD'][k]) * c['LEN'][k]
    return (x - Vector(c['P'][-1])).length
def travel(c, stiff, drag, grav, m):
    """three-vrm's VRMSpringBoneJoint rule (world-space inertia, the rest direction pulled with stiffness x dt, gravity x dt,
    the length kept) on one chain under one motion, each link then held in the viewer's cone; the tip's peak-to-peak
    travel in the world (as the viewer measured it against the rigid hair), along its main swing, over the read window"""
    name, fn, dur, win = MOTIONS[m]; dr = DRIVE[m]; K = c['K']; X0 = [Vector(p) for p in c['P']]
    q0, p0 = dr[0]; cur = [q0 @ (X0[k + 1] - HEAD0) + p0 for k in range(K)]; prev = [v.copy() for v in cur]; tips = []
    for q, p in dr[1:]:
        Dp = q; Dd = q; x = q @ (X0[0] - HEAD0) + p; y = x
        for k in range(K):
            a = Dp @ c['RD'][k]
            nxt = cur[k] + (cur[k] - prev[k]) * (1 - drag) + a * (stiff * c['SK'][k] * DT) + DOWN * (grav * DT)
            dv = (nxt - x).normalized(); nxt = x + dv * c['LEN'][k]; prev[k] = cur[k]; cur[k] = nxt
            rk = a.rotation_difference(dv); mx = MAXANG[min(k, 1)]
            rc = Quaternion(rk.axis, mx) if a.angle(dv, 0) > mx else rk
            Dd = Dd @ Dp.inverted() @ rc @ Dp; y = y + (Dd @ c['RD'][k]) * c['LEN'][k]
            x = nxt; Dp = rk @ Dp
        tips.append(y[:])
    T_ = np.array(tips[-int(win * HZ):]); T_ = T_ - T_.mean(0); ax_ = np.linalg.svd(T_, full_matrices=False)[2][0]; pr_ = T_ @ ax_
    return float(pr_.max() - pr_.min())
MASS = [float(sum(m_)) + 1e-12 for m_ in link_mass]           # the hair each chain carries (area x weight)
def wmedian(x, w):
    o_ = np.argsort(x); cw = np.cumsum(np.array(w)[o_]); return float(np.array(x)[o_][np.searchsorted(cw, cw[-1] / 2)])
if C:
    # gravity over stiffness from the resting droop alone (at rest the two constant pulls balance), the median over all
    # chains (by the hair each carries), by bisection in log
    lo, hi = -12.0, 6.0
    for _ in range(60):
        mid = (lo + hi) / 2; d_ = wmedian([droop(c, math.exp(mid)) for c in chains], MASS)
        lo, hi = (mid, hi) if d_ < TARGET['droop'] else (lo, mid)
    RHO = math.exp((lo + hi) / 2)
    # stiffness: three-vrm's rule pulls a link back toward its rest direction by stiffness x dt each step, which for small
    # swings is a pendulum of the link's length under an acceleration of stiffness / dt; a lock is a pendulum under the
    # earth's gravity, so stiffness = 9.81 m/s2 x dt (the viewer's 60 Hz step)
    STIFF = 9.81 * DT; GRAV = STIFF * RHO
    # drag: the one setting the moving targets pin down. In the world (as the viewer measured), walk and run travel are
    # mostly the head's own bob and change little with the springs; the shake's travel falls steadily as drag rises, so drag
    # is found (bisection in logit) where the median shake travel is the target; walk and run are reported as checks. The
    # chains simulated are those at the quartiles and the median of length, counted by the hair each carries (their median
    # stands for all chains': a chain simulation is the costly part)
    by_len = sorted(range(C), key=lambda i: sum(chains[i]['LEN'])); cm_ = np.cumsum([MASS[i] for i in by_len]) / sum(MASS)
    REP = sorted({by_len[int(np.searchsorted(cm_, f_))] for f_ in (0.25, 0.5, 0.75)})
    def moves(d_, ms): return {MOTIONS[m][0]: float(np.median([travel(chains[i], STIFF, d_, GRAV, m) for i in REP])) for m in ms}
    lo, hi = -9.0, 9.0; SH = [m for m in range(len(MOTIONS)) if MOTIONS[m][0] == 'shake']
    for _ in range(24):
        mid_ = (lo + hi) / 2; sh = moves(1 / (1 + math.exp(-mid_)), SH)['shake']
        lo, hi = (mid_, hi) if sh > TARGET['shake'] else (lo, mid_)
    DRAG = 1 / (1 + math.exp(-(lo + hi) / 2))
    got = moves(DRAG, range(len(MOTIONS))); got['droop'] = wmedian([droop(c, RHO) for c in chains], MASS)
    print('FIG springs: stiffness %.3f (pendulum), drag %.3f, gravity %.4f; tip travel %s mm (targets %s; %d chains simulated)' % (
        STIFF, DRAG, GRAV, {k: round(1000 * v_, 1) for k, v_ in got.items()}, {k: round(1000 * v_) for k, v_ in TARGET.items()}, len(REP)))

# ---- 8. colliders, each shrunk until the hair at rest clears it --------------------------------------------------------
HIT = [np.array([0.5 * (float(np.median(link_t[ci][j])) if link_t[ci][j] else c['T']) for j in range(c['K'])]) for ci, c in enumerate(chains)]
TAILS = np.concatenate([c['P'][1:] for c in chains]) if chains else np.zeros((0, 3))
TAIL_HIT = np.concatenate(HIT) if chains else np.zeros(0)
def clear(r, core):
    """the radius r, made small enough that every simulated joint at rest is outside it (core: distances to the shape's axis)"""
    return float(min(r, (core - TAIL_HIT).min())) if len(TAILS) else float(r)
def fit_sphere(P, w0=None):
    """a sphere through the points, each weighted by the Cauchy weight of its miss (algebraic least squares, reweighted)"""
    w_ = np.ones(len(P)) if w0 is None else w0; c_ = P.mean(0); r_ = 0.0
    for _ in range(100):
        A = np.c_[2 * P, np.ones(len(P))]; bb = (P * P).sum(1); sw = np.sqrt(w_)
        sol = np.linalg.lstsq(A * sw[:, None], bb * sw, rcond=None)[0]; c_n = sol[:3]; r_ = math.sqrt(max(sol[3] + c_n @ c_n, 1e-12))
        res = np.abs(np.linalg.norm(P - c_n, axis=1) - r_); w_ = cauchy(res)
        if np.linalg.norm(c_n - c_) < 1e-7: c_ = c_n; break
        c_ = c_n
    return c_, r_
def seg_core(P, a, b):
    return seg_dist(P, np.array([a, b]))[0]
def skin_of(bone):
    """every mesh point whose largest weight is this bone (the body's own skin around it)"""
    pts = []
    for o in bpy.data.objects:
        if o.type != 'MESH' or bone not in o.vertex_groups: continue
        gi = o.vertex_groups[bone].index; mw = o.matrix_world
        for v_ in o.data.vertices:
            if v_.groups and max(v_.groups, key=lambda g: g.weight).group == gi: pts.append((mw @ v_.co)[:])
    return np.array(pts).reshape(-1, 3)
ext = arm.vrm_addon_extension.spring_bone1; ctx = bpy.context
def collider(bone, kind, p0, radius, p1=None):
    if radius <= 0: print('FIG collider on %s: the hair at rest is inside it, left out' % bone); return
    c = ext.add_collider(ctx, rig); c.node.bone_name = bone; c.shape_type = kind
    Mi = arm.bones[bone].matrix_local.inverted()
    if kind == 'Sphere': c.shape.sphere.offset = list(Mi @ Vector(p0)); c.shape.sphere.radius = radius
    else: c.shape.capsule.offset = list(Mi @ Vector(p0)); c.shape.capsule.tail = list(Mi @ Vector(p1)); c.shape.capsule.radius = radius
before = len(ext.colliders); rep_ = {}
scalp = V[hair & ~free]
if len(scalp) >= 4:
    sc_c, sc_r = fit_sphere(scalp); sc_r = clear(sc_r, np.linalg.norm(TAILS - sc_c, axis=1)); rep_['skull'] = sc_r
    collider('head', 'Sphere', sc_c, sc_r)
contour = np.concatenate([[[M[i][0], M[i][2]] for i in range(17)], [[M[i][0], M[i][2]] for i in range(26, 16, -1)]])
skin = read & ~hair & poly_inside(contour, V[:, 0], V[:, 2])
if skin.sum() >= 4:
    fc_c, fc_r = fit_sphere(V[skin]); fc_r = clear(fc_r, np.linalg.norm(TAILS - fc_c, axis=1)); rep_['face'] = fc_r
    collider('head', 'Sphere', fc_c, fc_r)
for bn, b0, b1 in [('neck', 'neck', None), ('shoulder.L', 'shoulder.L', 'upper_arm.L'), ('shoulder.R', 'shoulder.R', 'upper_arm.R'), ('chest', 'chest', None)]:
    if bn not in arm.bones: continue
    a0 = np.array(arm.bones[b0].head_local[:]); a1 = np.array((arm.bones[b1].head_local if b1 else arm.bones[b0].tail_local)[:])
    P_ = skin_of(bn)
    if len(P_) < 4: continue
    r_ = float(np.median(seg_core(P_, a0, a1))); r_ = clear(r_, seg_core(TAILS, a0, a1) if len(TAILS) else np.zeros(0)); rep_[bn] = r_
    collider(bn, 'Capsule', a0, r_, a1)
col_uuids = [c.uuid for c in ext.colliders][before:]
grp = ext.add_collider_group(); grp.vrm_name = 'hair'; grp_uuid = grp.uuid
for u_ in col_uuids:
    g_ = [x for x in ext.collider_groups if x.uuid == grp_uuid][0]; r_ = g_.add_collider(); r_.collider_uuid = u_
for ci, c in enumerate(chains):
    ext.add_spring(); sp = ext.springs[len(ext.springs) - 1]; sp.vrm_name = 'hair %+.0f' % c['angle']
    if CENTER != 'none': sp.center.bone_name = CENTER
    for k, n in enumerate(c['names'] + [c['tip']]):
        kk = min(k, c['K'] - 1)
        sp.add_joint(); j = sp.joints[len(sp.joints) - 1]; j.node.bone_name = n
        j.stiffness = STIFF * c['SK'][kk]; j.drag_force = DRAG; j.gravity_power = GRAV; j.hit_radius = float(HIT[ci][kk])
    sp.add_collider_group(); sp.collider_groups[len(sp.collider_groups) - 1].collider_group_uuid = grp_uuid
print('FIG springs %d, colliders %d (radii mm %s)' % (len(ext.springs), len(ext.colliders), {k: round(1000 * v_, 1) for k, v_ in rep_.items()}))
# every mesh at most four normalized influences
for ob in [o for o in bpy.data.objects if o.type == 'MESH' and o.vertex_groups]:
    for o in bpy.data.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, object=ob, selected_editable_objects=[ob]):
        bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.001)
        bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
face = dict(F); face['hair'] = {'chains': [{'angle': c['angle'], 'bones': c['names']} for c in chains], 'ears_z': ears_z,
                                'thickness': T, 'spring': {'stiffness': STIFF, 'drag': DRAG, 'gravity': GRAV} if C else None}
rig['figure_face'] = json.dumps(face)
for o in bpy.data.objects: o.select_set(False)
rig.select_set(True); bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT), exist_ok=True)
vrm = OUT.replace('.blend', '.vrm'); print('FIG export', bpy.ops.export_scene.vrm(filepath=vrm), os.path.getsize(vrm))
bpy.ops.wm.save_as_mainfile(filepath=OUT); print('FIG saved', OUT)
